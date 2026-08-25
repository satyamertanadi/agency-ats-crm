import { supabase } from '../../shared/lib/supabase'
import { AppError, DUPLICATE_CANDIDATE, humanizeRpcError } from '../../shared/lib/errors'
import { row, rows } from '../../shared/lib/rows'
import { activitySchema, candidatePipelineAssignmentSchema, candidateQualityCountSchema, candidateSearchRowSchema, companySchema, contactSchema, interviewSchema, jobCandidateSchema, jobHealthSchema, jobSchema, offerSchema, pipelineStageSchema, placementSchema, publicReviewSchema, stageHistoryEntrySchema, submissionFeedbackSchema, taskSchema, type StageHistoryEntry, type SubmissionFeedback } from './repositorySchemas'
import type { Activity, CandidateStatus, CandidatePipelineAssignment, CandidateSearchRow, Company, Contact, Interview, Job, JobCandidate, JobHealth, Offer, PipelineStage, Placement, PublicReview, Task } from '../../shared/types/domain'
import type {Json} from '../../generated/database.types'

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  /* Raw RPC identifiers (`invalid_nonnegative_value`, `permission_denied`, ...) used to reach the user
   * verbatim, because this threw error.message unchanged. humanizeRpcError turns the ones the
   * migrations actually raise into sentences and keeps the token as the AppError code, so callers can
   * still branch on it. */
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  /* Postgres's own constraint violations are the other half of the leak, and the worse-looking half:
   * a unique-violation message is `duplicate key value violates unique constraint
   * "candidate_active_email_unique"`, which is what a recruitment consultant was shown when they
   * re-entered someone already in the database. For these SQLSTATEs the caller's fallback is the better
   * sentence by construction -- the caller knows which write it was attempting, the constraint name
   * does not. */
  if(error?.code&&CONSTRAINT_CODES.has(error.code))throw new AppError(fallback,error.code,error)
  throw new AppError(error?.message||fallback,error?.code||'database_error',error)
}
/* 23505 unique, 23503 foreign key, 23514 check, 23502 not-null: the four whose default text names a
 * constraint or a column rather than describing anything a user did. */
const CONSTRAINT_CODES=new Set(['23505','23503','23514','23502'])

/* The named queues the list can be narrowed to. These are queues, not composable filters -- one
 * server-side predicate each, applied as a single extra AND alongside the eight filters above. They
 * are deliberately non-overlapping in intent: needsFollowUp is "something is owed", stale is
 * "nothing is owed and nothing is happening". An unrecognised value matches nothing, not everything. */
export type CandidateQueue='in_process'|'needs_follow_up'|'stale'|'unassigned'|'needs_enrichment'
/* `issue` narrows the needs_enrichment queue to ONE data-quality gap. It is a separate axis from
 * `queue` rather than a sixth queue because it composes with it: "needs enrichment, missing a CV" is
 * the useful view, and a queue can only ever be one thing. An unrecognised code matches nothing, the
 * same way an unrecognised queue does. */
export interface CandidateListFilters {query?:string;status?:string;location?:string;source?:string;ownerMemberId?:string;tag?:string;skill?:string;availability?:string;queue?:CandidateQueue;issue?:string;sort?:'updated'|'created'|'name'|'location';direction?:'asc'|'desc'}
export async function listCandidatesPage(organizationId:string,filters:CandidateListFilters={},page=0,pageSize=50){
  const {data,error}=await supabase.rpc('search_candidates_page',{p_organization_id:organizationId,p_query:filters.query||undefined,p_status:filters.status||undefined,p_location:filters.location||undefined,p_source:filters.source||undefined,p_owner_member_id:filters.ownerMemberId||undefined,p_tag:filters.tag||undefined,p_skill:filters.skill||undefined,p_availability:filters.availability||undefined,p_queue:filters.queue||undefined,p_issue:filters.issue||undefined,p_sort:filters.sort||'updated',p_direction:filters.direction||'desc',p_limit:pageSize,p_offset:page*pageSize})
  if(error)fail(error,'Could not load candidates');const resultRows=rows(data,candidateSearchRowSchema,'Candidate search rows did not match the expected shape') as CandidateSearchRow[];return {rows:resultRows,count:Number(resultRows[0]?.total_count||0)}
}

/* Accepts the whole field set the shared CandidateForm collects, not the nine columns the old add modal
 * happened to render. Owner, status and the contact/salary details are all writable at creation now,
 * which is what stops every hand-entered candidate arriving unassigned and needing a second visit.
 *
 * Candidate, private details, and profile lists now commit through one RPC transaction, so a failed
 * write cannot leave a half-created candidate. On a duplicate email the error names the collision so
 * the caller can offer the existing record rather than just refusing. */
/* A unique-violation tells you a collision happened, not what it collided with -- so "a candidate with
 * this email already exists" was the end of the road: the consultant was informed and then left to go
 * find the record themselves. One extra query, only on the failure path, turns that into a link.
 *
 * Looks the row up by canonical email through the same normalization the generated column uses, and
 * stays quiet if it cannot find it (the caller's generic message is still better than a raw constraint
 * name). Throws AppError with the DUPLICATE_CANDIDATE code and the id in `recordId` so the form can
 * offer to open it. */
