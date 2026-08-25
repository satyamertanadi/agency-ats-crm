-- Needs enrichment stops being a queue and becomes a reason.
--
-- The queue already existed and already worked: search_candidates_page could tell you which records
-- were missing a role, skills or a CV. What it could not tell you was WHICH of the three, on which
-- record -- so the consultant got a list of fifty candidates and no way to know whether each one
-- needed a two-second edit or a CV upload. The work was visible; the work to do was not.
--
-- Three decisions shape this migration.
--
-- 1. ISSUE CODES, NOT A SCORE. There is no persisted quality percentage and no "profile 60% complete"
--    bar. A score is unactionable by construction -- it says a record is worse without saying what is
--    wrong -- and a stored one drifts from the record the moment anybody edits it. The codes are
--    derived on every read from the columns themselves.
--
-- 2. ONE PREDICATE. The queue used to spell out three of its rules inline in the WHERE clause. That
--    meant the queue, any summary over it and any per-row display could each be right about a
--    different set of candidates. The queue is now exactly "cardinality(issues) > 0", and what counts
--    as an issue lives in public.candidate_quality_issues and nowhere else.
--
-- 3. A PERMISSION FLAG, NOT AN ABSENT VALUE. missing_contact_method means the record has neither an
--    email nor a phone. Those live in candidate_private_details behind candidates_private.read, and
--    RLS returns NULL for a member without it -- so reading the columns alone would report every
--    candidate as missing contact details to exactly the people who are not allowed to know. The
--    helper takes an explicit permission flag and omits the code entirely when it is false: an
--    absence you cannot see is not an absence you can report.
--
-- Deliberately NOT issues: salary, LinkedIn, portfolio, tags and source. More fields filled does not
-- automatically mean better data; sometimes it only means a more confidently decorated void. And
-- `unassigned` stays its own queue rather than becoming a sixth code, because it already has one --
-- two ways to say the same thing is how they come to disagree.

begin;

/* The rules, in one place, ordered for display.
 *
 * `immutable` and free of table access on purpose: every fact it needs is passed in, so it can be
 * called from a WHERE clause without the planner treating it as a barrier, and it can be tested
 * exhaustively by calling it with seven scalars instead of by building seven candidates.
 *
 * array_remove(...,null) rather than a filtered array constructor because a CASE with no ELSE yields
 * NULL, and an array with holes in it is not the same as a shorter array.
 */
create or replace function public.candidate_quality_issues(
  p_current_position text,
  p_location text,
  p_has_skills boolean,
  p_has_cv boolean,
  p_email text,
  p_phone text,
  /* True only when the caller holds candidates_private.read. False omits missing_contact_method
   * entirely -- see the header. Never defaulted: a call site that forgets it should fail to resolve,
   * not quietly start reporting a private absence. */
  p_can_read_private boolean
) returns text[] language sql immutable set search_path=public as $$
  select array_remove(array[
    case when nullif(trim(coalesce(p_current_position,'')),'') is null then 'missing_role' end,
    case when nullif(trim(coalesce(p_location,'')),'') is null then 'missing_location' end,
    case when not coalesce(p_has_skills,false) then 'missing_skills' end,
    case when not coalesce(p_has_cv,false) then 'missing_cv' end,
    -- BOTH absent. A candidate reachable by phone alone is reachable.
    case when coalesce(p_can_read_private,false)
      and nullif(trim(coalesce(p_email,'')),'') is null
      and nullif(trim(coalesce(p_phone,'')),'') is null
      then 'missing_contact_method' end
  ],null)
$$;
revoke all on function public.candidate_quality_issues(text,text,boolean,boolean,text,text,boolean) from public,anon;
grant execute on function public.candidate_quality_issues(text,text,boolean,boolean,text,text,boolean) to authenticated;

comment on function public.candidate_quality_issues(text,text,boolean,boolean,text,text,boolean) is
  'The single definition of what makes a candidate record unusable. Derived on every read, never stored: a persisted quality score drifts from the record the moment anyone edits it. missing_contact_method is omitted unless the caller holds candidates_private.read, because an absence you are not allowed to see is not an absence you can report.';

