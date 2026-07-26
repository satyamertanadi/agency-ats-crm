-- submission_link_events and referral_link_events each carry only their identity primary key (on
-- `id`) -- there is no index on `link_id`, the column every rate-limit check filters on
-- (link_id, event_type, ip_hash, occurred_at; see resolve_submission_link, submit_submission_feedback,
-- resolve_referral_link, submit_referral, all redefined in 20260726070000_atomic_rate_limits.sql).
-- Every call to any of those four functions both scans this table on that predicate AND inserts a row,
-- so the table the scan reads grows with every request that hits it -- a sequential scan against a
-- table with no upper bound. There was also no reaper: cv-parse-cleanup.yml expires CV drafts hourly,
-- but nothing ever expired a link event.
--
-- This was originally written as `create index concurrently` to avoid locking the table during the
-- build, but `supabase db push` runs every migration statement over a pipelined connection that
-- CONCURRENTLY cannot execute under regardless of an explicit transaction block (confirmed: it broke
-- both the CI ephemeral database and staging with "CREATE INDEX CONCURRENTLY cannot be executed within
-- a pipeline"). Checked both staging and production before switching to a plain CREATE INDEX: staging
-- is empty, production has 0 and 2 rows respectively, so a regular index build takes its lock for a
-- negligible fraction of a second either way -- there is no real tradeoff being given up here.
begin;
create index if not exists submission_link_events_lookup
  on public.submission_link_events(link_id, event_type, ip_hash, occurred_at desc);
create index if not exists referral_link_events_lookup
  on public.referral_link_events(link_id, event_type, ip_hash, occurred_at desc);
commit;
