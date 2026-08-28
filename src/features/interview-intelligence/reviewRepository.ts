import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'

/* Release A1: reading and writing the human layer around an analysis.
 *
 * Every write here is an insert or a status move through an audited RPC. There is deliberately no
 * function that edits a finding, because no such path exists in the database either -- the machine
 * output is read-only to every client role, and this file should not look like it might not be.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'review_error',error)
}

export type FeedbackType='reviewed'|'agreed'|'disagreed'|'discussed'|'consultant_context'
export type FeedbackVisibility='subject_and_reviewers'|'reviewers_only'
export type CoachingStatus='open'|'acknowledged'|'completed'|'cancelled'
export type CoachingOutcome='acknowledged'|'completed'|'cancelled'

export interface FeedbackEntry {
  id:string
  assessmentId:string
  findingId:string|null
  actorMemberId:string
  feedbackType:FeedbackType
  note:string|null
  visibility:FeedbackVisibility
  createdAt:string
}

export interface CoachingAction {
  id:string
  assessmentId:string
  findingId:string|null
  assignedToMemberId:string
  assignedByMemberId:string
  actionText:string
  status:CoachingStatus
  dueAt:string|null
  acknowledgedAt:string|null
  completedAt:string|null
  consultantResponse:string|null
  createdAt:string
}

export interface AttentionItem {
  findingId:string
  assessmentId:string
  interviewId:string
  jobCandidateId:string
  subjectMemberId:string|null
  severity:string
  title:string
  summary:string
  createdAt:string
  hasOpenCoaching:boolean
}

export interface TodayInterviewItem {
  kind:'consent_missing'|'mapping_required'|'analysis_failed'|'coaching_open'|'attention_finding'
  interviewId:string|null
  jobCandidateId:string|null
  referenceId:string|null
  headline:string
  occurredAt:string|null
  audience:'consultant'|'reviewer'
}

/* RLS already removes reviewers_only notes for the subject, so the caller never filters and cannot
 * forget to. */
export async function listFeedback(assessmentId:string):Promise<FeedbackEntry[]>{
  const {data,error}=await supabase.from('interview_assessment_feedback')
    .select('id,assessment_id,finding_id,actor_member_id,feedback_type,note,visibility,created_at')
    .eq('assessment_id',assessmentId).order('created_at',{ascending:false})
  if(error)fail(error,'Could not load the review history.')
  return (data||[]).map((row)=>({
    id:row.id,assessmentId:row.assessment_id,findingId:row.finding_id,actorMemberId:row.actor_member_id,
    feedbackType:row.feedback_type as FeedbackType,note:row.note,
    visibility:row.visibility as FeedbackVisibility,createdAt:row.created_at,
  }))
}

export async function recordFeedback(input:{
  organizationId:string
  assessmentId:string
  feedbackType:FeedbackType
  findingId?:string|null
  note?:string|null
  visibility?:FeedbackVisibility
}):Promise<string>{
  const {data,error}=await supabase.rpc('record_interview_feedback',{
    p_organization_id:input.organizationId,
    p_assessment_id:input.assessmentId,
    p_feedback_type:input.feedbackType,
    p_finding_id:input.findingId??undefined,
    p_note:input.note??undefined,
    p_visibility:input.visibility??'subject_and_reviewers',
  })
  if(error)fail(error,'Could not record the review.')
  return data as string
}

export async function listCoachingActions(assessmentId:string):Promise<CoachingAction[]>{
  const {data,error}=await supabase.from('interview_coaching_actions')
    .select('id,assessment_id,finding_id,assigned_to_member_id,assigned_by_member_id,action_text,status,due_at,acknowledged_at,completed_at,consultant_response,created_at')
    .eq('assessment_id',assessmentId).order('created_at',{ascending:false})
  if(error)fail(error,'Could not load the coaching actions.')
  return (data||[]).map(mapCoaching)
}

