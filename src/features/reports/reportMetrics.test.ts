import {describe,expect,it} from 'vitest'
import {buildConsultantRows,buildRecruitmentFunnel,isCompletedPlacement,isOverdueTask,reportDateRange} from './reportMetrics'

describe('canonical report metrics',()=>{
  it('counts unique submitted candidates and never lets later events exceed the cohort',()=>{
    const funnel=buildRecruitmentFunnel({
      submissions:[{job_candidate_id:'a'},{job_candidate_id:'b'}],
      interviews:[{job_candidate_id:'a',status:'scheduled'},{job_candidate_id:'a',status:'completed'},{job_candidate_id:'outside',status:'completed'}],
      offers:[{job_candidate_id:'a',status:'accepted'},{job_candidate_id:'outside',status:'accepted'}],
      placements:[{job_candidate_id:'a',status:'confirmed'},{job_candidate_id:'outside',status:'confirmed'}],
    })
    expect(funnel.map((row)=>row.value)).toEqual([2,1,1,1])
    expect(funnel.every((row)=>row.conversion==null||row.conversion<=100)).toBe(true)
  })

  it('uses one overdue definition and excludes cancelled, completed, and deleted tasks',()=>{
    const now=new Date('2026-07-18T12:00:00Z')
    expect(isOverdueTask({status:'open',due_at:'2026-07-18T11:59:00Z'},now)).toBe(true)
    expect(isOverdueTask({status:'in_progress',due_at:'2026-07-18T11:59:00Z'},now)).toBe(true)
    expect(isOverdueTask({status:'completed',due_at:'2026-07-17T00:00:00Z'},now)).toBe(false)
    expect(isOverdueTask({status:'open',due_at:'2026-07-17T00:00:00Z',deleted_at:'2026-07-18T00:00:00Z'},now)).toBe(false)
  })

  it('distinguishes a recorded placement from a completed placement',()=>{
    expect(isCompletedPlacement({status:'confirmed'})).toBe(false)
    expect(isCompletedPlacement({status:'completed'})).toBe(true)
  })

  it('builds date boundaries in the workspace timezone',()=>{
    expect(reportDateRange('2026-07-18','2026-07-18','Asia/Makassar')).toEqual({fromIso:'2026-07-17T16:00:00.000Z',toIso:'2026-07-18T15:59:59.999Z'})
  })
})

describe('consultant attribution',()=>{
  const member=(id:string,userId:string,name:string,status='active')=>({id,user_id:userId,status,profiles:{full_name:name}})
  const milestone=(jc:string,actor:string,status?:string)=>({job_candidate_id:jc,created_by:actor,status})
  const placement=(jc:string,actor:string,fee:number,currency='IDR',status='confirmed')=>({job_candidate_id:jc,created_by:actor,status,currency,placement_fee:fee})
  const input={
    members:[member('m1','u1','Ayu'),member('m2','u2','Bagus')],
    submissions:[milestone('jc1','u1'),milestone('jc1','u1'),milestone('jc2','u2')],
    interviews:[milestone('jc1','u1','scheduled'),milestone('jc2','u2','cancelled')],
    offers:[milestone('jc1','u1','accepted'),milestone('jc2','u2','draft')],
    placements:[placement('jc1','u1',50_000_000)],
    activeJobs:[{owner_member_id:'m1'},{owner_member_id:null}],
    overdueTasks:[{owner_member_id:'m2'},{owner_member_id:null}],
    baseCurrency:'IDR',
  }

  it('counts a candidate once per milestone however many events they generated',()=>{
    const ayu=buildConsultantRows(input).find((row)=>row.id==='m1')!
    expect(ayu.submissions).toBe(1)
    expect(ayu.interviews).toBe(1)
    expect(ayu.offers).toBe(1)
    expect(ayu.placements).toBe(1)
    expect(ayu.fees).toBe(50_000_000)
    expect(ayu.jobs).toBe(1)
  })

  it('excludes cancelled interviews and draft offers',()=>{
    const bagus=buildConsultantRows(input).find((row)=>row.id==='m2')!
    expect(bagus.submissions).toBe(1)
    expect(bagus.interviews).toBe(0)
    expect(bagus.offers).toBe(0)
    expect(bagus.overdue).toBe(1)
  })

  /* The scorecard's whole promise. A consultant reading their own row must see exactly what their
   * manager sees in the team table -- same builder, same records, so the numbers cannot drift. */
  it('gives a consultant the same row whether it is read alone or from the team table',()=>{
    const teamRow=buildConsultantRows(input).find((row)=>row.id==='m1')
    const soloRow=buildConsultantRows({...input,members:[member('m1','u1','Ayu')]}).find((row)=>row.id==='m1')
    expect(soloRow).toEqual(teamRow)
  })

  it('keeps a deactivated member who did the work',()=>{
    const rows=buildConsultantRows({...input,members:[member('m1','u1','Ayu','suspended'),member('m2','u2','Bagus')]})
    expect(rows.find((row)=>row.id==='m1')?.submissions).toBe(1)
  })

  it('attributes work by users no longer in the workspace rather than dropping it',()=>{
    const rows=buildConsultantRows({...input,members:[member('m2','u2','Bagus')]})
    const unknown=rows.find((row)=>row.id==='unknown-former-users')!
    expect(unknown.submissions).toBe(1)
    expect(unknown.fees).toBe(50_000_000)
  })

  it('surfaces unassigned overdue work instead of hiding it',()=>{
    const rows=buildConsultantRows(input)
    expect(rows.find((row)=>row.id==='unassigned')?.overdue).toBe(1)
  })

  it('never invents an exchange rate for fees in another currency',()=>{
    const rows=buildConsultantRows({...input,placements:[placement('jc1','u1',9_000,'USD')]})
    expect(rows.find((row)=>row.id==='m1')?.fees).toBe(0)
  })

  it('excludes cancelled placements from counts and fees',()=>{
    const rows=buildConsultantRows({...input,placements:[placement('jc1','u1',50_000_000,'IDR','cancelled')]})
    const ayu=rows.find((row)=>row.id==='m1')!
    expect(ayu.placements).toBe(0)
    expect(ayu.fees).toBe(0)
  })
})
