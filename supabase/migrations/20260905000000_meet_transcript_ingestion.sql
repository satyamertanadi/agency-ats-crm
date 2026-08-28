begin;

-- Release B1: automatic Google Meet transcript acquisition.
--
-- Everything here feeds the SAME pipeline Release A0 built. A Meet transcript becomes an
-- interview_transcripts row with speakers and entries exactly like a pasted one, goes through the
-- same consent gate, and is analysed by the same worker. There is deliberately no second ingestion
-- path: two ways to get a transcript in would be two places for the consent check to drift.

-- ---------------------------------------------------------------------------------------------
-- Interview fields
-- ---------------------------------------------------------------------------------------------

/* Only what cannot be derived from what is already stored.
 *
 * The Meet space is NOT stored: meeting_url already holds the link, and the meeting code is the last
 * path segment of it. Copying that into a second column would give two places for the same fact to
 * disagree the first time somebody reschedules. The conference record IS stored, because resolving it
 * costs an API call and it never changes once a conference has ended.
 */
alter table public.interviews
  add column if not exists google_meet_conference_record_name text,
  add column if not exists transcript_last_checked_at timestamptz,
  add column if not exists transcript_fetch_attempts integer not null default 0,
  add column if not exists transcript_fetch_error text;

comment on column public.interviews.google_meet_conference_record_name is
  'Resolved conferenceRecords/* name. Null until the first successful lookup after the meeting ends.';
comment on column public.interviews.transcript_fetch_attempts is
  'Bounded retry counter. A meeting that simply never produced a transcript must stop being polled.';

-- ---------------------------------------------------------------------------------------------
-- Workspace switches
-- ---------------------------------------------------------------------------------------------

/* Two switches, not one, and the separation is the point.
 *
 * Importing a transcript automatically is low-risk: it is the same artifact a consultant would paste,
 * under the same consent gate, and a human still maps the speakers. ANALYSING automatically is a
 * different proposition -- it turns a miscalibrated assessment from something produced one interview
 * at a time into something produced for every interview the desk runs.
 *
 * The plan gates Release B1 on calibration being "acceptable enough to automate ingestion". Until
 * that has happened, auto-analysis stays off and the import still saves the consultant the paste.
 */
alter table public.organization_settings
  add column if not exists interview_meet_auto_import_enabled boolean not null default false,
  add column if not exists interview_auto_analysis_enabled boolean not null default false;

comment on column public.organization_settings.interview_auto_analysis_enabled is
  'Queue an analysis as soon as a fetched transcript is ready and mapped. Off until calibration is accepted.';

-- ---------------------------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------------------------

/* Interviews whose transcript is worth asking Google about.
 *
 * The window matters in both directions. Too early and the conference record does not exist yet;
 * Google produces transcripts after the meeting ends, and asking during the call returns nothing
 * forever. Too late and the artifact may be gone -- provider retention is outside our control, which
 * is why give-up is bounded by attempts rather than by time alone.
 *
 * Restricted to the organiser's own connection: the plan makes the organiser the canonical retrieval
 * identity, and opportunistically trying other members' Google tokens to read a meeting they happened
 * to attend is exactly the broadening this feature must not do.
 */
create or replace function public.discover_meet_transcript_fetches(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target record; queued integer:=0;
begin
  for target in
    select i.id, i.organization_id
    from public.interviews i
    join public.organization_settings s on s.organization_id=i.organization_id
    join public.google_calendar_connections g
      on g.member_id=i.organizer_member_id and g.organization_id=i.organization_id
    where s.interview_intelligence_enabled
      and s.interview_meet_auto_import_enabled
      and i.status='completed'
      and i.create_google_meet
      and i.meeting_url is not null
      and g.status='connected'
      -- The Meet scope is granted incrementally, so a workspace can have Calendar connected and Meet
      -- not. Polling those would burn attempts against a token that can never succeed.
      and 'https://www.googleapis.com/auth/meetings.space.readonly'=any(g.scopes)
      -- Ended, with a settling margin: a conference record does not exist the instant a call drops.
      and i.ends_at < now()-interval '10 minutes'
      and i.transcript_fetch_attempts < 8
      and (i.transcript_last_checked_at is null or i.transcript_last_checked_at < now()-interval '30 minutes')
      -- Nothing to fetch if a transcript is already here, however it arrived.
      and not exists(
        select 1 from public.interview_transcripts t
        where t.interview_id=i.id and t.purged_at is null and t.superseded_by_transcript_id is null
      )
    order by i.ends_at
    limit greatest(coalesce(p_limit,25),1)
  loop
    insert into public.background_jobs(organization_id,job_type,payload,idempotency_key)
    values(target.organization_id,'meet_transcript_fetch',
      jsonb_build_object('interview_id',target.id),
      'meet_transcript_fetch:'||target.id::text)
    on conflict do nothing;
    queued:=queued+1;
  end loop;

  return jsonb_build_object('queued',queued);
end $$;
revoke all on function public.discover_meet_transcript_fetches(integer) from public, anon, authenticated;
grant execute on function public.discover_meet_transcript_fetches(integer) to service_role;

/* Records the outcome of one fetch attempt.
 *
 * Attempts increments on every outcome including "no transcript yet", because the counter is what
 * eventually stops us polling a meeting nobody recorded. A meeting that genuinely produced nothing is
 * indistinguishable from one whose transcript is still processing, and the only honest way to tell
 * them apart is to stop asking after a bounded number of tries.
 */
create or replace function public.record_meet_fetch_attempt(
  p_interview_id uuid,
  p_conference_record text default null,
  p_error text default null
)
returns integer language plpgsql security definer set search_path=public as $$
declare attempts integer;
begin
  update public.interviews
  set transcript_last_checked_at=now(),
      transcript_fetch_attempts=transcript_fetch_attempts+1,
      -- Our own code, never the provider's raw body: a Google error can echo the request, and the
      -- request names the meeting.
      transcript_fetch_error=left(coalesce(p_error,''),200),
      google_meet_conference_record_name=coalesce(p_conference_record,google_meet_conference_record_name)
  where id=p_interview_id
  returning transcript_fetch_attempts into attempts;
  return attempts;
end $$;
revoke all on function public.record_meet_fetch_attempt(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_meet_fetch_attempt(uuid,text,text) to service_role;

/* maybe_queue_automatic_analysis lives in the next migration, not here.
 *
 * It has to call internal_request_interview_analysis's preconditions, which that migration creates,
 * and defining a first version here only to replace it minutes later would leave a definition in the
 * history that was never correct -- its job-rubric lookup compared a plpgsql variable named job_id to
 * the column of the same name, which Postgres resolves to the variable, making the predicate always
 * true. That is the same shadowing defect db lint caught in the purge function.
 */

commit;
