-- Supports the generate-candidate-profile dedup lookup: an identical input hash for the same
-- candidate/job means a prior generation already exists, so the function can serve the stored
-- draft instead of paying for a repeat model call. Without this index the lookup is a seq scan.
create index if not exists idx_cpv_org_input_hash
  on public.candidate_profile_versions (organization_id, candidate_id, job_id, input_hash);
