import {FunctionError,serviceClient} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {isAuthorized} from '../scheduled-maintenance/authorization.ts'
import {providerBillingExhausted} from '../_shared/provider-outage.ts'
import {computeConversationMetrics,type MetricInputEntry,type SpeakerRole} from '../_shared/interview-metrics.ts'
import {
  AnalysisValidationError,
  validateAnalysisOutput,
  type AnalysisSourceManifest,
  type InterviewAnalysisOutput,
} from '../_shared/interview-analysis-schema.ts'
import {
  buildAnalysisUserMessage,
  INTERVIEW_ANALYSIS_SYSTEM_PROMPT,
  type AnalysisSourcePayload,
} from '../_shared/interview-analysis-prompt.ts'

/* The analysis worker.
 *
 * Runs entirely on the service role: it is not reachable by a user, and the run it processes was
 * authorised when it was queued. Authentication is the same worker-secret contract
 * scheduled-maintenance uses, for the same reason -- this spends money and reads candidate speech, so
 * a misconfiguration must fail loudly rather than let an unauthenticated caller trigger it.
 *
 * The order of operations matters. Deterministic metrics are computed from the transcript before the
 * model is called, and are stored whether or not the semantic half succeeds in a later run: they are
 * arithmetic over timestamps and owe nothing to the provider. The model's output is then validated
 * against a manifest of the ids actually sent, so a citation of anything else fails the run.
 */

const PAGE_SIZE=200
const MAX_ENTRIES=6000
const MAX_JOBS_PER_INVOCATION=3

