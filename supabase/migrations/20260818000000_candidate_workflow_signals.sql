-- Workflow signals on the candidate list -- and the fix for why that list already could not scale.
--
-- Two things happen here.
--
-- 1. THE SIGNALS. search_candidates_page returned 18 columns and every one was an attribute: who the
--    person is, never what is happening with them. This adds last activity, next task, active
--    pipeline + stage + time-in-stage, and whether a CV exists, plus a named-queue filter.
--
-- 2. THE SCALING FIX, which is the more important half. Measured on staging with a seeded
--    organisation, against the function as it exists in production today:
--
--        1,000 candidates    190ms
--        5,000 candidates   47.8s
--       20,000 candidates    >60s
--
--    The authenticated role's statement_timeout is 8s, so the Candidates page has been failing
--    outright -- not merely feeling slow -- for any organisation past a couple of thousand
--    candidates. That is a small agency, not a large one.
--
--    Root cause, found by measuring rather than reading: a `language sql` function body is planned
--    once with its arguments as parameters. The eight optional filters are all written as
--    `(<param> is null or <column> matches <param>)`. With a literal, Postgres constant-folds the
--    branch away at plan time and the predicate disappears. With a parameter it cannot, so every
--    inactive filter -- including two EXISTS subqueries, an ILIKE against candidate_private_details,
--    a regexp_replace pair over phone numbers, and a full-text match -- is evaluated for every row in
--    the organisation on every page load. Same body, same function, 20k rows:
--
--       all arguments as literals      633ms
--       all arguments as parameters  22,529ms
--
--    plan_cache_mode='force_custom_plan' does not help; `language sql` bodies do not re-plan per call.
--    Moving the body into plpgsql and running it through EXECUTE ... USING gives a one-shot plan per
--    call, where the values ARE known at planning time and the inactive branches fold away as they
--    would with literals. 20,000 candidates now returns in ~1.7s.
--
--    The SQL string below is a fixed literal. Nothing is concatenated into it; all fifteen values are
--    bound through USING, so this is not a SQL-injection surface.
--
-- candidates.last_contacted_at is deliberately NOT used anywhere here. The column exists but nothing
-- in the codebase has ever written to it, so reading it would render a permanently blank column.
-- Last contact is derived from activities instead.

-- Three lookups this query now depends on, none of which had an index. job_candidates has
-- unique(job_id,candidate_id), which does not serve a lookup keyed on candidate_id alone.
create index if not exists activity_links_candidate on public.activity_links(candidate_id) where candidate_id is not null;
create index if not exists task_links_candidate on public.task_links(candidate_id) where candidate_id is not null;
create index if not exists job_candidates_candidate_open on public.job_candidates(candidate_id) where closed_at is null;

