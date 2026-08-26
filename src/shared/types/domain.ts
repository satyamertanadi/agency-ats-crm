/* Status unions, sourced from the CHECK constraints in supabase/migrations. The schema uses CHECK
 * rather than Postgres enums, so `supabase gen types` emits plain `string` (database.types.ts has
 * `Enums: {}`). Narrowing here is what lets src/shared/lib/status.ts be exhaustive: a status added
 * to a migration without a tone becomes a compile error rather than a silently neutral badge.
 *
 * IMPORTANT -- what these unions do and do not buy you. Every repository already returns
 * `(data??[]) as unknown as X[]` (repository.ts:11,28,34,75, and throughout). A double cast through
 * `unknown` is unchecked, so nothing verifies that a row's `status` is actually a union member --
 * narrowing these types produced ZERO new typecheck errors for exactly that reason. So:
 *   - What you GET: status.ts maps are exhaustive over the union, so adding a value here without
 *     giving it a tone is a compile error. That is the real win and it holds.
 *   - What you DO NOT get: any guarantee the DB agrees. If a migration adds a status and nobody
 *     updates the union, the cast swallows it silently and the value arrives at runtime anyway.
 * Hence every lookup in status.ts goes through lookup() with a fallback, not bare indexing --
 * for ALL maps, not just the unconstrained fields below.
 *
 * Three columns are bare `text not null default` with no CHECK: companies.business_development_stage
 * (:112), contacts.contact_status (:131), and jobs.priority (:255). Two of them are still narrowed
 * OPTIMISTICALLY -- JobPriority and ContactStatus -- because a form is their only writer and it
 * offers a closed list (contact_status: RecordDetailPages.tsx:19 offers exactly three options).
 * Their maps must therefore survive an unrecognised value at runtime, which lookup() handles.
 * business_development_stage is the third, and is narrowed for a different reason: the column has no
 * CHECK, but set_company_bd_stage validates the list and is now the only path both writers take, so
 * the union is enforced at the door rather than by the schema.
 */
export type JobStatus='draft'|'open'|'on_hold'|'filled'|'cancelled'|'closed'
export type JobPriority='low'|'normal'|'high'|'urgent' /* NOT db-constrained; see lookup() */
export type AccountStatus='prospect'|'active_client'|'inactive'|'do_not_contact'
/* No CHECK on the column, but set_company_bd_stage (20260719000000 :110) rejects anything outside this
 * list, and the board and the edit form now both write through it -- so this union is enforced at the
 * only two doors, even though the column itself would still accept anything an import wrote. */
export type BusinessDevelopmentStage='lead'|'qualifying'|'pitching'|'negotiating'|'won'|'lost'|'dormant'
export type ContactStatus='active'|'inactive'|'do_not_contact' /* NOT db-constrained; see lookup() */
export type CandidateStatus='active'|'passive'|'placed'|'do_not_contact'|'archived'
export type OfferStatus='draft'|'presented'|'accepted'|'declined'|'withdrawn'
export type InterviewStatus='scheduled'|'completed'|'cancelled'|'no_show'
// What a client answered on a submitted candidate, per submission_feedback.decision's check constraint.
export type FeedbackDecision='approve'|'reject'|'interview'|'hold'
export type SubmissionPackageStatus='draft'|'shared'|'reviewed'|'closed'

/* One candidate, sent to one client, as the cross-job Delivery Workbench sees it.
 *
 * Mirrors list_delivery_workbench exactly. The grain is the candidate_submission, not the package: a
 * shortlist of four is four conversations with the client, who can approve one and say nothing about
 * the other three, so a package-grained row would have to invent one state for four answers.
 *
 * `delivery_state` and `delivery_priority` are DERIVED in SQL on every read and never stored -- see
 * public.submission_delivery_state. Nothing in this shape may be treated as a second status that
 * could contradict the submission, the link, the email delivery or the feedback it is computed from.
 */
