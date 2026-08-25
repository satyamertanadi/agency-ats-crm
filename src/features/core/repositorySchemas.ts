import {z} from 'zod'

// Row-shape schemas for repository.ts's highest-traffic reads (X1, F17 -- see docs/audit/findings.md).
// These mirror shared/types/domain.ts field-for-field; they exist purely to validate at the network
// boundary via rows(), not to replace the domain types. bigint-returning RPC columns (total_count,
// candidate_count, waiting_count) use z.coerce.number() rather than z.number(): Postgres bigint can
// exceed Number.MAX_SAFE_INTEGER, so Supabase's own tooling treats it as string-or-number depending on
// path, and the repository already defensively wraps one of these in Number(...) for that reason.
const candidateStatus=z.enum(['active','passive','placed','do_not_contact','archived'])
const jobStatus=z.enum(['draft','open','on_hold','filled','cancelled','closed'])
const jobPriority=z.enum(['low','normal','high','urgent'])
const phaseKey=z.enum(['sourcing','screening','shortlist','client_review','interview','offer','placed','other'])

// candidate_private_details has no unique constraint on candidate_id (verified against production:
// candidate_private_details_candidate_id_fkey carries no unique index), so PostgREST embeds it with
// to-many cardinality -- it can arrive as an array, a bare object, or null, and every existing
// consumer (CandidateDetailPage.tsx, candidateProfileDetails.ts, JobCandidatePanel.tsx, candidateCsv.ts)
// already defensively unwraps both shapes. This schema preserves that same union rather than
// normalizing it away, so none of those call sites need to change.
const candidatePrivateSchema=z.object({
  email:z.string().nullable(),phone:z.string().nullable(),current_salary:z.number().nullable(),
  expected_salary:z.number().nullable(),salary_currency:z.string().nullable(),
  legal_hold:z.boolean().optional(),
})
const candidatePrivateEmbed=z.union([candidatePrivateSchema,z.array(candidatePrivateSchema)]).nullable().optional()

export const candidateSchema=z.object({
  id:z.string(),organization_id:z.string(),full_name:z.string(),current_company:z.string().nullable(),
  current_position:z.string().nullable(),location:z.string().nullable(),linkedin_url:z.string().nullable(),
  status:candidateStatus,source:z.string().nullable(),availability:z.string().nullable(),
  owner_member_id:z.string().nullable(),created_at:z.string(),updated_at:z.string().optional(),
  candidate_private_details:candidatePrivateEmbed,
})

/* The workflow half of the row. This schema has no .passthrough(), so anything the RPC returns and
 * this object does not declare is silently STRIPPED before it reaches React -- which is why the
 * columns have to be listed here as well as in the type, and also why adding columns to the RPC is
 * safe to deploy ahead of the frontend. */
export const candidateSearchRowSchema=candidateSchema.omit({candidate_private_details:true}).extend({
  owner_name:z.string().nullable(),
  tag_names:z.array(z.string()),skill_names:z.array(z.string()),total_count:z.coerce.number(),
  last_activity_at:z.string().nullable(),
  next_task_at:z.string().nullable(),next_task_title:z.string().nullable(),
  open_job_count:z.coerce.number(),
  primary_job_id:z.string().nullable(),primary_job_title:z.string().nullable(),
  primary_stage_name:z.string().nullable(),primary_phase_key:phaseKey.nullable(),
  primary_stage_entered_at:z.string().nullable(),
  has_cv:z.boolean(),
  /* z.string() rather than an enum: the rules live in SQL, and a server that gains one before the
   * client learns about it should render an unfamiliar chip, not fail the whole list. Defaulted
   * because this column postdates the schema -- a client deployed ahead of the migration reads an
   * empty issue set rather than throwing. */
  quality_issue_codes:z.array(z.string()).default([]),
})

const companyPick=z.object({id:z.string(),name:z.string()}).nullable().optional()

export const jobSchema=z.object({
  id:z.string(),organization_id:z.string(),company_id:z.string(),pipeline_id:z.string().nullable(),
  title:z.string(),location:z.string().nullable(),priority:jobPriority,status:jobStatus,
  currency:z.string().nullable(),salary_min:z.number().nullable().optional(),salary_max:z.number().nullable().optional(),
  placement_fee_percentage:z.number().nullable(),fixed_fee:z.number().nullable().optional(),
  description:z.string().nullable().optional(),requirements:z.string().nullable().optional(),
  owner_member_id:z.string().nullable(),opened_at:z.string().nullable(),updated_at:z.string(),
  companies:companyPick,
})

