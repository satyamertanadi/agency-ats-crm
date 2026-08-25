-- Cross-job delivery: one operational view of everything that has been sent to a client.
--
-- The workspace already manages submissions well INSIDE one job -- JobSubmissionsRail shows the
-- package, whether the link is live, and whether the client opened it. What has never existed is the
-- view across jobs, which is the one a consultant actually works from: "what have I sent that is
-- waiting, failing, or answered and not yet acted on". Today raises a couple of these as work items,
-- but only as isolated rows built client-side from four separate list queries.
--
-- Three things happen here.
--
-- 1. AN EXPLICIT HANDLED STATE on client feedback. Nothing in the schema could say "I have read this
--    and acted on it". The tempting shortcut is to infer it from a stage move, which is wrong twice
--    over: a rejection needs handling and produces no stage move, and a stage move can happen for
--    reasons that have nothing to do with the client's answer. So it is recorded, not guessed.
--
-- 2. ONE SQL SOURCE OF TRUTH for the delivery state and its urgency. The state is derived from
--    facts that already exist -- the email delivery row, the review link, the feedback row, the
--    package status -- and is never stored, so it cannot drift from the records it summarises. Two
--    functions rather than one because the ordering is a pure function of the state name: they
--    cannot disagree, and both are callable on their own, which is what makes the ladder and its
--    boundaries testable without building a full fixture per case.
--
-- 3. A PAGINATED LIST RPC. The state ladder has to be evaluated before ORDER BY and LIMIT, so this
--    cannot be a client-side filter over an unbounded listSubmissionPackages -- which is exactly
--    what Today does today and why its cost grows with the whole history of the workspace.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Handled state
-- ---------------------------------------------------------------------------------------------

alter table public.submission_feedback
  add column if not exists handled_at timestamptz,
  -- ON DELETE SET NULL rather than cascade: removing a departed colleague's auth user must not
  -- delete the client's answer, and "handled by someone who has since left" is still handled.
  add column if not exists handled_by uuid references auth.users(id) on delete set null;

comment on column public.submission_feedback.handled_at is
  'When a consultant recorded that this client answer has been acted on. Never inferred from a stage move -- a rejection needs handling and produces no stage move.';

-- ---------------------------------------------------------------------------------------------
-- 2. The state ladder
-- ---------------------------------------------------------------------------------------------

/* The waiting threshold, in calendar days.
 *
 * Calendar days rather than elapsed hours: a shortlist sent at 17:00 on Monday is "sent yesterday"
 * on Tuesday morning to the person who sent it, and a threshold that disagreed with that reading
 * would make the queue feel arbitrary. Three is a first-pilot value, chosen because it is the point
 * at which a consultant starts chasing by hand; it is fixed here rather than configurable because a
 * per-workspace setting nobody has evidence to tune is a setting nobody will tune.
 *
 * Exposed as a function so the UI copy, the SQL and the tests all name the same number instead of
 * three independent literals that drift.
 */
create or replace function public.submission_delivery_waiting_days()
returns integer language sql immutable set search_path=public as $$
  select 3
$$;
revoke all on function public.submission_delivery_waiting_days() from public,anon;
grant execute on function public.submission_delivery_waiting_days() to authenticated;

/* The ladder. Exactly one arm matches, and the arms are ordered so that each one may assume every
 * arm above it failed.
 *
 * The order here is RESOLUTION order, not urgency order -- 'handled' is checked early because a
 * closed package or an acted-on answer is a finished thread, and every arm below it is written on
 * the assumption that no feedback is outstanding. Urgency lives in submission_delivery_priority
 * below, where 'handled' correctly ranks last. Conflating the two would either make a handled item
 * unclearable (it would keep matching "waiting") or make a failed email invisible.
 *
 * `stable` rather than `immutable`: date_trunc over timestamptz reads the session TimeZone.
 */
