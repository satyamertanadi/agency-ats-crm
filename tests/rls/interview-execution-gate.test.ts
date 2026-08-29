import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

/* Phase 1: consent and feature state are re-checked at EXECUTION time, not only at request time.
 *
 * The window this closes is a real one. A run is requested, validated, and queued; the provider call
 * happens later, on a worker. Everything that made the request legitimate can stop being true in
 * between -- the candidate withdraws, the workspace switches the feature off, the transcript is
 * purged -- and before this, none of it was re-examined. The transcript went to the model anyway.
 *
 * These tests exercise the gate directly rather than through the worker, because the gate is the
 * thing that must be right: the worker's only job is to obey it.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed gate fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const OWNER_USER='10000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const PASSWORD='LocalTest!123'

const PROVIDER='anthropic'
const MODEL='test-model'
const PROMPT='interview-analysis-v1'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

async function signIn(email:string){
  const client=createClient(url,anonKey,{auth:{persistSession:false}})
  const {error}=await client.auth.signInWithPassword({email,password:PASSWORD})
  if(error)throw new Error(`${email}: ${error.message}`)
  return client
}

let interviewId=''
let coreRubric=''
let jobRubric=''
let transcriptId=''
let runId=''

interface Verdict {allowed:boolean;reason:string|null;permanent:boolean}
const gate=async(id=runId,model=MODEL)=>{
  const result=await service.rpc('interview_analysis_execution_gate',{
    p_run_id:id,p_provider:PROVIDER,p_model:model,p_prompt_version:PROMPT,
  })
  if(result.error)throw new Error(result.error.message)
  return result.data as Verdict
}

async function grantConsent(){
  await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
  const consent=await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })
  if(consent.error)throw new Error(consent.error.message)
}

/* A queued run with everything it needs: a ready, speaker-mapped transcript and both rubrics. This
 * is the state the worker would pick up. */
