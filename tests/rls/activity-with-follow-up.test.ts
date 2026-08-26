import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Logging an activity and scheduling the follow-up, as one transaction.
 *
 * There is exactly one property worth proving here, and everything below is a way of proving it:
 *
 *   THE ACTIVITY AND THE TASK ARE WRITTEN TOGETHER OR NOT AT ALL.
 *
 * The failure this prevents is silent and permanent. Two separate calls can half-succeed -- the note
 * lands, the task write is refused -- and the journal is left saying a call happened and a follow-up
 * was booked while no follow-up exists. The consultant believes the next step is scheduled and
 * nothing in the product will ever correct them. That is worse than an outright refusal, because it
 * is indistinguishable from success.
 *
 * So the rollback tests below all follow the same shape: make the TASK half fail, then assert that
 * the ACTIVITY is absent too. The activity is the thing that would have survived.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')

const owner=createClient(url,anon,{auth:{persistSession:false}})
/* Riley holds every *.read permission and no writes -- the first gate, activities.write, refuses
 * before anything is attempted. */
const reader=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const OWNER_MEMBER='40000000-0000-0000-0000-000000000001'

let candidateId=''
const createdActivities:string[]=[]
const createdTasks:string[]=[]

/* Every activity ever filed against this fixture candidate. The rollback assertions are counts over
 * this, because "the activity did not appear" is the claim being tested and a count is the only way
 * to state it that cannot be satisfied by looking at the wrong row. */
async function activityCount(){
  const result=await owner.from('activity_links').select('activity_id').eq('candidate_id',candidateId)
  expect(result.error).toBeNull()
  return (result.data||[]).length
}

async function taskCount(){
  const result=await owner.from('task_links').select('task_id').eq('candidate_id',candidateId)
  expect(result.error).toBeNull()
  return (result.data||[]).length
}

const call=(client:typeof owner,args:Record<string,unknown>)=>client.rpc('log_activity_with_follow_up',{
  p_organization_id:NORTHSTAR,p_type:'call',p_summary:'Spoke about the counter-offer.',
  p_links:[{candidate_id:candidateId}],...args,
})

