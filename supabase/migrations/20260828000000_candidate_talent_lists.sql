-- Talent Lists: the pool somebody CHOSE, held separately from the pool a query happens to return.
--
-- Saved views already answer "who matches these filters right now". That is a question, re-asked on
-- every page load, and its answer changes underneath you: a view called "Jakarta finance directors"
-- silently gains whoever was added this morning and loses whoever changed their location. Useful,
-- and the wrong tool for the other half of the work -- the eleven people a consultant read through,
-- judged, and decided are the shortlist for this search. That set is a DECISION, and a decision that
-- rewrites itself is not one.
--
-- So: static membership, recorded once, changing only when a person changes it.
--
-- Four decisions shape this migration.
--
-- 1. TWO TABLES, NOT A jsonb ARRAY ON THE LIST. Membership is a row, which is what makes "who added
--    this candidate, and when" answerable, makes the unique constraint enforce idempotency in the
--    database rather than in whichever caller remembered to check, and lets the candidate list
--    filter be an index lookup instead of a containment scan over a growing array.
--
-- 2. NO DIRECT WRITE POLICIES. Every write goes through an audited SECURITY DEFINER RPC, so these
--    tables have SELECT policies and nothing else -- an INSERT reaching the table directly is denied
--    by default rather than by a policy that has to restate the ownership rule a second time. The
--    definer rights exist for one reason: 20260808040000 revoked INSERT on audit_logs from
--    authenticated, so an invoker-rights function cannot write the evidence for its own action. Same
--    reason as set_submission_feedback_handled, and the permission checks inside are therefore doing
--    real work rather than restating RLS.
--
-- 3. VISIBILITY IS TWO VALUES, NOT A SHARING MATRIX. private means the owner; workspace means anyone
--    who can read candidates. Editing stays with the owner (and organization.manage) in both cases.
--    A per-list collaborator table is the kind of thing that is easy to add later and impossible to
--    remove once somebody depends on it, and no evidence yet says anyone needs it.
--
-- 4. A LIST NEVER GRANTS ANYTHING. Membership is an organising fact and carries no permission: it
--    does not make a do-not-contact candidate contactable, it does not bypass the pipeline rules that
--    stop them being added to a job, and it does not widen who can read the record. A curated list of
--    people you are not allowed to approach is still a legitimate thing to keep -- what it must never
--    become is a side door around the restriction.
--
-- Called Talent Lists, in the UI and here. Not "tearsheets": borrowing a competitor's jargon for a
-- concept the user already has a word for buys nothing and costs every new consultant an explanation.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. The list, and what is on it
-- ---------------------------------------------------------------------------------------------

create table if not exists public.candidate_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The member, not the auth user, matching saved_views and every other owned artifact here. A
  -- member id is already organisation-scoped, so ownership cannot accidentally cross a workspace.
  owner_member_id uuid not null references public.organization_members(id),
  name text not null check(length(btrim(name)) between 1 and 80),
  description text check(length(description)<=400),
  visibility text not null default 'private' check(visibility in ('private','workspace')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /* Archived rather than deleted. A shortlist is evidence of work done -- which eleven people were
   * put in front of which client, and when -- and the request behind "delete this list" is almost
   * always "stop showing it to me". Nothing here hard-deletes; the row and its membership stay
   * readable to whoever needs to answer that question later. */
  archived_at timestamptz
);

/* One live list per name per owner, case-insensitively.
 *
 * Scoped to the OWNER rather than the organisation: two consultants both keeping a list called
 * "Hot candidates" is normal and harmless, and a global constraint would make the second one fail
 * for a reason they cannot see or fix. Archived lists are excluded, so archiving frees the name --
 * otherwise "Q3 shortlist" would be unusable forever because a finished one exists. */
create unique index if not exists candidate_lists_owner_name
  on public.candidate_lists(organization_id,owner_member_id,lower(btrim(name)))
  where archived_at is null;

/* The list picker reads exactly this: live lists in one organisation. */
create index if not exists candidate_lists_org_live
  on public.candidate_lists(organization_id,archived_at);

