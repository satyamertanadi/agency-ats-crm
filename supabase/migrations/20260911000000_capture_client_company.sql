begin;

-- Capturing a client company from LinkedIn.
--
-- The extension could already capture a candidate or a contact, but a contact requires a company that
-- already exists in the ATS -- so sourcing a new client from LinkedIn meant leaving the extension,
-- creating the company by hand, and coming back. This closes that dead end from the company page,
-- where the useful fields (industry, size, website, location) actually live.

/* The LinkedIn company URL, which is the natural dedup key from this source.
 *
 * Companies had no stable external identifier at all, so the only way to recognise one already in the
 * ATS was its name -- and "Swiss-Belhotel International" typed by hand and scraped from LinkedIn are
 * routinely different strings. A canonical URL is exact.
 *
 * Unique per organisation, and only where present: a workspace's companies are mostly created by
 * hand and will never have one, so a plain unique index would collide on the first two nulls in
 * some engines and constrain nothing useful here.
 */
alter table public.companies add column if not exists linkedin_url text;

create unique index if not exists companies_linkedin_url_unique
  on public.companies(organization_id, lower(linkedin_url))
  where linkedin_url is not null and deleted_at is null;

comment on column public.companies.linkedin_url is
  'Canonical linkedin.com/company/<slug> URL. The dedup key for extension capture; null for companies created by hand.';

/* Adds 'client' to capture_prospect.
 *
 * A sibling branch rather than a separate RPC, because everything around it is already shared: the
 * organisation check, the source label, the deduped/created result shape, and the coalesce-merge rule
 * that a re-capture never overwrites curated data. Splitting it would duplicate all of that and give
 * the extension two result contracts to handle.
 *
 * The candidate and contact branches below are carried over unchanged.
 */