export type DeliveryWorkbenchRow={
  candidate_submission_id:string
  package_id:string
  job_id:string
  job_candidate_id:string
  candidate_id:string|null
  candidate_name:string|null
  job_title:string|null
  company_name:string|null
  package_title:string|null
  sent_at:string
  recipient_email:string|null
  link_id:string|null
  link_expires_at:string|null
  link_revoked_at:string|null
  opened_at:string|null
  email_delivery_id:string|null
  email_status:string|null
  email_error:string|null
  feedback_id:string|null
  feedback_decision:FeedbackDecision|null
  feedback_at:string|null
  handled_at:string|null
  owner_member_id:string|null
  owner_name:string|null
  delivery_state:string
  delivery_priority:number
  total_count:number
}
export type PlacementStatus='confirmed'|'started'|'failed_guarantee'|'completed'|'cancelled'
export type InvoiceStatus='not_issued'|'draft'|'issued'|'overdue'|'paid'|'void'
export type TaskStatus='open'|'in_progress'|'completed'|'cancelled'
export type TaskPriority='low'|'normal'|'high'|'urgent'
export type ImportStatus='staged'|'validating'|'ready'|'approved'|'committing'|'completed'|'failed'|'rolled_back'
export type CalendarSyncStatus='not_requested'|'pending'|'synced'|'failed'|'cancelled'
export type CalendarConnectionStatus='connected'|'reauthorization_required'|'disconnected'|'error'
export type DeliveryStatus='pending'|'sent'|'delivered'|'failed'|'bounced'|'suppressed'
export type MemberStatus='invited'|'active'|'suspended'
export type PilotStatus='preparing'|'uat'|'pilot'|'active'|'suspended'|'closed'
/* Mirrors the inline union on CandidateProfileVersion in features/candidates/candidateProfile.ts
 * (20260716050000_evidence_candidate_profiles.sql:40). Declared here because shared/lib/status.ts
 * must not import from features/. */
export type ProfileStatus='draft'|'finalized'|'failed'
export type PipelinePhaseKey='sourcing'|'screening'|'shortlist'|'client_review'|'interview'|'offer'|'placed'|'other'
/* Re-exported by features/workflow/workflow.ts, which is where it is produced. Declared here for the
 * same reason as ProfileStatus: shared/lib/status.ts owns its wording and must not import features/. */
export type TodayWorkKind='blocked'|'overdue'|'today'|'upcoming'|'recommended'

export type Organization = { id: string; name: string; slug: string; base_currency: string; salary_period?: 'annual'|'monthly'; timezone: string; pilot_status: PilotStatus; primary_color?:string;logo_path?:string|null;logo_url?:string|null;migration_complete?:boolean;profile_footer_banner_path?:string|null;profile_footer_banner_url?:string|null;profile_enabled?:boolean;whatsapp_country_code?:string|null;whatsapp_template?:string|null }
export type Membership = { id: string; organization_id: string; user_id?:string; status: MemberStatus; organizations: Organization }
export type Candidate = {
  id: string; organization_id: string; full_name: string; current_company: string | null; current_position: string | null;
  location: string | null; linkedin_url: string | null; status: CandidateStatus; source: string | null; availability: string | null;
  owner_member_id: string | null; created_at: string; updated_at?: string; candidate_private_details?: CandidatePrivate | CandidatePrivate[] | null
}
/* What is happening with a candidate, as opposed to who they are. Produced by search_candidates_page
 * so the list can answer "when did we last touch this, what is owed, where are they" without a
 * second query per row -- and so the preview pane can stay fed entirely from the row it already has.
 *
 * Every field here is nullable for a reason beyond "no data": the RPC is security invoker, so a
 * member holding candidates.read but not jobs.read / tasks.read / activities.read gets nulls in the
 * corresponding columns rather than another team's data. Treat null as "not visible or not set",
 * never as "definitely none". */
export interface CandidateWorkflowSignals {
  /** Latest activities.occurred_at. candidates.last_contacted_at is NOT used -- nothing writes it. */
  last_activity_at:string|null
  /** Earliest open task with a due date. Null means nothing is scheduled, which the list states. */
  next_task_at:string|null
  next_task_title:string|null
  /** Open pipelines. Lets the UI say "Acme -- Interview +2 more" from one row. */
  open_job_count:number
  /** The most recently updated OPEN job_candidate; open_job_count carries the rest. */
  primary_job_id:string|null
  primary_job_title:string|null
  primary_stage_name:string|null
  primary_phase_key:PipelinePhaseKey|null
  /** From stage_history, falling back to when they joined the pipeline. Drives days-in-stage. */
  primary_stage_entered_at:string|null
  has_cv:boolean
}
/* The data-quality gaps on one record, as public.candidate_quality_issues derived them on this read.
 *
 * Never stored, and never a score: a persisted number drifts from the record the moment anyone edits
 * it, and it says a record is worse without saying what is wrong. `missing_contact_method` is absent
 * entirely for a member without candidates_private.read -- an absence you are not allowed to see is
 * not an absence you can report -- so an empty array does NOT mean the record is complete for
 * everybody, only for this reader. */