export const jobHealthSchema=z.object({
  id:z.string(),company_id:z.string(),pipeline_id:z.string(),title:z.string(),company_name:z.string(),
  location:z.string().nullable(),priority:jobPriority,status:jobStatus,owner_member_id:z.string().nullable(),
  owner_name:z.string().nullable(),opened_at:z.string().nullable(),days_open:z.number(),
  candidate_count:z.coerce.number(),waiting_count:z.coerce.number(),phase_counts:z.record(z.string(),z.number()),
  salary_min:z.number().nullable(),salary_max:z.number().nullable(),currency:z.string().nullable(),
  fee_percentage:z.number().nullable(),fixed_fee:z.number().nullable(),expected_fee:z.number().nullable(),
  fee_source:z.string().nullable(),next_action:z.string().nullable(),last_activity_at:z.string().nullable(),
  already_in_job:z.boolean(),updated_at:z.string(),
})

// getPipeline() selects pipeline_stages with `select('*')`, which also returns organization_id and
// is_client_visible -- neither is part of PipelineStage, so .passthrough() keeps them on the parsed
// row instead of a plain z.object() silently stripping them (nothing reads them today, but a future
// caller that does shouldn't discover they were quietly dropped by this validator).
export const pipelineStageSchema=z.object({
  id:z.string(),pipeline_id:z.string(),name:z.string(),stage_key:z.string(),stage_type:z.string(),
  phase_key:phaseKey.nullable(),position:z.number(),color:z.string().nullable(),
}).passthrough()

// job_candidates' own embeds (candidates, pipeline_stages) are the forward direction of their FK --
// job_candidates.candidate_id -> candidates.id and .current_stage_id -> pipeline_stages.id -- so
// PostgREST always returns these as a single object or null, never an array.
const jobCandidateCandidate=z.object({
  id:z.string(),organization_id:z.string(),full_name:z.string(),current_company:z.string().nullable(),
  current_position:z.string().nullable(),location:z.string().nullable(),linkedin_url:z.string().nullable(),
  status:candidateStatus,source:z.string().nullable(),availability:z.string().nullable(),
  owner_member_id:z.string().nullable(),created_at:z.string(),
}).nullable().optional()

export const jobCandidateSchema=z.object({
  id:z.string(),job_id:z.string(),candidate_id:z.string(),current_stage_id:z.string(),updated_at:z.string(),
  candidates:jobCandidateCandidate,pipeline_stages:pipelineStageSchema.nullable().optional(),
  // note/to_stage_id ride along so the outcomes drawer can say WHY a candidate closed without a
  // second query per row -- the embed is already ordered occurred_at desc, so [0] is the latest move.
  stage_history:z.array(z.object({occurred_at:z.string(),note:z.string().nullable().optional(),to_stage_id:z.string().optional()})).optional(),
})

// companies selects `*`, which also carries company_size/created_at/created_by/deleted_at/
// notes_summary/owner_member_id/updated_by (verified against the generated Row type) -- none are on
// Company, so this passes them through rather than silently stripping them.
export const companySchema=z.object({
  id:z.string(),organization_id:z.string(),name:z.string(),industry:z.string().nullable(),
  location:z.string().nullable(),website:z.string().nullable(),account_status:z.string(),
  business_development_stage:z.string(),updated_at:z.string(),
}).passthrough()

export const contactSchema=z.object({
  id:z.string(),organization_id:z.string(),company_id:z.string(),full_name:z.string(),
  position:z.string().nullable(),email:z.string().nullable(),phone:z.string().nullable(),
  contact_status:z.enum(['active','inactive','do_not_contact']),next_follow_up_at:z.string().nullable(),
  companies:companyPick,
})

const profilePick=(...fields:Array<'full_name'|'email'>)=>z.object(Object.fromEntries(fields.map((field)=>[field,z.string().nullable().optional()])))
const memberProfilePick=z.object({profiles:profilePick('full_name','email').nullable().optional()}).nullable().optional()

