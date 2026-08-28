begin;

-- Release B2: the daily owner brief.
--
-- Off by default, addressed to people an owner names, and made of counts. There is deliberately no
-- free text from the model anywhere in it: a digest is read on a phone, forwarded, and left in an
-- inbox, which is the worst possible place for a sentence about a named colleague's interview
-- technique or a line a candidate said. Everything here is a number, a fixed vocabulary term, or a
-- link back into the ATS where the evidence lives behind authentication.

-- ---------------------------------------------------------------------------------------------
-- Settings (contract section 55)
-- ---------------------------------------------------------------------------------------------

alter table public.organization_settings
  add column if not exists interview_digest_enabled boolean not null default false,
  add column if not exists interview_digest_local_time time not null default '17:30',
  add column if not exists interview_digest_skip_empty boolean not null default true,
  add column if not exists interview_digest_last_success_at timestamptz;

comment on column public.organization_settings.interview_digest_local_time is
  'Send time in the workspace timezone, not UTC. A brief that arrives at 03:00 local is not a brief.';
comment on column public.organization_settings.interview_digest_last_success_at is
  'Start of the next aggregation window. Advances on a skipped-empty run too, because an empty day was still reviewed.';

-- ---------------------------------------------------------------------------------------------
-- Recipients (contract section 56)
-- ---------------------------------------------------------------------------------------------

/* Named members, never "everyone with a permission".
 *
 * A permission-derived recipient list changes silently when somebody's role changes, and the first
 * anybody knows about it is a new person receiving a summary of their colleagues' interview quality.
 * An explicit list is a decision with an author and a date on it.
 */
create table if not exists public.interview_digest_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id) on delete cascade,
  unique (organization_id, member_id)
);

alter table public.interview_digest_recipients enable row level security;

/* Readable by anyone who may configure the feature, and by the recipient themselves. Somebody
 * receiving a daily summary of the desk should be able to see that they are on the list without
 * asking the owner. */
create policy interview_digest_recipients_read on public.interview_digest_recipients
  for select to authenticated
  using (
    public.can_configure_interview_intelligence(organization_id)
    or member_id = public.my_member_id(organization_id)
  );

-- ---------------------------------------------------------------------------------------------
-- Runs (contract section 57)
-- ---------------------------------------------------------------------------------------------

/* One row per workspace per local report date, and the unique constraint is the delivery guarantee.
 *
 * The sweep that sends these runs hourly, so without it a slow send, a retry, or two workers waking
 * together would each produce another copy of the same brief. Claiming the date by inserting the row
 * BEFORE anything is sent makes a duplicate impossible rather than unlikely.
 */
create table if not exists public.interview_digest_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  local_report_date date not null,
  range_started_at timestamptz not null,
  range_ended_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','skipped_empty','failed')),
  analysis_count integer not null default 0,
  attention_count integer not null default 0,
  failure_count integer not null default 0,
  recipient_count integer not null default 0,
  /* The in-app copy of exactly what was sent. Recomputing it for the interface would be a second
   * definition of the digest, and two definitions of the same brief eventually disagree -- at which
   * point nobody can tell which one the owner actually read. */
  content jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  unique (organization_id, local_report_date)
);

alter table public.interview_digest_runs enable row level security;
create index if not exists interview_digest_runs_org_date on public.interview_digest_runs(organization_id, local_report_date desc);

create policy interview_digest_runs_read on public.interview_digest_runs
  for select to authenticated
  using (
    public.can_configure_interview_intelligence(organization_id)
    or exists(
      select 1 from public.interview_digest_recipients r
      where r.organization_id=interview_digest_runs.organization_id
        and r.member_id=public.my_member_id(interview_digest_runs.organization_id)
    )
  );

/* The digest is a new kind of mail, so the delivery table has to admit it exists.
 *
 * This list ACCUMULATES, and re-stating it is how a value gets lost. interview_cancellation was added
 * by 20260809020000, and rebuilding the constraint from the original table definition dropped it --
 * which would have broken every interview cancellation email, from a migration whose subject is a
 * digest. Anything editing this list must carry every value already in it. */
alter table public.email_deliveries drop constraint if exists email_deliveries_email_type_check;
alter table public.email_deliveries add constraint email_deliveries_email_type_check
  check (email_type in (
    'team_invitation','client_submission','calendar_failure','interview_cancellation','interview_quality_digest'));

