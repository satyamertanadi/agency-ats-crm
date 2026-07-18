begin;

create index if not exists candidates_org_status_updated on public.candidates(organization_id,status,updated_at desc) where deleted_at is null;
create index if not exists candidates_org_owner on public.candidates(organization_id,owner_member_id) where deleted_at is null;
create index if not exists candidates_org_source on public.candidates(organization_id,source) where deleted_at is null;
create index if not exists job_candidates_job_updated on public.job_candidates(job_id,updated_at desc) where closed_at is null;

create or replace function public.search_candidates_page(
  p_organization_id uuid,
  p_query text default null,
  p_status text default null,
  p_location text default null,
  p_source text default null,
  p_owner_member_id uuid default null,
  p_tag text default null,
  p_skill text default null,
  p_availability text default null,
  p_consent_status text default null,
  p_sort text default 'updated',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  id uuid,organization_id uuid,full_name text,current_company text,current_position text,location text,
  linkedin_url text,status text,source text,availability text,owner_member_id uuid,created_at timestamptz,
  updated_at timestamptz,consent_status text,owner_name text,tag_names text[],skill_names text[],total_count bigint
) language sql stable security invoker set search_path=public as $$
  select c.id,c.organization_id,c.full_name,c.current_company,c.current_position,c.location,c.linkedin_url,
    c.status,c.source,c.availability,c.owner_member_id,c.created_at,c.updated_at,private.consent_status,
    coalesce(nullif(trim(profile.full_name),''),profile.email) as owner_name,
    coalesce(tags.names,'{}'::text[]) as tag_names,coalesce(skills.names,'{}'::text[]) as skill_names,
    count(*) over() as total_count
  from public.candidates c
  left join public.candidate_private_details private on private.candidate_id=c.id
  left join public.organization_members owner on owner.id=c.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select array_agg(tag.name order by tag.name) as names
    from public.candidate_tags candidate_tag join public.tags tag on tag.id=candidate_tag.tag_id
    where candidate_tag.candidate_id=c.id
  ) tags on true
  left join lateral (
    select array_agg(skill.name order by skill.name) as names
    from public.candidate_skills candidate_skill join public.skills skill on skill.id=candidate_skill.skill_id
    where candidate_skill.candidate_id=c.id
  ) skills on true
  where c.organization_id=p_organization_id and c.deleted_at is null
    and public.has_permission(p_organization_id,'candidates.read')
    and (nullif(trim(p_query),'') is null or c.full_name ilike '%'||trim(p_query)||'%' or c.current_company ilike '%'||trim(p_query)||'%' or c.current_position ilike '%'||trim(p_query)||'%')
    and (nullif(p_status,'') is null or c.status=p_status)
    and (nullif(trim(p_location),'') is null or c.location ilike '%'||trim(p_location)||'%')
    and (nullif(trim(p_source),'') is null or c.source ilike '%'||trim(p_source)||'%')
    and (p_owner_member_id is null or c.owner_member_id=p_owner_member_id)
    and (nullif(trim(p_tag),'') is null or exists(select 1 from public.candidate_tags ct join public.tags t on t.id=ct.tag_id where ct.candidate_id=c.id and t.name ilike '%'||trim(p_tag)||'%'))
    and (nullif(trim(p_skill),'') is null or exists(select 1 from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where cs.candidate_id=c.id and s.name ilike '%'||trim(p_skill)||'%'))
    and (nullif(trim(p_availability),'') is null or c.availability ilike '%'||trim(p_availability)||'%')
    and (nullif(p_consent_status,'') is null or private.consent_status=p_consent_status)
  order by
    case when p_sort='name' and p_direction='asc' then lower(c.full_name) end asc,
    case when p_sort='name' and p_direction='desc' then lower(c.full_name) end desc,
    case when p_sort='location' and p_direction='asc' then lower(c.location) end asc nulls last,
    case when p_sort='location' and p_direction='desc' then lower(c.location) end desc nulls last,
    case when p_sort='created' and p_direction='asc' then c.created_at end asc,
    case when p_sort='created' and p_direction='desc' then c.created_at end desc,
    case when p_sort='updated' and p_direction='asc' then c.updated_at end asc,
    c.updated_at desc,c.id
  limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
