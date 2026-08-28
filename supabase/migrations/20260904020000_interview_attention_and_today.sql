begin;

-- The two read surfaces Release A1 adds: the management attention queue, and Today.

/* Findings that a reviewer should actually look at.
 *
 * Severity `attention` and `critical` only, and only those nobody has reviewed yet -- an alert that
 * stays lit after somebody has dealt with it trains people to ignore the list, which is the failure
 * mode the plan warns about when it says not to declare the alert system successful because it
 * generates many alerts.
 *
 * Bounded and ordered oldest-first: the point is the backlog, not a feed.
 */
create or replace function public.get_interview_attention_queue(p_organization_id uuid, p_limit integer default 50)
returns table(
  finding_id uuid,
  assessment_id uuid,
  interview_id uuid,
  job_candidate_id uuid,
  subject_member_id uuid,
  severity text,
  title text,
  summary text,
  created_at timestamptz,
  has_open_coaching boolean
)
language sql stable security definer set search_path=public as $$
  select f.id,a.id,a.interview_id,r.job_candidate_id,a.subject_member_id,
    f.severity,f.title,f.summary,f.created_at,
    exists(
      select 1 from public.interview_coaching_actions c
      where c.finding_id=f.id and c.status in ('open','acknowledged')
    )
  from public.interview_assessment_findings f
  join public.interview_assessments a on a.id=f.assessment_id
  join public.interview_analysis_runs r on r.id=a.analysis_run_id
  where a.organization_id=p_organization_id
    and public.can_review_interview_quality(p_organization_id)
    and f.severity in ('attention','critical')
    -- Reviewed is the off switch. Any reviewer verdict on the finding, or on its assessment as a
    -- whole, takes it off the queue.
    and not exists(
      select 1 from public.interview_assessment_feedback fb
      where fb.assessment_id=a.id
        and (fb.finding_id=f.id or fb.finding_id is null)
        and fb.feedback_type in ('reviewed','agreed','disagreed','discussed')
    )
  order by f.created_at
  limit greatest(coalesce(p_limit,50),1)
$$;
revoke all on function public.get_interview_attention_queue(uuid,integer) from public, anon;
grant execute on function public.get_interview_attention_queue(uuid,integer) to authenticated;

/* Everything Interview Intelligence contributes to Today, in ONE call.
 *
 * The plan caps this at a single bounded query, and the reason is visible in the shape: Today already
 * assembles work from six sources, and a feature that adds four more round trips to the busiest
 * screen in the product pays for itself in latency long before anyone reads the rows.
 *
 * It returns both the consultant's own work and the reviewer's, decided per caller by the permission
 * functions rather than by a flag the client passes -- a client-chosen audience is a client-chosen
 * authorization boundary.
 *
 * No transcript text and no finding summaries: Today renders a line and a link, and the detail lives
 * behind it.
 */
create or replace function public.get_interview_today_items(p_organization_id uuid, p_limit integer default 25)
returns table(
  kind text,
  interview_id uuid,
  job_candidate_id uuid,
  reference_id uuid,
  headline text,
  occurred_at timestamptz,
  audience text
)
language sql stable security definer set search_path=public as $$
  with me as (select public.my_member_id(p_organization_id) as member_id),
  can_use as (select public.can_use_interview_intelligence(p_organization_id) as ok),
  can_review as (select public.can_review_interview_quality(p_organization_id) as ok),

  /* Consultant items: the interviews this person organised that are stuck, and their own coaching.
   * Scoped to the organiser so a consultant's Today is their own work, not the desk's. */
  needs_consent as (
    select 'consent_missing'::text as kind,i.id,i.job_candidate_id,i.id as reference_id,
      'Record consent before this interview can be transcribed'::text as headline,
      i.ends_at as occurred_at,'consultant'::text as audience
    from public.interviews i, me, can_use
    where can_use.ok and i.organization_id=p_organization_id and i.status='completed'
      and i.organizer_member_id=me.member_id
      and coalesce(public.interview_consent_status(i.id),'') not in ('granted','declined','withdrawn')
      and not exists(select 1 from public.interview_transcripts t where t.interview_id=i.id and t.purged_at is null)
  ),
  needs_mapping as (
    select 'mapping_required'::text,i.id,i.job_candidate_id,t.id,
      'Map the speakers on this transcript'::text,t.created_at,'consultant'::text
    from public.interview_transcripts t
    join public.interviews i on i.id=t.interview_id, me, can_use
    where can_use.ok and t.organization_id=p_organization_id and t.status='needs_mapping'
      and t.purged_at is null and t.superseded_by_transcript_id is null
      and i.organizer_member_id=me.member_id
  ),
  failed_runs as (
    select 'analysis_failed'::text,r.interview_id,r.job_candidate_id,r.id,
      'An interview analysis failed'::text,r.completed_at,'consultant'::text
    from public.interview_analysis_runs r
    join public.interviews i on i.id=r.interview_id, me, can_use
    where can_use.ok and r.organization_id=p_organization_id and r.status='failed'
      and i.organizer_member_id=me.member_id
  ),
  my_coaching as (
    select 'coaching_open'::text,a.interview_id,null::uuid,c.id,
      case when c.status='open' then 'New coaching action to acknowledge'
           else 'Coaching action in progress' end,
      coalesce(c.due_at,c.created_at),'consultant'::text
    from public.interview_coaching_actions c
    join public.interview_assessments a on a.id=c.assessment_id, me
    where c.organization_id=p_organization_id and c.status in ('open','acknowledged')
      and c.assigned_to_member_id=me.member_id
  ),

  -- Reviewer items: what the desk owes attention to.
  attention as (
    select 'attention_finding'::text,a.interview_id,r.job_candidate_id,f.id,
      'An interview needs review'::text,f.created_at,'reviewer'::text
    from public.interview_assessment_findings f
    join public.interview_assessments a on a.id=f.assessment_id
    join public.interview_analysis_runs r on r.id=a.analysis_run_id, can_review
    where can_review.ok and a.organization_id=p_organization_id
      and f.severity in ('attention','critical')
      and not exists(
        select 1 from public.interview_assessment_feedback fb
        where fb.assessment_id=a.id and (fb.finding_id=f.id or fb.finding_id is null)
          and fb.feedback_type in ('reviewed','agreed','disagreed','discussed')
      )
  )

  select * from (
    select * from needs_consent
    union all select * from needs_mapping
    union all select * from failed_runs
    union all select * from my_coaching
    union all select * from attention
  ) items
  order by occurred_at nulls last
  limit greatest(coalesce(p_limit,25),1)
$$;
revoke all on function public.get_interview_today_items(uuid,integer) from public, anon;
grant execute on function public.get_interview_today_items(uuid,integer) to authenticated;

commit;