async function seedQueuedRun(){
  await service.from('interview_analysis_runs').delete().eq('interview_id',interviewId)
  await service.from('interview_transcripts').delete().eq('interview_id',interviewId)

  const ingested=await service.rpc('ingest_interview_transcript',{
    p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
    p_source:'manual_text',p_checksum:`gate-${Date.now()}-${Math.random()}`,p_language_codes:['en'],
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

  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:PROVIDER,model:MODEL,prompt_version:PROMPT,
    transcript_bundle_hash:'tb',rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:`ih-${Date.now()}-${Math.random()}`,
    status:'queued',requested_by:CONSULTANT_USER,
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  runId=required(run.data,'run').id

  const link=await service.from('interview_analysis_run_transcripts').insert({
    organization_id:ORG,analysis_run_id:runId,transcript_id:transcriptId,sort_order:0,
  })
  if(link.error)throw new Error(link.error.message)
}

beforeAll(async()=>{
  await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,
    starts_at:'2027-09-01T09:00:00Z',ends_at:'2027-09-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw new Error(interview.error.message)
  interviewId=required(interview.data,'interview').id

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
      name:`gate ${type}`,status:'draft',created_by:OWNER_USER,
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
})

beforeEach(async()=>{
  await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  await service.from('candidate_private_details').update({legal_hold:false}).eq('candidate_id',CANDIDATE)
  await grantConsent()
  await seedQueuedRun()
})

afterAll(async()=>{
  await service.from('candidate_private_details').update({legal_hold:false}).eq('candidate_id',CANDIDATE)
  if(interviewId){
    await service.from('interview_analysis_runs').delete().eq('interview_id',interviewId)
    await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('the gate allows a run whose preconditions still hold',()=>{
  it('permits a queued run with granted consent, the feature on, and its transcript intact',async()=>{
    expect(await gate()).toMatchObject({allowed:true,reason:null})
  })
})

describe('what the gate refuses, and why each refusal is permanent',()=>{
  it('refuses after consent is withdrawn',async()=>{
    /* THE case. The run was legitimately requested; the candidate then changed their mind. Without
     * this the transcript is sent to a model after the person in it asked for it to be deleted. */
    await service.from('interview_transcription_consents').insert({
      organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
      status:'withdrawn',consent_method:'other',recorded_by:CONSULTANT_USER,
    })
    const verdict=await gate()
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('consent_not_granted')
    // Permanent: a retry is another attempt to send what must not be sent.
    expect(verdict.permanent).toBe(true)
  })

  it('refuses when the workspace switch has been turned off',async()=>{
    await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
    expect(await gate()).toMatchObject({allowed:false,reason:'feature_disabled',permanent:true})
  })

  it('refuses when the transcript has been purged',async()=>{
    const purged=await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'manual'})
    expect(purged.error).toBeNull()
    /* purge deletes the run outright when its evidentiary basis is gone, so the gate's honest answer
     * is that there is nothing left to execute -- either way, no provider call. */
    const verdict=await gate()
    expect(verdict.allowed).toBe(false)
    expect(['run_not_found','transcript_unavailable','transcript_required']).toContain(verdict.reason)
  })

  it('refuses a model the worker was not configured for',async()=>{
    /* The run was priced and fingerprinted against one model. A worker running another produces an
     * answer whose idempotency hash describes something that never happened. */
    expect(await gate(runId,'some-other-model')).toMatchObject({
      allowed:false,reason:'configuration_mismatch',permanent:true,
    })
  })

  it('refuses when a mapped consultant is no longer an active member',async()=>{
    const suspended=await service.from('organization_members').update({status:'suspended'}).eq('id',CONSULTANT_MEMBER)
    if(suspended.error)throw new Error(suspended.error.message)
    const verdict=await gate()
    const restored=await service.from('organization_members').update({status:'active'}).eq('id',CONSULTANT_MEMBER)
    if(restored.error)throw new Error(restored.error.message)
    expect(verdict).toMatchObject({allowed:false,reason:'consultant_subject_inactive'})
  })

  it('refuses a run that has already reached a terminal state',async()=>{
    // A second worker arriving late must stop quietly rather than re-running a completed analysis.
    await service.from('interview_analysis_runs').update({status:'completed'}).eq('id',runId)
    expect(await gate()).toMatchObject({allowed:false,reason:'run_not_executable'})
  })

  it('refuses a run that no longer exists',async()=>{
    expect(await gate('00000000-0000-0000-0000-000000000000')).toMatchObject({
      allowed:false,reason:'run_not_found',
    })
  })
})

describe('cancellation is not failure',()=>{
  it('marks the run cancelled with a bounded reason and no free text',async()=>{
    const cancelled=await service.rpc('cancel_interview_analysis',{p_run_id:runId,p_reason:'consent_not_granted'})
    expect(cancelled.data).toBe('cancelled')

    const row=await service.from('interview_analysis_runs')
      .select('status,error_code,error_message').eq('id',runId).single()
    const run=required(row.data,'run')
    expect(run.status).toBe('cancelled')
    expect(run.error_code).toBe('consent_not_granted')
    // Never a provider body: a provider error can echo the request, and the request is the transcript.
    expect(run.error_message).toBeNull()
  })

  it('refuses a reason outside the gate vocabulary',async()=>{
    /* The column would otherwise accept anything a caller passed, which is how a transcript line ends
     * up in an error field. */
    const attempt=await service.rpc('cancel_interview_analysis',{p_run_id:runId,p_reason:'the candidate said something'})
    expect(attempt.error?.message).toContain('invalid_cancellation_reason')
  })

  it('is a no-op on a run that already finished',async()=>{
    await service.from('interview_analysis_runs').update({status:'completed'}).eq('id',runId)
    const cancelled=await service.rpc('cancel_interview_analysis',{p_run_id:runId,p_reason:'feature_disabled'})
    expect(cancelled.data).toBe('noop')
  })
})

describe('consent is written through the audited RPC',()=>{
  it('derives the candidate from the interview rather than trusting the caller',async()=>{
    /* The old path took a candidate id as an argument, so consent for one candidate could be filed
     * against another candidate's interview. There is now no argument to get wrong. */
    const consultant=await signIn('consultant@northstar.local')
    const recorded=await consultant.rpc('record_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,
      p_status:'granted',p_consent_method:'spoken',
    })
    expect(recorded.error).toBeNull()

    const row=await service.from('interview_transcription_consents')
      .select('candidate_id').eq('id',recorded.data as string).single()
    expect(required(row.data,'consent').candidate_id).toBe(CANDIDATE)
  })

  it('refuses a consultant with no access to that specific interview',async()=>{
    /* The table policy checks the feature permission across the WORKSPACE. Access to assert what a
     * candidate agreed to has to be access to this interview. */
    const sourcer=await signIn('sourcer@northstar.local')
    const attempt=await sourcer.rpc('record_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,
      p_status:'granted',p_consent_method:'spoken',
    })
    expect(attempt.error?.message).toContain('permission_denied')
  })

  it('rejects an out-of-vocabulary status or method',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    const badStatus=await consultant.rpc('record_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_status:'probably',p_consent_method:'spoken',
    })
    expect(badStatus.error?.message).toContain('invalid_consent_status')

    const badMethod=await consultant.rpc('record_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_status:'granted',p_consent_method:'telepathy',
    })
    expect(badMethod.error?.message).toContain('invalid_consent_method')
  })

  it('keeps evidence text out of the audit log',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    const recorded=await consultant.rpc('record_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_status:'granted',
      p_consent_method:'spoken',p_evidence:'She said yes at the start of the call, distinctive phrase.',
    })
    expect(recorded.error).toBeNull()

    const audit=await service.from('audit_logs').select('metadata')
      .eq('action','interview_consent.recorded').eq('entity_id',interviewId)
      .order('created_at',{ascending:false}).limit(1).single()
    expect(JSON.stringify(required(audit.data,'audit').metadata)).not.toContain('distinctive phrase')
  })
})

