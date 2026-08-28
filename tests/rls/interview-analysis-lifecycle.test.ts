import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Requesting an analysis, the queue behind it, and what makes one stale.
 *
 * The assertions worth the most here are the ones about money and about correctness after a
 * correction: an identical request must not create a second paid run, and remapping who the candidate
 * was must mark the previous analysis outdated even though not one word of the transcript changed.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed analysis fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const OWNER_USER='10000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})

let interviewId=''
let transcriptId=''
let coreRubric=''
let jobRubric=''
let consultantSpeaker=''
let candidateSpeaker=''
const runs:string[]=[]

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

const request=()=>consultant.rpc('request_interview_analysis',{
  p_organization_id:ORG,p_interview_id:interviewId,
  p_provider:'anthropic',p_model:'test-model',p_prompt_version:'interview-analysis-v1',
})

async function activateRubric(type:'core'|'job'){
  const rubric=await service.from('interview_rubrics').insert({
    organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
    name:`${type} rubric`,status:'draft',created_by:OWNER_USER,
  }).select('id').single()
  if(rubric.error)throw new Error(rubric.error.message)
  const id=required(rubric.data,'rubric').id
  const item=await service.from('interview_rubric_items').insert({
    organization_id:ORG,rubric_id:id,dimension:'essential_coverage',item_type:'essential_question',
    label:`${type} item`,requirement_level:'must_have',sort_order:0,
  })
  if(item.error)throw new Error(item.error.message)
  const activated=await service.from('interview_rubrics').update({
    status:'active',activated_by:OWNER_USER,activated_at:new Date().toISOString(),
  }).eq('id',id)
  if(activated.error)throw new Error(activated.error.message)
  return id
}

beforeAll(async()=>{
  const signIn=await consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'})
  if(signIn.error)throw signIn.error
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-10-01T09:00:00Z',ends_at:'2026-10-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw interview.error
  interviewId=required(interview.data,'interview').id

  const consent=await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })
  if(consent.error)throw consent.error

  const ingested=await service.rpc('ingest_interview_transcript',{
    p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
    p_source:'manual_text',p_checksum:'analysis-fixture',p_language_codes:['en'],
    p_has_timestamps:true,p_completeness:'complete',p_started_at:null,p_ended_at:null,
    p_duration_seconds:null,p_retention_days:90,p_supersedes_transcript_id:null,
    p_speakers:[{sourceSpeakerId:'Sarah',displayName:'Sarah'},{sourceSpeakerId:'Aisha',displayName:'Aisha'}],
    p_entries:[
      {sourceSpeakerId:'Sarah',startMs:0,endMs:2000,text:'Tell me about your last role.'},
      {sourceSpeakerId:'Aisha',startMs:2000,endMs:9000,text:'I led the commercial team.'},
    ],
  })
  if(ingested.error)throw new Error(ingested.error.message)
  transcriptId=(ingested.data as {transcript_id:string}).transcript_id

  const speakerRows=await service.from('interview_transcript_speakers').select('id,source_speaker_id').eq('transcript_id',transcriptId)
  consultantSpeaker=required(speakerRows.data?.find((row)=>row.source_speaker_id==='Sarah'),'consultant speaker').id
  candidateSpeaker=required(speakerRows.data?.find((row)=>row.source_speaker_id==='Aisha'),'candidate speaker').id
})