type Admin=ReturnType<typeof serviceClient>

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  try{
    authorize(request)
    const admin=adminClient()
    const processed:string[]=[]

    /* A small batch per invocation rather than draining the queue: a runaway loop here is a runaway
     * bill, and the nudge plus the scheduled drain together get through a backlog safely. */
    for(let index=0;index<MAX_JOBS_PER_INVOCATION;index+=1){
      const claim=await admin.rpc('claim_background_job',{p_job_type:'interview_analysis',p_locked_by:`worker:${requestID}`})
      if(claim.error)throw new FunctionError(500,'claim_failed',claim.error.message)
      const job=(claim.data as {id:string;payload:{analysis_run_id?:string}}[]|null)?.[0]
      if(!job)break

      const runId=job.payload?.analysis_run_id
      if(!runId){
        await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'failed',p_error:'missing analysis_run_id'})
        continue
      }

      try{
        await processRun(admin,runId,requestID)
        await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'completed',p_error:null})
        processed.push(runId)
      }catch(error){
        const failure=describeFailure(error)
        /* The run and the job fail separately on purpose. The run is what a consultant sees, so it
         * carries a safe code immediately; the job decides on its own whether a retry is worth it. */
        await admin.rpc('fail_interview_analysis',{p_run_id:runId,p_error_code:failure.code,p_error_message:failure.message})
        const outcome=await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'failed',p_error:failure.code})
        log('error','interview_analysis_failed',{requestId:requestID,runId,code:failure.code,jobOutcome:outcome.data})
      }
    }

    return json(request,{processed:processed.length,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error','The analysis worker failed.')
    log('error','interview_analysis_worker_failed',{requestId:requestID,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

function authorize(request:Request){
  const ok=isAuthorized(request.headers,{
    workerSecret:Deno.env.get('WORKER_SECRET')??null,
    serviceRoleKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??null,
  })
  if(!ok)throw new FunctionError(401,'worker_authentication_required','Worker authentication required.')
}

function adminClient():Admin{
  return serviceClient()
}

async function processRun(admin:Admin,runId:string,requestID:string){
  const started=Date.now()

  const runResult=await admin.from('interview_analysis_runs')
    .select('id,organization_id,interview_id,job_candidate_id,core_rubric_id,job_rubric_id,model,status')
    .eq('id',runId).maybeSingle()
  if(runResult.error||!runResult.data)throw new FunctionError(404,'analysis_run_not_found','That analysis run no longer exists.')
  const run=runResult.data as Record<string,string>
  if(run.status==='completed')return

  await admin.from('interview_analysis_runs').update({status:'processing',started_at:new Date().toISOString()}).eq('id',runId)

  // The exact bundle frozen at request time, not whatever is current now.
  const links=await admin.from('interview_analysis_run_transcripts').select('transcript_id,sort_order').eq('analysis_run_id',runId).order('sort_order')
  if(links.error)throw new FunctionError(500,'transcript_bundle_unreadable','The transcript bundle could not be read.')
  const transcriptIds=(links.data||[]).map((row)=>String(row.transcript_id))
  if(transcriptIds.length===0)throw new FunctionError(422,'transcript_required','This analysis has no transcript.')

  const speakers=await loadSpeakers(admin,transcriptIds)
  const entries=await loadEntries(admin,transcriptIds)
  if(entries.length===0)throw new FunctionError(422,'transcript_empty','This transcript has no lines.')

  const metrics=computeConversationMetrics(entries.map((entry)=>({
    speakerId:entry.speaker_id,
    speakerRole:(speakers.get(entry.speaker_id)?.speaker_role??'unknown') as SpeakerRole,
    sequenceNumber:entry.sequence_number,
    startMs:entry.start_ms,
    endMs:entry.end_ms,
  } satisfies MetricInputEntry)))

  const {job,candidate,rubricItems,cvRows,atsFields}=await loadSources(admin,run)

  const consultants=[...speakers.values()]
    .filter((speaker)=>speaker.speaker_role==='consultant'&&speaker.member_id)
    .map((speaker)=>({member_id:String(speaker.member_id),display_name:speaker.display_name||speaker.source_speaker_id||'Consultant'}))
  if(consultants.length===0)throw new FunctionError(422,'consultant_mapping_required','No consultant was mapped on this transcript.')

  const payload:AnalysisSourcePayload={
    job_brief:{job_id:String(job.id),title:String(job.title??''),description:job.description as string|null,
      requirements:job.requirements as string|null,location:job.location as string|null,employment_type:job.employment_type as string|null},
    rubrics:{core:rubricItems.core,job:rubricItems.job},
    candidate_evidence:{cv:cvRows,ats_fields:atsFields},
    consultants,
    transcript:entries.map((entry)=>({
      entry_id:entry.id,
      speaker:speakers.get(entry.speaker_id)?.display_name||speakers.get(entry.speaker_id)?.source_speaker_id||'unknown',
      speaker_role:speakers.get(entry.speaker_id)?.speaker_role??'unknown',
      start_ms:entry.start_ms,end_ms:entry.end_ms,text:entry.text,
    })),
    conversation_metrics:metrics.summary,
  }

  const manifest:AnalysisSourceManifest={
    transcriptEntryIds:new Set(entries.map((entry)=>entry.id)),
    candidateCvSourceIds:new Set(cvRows.map((row)=>String((row as {id:string}).id))),
    candidateFieldNames:new Set(Object.keys(atsFields)),
    rubricItemIds:new Set([...rubricItems.core,...rubricItems.job].map((item)=>String((item as {id:string}).id))),
    consultantMemberIds:new Set(consultants.map((entry)=>entry.member_id)),
    jobId:String(job.id),
  }

  const completion=await callProvider(payload,String(run.model))
  /* Retried once, then failed visibly. A model that returns malformed structure twice is a contract
   * problem to look at, not something to keep paying to re-roll. */
  let validated:InterviewAnalysisOutput
  try{validated=validateAnalysisOutput(completion.value,manifest)}
  catch(first){
    if(!(first instanceof AnalysisValidationError))throw first
    log('warn','interview_analysis_output_retry',{requestId:requestID,runId,code:first.code,detailCount:first.details.length})
    const retry=await callProvider(payload,String(run.model))
    validated=validateAnalysisOutput(retry.value,manifest)
    completion.inputTokens=(completion.inputTokens??0)+(retry.inputTokens??0)
    completion.outputTokens=(completion.outputTokens??0)+(retry.outputTokens??0)
  }

  const persisted=await admin.rpc('persist_interview_analysis',{
    p_run_id:runId,
    p_assessments:toAssessments(validated,String(candidate.id)),
    p_metrics:toMetrics(metrics,speakers,transcriptIds[0]),
    p_metric_summary:{
      timestamp_coverage:metrics.summary.timestampCoverage,
      unknown_speech_ms:metrics.summary.unknownSpeechMs,
      overlap_ms:metrics.summary.overlapMs,
      overlap_count:metrics.summary.overlapCount,
      metric_confidence:metrics.summary.metricConfidence,
    },
    p_input_tokens:completion.inputTokens,
    p_output_tokens:completion.outputTokens,
    p_processing_ms:Date.now()-started,
  })
  if(persisted.error)throw new FunctionError(500,'analysis_persistence_failed',persisted.error.message)

  // Identifiers and counts. Never a band, a summary, or a line of transcript.
  log('info','interview_analysis_completed',{
    requestId:requestID,runId,organizationId:run.organization_id,interviewId:run.interview_id,
    consultantCount:validated.consultants.length,candidateFindingCount:validated.candidate.findings.length,
    entryCount:entries.length,metricConfidence:metrics.summary.metricConfidence,durationMs:Date.now()-started,
  })
}

async function loadSpeakers(admin:Admin,transcriptIds:string[]){
  const result=await admin.from('interview_transcript_speakers')
    .select('id,transcript_id,source_speaker_id,display_name,speaker_role,member_id,candidate_id')
    .in('transcript_id',transcriptIds)
  if(result.error)throw new FunctionError(500,'transcript_bundle_unreadable','The transcript speakers could not be read.')
  const map=new Map<string,Record<string,string|null>>()
  for(const row of result.data||[])map.set(String(row.id),row as Record<string,string|null>)
  return map
}

/* Paged rather than fetched whole. A long interview is thousands of rows, and an unbounded select is
 * the difference between a worker that handles a two-hour panel and one that dies on it. */
async function loadEntries(admin:Admin,transcriptIds:string[]){
  const collected:{id:string;speaker_id:string;sequence_number:number;start_ms:number|null;end_ms:number|null;text:string}[]=[]
  for(const transcriptId of transcriptIds){
    let after=-1
    for(;;){
      const page=await admin.from('interview_transcript_entries')
        .select('id,speaker_id,sequence_number,start_ms,end_ms,text')
        .eq('transcript_id',transcriptId).gt('sequence_number',after)
        .order('sequence_number').limit(PAGE_SIZE)
      if(page.error)throw new FunctionError(500,'transcript_bundle_unreadable','The transcript could not be read.')
      const rows=(page.data||[]) as typeof collected
      collected.push(...rows)
      if(rows.length<PAGE_SIZE)break
      after=rows[rows.length-1].sequence_number
      if(collected.length>=MAX_ENTRIES)throw new FunctionError(413,'transcript_too_long','This transcript is too long to analyse in one run.')
    }
  }
  return collected
}

/* Candidate evidence, minus everything the model has no business seeing. Email, phone, address, date
 * of birth and photo are never assembled here at all -- not filtered later, simply never read. */
async function loadSources(admin:Admin,run:Record<string,string>){
  const jobCandidate=await admin.from('job_candidates').select('candidate_id,job_id').eq('id',run.job_candidate_id).maybeSingle()
  if(jobCandidate.error||!jobCandidate.data)throw new FunctionError(404,'candidate_not_found','The candidate could not be read.')

  const [jobRow,candidateRow,privateRow,employment,coreItems,jobItems]=await Promise.all([
    admin.from('jobs').select('id,title,description,requirements,location,employment_type').eq('id',jobCandidate.data.job_id).maybeSingle(),
    admin.from('candidates').select('id,full_name,current_company,current_position,location,availability,notice_period_days').eq('id',jobCandidate.data.candidate_id).maybeSingle(),
    admin.from('candidate_private_details').select('work_authorization').eq('candidate_id',jobCandidate.data.candidate_id).maybeSingle(),
    admin.from('candidate_employment').select('id,company_name,title,location,started_on,ended_on,is_current,summary').eq('candidate_id',jobCandidate.data.candidate_id).order('sort_order'),
    admin.from('interview_rubric_items').select('id,dimension,item_type,label,question_text,evidence_expected,requirement_level').eq('rubric_id',run.core_rubric_id).order('sort_order'),
    admin.from('interview_rubric_items').select('id,dimension,item_type,label,question_text,evidence_expected,requirement_level').eq('rubric_id',run.job_rubric_id).order('sort_order'),
  ])
  if(jobRow.error||!jobRow.data)throw new FunctionError(404,'job_not_found','The job could not be read.')
  if(candidateRow.error||!candidateRow.data)throw new FunctionError(404,'candidate_not_found','The candidate could not be read.')

  const candidate=candidateRow.data as Record<string,unknown>
  return {
    job:jobRow.data as Record<string,unknown>,
    candidate,
    rubricItems:{core:(coreItems.data||[]) as unknown[],job:(jobItems.data||[]) as unknown[]},
    cvRows:(employment.data||[]) as unknown[],
    // Keyed by the exact locator the validator will accept, so a citation of "availability" resolves
    // and a citation of anything else does not.
    atsFields:{
      availability:(candidate.availability as string|null)??null,
      notice_period_days:candidate.notice_period_days===null||candidate.notice_period_days===undefined?null:String(candidate.notice_period_days),
      current_position:(candidate.current_position as string|null)??null,
      current_company:(candidate.current_company as string|null)??null,
      location:(candidate.location as string|null)??null,
      work_authorization:(privateRow.data?.work_authorization as string|null)??null,
    } as Record<string,string|null>,
  }
}

async function callProvider(payload:AnalysisSourcePayload,model:string){
  const response=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'x-api-key':Deno.env.get('ANTHROPIC_API_KEY')||'','anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({
      model,max_tokens:16000,thinking:{type:'disabled'},
      system:INTERVIEW_ANALYSIS_SYSTEM_PROMPT,
      // No tools. The model has nothing to call, so an instruction inside a transcript has nothing to
      // reach even if it were followed.
      messages:[{role:'user',content:[{type:'text',text:buildAnalysisUserMessage(payload)}]}],
    }),
  })
  const body=await response.json().catch(()=>null) as {content?:{type:string;text?:string}[];usage?:{input_tokens?:number;output_tokens?:number};error?:{message?:string}}|null
  if(!response.ok){
    const message=body?.error?.message||`The analysis provider returned ${response.status}.`
    if(providerBillingExhausted(message))throw new FunctionError(503,'provider_billing_exhausted','The AI provider balance is exhausted.')
    throw new FunctionError(502,'provider_rejected',message)
  }
  const text=body?.content?.find((item)=>item.type==='text')?.text
  if(!text)throw new FunctionError(502,'empty_result','The analysis provider returned no result.')
  let value:unknown
  try{value=JSON.parse(stripFence(text))}
  catch{throw new FunctionError(502,'malformed_output','The analysis provider returned unreadable output.')}
  return {value,inputTokens:body?.usage?.input_tokens??null,outputTokens:body?.usage?.output_tokens??null}
}

