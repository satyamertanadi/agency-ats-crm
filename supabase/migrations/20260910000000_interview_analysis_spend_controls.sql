begin;

-- Phase 2: one place decides whether a paid analysis may be created, and every provider attempt is
-- accounted for.
--
-- Three gaps.
--
-- The limits lived in the request-interview-analysis Edge Function. Automatic analysis does not go
-- through it: maybe_queue_automatic_analysis queues an intent, the worker converts it with
-- internal_request_interview_analysis, and no ceiling was consulted anywhere on that path. A
-- workspace with auto-analysis on could therefore run past every limit the manual path enforces.
--
-- The input hash covered model and prompt version but not provider, so two runs on different
-- providers with the same model name deduplicated against each other.
--
-- And monthly spend was summed from interview_analysis_runs, which carries the tokens of the LAST
-- provider response. A malformed first response followed by a successful retry cost two calls and
-- counted one; a run that failed validation twice cost two and counted whatever the final write
-- left behind.

-- ---------------------------------------------------------------------------------------------
-- Attempt-level token accounting
-- ---------------------------------------------------------------------------------------------

/* One row per provider call, not per run.
 *
 * A run is a logical unit; a bill is made of attempts. A first malformed response, its retry, and a
 * final failure are three calls that a per-run column can only remember one of.
 *
 * Service-role only, and deliberately narrow: identifiers, counts, an outcome word. No prompt, no
 * response, no excerpt. The point of the table is arithmetic, and storing the text would turn a
 * ledger into a second copy of the transcript.
 */
create table if not exists public.interview_analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  attempt_number integer not null check (attempt_number >= 1),
  outcome text not null check (outcome in ('succeeded','invalid_output','provider_error')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key (analysis_run_id, organization_id)
    references public.interview_analysis_runs(id, organization_id) on delete cascade,
  unique (analysis_run_id, attempt_number)
);

alter table public.interview_analysis_attempts enable row level security;
revoke all on table public.interview_analysis_attempts from public, anon, authenticated;
create index if not exists interview_analysis_attempts_org_created
  on public.interview_analysis_attempts(organization_id, created_at desc);

comment on table public.interview_analysis_attempts is
  'One row per provider call. Exists because a run can pay for several attempts and a per-run token column remembers only the last.';

/* Records what one provider call cost, whatever it returned.
 *
 * Called for a malformed response as readily as a good one, because both were billed. Idempotent on
 * (run, attempt) so a worker retrying its own bookkeeping cannot double-count.
 */
create or replace function public.record_interview_analysis_attempt(
  p_run_id uuid,
  p_attempt_number integer,
  p_outcome text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0
)
returns uuid language plpgsql security definer set search_path=public as $$
declare owning_org uuid; new_id uuid;
begin
  if p_outcome not in ('succeeded','invalid_output','provider_error') then
    raise exception 'invalid_attempt_outcome';
  end if;

  select organization_id into owning_org from public.interview_analysis_runs where id=p_run_id;
  if owning_org is null then raise exception 'analysis_run_not_found'; end if;

  insert into public.interview_analysis_attempts(
    organization_id,analysis_run_id,attempt_number,outcome,input_tokens,output_tokens)
  values(owning_org,p_run_id,p_attempt_number,p_outcome,
    greatest(coalesce(p_input_tokens,0),0),greatest(coalesce(p_output_tokens,0),0))
  on conflict (analysis_run_id,attempt_number) do update
    set outcome=excluded.outcome,
        input_tokens=excluded.input_tokens,
        output_tokens=excluded.output_tokens
  returning id into new_id;

  return new_id;
end $$;
revoke all on function public.record_interview_analysis_attempt(uuid,integer,text,integer,integer) from public, anon, authenticated;
grant execute on function public.record_interview_analysis_attempt(uuid,integer,text,integer,integer) to service_role;

/* Monthly spend, counted from attempts.
 *
 * Falls back to the run's own token columns for runs that predate the ledger, so the ceiling does
 * not silently reset to zero for a workspace mid-month. A run with attempts recorded is counted from
 * them and never from both.
 */