-- ---------------------------------------------------------------------------------------------
-- Recipient management
-- ---------------------------------------------------------------------------------------------

create or replace function public.add_interview_digest_recipient(
  p_organization_id uuid,
  p_member_id uuid
)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if not public.can_configure_interview_intelligence(p_organization_id) then raise exception 'permission_denied'; end if;
  -- An inactive member would keep receiving the desk's summary after leaving the desk.
  if not exists(
    select 1 from public.organization_members m
    where m.id=p_member_id and m.organization_id=p_organization_id and m.status='active'
  ) then raise exception 'member_not_active'; end if;

  insert into public.interview_digest_recipients(organization_id,member_id,created_by)
  values(p_organization_id,p_member_id,auth.uid())
  on conflict (organization_id,member_id) do update set member_id=excluded.member_id
  returning id into new_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_digest.recipient_added','organization_member',p_member_id,'{}'::jsonb);
  return new_id;
end $$;
revoke all on function public.add_interview_digest_recipient(uuid,uuid) from public, anon;
grant execute on function public.add_interview_digest_recipient(uuid,uuid) to authenticated;

create or replace function public.remove_interview_digest_recipient(
  p_organization_id uuid,
  p_member_id uuid
)
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  if not public.can_configure_interview_intelligence(p_organization_id) then raise exception 'permission_denied'; end if;
  delete from public.interview_digest_recipients
  where organization_id=p_organization_id and member_id=p_member_id;
  get diagnostics removed=row_count;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_digest.recipient_removed','organization_member',p_member_id,'{}'::jsonb);
  return removed;