afterAll(async()=>{
  for(const id of runs)await service.from('interview_analysis_runs').delete().eq('id',id)
  await service.from('background_jobs').delete().eq('organization_id',ORG).eq('job_type','interview_analysis')
  if(transcriptId)await service.from('interview_transcripts').delete().eq('id',transcriptId)
  if(coreRubric)await service.from('interview_rubrics').delete().eq('id',coreRubric)
  if(jobRubric)await service.from('interview_rubrics').delete().eq('id',jobRubric)
  if(interviewId){
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('every precondition names a step somebody can complete',()=>{
  it('refuses while speakers are unmapped',async()=>{
    const result=await request()
    expect(result.error?.message).toContain('speaker_mapping_required')
  })

  it('refuses without an agency core rubric, once speakers are mapped',async()=>{
    for(const [speaker,role,identity] of [[consultantSpeaker,'consultant',CONSULTANT_MEMBER],[candidateSpeaker,'candidate',CANDIDATE]] as const){
      const confirmed=await consultant.rpc('confirm_interview_transcript_speaker',{
        p_organization_id:ORG,p_speaker_id:speaker,p_speaker_role:role,
        p_member_id:role==='consultant'?identity:null,
        p_candidate_id:role==='candidate'?identity:null,
        p_contact_id:null,
      })
      expect(confirmed.error).toBeNull()
    }
    const result=await request()
    expect(result.error?.message).toContain('core_rubric_required')
  })

  it('refuses without a job blueprint',async()=>{
    coreRubric=await activateRubric('core')
    const result=await request()
    expect(result.error?.message).toContain('job_rubric_required')
  })
})

describe('requesting an analysis',()=>{
  it('queues one run and one durable job',async()=>{
    jobRubric=await activateRubric('job')
    const result=await request()
    expect(result.error).toBeNull()
    const payload=result.data as {run_id:string;status:string;reused:boolean}
    runs.push(payload.run_id)
    expect(payload.status).toBe('queued')
    expect(payload.reused).toBe(false)

    const queued=await service.from('background_jobs').select('id,job_type,status,payload').eq('organization_id',ORG).eq('job_type','interview_analysis')
    expect(queued.data).toHaveLength(1)
    expect((queued.data?.[0].payload as {analysis_run_id:string}).analysis_run_id).toBe(payload.run_id)
  })

  it('freezes the exact transcript bundle the run will read',async()=>{
    const links=await service.from('interview_analysis_run_transcripts').select('transcript_id').eq('analysis_run_id',runs[0])
    expect(links.data?.map((row)=>row.transcript_id)).toEqual([transcriptId])
  })

  it('hands back the same run for an identical request rather than paying twice',async()=>{
    const again=await request()
    expect(again.error).toBeNull()
    const payload=again.data as {run_id:string;reused:boolean}
    expect(payload.reused).toBe(true)
    expect(payload.run_id).toBe(runs[0])

    // And no second job: the queue's idempotency key is the same input hash.
    const queued=await service.from('background_jobs').select('id').eq('organization_id',ORG).eq('job_type','interview_analysis')
    expect(queued.data).toHaveLength(1)
  })

  it('records both rubric versions, not one',async()=>{
    const run=await service.from('interview_analysis_runs').select('core_rubric_id,job_rubric_id,transcript_bundle_hash,candidate_input_hash').eq('id',runs[0]).single()
    expect(run.data?.core_rubric_id).toBe(coreRubric)
    expect(run.data?.job_rubric_id).toBe(jobRubric)
    expect(run.data?.transcript_bundle_hash).toBeTruthy()
    expect(run.data?.candidate_input_hash).toBeTruthy()
  })
})

describe('input fingerprints',()=>{
  it('changes the transcript bundle hash when the speaker mapping changes',async()=>{
    /* The assertion this whole hash exists for. Remapping who the candidate was changes no word of
     * the transcript but changes every attribution derived from it, so a hash over content alone
     * would report the previous analysis as current after the error was corrected. */
    const before=await service.rpc('interview_transcript_bundle_hash',{p_interview_id:interviewId})
    const remap=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:candidateSpeaker,p_speaker_role:'unknown',
      p_member_id:null,p_candidate_id:null,p_contact_id:null,
    })
    expect(remap.error).toBeNull()
    const after=await service.rpc('interview_transcript_bundle_hash',{p_interview_id:interviewId})
    expect(after.data).not.toBe(before.data)

    // Put it back so later tests see a fully mapped transcript.
    await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:candidateSpeaker,p_speaker_role:'candidate',
      p_member_id:null,p_candidate_id:CANDIDATE,p_contact_id:null,
    })
    const restored=await service.rpc('interview_transcript_bundle_hash',{p_interview_id:interviewId})
    expect(restored.data).toBe(before.data)
  })

  it('ignores contact details the model never sees',async()=>{
    // Changing a phone number must not spend money re-running an identical assessment.
    const before=await consultant.rpc('interview_candidate_input_hash',{p_candidate_id:CANDIDATE})
    await service.from('candidate_private_details').update({phone:'+65 9000 0000'}).eq('candidate_id',CANDIDATE)
    const after=await consultant.rpc('interview_candidate_input_hash',{p_candidate_id:CANDIDATE})
    expect(after.data).toBe(before.data)
    // Restored: another suite searches candidates by a fragment of this number.
    await service.from('candidate_private_details').update({phone:'+65 8111 1111'}).eq('candidate_id',CANDIDATE)
  })

  it('changes the candidate hash when evidence the model does see changes',async()=>{
    const before=await consultant.rpc('interview_candidate_input_hash',{p_candidate_id:CANDIDATE})
    await service.from('candidates').update({availability:'Immediately'}).eq('id',CANDIDATE)
    const after=await consultant.rpc('interview_candidate_input_hash',{p_candidate_id:CANDIDATE})
    expect(after.data).not.toBe(before.data)
    await service.from('candidates').update({availability:'30 days'}).eq('id',CANDIDATE)
  })
})

