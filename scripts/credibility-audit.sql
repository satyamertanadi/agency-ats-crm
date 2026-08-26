-- Production credibility audit. READ ONLY.
--
-- Every statement below is a SELECT. Nothing here updates, deletes, anonymizes or archives anything,
-- and it must stay that way: this file is meant to be run against a live client database by someone
-- who has not read it. Remediation is a separate, reviewed step -- see docs/credibility-audit.md.
--
-- What it is for. A workspace being shown to a prospect had a scraped sentence sitting where a
-- candidate's name should be, fake executives from a fixture run, a team member called "Production
-- release verifier", 24 unassigned overdue tasks, four ownerless jobs, a client marked lost that
-- still carried an open job and pipeline value, and fee figures that could not be right. None of
-- those is a bug in the product. Every one of them is a reason a demo goes badly.
--
-- Usage:
--   psql "$PRODUCTION_DATABASE_URL" -v org="'<organization-uuid>'" -f scripts/credibility-audit.sql
--
-- Or for every organisation in the instance (the dedicated-instance deployment normally has one):
--   psql "$PRODUCTION_DATABASE_URL" -v org="null" -f scripts/credibility-audit.sql
--
-- Output is one row per finding: check_name, severity, entity_type, entity_id, detail. entity_id is
-- what a remediation runbook acts on; detail is what a human reads to decide whether it should be.
--
-- Severity is advice, not policy:
--   high    -- visible to a client, or a contradiction the product will keep acting on
--   medium  -- operationally wrong; someone is not being told about work that is theirs
--   low     -- worth a look before a demo
--
-- Nothing here rejects a legitimate international name or an unusual-but-real salary. Every check
-- FLAGS FOR REVIEW. A three-word Indonesian name, a Spanish name with four surnames and an IDR
-- figure in the billions are all normal here, and a rule that "cleaned" them would do more damage
-- than the mess it was pointed at.

\set ON_ERROR_STOP on
\timing off

\if :{?org}
\else
  \set org null
\endif

with scope as (
  select id as organization_id from public.organizations
  where :org::uuid is null or id = :org::uuid
),

-- ---------------------------------------------------------------------------------------------
-- 1. Names that are not names
-- ---------------------------------------------------------------------------------------------
-- Strong signals only, and each one is a thing that never appears in a person's name rather than a
-- guess about what names look like. Length and word count are set well beyond any real name:
-- "Maria del Carmen Fernandez de la Vega Sanz" is six words, so the threshold is nine.
sentence_names as (
  select 'sentence_like_name' as check_name,'high' as severity,'candidate' as entity_type,
    c.id as entity_id,
    format('%s (%s)', left(c.full_name, 120),
      case
        when c.full_name ~ '[0-9]' then 'contains digits'
        when c.full_name ~* '(https?://|www\.)' then 'contains a URL'
        when c.full_name like '%@%' then 'contains an email address'
        when length(c.full_name) > 100 then 'over 100 characters'
        when array_length(regexp_split_to_array(btrim(c.full_name), '\s+'), 1) > 9 then 'more than nine words'
        else 'reads as a sentence'
      end) as detail
  from public.candidates c join scope on scope.organization_id = c.organization_id
  where c.deleted_at is null
    and (
      c.full_name ~ '[0-9]'
      or c.full_name ~* '(https?://|www\.)'
      or c.full_name like '%@%'
      or length(c.full_name) > 100
      or array_length(regexp_split_to_array(btrim(c.full_name), '\s+'), 1) > 9
      -- Lowercase function words with spaces both sides: prose, not a name. Deliberately excludes
      -- the nobiliary particles that legitimately appear lowercase inside names (van, der, de, la,
      -- bin, binti, al) by listing only words that cannot be part of one.
      or c.full_name ~* '\s(is|was|has|the|and|with|for|that|which|his|her|their)\s'
    )
),

