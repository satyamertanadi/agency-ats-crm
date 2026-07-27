import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

/* job_candidates.closed_at existed from the initial schema and nothing ever wrote it, so every
 * `closed_at is null` filter in the app was a no-op. move_job_candidate_stage is the single path all
 * stage changes go through, so it is where the column gets stamped -- and these are the four rules it
 * has to hold to, asserted against the real RPC rather than inferred from the SQL. */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed the fixture rows this test moves between stages.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})

const required=<T,>(value:T|null|undefined,what:string):T=>{if(value===null||value===undefined)throw new Error(`${what} is required`);return value}

let ownerId='';let candidateId='';let jobCandidateId=''
const stages:Record<string,string>={}

const closedAt=async()=>{
  const result=await owner.from('job_candidates').select('closed_at').eq('id',jobCandidateId).single()
  expect(result.error).toBeNull()
  return result.data?.closed_at as string|null
}
const moveTo=async(stageKey:string,note?:string)=>{
  const result=await owner.rpc('move_job_candidate_stage',{p_job_candidate_id:jobCandidateId,p_stage_id:stages[stageKey],p_note:note,p_source:'test'})
  expect(result.error).toBeNull()
}

beforeAll(async()=>{
  const signIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'})
  if(signIn.error)throw signIn.error
  ownerId=required(signIn.data.user?.id,'owner user id')

  // Any seeded job with a pipeline will do -- this is about the stage machinery, not about a
  // particular vacancy.
  const job=await admin.from('jobs').select('id,pipeline_id').eq('organization_id',NORTHSTAR).not('pipeline_id','is',null).limit(1).single()
  expect(job.error).toBeNull()
  const pipelineId=required(job.data?.pipeline_id,'pipeline id') as string

  const stageRows=await admin.from('pipeline_stages').select('id,stage_key').eq('pipeline_id',pipelineId)
  expect(stageRows.error).toBeNull()
  for(const row of stageRows.data||[])stages[row.stage_key as string]=row.id as string
  for(const key of ['sourced','rejected','withdrawn','on_hold'])required(stages[key],`${key} stage`)

  const candidate=await admin.from('candidates').insert({organization_id:NORTHSTAR,full_name:'Closed At Fixture',status:'active',created_by:ownerId}).select('id').single()
  expect(candidate.error).toBeNull()
  candidateId=required(candidate.data?.id,'candidate id') as string

  const assignment=await admin.from('job_candidates').insert({organization_id:NORTHSTAR,job_id:required(job.data?.id,'job id'),candidate_id:candidateId,current_stage_id:stages.sourced,added_by:ownerId}).select('id').single()
  expect(assignment.error).toBeNull()
  jobCandidateId=required(assignment.data?.id,'job candidate id') as string
})

afterAll(async()=>{
  // stage_history and the activity fan-out reference these rows, and activity_links carries no
  // cascade -- same ordering constraint the placement journey test documents.
  if(candidateId){
    const links=await admin.from('activity_links').select('activity_id').eq('candidate_id',candidateId)
    const activityIds=[...new Set((links.data||[]).map((row)=>row.activity_id as string))]
    if(activityIds.length){
      await admin.from('activity_links').delete().in('activity_id',activityIds)
      await admin.from('activities').delete().in('id',activityIds)
    }
  }
  if(jobCandidateId)await admin.from('stage_history').delete().eq('job_candidate_id',jobCandidateId)
  if(jobCandidateId)await admin.from('job_candidates').delete().eq('id',jobCandidateId)
  if(candidateId)await admin.from('candidates').delete().eq('id',candidateId)
  await owner.auth.signOut()
})

describe('move_job_candidate_stage closes and reopens a candidate',()=>{
  it('leaves an active stage open, and stamps closed_at on rejection with the reason recorded',async()=>{
    expect(await closedAt()).toBeNull()

    await moveTo('rejected','Not enough commercial exposure')
    const closed=await closedAt()
    expect(closed).not.toBeNull()

    // p_note has always been in the signature and was never passed by any caller, so the one move
    // whose reason matters recorded none. It reaches stage_history, which is what the outcomes
    // drawer reads back.
    const history=await owner.from('stage_history').select('note,to_stage_id').eq('job_candidate_id',jobCandidateId).order('occurred_at',{ascending:false}).limit(1).single()
    expect(history.error).toBeNull()
    expect(history.data?.note).toBe('Not enough commercial exposure')
    expect(history.data?.to_stage_id).toBe(stages.rejected)
  })

  it('keeps the original close time when the outcome is corrected to withdrawn',async()=>{
    const before=await closedAt()
    expect(before).not.toBeNull()

    await moveTo('withdrawn','Actually withdrew themselves')
    // Changing rejected -> withdrawn corrects WHY they closed, not WHEN. Time-to-close reporting
    // reads this column, so re-stamping it would quietly restart the clock.
    expect(await closedAt()).toBe(before)
  })

  it('reopens the candidate when they are moved back to an active stage',async()=>{
    await moveTo('sourced','Reinstated after a second look')
    // Reinstatement is a plain stage move; it needs no dedicated RPC.
    expect(await closedAt()).toBeNull()
  })

  it('treats on hold as still in play rather than closed',async()=>{
    await moveTo('on_hold','Paused until Q3 budget')
    // on_hold is an outcome stage for board layout (a counter, not a column) but the candidate is
    // still live -- closing them would hide a paused candidate from every open count.
    expect(await closedAt()).toBeNull()
  })
})
