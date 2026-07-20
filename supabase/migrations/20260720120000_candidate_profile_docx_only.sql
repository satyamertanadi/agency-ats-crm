-- The client-facing profile is now a single DOCX. The mandatory client template is a Word file that
-- consultants still complete by hand before sending, so a generated PDF was an approximation nobody
-- could use -- it was rendered by a separate hand-rolled renderer and could never match the template
-- byte for byte. Requiring one made every finalization produce a file destined to be discarded.
--
-- pdf_document_id is deliberately NOT dropped: rows finalized under the dual-format contract keep
-- their PDF reference so historical exports stay auditable. The parameter is likewise retained on
-- the function, defaulted and ignored, which keeps the signature -- and therefore the existing
-- REVOKE/GRANT and PostgREST resolution -- untouched.
begin;

-- The original CHECK was declared inline and so carries a generated name. Discover it rather than
-- guessing, and only drop the one that actually mentions pdf_document_id.
do $$
declare target_name text;
begin
  select con.conname into target_name
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace nsp on nsp.oid=rel.relnamespace
  where nsp.nspname='public' and rel.relname='candidate_profile_versions'
    and con.contype='c' and pg_get_constraintdef(con.oid) like '%pdf_document_id%';
  if target_name is not null then
    execute format('alter table public.candidate_profile_versions drop constraint %I',target_name);
  end if;
end $$;

-- Loosened, not removed: a finalized row still must carry reviewed content, a DOCX, and a timestamp.
-- Already-finalized rows hold both document ids and satisfy this unchanged.
alter table public.candidate_profile_versions
  add constraint candidate_profile_versions_finalized_docx_check
  check(status <> 'finalized' or (reviewed_content is not null and docx_document_id is not null and finalized_at is not null));

create or replace function public.finalize_candidate_profile(
  p_organization_id uuid,
  p_profile_version_id uuid,
  p_reviewed_content jsonb,
  p_anonymized boolean,
  p_docx_document_id uuid,
  p_pdf_document_id uuid default null,
  p_edited_field_count integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
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
end $$;

-- Signature is unchanged, so the original grants still apply; restated for a self-contained migration.
revoke all on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) from public,anon;
grant execute on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) to authenticated;

commit;
