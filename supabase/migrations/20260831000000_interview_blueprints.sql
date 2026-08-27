begin;

-- Interview blueprints, WS2: the job-side half of Release A0.
--
-- A blueprint is the job-specific rubric an interview is measured against. It is generated as a
-- draft, reviewed by a human, and only then activated -- the model never activates anything, and
-- activating a blueprint never writes back into the job's own fields.
--
-- The piece that needed the most care is staleness. The plan's requirement is that unrelated edits
-- must not mark a blueprint outdated, because a warning that fires when somebody reassigns the job
-- owner is a warning people learn to ignore.

-- ---------------------------------------------------------------------------------------------
-- AI spend accounting
-- ---------------------------------------------------------------------------------------------

/* Rubric generation reads a job and never a candidate, so it cannot satisfy ai_evaluations'
 * candidate_id NOT NULL. The alternative -- a private token counter on interview_rubrics -- was
 * rejected: ANTHROPIC_API_KEY is one key for the whole deployment, so spend split across two tables
 * is spend nobody can add up, and the existing monthly ceiling would not see it.
 *
 * Widening the column is safe for what is already there: every existing row has a candidate, and
 * every existing writer supplies one. The check keeps it that way for candidate-scoped types. */
alter table public.ai_evaluations alter column candidate_id drop not null;
alter table public.ai_evaluations
  drop constraint if exists ai_evaluations_candidate_scope;
alter table public.ai_evaluations
  add constraint ai_evaluations_candidate_scope
  check (evaluation_type = 'interview_rubric' or candidate_id is not null);

-- Composite identity key, matching the pattern the interview domain uses throughout, so a rubric
-- cannot cite a generation record from another workspace.
alter table public.ai_evaluations add constraint ai_evaluations_id_org_key unique (id, organization_id);

alter table public.interview_rubrics
  add column if not exists ai_evaluation_id uuid;
alter table public.interview_rubrics
  drop constraint if exists interview_rubrics_ai_evaluation_fkey;
alter table public.interview_rubrics
  add constraint interview_rubrics_ai_evaluation_fkey
  foreign key (ai_evaluation_id, organization_id)
  references public.ai_evaluations(id, organization_id)
  on delete set null (ai_evaluation_id);

comment on column public.interview_rubrics.ai_evaluation_id is
  'The tracked generation this draft came from. Null for a blueprint written by hand.';

-- Mirrors candidate_profile_token_spend_this_month exactly, including the service-role-only grant:
-- there is no legitimate reason for a client to read another organization''s aggregate spend, and
-- this function does not check has_permission itself.
create or replace function public.interview_rubric_token_spend_this_month(p_organization_id uuid)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)
  from public.ai_evaluations
  where organization_id=p_organization_id and evaluation_type='interview_rubric'
    and created_at >= date_trunc('month', now())
