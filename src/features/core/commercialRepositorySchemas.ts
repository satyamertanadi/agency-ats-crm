import {z} from 'zod'

// Row-shape schemas for commercialRepository.ts's reads (X1, F17 continued from repositorySchemas.ts).
// Same rules as there: field-for-field mirror of shared/types/domain.ts (or the feature-local type
// for candidate-profile shapes), .passthrough() wherever the underlying select is `*` or `(*)` so
// unmodelled columns survive validation instead of being silently stripped, and forward-FK embeds
// (the selecting table holds the FK) are singular while backward-FK embeds (the related table holds
// the FK back to what's selected) are arrays -- both directions already verified against production
// in the candidates/jobs/job_candidates rollout.
const memberStatus=z.enum(['invited','active','suspended'])
const profilePick=z.object({full_name:z.string().nullable().optional(),email:z.string().nullable().optional()}).nullable().optional()

export const teamMemberSchema=z.object({
  id:z.string(),organization_id:z.string(),user_id:z.string(),job_title:z.string().nullable(),
  status:memberStatus,is_vendor_support:z.boolean(),profiles:profilePick,
  member_roles:z.array(z.object({roles:z.object({id:z.string(),name:z.string(),role_key:z.string()}).nullable()})).optional(),
})

export const roleSchema=z.object({
  id:z.string(),name:z.string(),role_key:z.string(),is_system:z.boolean(),
  role_permissions:z.array(z.object({permission_key:z.string()})).optional(),
})

export const organizationInvitationSchema=z.object({
  id:z.string(),email:z.string(),role_id:z.string(),expires_at:z.string(),accepted_at:z.string().nullable(),
  revoked_at:z.string().nullable(),delivery_status:z.enum(['pending','sent','delivered','failed','bounced','suppressed']),
  last_sent_at:z.string().nullable(),roles:z.object({name:z.string()}).nullable().optional(),
})

export const calendarConnectionSchema=z.object({
  id:z.string(),organization_id:z.string(),member_id:z.string(),google_email:z.string(),calendar_id:z.string(),
  status:z.enum(['connected','reauthorization_required','disconnected','error']),connected_at:z.string(),
  last_synced_at:z.string().nullable(),last_error:z.string().nullable(),
  /* What Google actually granted, not what we asked for: incremental consent lets somebody approve
   * Calendar and decline transcript reading, and the UI must show the former, not the request. */
  scopes:z.array(z.string()),
})

export const companyPipelineRowSchema=z.object({
  id:z.string(),name:z.string(),industry:z.string().nullable(),location:z.string().nullable(),
  account_status:z.enum(['prospect','active_client','inactive','do_not_contact']),
  business_development_stage:z.string(),owner_member_id:z.string().nullable(),owner_name:z.string().nullable(),
  contact_count:z.coerce.number(),open_jobs:z.coerce.number(),active_candidates:z.coerce.number(),
  next_follow_up_at:z.string().nullable(),last_activity_at:z.string().nullable(),placements:z.coerce.number(),
  terms_status:z.enum(['none','active','expired']),fee_type:z.string().nullable(),fee_percentage:z.number().nullable(),
  fixed_fee:z.number().nullable(),currency:z.string().nullable(),guarantee_days:z.number().nullable(),
  terms_effective_to:z.string().nullable(),expected_open_fee:z.number(),updated_at:z.string(),
})

export const savedViewSchema=z.object({
  id:z.string(),organization_id:z.string(),owner_member_id:z.string(),
  resource:z.enum(['candidates','jobs','clients']),name:z.string(),filters:z.record(z.string(),z.unknown()),
  is_shared:z.boolean(),is_default:z.boolean(),updated_at:z.string(),
})

export const importBatchSchema=z.object({
  id:z.string(),entity_type:z.string(),file_name:z.string(),source_format:z.string().nullable(),
  status:z.enum(['staged','validating','ready','approved','committing','completed','failed','rolled_back']),
  total_rows:z.number(),valid_rows:z.number(),failed_rows:z.number(),
  validation_summary:z.record(z.string(),z.unknown()),reconciliation_summary:z.record(z.string(),z.unknown()),
  created_at:z.string(),completed_at:z.string().nullable(),rolled_back_at:z.string().nullable(),
})