create or replace function public.interview_analysis_token_spend_this_month(p_organization_id uuid)
returns bigint language sql stable security definer set search_path=public as $$
  with month_runs as (
    select id, coalesce(input_tokens,0)+coalesce(output_tokens,0) as run_tokens
    from public.interview_analysis_runs
    where organization_id=p_organization_id
      and created_at >= date_trunc('month', now())
  ),
  attempt_tokens as (
    select a.analysis_run_id,
      sum(coalesce(a.input_tokens,0)+coalesce(a.output_tokens,0))::bigint as tokens
    from public.interview_analysis_attempts a
    join month_runs r on r.id=a.analysis_run_id
    group by a.analysis_run_id
  )
  select coalesce(sum(coalesce(at.tokens, mr.run_tokens)),0)::bigint
  from month_runs mr
  left join attempt_tokens at on at.analysis_run_id=mr.id
$$;
revoke all on function public.interview_analysis_token_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.interview_analysis_token_spend_this_month(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- One shared limit check
-- ---------------------------------------------------------------------------------------------

/* Whether this workspace or this person may create another paid run right now.
 *
 * Returns the breached limit's name, or null. One function so that manual and automatic requests
 * cannot drift apart -- the limits previously lived only in the Edge Function, which automatic
 * analysis never calls, so an opted-in workspace had no ceiling at all.
 *
 * The defaults are deliberately the same numbers the Edge Function already used. They are generous
 * starting points rather than tuned limits; the monthly ceiling is passed in because it is
 * configurable per deployment.
 */
create or replace function public.interview_analysis_limit_breach(
  p_organization_id uuid,
  p_requested_by uuid,
  p_hourly_user_limit integer default 12,
  p_hourly_org_limit integer default 40,
  p_monthly_token_ceiling bigint default 40000000
)
returns text language plpgsql stable security definer set search_path=public as $$
declare per_user integer; per_org integer; spent bigint;
begin
  if p_requested_by is not null then
    select public.interview_analysis_recent_run_count(p_organization_id,p_requested_by,'1 hour') into per_user;
    if coalesce(per_user,0) >= p_hourly_user_limit then return 'rate_limited_user'; end if;
  end if;

  select public.interview_analysis_recent_run_count(p_organization_id,null,'1 hour') into per_org;
  if coalesce(per_org,0) >= p_hourly_org_limit then return 'rate_limited_organization'; end if;

  select public.interview_analysis_token_spend_this_month(p_organization_id) into spent;
  if coalesce(spent,0) >= p_monthly_token_ceiling then return 'monthly_ceiling_reached'; end if;

  return null;
end $$;
revoke all on function public.interview_analysis_limit_breach(uuid,uuid,integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.interview_analysis_limit_breach(uuid,uuid,integer,integer,bigint) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The request path: provider in the hash, and the ceiling enforced for every caller
-- ---------------------------------------------------------------------------------------------

/* Same signature, two changes.
 *
 * The provider joins the input hash. Two runs against different providers with the same model name
 * are different work and must not deduplicate against each other.
 *
 * And the shared ceiling is checked HERE rather than only in the Edge Function, because this is the
 * one function every path that creates a paid run passes through -- manual, automatic, and anything
 * added later. A limit enforced at one entrance is a limit with a side door.
 *
 * Checked after the dedup lookup on purpose: reusing an existing run costs nothing, and refusing it
 * would make a rate limit break the page for somebody who is not spending anything.
 */
create or replace function public.internal_request_interview_analysis(
  p_organization_id uuid,
  p_interview_id uuid,
  p_requested_by uuid,
  p_provider text,
  p_model text,
  p_prompt_version text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  interview public.interviews;
  core_id uuid; job_rubric_id uuid; candidate uuid; job uuid;
  transcript_hash text; rubric_hash text; job_hash text; candidate_hash text; combined text;
  existing public.interview_analysis_runs;
  new_run uuid; unmapped integer; ready_count integer; source_document uuid;
  breach text;
begin
  select * into interview from public.interviews
  where id=p_interview_id and organization_id=p_organization_id;
  if interview.id is null then raise exception 'interview_not_found'; end if;

  if coalesce(public.interview_consent_status(p_interview_id),'') <> 'granted' then
    raise exception 'transcript_consent_required';
  end if;

  select jc.candidate_id, jc.job_id into candidate, job
  from public.job_candidates jc where jc.id=interview.job_candidate_id;

  /* Order matters, because each of these is advice. A transcript that exists but still needs its
   * speakers mapped is never 'ready', so checking readiness first would tell a consultant to "add the
   * transcript" they just added. Existence, then mapping, then readiness. */
  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  select count(*) into unmapped from public.interview_transcript_speakers s
  join public.interview_transcripts t on t.id=s.transcript_id
  where t.interview_id=p_interview_id and t.purged_at is null and t.superseded_by_transcript_id is null
    and s.confirmed_at is null;
  if unmapped>0 then raise exception 'speaker_mapping_required'; end if;

  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  select id into core_id from public.interview_rubrics
  where organization_id=p_organization_id and rubric_type='core' and status='active';
  if core_id is null then raise exception 'core_rubric_required'; end if;

  select id, source_document_id into job_rubric_id, source_document from public.interview_rubrics
  where job_id=job and rubric_type='job' and status='active';
  if job_rubric_id is null then raise exception 'job_rubric_required'; end if;

  transcript_hash:=public.interview_transcript_bundle_hash(p_interview_id);
  rubric_hash:=public.interview_rubric_bundle_hash(core_id,job_rubric_id);
  job_hash:=public.interview_job_brief_hash(job,source_document);
  candidate_hash:=public.interview_candidate_input_hash(candidate);

  -- Provider included: same model name on a different provider is different work.
  combined:=encode(sha256(convert_to(concat_ws(chr(31),
    transcript_hash,rubric_hash,job_hash,candidate_hash,p_prompt_version,p_provider,p_model),'utf8')),'hex');

  /* The dedup that makes automatic analysis safe to call repeatedly. A Meet import, a manual request
   * and a speaker remap can all reach this within a minute of each other; identical inputs must
   * produce one paid run. */
  select * into existing from public.interview_analysis_runs
  where organization_id=p_organization_id and input_hash=combined
    and status in ('queued','processing','completed')
  limit 1;
  if existing.id is not null then
    return jsonb_build_object('run_id',existing.id,'status',existing.status,'reused',true);
  end if;

  /* Only now, once we know this would be a NEW paid run. Refusing a reuse would break the page for
   * somebody who is not spending anything. */
  breach:=public.interview_analysis_limit_breach(p_organization_id,p_requested_by);
  if breach is not null then raise exception '%', breach; end if;

  insert into public.interview_analysis_runs(
    organization_id,interview_id,job_candidate_id,core_rubric_id,job_rubric_id,
    provider,model,prompt_version,transcript_bundle_hash,rubric_bundle_hash,
    job_input_hash,candidate_input_hash,input_hash,status,requested_by
  ) values (
    p_organization_id,p_interview_id,interview.job_candidate_id,core_id,job_rubric_id,
    p_provider,p_model,p_prompt_version,transcript_hash,rubric_hash,
    job_hash,candidate_hash,combined,'queued',p_requested_by
  ) returning id into new_run;

  insert into public.interview_analysis_run_transcripts(organization_id,analysis_run_id,transcript_id,sort_order)
  select p_organization_id,new_run,t.id,row_number() over (order by t.started_at nulls last, t.created_at)
  from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;

  insert into public.background_jobs(organization_id,job_type,payload,idempotency_key)
  values(p_organization_id,'interview_analysis',
    jsonb_build_object('analysis_run_id',new_run,'interview_id',p_interview_id),
    'interview_analysis:'||combined);

  return jsonb_build_object('run_id',new_run,'status','queued','reused',false);
end $$;
revoke all on function public.internal_request_interview_analysis(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.internal_request_interview_analysis(uuid,uuid,uuid,text,text,text) to service_role;

commit;
