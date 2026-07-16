begin;

-- Evidence-backed candidate profiles. Generated content is always a draft until a
-- recruiter finalizes an immutable version and links both private output files.

alter table public.templates
  add column if not exists configuration jsonb not null default '{"schema_version":1,"output_language":"en","anonymize_by_default":false,"confidentiality_text":"This candidate profile is confidential and intended only for the named client recruitment process.","sections":[{"key":"summary","label":"Candidate summary","visible":true},{"key":"information","label":"Information","visible":true},{"key":"experience","label":"Work experience","visible":true},{"key":"education","label":"Education","visible":true},{"key":"strengths","label":"Strengths and opportunities","visible":true},{"key":"risks","label":"Risks and challenges","visible":true},{"key":"questions","label":"Points to validate","visible":true}]}'::jsonb,
  add column if not exists version integer not null default 1 check(version >= 1),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists deleted_at timestamptz;

create unique index if not exists one_default_candidate_profile_template
  on public.templates(organization_id)
  where template_type='candidate_profile' and is_default and deleted_at is null;

alter table public.ai_evaluations
  add column if not exists input_hash text,
  add column if not exists input_versions jsonb not null default '{}'::jsonb,
  add column if not exists input_tokens integer check(input_tokens is null or input_tokens >= 0),
  add column if not exists output_tokens integer check(output_tokens is null or output_tokens >= 0),
  add column if not exists duration_ms integer check(duration_ms is null or duration_ms >= 0),
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists completed_at timestamptz;

-- The previous endpoint could leave rows queued forever because no worker existed.
update public.ai_evaluations
set status='failed',failure_code='retired_queued_evaluation',failure_message='The queued-only evaluator was retired before processing.',completed_at=now()
where status='queued';

create table public.candidate_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id),
  job_id uuid not null references public.jobs(id),
  template_id uuid not null references public.templates(id),
  template_version integer not null check(template_version >= 1),
  ai_evaluation_id uuid not null references public.ai_evaluations(id),
  version integer not null default 1 check(version >= 1),
  status text not null default 'draft' check(status in ('draft','finalized','failed')),
  generated_content jsonb not null,
  reviewed_content jsonb,
  template_snapshot jsonb not null,
  input_hash text not null,
  input_versions jsonb not null default '{}'::jsonb,
  anonymized boolean not null default false,
  generation_ms integer not null default 0 check(generation_ms >= 0),
  finalization_ms bigint check(finalization_ms is null or finalization_ms >= 0),
  edited_field_count integer check(edited_field_count is null or edited_field_count >= 0),
  exported_formats text[] not null default '{}'::text[],
  export_failure_reason text,
  submitted_at timestamptz,
  docx_document_id uuid references public.documents(id),
  pdf_document_id uuid references public.documents(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique(organization_id,candidate_id,job_id,version),
  check(status <> 'finalized' or (reviewed_content is not null and docx_document_id is not null and pdf_document_id is not null and finalized_at is not null))
);

create index candidate_profile_versions_candidate_created
  on public.candidate_profile_versions(organization_id,candidate_id,created_at desc);
create index candidate_profile_versions_job_created
  on public.candidate_profile_versions(organization_id,job_id,created_at desc);

create or replace function public.assign_candidate_profile_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||new.candidate_id::text||new.job_id::text,0));
  select coalesce(max(version),0)+1 into new.version
  from public.candidate_profile_versions
  where organization_id=new.organization_id and candidate_id=new.candidate_id and job_id=new.job_id;
  return new;
end $$;
revoke all on function public.assign_candidate_profile_version() from public,anon,authenticated;

create trigger candidate_profile_version_number
  before insert on public.candidate_profile_versions
  for each row execute function public.assign_candidate_profile_version();

create or replace function public.bump_candidate_profile_template_version()
returns trigger language plpgsql set search_path=public as $$
begin
  if row(new.name,new.content,new.configuration,new.is_default,new.deleted_at)
     is distinct from row(old.name,old.content,old.configuration,old.is_default,old.deleted_at) then
    new.version:=old.version+1;
  end if;
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  return new;
end $$;

create trigger candidate_profile_template_version
  before update on public.templates
  for each row execute function public.bump_candidate_profile_template_version();

alter table public.candidate_profile_versions enable row level security;

create policy candidate_profile_versions_read on public.candidate_profile_versions
  for select to authenticated
  using(public.has_permission(organization_id,'candidates.read'));