create table if not exists public.candidate_list_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  list_id uuid not null references public.candidate_lists(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  /* ON DELETE SET NULL for the same reason submission_feedback.handled_by is: removing a departed
   * colleague's membership row must not silently empty the lists they curated. "Added by someone who
   * has since left" is still a fact about when this person entered the list. */
  added_by_member_id uuid references public.organization_members(id) on delete set null,
  added_at timestamptz not null default now(),
  /* Idempotency, enforced where it cannot be forgotten. add_candidates_to_list relies on this rather
   * than on a pre-check, so two consultants adding the same candidate in the same second produce one
   * row and one "already there" rather than a duplicate or a lost write. It is also the index the
   * list filter in search_candidates_page probes, which is why there is no second index on list_id. */
  unique(list_id,candidate_id)
);

comment on table public.candidate_lists is
  'A static, curated pool of candidates. Deliberately not a saved view: a saved view is a query re-run on every load, this is a decision recorded once. Membership never grants permission -- see candidate_list_members.';
comment on table public.candidate_list_members is
  'One row per candidate on one list. Membership is an organising fact and confers nothing: it does not make a do-not-contact candidate contactable, does not bypass pipeline restrictions, and does not widen who may read the record.';

-- ---------------------------------------------------------------------------------------------
-- 2. Who can see a list
-- ---------------------------------------------------------------------------------------------

alter table public.candidate_lists enable row level security;
alter table public.candidate_list_members enable row level security;

/* SELECT policies only, deliberately. Writes arrive through the audited RPCs below, so an INSERT or
 * UPDATE that reaches these tables directly is denied by the absence of a policy rather than by one
 * that restates the ownership rule a second time and can drift from the function enforcing it. */
drop policy if exists candidate_lists_read on public.candidate_lists;
create policy candidate_lists_read on public.candidate_lists for select to authenticated
  using (
    public.has_permission(organization_id,'candidates.read')
    and (
      visibility='workspace'
      or owner_member_id in (
        select m.id from public.organization_members m
        where m.organization_id=candidate_lists.organization_id and m.user_id=auth.uid()
      )
    )
  );

/* Membership follows its list exactly. Written as an EXISTS against candidate_lists rather than as a
 * copy of the visibility rule, so there is one definition of "can this person see this list" and a
 * change to it cannot leave the members behind still readable. */
drop policy if exists candidate_list_members_read on public.candidate_list_members;
create policy candidate_list_members_read on public.candidate_list_members for select to authenticated
  using (
    public.has_permission(organization_id,'candidates.read')
    and exists(
      select 1 from public.candidate_lists l
      where l.id=candidate_list_members.list_id
        and (
          l.visibility='workspace'
          or l.owner_member_id in (
            select m.id from public.organization_members m
            where m.organization_id=l.organization_id and m.user_id=auth.uid()
          )
        )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 3. Resolving a list for a write
-- ---------------------------------------------------------------------------------------------

/* The shared preamble of every write below: find the list, decide whether this caller may change it,
 * and refuse indistinguishably if not.
 *
 * By id ALONE, with the organisation read off the row rather than passed in. Taking an organisation
 * argument and comparing it would let a caller learn which of the two facts they got wrong; looking
 * the row up and then refusing keeps "no such list", "another workspace's list" and "not yours" the
 * same answer.
 *
 * Editing is owner-or-admin. A workspace list is READABLE by the whole workspace and still editable
 * only by the person who curated it, which is the shape saved_views settled on -- shared does not
 * mean communal, and a shortlist a colleague can silently rewrite is not a shortlist.
 */
create or replace function public.candidate_list_for_write(p_list_id uuid)
returns public.candidate_lists language plpgsql stable security definer set search_path=public as $$
declare list public.candidate_lists;
begin
  select * into list from public.candidate_lists where id=p_list_id;
  if list.id is null then raise exception 'Talent list not found'; end if;
  if not public.has_permission(list.organization_id,'candidates.read') then
    raise exception 'Talent list not found';
  end if;
  if not (
    list.owner_member_id in (
      select m.id from public.organization_members m
      where m.organization_id=list.organization_id and m.user_id=auth.uid() and m.status='active'
    )
    or public.has_permission(list.organization_id,'organization.manage')
  ) then
    raise exception 'Talent list not found';
  end if;
  return list;
end $$;
revoke all on function public.candidate_list_for_write(uuid) from public,anon,authenticated;

comment on function public.candidate_list_for_write(uuid) is
  'Internal helper: resolves a talent list for a write and refuses indistinguishably when it does not exist, belongs to another organisation, or belongs to another member. Granted to no role -- it is called from the definer-rights RPCs below, which run as the function owner.';

-- ---------------------------------------------------------------------------------------------
-- 4. Creating, renaming, archiving
-- ---------------------------------------------------------------------------------------------

create or replace function public.create_candidate_list(
  p_organization_id uuid,
  p_name text,
  p_description text default null,
  p_visibility text default 'private'
) returns public.candidate_lists language plpgsql security definer set search_path=public as $$
declare list public.candidate_lists; member_id uuid;
begin
  if not public.has_permission(p_organization_id,'candidates.read') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if coalesce(p_visibility,'private') not in ('private','workspace') then
    raise exception 'invalid_visibility' using errcode='22023';
  end if;
  /* The caller's own membership, never a parameter. A list is owned by the person who made it, and
   * an owner argument would be a way to create a "private" list in somebody else's name. */
  select m.id into member_id from public.organization_members m
  where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active';
  if member_id is null then raise exception 'permission_denied' using errcode='42501'; end if;

  insert into public.candidate_lists(organization_id,owner_member_id,name,description,visibility)
  values(p_organization_id,member_id,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),coalesce(p_visibility,'private'))
  returning * into list;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'candidate_list.created','candidate_list',list.id,
    jsonb_build_object('visibility',list.visibility));
  return list;
