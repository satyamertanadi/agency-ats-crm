-- Workflow signals on the candidate list.
--
-- search_candidates_page returned 18 columns and every one of them was an attribute: who the person
-- is, never what is happening with them. The list could not say "last touched 6 days ago, sitting in
-- Interview for 12 days, follow-up overdue" because none of that had ever been in the query. This
-- adds the follow-up, pipeline and data-quality signals, plus a named-queue filter.
--
-- candidates.last_contacted_at is deliberately NOT used. It exists on the table but nothing in the
-- codebase has ever written to it -- it is read once by a retention check as
-- coalesce(last_contacted_at, created_at) and nulled by anonymisation. Reading it here would render a
-- permanently blank column. Last contact is derived from activities instead.

-- Three lookups this query is about to depend on, none of which had an index. job_candidates has
-- unique(job_id,candidate_id), which does not serve a lookup keyed on candidate_id alone -- without
-- these, every new lateral below is a sequential scan.
create index if not exists activity_links_candidate on public.activity_links(candidate_id) where candidate_id is not null;
create index if not exists task_links_candidate on public.task_links(candidate_id) where candidate_id is not null;
create index if not exists job_candidates_candidate_open on public.job_candidates(candidate_id) where closed_at is null;

-- Postgres refuses to change a function's return type in place, so this is a drop and recreate rather
-- than a create-or-replace. The revoke/grant pair at the bottom must be reissued with the new
-- argument list or the function comes back reachable by anon.
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer);
-- The new signature too, so re-running this migration against a database that already has it is a
-- no-op rather than a "function already exists" failure.
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text);