-- ---------------------------------------------------------------------------------------------
-- 2. Test, fixture and verifier identities
-- ---------------------------------------------------------------------------------------------
-- `.example` is the reliable one: scripts/generate-demo-data.mjs puts every fabricated address under
-- an RFC 2606 reserved domain precisely so fixtures can be identified later. The name patterns catch
-- records typed by hand during a verification run, which is where "Production release verifier"
-- came from.
test_candidates as (
  select 'test_identity' as check_name,'high','candidate',c.id,
    format('%s <%s>', left(c.full_name,80), coalesce(p.email,'no email'))
  from public.candidates c
  join scope on scope.organization_id = c.organization_id
  left join public.candidate_private_details p on p.candidate_id = c.id
  where c.deleted_at is null
    and (
      c.full_name ~* '(test|verifier|smoke|fixture|dummy|sample|lorem|qa run|do not use)'
      or p.email ~* '(@example\.(com|org|net)$|\.example$|@test\.|@localhost)'
    )
),
test_members as (
  select 'test_identity' as check_name,'high','organization_member',m.id,
    format('%s <%s> · %s', coalesce(pr.full_name,'(no name)'), coalesce(pr.email,'no email'), m.status)
  from public.organization_members m
  join scope on scope.organization_id = m.organization_id
  left join public.profiles pr on pr.id = m.user_id
  where coalesce(pr.full_name,'') ~* '(test|verifier|smoke|fixture|dummy|release)'
     or coalesce(pr.email,'') ~* '(@example\.(com|org|net)$|\.example$|@test\.)'
),

-- ---------------------------------------------------------------------------------------------
-- 3. Compensation and fee values that cannot be right
-- ---------------------------------------------------------------------------------------------
-- Relative to the workspace's own distribution per currency, never against a hardcoded number. An
-- IDR salary is seven digits larger than a USD one and both are correct; a threshold that did not
-- know which currency it was looking at would flag an entire Indonesian database.
--
-- Fewer than five comparable rows means there is no distribution to speak of, so no outlier claim is
-- made -- an early workspace should not have its first three salaries called implausible.
salary_stats as (
  select p.salary_currency as currency,
    percentile_cont(0.5) within group (order by p.current_salary) as median_salary,
    count(*) as sample
  from public.candidate_private_details p
  join public.candidates c on c.id = p.candidate_id
  join scope on scope.organization_id = c.organization_id
  where c.deleted_at is null and p.current_salary is not null and p.current_salary > 0
  group by p.salary_currency
),
salary_outliers as (
  select 'compensation_outlier' as check_name,'medium','candidate',c.id,
    format('%s · %s %s (workspace median %s; %sx)', left(c.full_name,60),
      coalesce(p.salary_currency,'?'), p.current_salary::numeric(20,0),
      s.median_salary::numeric(20,0), round(p.current_salary / nullif(s.median_salary,0), 1))
  from public.candidate_private_details p
  join public.candidates c on c.id = p.candidate_id
  join scope on scope.organization_id = c.organization_id
  join salary_stats s on s.currency is not distinct from p.salary_currency
  where c.deleted_at is null and s.sample >= 5 and p.current_salary is not null
    and (p.current_salary > s.median_salary * 25 or p.current_salary < s.median_salary / 25)
),
-- A negative or zero recorded salary is not an outlier, it is wrong.
salary_impossible as (
  select 'compensation_impossible' as check_name,'high','candidate',c.id,
    format('%s · recorded salary %s', left(c.full_name,60), p.current_salary::numeric(20,0))
  from public.candidate_private_details p
  join public.candidates c on c.id = p.candidate_id
  join scope on scope.organization_id = c.organization_id
  where c.deleted_at is null and p.current_salary is not null and p.current_salary <= 0
),
fee_impossible as (
  select 'fee_impossible' as check_name,'high','placement',pl.id,
    format('%s %s fee against %s %s salary',
      pl.currency, pl.placement_fee::numeric(20,0), pl.currency, pl.salary::numeric(20,0))
  from public.placements pl
  join scope on scope.organization_id = pl.organization_id
  -- A fee larger than the salary it is derived from, or a negative one. Both are contradictions
  -- rather than unusual commercial terms.
  where pl.placement_fee < 0 or (pl.salary > 0 and pl.placement_fee > pl.salary)
),
fee_percentage_impossible as (
  select 'fee_impossible' as check_name,'high','job',j.id,
    format('%s · fee percentage %s', left(j.title,60), j.placement_fee_percentage)
  from public.jobs j
  join scope on scope.organization_id = j.organization_id
  where j.deleted_at is null and j.placement_fee_percentage is not null
    and (j.placement_fee_percentage <= 0 or j.placement_fee_percentage > 100)
),