function stripFence(text:string){
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced?fenced[1]:text).trim()
}

/* Maps the validated output onto the storage shape.
 *
 * The candidate's summary lists (strongest evidence, missing information, contradictions,
 * verification steps) are stored as info-severity findings under their own category rather than
 * flattened into the summary text, so the drawer can render each group and a later query can count
 * them. `coaching_suggestion` carries the verification question on a candidate finding -- the column
 * means "what to do next about this finding", which is coaching for a consultant and a question to
 * ask for a candidate.
 */
function toAssessments(output:InterviewAnalysisOutput,candidateId:string){
  const candidateFindings=[
    ...output.candidate.findings.map((finding)=>({
      category:'requirement',result:finding.result,score:null,severity:finding.result==='contradicted'?'attention':'info',
      confidence:finding.confidence,title:finding.requirement,summary:finding.explanation,
      coaching_suggestion:finding.verification_question,rubric_item_id:finding.rubric_item_id,
      evidence:finding.evidence,
    })),
    ...listFindings('strongest_evidence',output.candidate.strongest_evidence),
    ...listFindings('missing_information',output.candidate.missing_information),
    ...listFindings('contradiction',output.candidate.contradictions),
    ...listFindings('recommended_verification',output.candidate.recommended_verification),
  ]

  return [
    {
      assessment_type:'candidate_fit',
      subject_candidate_id:candidateId,
      subject_member_id:null,
      overall_band:output.candidate.overall_band,
      confidence:output.candidate.confidence,
      summary:output.candidate.summary,
      findings:candidateFindings,
    },
    ...output.consultants.map((consultant)=>({
      assessment_type:'consultant_quality',
      subject_candidate_id:null,
      subject_member_id:consultant.subject_member_id,
      overall_band:consultant.overall_band,
      confidence:consultant.confidence,
      summary:consultant.summary,
      findings:consultant.findings.map((finding)=>({
        category:finding.dimension,result:finding.result,score:finding.score,severity:finding.severity,
        confidence:finding.confidence,title:finding.title,summary:finding.summary,
        coaching_suggestion:finding.coaching_suggestion,rubric_item_id:finding.rubric_item_id,
        evidence:finding.evidence,
      })),
    })),
  ]
}

