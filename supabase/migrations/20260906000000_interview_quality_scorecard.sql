begin;

-- Release A2: the interview-quality Scorecard.
--
-- One bounded aggregate, deliberately separate from getAgencyPerformance. That function loads whole
-- record sets into the browser and builds the funnel client-side, which works because a period's
-- submissions and offers are countable in the hundreds. Assessment findings and conversation metrics
-- are transcript-scale -- tens of rows per interview -- so pouring them through the same pipe would
-- make every Scorecard visit pay for data no tile on the Performance view reads.

/* Everything the Scorecard shows, in one call.
 *
 * SECURITY INVOKER, which is the important decision in this file. The rule for who may see a
 * consultant-quality assessment is subtle -- a team reviewer, or the consultant it is about, and
 * nobody else -- and it is already written once, in the interview_assessments RLS policy. A definer
 * function here would have to restate it, and a restated authorization rule is one that can drift
 * from the original silently. That is exactly how interview_consent_status shipped as a definer
 * function that checked nothing earlier in this feature. Running as the caller means the aggregate
 * physically cannot include a row the caller could not read one at a time.
 *
 * The scope check below is therefore NOT a copy of that rule. It answers a different question: RLS
 * decides which rows exist for you, and this decides whether you may ask for the team rollup at all.
 * Without it a consultant asking for 'team' would silently receive their own numbers relabelled as
 * the desk's -- an honest-looking figure that is wrong.
 *
 * Candidate fit is excluded outright rather than filtered in the UI. The two assessments are
 * independent by design, and an interview-quality trend that mixed in how the candidate did would
 * make a consultant's coaching record move because a candidate happened to interview badly.
 */
