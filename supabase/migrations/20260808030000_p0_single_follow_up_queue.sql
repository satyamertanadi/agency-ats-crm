-- P0: Tasks are the single follow-up source. Preserve every legacy contact date by converting it to
-- an owned, linked task before clearing the duplicate contact column.
do $$
declare
  contact_row record;
  v_task_id uuid;
begin
  for contact_row in
    select id,organization_id,company_id,full_name,next_follow_up_at,relationship_owner_id,created_by
    from public.contacts where next_follow_up_at is not null and deleted_at is null
  loop
    insert into public.tasks(organization_id,title,status,priority,due_at,owner_member_id,created_by)
    values(contact_row.organization_id,'Follow up with '||contact_row.full_name,'open','normal',
      contact_row.next_follow_up_at,contact_row.relationship_owner_id,contact_row.created_by)
    returning id into v_task_id;
    insert into public.task_links(organization_id,task_id,contact_id)
    values(contact_row.organization_id,v_task_id,contact_row.id);
  end loop;
  update public.contacts set next_follow_up_at=null where next_follow_up_at is not null;
end $$;

-- Compatibility for an older frontend or an import file that still supplies next_follow_up_at: turn
-- it into a task immediately and clear the duplicate field, so no follow-up becomes invisible.
create or replace function public.contact_follow_up_to_task()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_task_id uuid;
begin
  if new.next_follow_up_at is null then return new; end if;
  insert into public.tasks(organization_id,title,status,priority,due_at,owner_member_id,created_by)
  values(new.organization_id,'Follow up with '||new.full_name,'open','normal',new.next_follow_up_at,
    new.relationship_owner_id,coalesce(auth.uid(),new.created_by)) returning id into v_task_id;
  insert into public.task_links(organization_id,task_id,contact_id)
  values(new.organization_id,v_task_id,new.id);
  update public.contacts set next_follow_up_at=null where id=new.id;
  return new;
end $$;

drop trigger if exists contacts_follow_up_to_task on public.contacts;
create trigger contacts_follow_up_to_task
after insert or update of next_follow_up_at on public.contacts
for each row when (new.next_follow_up_at is not null)
execute function public.contact_follow_up_to_task();

-- Client health must see both company-linked and contact-linked tasks now that the contact date is no
-- longer a second source of truth.
create or replace function public.list_company_pipeline(p_organization_id uuid)
returns table(
  id uuid,name text,industry text,location text,account_status text,business_development_stage text,
  owner_member_id uuid,owner_name text,contact_count bigint,open_jobs bigint,active_candidates bigint,
  next_follow_up_at timestamptz,last_activity_at timestamptz,placements bigint,
  terms_status text,fee_type text,fee_percentage numeric,fixed_fee numeric,currency text,
  guarantee_days integer,terms_effective_to date,expected_open_fee numeric,updated_at timestamptz
) language sql stable security invoker set search_path=public as $$
  select c.id,c.name,c.industry,c.location,c.account_status,c.business_development_stage,
    c.owner_member_id,coalesce(nullif(trim(profile.full_name),''),profile.email),
    coalesce(contacts.total,0),coalesce(jobs.open_jobs,0),coalesce(jobs.active_candidates,0),
    tasks.next_due_at,activity.last_activity_at,coalesce(placed.total,0),
    case when terms.id is null then 'none'
      when terms.effective_to is not null and terms.effective_to<current_date then 'expired'
      else 'active' end,
    terms.fee_type,terms.fee_percentage,terms.fixed_fee,terms.currency,terms.guarantee_days,terms.effective_to,
    coalesce(jobs.expected_open_fee,0),c.updated_at
  from public.companies c
  join public.organizations org on org.id=c.organization_id
  left join public.organization_members owner on owner.id=c.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select count(*) as total from public.contacts ct where ct.company_id=c.id and ct.deleted_at is null
  ) contacts on true
  left join lateral (
    select min(t.due_at) as next_due_at
    from public.tasks t join public.task_links tl on tl.task_id=t.id
    where t.organization_id=p_organization_id and t.deleted_at is null
      and t.status not in ('completed','cancelled') and t.due_at is not null
      and (tl.company_id=c.id or exists(
        select 1 from public.contacts linked_contact
        where linked_contact.id=tl.contact_id and linked_contact.company_id=c.id and linked_contact.deleted_at is null
      ))
  ) tasks on true
  left join lateral (
    select ct.id,ct.fee_type,ct.fee_percentage,ct.fixed_fee,ct.currency,ct.guarantee_days,ct.effective_to
    from public.commercial_terms ct
    where ct.company_id=c.id and ct.organization_id=p_organization_id and ct.status='active'
      and ct.approval_status='approved'
    order by ct.effective_from desc limit 1
  ) terms on true
  left join lateral (
    select count(*) filter(where j.status='open') as open_jobs,
      coalesce(sum(active.total) filter(where j.status='open'),0) as active_candidates,
      coalesce(sum(case when j.status<>'open' then 0 when j.fixed_fee is not null then j.fixed_fee
        when j.placement_fee_percentage is not null then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*(case when org.salary_period='monthly' then 12 else 1 end)*j.placement_fee_percentage/100
        when terms.fee_type='fixed' then terms.fixed_fee
        when terms.fee_type='percentage' then coalesce((j.salary_min+j.salary_max)/2,j.salary_min,j.salary_max,0)*(case when org.salary_period='monthly' then 12 else 1 end)*terms.fee_percentage/100
        else 0 end),0) as expected_open_fee
    from public.jobs j
    left join lateral(select count(*) as total from public.job_candidates jc where jc.job_id=j.id and jc.closed_at is null) active on true
    where j.company_id=c.id and j.deleted_at is null
  ) jobs on true
  left join lateral (
    select max(a.occurred_at) as last_activity_at from public.activities a
    join public.activity_links al on al.activity_id=a.id where al.company_id=c.id
  ) activity on true
  left join lateral (
    select count(*) as total from public.placements p where p.company_id=c.id and p.status<>'cancelled'
  ) placed on true
  where c.organization_id=p_organization_id and c.deleted_at is null
    and public.has_permission(p_organization_id,'companies.read')
  order by c.name;
