-- Extend capture_prospect for the "next level" extension: rich profile ingestion (full employment,
-- education, skills, languages) and capture-time metadata (note, tags, owner, status) -- all carried
-- inside p_payload so the signature capture_prospect(uuid,text,jsonb,uuid) is unchanged and every
-- existing caller (accept_referral, the v1 extension) keeps working with no edits.
--
-- The array-ingestion loops are copied verbatim from accept_candidate_cv_parse (the CV-accept engine)
-- so a LinkedIn capture and a CV upload write candidate history identically -- same dedup guards, same
-- skill normalisation. email/phone are read from either the top level (v1 / referral shape) or a
-- `private` sub-object (the CvExtraction shape the AI edge function and rich scraper emit), so one RPC
-- serves both.
create or replace function public.capture_prospect(
  p_organization_id uuid,
  p_kind text,
  p_payload jsonb,
  p_job_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_private jsonb := coalesce(p_payload->'private','{}'::jsonb);
  v_full_name text := nullif(trim(p_payload->>'full_name'),'');
  v_email_raw text := coalesce(nullif(trim(p_payload->>'email'),''), nullif(trim(v_private->>'email'),''));
  v_phone_raw text := coalesce(nullif(trim(p_payload->>'phone'),''), nullif(trim(v_private->>'phone'),''));
  v_email text := public.normalize_email(v_email_raw);
  v_linkedin text := nullif(trim(p_payload->>'linkedin_url'),'');
  v_source text := coalesce(nullif(trim(p_payload->>'source'),''), 'Capture');
  v_id uuid;
  v_deduped boolean := false;
  v_job_linked boolean := false;
  v_stage_id uuid;
  v_existing_stage uuid;
  item jsonb;
  normalized_skill text;
  v_skill_id uuid;
  tag_id uuid;
  v_tag text;
  v_owner uuid := nullif(p_payload->>'owner_member_id','')::uuid;
  v_status text := nullif(trim(p_payload->>'status'),'');
  v_note text := nullif(trim(p_payload->>'note'),'');
  v_note_id uuid;
begin
  if p_kind not in ('candidate','contact') then raise exception 'invalid_kind' using errcode='22023'; end if;
  if v_full_name is null or length(v_full_name) < 2 then raise exception 'full_name_required' using errcode='22023'; end if;

  if p_kind = 'candidate' then
    if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;

    if v_email is not null then
      select c.id into v_id
      from public.candidate_private_details d join public.candidates c on c.id=d.candidate_id
      where d.organization_id=p_organization_id and d.canonical_email=v_email limit 1;
    end if;
    if v_id is null and v_linkedin is not null then
      select c.id into v_id from public.candidates c
      where c.organization_id=p_organization_id and lower(c.linkedin_url)=lower(v_linkedin) and c.deleted_at is null limit 1;
    end if;

    if v_id is not null then
      update public.candidates set
        current_company=coalesce(nullif(current_company,''), nullif(trim(p_payload->>'current_company'),'')),
        current_position=coalesce(nullif(current_position,''), nullif(trim(p_payload->>'current_position'),'')),
        location=coalesce(nullif(location,''), nullif(trim(p_payload->>'location'),'')),
        linkedin_url=coalesce(nullif(linkedin_url,''), v_linkedin),
        portfolio_url=coalesce(nullif(portfolio_url,''), nullif(trim(p_payload->>'portfolio_url'),'')),
        deleted_at=null, updated_by=auth.uid(), updated_at=now()
      where id=v_id;
      v_deduped := true;
    else
      insert into public.candidates(organization_id,full_name,current_company,current_position,location,linkedin_url,portfolio_url,source,created_by)
        values(p_organization_id,v_full_name,nullif(trim(p_payload->>'current_company'),''),nullif(trim(p_payload->>'current_position'),''),nullif(trim(p_payload->>'location'),''),v_linkedin,nullif(trim(p_payload->>'portfolio_url'),''),v_source,auth.uid())
        returning id into v_id;
    end if;

    -- Private details: single coalesce-merge upsert (email/phone/salary/work auth). Never overwrites
    -- a curated value with a blank.
    insert into public.candidate_private_details(candidate_id,organization_id,email,phone,current_salary,expected_salary,salary_currency,work_authorization)
      values(v_id,p_organization_id,v_email_raw,v_phone_raw,nullif(v_private->>'current_salary','')::numeric,nullif(v_private->>'expected_salary','')::numeric,nullif(upper(v_private->>'salary_currency'),''),nullif(trim(v_private->>'work_authorization'),''))
    on conflict (candidate_id) do update set
      email=coalesce(nullif(public.candidate_private_details.email,''), excluded.email),
      phone=coalesce(nullif(public.candidate_private_details.phone,''), excluded.phone),
      current_salary=coalesce(public.candidate_private_details.current_salary, excluded.current_salary),
      expected_salary=coalesce(public.candidate_private_details.expected_salary, excluded.expected_salary),
      salary_currency=coalesce(public.candidate_private_details.salary_currency, excluded.salary_currency),
      work_authorization=coalesce(nullif(public.candidate_private_details.work_authorization,''), excluded.work_authorization),
      updated_at=now();

    -- Rich arrays (dedup-guarded, identical to accept_candidate_cv_parse).
    for item in select value from jsonb_array_elements(coalesce(p_payload->'employment','[]'::jsonb)) loop
      if nullif(trim(item->>'company_name'),'') is null or nullif(trim(item->>'title'),'') is null then continue; end if;
      if not exists(select 1 from public.candidate_employment e where e.candidate_id=v_id
        and lower(trim(e.company_name))=lower(trim(item->>'company_name'))
        and lower(trim(e.title))=lower(trim(item->>'title'))
        and e.started_on is not distinct from nullif(item->>'started_on','')::date) then
        insert into public.candidate_employment(organization_id,candidate_id,company_name,title,location,started_on,ended_on,is_current,summary,started_on_precision,ended_on_precision,sort_order)
          values(p_organization_id,v_id,trim(item->>'company_name'),trim(item->>'title'),nullif(trim(item->>'location'),''),nullif(item->>'started_on','')::date,nullif(item->>'ended_on','')::date,coalesce((item->>'is_current')::boolean,false),nullif(trim(item->>'summary'),''),nullif(item->>'started_on_precision',''),nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0));
      end if;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(p_payload->'education','[]'::jsonb)) loop
      if nullif(trim(item->>'institution'),'') is null then continue; end if;
      if not exists(select 1 from public.candidate_education e where e.candidate_id=v_id
        and lower(trim(e.institution))=lower(trim(item->>'institution'))
        and lower(trim(coalesce(e.degree,'')))=lower(trim(coalesce(item->>'degree','')))
        and e.started_on is not distinct from nullif(item->>'started_on','')::date) then
        insert into public.candidate_education(organization_id,candidate_id,institution,degree,field_of_study,started_on,ended_on,started_on_precision,ended_on_precision,sort_order)
          values(p_organization_id,v_id,trim(item->>'institution'),nullif(trim(item->>'degree'),''),nullif(trim(item->>'field_of_study'),''),nullif(item->>'started_on','')::date,nullif(item->>'ended_on','')::date,nullif(item->>'started_on_precision',''),nullif(item->>'ended_on_precision',''),coalesce((item->>'sort_order')::integer,0));
      end if;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(p_payload->'languages','[]'::jsonb)) loop
      if nullif(trim(item->>'language'),'') is not null then
        insert into public.candidate_languages(organization_id,candidate_id,language,proficiency)
          values(p_organization_id,v_id,trim(item->>'language'),nullif(trim(item->>'proficiency'),''))
        on conflict(candidate_id,language) do nothing;
      end if;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(p_payload->'skills','[]'::jsonb)) loop
      normalized_skill := lower(regexp_replace(trim(item->>'name'),'\s+',' ','g'));
      if normalized_skill='' then continue; end if;
      insert into public.skills(organization_id,name,normalized_name)
        values(p_organization_id,trim(item->>'name'),normalized_skill)
      on conflict(organization_id,normalized_name) do update set name=skills.name returning id into v_skill_id;
      insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience)
        values(v_id,v_skill_id,p_organization_id,nullif(trim(item->>'proficiency'),''),nullif(item->>'years_experience','')::numeric)
      on conflict(candidate_id,skill_id) do nothing;
    end loop;

    -- Capture-time metadata.
    if v_owner is not null and exists(select 1 from public.organization_members where id=v_owner and organization_id=p_organization_id and status='active') then
      update public.candidates set owner_member_id=v_owner where id=v_id;
    end if;
    if v_status is not null and v_status in ('active','passive','placed','do_not_contact','archived') then
      update public.candidates set status=v_status where id=v_id;
    end if;
    if v_note is not null then
      insert into public.notes(organization_id,content,created_by) values(p_organization_id,v_note,auth.uid()) returning id into v_note_id;
      insert into public.note_links(note_id,organization_id,candidate_id) values(v_note_id,p_organization_id,v_id);
    end if;
    for v_tag in select value from jsonb_array_elements_text(coalesce(p_payload->'tags','[]'::jsonb)) loop
      v_tag := nullif(trim(v_tag),'');
      if v_tag is null then continue; end if;
      insert into public.tags(organization_id,name) values(p_organization_id,v_tag)
        on conflict(organization_id,name) do update set name=tags.name returning id into tag_id;
      insert into public.candidate_tags(candidate_id,tag_id,organization_id) values(v_id,tag_id,p_organization_id) on conflict do nothing;
    end loop;

    -- Optional pipeline placement.
    if p_job_id is not null then
      select ps.id into v_stage_id from public.pipeline_stages ps
        join public.jobs j on j.pipeline_id=ps.pipeline_id
        where j.id=p_job_id and j.organization_id=p_organization_id and j.deleted_at is null
        order by ps.position limit 1;
      if v_stage_id is null then raise exception 'job_not_found' using errcode='22023'; end if;
      select current_stage_id into v_existing_stage from public.job_candidates where job_id=p_job_id and candidate_id=v_id;
      if v_existing_stage is null then
        insert into public.job_candidates(organization_id,job_id,candidate_id,current_stage_id,source,added_by)
          values(p_organization_id,p_job_id,v_id,v_stage_id,v_source,auth.uid());
        v_job_linked := true;
      end if;
    end if;

  else -- contact
    if not public.has_permission(p_organization_id,'contacts.write') then raise exception 'permission_denied' using errcode='42501'; end if;
    if nullif(p_payload->>'company_id','') is null then raise exception 'company_required' using errcode='22023'; end if;

    if v_linkedin is not null then
      select id into v_id from public.contacts
        where organization_id=p_organization_id and lower(linkedin_url)=lower(v_linkedin) and deleted_at is null limit 1;
    end if;
    if v_id is null and v_email is not null then
      select id into v_id from public.contacts
        where organization_id=p_organization_id and public.normalize_email(email)=v_email and deleted_at is null limit 1;
    end if;

    if v_id is not null then
      update public.contacts set
        position=coalesce(nullif(position,''), nullif(trim(p_payload->>'current_position'),''), nullif(trim(p_payload->>'position'),'')),
        email=coalesce(nullif(email,''), v_email_raw),
        phone=coalesce(nullif(phone,''), v_phone_raw),
        linkedin_url=coalesce(nullif(linkedin_url,''), v_linkedin),
        updated_by=auth.uid(), updated_at=now()
      where id=v_id;
      v_deduped := true;
    else
      insert into public.contacts(organization_id,company_id,full_name,position,email,phone,linkedin_url,created_by)
        values(p_organization_id,(p_payload->>'company_id')::uuid,v_full_name,coalesce(nullif(trim(p_payload->>'current_position'),''),nullif(trim(p_payload->>'position'),'')),v_email_raw,v_phone_raw,v_linkedin,auth.uid())
        returning id into v_id;
    end if;
  end if;

  return jsonb_build_object('id',v_id,'kind',p_kind,'deduped',v_deduped,'job_linked',v_job_linked);
end $$;

revoke all on function public.capture_prospect(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.capture_prospect(uuid,text,jsonb,uuid) to authenticated;
