begin;

-- Completes Phase 4's commercial half. The previous migration added placements.commercial_term_id
-- and placements.fee_source but nothing ever wrote them, so the columns recorded nothing. This adds
-- the write path and the structured agreement fields the columns are meant to reference.
--
-- A separate forward migration rather than an edit to 20260719000000: that one may already be
-- applied, and correcting an applied migration in place is how two environments come to disagree
-- about what the schema is.

/* The rest of a real fee agreement. Every column is nullable with no backfill: an agreement signed
 * before these fields existed genuinely has no recorded payment terms, and defaulting them to a
 * plausible value would manufacture commercial facts nobody agreed to. */
alter table public.commercial_terms add column if not exists payment_terms_days integer;
alter table public.commercial_terms add column if not exists tax_treatment text;
alter table public.commercial_terms add column if not exists replacement_terms text;
alter table public.commercial_terms add column if not exists agreement_document_url text;
alter table public.commercial_terms add column if not exists approval_status text not null default 'approved';
alter table public.commercial_terms add column if not exists notes text;

alter table public.commercial_terms drop constraint if exists commercial_terms_approval_status_check;
alter table public.commercial_terms add constraint commercial_terms_approval_status_check
  check (approval_status in ('draft','pending_approval','approved','rejected'));

-- Existing rows predate the concept and were all treated as in force, so 'approved' is the honest
-- carry-over rather than a new assertion about them.
comment on column public.commercial_terms.approval_status is 'Rows created before approval tracking default to approved, which is how they were already being treated.';

/* Placement provenance.
 *
 * The fee itself is passed in by the caller, so the function cannot know which source produced it
 * without being told. Inferring it -- comparing the number against what each source would have
 * computed -- would record a guess as provenance, and two sources agreeing on a value would make
 * the guess unresolvable. The caller states it instead.
 *
 * commercial_term_id is different: which agreement was in force at this moment is a fact the
 * database can establish, so it is recorded regardless of which source set the fee. fee_source is
 * what disambiguates context from cause.
 *
 * The three-argument version is dropped rather than left alongside this one: with p_fee_source
 * defaulted, keeping both would make every existing three-argument call ambiguous and fail.
 */
drop function if exists public.create_placement_from_offer(uuid,numeric,integer);

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

/* set_company_default_fee gains the structured fields. Unchanged signature prefix and all new
 * parameters defaulted, so existing callers keep working without modification. */
create or replace function public.set_company_default_fee(
  p_organization_id uuid,p_company_id uuid,p_fee_type text,p_fee_percentage numeric,p_fixed_fee numeric,
  p_currency text,p_guarantee_days integer default 90,p_payment_terms_days integer default null,
  p_tax_treatment text default null,p_replacement_terms text default null,
  p_agreement_document_url text default null,p_approval_status text default 'approved',p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if not public.has_permission(p_organization_id,'commercial_terms.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_fee_type not in ('percentage','fixed') then raise exception 'invalid_fee_type' using errcode='22023'; end if;
  if p_fee_type='percentage' and (p_fee_percentage is null or p_fee_percentage<=0 or p_fee_percentage>100) then raise exception 'invalid_fee_percentage' using errcode='22023'; end if;
  if p_fee_type='fixed' and (p_fixed_fee is null or p_fixed_fee<0) then raise exception 'invalid_fixed_fee' using errcode='22023'; end if;
  if p_approval_status not in ('draft','pending_approval','approved','rejected') then raise exception 'invalid_approval_status' using errcode='22023'; end if;
  if not exists(select 1 from public.companies where id=p_company_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'company_not_found' using errcode='22023'; end if;
  update public.commercial_terms set status='expired',effective_to=current_date-1 where organization_id=p_organization_id and company_id=p_company_id and status='active';
  insert into public.commercial_terms(organization_id,company_id,fee_type,fee_percentage,fixed_fee,currency,guarantee_days,status,created_by,payment_terms_days,tax_treatment,replacement_terms,agreement_document_url,approval_status,notes)
  values(p_organization_id,p_company_id,p_fee_type,case when p_fee_type='percentage' then p_fee_percentage end,case when p_fee_type='fixed' then p_fixed_fee end,upper(p_currency),p_guarantee_days,'active',auth.uid(),p_payment_terms_days,nullif(trim(p_tax_treatment),''),nullif(trim(p_replacement_terms),''),nullif(trim(p_agreement_document_url),''),p_approval_status,nullif(trim(p_notes),'')) returning id into new_id;
  return new_id;
end $$;

-- The seven-argument version is superseded, not kept: leaving it would make a seven-argument call
-- ambiguous against this one's defaults.
drop function if exists public.set_company_default_fee(uuid,uuid,text,numeric,numeric,text,integer);
grant execute on function public.set_company_default_fee(uuid,uuid,text,numeric,numeric,text,integer,integer,text,text,text,text,text) to authenticated;

commit;
