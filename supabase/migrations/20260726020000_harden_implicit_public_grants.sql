-- Close the implicit-PUBLIC grant gap found while building the N3 grant-audit test (see
-- tests/rls/rpc-acl.test.ts). Postgres grants EXECUTE to PUBLIC by default on function creation;
-- nothing in this schema alters that default (20260717060000_grant_base_table_privileges.sql only
-- touches tables and sequences). Every function below was granted EXECUTE to `authenticated`
-- explicitly, but never had `revoke ... from public` run first -- so the explicit grant was
-- redundant and the function has been callable by `anon` (via the PUBLIC pseudo-role, which every
-- role is implicitly a member of) since the migration that first created it. Each is gated
-- internally by has_permission(), so this was not a tenancy hole, but it is a live ACL
-- inconsistency between what these functions were clearly intended to require (an authenticated,
-- permissioned member) and what Postgres actually enforced.
--
-- create_placement_from_offer and set_company_default_fee are a second instance of the same class
-- of bug the audit already flagged for grant regressions: changing a function's argument list
-- creates a brand-new pg_proc row with a fresh default ACL, and the `drop function if exists
-- ...(old signature)` + `create or replace function ...(new signature)` pattern in
-- 20260719010000_phase4_commercial_provenance.sql never followed up with a revoke on the new
-- signature.
begin;

revoke all on function public.create_organization(text,text,char,text) from public, anon;
grant execute on function public.create_organization(text,text,char,text) to authenticated;

revoke all on function public.create_job_with_pipeline(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.create_job_with_pipeline(uuid,uuid,text,uuid) to authenticated;

revoke all on function public.move_job_candidate_stage(uuid,uuid,text,text) from public, anon;
grant execute on function public.move_job_candidate_stage(uuid,uuid,text,text) to authenticated;

revoke all on function public.search_workspace(uuid,text,integer) from public, anon;
grant execute on function public.search_workspace(uuid,text,integer) to authenticated;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) to authenticated;

revoke all on function public.list_job_health(uuid,uuid) from public, anon;
grant execute on function public.list_job_health(uuid,uuid) to authenticated;

revoke all on function public.list_company_pipeline(uuid) from public, anon;
grant execute on function public.list_company_pipeline(uuid) to authenticated;

revoke all on function public.add_candidates_to_job(uuid,uuid,uuid[],uuid) from public, anon;
grant execute on function public.add_candidates_to_job(uuid,uuid,uuid[],uuid) to authenticated;

revoke all on function public.set_company_bd_stage(uuid,uuid,text,text) from public, anon;
grant execute on function public.set_company_bd_stage(uuid,uuid,text,text) to authenticated;

revoke all on function public.create_placement_from_offer(uuid,numeric,integer,text) from public, anon;
grant execute on function public.create_placement_from_offer(uuid,numeric,integer,text) to authenticated;

revoke all on function public.set_company_default_fee(uuid,uuid,text,numeric,numeric,text,integer,integer,text,text,text,text,text) from public, anon;
grant execute on function public.set_company_default_fee(uuid,uuid,text,numeric,numeric,text,integer,integer,text,text,text,text,text) to authenticated;

-- normalize_email is a pure, side-effect-free text transform (no data access), so PUBLIC execute was
-- never a security issue -- but it was implicit rather than declared, and this migration's whole
-- point is that every grant should be declared. authenticated is the narrowest role that already
-- needs it (called from application RPC arguments), so it is the intended audience.
revoke all on function public.normalize_email(text) from public, anon;
grant execute on function public.normalize_email(text) to authenticated;

-- seed_organization_roles is the real finding here, not just an ACL-hygiene gap: it is
-- security definer with NO permission check and no check that p_organization_id even belongs to
-- the caller. It has never had a client-facing purpose -- both callers
-- (create_organization and provision_initial_organization_owner, both security definer, both
-- 'perform'-ing it in the same transaction) already run as the function owner, so revoking every
-- external grant does not affect them: a nested call from within another security definer function
-- is authorized by the owner's privileges, not the original client role's. Before this migration,
-- any authenticated (or, via the PUBLIC default, unauthenticated) caller could invoke
-- seed_organization_roles(<any org id>) directly; for an already-fully-seeded org this failed on
-- the roles(organization_id, role_key) unique constraint with no visible effect, but that is an
-- accidental side effect of the schema, not an authorization check, and does not hold for every
-- future role_key this function might seed. No client code calls this RPC (grep across src/ and
-- extension/src/ confirms it), so this closes the surface with no application-visible change.
revoke all on function public.seed_organization_roles(uuid) from public, anon, authenticated;

commit;
