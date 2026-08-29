-- Structured job requirements.
--
-- `jobs.requirements` is a single free-text column that nothing in the product writes except the CSV
-- importer, so a job created in-app carries NULL. Three AI pipelines nonetheless treat it as their
-- requirement source, and generate-candidate-profile handled the gap by handing the raw description
-- to the model with "evaluate each distinct role requirement" -- letting the model decide what a
-- requirement IS. That makes the match score's denominator whatever the model invented on that run:
-- it fragments one requirement into three, promotes boilerplate ("competitive package") to a scored
-- criterion, and picks a different set next time, so two candidates on the same vacancy are not
-- comparable.
--
-- This gives a vacancy a closed, ordered, weighted requirement set that a recruiter owns. The model
-- is then asked to evidence exactly those rows and nothing else.

begin;

create table public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  label text not null,
  /* Only two levels, deliberately. A third ("preferred") reads as a decision the recruiter has not
   * actually made, and every extra level dilutes what must_have is for: the thing whose absence the
   * consultant has to see rather than have averaged away. Mirrors REQUIREMENT_LEVELS in
   * supabase/functions/_shared/interview-rubric-schema.ts, minus its 'not_applicable' -- a
   * requirement that does not apply is one you delete here, where the rubric had to keep the row. */
  requirement_level text not null default 'nice_to_have'
    check (requirement_level in ('must_have','nice_to_have')),
  category text not null default 'other'
    check (category in ('skill','experience','qualification','language','location','availability','other')),
  weight numeric(4,2) not null default 1 check (weight >= 0 and weight <= 10),
  evidence_expected text,
  /* Records how the row got here, so a workspace can tell a recruiter's own judgment from a model
   * suggestion nobody revised. 'ai_draft' is set on save, not on generation -- the drafting endpoint
   * persists nothing itself. */
  source text not null default 'manual' check (source in ('manual','ai_draft','import')),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /* Composite FK against jobs_id_org_key (added by 20260830000000_interview_intelligence_core.sql).
   * The house pattern for an org-scoped job child: it makes a row whose organization_id disagrees
   * with its job's unrepresentable, rather than leaving that to the RLS policy alone. */
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create index job_requirements_job_idx on public.job_requirements(organization_id, job_id, sort_order);

create trigger job_requirements_touch before update on public.job_requirements
for each row execute function public.touch_updated_at();

alter table public.job_requirements enable row level security;

-- Same permission pair as every other job child (see the table-driven loop at
-- 20260713000000_initial_agency_platform.sql:738). Requirements are internal recruiting data, not
-- client-facing, so they follow the job rather than getting a permission of their own.
create policy job_requirements_read on public.job_requirements
for select to authenticated using (public.has_permission(organization_id,'jobs.read'));
create policy job_requirements_write on public.job_requirements
for all to authenticated using (public.has_permission(organization_id,'jobs.write'))
with check (public.has_permission(organization_id,'jobs.write'));

comment on table public.job_requirements is
  'The closed, ordered requirement set a candidate is assessed against for one vacancy. Authored by a recruiter, optionally drafted by draft-job-requirements. Read by generate-candidate-profile as the complete set of things to evidence.';

/* Requirement edits must bust the candidate-profile dedup cache.
 *
 * generate-candidate-profile hashes candidate/job/template inputs into
 * candidate_profile_versions.input_hash and serves the stored draft on a match, and
 * hasStaleProfileInputs() drives the "stale" badge off input_versions.job_updated_at. Both read the
 * JOB row. Requirements living in their own table means editing one leaves jobs.updated_at
 * untouched -- so without this trigger the cache would keep serving, indefinitely and invisibly, a
 * profile scored against the requirement set the recruiter just replaced. Touching the parent makes
 * both existing mechanisms work unchanged, with no new column to thread through the hash.
 */
create or replace function public.touch_job_on_requirement_change()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_job uuid; v_organization uuid;
begin
  -- Branch on TG_OP rather than coalescing NEW and OLD: on DELETE, NEW is an unassigned record, and
  -- reading a field off it raises "record new is not assigned yet" rather than returning null.
  if tg_op='DELETE' then
    v_job:=old.job_id; v_organization:=old.organization_id;
  else
    v_job:=new.job_id; v_organization:=new.organization_id;
  end if;
  update public.jobs set updated_at=now()
  where id=v_job and organization_id=v_organization;
  if tg_op='DELETE' then return old; end if;
  return new;
end $fn$;
revoke all on function public.touch_job_on_requirement_change() from public,anon,authenticated;

create trigger job_requirements_touch_job
after insert or update or delete on public.job_requirements
for each row execute function public.touch_job_on_requirement_change();