async function raiseDuplicateCandidate(organizationId:string,email:string|undefined,error:{code?:string}){
  if(error.code!=='23505'||!email?.trim())return
  const {data}=await supabase.from('candidates')
    .select('id,full_name,candidate_private_details!inner(canonical_email)')
    .eq('organization_id',organizationId)
    .eq('candidate_private_details.canonical_email',email.trim().toLowerCase())
    .is('deleted_at',null).limit(1).maybeSingle()
  const existing=data as {id?:string;full_name?:string}|null
  if(!existing?.id)return
  throw new DuplicateCandidateError(existing.id,existing.full_name||'An existing candidate')
}
export class DuplicateCandidateError extends AppError {
  constructor(public readonly candidateId:string,public readonly candidateName:string){
    super(`${candidateName} already has this email address.`,DUPLICATE_CANDIDATE)
  }
}

export interface CreateCandidateInput {
  full_name:string;email?:string;phone?:string;current_company?:string;current_position?:string;location?:string
  source?:string;linkedin_url?:string;portfolio_url?:string;availability?:string;notice_period_days?:number
  status?:CandidateStatus;owner_member_id?:string;current_salary?:number;expected_salary?:number;salary_currency?:string
  work_authorization?:string
}
export interface CandidateProfileLists {
  employment?:readonly unknown[]
  education?:readonly unknown[]
  languages?:readonly unknown[]
  skills?:readonly unknown[]
}
export async function createCandidate(organizationId:string,_userId:string,input:CreateCandidateInput,profile:CandidateProfileLists={}) {
  const candidate={full_name:input.full_name,current_company:input.current_company||null,current_position:input.current_position||null,
    location:input.location||null,source:input.source||null,linkedin_url:input.linkedin_url||null,portfolio_url:input.portfolio_url||null,
    availability:input.availability||null,notice_period_days:input.notice_period_days??null,status:input.status||'active',owner_member_id:input.owner_member_id||null}
  const privateDetails={email:input.email||null,phone:input.phone||null,current_salary:input.current_salary??null,
    expected_salary:input.expected_salary??null,salary_currency:input.salary_currency||null,work_authorization:input.work_authorization||null}
  const {data,error}=await supabase.rpc('create_candidate_with_profile',{p_organization_id:organizationId,
    p_candidate:candidate as Json,p_private:privateDetails as Json,p_employment:(profile.employment||[]) as unknown as Json,
    p_education:(profile.education||[]) as unknown as Json,p_languages:(profile.languages||[]) as unknown as Json,
    p_skills:(profile.skills||[]) as unknown as Json})
  if(error){await raiseDuplicateCandidate(organizationId,input.email,error);fail(error,'Could not create candidate')}
  return data as string
}

/* Unlike candidates, companies have no dedicated search/paging RPC -- this is the full-table fetch
 * ClientsPage's list and JobsPage's client picker both read from. The explicit limit is a safety cap
 * against unbounded growth, not real pagination: relying on PostgREST's own default row cap would be
 * undocumented, environment-specific behavior (the same reasoning 20260717060000 already applies to
 * grants). A boutique agency's live company count should stay well under this for years; if it
 * doesn't, that's the trigger to build a paged RPC the way search_candidates_page already does. */
const LIST_SAFETY_LIMIT=1000
export async function listCompanies(organizationId:string){const {data,error}=await supabase.from('companies').select('*').eq('organization_id',organizationId).is('deleted_at',null).order('updated_at',{ascending:false}).limit(LIST_SAFETY_LIMIT);if(error)fail(error,'Could not load companies');return rows(data,companySchema,'Company rows did not match the expected shape') as Company[]}
export async function createCompany(organizationId:string,userId:string,input:{name:string;industry?:string;company_size?:string;location?:string;website?:string;account_status:string;owner_member_id?:string}){const {data,error}=await supabase.from('companies').insert({...input,organization_id:organizationId,created_by:userId}).select('id').single();if(error)fail(error,'Could not create company');return data.id as string}

/* `companyId` narrows server-side, and that matters for correctness rather than bytes. The submission
 * composer used to read this unfiltered and then keep only one company's contacts in the browser --
 * so once an organization passed LIST_SAFETY_LIMIT contacts, a client whose people had not been
 * touched recently fell outside the `updated_at desc` window and the recipient list came back EMPTY,
 * with no error to explain it. Filtering in SQL makes the cap irrelevant to that screen. */
export async function listContacts(organizationId:string,filters:{companyId?:string}={}){let request=supabase.from('contacts').select('id,organization_id,company_id,full_name,position,email,phone,contact_status,next_follow_up_at,companies(id,name)').eq('organization_id',organizationId).is('deleted_at',null);if(filters.companyId)request=request.eq('company_id',filters.companyId);const {data,error}=await request.order('updated_at',{ascending:false}).limit(LIST_SAFETY_LIMIT);if(error)fail(error,'Could not load contacts');return rows(data,contactSchema,'Contact rows did not match the expected shape') as Contact[]}
export async function createContact(organizationId:string,userId:string,input:{company_id:string;full_name:string;position?:string;email?:string;phone?:string}){const {data,error}=await supabase.from('contacts').insert({...input,organization_id:organizationId,created_by:userId}).select('id').single();if(error)fail(error,'Could not create contact');return data.id as string}

