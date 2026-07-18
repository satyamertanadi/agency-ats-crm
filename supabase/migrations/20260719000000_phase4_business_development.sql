begin;

-- Phase 4 turns the CRM half of the product from storage into workflow. Three additive concerns:
-- a business-development pipeline over companies, per-user saved list views, and the missing link
-- between a placement and the commercial agreement that priced it.

create index if not exists companies_org_bd_stage on public.companies(organization_id,business_development_stage) where deleted_at is null;
create index if not exists contacts_org_follow_up on public.contacts(organization_id,next_follow_up_at) where deleted_at is null;

/* One row per company for the BD board. Everything the board shows is aggregated here rather than
 * assembled from four list queries in the browser, which is what made the Clients screen unable to
 * answer "which prospect is going cold" without opening every account.
 *
 * `next_follow_up_at` deliberately spans both sources a consultant would call a follow-up: a dated
 * contact follow-up and an open task linked to the company. Reporting only one of them is how an
 * account looks neglected while a task for it sits in Today. */
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
  -- `terms` has to precede `jobs` in the FROM clause: a LATERAL subquery can only see FROM-items to
  -- its left, and the jobs subquery below reads terms.fee_type/terms.fixed_fee for expected_open_fee.
  -- Ordered after `jobs` originally, which failed staging outright (42P01, "missing FROM-clause entry
  -- for table terms") before touching any real data -- the migration is wrapped in begin/commit, so
  -- nothing partially applied.
  left join lateral (
    select ct.id,ct.fee_type,ct.fee_percentage,ct.fixed_fee,ct.currency,ct.guarantee_days,ct.effective_to
    from public.commercial_terms ct
    where ct.company_id=c.id and ct.organization_id=p_organization_id and ct.status='active'
    order by ct.effective_from desc limit 1
  ) terms on true
  left join lateral (
    select
      count(*) filter (where j.status='open') as open_jobs,
      coalesce(sum(active.total) filter (where j.status='open'),0) as active_candidates,
      -- Expected fee uses the job's own salary midpoint against whichever fee actually applies, so
      -- the board's commercial value matches the number the job workspace already shows.
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

/* Moving an account along the BD pipeline. The stage lives on the company row, but the move is also
 * written to the activity feed, because "BD-stage history is preserved" cannot mean a single mutable
 * column -- overwriting it loses when an account went cold and who let it. The activity is the
 * history; the column is only the current position. */
create or replace function public.set_company_bd_stage(
  p_organization_id uuid,p_company_id uuid,p_stage text,p_note text default null
) returns public.companies language plpgsql security definer set search_path=public as $$
declare previous text;updated public.companies;
begin
  if not public.has_permission(p_organization_id,'companies.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_stage not in ('lead','qualifying','pitching','negotiating','won','lost','dormant') then raise exception 'invalid_bd_stage' using errcode='22023'; end if;
  select business_development_stage into previous from public.companies
    where id=p_company_id and organization_id=p_organization_id and deleted_at is null for update;
  if previous is null then raise exception 'company_not_found' using errcode='22023'; end if;
  if previous=p_stage then
    select * into updated from public.companies where id=p_company_id;
    return updated;
  end if;
  update public.companies set business_development_stage=p_stage,updated_at=now(),updated_by=auth.uid()
    where id=p_company_id and organization_id=p_organization_id returning * into updated;
  -- log_activity, not log_manual_activity: this is a system-journalled state change, and the manual
  -- entry point deliberately accepts only the types a human records by hand. 'status_change' is the
  -- existing type for exactly this, so the activities check constraint stays untouched.
  perform public.log_activity(
    p_organization_id,'status_change',
    coalesce(nullif(trim(p_note),''),'Business development stage moved from '||previous||' to '||p_stage),
    'BD stage: '||previous||' → '||p_stage,'internal',auth.uid(),
    jsonb_build_array(jsonb_build_object('company_id',p_company_id)),now()
  );
  return updated;
end $$;

grant execute on function public.set_company_bd_stage(uuid,uuid,text,text) to authenticated;

/* Saved list views.
 *
 * The table has existed since the initial migration (owner_member_id / filters / columns) and is
 * reused as-is; only `is_default` is added, so no existing row changes shape.
 *
 * The policies, however, are replaced. The originals were generated by the bulk RLS loop as
 * ('saved_views','reports.read','reports.read'), which means anyone holding reports.read could read
 * AND write every other member's saved views -- including renaming or deleting them. A personal view
 * that a colleague can silently rewrite is not a personal view, and 'is_shared' had no enforcement
 * behind it at all. Reads now require the view to be shared or your own; writes are owner-only in
 * every direction, so a shared view stays editable only by the member who saved it.
 *
 * This narrows access. Nothing that was previously denied becomes allowed. */
alter table public.saved_views add column if not exists is_default boolean not null default false;

create index if not exists saved_views_org_resource on public.saved_views(organization_id,resource);

drop policy if exists saved_views_read on public.saved_views;
drop policy if exists saved_views_write on public.saved_views;

create policy saved_views_read on public.saved_views for select to authenticated
  using (
    public.has_permission(organization_id,'reports.read')
    and (is_shared or owner_member_id in (select m.id from public.organization_members m where m.organization_id=saved_views.organization_id and m.user_id=auth.uid()))
  );

create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (
    public.has_permission(organization_id,'reports.read')
    and owner_member_id in (select m.id from public.organization_members m where m.organization_id=saved_views.organization_id and m.user_id=auth.uid() and m.status='active')
  );

create policy saved_views_update on public.saved_views for update to authenticated
  using (owner_member_id in (select m.id from public.organization_members m where m.organization_id=saved_views.organization_id and m.user_id=auth.uid()))
  with check (owner_member_id in (select m.id from public.organization_members m where m.organization_id=saved_views.organization_id and m.user_id=auth.uid()));

create policy saved_views_delete on public.saved_views for delete to authenticated
  using (owner_member_id in (select m.id from public.organization_members m where m.organization_id=saved_views.organization_id and m.user_id=auth.uid()));

/* Which agreement priced this placement. The economics themselves were already snapshotted onto the
 * placement row (fee_percentage, fixed_fee, guarantee_days, currency), so this is the missing
 * provenance rather than a second copy of the money: it records WHICH terms were in force, so a
 * later agreement change cannot make a historical placement look mispriced.
 *
 * Nullable and never backfilled -- inventing a link for placements recorded before this column
 * existed would be a guess presented as a record. */
alter table public.placements add column if not exists commercial_term_id uuid references public.commercial_terms(id) on delete set null;
alter table public.placements add column if not exists fee_source text;

comment on column public.placements.commercial_term_id is 'The commercial_terms row in force when this placement was recorded. Null for placements recorded before provenance was tracked, and for manually priced placements.';
comment on column public.placements.fee_source is 'How the fee was determined: account_agreement, job_override, or manual. Null for placements predating provenance tracking.';

commit;
