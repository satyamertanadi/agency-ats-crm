begin;

-- Release A1, WS6: human review and the coaching loop.
--
-- Everything here sits ALONGSIDE the machine output, never on top of it. A manager who disagrees
-- writes a disagreement; the finding they disagree with is unchanged and still says what it said.
-- That is the whole design: an assessment nobody can overwrite is one a consultant can argue with,
-- and one that can be quietly edited is a record of whoever edited it last.

-- ---------------------------------------------------------------------------------------------
-- Human feedback
-- ---------------------------------------------------------------------------------------------

/* Append-only review history against an assessment, or against one finding inside it.
 *
 * `visibility` governs the NOTE, never the finding. A manager may keep a private management note --
 * `reviewers_only` -- but no value of this column can hide a machine finding from the consultant it
 * is about. There is deliberately no mechanism here to suppress an assessment: the plan forbids a
 * hidden owner-only score, and the way that stays true is that this table cannot express one.
 *
 * consultant_context is the consultant's own reply -- "the client cut the call short" -- recorded as
 * its own event type rather than as a correction, because it is a different kind of claim from a
 * reviewer's judgement and reads wrong when the two are flattened together.
 */
create table public.interview_assessment_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  finding_id uuid,
  actor_member_id uuid not null,
  feedback_type text not null check (feedback_type in ('reviewed','agreed','disagreed','discussed','consultant_context')),
  note text check (note is null or char_length(note) <= 4000),
  visibility text not null default 'subject_and_reviewers' check (visibility in ('subject_and_reviewers','reviewers_only')),
  created_at timestamptz not null default now(),
  foreign key (assessment_id, organization_id) references public.interview_assessments(id, organization_id) on delete cascade,
  foreign key (finding_id, organization_id) references public.interview_assessment_findings(id, organization_id) on delete cascade,
  foreign key (actor_member_id, organization_id) references public.organization_members(id, organization_id) on delete cascade,
  /* A consultant's own context is never a private management note: it is their side of the record and
   * has to be readable by the people reviewing them, or it is not a reply to anything. */
  constraint interview_feedback_context_is_visible check (
    feedback_type <> 'consultant_context' or visibility = 'subject_and_reviewers'
  ),
  unique (id, organization_id)
);
create index interview_feedback_assessment on public.interview_assessment_feedback(assessment_id, created_at desc);
create index interview_feedback_finding on public.interview_assessment_feedback(finding_id) where finding_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Coaching actions
-- ---------------------------------------------------------------------------------------------

/* Kept out of the generic task model on purpose.
 *
 * A task is owned, due, and either open or done. A coaching action additionally has to record that
 * the consultant SAW it (acknowledged, which is distinct from completed), carry their reply, and
 * point at the finding that motivated it -- so that when the finding is purged the action goes with
 * it. Bending tasks to hold all three would weaken what a task means everywhere else in the product
 * for the sake of one table.
 */
create table public.interview_coaching_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  finding_id uuid,
  assigned_to_member_id uuid not null,
  assigned_by_member_id uuid not null,
  action_text text not null check (char_length(action_text) between 1 and 2000),
  status text not null default 'open' check (status in ('open','acknowledged','completed','cancelled')),
  due_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  consultant_response text check (consultant_response is null or char_length(consultant_response) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assessment_id, organization_id) references public.interview_assessments(id, organization_id) on delete cascade,
  foreign key (finding_id, organization_id) references public.interview_assessment_findings(id, organization_id) on delete cascade,
  foreign key (assigned_to_member_id, organization_id) references public.organization_members(id, organization_id) on delete cascade,
  foreign key (assigned_by_member_id, organization_id) references public.organization_members(id, organization_id) on delete cascade,
  constraint interview_coaching_state_consistent check (
    (status='acknowledged' and acknowledged_at is not null)
    or (status='completed' and completed_at is not null)
    or status in ('open','cancelled')
  )
);
create trigger interview_coaching_actions_touch before update on public.interview_coaching_actions
for each row execute function public.touch_updated_at();
create index interview_coaching_assignee on public.interview_coaching_actions(assigned_to_member_id, status, due_at);
create index interview_coaching_assessment on public.interview_coaching_actions(assessment_id);

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array['interview_assessment_feedback','interview_coaching_actions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon',t);
  end loop;
end $$;

/* Feedback follows the assessment it belongs to, with one subtraction: a reviewers_only note is
 * invisible to the subject. The `exists` against interview_assessments enforces the rest -- a
 * consultant who cannot see an assessment cannot see the discussion about it either. */
create policy interview_feedback_read on public.interview_assessment_feedback
  for select to authenticated
  using (
    exists(select 1 from public.interview_assessments a where a.id=assessment_id)
    and (
      visibility='subject_and_reviewers'
      or public.can_review_interview_quality(organization_id)
    )
  );

/* Inserts only -- there is no update or delete policy, so the history cannot be rewritten. A reviewer
 * may record any event type; the assessed consultant may record only their own context, and only
 * about themselves. */
create policy interview_feedback_insert on public.interview_assessment_feedback
  for insert to authenticated
  with check (
    actor_member_id = public.my_member_id(organization_id)
    and (
      public.can_review_interview_quality(organization_id)
      or (
        feedback_type='consultant_context'
        and exists(
          select 1 from public.interview_assessments a
          where a.id=assessment_id and a.subject_member_id = public.my_member_id(organization_id)
        )
      )
    )
  );

-- A coaching action is visible to the person it is for and to the people who review them. Nobody else
-- on the desk sees a colleague's coaching.
create policy interview_coaching_read on public.interview_coaching_actions
  for select to authenticated
  using (
    assigned_to_member_id = public.my_member_id(organization_id)
    or public.can_review_interview_quality(organization_id)
  );

commit;
