-- Two RPCs powering the extension's "next level" surfaces.
--
-- lookup_prospects_by_linkedin: the ATS-awareness radar. Given the profile URLs visible on a LinkedIn
-- page (a profile, a search-results list, an engagement list), return which are already candidates or
-- contacts and, for candidates, their live pipeline positions -- so the extension can paint an inline
-- "already in your ATS · Screening" badge and you never re-source someone.
--
-- capture_prospects_bulk: capture many selected people in one round trip. Delegates each item to
-- capture_prospect (so dedup/merge/permissions/metadata all behave identically) and is per-item
-- error-tolerant: one malformed row reports its error without aborting the rest of the batch.

create or replace function public.lookup_prospects_by_linkedin(p_organization_id uuid, p_linkedin_urls text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_permission(p_organization_id,'candidates.read') then raise exception 'permission_denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(entry),'[]'::jsonb) into result from (
    select jsonb_build_object(
      'linkedin_url', u.url,
      'candidate', (
        select jsonb_build_object('id',c.id,'full_name',c.full_name,'status',c.status,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object('job',j.title,'stage',ps.name) order by j.title)
            from public.job_candidates jc
            join public.jobs j on j.id=jc.job_id
            join public.pipeline_stages ps on ps.id=jc.current_stage_id
            where jc.candidate_id=c.id and jc.closed_at is null),'[]'::jsonb))
        from public.candidates c
        where c.organization_id=p_organization_id and lower(c.linkedin_url)=lower(u.url) and c.deleted_at is null
        limit 1),
      'contact', (
        select jsonb_build_object('id',ct.id,'full_name',ct.full_name)
        from public.contacts ct
        where ct.organization_id=p_organization_id and lower(ct.linkedin_url)=lower(u.url) and ct.deleted_at is null
        limit 1)
    ) as entry
    from unnest(p_linkedin_urls) as u(url)
    where nullif(trim(u.url),'') is not null
  ) sub;
  return result;
end $$;
revoke all on function public.lookup_prospects_by_linkedin(uuid,text[]) from public, anon;
grant execute on function public.lookup_prospects_by_linkedin(uuid,text[]) to authenticated;

create or replace function public.capture_prospects_bulk(p_organization_id uuid, p_kind text, p_items jsonb, p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; res jsonb; out jsonb := '[]'::jsonb;
begin
  if p_kind not in ('candidate','contact') then raise exception 'invalid_kind' using errcode='22023'; end if;
  -- Fail fast on a permission problem so the caller gets one clean error, not N per-item errors.
  if p_kind='candidate' and not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_kind='contact' and not public.has_permission(p_organization_id,'contacts.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    begin
      res := public.capture_prospect(p_organization_id, p_kind, item, p_job_id);
      out := out || jsonb_build_array(jsonb_build_object('linkedin_url', item->>'linkedin_url', 'ok', true, 'result', res));
    exception when others then
      out := out || jsonb_build_array(jsonb_build_object('linkedin_url', item->>'linkedin_url', 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return out;
end $$;
revoke all on function public.capture_prospects_bulk(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.capture_prospects_bulk(uuid,text,jsonb,uuid) to authenticated;
