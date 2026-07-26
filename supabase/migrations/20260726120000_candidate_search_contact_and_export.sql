-- Two things a consultant reasonably expects of a candidate search, neither of which worked.
--
-- 1. Searching an email or a phone number found nothing. p_query only matched full_name,
--    current_company and current_position -- so the single most common way a recruiter identifies
--    someone from an inbox or a missed call ("who is aisha@example.com?") returned an empty table, and
--    the only route to it was the separate filter drawer, which has no email field either.
--
--    Safe under the existing boundary rather than in spite of it: this function is `security invoker`,
--    so the LEFT JOIN to candidate_private_details is filtered by candidate_private_read, which
--    requires candidates_private.read (see 20260726050000_split_write_only_policies.sql). A member
--    without that permission gets NULL for private.email, and `null ilike '%...%'` is NULL, not true --
--    so they match nothing on contact details and the private boundary is unchanged. Asserted in
--    tests/rls/private-details-permission-split.test.ts rather than assumed.
--
-- 2. Export was silently capped at 200 rows. exportView in CandidatesPage passes EXPORT_LIMIT=5000 and
--    honestly reports "the first N were exported", but `least(greatest(p_limit,1),200)` overrode that to
--    200 regardless -- so exporting a 900-candidate view produced a truthful-but-useless message and a
--    fifth of the data. The ceiling moves to 5000 to match the caller's declared intent; the page-size
--    default of 50 is untouched, so ordinary paging pays nothing for this.
--
-- Same signature, so tests/rls/rpc-acl.expected.json needs no change. Body is otherwise reproduced
-- verbatim from 20260718130000_phase2_consultant_workflows.sql.
begin;

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
    and (nullif(trim(p_query),'') is null
      or c.full_name ilike '%'||trim(p_query)||'%'
      or c.current_company ilike '%'||trim(p_query)||'%'
      or c.current_position ilike '%'||trim(p_query)||'%'
      -- Contact details, visible only to a caller who can already read them (see header).
      or private.email ilike '%'||trim(p_query)||'%'
      -- Digits only on both sides, so '+65 8111 1111' is found by '81111111', '8111 1111' or
      -- '+6581111111'. A recruiter reads a number off a phone screen; they do not reproduce its
      -- spacing. Guarded on the query containing a digit so a name search does not degenerate into
      -- matching every phone number when the regexp strips it to ''.
      or (trim(p_query) ~ '[0-9]' and regexp_replace(coalesce(private.phone,''),'[^0-9]','','g') ilike '%'||regexp_replace(trim(p_query),'[^0-9]','','g')||'%'))
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
  limit least(greatest(p_limit,1),5000) offset greatest(p_offset,0)
$$;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) to authenticated;

/* Distinct tag and skill names for the filter autocomplete. The filters were free-text ilike against
 * these normalized tables, so "reactjs" silently matched nothing when the tag was "React" and nothing
 * told the user which spelling existed. Both are `security invoker` reads of tables already gated on
 * candidates.read, so they add no reach -- they only let the UI offer what is actually there. */
create or replace function public.list_candidate_tag_names(p_organization_id uuid)
returns table(name text) language sql stable security invoker set search_path=public as $$
  select distinct t.name from public.tags t
  where t.organization_id=p_organization_id and exists(select 1 from public.candidate_tags ct where ct.tag_id=t.id)
  order by t.name
$$;
revoke all on function public.list_candidate_tag_names(uuid) from public,anon;
grant execute on function public.list_candidate_tag_names(uuid) to authenticated;

create or replace function public.list_candidate_skill_names(p_organization_id uuid)
returns table(name text) language sql stable security invoker set search_path=public as $$
  select distinct s.name from public.skills s
  where s.organization_id=p_organization_id and exists(select 1 from public.candidate_skills cs where cs.skill_id=s.id)
  order by s.name
$$;
revoke all on function public.list_candidate_skill_names(uuid) from public,anon;
grant execute on function public.list_candidate_skill_names(uuid) to authenticated;

commit;