end $$;
revoke all on function public.remove_interview_digest_recipient(uuid,uuid) from public, anon;
grant execute on function public.remove_interview_digest_recipient(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- What the brief contains
-- ---------------------------------------------------------------------------------------------

/* The digest body: counts, fixed vocabulary, and nothing else.
 *
 * Read the exclusion list in the plan as a description of what an email is: forwarded, stored
 * unencrypted, and read by whoever picks up the phone. So no transcript quotes, no candidate
 * answers, no email, no phone, no salary, and -- the one that is easy to miss -- no raw model
 * content. That last rules out finding titles and summaries, which are model-authored sentences
 * about a named colleague's technique. Themes are therefore dimension counts, exactly as the
 * Scorecard reports them.
 *
 * Candidate-fit distribution is a band histogram with no candidate attached, which is the only form
 * in which candidate outcomes can appear in an email at all.
 */
create or replace function public.build_interview_digest_content(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare payload jsonb;
begin
  with scoped as (
    -- Analysis runs completed inside the window. Keyed on completion rather than on interview date:
    -- a brief is about what happened since the last brief, and what happened is that these finished.
    select distinct on (a.interview_id, a.assessment_type)
      a.id as assessment_id, a.interview_id, a.assessment_type, a.overall_band
    from public.interview_assessments a
    join public.interview_analysis_runs r on r.id=a.analysis_run_id
    where a.organization_id=p_organization_id
      and r.status='completed'
      and r.completed_at >= p_from and r.completed_at < p_to
    order by a.interview_id, a.assessment_type, r.completed_at desc
  ),
  consultant as (select * from scoped where assessment_type='consultant_quality'),
  candidate_fit as (select * from scoped where assessment_type='candidate_fit'),
  /* A band histogram with no candidate attached, which is the only form in which candidate outcomes
   * may appear in an email at all. */
  candidate_bands as (
    select overall_band as band, count(*)::int as interviews
    from candidate_fit group by overall_band
  ),
  themes as (
    select f.category as dimension, count(distinct c.interview_id)::int as interviews
    from public.interview_assessment_findings f
    join consultant c on c.assessment_id=f.assessment_id
    where f.severity in ('coaching','attention','critical')
      and f.category in ('essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity')
    group by f.category
  ),
  attention as (
    -- The same predicate the attention queue uses, so the number in the email matches the number of
    -- rows the link opens.
    select count(*)::int as findings
    from public.interview_assessment_findings f
    join consultant c on c.assessment_id=f.assessment_id
    where f.severity in ('attention','critical')
      and not exists(
        select 1 from public.interview_assessment_feedback fb
        where fb.assessment_id=c.assessment_id
          and (fb.finding_id=f.id or fb.finding_id is null)
          and fb.feedback_type in ('reviewed','agreed','disagreed','discussed')
      )
  ),
  failures as (
    -- completed_at is stamped by fail_interview_analysis too: a run that ended, however it ended.
    select count(*)::int as runs
    from public.interview_analysis_runs r
    where r.organization_id=p_organization_id
      and r.status='failed'
      and r.completed_at >= p_from and r.completed_at < p_to
  ),
  /* Outstanding work is deliberately a running total rather than a count from the window. An action
   * assigned three weeks ago and still open is exactly what an owner needs to see; one that only
   * appeared in the window is not yet a problem. */
  coaching as (
    select count(*) filter (where status='open')::int as open_actions,
      count(*) filter (where status='acknowledged')::int as acknowledged_actions,
      count(*) filter (where status in ('open','acknowledged') and due_at is not null and due_at < p_to)::int as overdue_actions
    from public.interview_coaching_actions
    where organization_id=p_organization_id
  )
  select jsonb_build_object(
    'analysed_interviews',(select count(distinct interview_id) from consultant),
    'attention_findings',(select findings from attention),
    'processing_failures',(select runs from failures),
    'themes',coalesce((select jsonb_agg(jsonb_build_object('dimension',dimension,'interviews',interviews)
      order by interviews desc, dimension) from themes),'[]'::jsonb),
    'candidate_fit',coalesce((select jsonb_agg(jsonb_build_object('band',band,'interviews',interviews)
      order by interviews desc, band) from candidate_bands),'[]'::jsonb),
    'coaching',(select jsonb_build_object(
      'open',open_actions,'acknowledged',acknowledged_actions,'overdue',overdue_actions) from coaching)
  ) into payload;

  return payload;
end $$;
revoke all on function public.build_interview_digest_content(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.build_interview_digest_content(uuid,timestamptz,timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Claiming a run
-- ---------------------------------------------------------------------------------------------

/* Decides whether a workspace is due a brief, and claims the date if it is.
 *
 * Returns null far more often than not: the sweep runs hourly against every workspace, and almost
 * every call is "not yet today" or "already sent". Claiming is an insert that can lose to the unique
 * constraint, and losing is a correct outcome rather than an error -- it means another worker got
 * there first.
 *
 * The 36-hour cap the plan sets is what stops a workspace that was disabled for a month from waking
 * up and sending a brief covering four hundred interviews. What falls outside the cap is not lost;
 * it is in the Scorecard, which is where a month of history belongs.
 */
create or replace function public.claim_interview_digest_run(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  config public.organization_settings;
  zone text;
  local_now timestamp;
  report_date date;
  window_start timestamptz;
  window_end timestamptz;
  recipients integer;
  claimed uuid;
  max_lookback constant interval:='36 hours';
begin
  select * into config from public.organization_settings where organization_id=p_organization_id;
  if config.organization_id is null or not coalesce(config.interview_digest_enabled,false) then
    return jsonb_build_object('claimed',false,'reason','digest_disabled');
  end if;
  if not coalesce(config.interview_intelligence_enabled,false) then
    return jsonb_build_object('claimed',false,'reason','feature_disabled');
  end if;

  select coalesce(o.timezone,'UTC') into zone from public.organizations o where o.id=p_organization_id;
  local_now:=timezone(zone,now());
  report_date:=local_now::date;

  -- Before the send time, there is nothing to do yet today.
  if local_now::time < config.interview_digest_local_time then
    return jsonb_build_object('claimed',false,'reason','not_due_yet');
  end if;

  select count(*) into recipients from public.interview_digest_recipients r
  join public.organization_members m on m.id=r.member_id and m.status='active'
  where r.organization_id=p_organization_id;
  if recipients=0 then return jsonb_build_object('claimed',false,'reason','no_recipients'); end if;

  window_end:=now();
  window_start:=greatest(
    coalesce(config.interview_digest_last_success_at, window_end-max_lookback),
    window_end-max_lookback);

  insert into public.interview_digest_runs(
    organization_id,local_report_date,range_started_at,range_ended_at,status,recipient_count)
  values(p_organization_id,report_date,window_start,window_end,'pending',recipients)
  on conflict (organization_id,local_report_date) do nothing
  returning id into claimed;

  if claimed is null then return jsonb_build_object('claimed',false,'reason','already_sent_today'); end if;

  return jsonb_build_object(
    'claimed',true,'run_id',claimed,'report_date',report_date,
    'range_started_at',window_start,'range_ended_at',window_end,'recipient_count',recipients);
end $$;
revoke all on function public.claim_interview_digest_run(uuid) from public, anon, authenticated;
grant execute on function public.claim_interview_digest_run(uuid) to service_role;

/* Workspaces worth asking about. Bounded, and cheap enough to run hourly. */
create or replace function public.due_interview_digest_organizations(p_limit integer default 50)
returns table(organization_id uuid) language sql stable security definer set search_path=public as $$
  select s.organization_id
  from public.organization_settings s
  join public.organizations o on o.id=s.organization_id
  where s.interview_digest_enabled and s.interview_intelligence_enabled
    and timezone(coalesce(o.timezone,'UTC'),now())::time >= s.interview_digest_local_time
    and not exists(
      select 1 from public.interview_digest_runs run
      where run.organization_id=s.organization_id
        and run.local_report_date=timezone(coalesce(o.timezone,'UTC'),now())::date
    )
  order by s.organization_id
  limit greatest(coalesce(p_limit,50),1)
$$;
revoke all on function public.due_interview_digest_organizations(integer) from public, anon, authenticated;
grant execute on function public.due_interview_digest_organizations(integer) to service_role;

/* Records the outcome, and advances the aggregation window.
 *
 * last_success_at advances on a skipped-empty run as well as a sent one. Not advancing it would make
 * an empty day silently widen the next window, which the 36-hour cap would then truncate -- so a
 * quiet Sunday would cost real coverage on Monday. An empty period was still reviewed.
 */
create or replace function public.finalize_interview_digest_run(
  p_run_id uuid,
  p_status text,
  p_content jsonb default null,
  p_error_message text default null
)
returns text language plpgsql security definer set search_path=public as $$
declare run public.interview_digest_runs;
begin
  if p_status not in ('sent','skipped_empty','failed') then raise exception 'invalid_digest_status'; end if;

  update public.interview_digest_runs
  set status=p_status,
      content=coalesce(p_content,content),
      analysis_count=coalesce((p_content->>'analysed_interviews')::int,analysis_count),
      attention_count=coalesce((p_content->>'attention_findings')::int,attention_count),
      failure_count=coalesce((p_content->>'processing_failures')::int,failure_count),
      sent_at=case when p_status='sent' then now() else sent_at end,
      -- Our own message, never a provider body: a provider error can echo the request, and the
      -- request carries recipient addresses.
      error_message=left(p_error_message,200)
  where id=p_run_id
  returning * into run;
  if run.id is null then raise exception 'digest_run_not_found'; end if;

  if p_status in ('sent','skipped_empty') then
    update public.organization_settings
    set interview_digest_last_success_at=run.range_ended_at
    where organization_id=run.organization_id;
  end if;

  return p_status;
end $$;
revoke all on function public.finalize_interview_digest_run(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.finalize_interview_digest_run(uuid,text,jsonb,text) to service_role;

/* The in-app digest: the same content that was emailed, read back rather than recomputed.
 *
 * Recomputing would produce a second definition of the brief, and the two would eventually disagree
 * about a day nobody can re-derive -- at which point there is no way to tell what the owner actually
 * received.
 */
create or replace function public.get_interview_digests(p_organization_id uuid, p_limit integer default 14)
returns table(
  id uuid,
  local_report_date date,
  status text,
  analysis_count integer,
  attention_count integer,
  failure_count integer,
  recipient_count integer,
  sent_at timestamptz,
  content jsonb
)
language sql stable security invoker set search_path=public as $$
  select d.id,d.local_report_date,d.status,d.analysis_count,d.attention_count,
    d.failure_count,d.recipient_count,d.sent_at,d.content
  from public.interview_digest_runs d
  where d.organization_id=p_organization_id
  order by d.local_report_date desc
  limit greatest(coalesce(p_limit,14),1)
$$;
revoke all on function public.get_interview_digests(uuid,integer) from public, anon;
grant execute on function public.get_interview_digests(uuid,integer) to authenticated;

commit;