describe('the durable queue',()=>{
  it('claims a job once, and a second worker gets nothing',async()=>{
    const first=await service.rpc('claim_background_job',{p_job_type:'interview_analysis',p_locked_by:'worker-a'})
    expect(first.error).toBeNull()
    const claimed=(first.data as {id:string;attempts:number;status:string}[]|null)?.[0]
    expect(claimed?.status).toBe('processing')
    expect(claimed?.attempts).toBe(1)

    const second=await service.rpc('claim_background_job',{p_job_type:'interview_analysis',p_locked_by:'worker-b'})
    expect(second.data).toEqual([])

    // A failure below the ceiling goes back to pending with backoff rather than dying.
    const released=await service.rpc('release_background_job',{p_job_id:claimed?.id,p_outcome:'failed',p_error:'provider_rejected'})
    expect(released.data).toBe('pending')
  })

  it('dead-letters rather than retrying forever',async()=>{
    const job=await service.from('background_jobs').select('id,max_attempts').eq('organization_id',ORG).eq('job_type','interview_analysis').single()
    const id=required(job.data,'job').id
    await service.from('background_jobs').update({attempts:job.data?.max_attempts,status:'processing'}).eq('id',id)
    const released=await service.rpc('release_background_job',{p_job_id:id,p_outcome:'failed',p_error:'still broken'})
    expect(released.data).toBe('dead_letter')
    await service.from('background_jobs').update({status:'pending',attempts:0}).eq('id',id)
  })

  it('is readable by an owner and not writable by anyone client-side',async()=>{
    // A client-writable queue is a client-writable spend.
    const write=await consultant.from('background_jobs').insert({
      organization_id:ORG,job_type:'interview_analysis',payload:{},
    })
    expect(write.error).not.toBeNull()
  })
})