const taskLinkSchema=z.object({
  candidate_id:z.string().nullable(),company_id:z.string().nullable(),contact_id:z.string().nullable(),job_id:z.string().nullable(),
  candidates:z.object({full_name:z.string()}).nullable().optional(),
  companies:z.object({name:z.string()}).nullable().optional(),
  contacts:z.object({full_name:z.string()}).nullable().optional(),
  jobs:z.object({title:z.string()}).nullable().optional(),
})

// tasks selects `*` plus two explicit embeds -- passthrough preserves completed_at/created_by/
// deleted_at/organization_id (present on the table, not on Task) exactly as before.
export const taskSchema=z.object({
  id:z.string(),title:z.string(),description:z.string().nullable(),
  status:z.enum(['open','in_progress','completed','cancelled']),priority:z.enum(['low','normal','high','urgent']),
  due_at:z.string().nullable(),owner_member_id:z.string().nullable(),created_at:z.string(),
  organization_members:memberProfilePick,task_links:z.array(taskLinkSchema).optional(),
}).passthrough()

// The select also carries `activity_links!inner(...)` purely as an inner-join filter -- Activity
// never declares that field and nothing reads it, so letting a plain z.object() drop it matches
// the existing (data as unknown as Activity[]) cast's own effective behaviour.
export const activitySchema=z.object({
  id:z.string(),activity_type:z.enum(['call','email','whatsapp','meeting','interview','status_change','submission','client_feedback','placement','other']),
  direction:z.enum(['inbound','outbound','internal']).nullable(),subject:z.string().nullable(),summary:z.string(),
  occurred_at:z.string(),created_by:z.string(),actor_name_snapshot:z.string().nullable().optional(),
  profiles:profilePick('full_name').nullable().optional(),
})

const revenueSplitSchema=z.object({
  id:z.string(),member_id:z.string(),split_percentage:z.number(),split_amount:z.number().nullable(),
  organization_members:memberProfilePick,
})
const placementInvoiceSchema=z.object({
  id:z.string(),invoice_reference:z.string().nullable(),amount:z.number(),currency:z.string(),
  issued_on:z.string().nullable(),due_on:z.string().nullable(),
  status:z.enum(['not_issued','draft','issued','overdue','paid','void']),paid_on:z.string().nullable(),
})
export const placementSchema=z.object({
  id:z.string(),job_candidate_id:z.string(),candidate_id:z.string(),job_id:z.string(),company_id:z.string(),
  start_date:z.string(),salary:z.number(),placement_fee:z.number(),currency:z.string(),
  guarantee_ends_on:z.string(),status:z.enum(['confirmed','started','failed_guarantee','completed','cancelled']),
  candidates:z.object({full_name:z.string()}).nullable().optional(),
  jobs:z.object({title:z.string()}).nullable().optional(),
  companies:z.object({name:z.string()}).nullable().optional(),
  placement_revenue_splits:z.array(revenueSplitSchema).optional(),
  placement_invoices:z.array(placementInvoiceSchema).optional(),
})

const jobCandidateLinkPick=z.object({
  candidate_id:z.string().optional(),
  candidates:z.object({id:z.string(),full_name:z.string()}).nullable().optional(),
  jobs:z.object({id:z.string(),title:z.string(),owner_member_id:z.string().nullable()}).nullable().optional(),
}).nullable().optional()

export const interviewSchema=z.object({
  id:z.string(),job_candidate_id:z.string(),interview_type:z.string().nullable(),stage_label:z.string().nullable(),
  starts_at:z.string(),ends_at:z.string(),timezone:z.string(),location:z.string().nullable(),
  // `notes` is where completeInterview records the outcome, so it has to be read back -- a note the
  // product writes and never shows is the same as not having captured it.
  meeting_url:z.string().nullable(),notes:z.string().nullable().optional(),status:z.enum(['scheduled','completed','cancelled','no_show']),
  organizer_member_id:z.string().nullable(),attendee_emails:z.array(z.string()),create_google_meet:z.boolean(),
  calendar_event_id:z.string().nullable(),calendar_event_url:z.string().nullable(),
  calendar_sync_status:z.enum(['not_requested','pending','synced','failed','cancelled']),
  calendar_last_error:z.string().nullable(),calendar_last_synced_at:z.string().nullable(),
  calendar_retry_count:z.number(),calendar_sync_version:z.number(),calendar_synced_version:z.number(),
  job_candidates:jobCandidateLinkPick,
})