exception when unique_violation then
  raise exception 'duplicate_list_name' using errcode='23505';
end $$;
revoke all on function public.create_candidate_list(uuid,text,text,text) from public,anon;
grant execute on function public.create_candidate_list(uuid,text,text,text) to authenticated;

/* Null means "leave alone", which is what lets the management modal send one field without having to
 * resend the other two and risk clobbering a change made in another tab. */
create or replace function public.update_candidate_list(
  p_list_id uuid,
  p_name text default null,
  p_description text default null,
  p_visibility text default null
) returns public.candidate_lists language plpgsql security definer set search_path=public as $$
declare list public.candidate_lists;
begin
  list:=public.candidate_list_for_write(p_list_id);
  if p_visibility is not null and p_visibility not in ('private','workspace') then
    raise exception 'invalid_visibility' using errcode='22023';
  end if;
  update public.candidate_lists set
    name=coalesce(nullif(btrim(coalesce(p_name,'')),''),name),
    /* An empty string is a real instruction here, unlike for the name: clearing a description is
     * something people do, and there is no other way to say it. A null still means "leave alone". */
    description=case when p_description is null then description else nullif(btrim(p_description),'') end,
    visibility=coalesce(p_visibility,visibility),
    updated_at=now()
  where id=list.id
  returning * into list;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(list.organization_id,auth.uid(),'candidate_list.updated','candidate_list',list.id,
    jsonb_build_object('visibility',list.visibility));
  return list;
exception when unique_violation then
  raise exception 'duplicate_list_name' using errcode='23505';
end $$;
revoke all on function public.update_candidate_list(uuid,text,text,text) from public,anon;
grant execute on function public.update_candidate_list(uuid,text,text,text) to authenticated;

/* One function for both directions rather than an archive and an unarchive, for the reason
 * set_submission_feedback_handled gives: it is one fact with two values, and a pair of functions
 * would be two places to keep the audit action in step. */
create or replace function public.set_candidate_list_archived(p_list_id uuid,p_archived boolean default true)
returns public.candidate_lists language plpgsql security definer set search_path=public as $$
declare list public.candidate_lists;
begin
  list:=public.candidate_list_for_write(p_list_id);
  update public.candidate_lists
    set archived_at=case when p_archived then now() else null end,updated_at=now()
    where id=list.id
    returning * into list;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(list.organization_id,auth.uid(),
    case when p_archived then 'candidate_list.archived' else 'candidate_list.restored' end,
    'candidate_list',list.id,jsonb_build_object('visibility',list.visibility));
  return list;
exception when unique_violation then
  /* Restoring can collide: the name was freed while the list was archived and somebody took it. */
  raise exception 'duplicate_list_name' using errcode='23505';
