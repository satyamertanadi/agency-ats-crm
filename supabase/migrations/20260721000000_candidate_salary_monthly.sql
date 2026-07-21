begin;

-- Switch the workspace salary convention on. organizations.salary_period was added in
-- 20260716120000 (default 'annual') and formatSalary()/OrganizationProvider already render off it,
-- but nothing ever set it to 'monthly' -- every salary in this workspace has in fact been a monthly
-- Indonesian figure the whole time, so the number was always correct and only the missing label was
-- wrong. No candidate or job salary value is converted here; only the period marker changes.
update public.organizations set salary_period = 'monthly' where salary_period <> 'monthly';

-- Placement fee math must not silently follow that flip. Both functions below computed
-- `salary * fee_percentage / 100` with the salary read as if it were annual -- that was consistent
-- with the old (never-actually-true) 'annual' default. Once salary_period is 'monthly', the same
-- formula would quote every fee at ~1/12th its real size unless the salary is first restated at its
-- annual equivalent (monthly * 12), which is what a placement fee percentage is conventionally
-- against. The multiplier below is 1 for any org still on 'annual', so this is a no-op there.

create or replace function public.list_company_pipeline(p_organization_id uuid)
returns table(
  id uuid,name text,industry text,location text,account_status text,business_development_stage text,
  owner_member_id uuid,owner_name text,contact_count bigint,open_jobs bigint,active_candidates bigint,
  next_follow_up_at timestamptz,last_activity_at timestamptz,placements bigint,
  terms_status text,fee_type text,fee_percentage numeric,fixed_fee numeric,currency text,
  guarantee_days integer,terms_effective_to date,expected_open_fee numeric,updated_at timestamptz
) language sql stable security invoker set search_path=public as $$
  select c.id,c.name,c.industry,c.location,c.account_status,c.business_development_stage,
    c.owner_member_id,
    coalesce(nullif(trim(profile.full_name),''),profile.email) as owner_name,
    coalesce(contacts.total,0) as contact_count,
    coalesce(jobs.open_jobs,0) as open_jobs,
    coalesce(jobs.active_candidates,0) as active_candidates,
    least(contacts.next_follow_up_at,tasks.next_due_at) as next_follow_up_at,
    activity.last_activity_at,
    coalesce(placed.total,0) as placements,
    case
      when terms.id is null then 'none'
      when terms.effective_to is not null and terms.effective_to < current_date then 'expired'
      else 'active'
    end as terms_status,
    terms.fee_type,terms.fee_percentage,terms.fixed_fee,terms.currency,terms.guarantee_days,terms.effective_to,
    coalesce(jobs.expected_open_fee,0) as expected_open_fee,
    c.updated_at
  from public.companies c
  join public.organizations org on org.id=c.organization_id
  left join public.organization_members owner on owner.id=c.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select count(*) as total,min(ct.next_follow_up_at) filter (where ct.next_follow_up_at is not null) as next_follow_up_at
    from public.contacts ct where ct.company_id=c.id and ct.deleted_at is null
  ) contacts on true
  left join lateral (
    select min(t.due_at) as next_due_at
    from public.tasks t join public.task_links tl on tl.task_id=t.id
    where tl.company_id=c.id and t.deleted_at is null and t.status not in ('completed','cancelled') and t.due_at is not null
  ) tasks on true
  -- `terms` precedes `jobs`: a LATERAL subquery sees only FROM-items to its left, and jobs reads
  -- terms.fee_type/terms.fixed_fee below.
  left join lateral (
    select ct.id,ct.fee_type,ct.fee_percentage,ct.fixed_fee,ct.currency,ct.guarantee_days,ct.effective_to
    from public.commercial_terms ct
    where ct.company_id=c.id and ct.organization_id=p_organization_id and ct.status='active'
      and ct.approval_status='approved'
    order by ct.effective_from desc limit 1
  ) terms on true
  left join lateral (
    select
      count(*) filter (where j.status='open') as open_jobs,
      coalesce(sum(active.total) filter (where j.status='open'),0) as active_candidates,
      coalesce(sum(
        case when j.status<>'open' then 0
             when j.fixed_fee is not null then j.fixed_fee
             when j.placement_fee_percentage is not null then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*(case when org.salary_period='monthly' then 12 else 1 end)*j.placement_fee_percentage/100
             when terms.fee_type='fixed' then terms.fixed_fee
             when terms.fee_type='percentage' then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*(case when org.salary_period='monthly' then 12 else 1 end)*terms.fee_percentage/100
             else 0 end
      ),0) as expected_open_fee
    from public.jobs j
    left join lateral (
      select count(*) as total from public.job_candidates jc where jc.job_id=j.id and jc.closed_at is null
    ) active on true
    where j.company_id=c.id and j.deleted_at is null
  ) jobs on true
  left join lateral (
    select max(a.occurred_at) as last_activity_at
    from public.activities a join public.activity_links al on al.activity_id=a.id
    where al.company_id=c.id
  ) activity on true
  left join lateral (
    select count(*) as total from public.placements p where p.company_id=c.id and p.status<>'cancelled'
  ) placed on true
  where c.organization_id=p_organization_id and c.deleted_at is null
    and public.has_permission(p_organization_id,'companies.read')
  order by c.name;
$$;

grant execute on function public.list_company_pipeline(uuid) to authenticated;

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
      when job.salary_max is not null and job.placement_fee_percentage is not null then job.salary_max*(case when org.salary_period='monthly' then 12 else 1 end)*job.placement_fee_percentage/100
      when terms.fixed_fee is not null then terms.fixed_fee
      when job.salary_max is not null and terms.fee_percentage is not null then job.salary_max*(case when org.salary_period='monthly' then 12 else 1 end)*terms.fee_percentage/100
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
  join public.organizations org on org.id=job.organization_id
  left join public.organization_members owner on owner.id=job.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select term.id,term.fee_percentage,term.fixed_fee,term.currency
    from public.commercial_terms term
    where term.company_id=job.company_id and term.organization_id=job.organization_id and term.status='active'
      and term.approval_status='approved'
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

commit;