-- The return type and the argument list both change, so this is a drop and recreate. The revoke/grant
-- pair at the bottom must be reissued against the NEW signature or the function comes back reachable
-- by anon -- see the header of 20260726020000 for the three times this repo has shipped that.
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text);
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text);

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
  p_queue text default null,
  p_issue text default null
) returns table(
  id uuid,organization_id uuid,full_name text,current_company text,current_position text,location text,
  linkedin_url text,status text,source text,availability text,owner_member_id uuid,created_at timestamptz,
  updated_at timestamptz,consent_status text,owner_name text,tag_names text[],skill_names text[],
  has_cv boolean,last_activity_at timestamptz,next_task_at timestamptz,next_task_title text,
  open_job_count integer,primary_job_id uuid,primary_job_title text,primary_stage_name text,
  primary_phase_key text,primary_stage_entered_at timestamptz,
  quality_issue_codes text[],total_count bigint
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
        /* Carried purely to derive missing_contact_method below, and never returned. RLS on
         * candidate_private_details already nulls both for a member without candidates_private.read,
         * which is exactly why candidate_quality_issues takes an explicit permission flag: absent
         * because you cannot see it is not the same fact as absent because nobody filled it in. */
        private.email as private_email,private.phone as private_phone,
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
          /* One predicate, one definition. This used to spell out three of the five rules inline,
           * which meant the queue, the summary and the per-row badges could each be right about a
           * different set of candidates. The queue is now exactly "this record has at least one
           * issue", and what counts as an issue lives in candidate_quality_issues alone. */
          when $15='needs_enrichment' then cardinality(public.candidate_quality_issues(
            c.current_position,c.location,
            exists(select 1 from public.candidate_skills cs where cs.candidate_id=c.id),
            search.candidate_id is not null,
            private.email,private.phone,
            public.has_permission($1,'candidates_private.read')))>0
          else false
        end
        /* Narrowing the queue to ONE issue. CASE for the same reason the queue uses it: OR is not
         * short-circuiting in Postgres, so a plain `$16 is null or ...` would evaluate the skills
         * EXISTS for every row in the organisation even with no issue chosen.
         *
         * An unrecognised code matches nothing rather than everything, which is what makes a
         * hand-edited URL fail closed. missing_contact_method specifically returns nothing at all
         * for a member without candidates_private.read -- the code is never produced for them, so
         * filtering on it cannot become a way to infer who has no email. */
        and case
          when nullif(trim($16),'') is null then true
          else trim($16)=any(public.candidate_quality_issues(
            c.current_position,c.location,
            exists(select 1 from public.candidate_skills cs where cs.candidate_id=c.id),
            search.candidate_id is not null,
            private.email,private.phone,
            public.has_permission($1,'candidates_private.read')))
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
      /* Derived HERE, over the page, not in the CTE's target list: a subquery's target list is
       * evaluated against the rows entering the sort, so computing this there would have paid for
       * every candidate in the organisation to display fifty. `skills.names` is already aggregated
       * for the page by the lateral above, so has-skills costs nothing extra at this point. */
      public.candidate_quality_issues(
        page.current_position,page.location,skills.names is not null,page.has_cv,
        page.private_email,page.private_phone,
        public.has_permission($1,'candidates_private.read')) as quality_issue_codes,
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
        p_availability,p_consent_status,p_sort,p_direction,p_limit,p_offset,p_queue,p_issue;
end $fn$;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text) to authenticated;

comment on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text) is
  'Candidate list with follow-up, pipeline and data-quality signals. Runs through EXECUTE so each call gets a one-shot plan: a static sql body could not constant-fold the optional filters and evaluated every inactive one per row, which made the page time out past ~2k candidates. Workflow columns degrade to NULL for members lacking jobs.read/tasks.read/activities.read, and quality_issue_codes omits missing_contact_method for members lacking candidates_private.read, because the function is security invoker.';

/* Counts by issue, for the strip above the queue.
 *
 * Deliberately its own RPC rather than a second return column on the list: the counts are over the
 * WHOLE filtered set, not the page, and folding a whole-set aggregate into a paginated query means
 * either computing it fifty times or returning it fifty times.
 *
 * It takes the same eight filters as the list and NOT the issue filter, which is what makes the strip
 * honest: choosing "Missing CV (12)" must return twelve rows, and it would not if the count had been
 * taken after the choice was already applied.
 *
 * The needs_enrichment queue is implicit and needs no argument -- a candidate with no issues
 * contributes no rows to the unnest, so the aggregate is over exactly the queue's population.
 */
create or replace function public.candidate_quality_summary(
  p_organization_id uuid,
  p_query text default null,
  p_status text default null,
  p_location text default null,
  p_source text default null,
  p_owner_member_id uuid default null,
  p_tag text default null,
  p_skill text default null,
  p_availability text default null
) returns table(issue_code text,candidate_count bigint)
language plpgsql stable security invoker set search_path=public as $fn$
begin
  return query execute $q$
    select issue as issue_code,count(*)::bigint as candidate_count
    from (
      select unnest(public.candidate_quality_issues(
        c.current_position,c.location,
        exists(select 1 from public.candidate_skills cs where cs.candidate_id=c.id),
        search.candidate_id is not null,
        private.email,private.phone,
        public.has_permission($1,'candidates_private.read'))) as issue
      from public.candidates c
      left join public.candidate_private_details private on private.candidate_id=c.id
      left join public.candidate_search_documents search on search.candidate_id=c.id and search.organization_id=c.organization_id
      where c.organization_id=$1 and c.deleted_at is null
        and public.has_permission($1,'candidates.read')
        -- The same eight filters the list applies, in the same order and with the same trimming, so
        -- the strip counts the population the list is showing rather than the whole database.
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
    ) codes
    group by issue
    order by issue
  $q$
  using p_organization_id,p_query,p_status,p_location,p_source,p_owner_member_id,p_tag,p_skill,p_availability;
end $fn$;

revoke all on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text) from public,anon;
grant execute on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text) to authenticated;

comment on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text) is
  'Counts by data-quality issue over the same filtered population the candidate list is showing, so a count in the strip and the rows behind it cannot disagree. Deliberately does not take the issue filter: a count taken after the choice was applied would always read as the number already on screen.';

commit;