end $$;
revoke all on function public.set_candidate_list_archived(uuid,boolean) from public,anon;
grant execute on function public.set_candidate_list_archived(uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Membership
-- ---------------------------------------------------------------------------------------------

/* Adding a batch. Returns what happened rather than merely succeeding.
 *
 * `added` and `skipped` are separate because they are different outcomes to the person who pressed
 * the button: "12 added" and "3 were already on this list" is information, and a single "done" for
 * both is the kind of quiet vagueness that makes people re-check by hand. This is the same contract
 * runBulk gives every other batch action in the product.
 *
 * A candidate that does not resolve to a live record in the LIST's organisation raises rather than
 * being skipped. Skipping would turn a cross-tenant id -- the one case that genuinely matters -- into
 * a number in a toast nobody reads. The UI only ever passes ids it just rendered, so this fires on a
 * bug or on tampering, and both should be loud.
 *
 * Deliberately NOT filtered by status: a do-not-contact or archived candidate can go on an internal
 * list, keeps every warning it already carries, and is still refused by the pipeline and outreach
 * rules that own those decisions. A list is a note about people, not a licence to approach them.
 */
create or replace function public.add_candidates_to_list(p_list_id uuid,p_candidate_ids uuid[])
returns table(added integer,skipped integer) language plpgsql security definer set search_path=public as $$
declare list public.candidate_lists; wanted integer; inserted integer; member_id uuid;
begin
  list:=public.candidate_list_for_write(p_list_id);
  select m.id into member_id from public.organization_members m
  where m.organization_id=list.organization_id and m.user_id=auth.uid() and m.status='active';

  -- Distinct first: the same id twice in one call is the caller's duplicate, not the list's, and
  -- counting it as "skipped" would report a collision that never happened.
  select count(*)::integer into wanted
  from (select distinct unnest(coalesce(p_candidate_ids,'{}'::uuid[])) as candidate_id) ids;
  if wanted=0 then added:=0; skipped:=0; return next; return; end if;

  if exists(
    select 1 from unnest(p_candidate_ids) as requested(candidate_id)
    where not exists(
      select 1 from public.candidates c
      where c.id=requested.candidate_id and c.organization_id=list.organization_id and c.deleted_at is null
    )
  ) then
    raise exception 'candidate_not_in_organization' using errcode='42501';
  end if;

  with ids as (select distinct unnest(p_candidate_ids) as candidate_id),
  inserted_rows as (
    insert into public.candidate_list_members(organization_id,list_id,candidate_id,added_by_member_id)
    select list.organization_id,list.id,ids.candidate_id,member_id from ids
    -- The unique constraint is the idempotency, not a pre-check: two people adding the same
    -- candidate in the same second produce one row and one "already there".
    on conflict(list_id,candidate_id) do nothing
    returning 1
  )
  select count(*)::integer into inserted from inserted_rows;

  update public.candidate_lists set updated_at=now() where id=list.id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(list.organization_id,auth.uid(),'candidate_list.members_added','candidate_list',list.id,
    -- Counts, never the candidate ids. The permanent ledger records that a curation happened and how
    -- large it was; who is on a list is answerable from the list itself.
    jsonb_build_object('added',inserted,'requested',wanted));

  added:=inserted; skipped:=wanted-inserted; return next;
end $$;
revoke all on function public.add_candidates_to_list(uuid,uuid[]) from public,anon;
grant execute on function public.add_candidates_to_list(uuid,uuid[]) to authenticated;

/* Removing. `skipped` here means "was not on the list", which is the same shape as adding and is
 * likewise not an error -- removing someone twice is a person clicking twice, not a failure. */
create or replace function public.remove_candidates_from_list(p_list_id uuid,p_candidate_ids uuid[])
returns table(removed integer,skipped integer) language plpgsql security definer set search_path=public as $$
declare list public.candidate_lists; wanted integer; gone integer;
begin
  list:=public.candidate_list_for_write(p_list_id);
  select count(*)::integer into wanted
  from (select distinct unnest(coalesce(p_candidate_ids,'{}'::uuid[])) as candidate_id) ids;
  if wanted=0 then removed:=0; skipped:=0; return next; return; end if;

  with deleted_rows as (
    delete from public.candidate_list_members
    where list_id=list.id and candidate_id=any(p_candidate_ids)
    returning 1
  )
  select count(*)::integer into gone from deleted_rows;

  update public.candidate_lists set updated_at=now() where id=list.id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(list.organization_id,auth.uid(),'candidate_list.members_removed','candidate_list',list.id,
    jsonb_build_object('removed',gone,'requested',wanted));

  removed:=gone; skipped:=wanted-gone; return next;
end $$;
revoke all on function public.remove_candidates_from_list(uuid,uuid[]) from public,anon;
grant execute on function public.remove_candidates_from_list(uuid,uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Reading the lists
-- ---------------------------------------------------------------------------------------------

/* SECURITY INVOKER, so the two read policies above are the only definition of who sees what and this
 * function offers no second opinion. The owner display name comes from a lateral for the reason
 * 20260818000000 documents at length: the profiles RLS policy carries a correlated SubPlan, and
 * joining it directly makes every row drag it.
 *
 * Unpaginated, and that is a considered exception to the rule that every list is paginated. This one
 * fills a picker: it is bounded by how many lists a workspace's members have deliberately created, a
 * number in the tens, and a picker that pages is a picker nobody finds anything in. It is also why
 * archived lists are excluded by default -- the natural bound stays natural only if finished lists
 * leave it.
 */
create or replace function public.list_candidate_lists(
  p_organization_id uuid,
  p_include_archived boolean default false
) returns table(
  id uuid,organization_id uuid,owner_member_id uuid,owner_name text,name text,description text,
  visibility text,member_count integer,created_at timestamptz,updated_at timestamptz,archived_at timestamptz
) language sql stable security invoker set search_path=public as $$
  select l.id,l.organization_id,l.owner_member_id,owner_info.owner_name,l.name,l.description,
    l.visibility,coalesce(members.member_count,0) as member_count,l.created_at,l.updated_at,l.archived_at
  from public.candidate_lists l
  left join lateral (
    select coalesce(nullif(btrim(profile.full_name),''),profile.email) as owner_name
    from public.organization_members owner
    left join public.profiles profile on profile.id=owner.user_id
    where owner.id=l.owner_member_id
  ) owner_info on true
  left join lateral (
    -- Counts what the CALLER can see, because candidate_list_members is read through RLS here. A
    -- member who cannot read candidates sees no lists at all, so this never becomes a way to learn
    -- the size of something you cannot open.
    select count(*)::integer as member_count
    from public.candidate_list_members lm where lm.list_id=l.id
  ) members on true
  where l.organization_id=p_organization_id
    and (coalesce(p_include_archived,false) or l.archived_at is null)
  order by l.archived_at nulls first,lower(l.name),l.id
$$;
revoke all on function public.list_candidate_lists(uuid,boolean) from public,anon;
grant execute on function public.list_candidate_lists(uuid,boolean) to authenticated;

comment on function public.list_candidate_lists(uuid,boolean) is
  'Talent lists visible to the caller, with membership counts. Security invoker: private lists belonging to other members are absent because the SELECT policy excludes them, not because this function filters them out.';

/* Which of one candidate's lists this caller can see. Reads through the same policies, so a private
 * list belonging to a colleague is simply not in the answer.
 *
 * Exists so the add-to-list picker can show what is already true without fetching every list's full
 * membership to work it out client-side. */
create or replace function public.candidate_list_memberships(p_organization_id uuid,p_candidate_id uuid)
returns table(list_id uuid,name text,visibility text) language sql stable security invoker set search_path=public as $$
  select l.id as list_id,l.name,l.visibility
  from public.candidate_list_members lm
  join public.candidate_lists l on l.id=lm.list_id
  where lm.organization_id=p_organization_id and lm.candidate_id=p_candidate_id and l.archived_at is null
  order by lower(l.name),l.id
$$;
revoke all on function public.candidate_list_memberships(uuid,uuid) from public,anon;
grant execute on function public.candidate_list_memberships(uuid,uuid) to authenticated;


-- ---------------------------------------------------------------------------------------------
-- 7. Filtering the candidate list by one Talent List
-- ---------------------------------------------------------------------------------------------

/* Both functions gain the same argument, and both are dropped and recreated rather than replaced.
 * A changed argument list produces a NEW pg_proc row carrying Postgres's own default ACL (EXECUTE to
 * PUBLIC), so the revoke/grant pair at the bottom of each is not decoration -- see the header of
 * 20260726020000 for the three times this repo has shipped that regression.
 *
 * Both bodies are reproduced from 20260827000000 with the list predicate added and nothing else
 * changed.
 */
drop function if exists public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text);
drop function if exists public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text);

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
  p_issue text default null,
  /* Which Talent List, or null for the whole database.
   *
   * Last in the argument list because it is the newest, and a uuid rather than a name because a list
   * is a record, not a filter value -- two members may each keep a "Hot candidates", and a name would
   * make the same URL mean different things for different people.
   *
   * NOT a queue and NOT a saved-view key. A queue is a rule the product owns, a saved view is a set
   * of filters somebody named, and this is a set of PEOPLE somebody chose. Folding it into either
   * would make a static decision behave like a query. */
  p_list uuid default null
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
        /* Membership of a Talent List. CASE for the third time and for the third time the same
         * reason: with no list chosen, a plain OR would leave the planner free to probe
         * candidate_list_members for every candidate in the organisation.
         *
         * Read through RLS, because this function is security invoker -- so a list id naming another
         * member's PRIVATE list, or another workspace entirely, matches no membership rows and yields
         * an empty page. A hand-edited ?list= is therefore inert rather than informative: it cannot
         * distinguish "this list is empty" from "this list is not yours", which is what stops it
         * becoming a way to probe for lists you cannot see. */
        and case
          when $17 is null then true
          else exists(
            select 1 from public.candidate_list_members lm
            where lm.list_id=$17 and lm.candidate_id=c.id)
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
        p_availability,p_consent_status,p_sort,p_direction,p_limit,p_offset,p_queue,p_issue,p_list;
