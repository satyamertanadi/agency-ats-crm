-- F12: create_job_with_pipeline checks the caller's permission on p_organization_id but never
-- checks that p_company_id actually belongs to it, so a caller who knows (or guesses) another
-- tenant's company id can create a job in their own org that FK-references a foreign company.
-- create_submission_package had the matching gap for p_job_id, closed in
-- 20260716050000_evidence_candidate_profiles.sql (see job_not_found/contact_not_found there); this
-- applies the same pattern here, the one RPC F12 flagged that never got it.
create or replace function public.create_job_with_pipeline(p_organization_id uuid,p_company_id uuid,p_title text,p_owner_member_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare source_id uuid; new_pipeline uuid; new_job uuid;
begin
  if not public.has_permission(p_organization_id,'jobs.write') then raise exception 'Access denied'; end if;
  if not exists(select 1 from public.companies where id=p_company_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'company_not_found' using errcode='P0002'; end if;
  select id into source_id from public.pipelines where organization_id=p_organization_id and kind='template' and is_default;
  insert into public.jobs(organization_id,company_id,title,owner_member_id,created_by,opened_at) values(p_organization_id,p_company_id,trim(p_title),p_owner_member_id,auth.uid(),now()) returning id into new_job;
  insert into public.pipelines(organization_id,name,kind,source_pipeline_id,job_id) values(p_organization_id,p_title||' pipeline','job',source_id,new_job) returning id into new_pipeline;
  insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,position,color,is_client_visible)
    select p_organization_id,new_pipeline,name,stage_key,stage_type,position,color,is_client_visible from public.pipeline_stages where pipeline_id=source_id order by position;
  update public.jobs set pipeline_id=new_pipeline where id=new_job;
  return new_job;
end $$;