create function public.search_candidates_page(
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
  p_offset integer default 0,
  p_queue text default null
) returns table(
  id uuid,organization_id uuid,full_name text,current_company text,current_position text,location text,
  linkedin_url text,status text,source text,availability text,owner_member_id uuid,created_at timestamptz,
  updated_at timestamptz,consent_status text,owner_name text,tag_names text[],skill_names text[],
  has_cv boolean,last_activity_at timestamptz,next_task_at timestamptz,next_task_title text,
  open_job_count integer,primary_job_id uuid,primary_job_title text,primary_stage_name text,
  primary_phase_key text,primary_stage_entered_at timestamptz,total_count bigint
) language sql stable security invoker set search_path=public as $$
  -- The page is selected FIRST, and the display laterals join onto only those rows.
  --
  -- Lateral joins are evaluated for every row surviving WHERE, before ORDER BY and LIMIT. The two
  -- pre-existing laterals (tags, skills) were already paying that across the whole filtered set; six
  -- of them over 100k candidates to display 50 would not have been viable. Splitting the query caps
  -- every lateral at one page and makes the original two dramatically cheaper as a side effect.
  --
  -- Queue predicates cannot move out here with the laterals -- they filter, so they must run before
  -- the limit. They are EXISTS subqueries in the WHERE below, which the planner short-circuits
  -- against the three indexes above. WHERE uses EXISTS; SELECT uses laterals.
  -- candidate_private_details and candidate_search_documents stay here because the p_query predicate
  -- filters on private.email/phone and search.search_vector. organization_members and profiles do NOT:
  -- they were only ever resolving owner_name for display, and the owner FILTER uses c.owner_member_id
  -- directly. Resolving a display name across the whole filtered set was costing ~19 seconds on 20k
  -- candidates -- the profiles RLS policy carries a correlated SubPlan over organization_members, so
  -- every candidate row dragged that behind it. owner_name is now resolved per page, below.
  with page as (
    select c.id,c.organization_id,c.full_name,c.current_company,c.current_position,c.location,c.linkedin_url,
      c.status,c.source,c.availability,c.owner_member_id,c.created_at,c.updated_at,private.consent_status,
      (search.candidate_id is not null) as has_cv,
      count(*) over() as total_count
    from public.candidates c
    left join public.candidate_private_details private on private.candidate_id=c.id
    left join public.candidate_search_documents search on search.candidate_id=c.id and search.organization_id=c.organization_id
    where c.organization_id=p_organization_id and c.deleted_at is null
      and public.has_permission(p_organization_id,'candidates.read')
      and (nullif(trim(p_query),'') is null
        or c.full_name ilike '%'||trim(p_query)||'%'
        or c.current_company ilike '%'||trim(p_query)||'%'
        or c.current_position ilike '%'||trim(p_query)||'%'
        or private.email ilike '%'||trim(p_query)||'%'
        or (trim(p_query) ~ '[0-9]' and regexp_replace(coalesce(private.phone,''),'[^0-9]','','g') ilike '%'||regexp_replace(trim(p_query),'[^0-9]','','g')||'%')
        or search.search_vector @@ websearch_to_tsquery('simple'::regconfig,trim(p_query)))
      and (nullif(p_status,'') is null or c.status=p_status)
      and (nullif(trim(p_location),'') is null or c.location ilike '%'||trim(p_location)||'%')
      and (nullif(trim(p_source),'') is null or c.source ilike '%'||trim(p_source)||'%')
      and (p_owner_member_id is null or c.owner_member_id=p_owner_member_id)
      and (nullif(trim(p_tag),'') is null or exists(select 1 from public.candidate_tags ct join public.tags t on t.id=ct.tag_id where ct.candidate_id=c.id and t.name ilike '%'||trim(p_tag)||'%'))
      and (nullif(trim(p_skill),'') is null or exists(select 1 from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where cs.candidate_id=c.id and s.name ilike '%'||trim(p_skill)||'%'))
      and (nullif(trim(p_availability),'') is null or c.availability ilike '%'||trim(p_availability)||'%')
      and (nullif(p_consent_status,'') is null or private.consent_status=p_consent_status)
      -- Named queues. Deliberately non-overlapping in intent: needs_follow_up is "something is owed",
      -- stale is "nothing is owed and nothing is happening" -- the genuinely dropped ones. Owner is
      -- excluded from needs_enrichment so it cannot duplicate unassigned. An unrecognised value
      -- matches nothing rather than everything, so a typo fails closed.
      --
      -- CASE, not `p_queue is null or (...)`. OR is not a short-circuit operator in Postgres -- the
      -- planner reorders its arms by cost, so the EXISTS subqueries were being evaluated per row even
      -- when no queue was selected. Measured on 20k candidates: the OR form cost ~950ms on every
      -- unfiltered page load; CASE is defined to evaluate only the arm it selects and gives that back.
      and case
        when nullif(trim(p_queue),'') is null then true
        when p_queue='in_process' then exists(
          select 1 from public.job_candidates jc where jc.candidate_id=c.id and jc.closed_at is null)
        when p_queue='needs_follow_up' then exists(
          select 1 from public.task_links tl join public.tasks t on t.id=tl.task_id
          where tl.candidate_id=c.id and t.deleted_at is null and t.status in ('open','in_progress')
            and t.due_at is not null and t.due_at < date_trunc('day',now())+interval '1 day')
        when p_queue='stale' then
          exists(select 1 from public.job_candidates jc where jc.candidate_id=c.id and jc.closed_at is null)
          and not exists(
            select 1 from public.task_links tl join public.tasks t on t.id=tl.task_id
            where tl.candidate_id=c.id and t.deleted_at is null and t.status in ('open','in_progress'))
          -- 21 days: long enough that a candidate mid-conversation is not called stale, short
          -- enough that a dropped one surfaces inside a month.
          and coalesce((
            select max(a.occurred_at) from public.activity_links al
            join public.activities a on a.id=al.activity_id where al.candidate_id=c.id
          ),c.created_at) < now()-interval '21 days'
        when p_queue='unassigned' then c.owner_member_id is null
        when p_queue='needs_enrichment' then
          not exists(select 1 from public.candidate_skills cs where cs.candidate_id=c.id)
          or search.candidate_id is null
          or nullif(trim(coalesce(c.current_position,'')),'') is null
        else false
      end
    -- Paired with the ORDER BY at the bottom of this function. The outer query re-sorts the page
    -- because a join never promises to preserve input order; both chains must stay identical.
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
  )
  select page.id,page.organization_id,page.full_name,page.current_company,page.current_position,page.location,
    page.linkedin_url,page.status,page.source,page.availability,page.owner_member_id,page.created_at,
    page.updated_at,page.consent_status,owner_info.owner_name,
    coalesce(tags.names,'{}'::text[]) as tag_names,coalesce(skills.names,'{}'::text[]) as skill_names,
    page.has_cv,activity.last_activity_at,next_task.next_task_at,next_task.next_task_title,
    coalesce(pipeline.open_job_count,0) as open_job_count,
    primary_job.job_id as primary_job_id,primary_job.job_title as primary_job_title,
    primary_job.stage_name as primary_stage_name,primary_job.phase_key as primary_phase_key,
    primary_job.stage_entered_at as primary_stage_entered_at,
    page.total_count
  from page
  left join lateral (
    select coalesce(nullif(trim(profile.full_name),''),profile.email) as owner_name
    from public.organization_members owner
    left join public.profiles profile on profile.id=owner.user_id
    where owner.id=page.owner_member_id
  ) owner_info on true
  left join lateral (
    select array_agg(tag.name order by tag.name) as names
    from public.candidate_tags candidate_tag join public.tags tag on tag.id=candidate_tag.tag_id
    where candidate_tag.candidate_id=page.id
  ) tags on true
  left join lateral (
    select array_agg(skill.name order by skill.name) as names
    from public.candidate_skills candidate_skill join public.skills skill on skill.id=candidate_skill.skill_id
    where candidate_skill.candidate_id=page.id
  ) skills on true
  left join lateral (
    select max(a.occurred_at) as last_activity_at
    from public.activity_links al join public.activities a on a.id=al.activity_id
    where al.candidate_id=page.id
  ) activity on true
  left join lateral (
    select t.due_at as next_task_at,t.title as next_task_title
    from public.task_links tl join public.tasks t on t.id=tl.task_id
    where tl.candidate_id=page.id and t.deleted_at is null and t.status in ('open','in_progress')
      and t.due_at is not null
    order by t.due_at asc limit 1
  ) next_task on true
  left join lateral (
    select count(*)::integer as open_job_count
    from public.job_candidates jc where jc.candidate_id=page.id and jc.closed_at is null
  ) pipeline on true
  -- A candidate can sit in several jobs at once, so "the" pipeline needs a defined tiebreak: the most
  -- recently updated open one. open_job_count carries the rest, which is what lets the UI say
  -- "Acme -- Interview +2 more" without a second query.
  left join lateral (
    select jc.job_id,j.title as job_title,ps.name as stage_name,ps.phase_key,
      coalesce(sh.occurred_at,jc.added_at) as stage_entered_at
    from public.job_candidates jc
    join public.jobs j on j.id=jc.job_id
    left join public.pipeline_stages ps on ps.id=jc.current_stage_id
    left join lateral (
      select max(occurred_at) as occurred_at from public.stage_history where job_candidate_id=jc.id
    ) sh on true
    where jc.candidate_id=page.id and jc.closed_at is null
    order by jc.updated_at desc limit 1
  ) primary_job on true
  order by
    case when p_sort='name' and p_direction='asc' then lower(page.full_name) end asc,
    case when p_sort='name' and p_direction='desc' then lower(page.full_name) end desc,
    case when p_sort='location' and p_direction='asc' then lower(page.location) end asc nulls last,
    case when p_sort='location' and p_direction='desc' then lower(page.location) end desc nulls last,
    case when p_sort='created' and p_direction='asc' then page.created_at end asc,
    case when p_sort='created' and p_direction='desc' then page.created_at end desc,
    case when p_sort='updated' and p_direction='asc' then page.updated_at end asc,
    page.updated_at desc,page.id
$$;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) to authenticated;

-- Every table the new joins read carries its own permission-scoped RLS policy (job_candidates, jobs,
-- pipeline_stages and stage_history behind jobs.read; activities and activity_links behind
-- activities.read; tasks and task_links behind tasks.read). Because this function is security
-- invoker, a member holding candidates.read but not jobs.read gets NULLs in the pipeline columns
-- rather than somebody else's data -- the degradation is automatic, not something the UI enforces.
comment on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) is
  'Candidate list with follow-up, pipeline and data-quality signals. Workflow columns degrade to NULL for members lacking jobs.read/tasks.read/activities.read because the function is security invoker.';