export type CandidateQualityIssues={quality_issue_codes:string[]}
export type CandidateSearchRow=Candidate&CandidateWorkflowSignals&CandidateQualityIssues&{owner_name:string|null;tag_names:string[];skill_names:string[];total_count:number}
export type CandidatePrivate = { email: string | null; phone: string | null; current_salary: number | null; expected_salary: number | null; salary_currency: string | null; work_authorization?:string|null;legal_hold?:boolean }
export type Company = { id: string; organization_id: string; name: string; industry: string | null; location: string | null; website: string | null; account_status: AccountStatus; business_development_stage: string; updated_at: string }
/* One company as the BD board sees it. Mirrors list_company_pipeline exactly -- the aggregation is
 * done in the database so the board cannot disagree with the records it summarises. */
export type CompanyPipelineRow = {
  id:string;name:string;industry:string|null;location:string|null;account_status:AccountStatus
  business_development_stage:string;owner_member_id:string|null;owner_name:string|null
  contact_count:number;open_jobs:number;active_candidates:number
  next_follow_up_at:string|null;last_activity_at:string|null;placements:number
  terms_status:'none'|'active'|'expired';fee_type:string|null;fee_percentage:number|null;fixed_fee:number|null
  currency:string|null;guarantee_days:number|null;terms_effective_to:string|null
  expected_open_fee:number;updated_at:string
}
export type SavedViewResource='candidates'|'jobs'|'clients'
export type SavedView = {
  id:string;organization_id:string;owner_member_id:string;resource:SavedViewResource;name:string
  filters:Record<string,unknown>;is_shared:boolean;is_default:boolean;updated_at:string
}

/* A Talent List: the people somebody chose, as opposed to the people a query returned.
 *
 * Deliberately shaped nothing like SavedView above, because the two must never be mistaken for each
 * other. A saved view stores FILTERS and re-answers its question on every load; a list stores
 * MEMBERSHIP and answers nothing -- it only changes when a person changes it. The day they share a
 * type is the day somebody "unifies" them and a shortlist starts rewriting itself.
 *
 * `member_count` is what the CALLER can see rather than what the list holds, because the count comes
 * back through the same RLS the membership rows do. */
export type CandidateListVisibility='private'|'workspace'
export type CandidateList = {
  id:string;organization_id:string;owner_member_id:string;owner_name:string|null
  name:string;description:string|null;visibility:CandidateListVisibility;member_count:number
  created_at:string;updated_at:string;archived_at:string|null
}
/** Which lists one candidate is on, among those the caller may see. */
export type CandidateListMembership={list_id:string;name:string;visibility:CandidateListVisibility}
/* What a bulk membership write actually did. Two numbers rather than a boolean, for the reason
 * runBulk exists: "12 added, 3 already there" is information, and a single "done" covering both is
 * what makes people re-check by hand. */
export type CandidateListWriteResult={added:number;skipped:number}
export type CandidateListRemoveResult={removed:number;skipped:number}