create or replace function public.capture_prospect(
  p_organization_id uuid,
  p_kind text,
  p_payload jsonb,
  p_job_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_full_name text := nullif(trim(p_payload->>'full_name'),'');
  v_email text := public.normalize_email(p_payload->>'email');
  v_linkedin text := nullif(trim(p_payload->>'linkedin_url'),'');
  v_source text := coalesce(nullif(trim(p_payload->>'source'),''), 'Capture');
  v_id uuid;
  v_deduped boolean := false;
  v_job_linked boolean := false;
  v_stage_id uuid;
  v_existing_stage uuid;
  v_company_name text;
begin
  if p_kind not in ('candidate','contact','client') then raise exception 'invalid_kind' using errcode='22023'; end if;

  /* The client branch returns before the person checks below. A company has no full_name, so that
   * requirement belongs to the two person kinds rather than to the function. */
  if p_kind = 'client' then
    if not public.has_permission(p_organization_id,'companies.write') then raise exception 'permission_denied' using errcode='42501'; end if;

    v_company_name := nullif(trim(p_payload->>'name'),'');
    if v_company_name is null or length(v_company_name) < 2 then raise exception 'company_name_required' using errcode='22023'; end if;

    -- The LinkedIn URL first, because it is exact. Then the name, which catches a company somebody
    -- already created by hand and which therefore has no URL to match on.
    if v_linkedin is not null then
      select id into v_id from public.companies
      where organization_id=p_organization_id and lower(linkedin_url)=lower(v_linkedin) and deleted_at is null
      limit 1;
    end if;
    if v_id is null then
      select id into v_id from public.companies
      where organization_id=p_organization_id and lower(name)=lower(v_company_name) and deleted_at is null
      limit 1;
    end if;

    if v_id is not null then
      /* Coalesce-merge, exactly as the person branches do. A client record carries commercial
       * judgement -- account status, BD stage, owner, notes -- and a re-capture from LinkedIn must
       * never overwrite any of it. Only genuinely empty fields are filled. */
      update public.companies set
        industry=coalesce(nullif(industry,''), nullif(trim(p_payload->>'industry'),'')),
        website=coalesce(nullif(website,''), nullif(trim(p_payload->>'website'),'')),
        location=coalesce(nullif(location,''), nullif(trim(p_payload->>'location'),'')),
        company_size=coalesce(nullif(company_size,''), nullif(trim(p_payload->>'company_size'),'')),
        linkedin_url=coalesce(nullif(linkedin_url,''), v_linkedin),
        updated_by=auth.uid(), updated_at=now()
      where id=v_id;
      v_deduped := true;
    else
      /* account_status, business_development_stage and owner_member_id are left to their table
       * defaults -- 'prospect', 'lead', unassigned. Sourcing a company from LinkedIn is not the same
       * as having won it, and guessing an owner puts somebody's name on a pipeline entry they never
       * agreed to. */
      insert into public.companies(
        organization_id,name,industry,website,location,company_size,linkedin_url,created_by
      ) values (
        p_organization_id,v_company_name,
        nullif(trim(p_payload->>'industry'),''),
        nullif(trim(p_payload->>'website'),''),
        nullif(trim(p_payload->>'location'),''),
        nullif(trim(p_payload->>'company_size'),''),
        v_linkedin,auth.uid()
      ) returning id into v_id;
    end if;

    return jsonb_build_object('id',v_id,'kind',p_kind,'deduped',v_deduped,'job_linked',false);
  end if;

  if v_full_name is null or length(v_full_name) < 2 then raise exception 'full_name_required' using errcode='22023'; end if;

  if p_kind = 'candidate' then
    if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;

    -- Match on email first (strong, unique-indexed -- and matched regardless of deleted_at so a
    -- re-capture of a soft-archived candidate revives them instead of tripping the unique index),
    -- then on linkedin_url among live candidates.
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
      -- Coalesce-merge: only fill fields that are currently empty; never overwrite curated data.
      update public.candidates set
        current_company=coalesce(nullif(current_company,''), nullif(trim(p_payload->>'current_company'),'')),
        current_position=coalesce(nullif(current_position,''), nullif(trim(p_payload->>'current_position'),'')),
        location=coalesce(nullif(location,''), nullif(trim(p_payload->>'location'),'')),
        linkedin_url=coalesce(nullif(linkedin_url,''), v_linkedin),
        portfolio_url=coalesce(nullif(portfolio_url,''), nullif(trim(p_payload->>'portfolio_url'),'')),
        deleted_at=null, updated_by=auth.uid(), updated_at=now()
      where id=v_id;
      insert into public.candidate_private_details(candidate_id,organization_id,email,phone)
        values(v_id,p_organization_id,nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''))
      on conflict (candidate_id) do update set
        email=coalesce(nullif(public.candidate_private_details.email,''), excluded.email),
        phone=coalesce(nullif(public.candidate_private_details.phone,''), excluded.phone),
        updated_at=now();
      v_deduped := true;
    else
      insert into public.candidates(organization_id,full_name,current_company,current_position,location,linkedin_url,portfolio_url,source,created_by)
        values(p_organization_id,v_full_name,nullif(trim(p_payload->>'current_company'),''),nullif(trim(p_payload->>'current_position'),''),nullif(trim(p_payload->>'location'),''),v_linkedin,nullif(trim(p_payload->>'portfolio_url'),''),v_source,auth.uid())
        returning id into v_id;
      insert into public.candidate_private_details(candidate_id,organization_id,email,phone)
        values(v_id,p_organization_id,nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''));
    end if;

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
        email=coalesce(nullif(email,''), nullif(p_payload->>'email','')),
        phone=coalesce(nullif(phone,''), nullif(p_payload->>'phone','')),
        linkedin_url=coalesce(nullif(linkedin_url,''), v_linkedin),
        updated_by=auth.uid(), updated_at=now()
      where id=v_id;
      v_deduped := true;
    else
      insert into public.contacts(organization_id,company_id,full_name,position,email,phone,linkedin_url,created_by)
        values(p_organization_id,(p_payload->>'company_id')::uuid,v_full_name,coalesce(nullif(trim(p_payload->>'current_position'),''),nullif(trim(p_payload->>'position'),'')),nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),v_linkedin,auth.uid())
        returning id into v_id;
    end if;
  end if;

  return jsonb_build_object('id',v_id,'kind',p_kind,'deduped',v_deduped,'job_linked',v_job_linked);
end $$;

revoke all on function public.capture_prospect(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.capture_prospect(uuid,text,jsonb,uuid) to authenticated;

commit;
