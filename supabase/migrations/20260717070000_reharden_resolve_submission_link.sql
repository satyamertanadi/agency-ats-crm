-- Restore the service-role-only boundary on resolve_submission_link.
--
-- 20260713002000_commercial_readiness.sql deliberately locked this RPC to service_role only,
-- specifically so the public review flow has to pass through the rate-limited, response-filtering
-- Edge Function rather than being callable directly via PostgREST. 20260715220154_review_branding.sql
-- and 20260716120000_organization_salary_period.sql each redefined the function (to add branding,
-- then salary_period, to the payload) and copy-pasted the function's *original* grant statement
-- (`grant execute ... to anon,authenticated`, from before the lockdown existed) instead of the
-- lockdown's `grant ... to service_role` -- silently reopening direct client access on every
-- `create or replace function` since. No behavior change for the real caller (the Edge Function
-- already runs as service_role); this only removes the direct-client bypass.
revoke all on function public.resolve_submission_link(text) from public, anon, authenticated;
grant execute on function public.resolve_submission_link(text) to service_role;
