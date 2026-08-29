import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

/* Phase 2: one place decides whether a paid run may be created, and every billed call is counted.
 *
 * The limits lived in the request-interview-analysis Edge Function, which automatic analysis never
 * calls -- so an opted-in workspace had no ceiling on the path that runs without anybody watching.
 * And monthly spend was read from the run's own token columns, which remember the LAST provider
 * response, so a malformed first call followed by a successful retry billed twice and counted once.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed spend fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const OWNER_USER='10000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const PASSWORD='LocalTest!123'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

let interviewId=''
let coreRubric=''
let jobRubric=''
let transcriptId=''

async function signIn(email:string){
  const client=createClient(url,anonKey,{auth:{persistSession:false}})
  const {error}=await client.auth.signInWithPassword({email,password:PASSWORD})
  if(error)throw new Error(`${email}: ${error.message}`)
  return client
}

const requestRun=(provider='anthropic',model='test-model')=>
  service.rpc('internal_request_interview_analysis',{
    p_organization_id:ORG,p_interview_id:interviewId,p_requested_by:CONSULTANT_USER,
    p_provider:provider,p_model:model,p_prompt_version:'interview-analysis-v1',
  })

/* A run created directly, so a test can control its tokens and creation time without a provider. */
async function seedRun(overrides:Record<string,unknown>={}){
  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:'tb',rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:`seed-${Date.now()}-${Math.random()}`,
    status:'completed',requested_by:CONSULTANT_USER,...overrides,
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  return required(run.data,'run').id
}

beforeAll(async()=>{
  await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,
    starts_at:'2027-10-01T09:00:00Z',ends_at:'2027-10-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw new Error(interview.error.message)
  interviewId=required(interview.data,'interview').id

  await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
      name:`spend ${type}`,status:'draft',created_by:OWNER_USER,
    }).select('id').single()
    if(rubric.error)throw new Error(rubric.error.message)
    const id=required(rubric.data,'rubric').id
    await service.from('interview_rubric_items').insert({
      organization_id:ORG,rubric_id:id,dimension:'essential_coverage',item_type:'essential_question',
      label:'item',requirement_level:'must_have',sort_order:0,
    })
    await service.from('interview_rubrics').update({status:'active',activated_by:OWNER_USER,activated_at:new Date().toISOString()}).eq('id',id)
    if(type==='core')coreRubric=id;else jobRubric=id
  }

  const ingested=await service.rpc('ingest_interview_transcript',{
    p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
    p_source:'manual_text',p_checksum:`spend-${Date.now()}`,p_language_codes:['en'],
    p_has_timestamps:true,p_completeness:'complete',p_started_at:null,p_ended_at:null,
    p_duration_seconds:null,p_retention_days:90,p_supersedes_transcript_id:null,
    p_speakers:[{sourceSpeakerId:'Sarah',displayName:'Sarah'}],
    p_entries:[{sourceSpeakerId:'Sarah',startMs:0,endMs:2000,text:'Tell me about your last role.'}],
  })
  if(ingested.error)throw new Error(ingested.error.message)
  transcriptId=(ingested.data as {transcript_id:string}).transcript_id
  await service.from('interview_transcripts').update({status:'ready'}).eq('id',transcriptId)
  const speakers=await service.from('interview_transcript_speakers').select('id').eq('transcript_id',transcriptId)
  for(const speaker of speakers.data??[]){
    await service.from('interview_transcript_speakers').update({
      speaker_role:'consultant',member_id:CONSULTANT_MEMBER,
      confirmed_by:CONSULTANT_USER,confirmed_at:new Date().toISOString(),
    }).eq('id',speaker.id)
  }
})

beforeEach(async()=>{
  await service.from('interview_analysis_attempts').delete().eq('organization_id',ORG)
  await service.from('interview_analysis_runs').delete().eq('organization_id',ORG)
  await service.from('background_jobs').delete().eq('organization_id',ORG).in('job_type',['interview_analysis','interview_auto_analysis'])
})