const JOB_COLUMNS='id,organization_id,company_id,pipeline_id,title,location,priority,status,currency,salary_min,salary_max,placement_fee_percentage,fixed_fee,description,requirements,owner_member_id,opened_at,updated_at,companies(id,name)'
export async function listJobs(organizationId:string){const {data,error}=await supabase.from('jobs').select(JOB_COLUMNS).eq('organization_id',organizationId).is('deleted_at',null).order('updated_at',{ascending:false}).limit(LIST_SAFETY_LIMIT);if(error)fail(error,'Could not load jobs');return rows(data,jobSchema,'Job rows did not match the expected shape') as Job[]}

/* One job by id, for the screens that need exactly one.
 *
 * JobWorkspacePage and PlacementsPage both used to do `listJobs(org).find(j => j.id === jobId)` --
 * fetching up to LIST_SAFETY_LIMIT rows to locate a single record, and then reporting "not found"
 * for any job outside that page. Past the cap the board for a real, open job simply refused to open.
 * Same columns as the list so the shapes cannot drift; `maybeSingle` so a genuinely missing id is
 * null rather than a thrown error the caller has to distinguish from a network failure. */
export async function getJob(organizationId:string,jobId:string){const {data,error}=await supabase.from('jobs').select(JOB_COLUMNS).eq('organization_id',organizationId).eq('id',jobId).is('deleted_at',null).maybeSingle();if(error)fail(error,'Could not load the job');return data?(rows([data],jobSchema,'Job row did not match the expected shape') as Job[])[0]??null:null}
export async function listJobHealth(organizationId:string,candidateId?:string){const {data,error}=await supabase.rpc('list_job_health',{p_organization_id:organizationId,p_candidate_id:candidateId||undefined});if(error)fail(error,'Could not load job health');const withPhaseCounts=(data??[]).map((item)=>({...item,phase_counts:(item.phase_counts||{}) as Record<string,number>}));return rows(withPhaseCounts,jobHealthSchema,'Job health rows did not match the expected shape') as JobHealth[]}
export async function createJob(organizationId:string,input:{company_id:string;title:string;owner_member_id?:string;details?:Record<string,unknown>}){const {data,error}=await supabase.rpc('create_job_with_details',{p_organization_id:organizationId,p_company_id:input.company_id,p_title:input.title,p_owner_member_id:input.owner_member_id,p_details:(input.details||{}) as Json});if(error)fail(error,'Could not create job');return data as string}

export async function getPipeline(job:Job){if(!job.pipeline_id)return {stages:[],items:[]};const [stageResult,itemResult]=await Promise.all([supabase.from('pipeline_stages').select('*').eq('pipeline_id',job.pipeline_id).order('position'),supabase.from('job_candidates').select('id,job_id,candidate_id,current_stage_id,updated_at,candidates(id,organization_id,full_name,current_company,current_position,location,linkedin_url,status,source,availability,owner_member_id,created_at),pipeline_stages(id,pipeline_id,name,stage_key,stage_type,phase_key,position,color),stage_history(occurred_at,note,to_stage_id)').eq('job_id',job.id).order('occurred_at',{referencedTable:'stage_history',ascending:false})]);if(stageResult.error)fail(stageResult.error,'Could not load pipeline');if(itemResult.error)fail(itemResult.error,'Could not load pipeline candidates');return {stages:rows(stageResult.data,pipelineStageSchema,'Pipeline stage rows did not match the expected shape') as PipelineStage[],items:rows(itemResult.data,jobCandidateSchema,'Job candidate rows did not match the expected shape') as JobCandidate[]}}
export async function addCandidateToJob(organizationId:string,userId:string,job:Job,candidateId:string){if(!job.pipeline_id)throw new AppError('This job has no pipeline.');const {data:stage,error:stageError}=await supabase.from('pipeline_stages').select('id').eq('pipeline_id',job.pipeline_id).order('position').limit(1).single();if(stageError)fail(stageError,'Could not find the first stage');const {error}=await supabase.from('job_candidates').insert({organization_id:organizationId,job_id:job.id,candidate_id:candidateId,current_stage_id:stage.id,added_by:userId});if(error)fail(error,error.code==='23505'?'Candidate is already in this job.':'Could not add candidate')}
export async function addCandidatesToJob(organizationId:string,jobId:string,candidateIds:string[],stageId?:string){const {data,error}=await supabase.rpc('add_candidates_to_job',{p_organization_id:organizationId,p_job_id:jobId,p_candidate_ids:candidateIds,p_stage_id:stageId||undefined});if(error)fail(error,error.message.includes('candidate_already_in_job')?'A selected candidate is already in this job.':error.message.includes('candidate_unavailable')?'A selected candidate is archived or marked Do not contact.':'Could not add candidates to this job');return data??[]}
export async function listPipelineStagesForJob(organizationId:string,jobId:string){const job=await supabase.from('jobs').select('pipeline_id').eq('organization_id',organizationId).eq('id',jobId).single();if(job.error)fail(job.error,'Could not load job pipeline');if(!job.data.pipeline_id)throw new AppError('This job has no pipeline.','pipeline_missing');const {data,error}=await supabase.from('pipeline_stages').select('id,pipeline_id,name,stage_key,stage_type,phase_key,position,color').eq('pipeline_id',job.data.pipeline_id).eq('stage_type','active').order('position');if(error)fail(error,'Could not load pipeline stages');return rows(data,pipelineStageSchema,'Pipeline stage rows did not match the expected shape') as PipelineStage[]}
export async function listCandidatePipelineAssignments(organizationId:string,candidateId:string){const {data,error}=await supabase.from('job_candidates').select('id,job_id,candidate_id,current_stage_id,added_at,updated_at,jobs(id,title,companies(name),organization_members:owner_member_id(profiles:user_id(full_name,email))),pipeline_stages(id,pipeline_id,name,stage_key,stage_type,phase_key,position,color),stage_history(occurred_at,to_stage_id)').eq('organization_id',organizationId).eq('candidate_id',candidateId).order('updated_at',{ascending:false}).order('occurred_at',{referencedTable:'stage_history',ascending:false});if(error)fail(error,'Could not load candidate pipelines');return rows(data,candidatePipelineAssignmentSchema,'Candidate pipeline rows did not match the expected shape') as CandidatePipelineAssignment[]}
/* `p_note` has been in this RPC's signature from the start, has always been written to
 * stage_history.note, and has always been used as the activity-feed summary when present -- and no
 * caller has ever passed it. So every stage move logged the generated "Moved from X to Y", and the one
 * move where the reason is the whole point (a rejection) recorded no reason at all.
 *
 * `source` is a parameter now because the outcome tray and the card menu are not drags: attributing a
 * menu-driven rejection to 'kanban' would make the audit trail describe an interaction that did not
 * happen. */