export const offerSchema=z.object({
  id:z.string(),job_candidate_id:z.string(),salary:z.number(),currency:z.string(),offered_at:z.string(),
  start_date:z.string().nullable(),status:z.enum(['draft','presented','accepted','declined','withdrawn']),
  notes:z.string().nullable(),job_candidates:jobCandidateLinkPick,
})

const publicSubmissionSchema=z.object({
  submission_id:z.string(),candidate_name:z.string(),current_company:z.string().nullable(),
  current_position:z.string().nullable(),location:z.string().nullable(),linkedin_url:z.string().nullable(),
  portfolio_url:z.string().nullable(),candidate_summary:z.string(),recruiter_comments:z.string().nullable(),
  suitability_assessment:z.string().nullable(),relevant_experience:z.string().nullable(),
  expected_salary:z.number().nullable(),currency:z.string().nullable(),notice_period:z.string().nullable(),
  availability:z.string().nullable(),motivation:z.string().nullable(),relocation_willingness:z.string().nullable(),
  interview_availability:z.string().nullable(),
  feedback:z.object({decision:z.string(),comments:z.string().nullable(),reviewer_name:z.string().nullable(),updated_at:z.string()}).nullable(),
})
// Shape of resolve_submission_link()'s jsonb result (supabase/migrations/20260726070000_atomic_rate_
// limits.sql), plus the `documents` array the public-review edge function appends on top.
export const publicReviewSchema=z.object({
  package:z.object({id:z.string(),title:z.string(),message:z.string().nullable(),job_title:z.string(),company_name:z.string(),recipient_name:z.string().nullable(),expires_at:z.string()}),
  branding:z.object({organization_name:z.string(),primary_color:z.string().nullable(),logo_path:z.string().nullable(),salary_period:z.enum(['annual','monthly']).nullable().optional()}).nullable().optional(),
  candidates:z.array(publicSubmissionSchema),
  documents:z.array(z.object({id:z.string(),filename:z.string(),mimeType:z.string(),url:z.string()})).optional(),
})

// jobs(id,title,companies(name)) / organization_members(profiles(full_name,email)) are all forward-FK
// singular embeds; stage_history is the backward direction (many stage_history rows per job_candidate)
// so it stays an array, matching CandidatePipelineAssignment.
export const candidatePipelineAssignmentSchema=z.object({
  id:z.string(),job_id:z.string(),candidate_id:z.string(),current_stage_id:z.string(),added_at:z.string(),updated_at:z.string(),
  jobs:z.object({
    id:z.string(),title:z.string(),
    companies:z.object({name:z.string()}).nullable(),
    organization_members:z.object({profiles:z.object({full_name:z.string().nullable(),email:z.string().nullable()}).nullable()}).nullable(),
  }).nullable(),
  pipeline_stages:pipelineStageSchema.nullable(),
  stage_history:z.array(z.object({occurred_at:z.string(),to_stage_id:z.string()})),
})

/* stage_history has been written on every stage move since the initial schema and displayed nowhere,
 * so "why is this candidate in Rejected?" had no answer in the product even though the answer was
 * stored. The stage names are embedded twice under aliases because a row is only readable as
 * "from X to Y" -- resolving them client-side against the stages list breaks the moment a stage is
 * renamed or removed, which is exactly when the history matters most. */
export const stageHistoryEntrySchema=z.object({
  id:z.string(),occurred_at:z.string(),note:z.string().nullable(),source:z.string(),
  from_stage:z.object({name:z.string(),stage_type:z.string()}).nullable(),
  to_stage:z.object({name:z.string(),stage_type:z.string()}).nullable(),
})

/* The client's actual answer. `check_feedback` rendered a static sentence telling the consultant to
 * "review recent activity" while these rows sat unread in the table the public review page writes. */
export const submissionFeedbackSchema=z.object({
  id:z.string(),decision:z.enum(['approve','reject','interview','hold']),comments:z.string().nullable(),
  reviewer_name:z.string().nullable(),created_at:z.string(),
})

/* Inferred rather than restated in domain.ts: both shapes exist only as the result of one query each,
 * so a hand-written type would be a second declaration that can drift from the parser that validates
 * it. */
export type StageHistoryEntry=z.infer<typeof stageHistoryEntrySchema>
export type SubmissionFeedback=z.infer<typeof submissionFeedbackSchema>