beforeAll(async()=>{
  const sessions=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    reader.auth.signInWithPassword({email:'readonly@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  for(const session of sessions)if(session.error)throw session.error

  const created=await owner.from('candidates').insert({
    organization_id:NORTHSTAR,created_by:'10000000-0000-0000-0000-000000000001',
    full_name:'Follow Up Fixture',status:'active',
  }).select('id').single()
  expect(created.error).toBeNull()
  candidateId=(created.data as {id:string}).id
})

afterAll(async()=>{
  for(const id of createdTasks)await owner.from('tasks').delete().eq('id',id)
  for(const id of createdActivities)await owner.from('activities').delete().eq('id',id)
  if(candidateId)await owner.from('candidates').delete().eq('id',candidateId)
})

describe('activity only',()=>{
  it('writes the activity and no task when no follow-up is named',async()=>{
    const before=await taskCount()
    const result=await call(owner,{})
    expect(result.error).toBeNull()
    const [row]=result.data as {activity_id:string;task_id:string|null}[]
    expect(row?.activity_id).toBeTruthy()
    // Null is an absence, not a failure: the composer's follow-up section was left closed.
    expect(row?.task_id).toBeNull()
    if(row?.activity_id)createdActivities.push(row.activity_id)
    expect(await taskCount()).toBe(before)
  })

  /* A blank title is how the closed section says it was left closed, and must behave exactly as an
   * omitted one -- otherwise an empty input would raise on a form the user considers complete. */
  it('treats a blank follow-up title as no follow-up',async()=>{
    const before=await taskCount()
    const result=await call(owner,{p_task_title:'   '})
    expect(result.error).toBeNull()
    const [row]=result.data as {activity_id:string;task_id:string|null}[]
    expect(row?.task_id).toBeNull()
    if(row?.activity_id)createdActivities.push(row.activity_id)
    expect(await taskCount()).toBe(before)
  })
})

describe('activity and follow-up',()=>{
  it('writes both and links the task to the record the activity was filed against',async()=>{
    const result=await call(owner,{p_task_title:'Call back Friday',p_task_owner_member_id:OWNER_MEMBER,p_task_priority:'high'})
    expect(result.error).toBeNull()
    const [row]=result.data as {activity_id:string;task_id:string}[]
    const taskId=row?.task_id??''
    expect(row?.activity_id).toBeTruthy()
    expect(taskId).toBeTruthy()
    if(row?.activity_id)createdActivities.push(row.activity_id)
    if(taskId)createdTasks.push(taskId)

    const task=await owner.from('tasks').select('title,priority,owner_member_id').eq('id',taskId).single()
    expect(task.error).toBeNull()
    expect(task.data).toMatchObject({title:'Call back Friday',priority:'high',owner_member_id:OWNER_MEMBER})

    // The follow-up points at the record the note is about, never at a record chosen separately.
    const link=await owner.from('task_links').select('candidate_id').eq('task_id',taskId).single()
    expect(link.error).toBeNull()
    expect((link.data as {candidate_id:string}).candidate_id).toBe(candidateId)
  })

  /* The activity's first task-linkable link wins. An activity filed against both a candidate and a
   * job produces one follow-up, attached to the first -- not two, and not one attached to whichever
   * the planner happened to return. */
  it('attaches the follow-up to the first linkable record',async()=>{
    const job=await owner.from('jobs').select('id').eq('organization_id',NORTHSTAR).limit(1).single()
    expect(job.error).toBeNull()
    const jobId=(job.data as {id:string}).id

    const result=await owner.rpc('log_activity_with_follow_up',{
      p_organization_id:NORTHSTAR,p_type:'meeting',p_summary:'Debrief with the client.',
      p_links:[{candidate_id:candidateId},{job_id:jobId}],p_task_title:'Send the summary',
    })
    expect(result.error).toBeNull()
    const [row]=result.data as {activity_id:string;task_id:string}[]
    const taskId=row?.task_id??''
    if(row?.activity_id)createdActivities.push(row.activity_id)
    if(taskId)createdTasks.push(taskId)

    const links=await owner.from('task_links').select('candidate_id,job_id').eq('task_id',taskId)
    expect(links.data).toHaveLength(1)
    expect((links.data as {candidate_id:string|null}[])[0]?.candidate_id).toBe(candidateId)
  })
})

describe('the transaction boundary',()=>{
  /* The central test. create_task_with_link refuses an owner who is not an active member of this
   * workspace -- and it refuses AFTER the activity row has already been inserted, which is exactly
   * the moment a two-call implementation would leave the note behind. */
  it('writes no activity when the follow-up owner is invalid',async()=>{
    const before=await activityCount()
    const result=await call(owner,{
      p_task_title:'Call back Friday',
      // A real member id, belonging to the other workspace.
      p_task_owner_member_id:'40000000-0000-0000-0000-000000000008',
    })
    expect(result.error).not.toBeNull()
    expect(await activityCount()).toBe(before)
  })

  /* task_links reaches candidates, companies, contacts and jobs and nothing else, so an activity
   * filed only against a submission has no valid follow-up target. Refused rather than quietly
   * producing a task attached to nothing -- and refused after the activity insert, so this is a
   * rollback assertion too. */
  it('writes no activity when the follow-up has nowhere to attach',async()=>{
    const submission=await owner.from('candidate_submissions').select('id').eq('organization_id',NORTHSTAR).limit(1).single()
    if(submission.error||!submission.data)return

    const before=await owner.from('activities').select('id').eq('organization_id',NORTHSTAR).eq('summary','Unattachable follow-up.')
    expect((before.data||[]).length).toBe(0)

    const result=await owner.rpc('log_activity_with_follow_up',{
      p_organization_id:NORTHSTAR,p_type:'other',p_summary:'Unattachable follow-up.',
      p_links:[{candidate_submission_id:(submission.data as {id:string}).id}],
      p_task_title:'This cannot be attached',
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('follow_up_link_required')

    const after=await owner.from('activities').select('id').eq('organization_id',NORTHSTAR).eq('summary','Unattachable follow-up.')
    expect((after.data||[]).length).toBe(0)
  })

  /* The same activity, filed WITHOUT a follow-up, must still succeed -- otherwise the rule above
   * would be refusing the note rather than the task it cannot attach. */
  it('still accepts that activity when no follow-up is asked for',async()=>{
    const submission=await owner.from('candidate_submissions').select('id').eq('organization_id',NORTHSTAR).limit(1).single()
    if(submission.error||!submission.data)return

    const result=await owner.rpc('log_activity_with_follow_up',{
      p_organization_id:NORTHSTAR,p_type:'other',p_summary:'Note with no next step.',
      p_links:[{candidate_submission_id:(submission.data as {id:string}).id}],
    })
    expect(result.error).toBeNull()
    const [row]=result.data as {activity_id:string;task_id:string|null}[]
    expect(row?.task_id).toBeNull()
    if(row?.activity_id)createdActivities.push(row.activity_id)
  })

  it('refuses the whole call from a member who cannot write activities',async()=>{
    const before=await activityCount()
    const result=await call(reader,{p_task_title:'Call back Friday'})
    expect(result.error).not.toBeNull()
    expect(await activityCount()).toBe(before)
  })

  it('refuses another workspace outright',async()=>{
    const before=await activityCount()
    const result=await call(rival,{p_task_title:'Call back Friday'})
    expect(result.error).not.toBeNull()
    expect(await activityCount()).toBe(before)
  })

  /* Security invoker, and this is what that buys: the function adds no rights of its own, so the
   * refusals above come from log_manual_activity and create_task_with_link rather than from a third
   * permission check written here that could drift from either. */
  it('rejects a system activity type exactly as the plain journal write does',async()=>{
    const before=await activityCount()
    const result=await call(owner,{p_type:'placement',p_task_title:'Call back Friday'})
    expect(result.error).not.toBeNull()
    expect(await activityCount()).toBe(before)
  })
})