-- Template editing is intentionally owner/admin-only. Consultants can read and
-- select active templates while creating submissions.
drop policy if exists templates_read on public.templates;
drop policy if exists templates_write on public.templates;
create policy templates_read on public.templates for select to authenticated
  using(deleted_at is null and public.has_permission(organization_id,'submissions.read'));
create policy templates_write on public.templates for all to authenticated
  using(public.has_permission(organization_id,'organization.manage'))
  with check(public.has_permission(organization_id,'organization.manage'));

-- AI rows are service-written; authenticated users may read evidence through RLS
-- but cannot forge scores, model metadata, or outcome data directly.
drop policy if exists ai_evaluations_write on public.ai_evaluations;

create or replace function public.default_candidate_profile_configuration(p_language text default 'en')
returns jsonb language sql immutable set search_path=public as $$
  select case when p_language='id' then
    '{"schema_version":1,"output_language":"id","anonymize_by_default":false,"confidentiality_text":"Profil kandidat ini bersifat rahasia dan hanya ditujukan untuk proses rekrutmen klien yang disebutkan.","sections":[{"key":"summary","label":"Ringkasan kandidat","visible":true},{"key":"information","label":"Informasi","visible":true},{"key":"experience","label":"Pengalaman kerja","visible":true},{"key":"education","label":"Pendidikan","visible":true},{"key":"strengths","label":"Kekuatan dan peluang","visible":true},{"key":"risks","label":"Risiko dan tantangan","visible":true},{"key":"questions","label":"Hal yang perlu divalidasi","visible":true}]}'::jsonb
  else
    '{"schema_version":1,"output_language":"en","anonymize_by_default":false,"confidentiality_text":"This candidate profile is confidential and intended only for the named client recruitment process.","sections":[{"key":"summary","label":"Candidate summary","visible":true},{"key":"information","label":"Information","visible":true},{"key":"experience","label":"Work experience","visible":true},{"key":"education","label":"Education","visible":true},{"key":"strengths","label":"Strengths and opportunities","visible":true},{"key":"risks","label":"Risks and challenges","visible":true},{"key":"questions","label":"Points to validate","visible":true}]}'::jsonb end
$$;
revoke all on function public.default_candidate_profile_configuration(text) from public,anon,authenticated;

create or replace function public.create_default_candidate_profile_template()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.templates(organization_id,name,template_type,content,configuration,is_default,created_by)
  values(new.id,'Standard client profile','candidate_profile','',public.default_candidate_profile_configuration('en'),true,new.created_by)
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.create_default_candidate_profile_template() from public,anon,authenticated;

create trigger organizations_default_candidate_profile_template
  after insert on public.organizations
  for each row execute function public.create_default_candidate_profile_template();

insert into public.templates(organization_id,name,template_type,content,configuration,is_default,created_by)
select organization.id,'Standard client profile','candidate_profile','',public.default_candidate_profile_configuration('en'),true,organization.created_by
from public.organizations organization
where not exists(
  select 1 from public.templates template
  where template.organization_id=organization.id and template.template_type='candidate_profile' and template.deleted_at is null
);

update public.organization_settings
set settings=jsonb_set(settings,'{profile_v1}','false'::jsonb,true),updated_at=now()
where not (settings ? 'profile_v1');