$$;

revoke all on function public.list_company_pipeline(uuid) from public, anon;
grant execute on function public.list_company_pipeline(uuid) to authenticated;

create or replace function public.create_task_with_link(
  p_organization_id uuid,p_title text,p_description text default null,p_priority text default 'normal',
  p_due_at timestamptz default null,p_owner_member_id uuid default null,p_link_type text default null,
  p_link_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_task_id uuid;
begin
  if not public.has_permission(p_organization_id,'tasks.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'task_title_required' using errcode='22023'; end if;
  if p_owner_member_id is not null and not exists(select 1 from public.organization_members where id=p_owner_member_id and organization_id=p_organization_id and status='active') then raise exception 'invalid_owner' using errcode='22023'; end if;
  if (p_link_type is null)<>(p_link_id is null) then raise exception 'invalid_task_link' using errcode='22023'; end if;
  if p_link_type='candidate' and not exists(select 1 from public.candidates where id=p_link_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'candidate_not_found' using errcode='P0002';
  elsif p_link_type='company' and not exists(select 1 from public.companies where id=p_link_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'company_not_found' using errcode='P0002';
  elsif p_link_type='contact' and not exists(select 1 from public.contacts where id=p_link_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'contact_not_found' using errcode='P0002';
  elsif p_link_type='job' and not exists(select 1 from public.jobs where id=p_link_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'job_not_found' using errcode='P0002';
  elsif p_link_type is not null and p_link_type not in ('candidate','company','contact','job') then raise exception 'invalid_task_link' using errcode='22023';
  end if;
  insert into public.tasks(organization_id,title,description,priority,due_at,owner_member_id,created_by)
  values(p_organization_id,trim(p_title),nullif(trim(p_description),''),p_priority,p_due_at,p_owner_member_id,auth.uid()) returning id into v_task_id;
  if p_link_type is not null then
    insert into public.task_links(organization_id,task_id,candidate_id,company_id,contact_id,job_id)
    values(p_organization_id,v_task_id,case when p_link_type='candidate' then p_link_id end,
      case when p_link_type='company' then p_link_id end,case when p_link_type='contact' then p_link_id end,
      case when p_link_type='job' then p_link_id end);
  end if;
  return v_task_id;
end $$;

revoke all on function public.create_task_with_link(uuid,text,text,text,timestamptz,uuid,text,uuid) from public, anon;
grant execute on function public.create_task_with_link(uuid,text,text,text,timestamptz,uuid,text,uuid) to authenticated;
