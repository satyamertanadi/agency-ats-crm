begin;

-- A job record is one vacancy/seat. This both documents that commercial rule and
-- closes the race where two accepted offers could create two live placements.
-- Reconcile only unambiguous legacy race artifacts: no offer on either row and
-- creation within five seconds. Anything less certain still fails below and
-- requires an explicit recruitment-data decision instead of silent data loss.
with ranked as (
  select
    placement.id,
    placement.organization_id,
    placement.job_id,
    placement.offer_id,
    placement.created_at,
    row_number() over(partition by placement.job_id order by placement.created_at,placement.id) as row_number,
    first_value(placement.id) over(partition by placement.job_id order by placement.created_at,placement.id) as kept_placement_id,
    first_value(placement.offer_id) over(partition by placement.job_id order by placement.created_at,placement.id) as kept_offer_id,
    first_value(placement.created_at) over(partition by placement.job_id order by placement.created_at,placement.id) as kept_created_at
  from public.placements placement
  where placement.status<>'cancelled'
), reconciled as (
  update public.placements placement
  set status='cancelled',updated_at=now()
  from ranked duplicate
  where placement.id=duplicate.id
    and duplicate.row_number>1
    and duplicate.offer_id is null
    and duplicate.kept_offer_id is null
    and duplicate.created_at<=duplicate.kept_created_at+interval '5 seconds'
  returning placement.id,placement.organization_id,placement.job_id,duplicate.kept_placement_id
)
insert into public.audit_logs(organization_id,action,entity_type,entity_id,metadata)
select
  organization_id,
  'placement.duplicate_race_reconciled',
  'placement',
  id,
  jsonb_build_object(
    'job_id',job_id,
    'kept_placement_id',kept_placement_id,
    'reason','no_offer_rows_created_within_five_seconds'
  )
from reconciled;

do $$
begin
  if exists(
    select 1
    from public.placements placement
    where placement.status<>'cancelled'
    group by placement.job_id
    having count(*)>1
  ) then
    raise exception 'manual_placement_reconciliation_required' using errcode='23505';
  end if;
end $$;

create unique index if not exists placements_one_active_hire_per_job
  on public.placements(job_id)
  where status<>'cancelled';

create or replace function public.create_placement_from_offer(
  p_offer_id uuid,p_fee numeric,p_guarantee_days integer default 90,p_fee_source text default 'manual'
) returns uuid language plpgsql security definer set search_path=public as $$
declare o public.offers; jc public.job_candidates; j public.jobs; new_id uuid; placed_stage uuid; term_id uuid;
begin
  select * into o from public.offers where id=p_offer_id and status='accepted';
  if o.id is null or not public.has_permission(o.organization_id,'placements.write') then raise exception 'Offer not found'; end if;
  if p_fee_source not in ('account_agreement','job_override','manual') then raise exception 'invalid_fee_source' using errcode='22023'; end if;
  select * into jc from public.job_candidates where id=o.job_candidate_id;
  select * into j from public.jobs where id=jc.job_id;
  perform pg_advisory_xact_lock(hashtextextended(j.id::text,0));
  if exists(select 1 from public.placements where job_id=j.id and status<>'cancelled') then
    raise exception 'job_already_placed' using errcode='23505';
  end if;
  select ct.id into term_id from public.commercial_terms ct
    where ct.company_id=j.company_id and ct.organization_id=o.organization_id and ct.status='active'
      and ct.approval_status='approved'
      and (ct.effective_to is null or ct.effective_to>=current_date)
    order by ct.effective_from desc limit 1;
  insert into public.placements(organization_id,job_candidate_id,offer_id,candidate_id,job_id,company_id,start_date,salary,placement_fee,fee_percentage,fixed_fee,currency,owner_member_id,guarantee_days,created_by,commercial_term_id,fee_source)
  values(o.organization_id,jc.id,o.id,jc.candidate_id,j.id,j.company_id,coalesce(o.start_date,current_date),o.salary,p_fee,j.placement_fee_percentage,j.fixed_fee,o.currency,jc.owner_member_id,p_guarantee_days,auth.uid(),term_id,p_fee_source) returning id into new_id;
  select id into placed_stage from public.pipeline_stages where pipeline_id=j.pipeline_id and stage_type='placed' order by position limit 1;
  if placed_stage is not null then perform public.move_job_candidate_stage(jc.id,placed_stage,'Placement created','placement'); end if;
  update public.candidates set status='placed',updated_by=auth.uid() where id=jc.candidate_id;
  update public.jobs set status='filled',updated_by=auth.uid() where id=j.id;
  return new_id;
end $$;
revoke all on function public.create_placement_from_offer(uuid,numeric,integer,text) from public,anon;
grant execute on function public.create_placement_from_offer(uuid,numeric,integer,text) to authenticated;

commit;