-- Return type and language both change, so this is a drop and recreate. The revoke/grant pair at the
-- bottom must be reissued with the new argument list or the function comes back reachable by anon.
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer);
-- The new signature too, so re-running this migration is a no-op rather than a failure.
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
) language plpgsql stable security invoker set search_path=public as $fn$
begin
  return query execute $q$
    -- The page is selected FIRST; the display laterals join onto only those rows.
    --
    -- Lateral joins are evaluated for every row surviving WHERE, before ORDER BY and LIMIT. The two
    -- pre-existing laterals (tags, skills) were already paying that across the whole filtered set --
    -- measured at loops=20007 to display 50 rows. Splitting the query caps every lateral at one page
    -- and makes the original two dramatically cheaper as a side effect.
    --
    -- organization_members and profiles are deliberately NOT joined here. They only ever resolved
    -- owner_name for display, and the owner FILTER uses c.owner_member_id directly. Resolving a
    -- display name across the whole filtered set cost ~19s on 20k rows, because the profiles RLS
    -- policy carries a correlated SubPlan that every candidate row then dragged behind it.
    -- candidate_private_details and candidate_search_documents DO stay, because the query filter
    -- reads private.email/phone and search.search_vector.
    with page as (
      select c.id,c.organization_id,c.full_name,c.current_company,c.current_position,c.location,
        c.linkedin_url,c.status,c.source,c.availability,c.owner_member_id,c.created_at,c.updated_at,
        private.consent_status,
        (search.candidate_id is not null) as has_cv,
        count(*) over() as total_count
      from public.candidates c
      left join public.candidate_private_details private on private.candidate_id=c.id
      left join public.candidate_search_documents search on search.candidate_id=c.id and search.organization_id=c.organization_id
      where c.organization_id=$1 and c.deleted_at is null
        and public.has_permission($1,'candidates.read')
        and (nullif(trim($2),'') is null
          or c.full_name ilike '%'||trim($2)||'%'
          or c.current_company ilike '%'||trim($2)||'%'
          or c.current_position ilike '%'||trim($2)||'%'
          or private.email ilike '%'||trim($2)||'%'
          or (trim($2) ~ '[0-9]' and regexp_replace(coalesce(private.phone,''),'[^0-9]','','g') ilike '%'||regexp_replace(trim($2),'[^0-9]','','g')||'%')
          or search.search_vector @@ websearch_to_tsquery('simple'::regconfig,trim($2)))
        and (nullif($3,'') is null or c.status=$3)
        and (nullif(trim($4),'') is null or c.location ilike '%'||trim($4)||'%')
        and (nullif(trim($5),'') is null or c.source ilike '%'||trim($5)||'%')
        and ($6 is null or c.owner_member_id=$6)
        and (nullif(trim($7),'') is null or exists(select 1 from public.candidate_tags ct join public.tags t on t.id=ct.tag_id where ct.candidate_id=c.id and t.name ilike '%'||trim($7)||'%'))
        and (nullif(trim($8),'') is null or exists(select 1 from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where cs.candidate_id=c.id and s.name ilike '%'||trim($8)||'%'))
        and (nullif(trim($9),'') is null or c.availability ilike '%'||trim($9)||'%')
        and (nullif($10,'') is null or private.consent_status=$10)
        -- Named queues. Deliberately non-overlapping in intent: needs_follow_up is "something is
        -- owed", stale is "nothing is owed and nothing is happening" -- the genuinely dropped ones.
        -- Owner is excluded from needs_enrichment so it cannot duplicate unassigned. An unrecognised
        -- value matches nothing rather than everything, so a typo fails closed.
        --
        -- CASE rather than `$15 is null or (...)`: OR is not a short-circuit operator in Postgres, so
        -- the planner is free to reorder its arms and was evaluating these EXISTS subqueries per row
        -- even with no queue selected. CASE is defined to evaluate only the arm it selects.
        and case
          when nullif(trim($15),'') is null then true
          when $15='in_process' then exists(
            select 1 from public.job_candidates jc where jc.candidate_id=c.id and jc.closed_at is null)
          when $15='needs_follow_up' then exists(
            select 1 from public.task_links tl join public.tasks t on t.id=tl.task_id
            where tl.candidate_id=c.id and t.deleted_at is null and t.status in ('open','in_progress')
              and t.due_at is not null and t.due_at < date_trunc('day',now())+interval '1 day')
          when $15='stale' then
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
          when $15='unassigned' then c.owner_member_id is null
          when $15='needs_enrichment' then
            not exists(select 1 from public.candidate_skills cs where cs.candidate_id=c.id)
            or search.candidate_id is null
            or nullif(trim(coalesce(c.current_position,'')),'') is null
          else false
        end
      -- Paired with the ORDER BY at the bottom. The outer query re-sorts the page because a join
      -- never promises to preserve input order; both chains must stay identical.
      order by
        case when $11='name' and $12='asc' then lower(c.full_name) end asc,
        case when $11='name' and $12='desc' then lower(c.full_name) end desc,
        case when $11='location' and $12='asc' then lower(c.location) end asc nulls last,
        case when $11='location' and $12='desc' then lower(c.location) end desc nulls last,
        case when $11='created' and $12='asc' then c.created_at end asc,
        case when $11='created' and $12='desc' then c.created_at end desc,
        case when $11='updated' and $12='asc' then c.updated_at end asc,
        c.updated_at desc,c.id
      limit least(greatest($13,1),5000) offset greatest($14,0)
    )
    select page.id,page.organization_id,page.full_name,page.current_company,page.current_position,
      page.location,page.linkedin_url,page.status,page.source,page.availability,page.owner_member_id,
      page.created_at,page.updated_at,page.consent_status,owner_info.owner_name,
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
    -- A candidate can sit in several jobs at once, so "the" pipeline needs a defined tiebreak: the
    -- most recently updated open one. open_job_count carries the rest, which is what lets the UI say
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
      case when $11='name' and $12='asc' then lower(page.full_name) end asc,
      case when $11='name' and $12='desc' then lower(page.full_name) end desc,
      case when $11='location' and $12='asc' then lower(page.location) end asc nulls last,
      case when $11='location' and $12='desc' then lower(page.location) end desc nulls last,
      case when $11='created' and $12='asc' then page.created_at end asc,
      case when $11='created' and $12='desc' then page.created_at end desc,
      case when $11='updated' and $12='asc' then page.updated_at end asc,
      page.updated_at desc,page.id
  $q$
  using p_organization_id,p_query,p_status,p_location,p_source,p_owner_member_id,p_tag,p_skill,
        p_availability,p_consent_status,p_sort,p_direction,p_limit,p_offset,p_queue;
end $fn$;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) to authenticated;

-- Every table the new joins read carries its own permission-scoped RLS policy (job_candidates, jobs,
-- pipeline_stages and stage_history behind jobs.read; activities and activity_links behind
-- activities.read; tasks and task_links behind tasks.read). Because this function is security
-- invoker -- which plpgsql preserves exactly as the sql version did -- a member holding
-- candidates.read but not jobs.read gets NULLs in the pipeline columns rather than somebody else's
-- data. The degradation is automatic, not something the UI has to enforce.
comment on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text) is
  'Candidate list with follow-up, pipeline and data-quality signals. Runs through EXECUTE so each call gets a one-shot plan: a static sql body could not constant-fold the eight optional filters and evaluated every inactive one per row, which made the page time out past ~2k candidates. Workflow columns degrade to NULL for members lacking jobs.read/tasks.read/activities.read because the function is security invoker.';