/* The consultant's own open coaching, wherever it came from. Bounded because it renders in a panel,
 * not a report. */
export async function listMyCoaching(memberId:string,limit=20):Promise<CoachingAction[]>{
  const {data,error}=await supabase.from('interview_coaching_actions')
    .select('id,assessment_id,finding_id,assigned_to_member_id,assigned_by_member_id,action_text,status,due_at,acknowledged_at,completed_at,consultant_response,created_at')
    .eq('assigned_to_member_id',memberId).in('status',['open','acknowledged'])
    .order('due_at',{nullsFirst:false}).limit(limit)
  if(error)fail(error,'Could not load your coaching actions.')
  return (data||[]).map(mapCoaching)
}

function mapCoaching(row:Record<string,unknown>):CoachingAction{
  return {
    id:String(row.id),
    assessmentId:String(row.assessment_id),
    findingId:(row.finding_id as string|null)??null,
    assignedToMemberId:String(row.assigned_to_member_id),
    assignedByMemberId:String(row.assigned_by_member_id),
    actionText:String(row.action_text),
    status:row.status as CoachingStatus,
    dueAt:(row.due_at as string|null)??null,
    acknowledgedAt:(row.acknowledged_at as string|null)??null,
    completedAt:(row.completed_at as string|null)??null,
    consultantResponse:(row.consultant_response as string|null)??null,
    createdAt:String(row.created_at),
  }
}

export async function assignCoaching(input:{
  organizationId:string
  assessmentId:string
  actionText:string
  findingId?:string|null
  dueAt?:string|null
}):Promise<string>{
  const {data,error}=await supabase.rpc('assign_interview_coaching',{
    p_organization_id:input.organizationId,
    p_assessment_id:input.assessmentId,
    p_action_text:input.actionText,
    p_finding_id:input.findingId??undefined,
    p_due_at:input.dueAt??undefined,
  })
  if(error)fail(error,'Could not assign the coaching action.')
  return data as string
}

export async function respondToCoaching(input:{
  organizationId:string
  actionId:string
  outcome:CoachingOutcome
  response?:string|null
}):Promise<string>{
  const {data,error}=await supabase.rpc('respond_to_interview_coaching',{
    p_organization_id:input.organizationId,
    p_action_id:input.actionId,
    p_outcome:input.outcome,
    p_response:input.response??undefined,
  })
  if(error)fail(error,'Could not update the coaching action.')
  return data as string
}

export async function listAttentionQueue(organizationId:string,limit=50):Promise<AttentionItem[]>{
  const {data,error}=await supabase.rpc('get_interview_attention_queue',{p_organization_id:organizationId,p_limit:limit})
  if(error)fail(error,'Could not load the interviews needing attention.')
  return (data||[]).map((row)=>({
    findingId:row.finding_id,assessmentId:row.assessment_id,interviewId:row.interview_id,
    jobCandidateId:row.job_candidate_id,subjectMemberId:row.subject_member_id,
    severity:row.severity,title:row.title,summary:row.summary,createdAt:row.created_at,
    hasOpenCoaching:Boolean(row.has_open_coaching),
  }))
}

/* The single bounded call Today is allowed. Returns an empty list rather than throwing when the
 * feature is off, so Today never has to special-case it. */
export async function listTodayInterviewItems(organizationId:string,limit=25):Promise<TodayInterviewItem[]>{
  const {data,error}=await supabase.rpc('get_interview_today_items',{p_organization_id:organizationId,p_limit:limit})
  if(error)fail(error,'Could not load interview work.')
  return (data||[]).map((row)=>({
    kind:row.kind as TodayInterviewItem['kind'],
    interviewId:row.interview_id,
    jobCandidateId:row.job_candidate_id,
    referenceId:row.reference_id,
    headline:row.headline,
    occurredAt:row.occurred_at,
    audience:row.audience as TodayInterviewItem['audience'],
  }))
}
