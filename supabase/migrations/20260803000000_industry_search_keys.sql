/* companies.industry now stores a canonical key ('food_beverage') instead of whatever a consultant
 * typed, so that the clients list can filter and group it. See src/shared/lib/industries.ts for the
 * vocabulary. This migration exists because that storage change breaks search_workspace
 * (20260713000000 :701) in two ways at once:
 *
 *   1. Matching. The palette does `co.industry ilike '%'||p_query||'%'`. Against a stored key, typing
 *      "Food & Beverage" -- the label the product itself shows -- matches nothing. Single-word sectors
 *      like "hospitality" survive by luck; every multi-word or ampersanded one does not.
 *   2. Reading. The subtitle concatenates the raw column, so a result reads "food_beverage · Jakarta".
 *
 * Deliberately NOT fixed with a SQL copy of the 27 labels. That would be a third source of truth
 * (after the app module and its Deno mirror) in the one language where no parity test can reach it,
 * and it would need editing every time a sector is added. Instead both sides of the match are folded
 * through the same generic rule the app uses -- lowercase, non-alphanumeric runs to a single space --
 * which needs no vocabulary at all. It also repairs a case that is broken TODAY on free text:
 * "FOOD&BEVERAGE" and "food/beverage" currently fail to match a column reading "Food & Beverage".
 *
 * Three properties worth knowing:
 *   - The normalisation IS the LIKE escaping. `%` and `_` are non-alphanumeric and become spaces, so a
 *     user searching "100%" can no longer inject a wildcard. The raw ilike this replaces could.
 *   - nullif(...,'') makes an all-punctuation query yield NULL rather than `like '%%'` (which would
 *     match every company). The name branch already governs the empty-query case, so net behaviour on
 *     an empty query is unchanged.
 *   - The subtitle de-keys ONLY key-shaped values (`^[a-z0-9_]+$`), byte-for-byte the rule
 *     industryLabel() applies, so a legacy row still reading "Renewable energy" renders untouched.
 *
 * The one accepted cost: the palette shows "Food beverage" where the app shows "Food & beverage". The
 * ampersand is not recoverable without duplicating the labels here. Cosmetic, and confined to the
 * search result subtitle.
 *
 * No schema change, no data rewrite, no new function. Normalising the stored rows is deliberately left
 * for after the next bulk import, when the real value distribution is known -- industryKey() already
 * groups legacy spellings at read time, so nothing is waiting on it. Because the signature is
 * unchanged, src/generated/database.types.ts and tests/rls/rpc-acl.expected.json both stay untouched;
 * only the company branch of the body differs from 20260713000000. */
begin;

create or replace function public.search_workspace(p_organization_id uuid,p_query text,p_limit integer default 20)
returns table(entity_type text,entity_id uuid,title text,subtitle text,rank real) language sql stable security definer set search_path=public as $$
  select * from (
    select 'candidate'::text,c.id,c.full_name,concat_ws(' · ',c.current_position,c.current_company,c.location),extensions.similarity(c.full_name,p_query)::real from public.candidates c where c.organization_id=p_organization_id and c.deleted_at is null and public.has_permission(p_organization_id,'candidates.read') and (c.full_name ilike '%'||p_query||'%' or c.current_company ilike '%'||p_query||'%' or c.current_position ilike '%'||p_query||'%')
    union all select 'company',co.id,co.name,concat_ws(' · ',case when co.industry ~ '^[a-z0-9_]+$' then upper(left(replace(co.industry,'_',' '),1))||substr(replace(co.industry,'_',' '),2) else co.industry end,co.location),extensions.similarity(co.name,p_query)::real from public.companies co where co.organization_id=p_organization_id and co.deleted_at is null and public.has_permission(p_organization_id,'companies.read') and (co.name ilike '%'||p_query||'%' or btrim(regexp_replace(lower(coalesce(co.industry,'')),'[^a-z0-9]+',' ','g')) like '%'||nullif(btrim(regexp_replace(lower(p_query),'[^a-z0-9]+',' ','g')),'')||'%')
    union all select 'contact',ct.id,ct.full_name,concat_ws(' · ',ct.position,co.name),extensions.similarity(ct.full_name,p_query)::real from public.contacts ct join public.companies co on co.id=ct.company_id where ct.organization_id=p_organization_id and ct.deleted_at is null and public.has_permission(p_organization_id,'contacts.read') and (ct.full_name ilike '%'||p_query||'%' or ct.email ilike '%'||p_query||'%')
    union all select 'job',j.id,j.title,concat_ws(' · ',co.name,j.location),extensions.similarity(j.title,p_query)::real from public.jobs j join public.companies co on co.id=j.company_id where j.organization_id=p_organization_id and j.deleted_at is null and public.has_permission(p_organization_id,'jobs.read') and (j.title ilike '%'||p_query||'%' or j.description ilike '%'||p_query||'%')
  ) results(entity_type,entity_id,title,subtitle,rank) order by rank desc,title limit least(p_limit,100)
$$;
-- Re-issued exactly as 20260713000000 :706 wrote it. Deliberately no `revoke ... from public,anon`
-- here: this function's ACL predates that convention, and changing it in a migration about industry
-- keys would be an unreviewed access change riding along with a search fix.
grant execute on function public.search_workspace(uuid,text,integer) to authenticated;

commit;