export type Contact = { id: string; organization_id: string; company_id: string; full_name: string; position: string | null; email: string | null; phone: string | null; contact_status: ContactStatus; next_follow_up_at: string | null; companies?: Pick<Company,'id'|'name'> | null }
export type Job = { id: string; organization_id: string; company_id: string; pipeline_id: string | null; title: string; location: string | null; priority: JobPriority; status: JobStatus; employment_type?: string | null; currency: string | null; salary_min?:number|null;salary_max?:number|null;placement_fee_percentage: number | null;fixed_fee?:number|null;description?:string|null;requirements?:string|null;owner_member_id:string|null; opened_at: string | null; updated_at: string; companies?: Pick<Company,'id'|'name'> | null }
export type JobHealth={id:string;company_id:string;pipeline_id:string;title:string;company_name:string;location:string|null;priority:JobPriority;status:JobStatus;owner_member_id:string|null;owner_name:string|null;opened_at:string|null;days_open:number;candidate_count:number;waiting_count:number;phase_counts:Record<string,number>;salary_min:number|null;salary_max:number|null;currency:string|null;fee_percentage:number|null;fixed_fee:number|null;expected_fee:number|null;fee_source:string|null;next_action:string|null;last_activity_at:string|null;already_in_job:boolean;updated_at:string}
export type PipelineStage = { id: string; pipeline_id: string; name: string; stage_key: string; stage_type: string; phase_key:PipelinePhaseKey|null; position: number; color: string | null }
export type JobCandidate = { id: string; job_id: string; candidate_id: string; current_stage_id: string; updated_at: string; candidates?: Candidate | null; pipeline_stages?: PipelineStage | null; stage_history?: Array<{occurred_at:string;note?:string|null;to_stage_id?:string}> }
export type CandidatePipelineAssignment={id:string;job_id:string;candidate_id:string;current_stage_id:string;added_at:string;updated_at:string;jobs:{id:string;title:string;companies:{name:string}|null;organization_members:{profiles:{full_name:string|null;email:string|null}|null}|null}|null;pipeline_stages:PipelineStage|null;stage_history:Array<{occurred_at:string;to_stage_id:string}>}
export type TaskLink={candidate_id:string|null;company_id:string|null;contact_id:string|null;job_id:string|null;candidates?:{full_name:string}|null;companies?:{name:string}|null;contacts?:{full_name:string}|null;jobs?:{title:string}|null}
export type Task = { id: string; title: string; description: string | null; status: TaskStatus; priority: TaskPriority; due_at: string | null; owner_member_id: string | null; created_at: string;organization_members?:{profiles?:{full_name:string|null;email:string|null}|null}|null;task_links?:TaskLink[] }
export type RevenueSplit={id:string;member_id:string;split_percentage:number;split_amount:number|null;organization_members?:{profiles?:{full_name:string|null;email:string|null}|null}|null}
export type PlacementInvoice={id:string;invoice_reference:string|null;amount:number;currency:string;issued_on:string|null;due_on:string|null;status:InvoiceStatus;paid_on:string|null}
export type Placement = { id: string; job_candidate_id:string; candidate_id: string; job_id: string; company_id: string; start_date: string; salary: number; placement_fee: number; currency: string; guarantee_ends_on: string; status: PlacementStatus; candidates?: Pick<Candidate,'full_name'> | null; jobs?: Pick<Job,'title'> | null; companies?: Pick<Company,'name'> | null;placement_revenue_splits?:RevenueSplit[];placement_invoices?:PlacementInvoice[] }
export type Interview = {id:string;job_candidate_id:string;interview_type:string|null;stage_label:string|null;starts_at:string;ends_at:string;timezone:string;location:string|null;meeting_url:string|null;notes?:string|null;status:InterviewStatus;organizer_member_id:string|null;attendee_emails:string[];create_google_meet:boolean;calendar_event_id:string|null;calendar_event_url:string|null;calendar_sync_status:CalendarSyncStatus;calendar_last_error:string|null;calendar_last_synced_at:string|null;calendar_retry_count:number;calendar_sync_version:number;calendar_synced_version:number;cancellation_delivery_issues?:number;job_candidates?:{candidate_id?:string;candidates?:Pick<Candidate,'id'|'full_name'>|null;jobs?:Pick<Job,'id'|'title'|'owner_member_id'>|null}|null}
export type Offer = {id:string;job_candidate_id:string;salary:number;currency:string;offered_at:string;start_date:string|null;status:OfferStatus;notes:string|null;job_candidates?:{candidate_id?:string;candidates?:Pick<Candidate,'id'|'full_name'>|null;jobs?:Pick<Job,'id'|'title'|'owner_member_id'>|null}|null}

