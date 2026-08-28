import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

/* Release B1: what automatic Meet ingestion will and will not do on its own.
 *
 * Two questions this file exists to answer. Which interviews does discovery consider worth asking
 * Google about -- because every wrong inclusion is either a wasted call or a request about a meeting
 * we have no business reading. And what has to be true before an analysis is queued without a human
 * asking for one -- because automation turns a miscalibrated assessment from something produced one
 * interview at a time into something produced for every interview the desk runs.
 *
 * Both functions are service-role only; the RPC ACL test asserts that separately. Here they are
 * called as the worker calls them.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed Meet fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const OWNER_USER='10000000-0000-0000-0000-000000000001'
const MEET_SCOPE='https://www.googleapis.com/auth/meetings.space.readonly'
const CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.events'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})

let interviewId=''
let connectionId=''
let coreRubric=''
let jobRubric=''

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

const jobsFor=(type:string)=>service.from('background_jobs').select('id,payload,idempotency_key').eq('organization_id',ORG).eq('job_type',type)

/* Discovery reads settings, the connection and the interview together, so each test sets exactly the
 * one condition it is about and this puts everything else back to "should be picked up". */
async function makeDiscoverable(){
  /* auto-analysis is reset to off here rather than left to test order: several tests turn it on, and
   * the one that asserts the shipped default would otherwise pass or fail depending on which of its
   * neighbours ran first. */
  await service.from('organization_settings').update({
    interview_intelligence_enabled:true,interview_meet_auto_import_enabled:true,interview_auto_analysis_enabled:false,
  }).eq('organization_id',ORG)
  await service.from('google_calendar_connections').update({
    status:'connected',scopes:[CALENDAR_SCOPE,MEET_SCOPE],
  }).eq('id',connectionId)
  await service.from('interviews').update({
    status:'completed',create_google_meet:true,meeting_url:'https://meet.google.com/abc-defg-hij',
    ends_at:new Date(Date.now()-60*60_000).toISOString(),
    transcript_fetch_attempts:0,transcript_last_checked_at:null,
  }).eq('id',interviewId)
  await service.from('background_jobs').delete().eq('organization_id',ORG).in('job_type',['meet_transcript_fetch','interview_auto_analysis'])
  await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
}

async function discover(){
  const result=await service.rpc('discover_meet_transcript_fetches',{p_limit:25})
  if(result.error)throw new Error(result.error.message)
  const queued=await jobsFor('meet_transcript_fetch')
  return {reported:(result.data as {queued:number}).queued,rows:queued.data??[]}
}

beforeAll(async()=>{
  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-11-02T09:00:00Z',ends_at:'2026-11-02T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw interview.error
  interviewId=required(interview.data,'interview').id

  const connection=await service.from('google_calendar_connections').insert({
    organization_id:ORG,member_id:CONSULTANT_MEMBER,google_email:'consultant@example.test',
    calendar_id:'primary',status:'connected',scopes:[CALENDAR_SCOPE,MEET_SCOPE],
  }).select('id').single()
  if(connection.error)throw connection.error
  connectionId=required(connection.data,'connection').id

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
      name:`meet ${type}`,status:'draft',created_by:OWNER_USER,
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
  await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
  await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })
  await makeDiscoverable()
})

