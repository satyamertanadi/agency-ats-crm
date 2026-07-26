-- This project's Supabase baseline grants EXECUTE to anon/authenticated/service_role on every new
-- public-schema function by default (ALTER DEFAULT PRIVILEGES). The codebase's usual lockdown
-- pattern is `revoke all on function ... from public,anon,authenticated;` before re-granting only
-- what's intended -- but three functions never got the full version of that treatment:
--
--   * has_permission / is_organization_member (20260713000000_initial_agency_platform.sql) were
--     only ever `grant`ed to authenticated, with no preceding revoke, so the default anon grant
--     was never removed.
--   * request_ip_hash (20260726070000_atomic_rate_limits.sql) was revoked `from public` only --
--     `public` is the ALL-ROLES pseudo-role, not the `anon` role, so that statement never touched
--     anon's own explicit default-privilege grant.
--
-- Caught by tests/rls/rpc-acl.test.ts, which asserts nothing is ever exposed to anon/PUBLIC.
-- Practical exposure is low (has_permission/is_organization_member key off auth.uid(), which is
-- null for anon and so always resolves false; request_ip_hash has no side effects), but the
-- declared-allowlist test exists precisely so a real regression doesn't get this same "it's
-- probably harmless" pass.
--
-- has_permission and is_organization_member stay granted to authenticated (unchanged, per
-- tests/rls/rpc-acl.expected.json). request_ip_hash is purely an internal helper for
-- resolve_submission_link/submit_submission_feedback, which call it from inside their own
-- SECURITY DEFINER bodies -- that executes as the function owner, not the original caller, so no
-- role needs a direct grant on it at all.
begin;

revoke all on function public.has_permission(uuid,text) from public,anon;
revoke all on function public.is_organization_member(uuid) from public,anon;
revoke all on function public.request_ip_hash() from public,anon,authenticated;

commit;