function listFindings(category:string,items:string[]){
  return items.map((item)=>({
    category,result:'observation',score:null,severity:'info',confidence:'medium',
    title:item.slice(0,300),summary:item,coaching_suggestion:null,rubric_item_id:null,evidence:[],
  }))
}

function toMetrics(
  metrics:ReturnType<typeof computeConversationMetrics>,
  speakers:Map<string,Record<string,string|null>>,
  fallbackTranscriptId:string,
){
  return metrics.speakers.map((speaker)=>{
    const source=speakers.get(speaker.speakerId)
    return {
      transcript_id:source?.transcript_id??fallbackTranscriptId,
      speaker_id:speaker.speakerId,
      speaker_role:speaker.speakerRole,
      subject_member_id:source?.member_id??null,
      subject_candidate_id:source?.candidate_id??null,
      speech_ms:speaker.speechMs,
      turn_count:speaker.turnCount,
      average_turn_ms:speaker.averageTurnMs,
      longest_turn_ms:speaker.longestTurnMs,
    }
  })
}

function describeFailure(error:unknown):{code:string;message:string}{
  if(error instanceof AnalysisValidationError)return {code:error.code,message:'The analysis did not meet the required evidence contract.'}
  if(error instanceof FunctionError)return {code:error.code,message:error.message}
  return {code:'unexpected_error',message:'The analysis failed.'}
}