afterAll(async()=>{
  await service.from('background_jobs').delete().eq('organization_id',ORG).in('job_type',['meet_transcript_fetch','interview_auto_analysis'])
  if(interviewId){
    await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  if(connectionId)await service.from('google_calendar_connections').delete().eq('id',connectionId)
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({
    interview_intelligence_enabled:false,interview_meet_auto_import_enabled:false,interview_auto_analysis_enabled:false,
  }).eq('organization_id',ORG)
})

describe('discovering which interviews to ask Google about',()=>{
  it('queues a fetch for a finished Meet interview in an opted-in workspace',async()=>{
    const {reported,rows}=await discover()
    expect(reported).toBe(1)
    expect(rows).toHaveLength(1)
    expect((rows[0].payload as {interview_id:string}).interview_id).toBe(interviewId)
  })

  it('queues once however often discovery runs',async()=>{
    /* Discovery runs on the maintenance schedule, so the same interview is seen repeatedly until a
     * transcript arrives. Without the idempotency key that is one job per sweep, each one spending a
     * Google call on the same meeting. */
    await discover()
    const second=await discover()
    expect(second.rows).toHaveLength(1)
  })

  it('ignores a workspace that has not turned auto-import on',async()=>{
    await service.from('organization_settings').update({interview_meet_auto_import_enabled:false}).eq('organization_id',ORG)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('ignores an interview whose organiser never granted the transcript scope',async()=>{
    /* Calendar and Meet are separate grants, and a consultant may approve one and decline the other.
     * Polling on a Calendar-only token burns the attempt budget against a call that cannot succeed,
     * so the interview would be given up on before the scope was ever added. */
    await service.from('google_calendar_connections').update({scopes:[CALENDAR_SCOPE]}).eq('id',connectionId)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('ignores an interview whose organiser needs to reauthorise',async()=>{
    await service.from('google_calendar_connections').update({status:'reauthorization_required'}).eq('id',connectionId)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('waits for the meeting to end before asking',async()=>{
    /* A conference record does not exist while the call is running, and asking during it returns
     * nothing -- an answer indistinguishable from "this meeting produced no transcript". */
    await service.from('interviews').update({ends_at:new Date(Date.now()+30*60_000).toISOString()}).eq('id',interviewId)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('stops polling a meeting that has been asked about too many times',async()=>{
    /* A meeting nobody recorded is indistinguishable from one still processing. The only honest way
     * to tell them apart is to stop asking. */
    await service.from('interviews').update({transcript_fetch_attempts:8}).eq('id',interviewId)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('does not ask again within the retry interval',async()=>{
    await service.from('interviews').update({transcript_last_checked_at:new Date().toISOString()}).eq('id',interviewId)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })

  it('does not fetch when a transcript is already present, however it arrived',async()=>{
    const ingested=await service.rpc('ingest_interview_transcript',{
      p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
      p_source:'manual_text',p_checksum:'meet-already-there',p_language_codes:['en'],
      p_has_timestamps:true,p_completeness:'complete',p_started_at:null,p_ended_at:null,
      p_duration_seconds:null,p_retention_days:90,p_supersedes_transcript_id:null,
      p_speakers:[{sourceSpeakerId:'Sarah',displayName:'Sarah'}],
      p_entries:[{sourceSpeakerId:'Sarah',startMs:0,endMs:2000,text:'Tell me about your last role.'}],
    })
    if(ingested.error)throw new Error(ingested.error.message)
    const {rows}=await discover()
    expect(rows).toEqual([])
  })
})

describe('recording what happened on a fetch attempt',()=>{
  it('counts every outcome, including finding nothing',async()=>{
    const first=await service.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_error:'meet_artifact_missing'})
    expect(first.data).toBe(1)
    const second=await service.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_error:'meet_artifact_missing'})
    expect(second.data).toBe(2)
  })

  it('keeps the resolved conference record when a later attempt does not supply one',async()=>{
    await service.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:'conferenceRecords/xyz'})
    await service.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_error:'meet_unavailable'})
    const row=await service.from('interviews').select('google_meet_conference_record_name').eq('id',interviewId).single()
    // Resolving it costs an API call and it never changes once a conference has ended.
    expect(required(row.data,'interview').google_meet_conference_record_name).toBe('conferenceRecords/xyz')
  })
})

describe('queueing an analysis without anybody asking for one',()=>{
  /* Builds a transcript that is ready and fully speaker-mapped -- the state a Meet import reaches
   * once a human has confirmed who is who. */
  async function readyMappedTranscript(checksum:string){
    const ingested=await service.rpc('ingest_interview_transcript',{
      p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
      p_source:'google_meet',p_checksum:checksum,p_language_codes:['en'],
      p_has_timestamps:true,p_completeness:'complete',p_started_at:null,p_ended_at:null,
      p_duration_seconds:null,p_retention_days:90,p_supersedes_transcript_id:null,
      p_speakers:[{sourceSpeakerId:'Sarah',displayName:'Sarah'},{sourceSpeakerId:'Aisha',displayName:'Aisha'}],
      p_entries:[
        {sourceSpeakerId:'Sarah',startMs:0,endMs:2000,text:'Tell me about your last role.'},
        {sourceSpeakerId:'Aisha',startMs:2000,endMs:9000,text:'I led the commercial team.'},
      ],
    })
    if(ingested.error)throw new Error(ingested.error.message)
    const transcriptId=(ingested.data as {transcript_id:string}).transcript_id
    await service.from('interview_transcripts').update({status:'ready'}).eq('id',transcriptId)

    const speakers=await service.from('interview_transcript_speakers').select('id,source_speaker_id').eq('transcript_id',transcriptId)
    for(const speaker of speakers.data??[]){
      await service.from('interview_transcript_speakers').update({
        speaker_role:speaker.source_speaker_id==='Sarah'?'consultant':'candidate',
        member_id:speaker.source_speaker_id==='Sarah'?CONSULTANT_MEMBER:null,
        candidate_id:speaker.source_speaker_id==='Sarah'?null:CANDIDATE,
        confirmed_by:CONSULTANT_USER,confirmed_at:new Date().toISOString(),
      }).eq('id',speaker.id)
    }
    return transcriptId
  }

  const attempt=async()=>{
    const result=await service.rpc('maybe_queue_automatic_analysis',{p_interview_id:interviewId})
    if(result.error)throw new Error(result.error.message)
    return result.data as {queued:boolean;reason:string|null}
  }

  it('declines by default, because auto-analysis is off until calibration is accepted',async()=>{
    /* The switch this release deliberately ships in the off position. Importing a transcript is the
     * same artifact a consultant would paste; analysing every one of them automatically is a
     * different proposition, and the plan gates it on calibration that has not happened. */
    await readyMappedTranscript('meet-auto-default')
    const outcome=await attempt()
    expect(outcome).toEqual({queued:false,reason:'auto_analysis_disabled'})
    expect((await jobsFor('interview_auto_analysis')).data).toEqual([])
  })

  it('queues a request once the workspace has opted in',async()=>{
    await service.from('organization_settings').update({interview_auto_analysis_enabled:true}).eq('organization_id',ORG)
    await readyMappedTranscript('meet-auto-enabled')
    expect(await attempt()).toEqual({queued:true,reason:null})

    const queued=(await jobsFor('interview_auto_analysis')).data??[]
    expect(queued).toHaveLength(1)
    const payload=queued[0].payload as {interview_id:string;requested_by:string}
    expect(payload.interview_id).toBe(interviewId)
    // Attributed to the organiser, not to "the system": a paid action with no requester is one
    // nobody owns, and cost, audit trail and rate limit should all land on a person.
    expect(payload.requested_by).toBe(CONSULTANT_USER)
  })

  it('refuses without consent even when the workspace opted in',async()=>{
    /* The invariant that must hold on every path into analysis. Automation is exactly where a
     * missing consent check would go unnoticed, because no human is looking at the moment it runs. */
    await service.from('organization_settings').update({interview_auto_analysis_enabled:true}).eq('organization_id',ORG)
    await readyMappedTranscript('meet-auto-consent')
    await service.from('interview_transcription_consents').update({status:'withdrawn'}).eq('interview_id',interviewId)
    expect(await attempt()).toEqual({queued:false,reason:'consent_required'})
    expect((await jobsFor('interview_auto_analysis')).data).toEqual([])
  })

  it('waits for a human to confirm who was speaking',async()=>{
    /* A Meet transcript arrives with Google's own speaker labels. Analysing before somebody has said
     * which of them is the candidate would attribute the interviewer's words to the interviewee. */
    await service.from('organization_settings').update({interview_auto_analysis_enabled:true}).eq('organization_id',ORG)
    const transcriptId=await readyMappedTranscript('meet-auto-unmapped')
    await service.from('interview_transcript_speakers').update({confirmed_at:null,confirmed_by:null}).eq('transcript_id',transcriptId)
    expect(await attempt()).toEqual({queued:false,reason:'speaker_mapping_required'})
  })

  it('does nothing when there is no transcript yet',async()=>{
    await service.from('organization_settings').update({interview_auto_analysis_enabled:true}).eq('organization_id',ORG)
    expect(await attempt()).toEqual({queued:false,reason:'transcript_required'})
  })

  it('queues one request however many times it is called',async()=>{
    /* Called speculatively after an import and again after speaker mapping, which can land within a
     * minute of each other. Two jobs here would be two paid runs of the same conversation. */
    await service.from('organization_settings').update({interview_auto_analysis_enabled:true}).eq('organization_id',ORG)
    await readyMappedTranscript('meet-auto-twice')
    await attempt()
    await attempt()
    expect((await jobsFor('interview_auto_analysis')).data).toHaveLength(1)
  })
})