export interface WorkspaceCapabilities {roleKeys:string[];canWriteCandidates:boolean;canWriteClients:boolean;canWriteJobs:boolean;canMovePipeline:boolean;canSubmit:boolean;canManageInterviews:boolean;canManageOffers:boolean;canManagePlacements:boolean;canManageCommercialTerms:boolean;canViewTeamReports:boolean;canManageFinance:boolean;canImport:boolean;canManageOrganization:boolean;canManageWorkspace:boolean;canManageTemplates:boolean;canViewAdmin:boolean;readOnly:boolean}
export type PublicReview = { package: { id:string; title:string; message:string|null; job_title:string; company_name:string; recipient_name:string|null; expires_at:string }; branding?:{organization_name:string;primary_color:string|null;logo_path:string|null;salary_period?:'annual'|'monthly'|null}|null; candidates: PublicSubmission[];documents?:Array<{id:string;filename:string;mimeType:string;url:string}> }
export type PublicSubmission = { submission_id:string; candidate_name:string; current_company:string|null; current_position:string|null; location:string|null; linkedin_url:string|null; portfolio_url:string|null; candidate_summary:string; recruiter_comments:string|null; suitability_assessment:string|null; relevant_experience:string|null; expected_salary:number|null; currency:string|null; notice_period:string|null; availability:string|null; motivation:string|null; relocation_willingness:string|null; interview_availability:string|null; feedback:{decision:string;comments:string|null;reviewer_name:string|null;updated_at:string}|null }


// 'note' is written by capture_prospect (the browser extension's note field) and is not offered in
// the manual composer -- a note typed inside the app is an 'other' activity.
export type ActivityType='call'|'email'|'whatsapp'|'meeting'|'interview'|'status_change'|'submission'|'client_feedback'|'placement'|'note'|'other'
export type Activity={id:string;activity_type:ActivityType;direction:'inbound'|'outbound'|'internal'|null;subject:string|null;summary:string;occurred_at:string;created_by:string;actor_name_snapshot?:string|null;profiles?:{full_name?:string|null}|null}

export type TeamMember={id:string;organization_id:string;user_id:string;job_title:string|null;status:MemberStatus;is_vendor_support:boolean;profiles:{full_name?:string;email?:string}|null;member_roles?:Array<{roles:{id:string;name:string;role_key:string}|null}>}
export type Role={id:string;name:string;role_key:string;is_system:boolean;role_permissions?:Array<{permission_key:string}>}
export type EmailDeliverySummary={id:string;status:DeliveryStatus;error_message:string|null}
export type OrganizationInvitation={id:string;email:string;role_id:string;expires_at:string;accepted_at:string|null;revoked_at:string|null;delivery_status:DeliveryStatus;last_sent_at:string|null;roles?:{name:string}|null;email_delivery?:EmailDeliverySummary|null}
export type CalendarConnection={id:string;organization_id:string;member_id:string;google_email:string;calendar_id:string;status:CalendarConnectionStatus;connected_at:string;last_synced_at:string|null;last_error:string|null}
export type CandidateDocument={id:string;file_name:string;original_filename:string|null;mime_type:string;document_type:string;storage_path:string;size_bytes:number;created_at:string;deleted_at?:string|null;signedUrl?:string}
export type CandidateDetail=Candidate&{updated_at:string;portfolio_url:string|null;notice_period_days:number|null;last_contacted_at:string|null;deleted_at:string|null;candidate_private_details?:CandidatePrivate|CandidatePrivate[]|null;candidate_employment?:Array<{id:string;company_name:string;title:string;started_on:string|null;ended_on:string|null;started_on_precision:string|null;ended_on_precision:string|null;is_current:boolean;summary:string|null}>;candidate_education?:Array<{id:string;institution:string;degree:string|null;field_of_study:string|null;started_on:string|null;ended_on:string|null;started_on_precision:string|null;ended_on_precision:string|null}>;candidate_languages?:Array<{id:string;language:string;proficiency:string|null}>;candidate_skills?:Array<{skill_id:string;proficiency:string|null;years_experience:number|null;skills:{id:string;name:string}|null}>;candidate_tags?:Array<{tag_id:string;tags:{id:string;name:string;color:string|null}|null}>}
export type ImportBatch={id:string;entity_type:string;file_name:string;source_format:string|null;status:ImportStatus;total_rows:number;valid_rows:number;failed_rows:number;validation_summary:Record<string,unknown>;reconciliation_summary:Record<string,unknown>;created_at:string;completed_at:string|null;rolled_back_at:string|null}