/* Replace-the-whole-ordered-collection, modelled on replace_candidate_profile_section
 * (20260808010000_p0_atomic_recruitment_writes.sql:116). The editor is a list the recruiter reorders
 * and deletes from, so per-row writes would need diffing on the client and could half-apply.
 */
create or replace function public.replace_job_requirements(
  p_organization_id uuid,
  p_job_id uuid,
  p_items jsonb
) returns integer language plpgsql security definer set search_path=public as $fn$
declare
  item jsonb;
  v_position integer:=0;
  v_label text;
begin
  if not public.has_permission(p_organization_id,'jobs.write') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.jobs where id=p_job_id and organization_id=p_organization_id and deleted_at is null) then
    raise exception 'job_not_found' using errcode='P0002';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'invalid_requirement_list' using errcode='22023';
  end if;
  /* An unbounded requirement set is an unbounded prompt and a meaningless score -- every extra row
   * both costs tokens on every generation for this vacancy and shrinks what any single requirement
   * contributes. 40 is well past what a real brief carries; it is a guard, not a target. */
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 40 then
    raise exception 'too_many_requirements' using errcode='22023';
  end if;

  delete from public.job_requirements where organization_id=p_organization_id and job_id=p_job_id;

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_label:=nullif(trim(item->>'label'),'');
    if v_label is null then continue; end if;
    insert into public.job_requirements(
      organization_id,job_id,label,requirement_level,category,weight,evidence_expected,source,
      sort_order,created_by,updated_by
    ) values(
      p_organization_id,p_job_id,left(v_label,300),
      /* Coerced to the defaults rather than passed through to the CHECK constraints. A value outside
       * the set is the same class of mistake as an out-of-range weight below, and letting it reach
       * the constraint would surface as a raw Postgres violation over a form the recruiter cannot
       * see anything wrong with. nice_to_have is the safe default: it is the one that does NOT
       * silently promote something to a scored non-negotiable. */
      case when item->>'requirement_level' in ('must_have','nice_to_have') then item->>'requirement_level' else 'nice_to_have' end,
      case when item->>'category' in ('skill','experience','qualification','language','location','availability','other') then item->>'category' else 'other' end,
      -- Clamped rather than rejected: an out-of-range weight is a loose number in a form, not a
      -- policy breach, and refusing the whole save over it would lose the recruiter's other edits.
      least(greatest(coalesce(nullif(item->>'weight','')::numeric,1),0),10),
      nullif(trim(item->>'evidence_expected'),''),
      case when item->>'source' in ('manual','ai_draft','import') then item->>'source' else 'manual' end,
      v_position,auth.uid(),auth.uid()
    );
    v_position:=v_position+1;
  end loop;

  return v_position;
end $fn$;

revoke all on function public.replace_job_requirements(uuid,uuid,jsonb) from public,anon;
grant execute on function public.replace_job_requirements(uuid,uuid,jsonb) to authenticated;

/* Requirement drafting reads a job and never a candidate, so like interview_rubric it cannot satisfy
 * ai_evaluations' candidate scope check. Widened rather than worked around, for the reason given when
 * that constraint was written (20260831000000_interview_blueprints.sql:17): ANTHROPIC_API_KEY is one
 * key for the whole deployment, so drafting spend has to land in the same table as every other call
 * or it is spend nobody can add up.
 *
 * Rebuilt from the CURRENT definition. Dropping and re-adding by the same name is what keeps this
 * from silently reverting the interview_rubric branch.
 */
alter table public.ai_evaluations
  drop constraint if exists ai_evaluations_candidate_scope;
alter table public.ai_evaluations
  add constraint ai_evaluations_candidate_scope
  check (evaluation_type in ('interview_rubric','job_requirements_draft') or candidate_id is not null);

/* finalize_candidate_profile, rebuilt from its CURRENT definition in
 * 20260720120000_candidate_profile_docx_only.sql -- NOT from the original in 20260716050000, which
 * still requires a PDF document and would silently reinstate the dual-format contract.
 *
 * The only change is the restore chain: must_have_coverage and requirements_source join
 * requirement_evidence and score as internal evaluation facts the caller cannot edit. Without this,
 * the two new internal fields would be the only ones on the draft a direct RPC caller could rewrite,
 * which is exactly the asymmetry the original jsonb_set pair exists to prevent.
 */
