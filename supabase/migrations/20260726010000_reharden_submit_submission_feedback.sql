-- Restore the service-role-only boundary on submit_submission_feedback.
--
-- 20260713002000_commercial_readiness.sql deliberately locked this RPC to service_role only, for the
-- same reason as resolve_submission_link (see 20260717070000_reharden_resolve_submission_link.sql):
-- the public review flow must pass through the rate-limited public-review Edge Function rather than
-- being callable directly via PostgREST. 20260715001000_activity_feed.sql redefined the function (to
-- fan the client-feedback activity out to the candidate/job/submission feeds) and copy-pasted the
-- function's *original* grant statement (`grant execute ... to anon,authenticated`, from before the
-- lockdown existed) instead of the lockdown's `grant ... to service_role` -- silently reopening direct
-- client access on that `create or replace function`, and it has stayed open since (no later
-- migration touches this function). No behavior change for the real caller: public-review/index.ts
-- already runs this RPC as service_role and already caps p_comments at 4000 characters and
-- p_reviewer_name at 120 before calling it (see supabase/functions/public-review/index.ts:20) -- this
-- only removes the direct-client bypass and backs the Edge Function's caps with the same limit at the
-- boundary that actually persists the row, so they are not the only thing enforcing them.
begin;

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
  on conflict(link_id,candidate_submission_id) do update set decision=excluded.decision,comments=excluded.comments,reviewer_name=excluded.reviewer_name,updated_at=now() returning id into feedback_id;
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