$$;

grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) to authenticated;

create or replace function public.list_job_health(p_organization_id uuid,p_candidate_id uuid default null)
returns table(
  id uuid,company_id uuid,pipeline_id uuid,title text,company_name text,location text,priority text,status text,
  owner_member_id uuid,owner_name text,opened_at timestamptz,days_open integer,candidate_count bigint,
  waiting_count bigint,phase_counts jsonb,salary_min numeric,salary_max numeric,currency text,
  fee_percentage numeric,fixed_fee numeric,expected_fee numeric,fee_source text,next_action text,
  last_activity_at timestamptz,already_in_job boolean,updated_at timestamptz
) language sql stable security invoker set search_path=public as $$
  select job.id,job.company_id,job.pipeline_id,job.title,company.name,job.location,job.priority,job.status,
    job.owner_member_id,coalesce(nullif(trim(profile.full_name),''),profile.email),job.opened_at,
    greatest(0,(current_date-coalesce(job.opened_at::date,job.created_at::date)))::integer,
    coalesce(pipeline.candidate_count,0),coalesce(pipeline.waiting_count,0),coalesce(pipeline.phase_counts,'{}'::jsonb),
    job.salary_min,job.salary_max,coalesce(job.currency,terms.currency)::text,
    coalesce(job.placement_fee_percentage,terms.fee_percentage),coalesce(job.fixed_fee,terms.fixed_fee),
    case
      when job.fixed_fee is not null then job.fixed_fee
      when job.salary_max is not null and job.placement_fee_percentage is not null then job.salary_max*job.placement_fee_percentage/100
      when terms.fixed_fee is not null then terms.fixed_fee
      when job.salary_max is not null and terms.fee_percentage is not null then job.salary_max*terms.fee_percentage/100
      else null
    end,
    case when job.fixed_fee is not null or job.placement_fee_percentage is not null then 'Job override' when terms.id is not null then 'Account agreement' else null end,
    case when job.status='open' and job.owner_member_id is null then 'Assign an owner'
      when job.status='open' and coalesce(pipeline.candidate_count,0)=0 then 'Add candidates'
      when job.status='open' and coalesce(pipeline.waiting_count,0)>0 then 'Review waiting candidates'
      when job.status='open' and activity.last_activity_at is null then 'Log first activity'
      else null end,
    activity.last_activity_at,
    case when p_candidate_id is null then false else exists(select 1 from public.job_candidates existing where existing.job_id=job.id and existing.candidate_id=p_candidate_id) end,
    job.updated_at
  from public.jobs job
  join public.companies company on company.id=job.company_id
  left join public.organization_members owner on owner.id=job.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select term.id,term.fee_percentage,term.fixed_fee,term.currency
    from public.commercial_terms term
    where term.company_id=job.company_id and term.organization_id=job.organization_id and term.status='active'
      and term.effective_from<=current_date and (term.effective_to is null or term.effective_to>=current_date)
    order by term.effective_from desc,term.created_at desc limit 1
  ) terms on true
  left join lateral (
    select coalesce(sum(stage_count.count),0)::bigint as candidate_count,
      coalesce(sum(stage_count.waiting),0)::bigint as waiting_count,
      coalesce(jsonb_object_agg(stage_count.phase_key,stage_count.count) filter(where stage_count.phase_key is not null),'{}'::jsonb) as phase_counts
    from (
      select coalesce(stage.phase_key,'other') as phase_key,count(*)::bigint,
        count(*) filter(where candidate.updated_at<now()-interval '7 days' and stage.stage_type='active')::bigint as waiting
      from public.job_candidates candidate join public.pipeline_stages stage on stage.id=candidate.current_stage_id
      where candidate.job_id=job.id and candidate.closed_at is null
      group by coalesce(stage.phase_key,'other')
    ) stage_count
  ) pipeline on true
  left join lateral (
    select max(event.occurred_at) as last_activity_at
    from public.activity_links link join public.activities event on event.id=link.activity_id
    where link.job_id=job.id
  ) activity on true
  where job.organization_id=p_organization_id and job.deleted_at is null and public.has_permission(p_organization_id,'jobs.read')
  order by case when job.status='open' then 0 else 1 end,job.updated_at desc
