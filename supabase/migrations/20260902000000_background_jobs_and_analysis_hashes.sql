begin;

-- WS4, first half: the durable job queue and the input fingerprints an analysis is identified by.

-- ---------------------------------------------------------------------------------------------
-- Durable background jobs
-- ---------------------------------------------------------------------------------------------

/* Reinstates the general-purpose queue dropped by 20260810030000_drop_unreachable_schema.sql.
 *
 * It was removed for a good reason -- nothing reached it -- and it comes back for a good reason:
 * interview analysis is a paid, slow, retryable call that must not happen inside a UI request. The
 * shape is deliberately the ORIGINAL general-purpose one rather than an interview-specific
 * `interview_jobs`, so the next feature needing asynchrony has a queue rather than a precedent for a
 * second one. Only the payload is interview-shaped.
 *
 * Reinstating this was put to the product owner rather than assumed, because it reverses a
 * deliberate pre-launch subtraction.
 */
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  status text not null default 'pending' check(status in ('pending','processing','completed','failed','dead_letter')),
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

/* The same guarantee the original carried: one live job per key. A retry of a request that already
 * queued work re-uses it instead of paying for the same analysis twice. Completed and failed rows are
 * excluded so a later, genuinely new request for the same subject can queue again. */
create unique index background_job_idempotency on public.background_jobs(organization_id,idempotency_key)
  where idempotency_key is not null and status in ('pending','processing');
create index background_jobs_claimable on public.background_jobs(job_type,available_at)
  where status='pending';

alter table public.background_jobs enable row level security;
revoke all on table public.background_jobs from public, anon;
/* Operational state, not tenant data. Owners can see that work is queued -- which is what makes a
 * stuck analysis visible in Admin rather than only in a log -- but nothing client-side may write to
 * it: the queue is the worker's, and a client-writable queue is a client-writable spend. */
create policy background_jobs_read on public.background_jobs
  for select to authenticated
  using (public.has_permission(organization_id,'organization.manage'));

/* Claims one job atomically.
 *
 * `for update skip locked` is what makes two workers safe: the second skips the row the first has
 * rather than blocking on it or, worse, both reading it as pending and running the same paid
 * analysis twice. Attempts increments on claim, not on failure -- a worker that dies mid-run without
 * reporting anything must still count as an attempt, or a job that reliably kills its worker retries
 * forever. */
create or replace function public.claim_background_job(p_job_type text, p_locked_by text)
returns setof public.background_jobs language plpgsql security definer set search_path=public as $$
declare claimed public.background_jobs;
begin
  select * into claimed from public.background_jobs
  where job_type=p_job_type and status='pending' and available_at<=now()
  order by priority desc, available_at
  for update skip locked
  limit 1;

  if claimed.id is null then return; end if;

  update public.background_jobs
  set status='processing', attempts=attempts+1, locked_at=now(), locked_by=p_locked_by
  where id=claimed.id
  returning * into claimed;

  return next claimed;
end $$;
revoke all on function public.claim_background_job(text,text) from public, anon, authenticated;
grant execute on function public.claim_background_job(text,text) to service_role;

/* Releases a claimed job. A failure below max_attempts goes back to pending with exponential backoff;
 * at the ceiling it dead-letters rather than looping, because a job that has failed five times is a
 * defect to look at, not a job to keep paying for. */
create or replace function public.release_background_job(p_job_id uuid, p_outcome text, p_error text default null)
returns text language plpgsql security definer set search_path=public as $$
declare job public.background_jobs; next_status text;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if job.id is null then raise exception 'background_job_not_found'; end if;

  if p_outcome='completed' then
    update public.background_jobs set status='completed', completed_at=now(), error_message=null where id=p_job_id;
    return 'completed';
  end if;

  next_status:=case when job.attempts>=job.max_attempts then 'dead_letter' else 'pending' end;
  update public.background_jobs
  set status=next_status,
      error_message=left(coalesce(p_error,''),500),
      locked_at=null, locked_by=null,
      -- 1, 2, 4, 8… minutes. Bounded by max_attempts, so this cannot grow without limit.
      available_at=case when next_status='pending' then now()+make_interval(mins=>power(2,greatest(job.attempts-1,0))::integer) else available_at end
  where id=p_job_id;
  return next_status;
end $$;
revoke all on function public.release_background_job(uuid,text,text) from public, anon, authenticated;
grant execute on function public.release_background_job(uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Analysis input fingerprints
-- ---------------------------------------------------------------------------------------------

/* What the analysis actually read, as one value.
 *
 * Includes the speaker MAPPING, not just the transcript text. Remapping who the candidate was does
 * not change a single word of the transcript but changes every attribution derived from it, so a
 * bundle hash over content alone would report an analysis as current after the thing it got wrong
 * was corrected.
 *
 * Ordered by transcript then speaker label so the value is stable across query plans.
 */
create or replace function public.interview_transcript_bundle_hash(p_interview_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select encode(sha256(convert_to(coalesce(string_agg(part,chr(30) order by part),''),'utf8')),'hex')
  from (
    select concat_ws(chr(31),
      t.id::text,t.checksum,
      coalesce(string_agg(concat_ws(chr(29),s.source_speaker_id,s.speaker_role,
        coalesce(s.member_id::text,''),coalesce(s.candidate_id::text,''),coalesce(s.contact_id::text,'')),
        chr(28) order by s.source_speaker_id),'')
    ) as part
    from public.interview_transcripts t
    left join public.interview_transcript_speakers s on s.transcript_id=t.id
    where t.interview_id=p_interview_id
      and t.status='ready' and t.purged_at is null and t.superseded_by_transcript_id is null
    group by t.id,t.checksum
  ) parts
$$;
revoke all on function public.interview_transcript_bundle_hash(uuid) from public, anon;
grant execute on function public.interview_transcript_bundle_hash(uuid) to authenticated;

/* Both rubrics, by identity and version. Activated rubrics are frozen, so id plus version is a
 * complete description -- there is no need to hash their items. */
create or replace function public.interview_rubric_bundle_hash(p_core_rubric_id uuid, p_job_rubric_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(core.id::text,''),coalesce(core.version::text,''),
    coalesce(job.id::text,''),coalesce(job.version::text,'')
  ),'utf8')),'hex')
  from (select id,version from public.interview_rubrics where id=p_core_rubric_id) core
  full join (select id,version from public.interview_rubrics where id=p_job_rubric_id) job on true
