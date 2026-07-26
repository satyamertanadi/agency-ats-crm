-- submission_link_events and referral_link_events each carry only their identity primary key (on
-- `id`) -- there is no index on `link_id`, the column every rate-limit check filters on
-- (link_id, event_type, ip_hash, occurred_at; see resolve_submission_link, submit_submission_feedback,
-- resolve_referral_link, submit_referral, all redefined in 20260726070000_atomic_rate_limits.sql).
-- Every call to any of those four functions both scans this table on that predicate AND inserts a row,
-- so the table the scan reads grows with every request that hits it -- a sequential scan against a
-- table with no upper bound. There was also no reaper: cv-parse-cleanup.yml expires CV drafts hourly,
-- but nothing ever expired a link event.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this migration deliberately has
-- no begin/commit wrapper (every other migration in this repo has one) -- building the index
-- concurrently avoids taking a lock that would block writes from the functions above while it builds.
-- Checked staging before writing this: both tables are currently empty, so there is no real data at
-- risk either way, but CONCURRENTLY is the correct choice regardless of current size.
create index concurrently if not exists submission_link_events_lookup
  on public.submission_link_events(link_id, event_type, ip_hash, occurred_at desc);
create index concurrently if not exists referral_link_events_lookup
  on public.referral_link_events(link_id, event_type, ip_hash, occurred_at desc);