afterAll(async()=>{
  await service.from('interview_analysis_attempts').delete().eq('organization_id',ORG)
  await service.from('interview_analysis_runs').delete().eq('organization_id',ORG)
  await service.from('background_jobs').delete().eq('organization_id',ORG).in('job_type',['interview_analysis','interview_auto_analysis'])
  if(interviewId){
    await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('provider is part of the identity of a run',()=>{
  it('does not deduplicate two providers that share a model name',async()=>{
    /* Same model name on a different provider is different work, priced differently. Before this the
     * second request reused the first run and the second provider was never called. */
    const first=await requestRun('anthropic','shared-name')
    expect(first.error).toBeNull()
    const second=await requestRun('other-provider','shared-name')
    expect(second.error).toBeNull()

    expect((second.data as {reused:boolean}).reused).toBe(false)
    expect((second.data as {run_id:string}).run_id).not.toBe((first.data as {run_id:string}).run_id)
  })

  it('still deduplicates an identical repeat request',async()=>{
    // The double-click case the dedup exists for.
    const first=await requestRun()
    const second=await requestRun()
    expect((second.data as {reused:boolean}).reused).toBe(true)
    expect((second.data as {run_id:string}).run_id).toBe((first.data as {run_id:string}).run_id)
  })
})

describe('the ceiling applies to every path that creates a paid run',()=>{
  it('refuses a new run once the workspace hourly limit is reached',async()=>{
    /* Enforced inside internal_request_interview_analysis rather than only in the Edge Function,
     * which automatic analysis never calls. This is the automatic path's ceiling too. */
    for(let index=0;index<40;index+=1)await seedRun()
    const blocked=await requestRun('anthropic','model-after-limit')
    expect(blocked.error?.message).toContain('rate_limited_organization')
  })

  it('still returns an existing run when the limit is reached',async()=>{
    /* Reuse costs nothing, so a rate limit must not break the page for somebody who is not spending.
     * The check deliberately sits after the dedup lookup. */
    const first=await requestRun()
    for(let index=0;index<40;index+=1)await seedRun()
    const reused=await requestRun()
    expect(reused.error).toBeNull()
    expect((reused.data as {reused:boolean}).reused).toBe(true)
    expect((reused.data as {run_id:string}).run_id).toBe((first.data as {run_id:string}).run_id)
  })

  it('reports which limit was breached rather than a single generic refusal',async()=>{
    const breach=await service.rpc('interview_analysis_limit_breach',{
      p_organization_id:ORG,p_requested_by:CONSULTANT_USER,
      p_hourly_user_limit:1,p_hourly_org_limit:100,p_monthly_token_ceiling:100000000,
    })
    expect(breach.data).toBeNull()

    await seedRun()
    const afterOne=await service.rpc('interview_analysis_limit_breach',{
      p_organization_id:ORG,p_requested_by:CONSULTANT_USER,
      p_hourly_user_limit:1,p_hourly_org_limit:100,p_monthly_token_ceiling:100000000,
    })
    // The person, not the workspace: the two have different remedies.
    expect(afterOne.data).toBe('rate_limited_user')
  })

  it('separates the per-person limit from the workspace limit',async()=>{
    await seedRun({requested_by:OWNER_USER})
    const forConsultant=await service.rpc('interview_analysis_limit_breach',{
      p_organization_id:ORG,p_requested_by:CONSULTANT_USER,
      p_hourly_user_limit:1,p_hourly_org_limit:100,p_monthly_token_ceiling:100000000,
    })
    // Somebody else's run must not consume this person's allowance.
    expect(forConsultant.data).toBeNull()
  })
})

describe('every billed call is counted, including the ones that failed',()=>{
  it('counts a malformed first response and its successful retry as two calls',async()=>{
    /* The case the old accounting lost. Tokens were summed onto the run only when the retry
     * succeeded, and the run column holds one number however many calls were made. */
    const runId=await seedRun({input_tokens:0,output_tokens:0})
    await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:1,p_outcome:'invalid_output',
      p_input_tokens:1000,p_output_tokens:200,
    })
    await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:2,p_outcome:'succeeded',
      p_input_tokens:1000,p_output_tokens:400,
    })
    const spend=await service.rpc('interview_analysis_token_spend_this_month',{p_organization_id:ORG})
    expect(Number(spend.data)).toBe(2600)
  })

  it('counts two failed attempts that produced no analysis at all',async()=>{
    /* Two billed calls, no result. Before this the throw happened before anything was written and
     * the ceiling never saw them -- which is exactly when spend control matters most. */
    const runId=await seedRun({status:'failed',input_tokens:null,output_tokens:null})
    await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:1,p_outcome:'invalid_output',p_input_tokens:900,p_output_tokens:100,
    })
    await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:2,p_outcome:'invalid_output',p_input_tokens:900,p_output_tokens:100,
    })
    const spend=await service.rpc('interview_analysis_token_spend_this_month',{p_organization_id:ORG})
    expect(Number(spend.data)).toBe(2000)
  })

  it('falls back to the run columns for runs recorded before the ledger existed',async()=>{
    // Otherwise a workspace's ceiling silently resets to zero mid-month on deployment day.
    await seedRun({input_tokens:5000,output_tokens:1000})
    const spend=await service.rpc('interview_analysis_token_spend_this_month',{p_organization_id:ORG})
    expect(Number(spend.data)).toBe(6000)
  })

  it('never counts a run both ways',async()=>{
    const runId=await seedRun({input_tokens:9999,output_tokens:9999})
    await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:1,p_outcome:'succeeded',p_input_tokens:10,p_output_tokens:5,
    })
    const spend=await service.rpc('interview_analysis_token_spend_this_month',{p_organization_id:ORG})
    // The ledger wins where it exists; the run columns are only a fallback.
    expect(Number(spend.data)).toBe(15)
  })

  it('is idempotent, so a worker retrying its own bookkeeping cannot double-count',async()=>{
    const runId=await seedRun({input_tokens:0,output_tokens:0})
    for(let index=0;index<3;index+=1){
      await service.rpc('record_interview_analysis_attempt',{
        p_run_id:runId,p_attempt_number:1,p_outcome:'succeeded',p_input_tokens:100,p_output_tokens:50,
      })
    }
    const spend=await service.rpc('interview_analysis_token_spend_this_month',{p_organization_id:ORG})
    expect(Number(spend.data)).toBe(150)
  })

  it('refuses an outcome outside the three real ones',async()=>{
    const runId=await seedRun()
    const attempt=await service.rpc('record_interview_analysis_attempt',{
      p_run_id:runId,p_attempt_number:1,p_outcome:'weird',p_input_tokens:1,p_output_tokens:1,
    })
    expect(attempt.error?.message).toContain('invalid_attempt_outcome')
  })
})

