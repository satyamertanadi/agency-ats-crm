-- generate-candidate-profile had no rate limit or cost ceiling of any kind: no per-user or
-- per-organization counter, and the client-supplied `force` flag bypasses the input-hash dedup cache
-- that was the only other brake on repeated calls -- on the more expensive model (AI_MODEL, not the
-- cheaper AI_MODEL_PARSE used for CV parsing). Because ANTHROPIC_API_KEY is one key for the whole
-- deployment, exhausting its balance or rate limit takes profile generation AND CV parsing down for
-- every tenant, not just the caller's own organization.
--
-- This is the SQL half of that fix: a monthly per-organization token-spend sum, queried by the Edge
-- Function alongside hourly per-user/per-organization counters (both counted directly off
-- ai_evaluations via PostgREST, no new schema needed there). Doing the sum in SQL rather than
-- fetching every row for the month and reducing client-side avoids transferring an unbounded number
-- of rows over the wire for a busy organization.
--
-- service_role only: called from generate-candidate-profile's admin client, never from the
-- authenticated client directly -- there is no legitimate reason for a client to read another
-- organization's aggregate spend, and this function does not check has_permission itself.
create or replace function public.candidate_profile_token_spend_this_month(p_organization_id uuid)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)
  from public.ai_evaluations
  where organization_id=p_organization_id and evaluation_type='candidate_profile'
    and created_at >= date_trunc('month', now())
$$;
revoke all on function public.candidate_profile_token_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.candidate_profile_token_spend_this_month(uuid) to service_role;
