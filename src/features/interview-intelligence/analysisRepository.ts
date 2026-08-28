import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'

/* Reading a completed analysis.
 *
 * Everything here is read-only. Machine output has no client write path at all -- the tables carry
 * read policies and no insert or update policy -- so there is deliberately no "edit finding" function
 * in this file to be reached for later.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'analysis_error',error)
}

export type AssessmentType='candidate_fit'|'consultant_quality'
export type Confidence='low'|'medium'|'high'
export type Severity='info'|'coaching'|'attention'|'critical'

export interface AnalysisState {
  runId:string|null
  status:string|null
  createdAt:string|null
  completedAt:string|null
  errorCode:string|null
  isStale:boolean
  staleReason:string|null
  hasTranscripts:boolean
  consentStatus:string|null
}

export interface AnalysisEvidence {
  id:string
  sourceType:'transcript_entry'|'candidate_cv'|'candidate_field'|'job_brief'
  sourceRecordId:string|null
  sourceLocator:string|null
  excerpt:string|null
}

export interface AnalysisFinding {
  id:string
  category:string
  result:string
  score:number|null
  severity:Severity
  confidence:Confidence
  title:string
  summary:string
  coachingSuggestion:string|null
  evidence:AnalysisEvidence[]
}

export interface Assessment {
  id:string
  assessmentType:AssessmentType
  subjectMemberId:string|null
  subjectCandidateId:string|null
  overallBand:string
  confidence:Confidence
  summary:string
  findings:AnalysisFinding[]
}

export interface SpeakerMetric {
  speakerId:string
  speakerRole:string
  subjectMemberId:string|null
  speechMs:number
  turnCount:number
  averageTurnMs:number|null
  longestTurnMs:number|null
}

export interface MetricSummary {
  timestampCoverage:number
  unknownSpeechMs:number
  overlapMs:number
  overlapCount:number
  metricConfidence:Confidence
}

export async function getAnalysisState(organizationId:string,interviewId:string):Promise<AnalysisState|null>{
  const {data,error}=await supabase.rpc('get_interview_analysis_state',{p_organization_id:organizationId,p_interview_id:interviewId})
  if(error)fail(error,'Could not load the interview analysis.')
  const row=data?.[0]
  if(!row)return null
  return {
    runId:row.run_id,status:row.status,createdAt:row.created_at,completedAt:row.completed_at,
    errorCode:row.error_code,isStale:Boolean(row.is_stale),staleReason:row.stale_reason,
    hasTranscripts:Boolean(row.has_transcripts),consentStatus:row.consent_status,
  }
}

/* One nested read rather than three round trips. RLS decides what comes back: a consultant-quality
 * assessment simply does not appear for somebody who may not see it, so the caller never has to
 * filter, and cannot forget to. */
export async function listAssessments(runId:string):Promise<Assessment[]>{
  const {data,error}=await supabase.from('interview_assessments')
    .select(`id,assessment_type,subject_member_id,subject_candidate_id,overall_band,confidence,summary,
      interview_assessment_findings(id,category,result,score,severity,confidence,title,summary,coaching_suggestion,sort_order,
        interview_finding_evidence(id,source_type,source_record_id,source_locator,excerpt))`)
    .eq('analysis_run_id',runId)
  if(error)fail(error,'Could not load the analysis findings.')

  return (data||[]).map((row)=>({
    id:row.id,
    assessmentType:row.assessment_type as AssessmentType,
    subjectMemberId:row.subject_member_id,
    subjectCandidateId:row.subject_candidate_id,
    overallBand:row.overall_band,
    confidence:row.confidence as Confidence,
    summary:row.summary,
    findings:(row.interview_assessment_findings||[])
      .slice()
      .sort((left,right)=>(left.sort_order??0)-(right.sort_order??0))
      .map((finding)=>({
        id:finding.id,
        category:finding.category,
        result:finding.result,
        score:finding.score,
        severity:finding.severity as Severity,
        confidence:finding.confidence as Confidence,
        title:finding.title,
        summary:finding.summary,
        coachingSuggestion:finding.coaching_suggestion,
        evidence:(finding.interview_finding_evidence||[]).map((evidence)=>({
          id:evidence.id,
          sourceType:evidence.source_type as AnalysisEvidence['sourceType'],
          sourceRecordId:evidence.source_record_id,
          sourceLocator:evidence.source_locator,
          excerpt:evidence.excerpt,
        })),
      })),
  }))
}