describe('withdrawal deletes, cancels, and reports honestly',()=>{
  it('purges the transcript and cancels queued analysis in one call',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    const result=await consultant.rpc('withdraw_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_evidence:null,
    })
    expect(result.error).toBeNull()
    const outcome=result.data as {outcome:string;transcripts_purged:number;analysis_runs_cancelled:number}
    expect(outcome.outcome).toBe('purged')
    expect(outcome.transcripts_purged).toBeGreaterThan(0)
    expect(outcome.analysis_runs_cancelled).toBeGreaterThan(0)

    // Nothing left for a worker to pick up, and nothing left to send.
    const entries=await service.from('interview_transcript_entries').select('id').eq('transcript_id',transcriptId)
    expect(entries.data).toEqual([])
    const jobs=await service.from('background_jobs').select('id')
      .eq('organization_id',ORG).in('job_type',['interview_analysis','interview_auto_analysis'])
      .eq('status','pending')
    expect(jobs.data).toEqual([])
  })

  it('says so rather than lying when a legal hold blocks deletion',async()=>{
    /* Telling somebody their recording is gone when it is not is the worse failure, so the hold is
     * reported as the outcome rather than swallowed. */
    const held=await service.from('candidate_private_details').update({legal_hold:true}).eq('candidate_id',CANDIDATE)
    if(held.error)throw new Error(held.error.message)

    const consultant=await signIn('consultant@northstar.local')
    const result=await consultant.rpc('withdraw_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_evidence:null,
    })
    await service.from('candidate_private_details').update({legal_hold:false}).eq('candidate_id',CANDIDATE)

    const outcome=result.data as {outcome:string;transcripts_on_legal_hold:number}
    expect(outcome.outcome).toBe('legal_hold')
    expect(outcome.transcripts_on_legal_hold).toBeGreaterThan(0)
  })

  it('leaves the consent history append-only',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    await consultant.rpc('withdraw_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_evidence:null,
    })
    const events=await service.from('interview_transcription_consents')
      .select('status').eq('interview_id',interviewId).order('occurred_at')
    const statuses=(events.data||[]).map((row)=>row.status)
    // The grant is still there. Withdrawal adds an event; it never rewrites one.
    expect(statuses).toContain('granted')
    expect(statuses).toContain('withdrawn')
  })

  it('reports nothing to purge when there was no transcript',async()=>{
    await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
    const consultant=await signIn('consultant@northstar.local')
    const result=await consultant.rpc('withdraw_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_evidence:null,
    })
    expect((result.data as {outcome:string}).outcome).toBe('nothing_to_purge')
  })

  it('refuses a member with no access to the interview',async()=>{
    const sourcer=await signIn('sourcer@northstar.local')
    const attempt=await sourcer.rpc('withdraw_interview_consent',{
      p_organization_id:ORG,p_interview_id:interviewId,p_evidence:null,
    })
    expect(attempt.error?.message).toContain('permission_denied')
  })
})

describe('unauthorized reach', ()=>{
  it('keeps the execution gate and cancellation out of authenticated hands',async()=>{
    /* These decide whether a paid, privacy-sensitive call may happen. A signed-in user calling them
     * directly could cancel a colleague's run or probe another workspace's state. */
    const consultant=await signIn('consultant@northstar.local')
    const gateAttempt=await consultant.rpc('interview_analysis_execution_gate',{
      p_run_id:runId,p_provider:PROVIDER,p_model:MODEL,p_prompt_version:PROMPT,
    })
    expect(gateAttempt.error).not.toBeNull()

    const cancelAttempt=await consultant.rpc('cancel_interview_analysis',{
      p_run_id:runId,p_reason:'feature_disabled',
    })
    expect(cancelAttempt.error).not.toBeNull()
  })
})