create or replace function public.submission_delivery_state(
  p_email_status text,
  p_link_revoked_at timestamptz,
  p_link_expires_at timestamptz,
  p_link_opened_at timestamptz,
  p_sent_at timestamptz,
  p_feedback_at timestamptz,
  p_handled_at timestamptz,
  p_package_status text,
  p_now timestamptz
) returns text language sql stable set search_path=public as $$
  select case
    -- Finished, by an explicit human act. Checked first so a closed package or a handled answer can
    -- never reappear under Needs attention because its link has since expired -- a queue that cannot
    -- be cleared is a queue people stop reading.
    when coalesce(p_package_status,'')='closed' then 'handled'
    when p_feedback_at is not null and p_handled_at is not null then 'handled'
    -- The client never received it. Worst state there is: nothing downstream of this is meaningful.
    when p_email_status in ('failed','bounced','suppressed') then 'failed'
    -- Answered and not yet acted on.
    when p_feedback_at is not null then 'feedback_received'
    -- The door closed before they answered. Revoked or expired are the same problem to the
    -- consultant -- the client cannot open it -- and both are fixed by sending a fresh link.
    when p_link_revoked_at is not null then 'link_unavailable'
    when p_link_expires_at is not null and p_link_expires_at<=p_now then 'link_unavailable'
    -- From here down there is no feedback and the link still works.
    when p_link_opened_at is not null
      and date_trunc('day',p_link_opened_at)<=date_trunc('day',p_now)-make_interval(days=>public.submission_delivery_waiting_days())
      then 'awaiting_feedback'
    when p_link_opened_at is null and p_sent_at is not null
      and date_trunc('day',p_sent_at)<=date_trunc('day',p_now)-make_interval(days=>public.submission_delivery_waiting_days())
      then 'not_opened'
    else 'waiting'
  end
$$;
revoke all on function public.submission_delivery_state(text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz) from public,anon;
grant execute on function public.submission_delivery_state(text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz) to authenticated;

/* Urgency. A pure function of the state name, which is what makes "the list is ordered by how bad it
 * is" a property of the data rather than of whoever wrote the ORDER BY.
 *
 * An unrecognised state sorts last rather than first: a future state added to the ladder and
 * forgotten here should sink quietly, not claim the top of every consultant's queue. */
create or replace function public.submission_delivery_priority(p_state text)
returns integer language sql immutable set search_path=public as $$
  select case p_state
    when 'failed' then 1
    when 'link_unavailable' then 2
    when 'feedback_received' then 3
    when 'awaiting_feedback' then 4
    when 'not_opened' then 5
    when 'waiting' then 6
    when 'handled' then 7
    else 99
  end