describe('the ledger is not reachable from a session',()=>{
  it('keeps attempts and the limit check away from authenticated callers',async()=>{
    /* The ledger describes spending patterns across a workspace, and the limit function is a probe
     * for how much room is left. Neither is a consultant's business. */
    const consultant=await signIn('consultant@northstar.local')
    const rows=await consultant.from('interview_analysis_attempts').select('id')
    expect(rows.data??[]).toEqual([])

    const record=await consultant.rpc('record_interview_analysis_attempt',{
      p_run_id:'00000000-0000-0000-0000-000000000000',p_attempt_number:1,
      p_outcome:'succeeded',p_input_tokens:1,p_output_tokens:1,
    })
    expect(record.error).not.toBeNull()

    const breach=await consultant.rpc('interview_analysis_limit_breach',{
      p_organization_id:ORG,p_requested_by:CONSULTANT_USER,
    })
    expect(breach.error).not.toBeNull()
  })

  it('keeps the internal request function service-role only',async()=>{
    /* The whole point of Phase 2: a signed-in user must not be able to name a model or skip the
     * ceiling by calling the request path directly. */
    const consultant=await signIn('consultant@northstar.local')
    const attempt=await consultant.rpc('internal_request_interview_analysis',{
      p_organization_id:ORG,p_interview_id:interviewId,p_requested_by:CONSULTANT_USER,
      p_provider:'anthropic',p_model:'a-model-i-chose',p_prompt_version:'interview-analysis-v1',
    })
    expect(attempt.error).not.toBeNull()
  })
})
