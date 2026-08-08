-- P0: logical consultant saves must be all-or-nothing. The previous UI created the candidate/job
-- first and then issued several independent writes for the remaining details. A later failure left
-- a real partial record behind while the consultant was told that saving failed.

create or replace function public.create_candidate_with_profile(
  p_organization_id uuid,
  p_candidate jsonb,
  p_private jsonb default '{}'::jsonb,
  p_employment jsonb default '[]'::jsonb,
  p_education jsonb default '[]'::jsonb,
  p_languages jsonb default '[]'::jsonb,
  p_skills jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_candidate_id uuid;
  v_owner_id uuid := nullif(p_candidate->>'owner_member_id','')::uuid;
  v_full_name text := nullif(trim(p_candidate->>'full_name'),'');
  v_skill_id uuid;
  v_normalized_skill text;
  item jsonb;
begin
  if not public.has_permission(p_organization_id,'candidates.write') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if v_full_name is null or length(v_full_name)<2 then
    raise exception 'full_name_required' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_employment,'[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_education,'[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_languages,'[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_skills,'[]'::jsonb))<>'array' then
    raise exception 'invalid_profile_lists' using errcode='22023';
  end if;
  if v_owner_id is not null and not exists(
    select 1 from public.organization_members
    where id=v_owner_id and organization_id=p_organization_id and status='active'
  ) then
    raise exception 'invalid_owner' using errcode='22023';
  end if;

  insert into public.candidates(
    organization_id,full_name,current_company,current_position,location,linkedin_url,portfolio_url,
    status,owner_member_id,source,availability,notice_period_days,created_by
  ) values(
    p_organization_id,v_full_name,nullif(trim(p_candidate->>'current_company'),''),
    nullif(trim(p_candidate->>'current_position'),''),nullif(trim(p_candidate->>'location'),''),
    nullif(trim(p_candidate->>'linkedin_url'),''),nullif(trim(p_candidate->>'portfolio_url'),''),
    coalesce(nullif(p_candidate->>'status',''),'active'),v_owner_id,
    nullif(trim(p_candidate->>'source'),''),nullif(trim(p_candidate->>'availability'),''),
    nullif(p_candidate->>'notice_period_days','')::integer,auth.uid()
  ) returning id into v_candidate_id;

  insert into public.candidate_private_details(
    candidate_id,organization_id,email,phone,current_salary,expected_salary,salary_currency,
    work_authorization,consent_status,consent_expires_at
  ) values(
    v_candidate_id,p_organization_id,nullif(trim(p_private->>'email'),''),
    nullif(trim(p_private->>'phone'),''),nullif(p_private->>'current_salary','')::numeric,
    nullif(p_private->>'expected_salary','')::numeric,nullif(upper(trim(p_private->>'salary_currency')),''),
    nullif(trim(p_private->>'work_authorization'),''),
    coalesce(nullif(p_private->>'consent_status',''),'unknown'),
    nullif(p_private->>'consent_expires_at','')::timestamptz
  );

  for item in select value from jsonb_array_elements(coalesce(p_employment,'[]'::jsonb)) loop
    if nullif(trim(item->>'company_name'),'') is null or nullif(trim(item->>'title'),'') is null then continue; end if;
    insert into public.candidate_employment(
      organization_id,candidate_id,company_name,title,location,started_on,ended_on,is_current,summary,
      started_on_precision,ended_on_precision,sort_order
    ) values(
      p_organization_id,v_candidate_id,trim(item->>'company_name'),trim(item->>'title'),
      nullif(trim(item->>'location'),''),nullif(item->>'started_on','')::date,
      nullif(item->>'ended_on','')::date,coalesce((item->>'is_current')::boolean,false),
      nullif(trim(item->>'summary'),''),nullif(item->>'started_on_precision',''),
      nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0)
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_education,'[]'::jsonb)) loop
    if nullif(trim(item->>'institution'),'') is null then continue; end if;
    insert into public.candidate_education(
      organization_id,candidate_id,institution,degree,field_of_study,started_on,ended_on,
      started_on_precision,ended_on_precision,sort_order
    ) values(
      p_organization_id,v_candidate_id,trim(item->>'institution'),nullif(trim(item->>'degree'),''),
      nullif(trim(item->>'field_of_study'),''),nullif(item->>'started_on','')::date,
      nullif(item->>'ended_on','')::date,nullif(item->>'started_on_precision',''),
      nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0)
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_languages,'[]'::jsonb)) loop
    if nullif(trim(item->>'language'),'') is null then continue; end if;
    insert into public.candidate_languages(organization_id,candidate_id,language,proficiency)
    values(p_organization_id,v_candidate_id,trim(item->>'language'),nullif(trim(item->>'proficiency'),''))
    on conflict(candidate_id,language) do update set proficiency=excluded.proficiency;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_skills,'[]'::jsonb)) loop
    v_normalized_skill:=lower(regexp_replace(trim(item->>'name'),'\s+',' ','g'));
    if v_normalized_skill is null or v_normalized_skill='' then continue; end if;
    insert into public.skills(organization_id,name,normalized_name)
    values(p_organization_id,trim(item->>'name'),v_normalized_skill)
    on conflict(organization_id,normalized_name) do update set name=public.skills.name returning id into v_skill_id;
    insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience)
    values(v_candidate_id,v_skill_id,p_organization_id,nullif(trim(item->>'proficiency'),''),nullif(item->>'years_experience','')::numeric)
    on conflict(candidate_id,skill_id) do update set proficiency=excluded.proficiency,years_experience=excluded.years_experience;
  end loop;

  return v_candidate_id;