/* One row of the cross-job Delivery Workbench, validated at the network boundary.
 *
 * Every column the SQL can return null for is nullable here, and that is not defensive padding: the
 * RPC is security invoker, so a member holding submissions.read but not candidates.read gets the row
 * with a null candidate name rather than an error -- knowing a shortlist is failing is useful even
 * when the person in it is not visible. A schema that demanded those columns would turn a permission
 * degradation into a broken screen.
 *
 * `delivery_state` is deliberately z.string() rather than an enum. The ladder lives in SQL, and a
 * server that gains an arm before the client learns about it should render an unfamiliar label, not
 * fail the whole page -- see deliveryStateDefinition for the other half of that contract. */
export const deliveryWorkbenchRowSchema=z.object({
  candidate_submission_id:z.string(),package_id:z.string(),job_id:z.string(),job_candidate_id:z.string(),
  candidate_id:z.string().nullable(),candidate_name:z.string().nullable(),
  job_title:z.string().nullable(),company_name:z.string().nullable(),package_title:z.string().nullable(),
  sent_at:z.string(),recipient_email:z.string().nullable(),
  link_id:z.string().nullable(),link_expires_at:z.string().nullable(),link_revoked_at:z.string().nullable(),
  opened_at:z.string().nullable(),
  email_delivery_id:z.string().nullable(),email_status:z.string().nullable(),email_error:z.string().nullable(),
  feedback_id:z.string().nullable(),feedback_decision:z.enum(['approve','reject','interview','hold']).nullable(),
  feedback_at:z.string().nullable(),handled_at:z.string().nullable(),
  owner_member_id:z.string().nullable(),owner_name:z.string().nullable(),
  delivery_state:z.string(),delivery_priority:z.coerce.number(),
  // bigint from count(*) over(), for the reason stated at the top of this file.
  total_count:z.coerce.number(),
})

/* One row of candidate_quality_summary. `candidate_count` is a bigint from count(*), coerced for the
 * reason stated at the top of this file. The code is a bare string, not an enum, so a rule the server
 * gains before the client does renders as itself rather than failing the strip. */
export const candidateQualityCountSchema=z.object({
  issue_code:z.string(),candidate_count:z.coerce.number(),
})
export type CandidateQualityCount=z.infer<typeof candidateQualityCountSchema>

/* One Talent List, as list_candidate_lists returns it.
 *
 * `visibility` IS an enum here, unlike delivery_state above, and the difference is what happens when
 * the server gains a value the client does not know. An unfamiliar delivery state is a label to
 * render; an unfamiliar visibility is a question about who can see something, and rendering a list as
 * "private" because a third value did not parse would be a guess about access. Failing loudly is the
 * right answer for the one field on this row that describes exposure.
 *
 * `member_count` is integer rather than bigint in SQL, but is coerced anyway for the reason at the
 * top of this file: PostgREST's numeric handling is the thing being defended against, not the width
 * of the column. */
export const candidateListSchema=z.object({
  id:z.string(),organization_id:z.string(),owner_member_id:z.string(),owner_name:z.string().nullable(),
  name:z.string(),description:z.string().nullable(),
  visibility:z.enum(['private','workspace']),member_count:z.coerce.number(),
  created_at:z.string(),updated_at:z.string(),archived_at:z.string().nullable(),
})
export const candidateListMembershipSchema=z.object({
  list_id:z.string(),name:z.string(),visibility:z.enum(['private','workspace']),
})
/* The two membership writes return a single row of counts. Validated like everything else crossing
 * the boundary: a toast that says "12 added" is a claim about what happened to the database, and it
 * should come from the database rather than from the length of the array the caller sent. */
export const candidateListWriteResultSchema=z.object({added:z.coerce.number(),skipped:z.coerce.number()})
export const candidateListRemoveResultSchema=z.object({removed:z.coerce.number(),skipped:z.coerce.number()})
/* The raw candidate_lists ROW, which is what the three write RPCs return -- they hand back the record
 * they just wrote, not the picker projection above, so it carries no owner_name and no member_count.
 * A separate schema rather than a loosened one: making those two optional on candidateListSchema
 * would let a picker row missing its count parse silently. */
export const candidateListRecordSchema=z.object({
  id:z.string(),organization_id:z.string(),owner_member_id:z.string(),
  name:z.string(),description:z.string().nullable(),
  visibility:z.enum(['private','workspace']),
  created_at:z.string(),updated_at:z.string(),archived_at:z.string().nullable(),
})