export async function moveCandidate(jobCandidateId:string,stageId:string,options:{note?:string;source?:string}={}){
  const {error}=await supabase.rpc('move_job_candidate_stage',{p_job_candidate_id:jobCandidateId,p_stage_id:stageId,
    p_note:options.note?.trim()||undefined,p_source:options.source||'kanban'})
  if(error)fail(error,'Could not move candidate')
}

export async function listTasks(organizationId:string){const {data,error}=await supabase.from('tasks').select('*,organization_members:owner_member_id(profiles:user_id(full_name,email)),task_links(candidate_id,company_id,contact_id,job_id,candidates(full_name),companies(name),contacts(full_name),jobs(title))').eq('organization_id',organizationId).is('deleted_at',null).order('due_at',{ascending:true,nullsFirst:false});if(error)fail(error,'Could not load tasks');return rows(data,taskSchema,'Task rows did not match the expected shape') as Task[]}
export async function createTask(organizationId:string,_userId:string,input:{title:string;description?:string;priority:string;due_at?:string;owner_member_id?:string;link?:{type:'candidate'|'company'|'contact'|'job';id:string}}){const {data,error}=await supabase.rpc('create_task_with_link',{p_organization_id:organizationId,p_title:input.title,p_description:input.description,p_priority:input.priority,p_due_at:input.due_at,p_owner_member_id:input.owner_member_id,p_link_type:input.link?.type,p_link_id:input.link?.id});if(error)fail(error,'Could not create task');return data as string}
export async function completeTask(organizationId:string,id:string){const {error}=await supabase.from('tasks').update({status:'completed',completed_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',id);if(error)fail(error,'Could not complete task')}
export async function snoozeTask(organizationId:string,id:string,dueAt:string){const {error}=await supabase.from('tasks').update({status:'open',completed_at:null,due_at:dueAt}).eq('organization_id',organizationId).eq('id',id);if(error)fail(error,'Could not snooze task')}

// An activity carries one activity_links row per record it touches, so a single stage move surfaces
// on both the candidate and the vacancy. Callers name the record whose feed they are reading.
export type ActivityLink={candidate_id?:string;company_id?:string;contact_id?:string;job_id?:string;candidate_submission_id?:string;placement_id?:string}
const linkColumn=(link:ActivityLink)=>{const entry=Object.entries(link).find(([,value])=>Boolean(value));if(!entry)throw new AppError('An activity must be linked to a record.','link_required');return entry as [keyof ActivityLink,string]}

export async function listActivities(organizationId:string,link:ActivityLink,limit=50){
  const [column,value]=linkColumn(link)
  const {data,error}=await supabase.from('activities')
    .select(`id,activity_type,direction,subject,summary,occurred_at,created_by,actor_name_snapshot,profiles:created_by(full_name),activity_links!inner(${column})`)
    .eq('organization_id',organizationId).eq(`activity_links.${column}`,value)
    .order('occurred_at',{ascending:false}).limit(limit)
  if(error)fail(error,'Could not load activity')
  return rows(data,activitySchema,'Activity rows did not match the expected shape') as Activity[]
}

// Goes through log_manual_activity rather than inserting directly: the activity and its links must
// land together, and the RPC refuses system-generated types so the feed stays trustworthy.
export async function createActivity(organizationId:string,input:{activity_type:string;direction?:string;subject?:string;summary:string;occurred_at?:string},links:ActivityLink[]){
  const payload=links.map((link)=>{const [column,value]=linkColumn(link);return {[column]:value}})
  const {data,error}=await supabase.rpc('log_manual_activity',{p_organization_id:organizationId,p_type:input.activity_type,p_summary:input.summary,p_subject:input.subject||undefined,p_direction:input.direction||undefined,p_occurred_at:input.occurred_at||undefined,p_links:payload as Json})
  if(error)fail(error,'Could not log this activity')
  return data as string
}

/* `jobId` scopes the four workspace lists below (interviews, offers, placements, submission
 * packages) to one job. Opening a job used to cost four unbounded org-wide fetches that were then
 * filtered client-side down to a single candidate -- fine at today's row counts, and exactly what
 * the Vincere migration's history import breaks. Today keeps the org-wide view it genuinely needs,
 * bounded instead by the status and date windows it already applies (see TodayPage). */
export async function listPlacements(organizationId:string,filter:{jobId?:string}={}){let query=supabase.from('placements').select('id,job_candidate_id,candidate_id,job_id,company_id,start_date,salary,placement_fee,currency,guarantee_ends_on,status,candidates(full_name),jobs(title),companies(name),placement_revenue_splits(id,member_id,split_percentage,split_amount,organization_members:member_id(profiles:user_id(full_name,email))),placement_invoices(id,invoice_reference,amount,currency,issued_on,due_on,status,paid_on)').eq('organization_id',organizationId);if(filter.jobId)query=query.eq('job_id',filter.jobId);const {data,error}=await query.order('start_date',{ascending:false});if(error)fail(error,'Could not load placements');return rows(data,placementSchema,'Placement rows did not match the expected shape') as Placement[]}
/* Today needs placements only to know which job candidates are already placed, so it suppresses the
 * "create placement" prompt on an accepted offer. Two narrow columns answer that; pulling the full
 * placement rows (with their revenue splits and invoices) to compute a Set of ids was the most
 * expensive query on the page and the least of its output. */
export async function listPlacedJobCandidates(organizationId:string){const {data,error}=await supabase.from('placements').select('job_candidate_id,status').eq('organization_id',organizationId).neq('status','cancelled');if(error)fail(error,'Could not load placements');return data??[]}
export async function createPlacement(organizationId:string,userId:string,input:{job_candidate_id:string;candidate_id:string;job_id:string;company_id:string;start_date:string;salary:number;placement_fee:number;currency:string;guarantee_days:number}){const {error}=await supabase.from('placements').insert({...input,organization_id:organizationId,created_by:userId});if(error)fail(error,error.code==='23505'?'This candidate already has a placement for the job.':'Could not create placement')}
export async function listInterviews(organizationId:string,filter:{jobId?:string;since?:string}={}){
  // The job filter lives on job_candidates, so the embed has to be an inner join for it to filter
  // parent rows rather than just blanking the embedded object.
  const embed=filter.jobId?'job_candidates!inner(candidate_id,job_id,candidates(id,full_name),jobs(id,title,owner_member_id))':'job_candidates(candidate_id,candidates(id,full_name),jobs(id,title,owner_member_id))'
  let interviewQuery=supabase.from('interviews').select(`id,job_candidate_id,interview_type,stage_label,starts_at,ends_at,timezone,location,meeting_url,notes,status,organizer_member_id,attendee_emails,create_google_meet,calendar_event_id,calendar_event_url,calendar_sync_status,calendar_last_error,calendar_last_synced_at,calendar_retry_count,calendar_sync_version,calendar_synced_version,${embed}`).eq('organization_id',organizationId)
  if(filter.jobId)interviewQuery=interviewQuery.eq('job_candidates.job_id',filter.jobId)
  if(filter.since)interviewQuery=interviewQuery.gte('starts_at',filter.since)
  const [interviews,deliveries]=await Promise.all([
    interviewQuery.order('starts_at',{ascending:true}),
    supabase.from('email_deliveries').select('related_entity_id,status').eq('organization_id',organizationId).eq('email_type','interview_cancellation').in('status',['pending','failed','bounced','suppressed']),
  ])
  if(interviews.error)fail(interviews.error,'Could not load interviews')
  if(deliveries.error)fail(deliveries.error,'Could not load interview notification status')
  const issues=new Map<string,number>()
  for(const delivery of deliveries.data||[])if(delivery.related_entity_id)issues.set(delivery.related_entity_id,(issues.get(delivery.related_entity_id)||0)+1)
  return (rows(interviews.data,interviewSchema,'Interview rows did not match the expected shape') as Interview[])
    .map((interview)=>({...interview,cancellation_delivery_issues:issues.get(interview.id)||0}))
}
export async function createInterview(organizationId:string,userId:string,input:{job_candidate_id:string;starts_at:string;ends_at:string;timezone:string;interview_type?:string;location?:string;meeting_url?:string;organizer_member_id?:string;attendee_emails?:string[];create_google_meet?:boolean}){const {data,error}=await supabase.from('interviews').insert({...input,organizer_member_id:input.organizer_member_id||null,attendee_emails:input.attendee_emails||[],calendar_sync_status:input.organizer_member_id?'pending':'not_requested',organization_id:organizationId,created_by:userId}).select('id').single();if(error)fail(error,'Could not schedule interview');return data.id as string}
export async function updateInterview(organizationId:string,interviewId:string,input:{starts_at:string;ends_at:string;timezone:string;location?:string;meeting_url?:string;attendee_emails?:string[];create_google_meet?:boolean}){const {error}=await supabase.from('interviews').update({...input,attendee_emails:input.attendee_emails||[],updated_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',interviewId);if(error)fail(error,'Could not update interview')}
/* Reads the client's actual answers for one candidate. The panel's "Client review" step told the
 * consultant to go "review recent activity" while these rows sat unread in the table the public
 * review page writes to -- so the single most valuable thing a submission produces was invisible on
 * the surface built to chase it.
 *
 * Filtered through candidate_submissions because feedback hangs off the submission, not the job
 * candidate; the !inner join is what makes the filter a join condition rather than a post-filter that
 * would return every row in the org. */
export async function listSubmissionFeedback(organizationId:string,jobCandidateId:string){
  const {data,error}=await supabase.from('submission_feedback')
    .select('id,decision,comments,reviewer_name,created_at,candidate_submissions!inner(job_candidate_id)')
    .eq('organization_id',organizationId).eq('candidate_submissions.job_candidate_id',jobCandidateId)
    .order('created_at',{ascending:false})
  if(error)fail(error,'Could not load client feedback')
  return rows(data,submissionFeedbackSchema,'Submission feedback rows did not match the expected shape') as SubmissionFeedback[]
}

/* The org-wide counterpart. `listSubmissionFeedback` answers "what did the client say about this
 * candidate", which only helps someone already looking at that candidate. This answers "has any client
 * said anything recently" -- the question nobody could ask, and the reason a client approval could sit
 * unread for days: feedback was written to the table, rendered on one panel, and announced nowhere.
 *
 * Windowed rather than unbounded because this is a work queue, not an archive: feedback from three
 * weeks ago has either been actioned or become a different problem. */
export async function listRecentSubmissionFeedback(organizationId:string,sinceIso:string){
  const {data,error}=await supabase.from('submission_feedback')
    .select('id,decision,comments,reviewer_name,created_at,candidate_submissions!inner(job_candidate_id,job_candidates(candidates(full_name),jobs(id,title,owner_member_id)))')
    .eq('organization_id',organizationId).gte('created_at',sinceIso).order('created_at',{ascending:false})
  if(error)fail(error,'Could not load recent client feedback')
  return data??[]
}


/* Every stage change this candidate has been through, in the words that were recorded at the time.
 * Written on every move since the initial schema and never once displayed.
 *
 * No actor name. stage_history.changed_by references auth.users, and PostgREST cannot traverse from
 * there to profiles -- verified against the running database rather than assumed, because this
 * typechecks and then returns "Could not find a relationship" at runtime. Adding a FK purely to label
 * a timeline row is not worth a migration; from/to/when/why is what the timeline is for. */
export async function listStageHistory(organizationId:string,jobCandidateId:string){
  const {data,error}=await supabase.from('stage_history')
    .select('id,occurred_at,note,source,from_stage:from_stage_id(name,stage_type),to_stage:to_stage_id(name,stage_type)')
    .eq('organization_id',organizationId).eq('job_candidate_id',jobCandidateId)
    .order('occurred_at',{ascending:false})
  if(error)fail(error,'Could not load stage history')
  return rows(data,stageHistoryEntrySchema,'Stage history rows did not match the expected shape') as StageHistoryEntry[]
}

export async function listOffers(organizationId:string,filter:{jobId?:string;statuses?:string[]}={}){
  const embed=filter.jobId?'job_candidates!inner(candidate_id,job_id,candidates(id,full_name),jobs(id,title,owner_member_id))':'job_candidates(candidate_id,candidates(id,full_name),jobs(id,title,owner_member_id))'
  let query=supabase.from('offers').select(`id,job_candidate_id,salary,currency,offered_at,start_date,status,notes,${embed}`).eq('organization_id',organizationId)
  if(filter.jobId)query=query.eq('job_candidates.job_id',filter.jobId)
  if(filter.statuses?.length)query=query.in('status',filter.statuses)
  const {data,error}=await query.order('offered_at',{ascending:false})
  if(error)fail(error,'Could not load offers')
  return rows(data,offerSchema,'Offer rows did not match the expected shape') as Offer[]
}
export async function createOffer(organizationId:string,userId:string,input:{job_candidate_id:string;salary:number;currency:string;start_date?:string}){const {error}=await supabase.from('offers').insert({...input,organization_id:organizationId,created_by:userId,status:'presented'});if(error)fail(error,'Could not create offer')}
/* Was exported and called from nowhere, which is why an offer reached 'presented' and stayed there
 * forever: no UI could accept or decline one, so the placement flow behind it was unreachable and
 * Today kept a permanent "chase this offer" row for an offer that had in fact been accepted weeks ago.
 *
 * Org-scoped while being wired up. The old filter was `.eq('id',id)` alone -- RLS still stopped a
 * cross-tenant write, but relying on the policy as the only tenancy check is not the pattern the rest
 * of this file follows, and a mistyped id silently updating nothing reads the same as success. */
export async function updateOfferStatus(organizationId:string,id:string,status:'accepted'|'declined'|'withdrawn',notes?:string){
  const patch:{status:string;notes?:string}={status}
  if(notes?.trim())patch.notes=notes.trim()
  const {error}=await supabase.from('offers').update(patch).eq('organization_id',organizationId).eq('id',id)
  if(error)fail(error,'The offer status was not changed.')
}

/* The other half of the interview lifecycle: an interview could be scheduled and then never resolved,
 * so "did that actually happen, and how did it go?" lived in someone's head rather than the record.
 *
 * No new columns. `interviews.status` has allowed 'no_show' since the initial schema and
 * InterviewStatus/interviewStatus already carry it with a tone -- the whole vocabulary was built and
 * then never reachable, because nothing could move an interview off 'scheduled'. `notes` is likewise
 * an existing column that nothing in the app has ever written, so the outcome note has a home without
 * inventing one. Captured at completion because that is the only moment anyone knows the answer. */
export async function completeInterview(organizationId:string,interviewId:string,input:{outcome:'completed'|'no_show';notes?:string}){
  const patch:{status:string;updated_at:string;notes?:string}={status:input.outcome,updated_at:new Date().toISOString()}
  // Left alone when blank rather than nulled, so recording an outcome never erases an existing note.
  if(input.notes?.trim())patch.notes=input.notes.trim()
  const {error}=await supabase.from('interviews').update(patch).eq('organization_id',organizationId).eq('id',interviewId)
  if(error)fail(error,'The interview outcome was not recorded.')
}
// `feeSource` is stated by the caller rather than inferred from the number: two sources agreeing on
// a value would make an inference unresolvable, and provenance that is guessed is not provenance.
export type PlacementFeeSource='account_agreement'|'job_override'|'manual'
export async function convertOfferToPlacement(offerId:string,fee:number,guaranteeDays=90,feeSource:PlacementFeeSource='manual'){const {data,error}=await supabase.rpc('create_placement_from_offer',{p_offer_id:offerId,p_fee:fee,p_guarantee_days:guaranteeDays,p_fee_source:feeSource});if(error)fail(error,'Could not convert accepted offer to placement');return data as string}

export async function listSubmissionPackages(organizationId:string,filter:{jobId?:string;since?:string}={}){
  let packageQuery=supabase.from('submission_packages').select('id,job_id,title,message,status,created_at,jobs(id,title,companies(name)),candidate_submissions(id,job_candidate_id,status),public_submission_links(id,recipient_email,expires_at,revoked_at,last_accessed_at)').eq('organization_id',organizationId)
  if(filter.jobId)packageQuery=packageQuery.eq('job_id',filter.jobId)
  if(filter.since)packageQuery=packageQuery.gte('created_at',filter.since)
  const scoped=Boolean(filter.jobId||filter.since)
  /* Unscoped, the delivery lookup runs in parallel on the whole organization -- it is the Today
   * path, which wants every package anyway. Scoped, it waits for the package ids and asks only
   * about those: fetching every client_submission delivery ever sent to decorate one job's handful
   * of packages is the same unbounded read this change exists to remove. */
  const packages=scoped?await packageQuery.order('created_at',{ascending:false}):null
  const [resolvedPackages,deliveries]=packages
    ?[packages,await deliveryLookup(organizationId,(packages.data??[]).map((pack)=>pack.id))]
    :await Promise.all([packageQuery.order('created_at',{ascending:false}),deliveryLookup(organizationId,null)])
  if(resolvedPackages.error)fail(resolvedPackages.error,'Could not load submissions')
  if(deliveries.error)fail(deliveries.error,'Could not load submission delivery status')
  const deliveryByPackage=new Map((deliveries.data||[]).map((delivery)=>[delivery.related_entity_id,delivery]))
  return (resolvedPackages.data??[]).map((pack)=>({...pack,email_delivery:deliveryByPackage.get(pack.id)||null}))
}
function deliveryLookup(organizationId:string,packageIds:string[]|null){
  const query=supabase.from('email_deliveries').select('id,status,error_message,related_entity_id').eq('organization_id',organizationId).eq('email_type','client_submission')
  return packageIds?query.in('related_entity_id',packageIds):query
}
export async function listEmailDeliveryIssues(organizationId:string){const {data,error}=await supabase.from('email_deliveries').select('id,status,email_type,related_entity_type,related_entity_id,error_code,error_message,updated_at').eq('organization_id',organizationId).in('status',['pending','failed','bounced','suppressed']).order('updated_at',{ascending:false});if(error)fail(error,'Could not load delivery issues');return data??[]}
export async function createSubmission(organizationId:string,input:{job_id:string;contact_id?:string;title:string;message?:string;items:Array<{job_candidate_id:string;candidate_summary:string;recruiter_comments?:string}>;recipient_name?:string;recipient_email?:string}){const {data,error}=await supabase.rpc('create_submission_package',{p_organization_id:organizationId,p_job_id:input.job_id,p_contact_id:input.contact_id,p_title:input.title,p_message:input.message,p_items:input.items as Json,p_recipient_name:input.recipient_name,p_recipient_email:input.recipient_email,p_expiry_days:7});if(error)fail(error,'Could not create submission');return data as {package_id:string;link_id:string;token:string;expires_at:string}}

export async function resolveReview(token:string){const {data,error}=await supabase.functions.invoke('public-review',{body:{action:'resolve',token},timeout:10_000});if(error)fail(error,'This review link is unavailable.');if((data as {error?:{message?:string}})?.error)throw new AppError((data as {error:{message?:string}}).error.message||'This review link is unavailable.','link_unavailable',data);return row(data,publicReviewSchema,'Public review response did not match the expected shape') as PublicReview}
export async function sendReviewFeedback(token:string,submissionId:string,decision:string,comments:string,reviewerName:string){const {data,error}=await supabase.functions.invoke('public-review',{body:{action:'feedback',token,submissionId,decision,comments,reviewerName},timeout:10_000});if(error)fail(error,'Could not save feedback');if((data as {error?:{message?:string}})?.error)throw new AppError((data as {error:{message?:string}}).error.message||'Could not save feedback','feedback_failed',data)}


export async function searchWorkspace(organizationId:string,query:string){const {data,error}=await supabase.rpc('search_workspace',{p_organization_id:organizationId,p_query:query,p_limit:30});if(error)fail(error,'Search failed');return (data??[]) as Array<{entity_type:string;entity_id:string;title:string;subtitle:string;rank:number}>}

export async function dashboardSummary(organizationId:string){
  const now=new Date().toISOString();const soon=new Date(Date.now()+7*86400000).toISOString()
  const [jobs,candidates,tasks,interviews,offers,placements,activities,companies,contacts,pipelineEntries,members,settings]=await Promise.all([
    supabase.from('jobs').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('status','open').is('deleted_at',null),
    supabase.from('candidates').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).is('deleted_at',null),
    supabase.from('tasks').select('id,title,due_at,priority').eq('organization_id',organizationId).in('status',['open','in_progress']).lt('due_at',now).order('due_at').limit(8),
    supabase.from('interviews').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).gte('starts_at',now).lte('starts_at',soon),
    supabase.from('offers').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).in('status',['draft','presented']),
    supabase.from('placements').select('placement_fee,currency').eq('organization_id',organizationId).gte('created_at',new Date(new Date().getFullYear(),0,1).toISOString()),
    supabase.from('activities').select('id,activity_type,subject,summary,occurred_at').eq('organization_id',organizationId).order('occurred_at',{ascending:false}).limit(8),
    supabase.from('companies').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).is('deleted_at',null),
    supabase.from('contacts').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).is('deleted_at',null),
    supabase.from('job_candidates').select('id',{count:'exact',head:true}).eq('organization_id',organizationId),
    supabase.from('organization_members').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('status','active'),
    supabase.from('organization_settings').select('settings').eq('organization_id',organizationId).maybeSingle(),
  ])
  for(const result of [jobs,candidates,tasks,interviews,offers,placements,activities,companies,contacts,pipelineEntries,members,settings])if(result.error)fail(result.error,'Could not load dashboard')
  const setupDismissedAt=(settings.data?.settings as {setup_dismissed_at?:string}|null)?.setup_dismissed_at??null
  return {activeJobs:jobs.count??0,candidates:candidates.count??0,overdueTasks:tasks.data??[],interviews:interviews.count??0,offers:offers.count??0,placements:placements.data??[],activities:activities.data??[],
    companies:companies.count??0,contacts:contacts.count??0,pipelineEntries:pipelineEntries.count??0,members:members.count??0,setupDismissedAt}
}

// Merges rather than replaces: `settings` is shared jsonb, so a blind write would clobber
// unrelated keys. Only the owner can reach this (organization.manage), so the read-modify-write
// window is not contended.
export async function dismissSetupChecklist(organizationId:string){
  const {data,error:readError}=await supabase.from('organization_settings').select('settings').eq('organization_id',organizationId).maybeSingle()
  if(readError)fail(readError,'Could not update setup preferences')
  const current=(data?.settings as Record<string,unknown>|null)??{}
  const {error}=await supabase.from('organization_settings').update({settings:{...current,setup_dismissed_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('organization_id',organizationId)
  if(error)fail(error,'Could not hide the setup guide')
}

export async function listMembers(organizationId:string){const {data,error}=await supabase.from('organization_members').select('id,user_id,job_title,status,profiles:user_id(full_name,email)').eq('organization_id',organizationId).order('joined_at');if(error)fail(error,'Could not load team');return data??[]}
export async function listRoles(organizationId:string){const {data,error}=await supabase.from('roles').select('id,name,role_key,is_system,role_permissions(permission_key)').eq('organization_id',organizationId).order('name');if(error)fail(error,'Could not load roles');return data??[]}
export async function createInvitation(organizationId:string,email:string,roleId:string){const {data,error}=await supabase.rpc('create_organization_invitation',{p_organization_id:organizationId,p_email:email,p_role_id:roleId,p_expiry_days:7});if(error)fail(error,'Could not create invitation');return data as {invitation_id:string;token:string;expires_at:string}}
export async function acceptInvitation(token:string){const {data,error}=await supabase.rpc('accept_organization_invitation',{p_token:token});if(error)fail(error,error.message.includes('email_mismatch')?'Sign in with the email address that was invited.':'Could not accept invitation');if(!data)throw new AppError('This invitation is invalid, expired, or revoked.','invitation_unavailable');return data as {organization_id:string;organization_slug:string;member_id:string}}

/* Counts by data-quality issue, over the same filtered population the list is showing.
 *
 * Its own request rather than a column on the list, and deliberately so: these are counts over the
 * WHOLE filtered set, not the page, and folding a whole-set aggregate into a paginated query means
 * either computing it fifty times or returning it fifty times.
 *
 * It takes every list filter EXCEPT the issue itself. That is what makes the strip honest -- choosing
 * "No CV (12)" has to return twelve rows, and it would not if the count had been taken after the
 * choice was already applied. Callers must only run this while the enrichment queue is active; the
 * counts are meaningless beside any other queue.
 */
export async function candidateQualitySummary(organizationId:string,filters:CandidateListFilters={}){
  const {data,error}=await supabase.rpc('candidate_quality_summary',{
    p_organization_id:organizationId,p_query:filters.query||undefined,p_status:filters.status||undefined,
    p_location:filters.location||undefined,p_source:filters.source||undefined,
    p_owner_member_id:filters.ownerMemberId||undefined,p_tag:filters.tag||undefined,
    p_skill:filters.skill||undefined,p_availability:filters.availability||undefined,
  })
  if(error)fail(error,'Could not count data-quality issues')
  return rows(data,candidateQualityCountSchema,'Quality summary rows did not match the expected shape')
}
