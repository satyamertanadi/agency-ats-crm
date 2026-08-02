begin;

/* Extends the realtime publication to the tables the notification-lite surfaces are built from.
 *
 * 20260719020000 deliberately kept these off, and its reasoning was: "a stale candidate profile is not
 * a collaboration problem, and broadcasting salary/contact rows to solve one would be a bad trade."
 * The first half held; the second conflated two tables. Salary, email, phone and consent live in
 * `candidate_private_details`, which stays off this publication -- `candidates` itself carries name,
 * status, owner and source, which is the same class of operational data `jobs` already streams.
 *
 * What changed to make the first half wrong too is the submission workflow becoming real. A client
 * answering a shortlist is now a thing the product reacts to -- a Today item, a feedback card, a
 * package status -- and it is the one event in the whole workflow that arrives from outside the
 * workspace, with nobody in the room to notice it. Polling it on navigation meant a consultant learned
 * their candidate had been approved whenever they next happened to open that job.
 *
 * `candidate_private_details` and everything else stay off. Replica identity stays at default, for the
 * reason the original migration gives: the client uses these events only as a signal to refetch
 * through the normal RLS-checked query path, so it never needs the old row.
 */
do $$
declare
  target text;
begin
  foreach target in array array['activities','submission_packages','candidate_submissions','submission_feedback','candidates'] loop
    -- Idempotent for the same reason as the original: `alter publication ... add table` has no
    -- `if not exists`, and this migration must survive being re-run against a live database.
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=target
    ) then
      execute format('alter publication supabase_realtime add table public.%I',target);
    end if;
  end loop;
end $$;

commit;
