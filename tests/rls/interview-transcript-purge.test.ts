import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

/* Retention and the consent-withdrawal purge.
 *
 * The assertion this file exists for: after a purge, nothing derived from the transcript survives.
 * Keeping an assessment while deleting the transcript under it would leave the one artifact worse
 * than keeping everything -- a conclusion about a named person that nobody can explain, challenge or
 * verify.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed purge fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const OWNER_USER='10000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})

let interviewId=''
let coreRubric=''
let jobRubric=''

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

/* Builds a complete analysed interview: transcript, mapped speakers, a run, an assessment, a finding,
 * evidence and metrics. Every purge test starts from one of these so the deletion has something real
 * to remove. */
async function buildAnalysedTranscript(checksum:string,purgeDueAt='2027-01-01T00:00:00Z'){
  const ingested=await service.rpc('ingest_interview_transcript',{
    p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
    p_source:'manual_text',p_checksum:checksum,p_language_codes:['en'],
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

  await service.from('interview_transcripts').update({status:'ready',purge_due_at:purgeDueAt}).eq('id',transcriptId)

  const speakerRows=await service.from('interview_transcript_speakers').select('id,source_speaker_id').eq('transcript_id',transcriptId)
  const consultantSpeaker=required(speakerRows.data?.find((row)=>row.source_speaker_id==='Sarah'),'consultant speaker').id
  await service.from('interview_transcript_speakers').update({
    speaker_role:'consultant',member_id:CONSULTANT_MEMBER,confirmed_by:CONSULTANT_USER,confirmed_at:new Date().toISOString(),
  }).eq('id',consultantSpeaker)

  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:`tb-${checksum}`,rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:`ih-${checksum}`,status:'completed',
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  const runId=required(run.data,'run').id

  await service.from('interview_analysis_run_transcripts').insert({
    organization_id:ORG,analysis_run_id:runId,transcript_id:transcriptId,sort_order:0,
  })

  const entry=await service.from('interview_transcript_entries').select('id').eq('transcript_id',transcriptId).limit(1).single()
  const persisted=await service.rpc('persist_interview_analysis',{
    p_run_id:runId,
    p_assessments:[{assessment_type:'candidate_fit',subject_candidate_id:CANDIDATE,subject_member_id:null,
      overall_band:'promising_but_incomplete',confidence:'medium',summary:'Commercial leadership evidenced.',
      findings:[{category:'requirement',result:'met',score:null,severity:'info',confidence:'high',
        title:'Commercial leadership',summary:'Led a team for three years.',coaching_suggestion:null,rubric_item_id:null,
        evidence:[{source_type:'transcript_entry',source_record_id:required(entry.data,'entry').id,source_locator:null,excerpt:'I led the commercial team.'}]}]}],
    p_metrics:[{transcript_id:transcriptId,speaker_id:consultantSpeaker,speaker_role:'consultant',
      subject_member_id:CONSULTANT_MEMBER,subject_candidate_id:null,speech_ms:2000,turn_count:1,average_turn_ms:2000,longest_turn_ms:2000}],
    p_metric_summary:{timestamp_coverage:1,unknown_speech_ms:0,overlap_ms:0,overlap_count:0,metric_confidence:'high'},
    p_input_tokens:100,p_output_tokens:50,p_processing_ms:1000,
  })
  if(persisted.error)throw new Error(persisted.error.message)

  return {transcriptId,runId}
}

async function derivedCounts(runId:string,transcriptId:string){
  const [assessments,metrics,summaries,links,entries,speakers]=await Promise.all([
    service.from('interview_assessments').select('id').eq('analysis_run_id',runId),
    service.from('interview_conversation_metrics').select('id').eq('analysis_run_id',runId),
    service.from('interview_conversation_metric_summaries').select('analysis_run_id').eq('analysis_run_id',runId),
    service.from('interview_analysis_run_transcripts').select('transcript_id').eq('analysis_run_id',runId),
    service.from('interview_transcript_entries').select('id').eq('transcript_id',transcriptId),
    service.from('interview_transcript_speakers').select('id').eq('transcript_id',transcriptId),
  ])
  const findings=assessments.data?.length
    ? await service.from('interview_assessment_findings').select('id').in('assessment_id',assessments.data.map((row)=>row.id))
    : {data:[]}
  const evidence=findings.data?.length
    ? await service.from('interview_finding_evidence').select('id').in('finding_id',findings.data.map((row)=>row.id))
    : {data:[]}
  return {
    assessments:assessments.data?.length??0,
    findings:findings.data?.length??0,
    evidence:evidence.data?.length??0,
    metrics:metrics.data?.length??0,
    summaries:summaries.data?.length??0,
    links:links.data?.length??0,
    entries:entries.data?.length??0,
    speakers:speakers.data?.length??0,
  }
}

beforeAll(async()=>{
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-11-01T09:00:00Z',ends_at:'2026-11-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw interview.error
  interviewId=required(interview.data,'interview').id

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?'80000000-0000-0000-0000-000000000001':null,
      name:`purge ${type}`,status:'draft',created_by:OWNER_USER,
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
  // Consent is re-granted per test: several tests withdraw it, and ingestion refuses without it.
  await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
  await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })
  await service.from('candidate_private_details').update({legal_hold:false}).eq('candidate_id',CANDIDATE)
})

