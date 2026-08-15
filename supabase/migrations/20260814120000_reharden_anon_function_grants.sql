-- Reharden the anon/PUBLIC function-execute surface.
--
-- Root cause (documented in 20260726090000_close_unrevoked_helper_grants.sql): this project's
-- Supabase baseline runs `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO anon` on every new
-- public-schema function, so a function is anon-executable on staging/production unless a migration
-- explicitly revokes it. The house pattern often writes `revoke ... from public`, but `public` is
-- the ALL-ROLES pseudo-role, not the `anon` role, so anon keeps its default grant. The same slip has
-- now recurred four times (resolve_submission_link, submit_submission_feedback, the calendar secrets,
-- and -- the reason this migration exists -- schedule_maintenance_cron).
--
-- schedule_maintenance_cron is the dangerous one: an unauthenticated caller holding only the public
-- anon key could POST to /rest/v1/rpc/schedule_maintenance_cron and schedule a pg_cron job that
-- issues a pg_net HTTP POST to any URL with any headers, overwriting the legitimate maintenance job
-- (SSRF + persistent arbitrary cron + maintenance DoS). Confirmed anon-executable on staging and
-- production. It is a trusted-setup primitive and must not be reachable by ANY client role.
--
-- rpc-acl.test.ts (via audit_function_grants(), which excludes trigger functions as inert) already
-- asserts "nothing is EXECUTE-able by anon or PUBLIC" -- but it runs against a local `db reset`,
-- which per 20260717060000's own note does not reproduce the platform's default grants, so it passes
-- locally while the real databases diverge. The explicit revokes below are the fix; a CI step that
-- runs the same guard against a database carrying the platform baseline is the remaining follow-up.

begin;

-- Trigger functions: inert via RPC (Postgres refuses to invoke a trigger function outside trigger
-- context regardless of EXECUTE grant), but revoked from every client role for hygiene. Revoking
-- EXECUTE does not stop the trigger from firing -- triggers do not consult the caller's grant.
revoke all on function public.assign_pipeline_phase() from anon, authenticated, public;
revoke all on function public.bump_candidate_profile_template_version() from anon, authenticated, public;
revoke all on function public.bump_interview_calendar_version() from anon, authenticated, public;
revoke all on function public.touch_updated_at() from anon, authenticated, public;
revoke all on function public.handle_new_user() from anon, authenticated, public;
revoke all on function public.contact_follow_up_to_task() from anon, authenticated, public;

-- Trusted-setup primitive: no client role, ever.
revoke all on function public.schedule_maintenance_cron(text, text) from anon, authenticated, public;

-- Client-facing reads that legitimately stay granted to authenticated (both are in
-- tests/rls/rpc-acl.expected.json). Remove only the unintended anon/PUBLIC grant.
revoke all on function public.get_maintenance_health(uuid) from anon, public;
revoke all on function public.get_my_workspace_capabilities(uuid) from anon, public;
grant execute on function public.get_maintenance_health(uuid) to authenticated;
grant execute on function public.get_my_workspace_capabilities(uuid) to authenticated;

-- Belt for the future: stop new public-schema functions from being anon/PUBLIC-executable by
-- default, so a migration that forgets an explicit revoke fails safe (uncallable) rather than
-- fails open (anon-callable). Existing functions are unaffected by this and are handled above.
alter default privileges in schema public revoke execute on functions from anon, public;

commit;