end $fn$;

revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text,uuid) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text,uuid) to authenticated;

comment on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer,text,text,uuid) is
  'Candidate list with follow-up, pipeline and data-quality signals. Runs through EXECUTE so each call gets a one-shot plan: a static sql body could not constant-fold the optional filters and evaluated every inactive one per row, which made the page time out past ~2k candidates. Workflow columns degrade to NULL for members lacking jobs.read/tasks.read/activities.read, and quality_issue_codes omits missing_contact_method for members lacking candidates_private.read, because the function is security invoker. p_list narrows the page to one Talent List and is read through RLS on the same terms, so another member's private list matches nothing rather than erroring.';

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
 *
 * It DOES take the Talent List, added here alongside the list filter itself. A list is a narrowing of
 * the population like any other, and a strip counting the whole database while the rows behind it
 * showed one curated list would break the single property this function exists to hold: press
 * "No CV (12)" and get twelve rows.
 */
create function public.candidate_quality_summary(
  p_organization_id uuid,
  p_query text default null,
  p_status text default null,
  p_location text default null,
  p_source text default null,
  p_owner_member_id uuid default null,
  p_tag text default null,
  p_skill text default null,
  p_availability text default null,
  p_list uuid default null
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
        -- The ninth filter's tenth sibling. Same CASE, same reason, same RLS: a list the caller
        -- cannot see counts nothing, exactly as it lists nothing.
        and case
          when $10 is null then true
          else exists(
            select 1 from public.candidate_list_members lm
            where lm.list_id=$10 and lm.candidate_id=c.id)
        end
    ) codes
    group by issue
    order by issue
  $q$
  using p_organization_id,p_query,p_status,p_location,p_source,p_owner_member_id,p_tag,p_skill,p_availability,p_list;
end $fn$;

revoke all on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text,uuid) to authenticated;

comment on function public.candidate_quality_summary(uuid,text,text,text,text,uuid,text,text,text,uuid) is
  'Counts by data-quality issue over the same filtered population the candidate list is showing, so a count in the strip and the rows behind it cannot disagree. Deliberately does not take the issue filter: a count taken after the choice was applied would always read as the number already on screen. Takes the Talent List filter, so the strip and the rows agree inside a curated list too.';

commit;