afterAll(async()=>{
  await service.from('candidate_private_details').update({legal_hold:false}).eq('candidate_id',CANDIDATE)
  if(interviewId){
    await service.from('interview_transcripts').delete().eq('interview_id',interviewId)
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('purging a transcript removes everything derived from it',()=>{
  it('leaves no assessment, finding, evidence, metric or entry behind',async()=>{
    const {transcriptId,runId}=await buildAnalysedTranscript('purge-full')

    const before=await derivedCounts(runId,transcriptId)
    expect(before).toEqual({assessments:1,findings:1,evidence:1,metrics:1,summaries:1,links:1,entries:2,speakers:2})

    const purged=await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'manual'})
    expect(purged.error).toBeNull()
    expect((purged.data as {purged:boolean}).purged).toBe(true)

    const after=await derivedCounts(runId,transcriptId)
    expect(after).toEqual({assessments:0,findings:0,evidence:0,metrics:0,summaries:0,links:0,entries:0,speakers:0})

    // The run itself is gone, not merely emptied: an assessment whose evidence was deleted is the
    // one artifact worse than keeping everything.
    const run=await service.from('interview_analysis_runs').select('id').eq('id',runId)
    expect(run.data).toEqual([])
  })

  it('keeps the transcript row as a tombstone rather than vanishing',async()=>{
    const {transcriptId}=await buildAnalysedTranscript('purge-tombstone')
    await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'manual'})

    const transcript=await service.from('interview_transcripts').select('status,purged_at,entry_count,has_timestamps').eq('id',transcriptId).single()
    expect(transcript.data?.status).toBe('purged')
    expect(transcript.data?.purged_at).not.toBeNull()
    expect(transcript.data?.entry_count).toBe(0)
    expect(transcript.data?.has_timestamps).toBe(false)
  })

  it('is idempotent',async()=>{
    const {transcriptId}=await buildAnalysedTranscript('purge-twice')
    await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'manual'})
    const again=await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'manual'})
    expect(again.error).toBeNull()
    expect((again.data as {skipped?:string}).skipped).toBe('already_purged')
  })

  it('records an audit event with counts and no transcript content',async()=>{
    const {transcriptId}=await buildAnalysedTranscript('purge-audit')
    await service.rpc('purge_interview_transcript',{p_transcript_id:transcriptId,p_reason:'retention_expired'})

    const audit=await service.from('audit_logs').select('metadata').eq('action','interview_transcript.purged').eq('entity_id',transcriptId)
    expect(audit.data).toHaveLength(1)
    const serialized=JSON.stringify(audit.data?.[0].metadata)
    expect(serialized).toContain('retention_expired')
    expect(serialized).toContain('entries_removed')
    // The thing the purge just deleted must not reappear in a table with longer retention.
    expect(serialized).not.toContain('commercial team')
    expect(serialized).not.toContain('Sarah')
    expect(serialized).not.toContain('promising_but_incomplete')
  })
})

describe('legal hold outranks both retention and withdrawal',()=>{
  it('skips a transcript whose candidate is on hold',async()=>{
    const {transcriptId,runId}=await buildAnalysedTranscript('purge-hold','2020-01-01T00:00:00Z')
    await service.from('candidate_private_details').update({legal_hold:true}).eq('candidate_id',CANDIDATE)

    const swept=await service.rpc('purge_due_interview_transcripts',{p_limit:50})
    expect(swept.error).toBeNull()
    expect((swept.data as {skipped:number}).skipped).toBeGreaterThan(0)

    const transcript=await service.from('interview_transcripts').select('status,purged_at').eq('id',transcriptId).single()
    expect(transcript.data?.purged_at).toBeNull()
    const after=await derivedCounts(runId,transcriptId)
    expect(after.assessments).toBe(1)
    expect(after.entries).toBe(2)
  })
})

describe('the scheduled sweep',()=>{
  it('purges a transcript whose retention window has passed',async()=>{
    const {transcriptId,runId}=await buildAnalysedTranscript('purge-expired','2020-01-01T00:00:00Z')
    const swept=await service.rpc('purge_due_interview_transcripts',{p_limit:50})
    expect(swept.error).toBeNull()
    expect((swept.data as {purged:number}).purged).toBeGreaterThan(0)

    const transcript=await service.from('interview_transcripts').select('status').eq('id',transcriptId).single()
    expect(transcript.data?.status).toBe('purged')
    expect((await derivedCounts(runId,transcriptId)).assessments).toBe(0)
  })

  it('purges on consent withdrawal even though retention has not expired',async()=>{
    const {transcriptId,runId}=await buildAnalysedTranscript('purge-withdrawn','2030-01-01T00:00:00Z')

    const withdrawn=await service.from('interview_transcription_consents').insert({
      organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
      status:'withdrawn',consent_method:'written',recorded_by:CONSULTANT_USER,
    })
    expect(withdrawn.error).toBeNull()

    const swept=await service.rpc('purge_due_interview_transcripts',{p_limit:50})
    expect(swept.error).toBeNull()

    const transcript=await service.from('interview_transcripts').select('status').eq('id',transcriptId).single()
    expect(transcript.data?.status).toBe('purged')
    expect((await derivedCounts(runId,transcriptId)).assessments).toBe(0)

    // The consent history itself survives: it is the record of why the deletion happened.
    const consents=await service.from('interview_transcription_consents').select('status').eq('interview_id',interviewId)
    expect((consents.data||[]).some((row)=>row.status==='withdrawn')).toBe(true)
  })

  it('leaves a live, consented transcript alone',async()=>{
    const {transcriptId}=await buildAnalysedTranscript('purge-live','2030-01-01T00:00:00Z')
    await service.rpc('purge_due_interview_transcripts',{p_limit:50})
    const transcript=await service.from('interview_transcripts').select('status,purged_at').eq('id',transcriptId).single()
    expect(transcript.data?.purged_at).toBeNull()
    expect(transcript.data?.status).toBe('ready')
  })
})