$$;
revoke all on function public.interview_rubric_bundle_hash(uuid,uuid) from public, anon;
grant execute on function public.interview_rubric_bundle_hash(uuid,uuid) to authenticated;

/* The candidate evidence the analysis is given -- and nothing else.
 *
 * Deliberately excludes email, phone, address and date of birth. Those are never sent to the model,
 * so a change in one must not invalidate an analysis: doing so would spend money re-running an
 * identical assessment because somebody fixed a typo in a phone number.
 */
create or replace function public.interview_candidate_input_hash(p_candidate_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(c.full_name,''),coalesce(c.current_company,''),coalesce(c.current_position,''),
    coalesce(c.location,''),coalesce(c.availability,''),coalesce(c.notice_period_days::text,''),
    coalesce(p.work_authorization,''),
    coalesce((select string_agg(concat_ws(chr(29),e.id::text,e.company_name,e.title,coalesce(e.summary,'')),chr(28) order by e.id)
      from public.candidate_employment e where e.candidate_id=c.id),''),
    coalesce((select string_agg(concat_ws(chr(29),ed.id::text,ed.institution,coalesce(ed.degree,'')),chr(28) order by ed.id)
      from public.candidate_education ed where ed.candidate_id=c.id),''),
    coalesce((select string_agg(sk.skill_id::text,chr(28) order by sk.skill_id)
      from public.candidate_skills sk where sk.candidate_id=c.id),'')
  ),'utf8')),'hex')
  from public.candidates c
  left join public.candidate_private_details p on p.candidate_id=c.id
  where c.id=p_candidate_id and public.is_organization_member(c.organization_id)
$$;
revoke all on function public.interview_candidate_input_hash(uuid) from public, anon;
grant execute on function public.interview_candidate_input_hash(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Analysis state
-- ---------------------------------------------------------------------------------------------

/* The latest run for an interview plus whether its inputs still describe reality.
 *
 * Staleness is a comparison of stored fingerprints against freshly computed ones, never a flag that
 * something sets. A flag has to be maintained by every write path that could invalidate a run, and
 * the one that forgets is the one that leaves a wrong analysis looking current.
 */
create or replace function public.get_interview_analysis_state(p_organization_id uuid, p_interview_id uuid)
returns table(
  run_id uuid,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  error_code text,
  is_stale boolean,
  stale_reason text,
  has_transcripts boolean,
  consent_status text
)
language sql stable security definer set search_path=public as $$
  with permitted as (
    select 1 where public.can_use_interview_intelligence(p_organization_id)
                or public.can_review_interview_quality(p_organization_id)
  ),
  latest as (
    select r.* from public.interview_analysis_runs r
    where r.interview_id=p_interview_id and r.organization_id=p_organization_id
      and r.status <> 'superseded'
    order by r.created_at desc
    limit 1
  ),
  fresh as (
    select
      public.interview_transcript_bundle_hash(p_interview_id) as transcript_hash,
      (select public.interview_rubric_bundle_hash(l.core_rubric_id,l.job_rubric_id) from latest l) as rubric_hash,
      (select public.interview_candidate_input_hash(jc.candidate_id)
         from latest l join public.job_candidates jc on jc.id=l.job_candidate_id) as candidate_hash
  )
  select
    latest.id,
    latest.status,
    latest.created_at,
    latest.completed_at,
    latest.error_code,
    case when latest.id is null or latest.status <> 'completed' then false
         else latest.transcript_bundle_hash is distinct from fresh.transcript_hash
           or latest.rubric_bundle_hash is distinct from fresh.rubric_hash
           or latest.candidate_input_hash is distinct from fresh.candidate_hash
    end,
    case when latest.id is null or latest.status <> 'completed' then null
         when latest.transcript_bundle_hash is distinct from fresh.transcript_hash then 'transcript'
         when latest.rubric_bundle_hash is distinct from fresh.rubric_hash then 'rubric'
         when latest.candidate_input_hash is distinct from fresh.candidate_hash then 'candidate'
         else null
    end,
    exists(select 1 from public.interview_transcripts t
      where t.interview_id=p_interview_id and t.status='ready'
        and t.purged_at is null and t.superseded_by_transcript_id is null),
    public.interview_consent_status(p_interview_id)
  from permitted
  left join latest on true
  left join fresh on true
$$;
revoke all on function public.get_interview_analysis_state(uuid,uuid) from public, anon;
grant execute on function public.get_interview_analysis_state(uuid,uuid) to authenticated;

commit;
