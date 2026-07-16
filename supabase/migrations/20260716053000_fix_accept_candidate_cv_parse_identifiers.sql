begin;

create or replace function public.accept_candidate_cv_parse(
  p_organization_id uuid,
  p_parse_id uuid,
  p_payload jsonb,
  p_target_candidate_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  parse_row public.candidate_cv_parses;
  v_candidate_id uuid;
  v_duplicate_id uuid;
  v_private_payload jsonb := coalesce(p_payload->'private','{}'::jsonb);
  item jsonb;
  v_normalized_skill text;
  v_skill_id uuid;
  v_document_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.has_permission(p_organization_id,'candidates.write') or not public.has_permission(p_organization_id,'ai.use') then
    raise exception 'permission_denied';
  end if;

  select cv_parse.* into parse_row
  from public.candidate_cv_parses cv_parse
  where cv_parse.id=p_parse_id and cv_parse.organization_id=p_organization_id and cv_parse.uploaded_by=auth.uid()
  for update;
  if parse_row.id is null then raise exception 'parse_not_found'; end if;
  if parse_row.status='accepted' then return parse_row.accepted_candidate_id; end if;
  if parse_row.status not in ('ready','failed') then raise exception 'parse_not_ready'; end if;
  if parse_row.expires_at<=now() then raise exception 'parse_expired'; end if;
  if length(trim(coalesce(p_payload->>'full_name','')))<2 then raise exception 'full_name_required'; end if;
  if coalesce(nullif(p_payload->>'notice_period_days','')::integer,0)<0
    or coalesce(nullif(v_private_payload->>'current_salary','')::numeric,0)<0
    or coalesce(nullif(v_private_payload->>'expected_salary','')::numeric,0)<0 then
    raise exception 'invalid_nonnegative_value';
  end if;

  v_candidate_id := coalesce(p_target_candidate_id,parse_row.target_candidate_id);
  if v_candidate_id is not null and v_candidate_id is distinct from parse_row.target_candidate_id and v_candidate_id is distinct from parse_row.matched_candidate_id then
    raise exception 'candidate_target_mismatch';
  end if;

  if nullif(trim(v_private_payload->>'email'),'') is not null then
    select details.candidate_id into v_duplicate_id
    from public.candidate_private_details details
    join public.candidates candidate on candidate.id=details.candidate_id
    where details.organization_id=p_organization_id
      and details.canonical_email=public.normalize_email(v_private_payload->>'email')
      and candidate.deleted_at is null
      and (v_candidate_id is null or details.candidate_id<>v_candidate_id)
    limit 1;
  end if;
  if v_duplicate_id is not null then raise exception 'duplicate_candidate:%',v_duplicate_id; end if;

  if v_candidate_id is null then
    insert into public.candidates(
      organization_id,full_name,current_company,current_position,location,linkedin_url,portfolio_url,
      source,availability,notice_period_days,status,created_by,updated_by
    ) values (
      p_organization_id,trim(p_payload->>'full_name'),nullif(trim(p_payload->>'current_company'),''),
      nullif(trim(p_payload->>'current_position'),''),nullif(trim(p_payload->>'location'),''),
      nullif(trim(p_payload->>'linkedin_url'),''),nullif(trim(p_payload->>'portfolio_url'),''),
      coalesce(nullif(trim(p_payload->>'source'),''),'CV upload'),nullif(trim(p_payload->>'availability'),''),
      nullif(p_payload->>'notice_period_days','')::integer,'active',auth.uid(),auth.uid()
    ) returning id into v_candidate_id;
  else
    if not exists(select 1 from public.candidates candidate where candidate.id=v_candidate_id and candidate.organization_id=p_organization_id) then
      raise exception 'candidate_not_found';
    end if;
    update public.candidates candidate set
      current_company=coalesce(nullif(candidate.current_company,''),nullif(trim(p_payload->>'current_company'),'')),
      current_position=coalesce(nullif(candidate.current_position,''),nullif(trim(p_payload->>'current_position'),'')),
      location=coalesce(nullif(candidate.location,''),nullif(trim(p_payload->>'location'),'')),
      linkedin_url=coalesce(nullif(candidate.linkedin_url,''),nullif(trim(p_payload->>'linkedin_url'),'')),
      portfolio_url=coalesce(nullif(candidate.portfolio_url,''),nullif(trim(p_payload->>'portfolio_url'),'')),
      source=coalesce(nullif(candidate.source,''),nullif(trim(p_payload->>'source'),''),'CV upload'),
      availability=coalesce(nullif(candidate.availability,''),nullif(trim(p_payload->>'availability'),'')),
      notice_period_days=coalesce(candidate.notice_period_days,nullif(p_payload->>'notice_period_days','')::integer),
      updated_by=auth.uid(),updated_at=now()
    where candidate.id=v_candidate_id and candidate.organization_id=p_organization_id;
  end if;

  insert into public.candidate_private_details(
    candidate_id,organization_id,email,phone,current_salary,expected_salary,salary_currency,work_authorization
  ) values (
    v_candidate_id,p_organization_id,nullif(trim(v_private_payload->>'email'),''),nullif(trim(v_private_payload->>'phone'),''),
    nullif(v_private_payload->>'current_salary','')::numeric,nullif(v_private_payload->>'expected_salary','')::numeric,
    nullif(upper(v_private_payload->>'salary_currency'),''),nullif(trim(v_private_payload->>'work_authorization'),'')
  ) on conflict(candidate_id) do update set
    email=coalesce(candidate_private_details.email,excluded.email),
    phone=coalesce(candidate_private_details.phone,excluded.phone),
    current_salary=coalesce(candidate_private_details.current_salary,excluded.current_salary),
    expected_salary=coalesce(candidate_private_details.expected_salary,excluded.expected_salary),
    salary_currency=coalesce(candidate_private_details.salary_currency,excluded.salary_currency),
    work_authorization=coalesce(candidate_private_details.work_authorization,excluded.work_authorization);

  for item in select value from jsonb_array_elements(coalesce(p_payload->'employment','[]'::jsonb)) loop
    if nullif(trim(item->>'company_name'),'') is null or nullif(trim(item->>'title'),'') is null then continue; end if;
    if not exists(
      select 1 from public.candidate_employment employment where employment.candidate_id=v_candidate_id
      and lower(trim(employment.company_name))=lower(trim(item->>'company_name'))
      and lower(trim(employment.title))=lower(trim(item->>'title'))
      and employment.started_on is not distinct from nullif(item->>'started_on','')::date
    ) then
      insert into public.candidate_employment(
        organization_id,candidate_id,company_name,title,location,started_on,ended_on,is_current,summary,
        started_on_precision,ended_on_precision,sort_order
      ) values (
        p_organization_id,v_candidate_id,trim(item->>'company_name'),trim(item->>'title'),nullif(trim(item->>'location'),''),
        nullif(item->>'started_on','')::date,nullif(item->>'ended_on','')::date,coalesce((item->>'is_current')::boolean,false),
        nullif(trim(item->>'summary'),''),nullif(item->>'started_on_precision',''),nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0)
      );
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'education','[]'::jsonb)) loop
    if nullif(trim(item->>'institution'),'') is null then continue; end if;
    if not exists(
      select 1 from public.candidate_education education where education.candidate_id=v_candidate_id
      and lower(trim(education.institution))=lower(trim(item->>'institution'))
      and lower(trim(coalesce(education.degree,'')))=lower(trim(coalesce(item->>'degree','')))
      and education.started_on is not distinct from nullif(item->>'started_on','')::date
    ) then
      insert into public.candidate_education(
        organization_id,candidate_id,institution,degree,field_of_study,started_on,ended_on,started_on_precision,ended_on_precision,sort_order
      ) values (
        p_organization_id,v_candidate_id,trim(item->>'institution'),nullif(trim(item->>'degree'),''),nullif(trim(item->>'field_of_study'),''),
        nullif(item->>'started_on','')::date,nullif(item->>'ended_on','')::date,nullif(item->>'started_on_precision',''),
        nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0)
      );
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'languages','[]'::jsonb)) loop
    if nullif(trim(item->>'language'),'') is not null then
      insert into public.candidate_languages(organization_id,candidate_id,language,proficiency)
      values(p_organization_id,v_candidate_id,trim(item->>'language'),nullif(trim(item->>'proficiency'),''))
      on conflict(candidate_id,language) do nothing;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'skills','[]'::jsonb)) loop
    v_normalized_skill := lower(regexp_replace(trim(item->>'name'),'\s+',' ','g'));
    if v_normalized_skill='' then continue; end if;
    if coalesce(nullif(item->>'years_experience','')::numeric,0)<0 then raise exception 'invalid_skill_experience'; end if;
    insert into public.skills(organization_id,name,normalized_name)
    values(p_organization_id,trim(item->>'name'),v_normalized_skill)
    on conflict(organization_id,normalized_name) do update set name=skills.name
    returning id into v_skill_id;
    insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience)
    values(v_candidate_id,v_skill_id,p_organization_id,nullif(trim(item->>'proficiency'),''),nullif(item->>'years_experience','')::numeric)
    on conflict(candidate_id,skill_id) do nothing;
  end loop;

  insert into public.documents(
    organization_id,file_name,original_filename,storage_path,mime_type,size_bytes,document_type,uploaded_by
  ) values (
    p_organization_id,regexp_replace(parse_row.original_filename,'[^a-zA-Z0-9._-]+','-','g'),parse_row.original_filename,
    parse_row.storage_path,parse_row.mime_type,parse_row.size_bytes,'resume',auth.uid()
  ) returning id into v_document_id;
  insert into public.document_links(organization_id,document_id,candidate_id)
  values(p_organization_id,v_document_id,v_candidate_id);

  update public.candidate_cv_parses cv_parse set status='accepted',accepted_candidate_id=v_candidate_id,accepted_at=now(),
    extracted_data=null,field_evidence='{}'::jsonb,uncertainties='[]'::jsonb,error_code=null,error_message=null
  where cv_parse.id=p_parse_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'candidate.cv_parse_accepted','candidate',v_candidate_id,jsonb_build_object('parse_id',p_parse_id));
  return v_candidate_id;
end $$;

revoke all on function public.accept_candidate_cv_parse(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.accept_candidate_cv_parse(uuid,uuid,jsonb,uuid) to authenticated;

commit;
