import {z} from 'zod'

// Row-shape schemas for repository.ts's highest-traffic reads (X1, F17 -- see docs/audit/findings.md).
// These mirror shared/types/domain.ts field-for-field; they exist purely to validate at the network
// boundary via rows(), not to replace the domain types. bigint-returning RPC columns (total_count,
// candidate_count, waiting_count) use z.coerce.number() rather than z.number(): Postgres bigint can
// exceed Number.MAX_SAFE_INTEGER, so Supabase's own tooling treats it as string-or-number depending on
// path, and the repository already defensively wraps one of these in Number(...) for that reason.
const candidateStatus=z.enum(['active','passive','placed','do_not_contact','archived'])
const consentStatus=z.enum(['unknown','requested','granted','withdrawn','expired'])
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
  expected_salary:z.number().nullable(),salary_currency:z.string().nullable(),consent_status:consentStatus,
})
const candidatePrivateEmbed=z.union([candidatePrivateSchema,z.array(candidatePrivateSchema)]).nullable().optional()

export const candidateSchema=z.object({
  id:z.string(),organization_id:z.string(),full_name:z.string(),current_company:z.string().nullable(),
  current_position:z.string().nullable(),location:z.string().nullable(),linkedin_url:z.string().nullable(),
  status:candidateStatus,source:z.string().nullable(),availability:z.string().nullable(),
  owner_member_id:z.string().nullable(),created_at:z.string(),updated_at:z.string().optional(),
  candidate_private_details:candidatePrivateEmbed,
})

export const candidateSearchRowSchema=candidateSchema.omit({candidate_private_details:true}).extend({
  consent_status:consentStatus.nullable(),owner_name:z.string().nullable(),
  tag_names:z.array(z.string()),skill_names:z.array(z.string()),total_count:z.coerce.number(),
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

export const pipelineStageSchema=z.object({
  id:z.string(),pipeline_id:z.string(),name:z.string(),stage_key:z.string(),stage_type:z.string(),
  phase_key:phaseKey.nullable(),position:z.number(),color:z.string().nullable(),
})

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
})