$$;
revoke all on function public.submission_delivery_priority(text) from public,anon;
grant execute on function public.submission_delivery_priority(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Reading a colleague's delivery status
-- ---------------------------------------------------------------------------------------------

/* email_deliveries has two SELECT policies today: organization.manage, and "rows I requested
 * myself". Neither serves a cross-job delivery view -- a consultant in Team view would see every
 * failure they caused and none of anyone else's, which makes "Needs attention" quietly wrong in the
 * one state that matters most.
 *
 * This adds a third, deliberately narrow: rows for a CLIENT SUBMISSION are readable by members with
 * submissions.read. The status of a shortlist email is workspace operational data about a package
 * those members can already read in full. Invitation and calendar-failure deliveries are untouched
 * and stay behind organization.manage, because those are about people rather than about work. */
drop policy if exists email_deliveries_submission_read on public.email_deliveries;
create policy email_deliveries_submission_read on public.email_deliveries
  for select to authenticated using (
    email_type='client_submission' and public.has_permission(organization_id,'submissions.read')
  );

-- ---------------------------------------------------------------------------------------------
-- 4. Join keys
-- ---------------------------------------------------------------------------------------------

/* Every index below is a JOIN KEY for a lateral that runs once per submission in the organisation --
 * the state has to exist before the list can be ordered by it, so these laterals cannot be deferred
 * to a single page the way search_candidates_page defers its display laterals. Without them each one
 * degrades to a sequential scan per row, which is quadratic in the number of submissions rather than
 * slow-but-linear. None of them is a speculative covering index; there is one per lateral and
 * nothing more, and the sort keys are the tiebreaks the laterals actually use. */
create index if not exists candidate_submissions_org_created
  on public.candidate_submissions(organization_id,created_at desc);
create index if not exists public_submission_links_package
  on public.public_submission_links(package_id,created_at desc);
create index if not exists submission_feedback_submission
  on public.submission_feedback(candidate_submission_id,created_at desc);
create index if not exists email_deliveries_client_submission
  on public.email_deliveries(related_entity_id,created_at desc) where email_type='client_submission';

-- ---------------------------------------------------------------------------------------------
-- 5. The list
-- ---------------------------------------------------------------------------------------------

drop function if exists public.list_delivery_workbench(uuid,text,uuid,text,integer,integer);

/* One row per candidate_submission, not per package.
 *
 * A package holding four candidates is four separate conversations with the client -- they can
 * approve one, reject one and answer nothing about the other two -- so a package-grained row would
 * have to invent a single state for four different answers. The same candidate sent to two clients
 * is likewise two rows, because two clients owe two replies.
 *
 * plpgsql + EXECUTE ... USING rather than a `language sql` body, for the reason measured and
 * documented at length in 20260818000000: a static sql body is planned once with its arguments as
 * parameters, so an INACTIVE optional filter cannot be constant-folded away and is evaluated for
 * every row. Every value is bound through USING; nothing is concatenated into the statement.
 */
create function public.list_delivery_workbench(
  p_organization_id uuid,
  -- One of the quick views: needs_attention | waiting | feedback_received | handled. Anything else
  -- (including null) means all. Deliberately a GROUP rather than a single state name: the table's
  -- State column names the precise state, but a consultant filters by what they intend to do next,
  -- and two vocabularies for one concept is how a filter and a tab start disagreeing.
  p_state text default null,
  p_owner_member_id uuid default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table(
  candidate_submission_id uuid,
  package_id uuid,
  job_id uuid,
  job_candidate_id uuid,
  candidate_id uuid,
  candidate_name text,
  job_title text,
  company_name text,
  package_title text,
  sent_at timestamptz,
  recipient_email text,
  link_id uuid,
  link_expires_at timestamptz,
  link_revoked_at timestamptz,
  opened_at timestamptz,
  email_delivery_id uuid,
  email_status text,
  email_error text,
  feedback_id uuid,
  feedback_decision text,
  feedback_at timestamptz,
  handled_at timestamptz,
  owner_member_id uuid,
  owner_name text,
  delivery_state text,
  delivery_priority integer,
  total_count bigint
) language plpgsql stable security invoker set search_path=public as $fn$
begin
  return query execute $q$
    with resolved as (
      select cs.id as candidate_submission_id,
        cs.package_id,
        p.job_id,
        cs.job_candidate_id,
        jc.candidate_id,
        cand.full_name as candidate_name,
        j.title as job_title,
        co.name as company_name,
        p.title as package_title,
        p.created_at as sent_at,
        link.recipient_email,
        link.id as link_id,
        link.expires_at as link_expires_at,
        link.revoked_at as link_revoked_at,
        link.last_accessed_at as opened_at,
        delivery.id as email_delivery_id,
        delivery.status as email_status,
        delivery.error_message as email_error,
        feedback.id as feedback_id,
        feedback.decision as feedback_decision,
        feedback.created_at as feedback_at,
        feedback.handled_at,
        -- The job-candidate owner is who is actually working this person on this job; the job owner
        -- is the fallback because an unassigned pipeline row is still somebody's problem. Resolving
        -- the DISPLAY name is left to a lateral over the page below, for the reason 20260818000000
        -- documents: the profiles RLS policy carries a correlated SubPlan that every row would drag.
        coalesce(jc.owner_member_id,j.owner_member_id) as owner_member_id,
        public.submission_delivery_state(
          delivery.status,link.revoked_at,link.expires_at,link.last_accessed_at,
          p.created_at,feedback.created_at,feedback.handled_at,p.status,now()
        ) as delivery_state
      from public.candidate_submissions cs
      join public.submission_packages p on p.id=cs.package_id
      join public.jobs j on j.id=p.job_id
      left join public.companies co on co.id=j.company_id
      join public.job_candidates jc on jc.id=cs.job_candidate_id
      left join public.candidates cand on cand.id=jc.candidate_id
      -- Normally exactly one link per package (create_submission_package makes both together, and a
      -- replacement is a new package). Ordered anyway so a workspace that somehow has two gets a
      -- defined answer rather than whichever the planner happened to return.
      left join lateral (
        select l.id,l.recipient_email,l.expires_at,l.revoked_at,l.last_accessed_at
        from public.public_submission_links l
        where l.package_id=p.id
        order by l.created_at desc limit 1
      ) link on true
      left join lateral (
        select d.id,d.status,d.error_message
        from public.email_deliveries d
        where d.email_type='client_submission' and d.related_entity_id=p.id
        order by d.created_at desc limit 1
      ) delivery on true
      -- Feedback is unique per (link,candidate_submission), so a package that was resent under a new
      -- link could carry two answers for one candidate. The most recent is the client's position.
      left join lateral (
        select f.id,f.decision,f.created_at,f.handled_at
        from public.submission_feedback f
        where f.candidate_submission_id=cs.id
        order by f.created_at desc limit 1
      ) feedback on true
      where cs.organization_id=$1
        and public.has_permission($1,'submissions.read')
        -- A draft package was never sent, so it is not a delivery. Nothing in the product currently
        -- writes 'draft' after creation, but the CHECK constraint allows it and a workbench that
        -- listed unsent shortlists would be lying in its own title.
        and p.status<>'draft'
        and ($2 is null or coalesce(jc.owner_member_id,j.owner_member_id)=$2)
        and (nullif(trim($3),'') is null
          or cand.full_name ilike '%'||trim($3)||'%'
          or j.title ilike '%'||trim($3)||'%'
          or co.name ilike '%'||trim($3)||'%'
          or p.title ilike '%'||trim($3)||'%')
    ), filtered as (
      select resolved.*,
        public.submission_delivery_priority(resolved.delivery_state) as delivery_priority,
        count(*) over() as total_count
      from resolved
      -- The quick views, as one server-side predicate. CASE rather than a chain of ORs because OR is
      -- not short-circuiting in Postgres and the planner is free to evaluate every arm.
      where case
        when $4='needs_attention' then resolved.delivery_state in ('failed','link_unavailable','feedback_received','awaiting_feedback','not_opened')
        when $4='waiting' then resolved.delivery_state='waiting'
        when $4='feedback_received' then resolved.delivery_state='feedback_received'
        when $4='handled' then resolved.delivery_state='handled'
        else true
      end
    )
    select filtered.candidate_submission_id,filtered.package_id,filtered.job_id,
      filtered.job_candidate_id,filtered.candidate_id,filtered.candidate_name,filtered.job_title,
      filtered.company_name,filtered.package_title,filtered.sent_at,filtered.recipient_email,
      filtered.link_id,filtered.link_expires_at,filtered.link_revoked_at,filtered.opened_at,
      filtered.email_delivery_id,filtered.email_status,filtered.email_error,filtered.feedback_id,
      filtered.feedback_decision,filtered.feedback_at,filtered.handled_at,filtered.owner_member_id,
      owner_info.owner_name,filtered.delivery_state,filtered.delivery_priority,filtered.total_count
    from filtered
    left join lateral (
      select coalesce(nullif(trim(profile.full_name),''),profile.email) as owner_name
      from public.organization_members owner
      left join public.profiles profile on profile.id=owner.user_id
      where owner.id=filtered.owner_member_id
    ) owner_info on true
    -- Urgency first, then most recently sent. Stable across pages by construction: the id tiebreak
    -- means two submissions sent in the same transaction cannot swap between page 1 and page 2.
    order by filtered.delivery_priority asc,filtered.sent_at desc,filtered.candidate_submission_id
    limit least(greatest($5,1),200) offset greatest($6,0)
  $q$
  using p_organization_id,p_owner_member_id,p_query,p_state,p_limit,p_offset;
end $fn$;

revoke all on function public.list_delivery_workbench(uuid,text,uuid,text,integer,integer) from public,anon;
grant execute on function public.list_delivery_workbench(uuid,text,uuid,text,integer,integer) to authenticated;

comment on function public.list_delivery_workbench(uuid,text,uuid,text,integer,integer) is
  'Cross-job client-delivery queue, one row per candidate_submission, ordered by submission_delivery_priority then sent date. Security invoker, so it degrades by permission rather than leaking: without submissions.read it returns nothing at all; without jobs.read the rows disappear (submission_packages, jobs and job_candidates are inner joins, and a delivery whose job cannot be read is not a delivery this member can act on); without candidates.read the candidate name is null (a left join) while the row itself stays, because knowing a shortlist is failing is useful even when the person in it is not visible.';

-- ---------------------------------------------------------------------------------------------
-- 6. Marking a client answer handled
-- ---------------------------------------------------------------------------------------------

/* SECURITY DEFINER for one reason, and it is the same reason revoke_submission_link is:
 * 20260808040000 revoked INSERT on audit_logs from authenticated outright, so an invoker-rights
 * function cannot write the evidence for its own action. The permission check below is therefore
 * doing real work rather than restating what RLS would have enforced, which is why it is the first
 * statement after the lookup and why the lookup is by id alone -- finding the row and then refusing
 * it keeps "wrong organisation" and "no permission" indistinguishable to the caller.
 */
create or replace function public.set_submission_feedback_handled(p_feedback_id uuid,p_handled boolean default true)
returns public.submission_feedback language plpgsql security definer set search_path=public as $$
declare entry public.submission_feedback;
begin
  select * into entry from public.submission_feedback where id=p_feedback_id;
  if entry.id is null or not public.has_permission(entry.organization_id,'submissions.write') then
    raise exception 'Client feedback not found';
  end if;
  update public.submission_feedback
    set handled_at=case when p_handled then now() else null end,
        handled_by=case when p_handled then auth.uid() else null end
    where id=entry.id
    returning * into entry;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(entry.organization_id,auth.uid(),
      case when p_handled then 'submission_feedback.handled' else 'submission_feedback.reopened' end,
      'submission_feedback',entry.id,
      -- Ids and the decision only. The client's free-text comment is the one thing on this row that
      -- must never be copied into the permanent ledger.
      jsonb_build_object('candidate_submission_id',entry.candidate_submission_id,'decision',entry.decision));
  return entry;
end $$;
revoke all on function public.set_submission_feedback_handled(uuid,boolean) from public,anon;
grant execute on function public.set_submission_feedback_handled(uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. A changed answer is a new answer
-- ---------------------------------------------------------------------------------------------

/* submit_submission_feedback upserts on (link_id,candidate_submission_id): a client who opens the
 * review link again and changes their mind updates the existing row in place rather than adding a
 * second one. That is the right behaviour for the client, and it is exactly the case that would
 * break the handled state introduced above -- a package marked handled on a "reject" would still
 * read as handled after the client came back and chose "interview", so the new answer would never
 * appear in anyone's queue. The two lines added to the ON CONFLICT clause clear it.
 *
 * The function is otherwise reproduced verbatim from 20260726010000, including its revoke/grant
 * pair. That pair is not decoration: `create or replace` preserves the previous ACL, and this repo
 * has shipped the regression of dropping it three times (see the header of that migration).
 */
create or replace function public.submit_submission_feedback(p_token text,p_candidate_submission_id uuid,p_decision text,p_comments text default null,p_reviewer_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; submission public.candidate_submissions; feedback_id uuid; jc public.job_candidates; package_owner uuid;
begin
  if p_decision not in ('approve','reject','interview','hold') then raise exception 'Invalid decision'; end if;
  if length(coalesce(p_comments,'')) > 4000 then raise exception 'comments_too_long' using errcode='22023'; end if;
  if length(coalesce(p_reviewer_name,'')) > 120 then raise exception 'reviewer_name_too_long' using errcode='22023'; end if;
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then raise exception 'Link not found'; end if;
  if (select count(*) from public.submission_link_events where link_id=link.id and event_type='feedback' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited' using errcode='P0001'; end if;
  select * into submission from public.candidate_submissions where id=p_candidate_submission_id and package_id=link.package_id;
  if submission.id is null then raise exception 'Candidate not found'; end if;
  insert into public.submission_feedback(organization_id,link_id,candidate_submission_id,decision,comments,reviewer_name)
  values(link.organization_id,link.id,submission.id,p_decision,p_comments,p_reviewer_name)
  on conflict(link_id,candidate_submission_id) do update set decision=excluded.decision,comments=excluded.comments,reviewer_name=excluded.reviewer_name,
    -- A revised answer has not been acted on, whatever was true of the answer it replaces.
    handled_at=null,handled_by=null,
    updated_at=now() returning id into feedback_id;
  insert into public.submission_link_events(link_id,event_type,ip_hash) values(link.id,'feedback',public.request_ip_hash());

  select * into jc from public.job_candidates where id=submission.job_candidate_id;
  -- The reviewer is an anonymous client, so auth.uid() is null here; attribute to whoever sent it.
  select created_by into package_owner from public.submission_packages where id=link.package_id;
  perform public.log_activity(link.organization_id,'client_feedback',
    coalesce(nullif(p_comments,''),coalesce(p_reviewer_name,'The client')||' selected '||p_decision),
    format('Client feedback: %s',p_decision),'inbound',package_owner,
    jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id),jsonb_build_object('job_id',jc.job_id),jsonb_build_object('candidate_submission_id',submission.id)));
  return jsonb_build_object('ok',true,'feedback_id',feedback_id);
end $$;

revoke all on function public.submit_submission_feedback(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_submission_feedback(text,uuid,text,text,text) to service_role;

commit;