create or replace function public.get_interview_quality_scorecard(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_scope text default 'mine'
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare
  requested_scope text:=coalesce(p_scope,'mine');
  me uuid;
  window_length interval;
  payload jsonb;
  /* The floor the plan sets: no trend average below three analysed interviews. Enforced here rather
   * than in the component, because a number that crosses the wire gets printed by the next consumer
   * that reads it, and "average over two interviews" is precisely the fake precision this feature is
   * not allowed to invent. */
  min_sample constant integer:=3;
  /* Drilldown identifier lists are capped. The counts stay exact; only the list of records behind
   * them is bounded, and the client is told the cap so it can say "showing the most recent 100"
   * rather than quietly listing fewer rows than the number they sit under. */
  id_cap constant integer:=100;
begin
  if requested_scope not in ('mine','team') then raise exception 'invalid_scope'; end if;
  if not public.can_use_interview_intelligence(p_organization_id)
     and not public.can_review_interview_quality(p_organization_id) then
    raise exception 'permission_denied';
  end if;
  if requested_scope='team' and not public.can_review_interview_quality(p_organization_id) then
    raise exception 'permission_denied';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'invalid_period'; end if;

  me:=public.my_member_id(p_organization_id);
  if requested_scope='mine' and me is null then raise exception 'membership_required'; end if;
  window_length:=p_to-p_from;

  with scoped as (
    /* The period is measured by when the INTERVIEW happened, not when it was analysed. A consultant
     * asking about August means the interviews they ran in August; keying on analysis time would move
     * an interview between periods because somebody re-ran the analysis.
     *
     * DISTINCT ON keeps the newest assessment per interview. An interview analysed twice -- a
     * corrected speaker mapping, a re-run after the rubric changed -- has an assessment per run, and
     * counting both inflates the band distribution above the drilldown behind it. */
    select distinct on (a.interview_id)
      a.id as assessment_id, a.interview_id, a.overall_band, a.subject_member_id,
      a.analysis_run_id, i.starts_at
    from public.interview_assessments a
    join public.interviews i on i.id=a.interview_id
    join public.interview_analysis_runs r on r.id=a.analysis_run_id
    where a.organization_id=p_organization_id
      and a.assessment_type='consultant_quality'
      and i.starts_at >= p_from and i.starts_at < p_to
      and (requested_scope='team' or a.subject_member_id=me)
    order by a.interview_id, r.created_at desc
  ),
  previous as (
    -- The comparison the plan asks for: the consultant's own immediately preceding period, of the
    -- same length. Never another consultant. Deduplicated the same way, for the same reason.
    select distinct on (a.interview_id) a.id as assessment_id, a.interview_id
    from public.interview_assessments a
    join public.interviews i on i.id=a.interview_id
    join public.interview_analysis_runs r on r.id=a.analysis_run_id
    where a.organization_id=p_organization_id
      and a.assessment_type='consultant_quality'
      and i.starts_at >= p_from-window_length and i.starts_at < p_from
      and (requested_scope='team' or a.subject_member_id=me)
    order by a.interview_id, r.created_at desc
  ),
  bands as (
    select overall_band as band, count(*)::int as interviews,
      (array_agg(interview_id order by starts_at desc))[1:id_cap] as interview_ids
    from scoped group by overall_band
  ),
  dimension_findings as (
    select f.category as dimension, f.score, f.severity, s.interview_id
    from public.interview_assessment_findings f
    join scoped s on s.assessment_id=f.assessment_id
    where f.category in ('essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity')
  ),
  dimensions as (
    select dimension,
      count(distinct interview_id)::int as interviews,
      /* Null, not zero, below the floor -- and null again when nothing in the sample carried a score.
       * A dimension with two interviews behind it shows its count and no average, which is the honest
       * rendering of "not enough yet". */
      case when count(distinct interview_id) >= min_sample
        then round(avg(score) filter (where score is not null),2) end as average_score,
      count(*) filter (where severity in ('attention','critical'))::int as attention_findings,
      (array_agg(distinct interview_id) filter (where severity in ('attention','critical')))[1:id_cap] as attention_interview_ids
    from dimension_findings group by dimension
  ),
  previous_dimensions as (
    select f.category as dimension,
      count(distinct p.interview_id)::int as interviews,
      case when count(distinct p.interview_id) >= min_sample
        then round(avg(f.score) filter (where f.score is not null),2) end as average_score
    from public.interview_assessment_findings f
    join previous p on p.assessment_id=f.assessment_id
    where f.category in ('essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity')
    group by f.category
  ),
  /* Speaking share, per interview, for interviews whose metrics are worth reporting.
   *
   * metric_confidence is the gate. A transcript with sparse timestamps produces a share that is
   * arithmetically valid and means nothing, and a trend drawn through those is worse than no trend --
   * it looks like evidence. Excluded interviews are counted and reported rather than dropped
   * silently, because "we could not measure six of your nine" is itself the finding.
   *
   * Reported as the consultant's own share over time and nothing else. There is no ideal talk/listen
   * ratio, so there is no target line here to miss.
   */
  conversation as (
    select s.interview_id,
      sum(m.speech_ms) filter (where m.speaker_role='consultant')::bigint as consultant_ms,
      sum(m.speech_ms)::bigint as total_ms
    from public.interview_conversation_metrics m
    join scoped s on s.analysis_run_id=m.analysis_run_id
    join public.interview_conversation_metric_summaries q on q.analysis_run_id=m.analysis_run_id
    where q.metric_confidence in ('medium','high')
    group by s.interview_id
  ),
  conversation_totals as (
    select count(*)::int as measured_interviews,
      case when count(*) >= min_sample
        then round(avg(consultant_ms::numeric/nullif(total_ms,0))*100,1) end as average_consultant_share_percent
    from conversation where total_ms > 0
  )
  select jsonb_build_object(
    'scope',requested_scope,
    'period',jsonb_build_object('from',p_from,'to',p_to),
    /* Sample size travels with every figure rather than sitting in a footnote, because the whole
     * point of the floor is that the reader can see what the number rests on. */
    'analysed_interviews',(select count(distinct interview_id) from scoped),
    'minimum_sample',min_sample,
    'drilldown_cap',id_cap,
    'interview_ids',coalesce((select to_jsonb((array_agg(interview_id order by starts_at desc))[1:id_cap]) from scoped),'[]'::jsonb),
    'bands',coalesce((select jsonb_agg(jsonb_build_object(
      'band',band,'interviews',interviews,'interview_ids',to_jsonb(interview_ids)) order by interviews desc, band) from bands),'[]'::jsonb),
    'dimensions',coalesce((select jsonb_agg(jsonb_build_object(
      'dimension',d.dimension,'interviews',d.interviews,'average_score',d.average_score,
      'attention_findings',d.attention_findings,
      'attention_interview_ids',to_jsonb(coalesce(d.attention_interview_ids,array[]::uuid[])),
      'previous_interviews',coalesce(pd.interviews,0),'previous_average_score',pd.average_score) order by d.dimension)
      from dimensions d left join previous_dimensions pd on pd.dimension=d.dimension),'[]'::jsonb),
    'previous_analysed_interviews',(select count(distinct interview_id) from previous),
    'conversation',(select jsonb_build_object(
      'measured_interviews',measured_interviews,
      'unmeasured_interviews',(select count(distinct interview_id) from scoped)-measured_interviews,
      'average_consultant_share_percent',average_consultant_share_percent) from conversation_totals),
    'coaching',(select jsonb_build_object(
      'open',count(*) filter (where c.status='open'),
      'acknowledged',count(*) filter (where c.status='acknowledged'),
      'completed',count(*) filter (where c.status='completed'),
      'overdue',count(*) filter (where c.status in ('open','acknowledged') and c.due_at is not null and c.due_at < now()))
      from public.interview_coaching_actions c
      join scoped s on s.assessment_id=c.assessment_id)
  ) into payload;

  return payload;
end $$;
revoke all on function public.get_interview_quality_scorecard(uuid,timestamptz,timestamptz,text) from public, anon;
grant execute on function public.get_interview_quality_scorecard(uuid,timestamptz,timestamptz,text) to authenticated;

/* The team half of the Scorecard: how the desk is doing as a desk.
 *
 * Reviewer-only, and deliberately shaped so that it CANNOT rank anybody. There is no member
 * identifier anywhere in the return value -- not hidden, not as an id the client could resolve. The
 * plan says never rank consultants, and the reliable way to honour that is to make the data that
 * would support a ranking absent rather than merely unrendered, because the surface that renders it
 * is the easiest thing in the system to change later.
 *
 * Coverage patterns and coaching themes are counted at the desk level for the same reason: "essential
 * questions were missed in nine interviews this month" is a training problem the manager can act on,
 * and it stays a training problem as long as it does not come with a name attached.
 */
create or replace function public.get_interview_quality_team_patterns(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare payload jsonb; min_sample constant integer:=3; id_cap constant integer:=100;
begin
  if not public.can_review_interview_quality(p_organization_id) then raise exception 'permission_denied'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'invalid_period'; end if;

  with scoped as (
    -- Newest assessment per interview, as in get_interview_quality_scorecard.
    select distinct on (a.interview_id) a.id as assessment_id, a.interview_id, a.analysis_run_id
    from public.interview_assessments a
    join public.interviews i on i.id=a.interview_id
    join public.interview_analysis_runs r on r.id=a.analysis_run_id
    where a.organization_id=p_organization_id
      and a.assessment_type='consultant_quality'
      and i.starts_at >= p_from and i.starts_at < p_to
    order by a.interview_id, r.created_at desc
  ),
  /* Coverage: how often the essentials actually got asked. Grouped by outcome rather than by person,
   * so it answers "what is happening on this desk" and cannot be re-sorted into "who is worst". */
  coverage as (
    select f.result, count(distinct s.interview_id)::int as interviews,
      (array_agg(distinct s.interview_id))[1:id_cap] as interview_ids
    from public.interview_assessment_findings f
    join scoped s on s.assessment_id=f.assessment_id
    where f.category='essential_coverage'
    group by f.result
  ),
  themes as (
    select f.category as dimension,
      count(*)::int as findings,
      count(distinct s.interview_id)::int as interviews,
      (array_agg(distinct s.interview_id))[1:id_cap] as interview_ids
    from public.interview_assessment_findings f
    join scoped s on s.assessment_id=f.assessment_id
    where f.severity in ('coaching','attention','critical')
      and f.category in ('essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity')
    group by f.category
  ),
  /* Unreviewed attention work, using the SAME predicate as get_interview_attention_queue. If these
   * two disagreed, the tile would send a manager to a queue with a different number of rows in it. */
  attention as (
    select count(*)::int as findings,
      (array_agg(distinct s.interview_id))[1:id_cap] as interview_ids
    from public.interview_assessment_findings f
    join scoped s on s.assessment_id=f.assessment_id
    where f.severity in ('attention','critical')
      and not exists(
        select 1 from public.interview_assessment_feedback fb
        where fb.assessment_id=s.assessment_id
          and (fb.finding_id=f.id or fb.finding_id is null)
          and fb.feedback_type in ('reviewed','agreed','disagreed','discussed')
      )
  ),
  /* Processing quality: whether the pipeline itself is working, which is a different question from
   * whether the interviews were good. A desk whose transcripts arrive partial is not a desk with a
   * coaching problem. */
  transcripts as (
    select count(*)::int as total,
      count(*) filter (where t.completeness='complete')::int as complete
    from public.interview_transcripts t
    join public.interviews i on i.id=t.interview_id
    where t.organization_id=p_organization_id
      and t.purged_at is null and t.superseded_by_transcript_id is null
      and i.starts_at >= p_from and i.starts_at < p_to
  ),
  runs as (
    select count(*)::int as total,
      count(*) filter (where r.status='failed')::int as failed
    from public.interview_analysis_runs r
    join public.interviews i on i.id=r.interview_id
    where r.organization_id=p_organization_id
      and i.starts_at >= p_from and i.starts_at < p_to
  )
  select jsonb_build_object(
    'analysed_interviews',(select count(distinct interview_id) from scoped),
    'minimum_sample',min_sample,
    'drilldown_cap',id_cap,
    'coverage',coalesce((select jsonb_agg(jsonb_build_object(
      'result',result,'interviews',interviews,'interview_ids',to_jsonb(interview_ids)) order by interviews desc, result) from coverage),'[]'::jsonb),
    'themes',coalesce((select jsonb_agg(jsonb_build_object(
      'dimension',dimension,'findings',findings,'interviews',interviews,'interview_ids',to_jsonb(interview_ids)) order by interviews desc, dimension) from themes),'[]'::jsonb),
    'attention_findings',(select findings from attention),
    'attention_interview_ids',coalesce((select to_jsonb(interview_ids) from attention),'[]'::jsonb),
    /* Rates are returned as their two components, never as a pre-divided percentage. A rate with no
     * denominator beside it reads as "94%" whether it came from 34 transcripts or from two, and the
     * client cannot reconstruct the sample size once the division has happened here. */
    'transcripts',(select jsonb_build_object('total',total,'complete',complete) from transcripts),
    'runs',(select jsonb_build_object('total',total,'failed',failed) from runs)
  ) into payload;

  return payload;
end $$;
revoke all on function public.get_interview_quality_team_patterns(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_interview_quality_team_patterns(uuid,timestamptz,timestamptz) to authenticated;

commit;