$$;
revoke all on function public.interview_rubric_token_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.interview_rubric_token_spend_this_month(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Job brief hash
-- ---------------------------------------------------------------------------------------------

/* The deterministic fingerprint of everything about a job that could change what an interviewer
 * should ask.
 *
 * Deliberately NOT jobs.updated_at. That column moves when the owner changes, when the status moves
 * to on_hold, when someone edits internal_notes -- none of which change a single question worth
 * asking. A blueprint marked stale by those edits produces a warning consultants learn to dismiss,
 * which is worse than no warning at all.
 *
 * Included: title, description, requirements, location, employment type, and the compensation band,
 * because an interviewer discusses all of them. Excluded: owner, status, priority, internal notes,
 * client-visible notes, fee terms, dates. The selected JD document is folded in by id and version, so
 * approving a new version of the JD does mark the blueprint stale.
 *
 * The unit separator between fields stops "ab"+"c" from hashing the same as "a"+"bc". */
create or replace function public.interview_job_brief_hash(p_job_id uuid, p_document_id uuid default null)
returns text language sql stable security definer set search_path=public as $$
  select encode(sha256(convert_to(
    concat_ws(chr(31),
      coalesce(j.title,''),
      coalesce(j.description,''),
      coalesce(j.requirements,''),
      coalesce(j.location,''),
      coalesce(j.employment_type,''),
      coalesce(j.salary_min::text,''),
      coalesce(j.salary_max::text,''),
      coalesce(j.currency::text,''),
      coalesce(d.id::text,''),
      coalesce(d.version::text,'')
    ),'utf8'),'hex')
  from public.jobs j
  left join public.documents d
    on d.id=p_document_id and d.organization_id=j.organization_id and d.deleted_at is null
  -- Definer, so the hash is identical no matter who asks -- a caller holding jobs.read but not
  -- candidates.read must not compute a different fingerprint and see phantom staleness. Membership is
  -- therefore checked explicitly: without it, any authenticated user could fingerprint another
  -- workspace's job text and watch it change.
  where j.id=p_job_id and public.is_organization_member(j.organization_id)
$$;
revoke all on function public.interview_job_brief_hash(uuid,uuid) from public, anon;
grant execute on function public.interview_job_brief_hash(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Blueprint status
-- ---------------------------------------------------------------------------------------------

/* Everything the Job Workspace panel shows, in one bounded call: which blueprint is active, how big
 * it is, whether a draft is waiting, whether the job has moved underneath it, and whether the agency
 * core rubric an analysis also needs actually exists.
 *
 * One row always, even for a job with no blueprint at all -- the panel has an empty state to render
 * and should not have to special-case a missing row. */
create or replace function public.get_interview_blueprint_status(p_organization_id uuid, p_job_id uuid)
returns table(
  rubric_id uuid,
  version integer,
  activated_at timestamptz,
  source_document_id uuid,
  essential_question_count integer,
  must_have_count integer,
  nice_to_have_count integer,
  is_stale boolean,
  draft_rubric_id uuid,
  draft_updated_at timestamptz,
  core_rubric_id uuid,
  core_rubric_version integer
)
language sql stable security definer set search_path=public as $$
  with permitted as (
    select 1
    where public.can_use_interview_intelligence(p_organization_id)
       or public.can_configure_interview_intelligence(p_organization_id)
  ),
  job as (
    select j.id from public.jobs j
    where j.id=p_job_id and j.organization_id=p_organization_id and j.deleted_at is null
  ),
  active as (
    select r.* from public.interview_rubrics r, job
    where r.job_id=job.id and r.rubric_type='job' and r.status='active'
    limit 1
  ),
  draft as (
    select r.id, r.created_at from public.interview_rubrics r, job
    where r.job_id=job.id and r.rubric_type='job' and r.status='draft'
    order by r.created_at desc
    limit 1
  ),
  core as (
    select r.id, r.version from public.interview_rubrics r
    where r.organization_id=p_organization_id and r.rubric_type='core' and r.status='active'
    limit 1
  ),
  counts as (
    select
      count(*) filter (where i.item_type='essential_question')::integer as essential_question_count,
      count(*) filter (where i.requirement_level='must_have')::integer as must_have_count,
      count(*) filter (where i.requirement_level='nice_to_have')::integer as nice_to_have_count
    from public.interview_rubric_items i, active
    where i.rubric_id=active.id
  )
  select
    active.id,
    active.version,
    active.activated_at,
    active.source_document_id,
    coalesce(counts.essential_question_count,0),
    coalesce(counts.must_have_count,0),
    coalesce(counts.nice_to_have_count,0),
    -- Only a blueprint that exists can be stale. A job with none is "not set up", which the panel
    -- says differently and which must not read as a warning.
    case when active.id is null then false
         else active.job_brief_hash is distinct from public.interview_job_brief_hash(p_job_id, active.source_document_id)
    end,
    draft.id,
    draft.created_at,
    core.id,
    core.version
  from permitted
  cross join job
  left join active on true
  left join draft on true
  left join core on true
  left join counts on true
$$;
revoke all on function public.get_interview_blueprint_status(uuid,uuid) from public, anon;
grant execute on function public.get_interview_blueprint_status(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Activation
-- ---------------------------------------------------------------------------------------------

/* Activation is the human decision the whole draft/active split exists to protect, so it is an
 * audited RPC rather than a client UPDATE -- even though a holder of interview_intelligence.configure
 * could technically flip the column through the table policy.
 *
 * Archiving the incumbent and activating the successor happen in one transaction because the partial
 * unique indexes allow exactly one active rubric per scope: doing it in two client round trips would
 * fail on the index half the time and, worse, could leave a job with no active blueprint in between. */
create or replace function public.activate_interview_rubric(p_organization_id uuid, p_rubric_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare target public.interview_rubrics; previous_id uuid;
begin
  -- activated_by is NOT NULL for an active rubric, so a caller with no session would fail the check
  -- constraint with an error about the constraint rather than about the real problem.
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_configure_interview_intelligence(p_organization_id) then
    raise exception 'permission_denied';
  end if;

  select * into target from public.interview_rubrics
  where id=p_rubric_id and organization_id=p_organization_id
  for update;

  if target.id is null then raise exception 'interview_rubric_not_found'; end if;
  if target.status='active' then return target.id; end if;
  if target.status='archived' then raise exception 'interview_rubric_archived_is_final'; end if;

  -- A blueprint with nothing in it would silently pass an analysis as "fully covered".
  if not exists(select 1 from public.interview_rubric_items where rubric_id=target.id) then
    raise exception 'interview_rubric_empty';
  end if;

  if target.rubric_type='core' then
    update public.interview_rubrics set status='archived', archived_at=now()
    where organization_id=p_organization_id and rubric_type='core' and status='active'
    returning id into previous_id;
  else
    update public.interview_rubrics set status='archived', archived_at=now()
    where job_id=target.job_id and rubric_type='job' and status='active'
    returning id into previous_id;
  end if;

  update public.interview_rubrics
  set status='active', activated_by=auth.uid(), activated_at=now()
  where id=target.id;

  -- Identifiers only: which blueprint, for which job, replacing which. No blueprint content.
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_rubric.activated','interview_rubric',target.id,
    jsonb_build_object('job_id',target.job_id,'rubric_type',target.rubric_type,'version',target.version,'replaced_rubric_id',previous_id));

  return target.id;
end $$;
revoke all on function public.activate_interview_rubric(uuid,uuid) from public, anon;
grant execute on function public.activate_interview_rubric(uuid,uuid) to authenticated;

commit;