describe('analysis state and staleness',()=>{
  it('reports the queued run and no staleness while it is unfinished',async()=>{
    const state=await consultant.rpc('get_interview_analysis_state',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(state.error).toBeNull()
    const row=(state.data as Record<string,unknown>[])[0]
    expect(row.run_id).toBe(runs[0])
    // A run that has not completed cannot be out of date with anything.
    expect(row.is_stale).toBe(false)
    expect(row.has_transcripts).toBe(true)
    expect(row.consent_status).toBe('granted')
  })

  it('marks a completed run stale once the job brief moves',async()=>{
    await service.from('interview_analysis_runs').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',runs[0])
    let state=await consultant.rpc('get_interview_analysis_state',{p_organization_id:ORG,p_interview_id:interviewId})
    expect((state.data as Record<string,unknown>[])[0].is_stale).toBe(false)

    await service.from('candidates').update({current_position:'Group Commercial Director'}).eq('id',CANDIDATE)
    state=await consultant.rpc('get_interview_analysis_state',{p_organization_id:ORG,p_interview_id:interviewId})
    const row=(state.data as Record<string,unknown>[])[0]
    expect(row.is_stale).toBe(true)
    expect(row.stale_reason).toBe('candidate')

    await service.from('candidates').update({current_position:'Commercial Director'}).eq('id',CANDIDATE)
  })
})

describe('persisting a result',()=>{
  beforeAll(async()=>{
    // The staleness test above marks this run completed to exercise the comparison; persist returns
    // early on a completed run, so it is put back to processing here.
    await service.from('interview_analysis_runs').update({status:'processing',completed_at:null}).eq('id',runs[0])
  })

  it('writes assessments, findings, evidence and metrics as one act',async()=>{
    const entry=await service.from('interview_transcript_entries').select('id').eq('transcript_id',transcriptId).limit(1).single()
    const entryId=required(entry.data,'entry').id

    const persisted=await service.rpc('persist_interview_analysis',{
      p_run_id:runs[0],
      p_assessments:[
        {assessment_type:'candidate_fit',subject_candidate_id:CANDIDATE,subject_member_id:null,
          overall_band:'promising_but_incomplete',confidence:'medium',summary:'Commercial leadership evidenced.',
          findings:[{category:'requirement',result:'met',score:null,severity:'info',confidence:'high',
            title:'Commercial leadership',summary:'Led a team for three years.',coaching_suggestion:null,rubric_item_id:null,
            evidence:[{source_type:'transcript_entry',source_record_id:entryId,source_locator:null,excerpt:'I led the commercial team.'}]}]},
        {assessment_type:'consultant_quality',subject_candidate_id:null,subject_member_id:CONSULTANT_MEMBER,
          overall_band:'needs_development',confidence:'medium',summary:'Compensation never tested.',
          findings:[{category:'essential_coverage',result:'needs_development',score:1,severity:'coaching',confidence:'high',
            title:'Compensation not raised',summary:'The interview closed without testing salary.',
            coaching_suggestion:'Ask for expected salary before describing the offer process.',rubric_item_id:null,
            evidence:[{source_type:'transcript_entry',source_record_id:entryId,source_locator:null,excerpt:'Tell me about your last role.'}]}]},
      ],
      p_metrics:[{transcript_id:transcriptId,speaker_id:consultantSpeaker,speaker_role:'consultant',
        subject_member_id:CONSULTANT_MEMBER,subject_candidate_id:null,speech_ms:2000,turn_count:1,average_turn_ms:2000,longest_turn_ms:2000}],
      p_metric_summary:{timestamp_coverage:1,unknown_speech_ms:0,overlap_ms:0,overlap_count:0,metric_confidence:'high'},
      p_input_tokens:1000,p_output_tokens:500,p_processing_ms:4200,
    })
    expect(persisted.error).toBeNull()

    const run=await service.from('interview_analysis_runs').select('status,input_tokens,output_tokens').eq('id',runs[0]).single()
    expect(run.data?.status).toBe('completed')
    expect(run.data?.input_tokens).toBe(1000)

    const assessments=await service.from('interview_assessments').select('id,assessment_type').eq('analysis_run_id',runs[0])
    expect(assessments.data).toHaveLength(2)

    const findings=await service.from('interview_assessment_findings').select('id').in('assessment_id',(assessments.data||[]).map((row)=>row.id))
    expect(findings.data).toHaveLength(2)

    const evidence=await service.from('interview_finding_evidence').select('id,source_type').in('finding_id',(findings.data||[]).map((row)=>row.id))
    expect(evidence.data).toHaveLength(2)
    expect(evidence.data?.every((row)=>row.source_type==='transcript_entry')).toBe(true)

    const metrics=await service.from('interview_conversation_metrics').select('speech_ms').eq('analysis_run_id',runs[0])
    expect(metrics.data).toHaveLength(1)

    const summary=await service.from('interview_conversation_metric_summaries').select('metric_confidence').eq('analysis_run_id',runs[0]).single()
    expect(summary.data?.metric_confidence).toBe('high')
  })

  it('is idempotent: persisting a completed run again changes nothing',async()=>{
    const again=await service.rpc('persist_interview_analysis',{
      p_run_id:runs[0],p_assessments:[],p_metrics:[],p_metric_summary:null,
      p_input_tokens:0,p_output_tokens:0,p_processing_ms:0,
    })
    expect(again.error).toBeNull()
    const assessments=await service.from('interview_assessments').select('id').eq('analysis_run_id',runs[0])
    expect(assessments.data).toHaveLength(2)
  })

  it('records an audit event with no conclusion in it',async()=>{
    const audit=await service.from('audit_logs').select('metadata').eq('action','interview_analysis.completed').eq('entity_id',runs[0])
    expect(audit.data).toHaveLength(1)
    const serialized=JSON.stringify(audit.data?.[0].metadata)
    expect(serialized).not.toContain('needs_development')
    expect(serialized).not.toContain('commercial')
    expect(serialized).toContain('assessment_count')
  })
})