export async function getConversationMetrics(runId:string):Promise<{speakers:SpeakerMetric[];summary:MetricSummary|null}>{
  const [speakers,summary]=await Promise.all([
    supabase.from('interview_conversation_metrics')
      .select('speaker_id,speaker_role,subject_member_id,speech_ms,turn_count,average_turn_ms,longest_turn_ms')
      .eq('analysis_run_id',runId),
    supabase.from('interview_conversation_metric_summaries')
      .select('timestamp_coverage,unknown_speech_ms,overlap_ms,overlap_count,metric_confidence')
      .eq('analysis_run_id',runId).maybeSingle(),
  ])
  if(speakers.error)fail(speakers.error,'Could not load the conversation metrics.')

  return {
    speakers:(speakers.data||[]).map((row)=>({
      speakerId:row.speaker_id,
      speakerRole:row.speaker_role,
      subjectMemberId:row.subject_member_id,
      speechMs:row.speech_ms,
      turnCount:row.turn_count,
      averageTurnMs:row.average_turn_ms,
      longestTurnMs:row.longest_turn_ms,
    })),
    summary:summary.data?{
      timestampCoverage:Number(summary.data.timestamp_coverage),
      unknownSpeechMs:summary.data.unknown_speech_ms,
      overlapMs:summary.data.overlap_ms,
      overlapCount:summary.data.overlap_count,
      metricConfidence:summary.data.metric_confidence as Confidence,
    }:null,
  }
}

export async function requestAnalysis(organizationId:string,interviewId:string){
  const {data,error}=await supabase.functions.invoke('request-interview-analysis',{body:{organizationId,interviewId}})
  if(error)throw new AppError(error.message,'function_error',error)
  const failure=(data as {error?:{message?:string;code?:string}})?.error
  if(failure)throw new AppError(failure.message||'Could not request an analysis.',failure.code||'function_error',data)
  return data as {runId:string;status:string;reused:boolean}
}

export interface CandidateEvidenceEntry {
  assessmentId:string
  interviewId:string
  interviewAt:string|null
  jobTitle:string|null
  overallBand:string
  confidence:Confidence
  summary:string
  requirements:{id:string;title:string;result:string}[]
  contradictions:string[]
  missingInformation:string[]
  verification:string[]
}

/* Candidate-fit assessments for one candidate, newest first.
 *
 * Deliberately does not ask for consultant_quality. RLS would refuse it, but a query that never
 * requests it cannot leak it through a future policy change either -- and coaching about the
 * interviewer has no place on the interviewee's record regardless of who is looking.
 */
export async function listCandidateInterviewEvidence(organizationId:string,candidateId:string,limit=10):Promise<CandidateEvidenceEntry[]>{
  const {data,error}=await supabase.from('interview_assessments')
    .select(`id,interview_id,overall_band,confidence,summary,created_at,
      interviews(starts_at,job_candidates(jobs(title))),
      interview_assessment_findings(id,category,result,title,summary,sort_order)`)
    .eq('organization_id',organizationId)
    .eq('assessment_type','candidate_fit')
    .eq('subject_candidate_id',candidateId)
    .order('created_at',{ascending:false})
    .limit(limit)
  if(error)fail(error,'Could not load the interview evidence.')

  return (data||[]).map((row)=>{
    const findings=(row.interview_assessment_findings||[]).slice().sort((left,right)=>(left.sort_order??0)-(right.sort_order??0))
    const byCategory=(category:string)=>findings.filter((finding)=>finding.category===category).map((finding)=>finding.summary)
    const interview=row.interviews as {starts_at?:string;job_candidates?:{jobs?:{title?:string}}}|null
    return {
      assessmentId:row.id,
      interviewId:row.interview_id,
      interviewAt:interview?.starts_at??null,
      jobTitle:interview?.job_candidates?.jobs?.title??null,
      overallBand:row.overall_band,
      confidence:row.confidence as Confidence,
      summary:row.summary,
      requirements:findings.filter((finding)=>finding.category==='requirement')
        .map((finding)=>({id:finding.id,title:finding.title,result:finding.result})),
      contradictions:byCategory('contradiction'),
      missingInformation:byCategory('missing_information'),
      verification:byCategory('recommended_verification'),
    }
  })
}
