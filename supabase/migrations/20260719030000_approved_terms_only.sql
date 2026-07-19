begin;

/* Only an approved agreement prices work.
 *
 * `approval_status` was added in 20260719010000 and, until now, nothing read it: every fee-resolution
 * path selected on `status='active'` alone. Exposing the control in the account form without this
 * would be worse than not exposing it at all -- a consultant could mark an agreement Draft or
 * Rejected, watch the UI accept it, and have it go on silently pricing job health, pipeline value,
 * and recorded placements exactly as before.
 *
 * `status` and `approval_status` answer different questions and both are required: `status` is
 * whether this row is the current one (versus superseded by a later agreement), `approval_status` is
 * whether anyone signed off on it.
 *
 * Rows predating approval tracking default to 'approved', so no existing agreement stops applying
 * and no historical figure moves.
 */

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
             when j.placement_fee_percentage is not null then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*j.placement_fee_percentage/100
             when terms.fee_type='fixed' then terms.fixed_fee
             when terms.fee_type='percentage' then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*terms.fee_percentage/100
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

/* The placement write path. An unapproved agreement must not become a placement's recorded
 * provenance, so term_id stays null and the caller's stated fee_source is what remains -- the
 * placement is then visibly manually priced rather than falsely attributed to an unsigned deal. */
create or replace function public.create_placement_from_offer(
  p_offer_id uuid,p_fee numeric,p_guarantee_days integer default 90,p_fee_source text default 'manual'
) returns uuid language plpgsql security definer set search_path=public as $$
declare o public.offers; jc public.job_candidates; j public.jobs; new_id uuid; placed_stage uuid; term_id uuid;
begin
  select * into o from public.offers where id=p_offer_id and status='accepted';
  if o.id is null or not public.has_permission(o.organization_id,'placements.write') then raise exception 'Offer not found'; end if;
  if p_fee_source not in ('account_agreement','job_override','manual') then raise exception 'invalid_fee_source' using errcode='22023'; end if;
  select * into jc from public.job_candidates where id=o.job_candidate_id; select * into j from public.jobs where id=jc.job_id;
  select ct.id into term_id from public.commercial_terms ct
    where ct.company_id=j.company_id and ct.organization_id=o.organization_id and ct.status='active'
      and ct.approval_status='approved'
      and (ct.effective_to is null or ct.effective_to>=current_date)
    order by ct.effective_from desc limit 1;
  insert into public.placements(organization_id,job_candidate_id,offer_id,candidate_id,job_id,company_id,start_date,salary,placement_fee,fee_percentage,fixed_fee,currency,owner_member_id,guarantee_days,created_by,commercial_term_id,fee_source)
  values(o.organization_id,jc.id,o.id,jc.candidate_id,j.id,j.company_id,coalesce(o.start_date,current_date),o.salary,p_fee,j.placement_fee_percentage,j.fixed_fee,o.currency,jc.owner_member_id,p_guarantee_days,auth.uid(),term_id,p_fee_source) returning id into new_id;
  select id into placed_stage from public.pipeline_stages where pipeline_id=j.pipeline_id and stage_type='placed' order by position limit 1;
  if placed_stage is not null then perform public.move_job_candidate_stage(jc.id,placed_stage,'Placement created','placement'); end if;
  update public.candidates set status='placed',updated_by=auth.uid() where id=jc.candidate_id; update public.jobs set status='filled',updated_by=auth.uid() where id=j.id;
  return new_id;
end $$;

grant execute on function public.create_placement_from_offer(uuid,numeric,integer,text) to authenticated;

/* The same rule in job health, which is where a consultant actually reads expected fee. Leaving this
 * one on `status='active'` alone would mean the job workspace pricing a role off an unapproved
 * agreement while the BD board reported no terms at all -- two screens disagreeing about the same
 * account, which is the exact class of defect Phase 1 existed to remove.
 *
 * Reproduced verbatim from 20260718130000 with the approval condition added; nothing else changed.
 */
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
