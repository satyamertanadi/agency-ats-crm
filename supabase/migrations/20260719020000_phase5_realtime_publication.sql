begin;

/* Realtime for the surfaces where two consultants genuinely collide: the pipeline board, job
 * ownership, and the operational records the Today queue is built from.
 *
 * Deliberately NOT every table. A publication entry means Postgres streams that table's row data to
 * every subscribed client, filtered by RLS -- so the cost of adding a table is both bandwidth on
 * every write and a dependency on that table's policies being right. The tables below are
 * operational and already org-scoped; `candidates`, `candidate_private_details`, `activities`, and
 * everything else stay off it, because a stale candidate profile is not a collaboration problem and
 * broadcasting salary/contact rows to solve one would be a bad trade.
 *
 * Replica identity is deliberately left at default rather than raised to `full`. The client uses
 * these events only as a signal to refetch through the normal RLS-checked query path, so it never
 * needs the old row -- and `full` would put every prior column value on the wire for no gain.
 */
do $$
declare
  target text;
begin
  foreach target in array array['job_candidates','jobs','tasks','interviews','offers','placements'] loop
    -- Idempotent: re-running must not fail on a table the publication already carries, and
    -- `alter publication ... add table` has no `if not exists`.
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=target
    ) then
      execute format('alter publication supabase_realtime add table public.%I',target);
    end if;
  end loop;
end $$;

commit;