-- ---------------------------------------------------------------------------------------------
-- 4. Work nobody owns
-- ---------------------------------------------------------------------------------------------
-- Not a data-quality problem so much as an accountability one: an overdue task with no owner is
-- work the product is not telling anybody about. Today's organisation-wide queue shows these, and
-- after this release it no longer pretends they belong to whoever is looking.
unassigned_overdue_tasks as (
  select 'unassigned_overdue_task' as check_name,'medium','task',t.id,
    format('%s · due %s', left(t.title,70), to_char(t.due_at,'YYYY-MM-DD'))
  from public.tasks t join scope on scope.organization_id = t.organization_id
  where t.deleted_at is null and t.owner_member_id is null
    and t.status in ('open','in_progress') and t.due_at is not null and t.due_at < now()
),
unassigned_open_jobs as (
  select 'unassigned_open_job' as check_name,'medium','job',j.id,
    format('%s · opened %s', left(j.title,70), to_char(j.opened_at,'YYYY-MM-DD'))
  from public.jobs j join scope on scope.organization_id = j.organization_id
  where j.deleted_at is null and j.status = 'open' and j.owner_member_id is null
),

-- ---------------------------------------------------------------------------------------------
-- 5. States that contradict each other
-- ---------------------------------------------------------------------------------------------
-- A client marked lost or do-not-contact that still carries live work. The product will keep acting
-- on the open job -- surfacing it in Today, counting its value in the pipeline -- while the account
-- record says the relationship ended. One of the two is wrong and only a human knows which.
lost_clients_with_work as (
  select 'contradictory_client_state' as check_name,'high','company',co.id,
    format('%s · %s / %s · %s open job(s)', left(co.name,60), co.account_status,
      co.business_development_stage, count(j.id))
  from public.companies co
  join scope on scope.organization_id = co.organization_id
  join public.jobs j on j.company_id = co.id and j.deleted_at is null and j.status = 'open'
  where co.deleted_at is null
    and (co.business_development_stage = 'lost' or co.account_status in ('inactive','do_not_contact'))
  group by co.id, co.name, co.account_status, co.business_development_stage
),
-- An open job for a client with no agreement in force. Commercially this is work being done for
-- nothing agreed; it is the single most expensive thing on this list to discover late.
missing_commercial_terms as (
  select 'missing_commercial_terms' as check_name,'high','job',j.id,
    format('%s · %s · no active agreement', left(j.title,60), left(co.name,50))
  from public.jobs j
  join scope on scope.organization_id = j.organization_id
  join public.companies co on co.id = j.company_id
  where j.deleted_at is null and j.status = 'open'
    and not exists (
      select 1 from public.commercial_terms ct
      where ct.company_id = co.id
        and coalesce(ct.effective_to, 'infinity'::date) >= current_date
    )
),

-- ---------------------------------------------------------------------------------------------
-- 6. Fixture activity showing on customer-facing records
-- ---------------------------------------------------------------------------------------------
-- Short, contentless or placeholder journal entries. The activity feed is the most quoted surface in
-- a demo, and a line reading "asdf" undoes a great deal of careful work elsewhere.
nonsense_activities as (
  select 'nonsense_activity' as check_name,'medium','activity',a.id,
    format('%s · %s', a.activity_type, left(a.summary,70))
  from public.activities a join scope on scope.organization_id = a.organization_id
  where a.summary ~* '(lorem ipsum|asdf|qwerty|test test|xxx+|placeholder|todo:|fixme|^\s*test\s*$)'
     or length(btrim(a.summary)) < 4
)

select * from sentence_names
union all select * from test_candidates
union all select * from test_members
union all select * from salary_outliers
union all select * from salary_impossible
union all select * from fee_impossible
union all select * from fee_percentage_impossible
union all select * from unassigned_overdue_tasks
union all select * from unassigned_open_jobs
union all select * from lost_clients_with_work
union all select * from missing_commercial_terms
union all select * from nonsense_activities
order by
  case severity when 'high' then 0 when 'medium' then 1 else 2 end,
  check_name, detail;
