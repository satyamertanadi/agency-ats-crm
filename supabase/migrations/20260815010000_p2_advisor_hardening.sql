-- P2 hardening from the production-readiness audit: three of the four remaining advisor items.
-- (The fourth, Auth's leaked-password protection, is a project-level Auth setting, not schema DDL,
-- and stays a dashboard/API task -- see docs/production-readiness-audit.md.)

begin;

-- pg_net is NOT moved here. `alter extension pg_net set schema extensions` fails with
-- "extension pg_net does not support SET SCHEMA" -- Supabase's managed pg_net is non-relocatable,
-- so the only way to silence this advisor item is drop-and-recreate, which would briefly disrupt the
-- live maintenance cron for a cosmetic finding. The advisor's real concern (an unintended callable
-- surface in public) is already moot: net.http_post/net.http_get live in their own `net` schema,
-- confirmed live, and schedule_maintenance_cron already resolves that schema dynamically rather than
-- hardcoding it. Left as a documented, accepted finding rather than forced.

-- normalize_email had no search_path pin at all (a mutable-search-path function), unlike every other
-- function in this schema. It calls only lower/trim/nullif, which are pg_catalog built-ins always
-- resolvable regardless of search_path, so this closes the advisor finding without changing behavior.
create or replace function public.normalize_email(value text)
returns text language sql immutable parallel safe
set search_path=public
as $$
  select nullif(lower(trim(value)), '')
$$;

-- These five tables are intentionally RLS-enabled with zero policies -- default-deny, reached only
-- through SECURITY DEFINER functions that run as the function owner. The audit verified this is safe
-- (RLS-enabled + no policy = no client access under any role), but the advisor's own wording
-- ("enabled ... but no policies exist") reads identically for an oversight and for this deliberate
-- pattern. Documented here so it doesn't get "fixed" by someone adding an accidental client-facing
-- policy.
comment on table public.email_delivery_payloads is 'Default-deny: RLS enabled, no policies. Reached only via SECURITY DEFINER functions (durable email delivery). Never intended to be client-queryable.';
comment on table public.google_calendar_secrets is 'Default-deny: RLS enabled, no policies. Encrypted OAuth refresh tokens, reached only via SECURITY DEFINER calendar functions. Never intended to be client-queryable.';
comment on table public.google_oauth_states is 'Default-deny: RLS enabled, no policies. Short-lived OAuth state, reached only via SECURITY DEFINER calendar functions. Never intended to be client-queryable.';
comment on table public.maintenance_heartbeats is 'Default-deny: RLS enabled, no policies. Written by scheduled-maintenance via SECURITY DEFINER; read via get_maintenance_health. Never intended to be client-queryable.';
comment on table public.submission_link_events is 'Default-deny: RLS enabled, no policies. Rate-limit/audit trail for public submission links, written only via SECURITY DEFINER functions. Never intended to be client-queryable.';

commit;