// --- getCandidateDetail: candidates(*) plus five nested (*) / explicit-column child collections ---
const candidatePrivateDetailFullSchema=z.object({
  email:z.string().nullable(),phone:z.string().nullable(),current_salary:z.number().nullable(),
  expected_salary:z.number().nullable(),salary_currency:z.string().nullable(),
  work_authorization:z.string().nullable().optional(),
}).passthrough()
const candidateEmploymentSchema=z.object({
  id:z.string(),company_name:z.string(),title:z.string(),started_on:z.string().nullable(),ended_on:z.string().nullable(),
  started_on_precision:z.string().nullable(),ended_on_precision:z.string().nullable(),is_current:z.boolean(),
  summary:z.string().nullable(),
}).passthrough()
const candidateEducationSchema=z.object({
  id:z.string(),institution:z.string(),degree:z.string().nullable(),field_of_study:z.string().nullable(),
  started_on:z.string().nullable(),ended_on:z.string().nullable(),started_on_precision:z.string().nullable(),
  ended_on_precision:z.string().nullable(),
}).passthrough()
const candidateLanguageSchema=z.object({id:z.string(),language:z.string(),proficiency:z.string().nullable()}).passthrough()
const candidateSkillPickSchema=z.object({
  skill_id:z.string(),proficiency:z.string().nullable(),years_experience:z.number().nullable(),
  skills:z.object({id:z.string(),name:z.string()}).nullable(),
})
const candidateTagPickSchema=z.object({
  tag_id:z.string(),tags:z.object({id:z.string(),name:z.string(),color:z.string().nullable()}).nullable(),
})
export const candidateDetailSchema=z.object({
  id:z.string(),organization_id:z.string(),full_name:z.string(),current_company:z.string().nullable(),
  current_position:z.string().nullable(),location:z.string().nullable(),linkedin_url:z.string().nullable(),
  status:z.enum(['active','passive','placed','do_not_contact','archived']),source:z.string().nullable(),
  availability:z.string().nullable(),owner_member_id:z.string().nullable(),created_at:z.string(),updated_at:z.string(),
  portfolio_url:z.string().nullable(),notice_period_days:z.number().nullable(),last_contacted_at:z.string().nullable(),
  deleted_at:z.string().nullable(),
  candidate_private_details:z.union([candidatePrivateDetailFullSchema,z.array(candidatePrivateDetailFullSchema)]).nullable().optional(),
  candidate_employment:z.array(candidateEmploymentSchema).optional(),
  candidate_education:z.array(candidateEducationSchema).optional(),
  candidate_languages:z.array(candidateLanguageSchema).optional(),
  candidate_skills:z.array(candidateSkillPickSchema).optional(),
  candidate_tags:z.array(candidateTagPickSchema).optional(),
}).passthrough()

// --- listCandidateDocuments: validates the raw document_links(documents(...)) shape before the
// existing flatMap/Array.isArray normalization runs -- that logic is untouched, only what feeds it
// is now checked. ---
export const candidateDocumentSchema=z.object({
  id:z.string(),file_name:z.string(),original_filename:z.string().nullable(),mime_type:z.string(),
  storage_path:z.string(),size_bytes:z.number(),document_type:z.string(),created_at:z.string(),
  deleted_at:z.string().nullable().optional(),
})
export const documentLinkRowSchema=z.object({
  documents:z.union([candidateDocumentSchema,z.array(candidateDocumentSchema)]),
})

// --- listCandidateJobs: validates the raw job_candidates(jobs!inner(...)) rows before the existing
// .map/.filter transform runs. ---
export const candidateJobLinkRowSchema=z.object({
  jobs:z.object({id:z.string(),title:z.string(),deleted_at:z.string().nullable(),companies:z.object({name:z.string()}).nullable()}),
})

// --- listCandidateProfileVersions: validates the raw select before the existing .map extracts
// job/template/candidate picks and re-shapes the row into CandidateProfileVersion. ---
// --- listSubmissionCandidateDocuments: previously returned raw, untyped data -- both consumers
// (JobCandidatePanel.tsx, SubmissionsPage.tsx) each declared their own near-duplicate local interface
// and cast to it. Validating once here lets both drop that cast and use the inferred return type.
const submissionDocumentSchema=z.object({
  id:z.string(),file_name:z.string(),original_filename:z.string().nullable(),mime_type:z.string(),
  storage_path:z.string(),size_bytes:z.number(),created_at:z.string(),deleted_at:z.string().nullable(),
})
export const submissionCandidateDocumentRowSchema=z.object({
  id:z.string(),candidate_id:z.string(),
  candidates:z.object({
    id:z.string(),full_name:z.string(),current_company:z.string().nullable(),current_position:z.string().nullable(),
    /* Consent and status ride along so the composer can refuse to send a candidate who has not
     * agreed to be represented, without an N-query fan-out over getCandidateDetail. The embed is
     * to-many for the same reason documented on candidatePrivateEmbed, so it accepts both shapes. */
    status:z.string().optional(),availability:z.string().nullable().optional(),notice_period_days:z.number().nullable().optional(),
    candidate_private_details:z.union([
      z.object({expected_salary:z.number().nullable(),salary_currency:z.string().nullable()}),
      z.array(z.object({expected_salary:z.number().nullable(),salary_currency:z.string().nullable()})),
    ]).nullable().optional(),
    document_links:z.array(z.object({documents:z.union([submissionDocumentSchema,z.array(submissionDocumentSchema)]).nullable()})).optional(),
  }).nullable(),
})

export const candidateProfileVersionRowSchema=z.object({
  id:z.string(),version:z.number(),status:z.enum(['draft','finalized','failed']),candidate_id:z.string(),
  job_id:z.string(),template_id:z.string(),template_version:z.number(),generated_content:z.unknown(),
  reviewed_content:z.unknown(),input_versions:z.record(z.string(),z.unknown()),anonymized:z.boolean(),
  docx_document_id:z.string().nullable(),pdf_document_id:z.string().nullable(),created_at:z.string(),
  finalized_at:z.string().nullable(),
  jobs:z.object({title:z.string(),updated_at:z.string()}),
  templates:z.object({name:z.string(),version:z.number()}),
  candidates:z.object({updated_at:z.string()}),
})