$$;

grant execute on function public.list_job_health(uuid,uuid) to authenticated;

create or replace function public.add_candidates_to_job(
  p_organization_id uuid,p_job_id uuid,p_candidate_ids uuid[],p_stage_id uuid default null
) returns setof public.job_candidates language plpgsql security definer set search_path=public as $$
declare target_job public.jobs;target_stage uuid;invalid_candidate text;
begin
  if not public.has_permission(p_organization_id,'pipeline.move') then raise exception 'permission_denied' using errcode='42501'; end if;
  if coalesce(array_length(p_candidate_ids,1),0)=0 then raise exception 'candidate_required' using errcode='22023'; end if;
  select * into target_job from public.jobs where id=p_job_id and organization_id=p_organization_id and deleted_at is null and status='open';
  if target_job.id is null then raise exception 'job_not_open' using errcode='22023'; end if;
  if p_stage_id is null then
    select stage.id into target_stage from public.pipeline_stages stage where stage.pipeline_id=target_job.pipeline_id and stage.stage_type='active' order by stage.position limit 1;
  else
    select stage.id into target_stage from public.pipeline_stages stage where stage.id=p_stage_id and stage.pipeline_id=target_job.pipeline_id and stage.stage_type='active';
  end if;
  if target_stage is null then raise exception 'invalid_initial_stage' using errcode='22023'; end if;
  select candidate.full_name into invalid_candidate from public.candidates candidate
    where candidate.id=any(p_candidate_ids) and candidate.organization_id=p_organization_id and (candidate.deleted_at is not null or candidate.status in ('do_not_contact','archived')) limit 1;
  if invalid_candidate is not null then raise exception 'candidate_unavailable:%',invalid_candidate using errcode='22023'; end if;
  if (select count(*) from public.candidates candidate where candidate.id=any(p_candidate_ids) and candidate.organization_id=p_organization_id and candidate.deleted_at is null)<>cardinality(p_candidate_ids) then raise exception 'candidate_not_found' using errcode='22023'; end if;
  if exists(select 1 from public.job_candidates existing where existing.job_id=p_job_id and existing.candidate_id=any(p_candidate_ids)) then raise exception 'candidate_already_in_job' using errcode='23505'; end if;
  return query insert into public.job_candidates(organization_id,job_id,candidate_id,current_stage_id,added_by)
    select p_organization_id,p_job_id,candidate_id,target_stage,auth.uid() from unnest(p_candidate_ids) candidate_id
    returning *;
end $$;

grant execute on function public.add_candidates_to_job(uuid,uuid,uuid[],uuid) to authenticated;

create or replace function public.set_company_default_fee(
  p_organization_id uuid,p_company_id uuid,p_fee_type text,p_fee_percentage numeric,p_fixed_fee numeric,
  p_currency text,p_guarantee_days integer default 90
) returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if not public.has_permission(p_organization_id,'commercial_terms.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_fee_type not in ('percentage','fixed') then raise exception 'invalid_fee_type' using errcode='22023'; end if;
  if p_fee_type='percentage' and (p_fee_percentage is null or p_fee_percentage<=0 or p_fee_percentage>100) then raise exception 'invalid_fee_percentage' using errcode='22023'; end if;
  if p_fee_type='fixed' and (p_fixed_fee is null or p_fixed_fee<0) then raise exception 'invalid_fixed_fee' using errcode='22023'; end if;
  if not exists(select 1 from public.companies where id=p_company_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'company_not_found' using errcode='22023'; end if;
  update public.commercial_terms set status='expired',effective_to=current_date-1 where organization_id=p_organization_id and company_id=p_company_id and status='active';
  insert into public.commercial_terms(organization_id,company_id,fee_type,fee_percentage,fixed_fee,currency,guarantee_days,status,created_by)
  values(p_organization_id,p_company_id,p_fee_type,case when p_fee_type='percentage' then p_fee_percentage end,case when p_fee_type='fixed' then p_fixed_fee end,upper(p_currency),p_guarantee_days,'active',auth.uid()) returning id into new_id;
  return new_id;
end $$;

grant execute on function public.set_company_default_fee(uuid,uuid,text,numeric,numeric,text,integer) to authenticated;

commit;
