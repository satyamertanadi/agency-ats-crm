import {describe,expect,it} from 'vitest'
import {buildRecruitmentFunnel,isCompletedPlacement,isOverdueTask,reportDateRange} from './reportMetrics'

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
