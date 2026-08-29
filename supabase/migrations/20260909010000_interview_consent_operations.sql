begin;

-- Phase 1.2 and 1.3: consent is written through an audited RPC, and withdrawal is a real operation.
--
-- Two problems this closes.
--
-- The client inserted straight into interview_transcription_consents, supplying the candidate id
-- itself. The insert policy checks can_use_interview_intelligence(organization_id) -- a
-- WORKSPACE-wide permission -- and recorded_by=auth.uid(). So a consultant with the feature
-- permission could record consent against an interview they have no access to, and attach it to a
-- candidate who was never in the room. The candidate is not the caller's to name: it is a fact about
-- the interview.
--
-- And withdrawal existed only as a value in a dropdown. Appending 'withdrawn' stopped future runs
-- being requested but did nothing about work already queued or transcripts already stored, so the
-- moment a candidate asked for their recording to be deleted, nothing was deleted.
--
-- Additive: the RPCs are new, the table and its policies are untouched here. Revoking the direct
-- insert is deliberately left to a later migration, after the deployed client is calling the RPC.

/* Records one consent event.
 *
 * Access is checked against THIS interview, not the workspace. can_access_interview_transcript is
 * the same function that decides who may read what was said -- deciding who may assert what the
 * candidate agreed to is the same question, and answering it twice in two places is how the two
 * answers drift.
 *
 * The candidate is derived from interviews -> job_candidates and never taken from the caller.
 *
 * The audit record carries identifiers, the status and the method. It does NOT copy the evidence
 * text, which is a free-text note about a named person and belongs in one place, not two.
 */
create or replace function public.record_interview_consent(
  p_organization_id uuid,
  p_interview_id uuid,
  p_status text,
  p_consent_method text,
  p_notice_method text default null,
  p_notice_version text default null,
  p_evidence text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare resolved_candidate uuid; new_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if public.my_member_id(p_organization_id) is null then raise exception 'membership_required'; end if;
  if not public.can_use_interview_intelligence(p_organization_id) then raise exception 'permission_denied'; end if;
  -- Per-interview, not workspace-wide.
  if not public.can_access_interview_transcript(p_interview_id) then raise exception 'permission_denied'; end if;

  if p_status not in ('granted','declined','withdrawn') then raise exception 'invalid_consent_status'; end if;
  if p_consent_method not in ('spoken','written','other') then raise exception 'invalid_consent_method'; end if;
  if p_notice_method is not null and p_notice_method not in ('spoken','written','platform_notice','other') then
    raise exception 'invalid_notice_method';
  end if;
  if p_evidence is not null and char_length(p_evidence) > 2000 then raise exception 'consent_evidence_too_long'; end if;
  if p_notice_version is not null and char_length(p_notice_version) > 100 then raise exception 'invalid_notice_version'; end if;

  /* Derived, never supplied. This is what stops consent for candidate B being filed against
   * candidate A's interview. */
  select jc.candidate_id into resolved_candidate
  from public.interviews i
  join public.job_candidates jc on jc.id=i.job_candidate_id
  where i.id=p_interview_id and i.organization_id=p_organization_id;
  if resolved_candidate is null then raise exception 'interview_not_found'; end if;

  insert into public.interview_transcription_consents(
    organization_id,interview_id,candidate_id,status,consent_method,
    notice_method,notice_version,evidence,recorded_by
  ) values (
    p_organization_id,p_interview_id,resolved_candidate,p_status,p_consent_method,
    p_notice_method,nullif(trim(coalesce(p_notice_version,'')),''),nullif(trim(coalesce(p_evidence,'')),''),auth.uid()
  ) returning id into new_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_consent.recorded','interview',p_interview_id,
    jsonb_build_object('consent_id',new_id,'status',p_status,'consent_method',p_consent_method));

  return new_id;
end $$;
revoke all on function public.record_interview_consent(uuid,uuid,text,text,text,text,text) from public, anon;
grant execute on function public.record_interview_consent(uuid,uuid,text,text,text,text,text) to authenticated;

/* Withdrawal: the operation, not the dropdown value.
 *
 * A candidate asking for their recording to be deleted expects deletion, and the three things that
 * has to mean are done here in one transaction: the event is appended, queued analysis is cancelled
 * before it can reach a provider, and every stored transcript is purged along with everything
 * derived from it.
 *
 * Order matters. Cancelling before purging means a worker that claims the job in between finds a
 * withdrawn consent at its own gate and stops; purging first would leave a live job pointed at rows
 * that are disappearing underneath it.
 *
 * Legal hold still wins, and says so. A workspace under a hold cannot delete, and telling somebody
 * their data is gone when it is not would be the worse failure.
 */
create or replace function public.withdraw_interview_consent(
  p_organization_id uuid,
  p_interview_id uuid,
  p_evidence text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  consent_id uuid;
  cancelled_runs integer;
  transcript record;
  purge_result jsonb;
  purged integer:=0;
  held integer:=0;
  already integer:=0;
  outcome text;
begin
  -- The same access rule as recording, because withdrawal is a consent event.
  consent_id:=public.record_interview_consent(
    p_organization_id,p_interview_id,'withdrawn','other',null,null,p_evidence);

  cancelled_runs:=public.cancel_interview_analysis_for_interview(p_interview_id,'consent_not_granted');

  for transcript in
    select t.id from public.interview_transcripts t
    where t.interview_id=p_interview_id and t.organization_id=p_organization_id
      and t.purged_at is null
  loop
    purge_result:=public.purge_interview_transcript(transcript.id,'consent_withdrawn');
    if coalesce(purge_result->>'purged','')='true' then purged:=purged+1;
    elsif purge_result->>'skipped'='legal_hold' then held:=held+1;
    elsif purge_result->>'skipped'='already_purged' then already:=already+1;
    end if;
  end loop;

  /* One outcome word, because the interface has to say something specific. "Legal hold" outranks
   * "purged": if any transcript survived, the honest headline is that deletion is incomplete. */
  outcome:=case
    when held>0 then 'legal_hold'
    when purged>0 then 'purged'
    when already>0 then 'already_purged'
    else 'nothing_to_purge'
  end;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_consent.withdrawn','interview',p_interview_id,
    jsonb_build_object('consent_id',consent_id,'outcome',outcome,
      'transcripts_purged',purged,'transcripts_held',held,'runs_cancelled',cancelled_runs));

  return jsonb_build_object(
    'consent_id',consent_id,
    'outcome',outcome,
    'transcripts_purged',purged,
    'transcripts_on_legal_hold',held,
    'transcripts_already_purged',already,
    'analysis_runs_cancelled',cancelled_runs);
end $$;
revoke all on function public.withdraw_interview_consent(uuid,uuid,text) from public, anon;
grant execute on function public.withdraw_interview_consent(uuid,uuid,text) to authenticated;

commit;
