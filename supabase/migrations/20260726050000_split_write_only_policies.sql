-- FOR ALL policies satisfy every command including SELECT, and permissive policies OR together --
-- so a table with a `_read` policy gated on one permission and a `_write` policy gated on a
-- DIFFERENT, more sensitive permission has its stricter read boundary silently widened to
-- "read_perm OR write_perm". This is currently masked because every seeded default role bundles
-- the two permissions together (see seed_organization_roles in the initial migration), but custom
-- roles are a supported, client-reachable feature (roles.manage / role_permissions_manage), and a
-- role built with the write permission but deliberately without the read permission gets full read
-- access anyway.
--
-- Fixes the five tables where this still applies, by splitting each FOR ALL policy into FOR INSERT
-- (WITH CHECK only) / FOR UPDATE / FOR DELETE -- the exact same write predicate as before, so no
-- write capability changes, only the incidental SELECT grant is removed. Verified before writing
-- this that none of the five has a direct client write path outside the RPCs that already bypass
-- RLS as the function owner, except candidate_private_details (createCandidate does a direct
-- INSERT) and job_candidates (addCandidateToJob does a direct INSERT) -- both preserved exactly.
--
-- ai_evaluations is NOT included here: its write policy (originally the same FOR ALL shape, gated
-- on 'ai.use') was already dropped entirely by 20260716050000_evidence_candidate_profiles.sql and
-- never recreated ("AI rows are service-written; authenticated users ... cannot forge scores,
-- model metadata, or outcome data directly") -- there is no authenticated write policy left on that
-- table to widen, so it needs no further change.
begin;

drop policy candidate_private_write on public.candidate_private_details;
create policy candidate_private_insert on public.candidate_private_details for insert to authenticated
  with check(public.has_permission(organization_id,'candidates.write'));
create policy candidate_private_update on public.candidate_private_details for update to authenticated
  using(public.has_permission(organization_id,'candidates.write'))
  with check(public.has_permission(organization_id,'candidates.write'));
create policy candidate_private_delete on public.candidate_private_details for delete to authenticated
  using(public.has_permission(organization_id,'candidates.write'));

drop policy candidate_consents_write on public.candidate_consents;
create policy candidate_consents_insert on public.candidate_consents for insert to authenticated
  with check(public.has_permission(organization_id,'candidates.write'));
create policy candidate_consents_update on public.candidate_consents for update to authenticated
  using(public.has_permission(organization_id,'candidates.write'))
  with check(public.has_permission(organization_id,'candidates.write'));
create policy candidate_consents_delete on public.candidate_consents for delete to authenticated
  using(public.has_permission(organization_id,'candidates.write'));

drop policy candidate_merge_history_write on public.candidate_merge_history;
create policy candidate_merge_history_insert on public.candidate_merge_history for insert to authenticated
  with check(public.has_permission(organization_id,'candidates.delete'));
create policy candidate_merge_history_update on public.candidate_merge_history for update to authenticated
  using(public.has_permission(organization_id,'candidates.delete'))
  with check(public.has_permission(organization_id,'candidates.delete'));
create policy candidate_merge_history_delete on public.candidate_merge_history for delete to authenticated
  using(public.has_permission(organization_id,'candidates.delete'));

drop policy job_candidates_write on public.job_candidates;
create policy job_candidates_insert on public.job_candidates for insert to authenticated
  with check(public.has_permission(organization_id,'pipeline.move'));
create policy job_candidates_update on public.job_candidates for update to authenticated
  using(public.has_permission(organization_id,'pipeline.move'))
  with check(public.has_permission(organization_id,'pipeline.move'));
create policy job_candidates_delete on public.job_candidates for delete to authenticated
  using(public.has_permission(organization_id,'pipeline.move'));

drop policy stage_history_write on public.stage_history;
create policy stage_history_insert on public.stage_history for insert to authenticated
  with check(public.has_permission(organization_id,'pipeline.move'));
create policy stage_history_update on public.stage_history for update to authenticated
  using(public.has_permission(organization_id,'pipeline.move'))
  with check(public.has_permission(organization_id,'pipeline.move'));
create policy stage_history_delete on public.stage_history for delete to authenticated
  using(public.has_permission(organization_id,'pipeline.move'));

commit;