create or replace function public.finalize_candidate_profile(
  p_organization_id uuid,
  p_profile_version_id uuid,
  p_reviewed_content jsonb,
  p_anonymized boolean,
  p_docx_document_id uuid,
  p_pdf_document_id uuid default null,
  p_edited_field_count integer default 0
) returns uuid language plpgsql security definer set search_path=public as $fn$
declare profile_row public.candidate_profile_versions%rowtype; activity_id uuid; candidate_name text; job_title text;
begin
  if not public.has_permission(p_organization_id,'ai.use') or not public.has_permission(p_organization_id,'candidates.write') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select * into profile_row from public.candidate_profile_versions
  where id=p_profile_version_id and organization_id=p_organization_id for update;
  if not found then raise exception 'profile_version_not_found' using errcode='P0002'; end if;
  if not exists(select 1 from public.candidates where id=profile_row.candidate_id and organization_id=p_organization_id and deleted_at is null)
     or not exists(select 1 from public.jobs where id=profile_row.job_id and organization_id=p_organization_id and deleted_at is null)
     or not exists(select 1 from public.templates where id=profile_row.template_id and organization_id=p_organization_id and template_type='candidate_profile' and deleted_at is null)
     or not exists(select 1 from public.ai_evaluations where id=profile_row.ai_evaluation_id and organization_id=p_organization_id and candidate_id=profile_row.candidate_id and job_id=profile_row.job_id and status='completed')
     or not exists(select 1 from public.job_candidates where organization_id=p_organization_id and candidate_id=profile_row.candidate_id and job_id=profile_row.job_id) then
    raise exception 'invalid_profile_scope' using errcode='22023';
  end if;
  if profile_row.status='finalized' then
    if profile_row.docx_document_id=p_docx_document_id then return profile_row.id; end if;
    raise exception 'profile_version_already_finalized' using errcode='P0001';
  end if;
  if jsonb_typeof(p_reviewed_content)<>'object' or coalesce(p_reviewed_content->>'candidate_summary','')='' then
    raise exception 'invalid_profile_content' using errcode='22023';
  end if;
  -- Evidence and deterministic scoring are internal evaluation facts, not editable
  -- client-facing copy. Preserve them even if a direct RPC caller tampers with JSON.
  p_reviewed_content:=jsonb_set(jsonb_set(p_reviewed_content,'{requirement_evidence}',profile_row.generated_content->'requirement_evidence',true),'{score}',profile_row.generated_content->'score',true);
  -- Absent on drafts generated before structured requirements shipped; jsonb_set with a NULL new
  -- value would blank the whole object, so only restore what the generated draft actually carries.
  if profile_row.generated_content ? 'must_have_coverage' then
    p_reviewed_content:=jsonb_set(p_reviewed_content,'{must_have_coverage}',profile_row.generated_content->'must_have_coverage',true);
  end if;
  if profile_row.generated_content ? 'requirements_source' then
    p_reviewed_content:=jsonb_set(p_reviewed_content,'{requirements_source}',profile_row.generated_content->'requirements_source',true);
  end if;
  if not exists(
    select 1 from public.documents document
    join public.document_links link on link.document_id=document.id
    where document.id=p_docx_document_id and document.organization_id=p_organization_id
      and document.document_type='candidate_profile' and document.mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and document.deleted_at is null and link.organization_id=p_organization_id and link.candidate_id=profile_row.candidate_id
  ) then raise exception 'invalid_docx_document' using errcode='22023'; end if;

  update public.candidate_profile_versions set
    status='finalized',reviewed_content=p_reviewed_content,anonymized=p_anonymized,
    docx_document_id=p_docx_document_id,
    edited_field_count=greatest(coalesce(p_edited_field_count,0),0),exported_formats=array['docx'],
    export_failure_reason=null,finalization_ms=greatest(0,floor(extract(epoch from (now()-profile_row.created_at))*1000)::bigint),finalized_at=now()
  where id=profile_row.id;

  select full_name into candidate_name from public.candidates where id=profile_row.candidate_id and organization_id=p_organization_id;
  select title into job_title from public.jobs where id=profile_row.job_id and organization_id=p_organization_id;
  insert into public.activities(organization_id,activity_type,direction,subject,summary,created_by)
  values(p_organization_id,'other','internal','Client profile finalized',format('Finalized %s profile for %s.',case when p_anonymized then 'anonymized' else 'named' end,job_title),auth.uid())
  returning id into activity_id;
  insert into public.activity_links(organization_id,activity_id,candidate_id) values(p_organization_id,activity_id,profile_row.candidate_id);
  insert into public.activity_links(organization_id,activity_id,job_id) values(p_organization_id,activity_id,profile_row.job_id);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'candidate_profile.finalized','candidate_profile_version',profile_row.id,
    jsonb_build_object('candidate_id',profile_row.candidate_id,'job_id',profile_row.job_id,'anonymized',p_anonymized,'edited_field_count',greatest(coalesce(p_edited_field_count,0),0)));
  return profile_row.id;
end $fn$;

-- Signature is unchanged, so the original grants still apply; restated for a self-contained migration.
revoke all on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) from public,anon;
grant execute on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) to authenticated;

commit;
