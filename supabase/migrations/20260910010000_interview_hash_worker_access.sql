begin;

-- Automatic analysis could never have created a run.
--
-- interview_job_brief_hash and interview_candidate_input_hash both end in
-- `and public.is_organization_member(...)`, which reads auth.uid(). A worker has no session, so
-- auth.uid() is null, the predicate is false, the row is filtered out and the function returns NULL
-- -- and job_input_hash and candidate_input_hash are NOT NULL columns on interview_analysis_runs.
--
-- So internal_request_interview_analysis, called by the worker to convert an interview_auto_analysis
-- intent into a run, would fail with 23502 every time. Nobody had seen it because automatic analysis
-- has never been switched on anywhere; a Phase 2 test calling the request path as the worker does is
-- what surfaced it.
--
-- The membership check is still right for the case it was written for. Its comment says so: without
-- it, any authenticated user could fingerprint another workspace's job text and watch it change. That
-- reasoning is about an authenticated caller, and it still applies to one.
--
-- The added clause admits exactly the sessionless case. auth.uid() is null only when there is no end
-- user -- the service role, or an enclosing SECURITY DEFINER function -- and anon cannot reach either
-- function, because EXECUTE was revoked from anon and granted only to authenticated. A caller who
-- does have a session must still be a member.

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
    ),'utf8')),'hex')
  from public.jobs j
  left join public.documents d
    on d.id=p_document_id and d.organization_id=j.organization_id and d.deleted_at is null
  -- Definer, so the hash is identical no matter who asks -- a caller holding jobs.read but not
  -- candidates.read must not compute a different fingerprint and see phantom staleness. Membership is
  -- therefore checked explicitly: without it, any authenticated user could fingerprint another
  -- workspace's job text and watch it change. The null-uid branch admits the worker, which has no
  -- session and cannot be a member of anything.
  where j.id=p_job_id
    and (auth.uid() is null or public.is_organization_member(j.organization_id))
$$;
revoke all on function public.interview_job_brief_hash(uuid,uuid) from public, anon;
grant execute on function public.interview_job_brief_hash(uuid,uuid) to authenticated;
grant execute on function public.interview_job_brief_hash(uuid,uuid) to service_role;

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
  where c.id=p_candidate_id
    and (auth.uid() is null or public.is_organization_member(c.organization_id))
$$;
revoke all on function public.interview_candidate_input_hash(uuid) from public, anon;
grant execute on function public.interview_candidate_input_hash(uuid) to authenticated;
grant execute on function public.interview_candidate_input_hash(uuid) to service_role;

commit;
