-- Recording what happened and deciding what happens next, as one act.
--
-- These were already two good functions -- log_manual_activity and create_task_with_link -- and the
-- product made the consultant call them separately, from two different controls, in whichever order
-- they remembered. In practice they are one moment of work: the call ends, you write down what was
-- said, and you decide when to ring back. Splitting that across two dialogs is why the second half
-- is the half that gets skipped.
--
-- The important word is ATOMIC, and it is not decoration.
--
-- The obvious implementation is two round trips from the client: log the activity, then create the
-- task. That produces a specific, silent failure -- the activity lands, the task write is refused
-- (no tasks.write, an owner who has since been deactivated, a network drop), and the journal now
-- contains a note saying a call happened and a follow-up was booked, with no follow-up anywhere. The
-- consultant believes the next step is scheduled. Nothing in the product will ever tell them
-- otherwise. That is a worse outcome than refusing the whole thing, because it is indistinguishable
-- from success.
--
-- So both writes happen inside one function, which means one statement, which means one transaction:
-- if the task cannot be created, the activity is not created either, and the composer says so.
--
-- SECURITY INVOKER, deliberately. This function inserts nothing itself -- it calls two functions that
-- each carry their own permission check and their own definer rights. Making it definer would add a
-- third set of rights nobody needs and would move the tasks.write check somewhere the reader of
-- create_task_with_link cannot see it.

begin;

/* The follow-up is attached to the record the activity was filed against, never to a record chosen
 * separately -- that is what makes this one act rather than two that happen to run together.
 *
 * p_links is the activity's link array, whose first entry is the record whose feed the composer is
 * open on. task_links can only reference a candidate, company, contact or job, so the first link of
 * one of those types wins; an activity linked ONLY to a submission or a placement has no valid
 * follow-up target and is refused rather than quietly producing a task attached to nothing. A
 * follow-up that appears in Today linking nowhere is the kind of item people learn to ignore.
 */
create or replace function public.log_activity_with_follow_up(
  p_organization_id uuid,
  p_type text,
  p_summary text,
  p_subject text default null,
  p_direction text default null,
  p_occurred_at timestamptz default null,
  p_links jsonb default '[]'::jsonb,
  -- Null or blank means activity only. The composer's follow-up section is optional, and "no title"
  -- is how it says it was left closed -- not an error.
  p_task_title text default null,
  p_task_due_at timestamptz default null,
  p_task_owner_member_id uuid default null,
  p_task_priority text default 'normal'
) returns table(activity_id uuid,task_id uuid)
language plpgsql volatile security invoker set search_path=public as $$
declare v_activity_id uuid; v_task_id uuid; v_link_type text; v_link_id uuid;
begin
  /* The activity first, and its validation is the gate for both writes. Every rule about types,
   * direction, a non-empty summary, a non-future timestamp and at least one link already lives in
   * log_manual_activity, and restating any of it here would be a second copy to drift. */
  v_activity_id:=public.log_manual_activity(
    p_organization_id,p_type,p_summary,p_subject,p_direction,p_occurred_at,p_links);

  if nullif(btrim(coalesce(p_task_title,'')),'') is null then
    activity_id:=v_activity_id; task_id:=null; return next; return;
  end if;

  select
    case
      when link->>'candidate_id' is not null then 'candidate'
      when link->>'company_id' is not null then 'company'
      when link->>'contact_id' is not null then 'contact'
      when link->>'job_id' is not null then 'job'
    end,
    coalesce(link->>'candidate_id',link->>'company_id',link->>'contact_id',link->>'job_id')::uuid
  into v_link_type,v_link_id
  -- WITH ORDINALITY so "the first link" is the array's own order rather than whatever the set
  -- function happened to emit. Aliased `idx` rather than `position`, which is a SQL function name.
  from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) with ordinality as entries(link,idx)
  where link->>'candidate_id' is not null or link->>'company_id' is not null
     or link->>'contact_id' is not null or link->>'job_id' is not null
  order by entries.idx
  limit 1;

  if v_link_type is null then
    raise exception 'follow_up_link_required' using errcode='22023';
  end if;

  /* tasks.write is checked in here, not above. A member who may journal but may not schedule gets
   * the whole call refused, which is the right answer: they asked for an activity AND a follow-up,
   * and half of that is not what they asked for. */
  v_task_id:=public.create_task_with_link(
    p_organization_id,p_task_title,null,coalesce(p_task_priority,'normal'),
    p_task_due_at,p_task_owner_member_id,v_link_type,v_link_id);

  activity_id:=v_activity_id; task_id:=v_task_id; return next;
end $$;

revoke all on function public.log_activity_with_follow_up(uuid,text,text,text,text,timestamptz,jsonb,text,timestamptz,uuid,text) from public,anon;
grant execute on function public.log_activity_with_follow_up(uuid,text,text,text,text,timestamptz,jsonb,text,timestamptz,uuid,text) to authenticated;

comment on function public.log_activity_with_follow_up(uuid,text,text,text,text,timestamptz,jsonb,text,timestamptz,uuid,text) is
  'Records a manual activity and, optionally, the follow-up task that comes out of it, in one transaction. Security invoker: it adds no rights of its own and delegates every permission check to log_manual_activity (activities.write) and create_task_with_link (tasks.write). A refused task write rolls the activity back, so the journal can never claim a follow-up that does not exist.';

commit;
