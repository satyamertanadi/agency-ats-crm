begin;

/* The monthly token ceiling for interview analysis, mirroring
 * candidate_profile_token_spend_this_month and interview_rubric_token_spend_this_month.
 *
 * This is the most expensive call in the product: a full interview transcript plus two rubrics plus
 * the candidate's structured evidence, against the larger model. ANTHROPIC_API_KEY is one key for the
 * whole deployment, so an unbounded analysis loop does not merely overspend -- it exhausts the
 * balance for CV parsing and profile generation too, for every tenant.
 *
 * Reads interview_analysis_runs rather than ai_evaluations, because a run already records its own
 * token usage and duplicating that into a second table would give two places to disagree about what
 * an analysis cost.
 *
 * Service-role only: there is no legitimate reason for a client to read another organisation's
 * aggregate spend, and this function does not check has_permission itself.
 */
create or replace function public.interview_analysis_token_spend_this_month(p_organization_id uuid)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)
  from public.interview_analysis_runs
  where organization_id=p_organization_id
    and created_at >= date_trunc('month', now())
$$;
revoke all on function public.interview_analysis_token_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.interview_analysis_token_spend_this_month(uuid) to service_role;

/* Hourly request counts, for the per-user and per-organisation brakes.
 *
 * Counts runs rather than completed analyses on purpose: a run that failed still cost a provider call,
 * and a user who can trigger failures in a loop is a user who can spend in a loop. */
create or replace function public.interview_analysis_recent_run_count(
  p_organization_id uuid,
  p_requested_by uuid default null,
  p_since interval default '1 hour'
)
returns integer language sql stable security definer set search_path=public as $$
  select count(*)::integer
  from public.interview_analysis_runs
  where organization_id=p_organization_id
    and created_at >= now()-p_since
    and (p_requested_by is null or requested_by=p_requested_by)
$$;
revoke all on function public.interview_analysis_recent_run_count(uuid,uuid,interval) from public, anon, authenticated;
grant execute on function public.interview_analysis_recent_run_count(uuid,uuid,interval) to service_role;

commit;
