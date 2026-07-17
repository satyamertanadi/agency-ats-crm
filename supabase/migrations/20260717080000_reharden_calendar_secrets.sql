-- 20260713002000_commercial_readiness.sql deliberately revoked anon/authenticated access to
-- google_calendar_secrets and google_oauth_states (encrypted OAuth refresh tokens have no business
-- being reachable directly by a client, only by the service-role Edge Functions that sync calendars).
-- The immediately preceding migration's blanket `grant all privileges on all tables in schema public`
-- -- needed because no migration had ever granted anon/authenticated their baseline table access at
-- all, see that migration's comment -- re-opened these two specifically as a side effect. Close them
-- back up; nothing else in the schema had an equivalent table-level revoke to preserve.
revoke all on public.google_calendar_secrets, public.google_oauth_states from anon, authenticated;