create or replace function public.save_candidate_profile_template(
  p_organization_id uuid,
  p_template_id uuid,
  p_name text,
  p_configuration jsonb,
  p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare result_id uuid;
begin
  if not public.has_permission(p_organization_id,'organization.manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80 then
    raise exception 'invalid_template_name' using errcode='22023';
  end if;
  if coalesce(jsonb_typeof(p_configuration),'null')<>'object'
     or p_configuration->>'schema_version'<>'1'
     or p_configuration->>'output_language' not in ('en','id')
     or coalesce(jsonb_typeof(p_configuration->'anonymize_by_default'),'null')<>'boolean'
     or length(trim(coalesce(p_configuration->>'confidentiality_text',''))) not between 1 and 1200
     or coalesce(jsonb_typeof(p_configuration->'sections'),'null')<>'array' then
    raise exception 'invalid_template_configuration' using errcode='22023';
  end if;
  if jsonb_array_length(p_configuration->'sections')<>7
     or (select count(distinct section->>'key') from jsonb_array_elements(p_configuration->'sections') section)<>7
     or exists(select 1 from jsonb_array_elements(p_configuration->'sections') section
       where section->>'key' not in ('summary','information','experience','education','strengths','risks','questions')
          or length(trim(coalesce(section->>'label',''))) not between 1 and 80
          or jsonb_typeof(section->'visible')<>'boolean') then
    raise exception 'invalid_template_configuration' using errcode='22023';
  end if;

  if p_is_default then
    update public.templates set is_default=false
    where organization_id=p_organization_id and template_type='candidate_profile'
      and deleted_at is null and (p_template_id is null or id<>p_template_id);
  end if;

  if p_template_id is null then
    insert into public.templates(organization_id,name,template_type,content,configuration,is_default,created_by,updated_by)
    values(p_organization_id,trim(p_name),'candidate_profile','',p_configuration,p_is_default,auth.uid(),auth.uid())
    returning id into result_id;
  else
    update public.templates
    set name=trim(p_name),configuration=p_configuration,is_default=p_is_default,deleted_at=null
    where id=p_template_id and organization_id=p_organization_id and template_type='candidate_profile'
    returning id into result_id;
    if result_id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
  end if;

  if not exists(select 1 from public.templates where organization_id=p_organization_id and template_type='candidate_profile' and deleted_at is null and is_default) then
    update public.templates set is_default=true where id=result_id;
  end if;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'candidate_profile_template.saved','template',result_id,jsonb_build_object('is_default',p_is_default));
  return result_id;
end $$;
revoke all on function public.save_candidate_profile_template(uuid,uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.save_candidate_profile_template(uuid,uuid,text,jsonb,boolean) to authenticated;

create or replace function public.archive_candidate_profile_template(p_organization_id uuid,p_template_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare was_default boolean; replacement_id uuid;
begin
  if not public.has_permission(p_organization_id,'organization.manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select is_default into was_default from public.templates
  where id=p_template_id and organization_id=p_organization_id and template_type='candidate_profile' and deleted_at is null;
  if not found then raise exception 'template_not_found' using errcode='P0002'; end if;
  select id into replacement_id from public.templates
  where organization_id=p_organization_id and template_type='candidate_profile' and deleted_at is null and id<>p_template_id
  order by is_default desc,created_at limit 1;
  if replacement_id is null then raise exception 'last_template_required' using errcode='22023'; end if;
  update public.templates set deleted_at=now(),is_default=false where id=p_template_id;
  if was_default then update public.templates set is_default=true where id=replacement_id; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'candidate_profile_template.archived','template',p_template_id);
end $$;
revoke all on function public.archive_candidate_profile_template(uuid,uuid) from public,anon;
grant execute on function public.archive_candidate_profile_template(uuid,uuid) to authenticated;

create or replace function public.finalize_candidate_profile(
  p_organization_id uuid,
  p_profile_version_id uuid,
  p_reviewed_content jsonb,
  p_anonymized boolean,
  p_docx_document_id uuid,
  p_pdf_document_id uuid,
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
    if profile_row.docx_document_id=p_docx_document_id and profile_row.pdf_document_id=p_pdf_document_id then return profile_row.id; end if;
    raise exception 'profile_version_already_finalized' using errcode='P0001';
  end if;
  if jsonb_typeof(p_reviewed_content)<>'object' or coalesce(p_reviewed_content->>'candidate_summary','')='' then
    raise exception 'invalid_profile_content' using errcode='22023';
  end if;
  -- Evidence and deterministic scoring are internal evaluation facts, not editable
  -- client-facing copy. Preserve them even if a direct RPC caller tampers with JSON.
  p_reviewed_content:=jsonb_set(jsonb_set(p_reviewed_content,'{requirement_evidence}',profile_row.generated_content->'requirement_evidence',true),'{score}',profile_row.generated_content->'score',true);
  if p_docx_document_id=p_pdf_document_id then raise exception 'distinct_profile_documents_required' using errcode='22023'; end if;
  if not exists(
    select 1 from public.documents document
    join public.document_links link on link.document_id=document.id
    where document.id=p_docx_document_id and document.organization_id=p_organization_id
      and document.document_type='candidate_profile' and document.mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and document.deleted_at is null and link.organization_id=p_organization_id and link.candidate_id=profile_row.candidate_id
  ) then raise exception 'invalid_docx_document' using errcode='22023'; end if;
  if not exists(
    select 1 from public.documents document
    join public.document_links link on link.document_id=document.id
    where document.id=p_pdf_document_id and document.organization_id=p_organization_id
      and document.document_type='candidate_profile' and document.mime_type='application/pdf'
      and document.deleted_at is null and link.organization_id=p_organization_id and link.candidate_id=profile_row.candidate_id
  ) then raise exception 'invalid_pdf_document' using errcode='22023'; end if;

  update public.candidate_profile_versions set
    status='finalized',reviewed_content=p_reviewed_content,anonymized=p_anonymized,
    docx_document_id=p_docx_document_id,pdf_document_id=p_pdf_document_id,
    edited_field_count=greatest(coalesce(p_edited_field_count,0),0),exported_formats=array['docx','pdf'],
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
revoke all on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) from public,anon;
grant execute on function public.finalize_candidate_profile(uuid,uuid,jsonb,boolean,uuid,uuid,integer) to authenticated;

create or replace function public.record_candidate_profile_export_failure(p_organization_id uuid,p_profile_version_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_permission(p_organization_id,'ai.use') then raise exception 'permission_denied' using errcode='42501'; end if;
  update public.candidate_profile_versions set export_failure_reason=left(coalesce(p_reason,'unknown'),500)
  where id=p_profile_version_id and organization_id=p_organization_id and status='draft';
  if not found then raise exception 'profile_version_not_found' using errcode='P0002'; end if;
end $$;
revoke all on function public.record_candidate_profile_export_failure(uuid,uuid,text) from public,anon;
grant execute on function public.record_candidate_profile_export_failure(uuid,uuid,text) to authenticated;

-- Create the package and attach explicitly selected candidate-owned documents in
-- one transaction. The Edge function also prevalidates for a friendly error, but
-- this RPC is the authoritative cross-tenant boundary.
create or replace function public.create_submission_package(
  p_organization_id uuid,p_job_id uuid,p_title text,p_items jsonb,p_contact_id uuid default null,
  p_message text default null,p_recipient_name text default null,p_recipient_email text default null,p_expiry_days integer default 7
) returns jsonb language plpgsql security definer set search_path=public as $$
declare package_id uuid;link_id uuid;activity_id uuid;created_submission_id uuid;raw_token text;item jsonb;jc public.job_candidates;expires timestamptz;links jsonb;company_name text;candidate_count integer:=0;selected_document_id uuid;
begin
  if not public.has_permission(p_organization_id,'submissions.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_expiry_days not between 1 and 30 then raise exception 'invalid_expiry' using errcode='22023'; end if;
  if coalesce(jsonb_typeof(p_items),'null')<>'array' then raise exception 'invalid_submission' using errcode='22023'; end if;
  if length(trim(coalesce(p_title,'')))<1 or jsonb_array_length(p_items)<1 then raise exception 'invalid_submission' using errcode='22023'; end if;
  if not exists(select 1 from public.jobs where id=p_job_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'job_not_found' using errcode='P0002'; end if;
  if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'contact_not_found' using errcode='P0002'; end if;

  insert into public.submission_packages(organization_id,job_id,contact_id,title,message,status,created_by)
  values(p_organization_id,p_job_id,p_contact_id,trim(p_title),p_message,'shared',auth.uid()) returning id into package_id;
  links:=jsonb_build_array(jsonb_build_object('job_id',p_job_id));
  if p_contact_id is not null then links:=links||jsonb_build_array(jsonb_build_object('contact_id',p_contact_id)); end if;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into jc from public.job_candidates where id=(item->>'job_candidate_id')::uuid and job_id=p_job_id and organization_id=p_organization_id;
    if jc.id is null then raise exception 'candidate_not_found' using errcode='P0002'; end if;
    insert into public.candidate_submissions(
      organization_id,package_id,job_candidate_id,candidate_summary,recruiter_comments,suitability_assessment,relevant_experience,expected_salary,currency,notice_period,availability,motivation,relocation_willingness,interview_availability
    ) values(
      p_organization_id,package_id,jc.id,coalesce(item->>'candidate_summary',''),item->>'recruiter_comments',item->>'suitability_assessment',item->>'relevant_experience',nullif(item->>'expected_salary','')::numeric,item->>'currency',item->>'notice_period',item->>'availability',item->>'motivation',item->>'relocation_willingness',item->>'interview_availability'
    ) returning id into created_submission_id;

    for selected_document_id in select distinct selected.value::uuid from jsonb_array_elements_text(coalesce(item->'document_ids','[]'::jsonb)) as selected(value) loop
      if not exists(
        select 1 from public.documents document join public.document_links link on link.document_id=document.id
        where document.id=selected_document_id and document.organization_id=p_organization_id and document.deleted_at is null
          and link.organization_id=p_organization_id and link.candidate_id=jc.candidate_id
      ) then raise exception 'invalid_submission_document' using errcode='22023'; end if;
      insert into public.submission_documents(organization_id,candidate_submission_id,document_id)
      values(p_organization_id,created_submission_id,selected_document_id);
    end loop;
    links:=links||jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id));candidate_count:=candidate_count+1;
  end loop;

  raw_token:=encode(extensions.gen_random_bytes(32),'base64');raw_token:=replace(replace(replace(raw_token,'+','-'),'/','_'),'=','');expires:=now()+make_interval(days=>p_expiry_days);
  insert into public.public_submission_links(organization_id,package_id,token_hash,token_prefix,recipient_name,recipient_email,expires_at,created_by)
  values(p_organization_id,package_id,encode(extensions.digest(raw_token,'sha256'),'hex'),left(raw_token,8),p_recipient_name,public.normalize_email(p_recipient_email),expires,auth.uid()) returning id into link_id;
  select company.name into company_name from public.jobs job join public.companies company on company.id=job.company_id where job.id=p_job_id and job.organization_id=p_organization_id;
  activity_id:=public.log_activity(p_organization_id,'submission',format('%s candidate%s sent to %s for review',candidate_count,case when candidate_count=1 then '' else 's' end,coalesce(company_name,'the client')),p_title,'outbound',auth.uid(),links);
  return jsonb_build_object('package_id',package_id,'link_id',link_id,'activity_id',activity_id,'token',raw_token,'expires_at',expires);
end $$;
revoke all on function public.create_submission_package(uuid,uuid,text,jsonb,uuid,text,text,text,integer) from public,anon;
grant execute on function public.create_submission_package(uuid,uuid,text,jsonb,uuid,text,text,text,integer) to authenticated;

create or replace function public.mark_submitted_candidate_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.candidate_profile_versions set submitted_at=coalesce(submitted_at,now())
  where organization_id=new.organization_id and status='finalized'
    and (docx_document_id=new.document_id or pdf_document_id=new.document_id);
  return new;
end $$;
revoke all on function public.mark_submitted_candidate_profile() from public,anon,authenticated;
create trigger submission_document_marks_profile_submitted
  after insert on public.submission_documents
  for each row execute function public.mark_submitted_candidate_profile();

create or replace function public.move_merged_candidate_profile_versions()
returns trigger language plpgsql security definer set search_path=public as $$
declare base_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||new.kept_candidate_id::text,0));
  select coalesce(max(version),0) into base_version from public.candidate_profile_versions
  where organization_id=new.organization_id and candidate_id=new.kept_candidate_id;
  with moving as(
    select id,row_number() over(order by created_at,id) as offset
    from public.candidate_profile_versions
    where organization_id=new.organization_id and candidate_id=new.merged_candidate_id
  )
  update public.candidate_profile_versions profile set candidate_id=new.kept_candidate_id,version=base_version+moving.offset
  from moving where profile.id=moving.id;
  return new;
end $$;
revoke all on function public.move_merged_candidate_profile_versions() from public,anon,authenticated;
create trigger candidate_merge_profile_versions
  after insert on public.candidate_merge_history
  for each row execute function public.move_merged_candidate_profile_versions();

create or replace function public.configure_founding_partner(p_organization_id uuid,p_enabled boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
  if current_user not in ('postgres','supabase_admin','service_role')
     and coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  update public.organizations set seat_limit=10,updated_at=now() where id=p_organization_id;
  update public.organization_settings
  set settings=jsonb_set(settings,'{profile_v1}',to_jsonb(p_enabled),true),updated_at=now()
  where organization_id=p_organization_id;
  if not found then raise exception 'organization_not_found' using errcode='P0002'; end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,'organization.founding_partner_configured','organization',p_organization_id,jsonb_build_object('seat_limit',10,'profile_v1',p_enabled));
end $$;
revoke all on function public.configure_founding_partner(uuid,boolean) from public,anon,authenticated;
grant execute on function public.configure_founding_partner(uuid,boolean) to service_role;

commit;