end $$;

revoke all on function public.create_candidate_with_profile(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.create_candidate_with_profile(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.replace_candidate_profile_section(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_section text,
  p_items jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare
  item jsonb;
  v_skill_id uuid;
  v_normalized_skill text;
  v_position integer;
begin
  if not public.has_permission(p_organization_id,'candidates.write') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.candidates where id=p_candidate_id and organization_id=p_organization_id and deleted_at is null) then
    raise exception 'candidate_not_found' using errcode='P0002';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'invalid_profile_list' using errcode='22023';
  end if;

  if p_section='employment' then
    delete from public.candidate_employment where organization_id=p_organization_id and candidate_id=p_candidate_id;
    v_position:=0;
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      if nullif(trim(item->>'company_name'),'') is null or nullif(trim(item->>'title'),'') is null then continue; end if;
      insert into public.candidate_employment(
        organization_id,candidate_id,company_name,title,location,started_on,ended_on,is_current,summary,
        started_on_precision,ended_on_precision,sort_order
      ) values(
        p_organization_id,p_candidate_id,trim(item->>'company_name'),trim(item->>'title'),
        nullif(trim(item->>'location'),''),nullif(item->>'started_on','')::date,
        nullif(item->>'ended_on','')::date,coalesce((item->>'is_current')::boolean,false),
        nullif(trim(item->>'summary'),''),nullif(item->>'started_on_precision',''),
        nullif(item->>'ended_on_precision',''),v_position
      );
      v_position:=v_position+1;
    end loop;
  elsif p_section='education' then
    delete from public.candidate_education where organization_id=p_organization_id and candidate_id=p_candidate_id;
    v_position:=0;
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      if nullif(trim(item->>'institution'),'') is null then continue; end if;
      insert into public.candidate_education(
        organization_id,candidate_id,institution,degree,field_of_study,started_on,ended_on,
        started_on_precision,ended_on_precision,sort_order
      ) values(
        p_organization_id,p_candidate_id,trim(item->>'institution'),nullif(trim(item->>'degree'),''),
        nullif(trim(item->>'field_of_study'),''),nullif(item->>'started_on','')::date,
        nullif(item->>'ended_on','')::date,nullif(item->>'started_on_precision',''),
        nullif(item->>'ended_on_precision',''),v_position
      );
      v_position:=v_position+1;
    end loop;
  elsif p_section='languages' then
    delete from public.candidate_languages where organization_id=p_organization_id and candidate_id=p_candidate_id;
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      if nullif(trim(item->>'language'),'') is null then continue; end if;
      insert into public.candidate_languages(organization_id,candidate_id,language,proficiency)
      values(p_organization_id,p_candidate_id,trim(item->>'language'),nullif(trim(item->>'proficiency'),''))
      on conflict(candidate_id,language) do update set proficiency=excluded.proficiency;
    end loop;
  elsif p_section='skills' then
    delete from public.candidate_skills where organization_id=p_organization_id and candidate_id=p_candidate_id;
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      v_normalized_skill:=lower(regexp_replace(trim(item->>'name'),'\s+',' ','g'));
      if v_normalized_skill is null or v_normalized_skill='' then continue; end if;
      insert into public.skills(organization_id,name,normalized_name)
      values(p_organization_id,trim(item->>'name'),v_normalized_skill)
      on conflict(organization_id,normalized_name) do update set name=public.skills.name returning id into v_skill_id;
      insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience)
      values(p_candidate_id,v_skill_id,p_organization_id,nullif(trim(item->>'proficiency'),''),nullif(item->>'years_experience','')::numeric)
      on conflict(candidate_id,skill_id) do update set proficiency=excluded.proficiency,years_experience=excluded.years_experience;
    end loop;
  else
    raise exception 'invalid_profile_section' using errcode='22023';
  end if;

  update public.candidates set updated_at=now(),updated_by=auth.uid()
  where id=p_candidate_id and organization_id=p_organization_id;
end $$;

revoke all on function public.replace_candidate_profile_section(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.replace_candidate_profile_section(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.update_candidate_with_profile(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_candidate jsonb,
  p_private jsonb,
  p_employment jsonb default '[]'::jsonb,
  p_education jsonb default '[]'::jsonb,
  p_languages jsonb default '[]'::jsonb,
  p_skills jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  -- Nested function calls share this RPC's transaction. If any profile list is invalid, the scalar
  -- profile update and every earlier section replacement roll back with it.
  perform public.update_candidate_profile(p_organization_id,p_candidate_id,p_candidate,p_private);
  perform public.replace_candidate_profile_section(p_organization_id,p_candidate_id,'employment',p_employment);
  perform public.replace_candidate_profile_section(p_organization_id,p_candidate_id,'education',p_education);
  perform public.replace_candidate_profile_section(p_organization_id,p_candidate_id,'languages',p_languages);
  perform public.replace_candidate_profile_section(p_organization_id,p_candidate_id,'skills',p_skills);
end $$;

revoke all on function public.update_candidate_with_profile(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.update_candidate_with_profile(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.create_job_with_details(
  p_organization_id uuid,
  p_company_id uuid,
  p_title text,
  p_owner_member_id uuid default null,
  p_details jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_job_id uuid;
begin
  if p_owner_member_id is not null and not exists(
    select 1 from public.organization_members
    where id=p_owner_member_id and organization_id=p_organization_id and status='active'
  ) then
    raise exception 'invalid_owner' using errcode='22023';
  end if;

  v_job_id:=public.create_job_with_pipeline(p_organization_id,p_company_id,p_title,p_owner_member_id);
  update public.jobs set
    location=nullif(trim(p_details->>'location'),''),
    priority=coalesce(nullif(p_details->>'priority',''),'normal'),
    employment_type=nullif(trim(p_details->>'employment_type'),''),
    description=nullif(trim(p_details->>'description'),''),
    salary_min=nullif(p_details->>'salary_min','')::numeric,
    salary_max=nullif(p_details->>'salary_max','')::numeric,
    currency=nullif(upper(trim(p_details->>'currency')),''),
    updated_by=auth.uid(),updated_at=now()
  where id=v_job_id and organization_id=p_organization_id;
  return v_job_id;
end $$;

revoke all on function public.create_job_with_details(uuid,uuid,text,uuid,jsonb) from public, anon;
grant execute on function public.create_job_with_details(uuid,uuid,text,uuid,jsonb) to authenticated;
