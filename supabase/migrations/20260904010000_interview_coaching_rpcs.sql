begin;

-- The workflow verbs for Release A1. Coaching writes go through audited RPCs rather than table
-- policies, because each one is a consequential act about a named colleague: assigning work,
-- acknowledging it, and saying it is done are three different claims and each deserves a trace.

/* Records a review event. The machine output is untouched by construction -- this only ever inserts.
 *
 * Disagreeing is a first-class outcome rather than an edit. A manager who thinks a finding is wrong
 * says so next to it; the finding still says what it said, and anyone reading later sees both. That
 * is the difference between a record that can be argued with and a record of whoever edited it last.
 */
create or replace function public.record_interview_feedback(
  p_organization_id uuid,
  p_assessment_id uuid,
  p_feedback_type text,
  p_finding_id uuid default null,
  p_note text default null,
  p_visibility text default 'subject_and_reviewers'
)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid; assessment public.interview_assessments; new_id uuid; effective_visibility text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  actor:=public.my_member_id(p_organization_id);
  if actor is null then raise exception 'permission_denied'; end if;

  select * into assessment from public.interview_assessments
  where id=p_assessment_id and organization_id=p_organization_id;
  if assessment.id is null then raise exception 'assessment_not_found'; end if;

  if p_feedback_type not in ('reviewed','agreed','disagreed','discussed','consultant_context') then
    raise exception 'invalid_feedback_type';
  end if;

  /* Two callers, two rules. A reviewer may record any judgement. The assessed consultant may add
   * their own context and nothing else -- they cannot mark their own interview reviewed, and they
   * cannot write a private note about themselves. */
  if public.can_review_interview_quality(p_organization_id) then
    effective_visibility:=coalesce(nullif(p_visibility,''),'subject_and_reviewers');
  elsif p_feedback_type='consultant_context' and assessment.subject_member_id=actor then
    effective_visibility:='subject_and_reviewers';
  else
    raise exception 'permission_denied';
  end if;

  if p_finding_id is not null and not exists(
    select 1 from public.interview_assessment_findings f
    where f.id=p_finding_id and f.assessment_id=p_assessment_id
  ) then raise exception 'finding_not_found'; end if;

  insert into public.interview_assessment_feedback(
    organization_id,assessment_id,finding_id,actor_member_id,feedback_type,note,visibility
  ) values (
    p_organization_id,p_assessment_id,p_finding_id,actor,p_feedback_type,nullif(btrim(coalesce(p_note,'')),''),effective_visibility
  ) returning id into new_id;

  -- Identifiers and the verb. Never the note: a private management note in the audit trail would be
  -- readable by anyone with organization.manage, which is exactly who it was kept from.
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_assessment.feedback','interview_assessment',p_assessment_id,
    jsonb_build_object('feedback_type',p_feedback_type,'finding_id',p_finding_id,'visibility',effective_visibility));

  return new_id;
end $$;
revoke all on function public.record_interview_feedback(uuid,uuid,text,uuid,text,text) from public, anon;
grant execute on function public.record_interview_feedback(uuid,uuid,text,uuid,text,text) to authenticated;

/* Assigns a coaching action to the consultant an assessment is about.
 *
 * The assignee is derived from the assessment rather than passed in. Letting a caller name the
 * subject would allow coaching about one consultant's interview to be filed against another, which
 * is the multi-consultant failure mode in a different costume.
 */
create or replace function public.assign_interview_coaching(
  p_organization_id uuid,
  p_assessment_id uuid,
  p_action_text text,
  p_finding_id uuid default null,
  p_due_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare assigner uuid; assessment public.interview_assessments; new_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_review_interview_quality(p_organization_id) then raise exception 'permission_denied'; end if;
  assigner:=public.my_member_id(p_organization_id);

  select * into assessment from public.interview_assessments
  where id=p_assessment_id and organization_id=p_organization_id;
  if assessment.id is null then raise exception 'assessment_not_found'; end if;
  -- Coaching is about how somebody interviewed. There is nobody to coach on a candidate assessment.
  if assessment.assessment_type <> 'consultant_quality' or assessment.subject_member_id is null then
    raise exception 'coaching_requires_consultant_assessment';
  end if;

  if btrim(coalesce(p_action_text,''))='' then raise exception 'coaching_action_required'; end if;

  if p_finding_id is not null and not exists(
    select 1 from public.interview_assessment_findings f
    where f.id=p_finding_id and f.assessment_id=p_assessment_id
  ) then raise exception 'finding_not_found'; end if;

  insert into public.interview_coaching_actions(
    organization_id,assessment_id,finding_id,assigned_to_member_id,assigned_by_member_id,action_text,due_at
  ) values (
    p_organization_id,p_assessment_id,p_finding_id,assessment.subject_member_id,assigner,btrim(p_action_text),p_due_at
  ) returning id into new_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_coaching.assigned','interview_coaching_action',new_id,
    jsonb_build_object('assessment_id',p_assessment_id,'assigned_to',assessment.subject_member_id));

  return new_id;
end $$;
revoke all on function public.assign_interview_coaching(uuid,uuid,text,uuid,timestamptz) from public, anon;
grant execute on function public.assign_interview_coaching(uuid,uuid,text,uuid,timestamptz) to authenticated;

/* The consultant's side: acknowledge, complete, or add context.
 *
 * Acknowledged is deliberately distinct from completed. "I have seen this" and "I have done this" are
 * different facts, and a workflow that only records the second cannot tell a manager whether silence
 * means disagreement or an unread notification.
 *
 * Only the assignee may move it. A reviewer can cancel, but cannot mark somebody else's coaching done
 * on their behalf -- that would put words in their mouth in a record they cannot edit.
 */
create or replace function public.respond_to_interview_coaching(
  p_organization_id uuid,
  p_action_id uuid,
  p_outcome text,
  p_response text default null
)
returns text language plpgsql security definer set search_path=public as $$
declare action public.interview_coaching_actions; actor uuid; next_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  actor:=public.my_member_id(p_organization_id);
  if actor is null then raise exception 'permission_denied'; end if;

  select * into action from public.interview_coaching_actions
  where id=p_action_id and organization_id=p_organization_id
  for update;
  if action.id is null then raise exception 'coaching_action_not_found'; end if;

  if p_outcome='cancelled' then
    if not public.can_review_interview_quality(p_organization_id) then raise exception 'permission_denied'; end if;
    next_status:='cancelled';
  elsif p_outcome in ('acknowledged','completed') then
    if action.assigned_to_member_id <> actor then raise exception 'permission_denied'; end if;
    next_status:=p_outcome;
  else
    raise exception 'invalid_coaching_outcome';
  end if;

  if action.status in ('completed','cancelled') then raise exception 'coaching_action_closed'; end if;

  update public.interview_coaching_actions
  set status=next_status,
      acknowledged_at=case when next_status in ('acknowledged','completed') then coalesce(acknowledged_at,now()) else acknowledged_at end,
      completed_at=case when next_status='completed' then now() else completed_at end,
      consultant_response=case when p_response is null then consultant_response else nullif(btrim(p_response),'') end
  where id=p_action_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_coaching.'||next_status,'interview_coaching_action',p_action_id,
    jsonb_build_object('assessment_id',action.assessment_id));

  return next_status;
end $$;
revoke all on function public.respond_to_interview_coaching(uuid,uuid,text,text) from public, anon;
grant execute on function public.respond_to_interview_coaching(uuid,uuid,text,text) to authenticated;

commit;
