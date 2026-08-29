begin;

-- Phase 1: consent, feature state and configuration are re-checked at EXECUTION time.
--
-- The gap this closes: request_interview_analysis validates consent, the feature switch and the
-- rubrics when a run is requested, and nothing re-checks any of it before the provider is called.
-- A queued run therefore survives the candidate withdrawing consent, the workspace disabling the
-- feature, and the transcript being purged -- and then sends the transcript to a model anyway.
-- Between request and execution there is a background queue, so that window is not theoretical.
--
-- Everything here is additive. No existing function changes signature, and the new status is added
-- to a check constraint rather than replacing a value already in use.

-- ---------------------------------------------------------------------------------------------
-- A run can now be cancelled rather than only failing
-- ---------------------------------------------------------------------------------------------

/* "Failed" tells a consultant something broke and invites them to retry. A run stopped because the
 * candidate withdrew consent did not break, and retrying is precisely what must not happen -- so it
 * needs a status of its own.
 *
 * Added to the constraint, never substituted for an existing value, so already-stored rows stay
 * valid and an older client that has not learned the word still renders every status it knew.
 */
alter table public.interview_analysis_runs drop constraint if exists interview_analysis_runs_status_check;
alter table public.interview_analysis_runs add constraint interview_analysis_runs_status_check
  check (status in ('queued','processing','completed','failed','superseded','cancelled'));

comment on column public.interview_analysis_runs.status is
  'cancelled means a precondition stopped being true after the run was queued -- consent withdrawn, feature disabled, transcript purged. It is not a failure and must not be retried.';

/* The Meet fetcher has to ask about consent BEFORE it calls Google, and interview_consent_status was
 * only ever granted to authenticated. It is security invoker, so the service role reading through it
 * sees exactly the rows it can already read directly -- this grant adds reach, not visibility. */
grant execute on function public.interview_consent_status(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The execution gate
-- ---------------------------------------------------------------------------------------------

/* May this run call a provider, right now?
 *
 * One function, asked twice: once after the job is claimed and before any transcript text is
 * loaded, and again immediately before the external call. Two checks rather than one because the
 * gap between them contains the slowest work in the pipeline -- loading a transcript, building a
 * payload -- and consent can be withdrawn during it.
 *
 * It resolves the organisation and interview from the run itself and takes no caller-supplied
 * identifiers, because a gate that trusts its caller to say which interview it is checking is not a
 * gate. The trusted provider configuration is passed in, since the database cannot read the
 * worker's environment; everything else is derived here.
 *
 * Returns a reason code rather than raising. Every refusal is an expected outcome with a different
 * correct response -- withdrawn consent must never be retried, a transient read error must be --
 * and an exception would flatten those into one.
 */
create or replace function public.interview_analysis_execution_gate(
  p_run_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  run public.interview_analysis_runs;
  linked_total integer;
  usable_total integer;
  consent_state text;
  feature_on boolean;
  subject_missing integer;
begin
  select * into run from public.interview_analysis_runs where id=p_run_id;
  if run.id is null then return jsonb_build_object('allowed',false,'reason','run_not_found','permanent',true); end if;

  -- Terminal states are not errors here: a second worker arriving late should stop quietly.
  if run.status in ('completed','superseded','cancelled') then
    return jsonb_build_object('allowed',false,'reason','run_not_executable','permanent',true);
  end if;

  /* Configuration match. A run carries the provider, model and prompt version it was priced and
   * fingerprinted against; a worker running different ones would produce an answer whose
   * idempotency hash describes something that never happened. */
  if run.provider is distinct from p_provider
     or run.model is distinct from p_model
     or run.prompt_version is distinct from p_prompt_version then
    return jsonb_build_object('allowed',false,'reason','configuration_mismatch','permanent',true);
  end if;

  select interview_intelligence_enabled into feature_on
  from public.organization_settings where organization_id=run.organization_id;
  if not coalesce(feature_on,false) then
    return jsonb_build_object('allowed',false,'reason','feature_disabled','permanent',true);
  end if;

  /* The check that matters most. interview_consent_status returns the LATEST consent event, so a
   * withdrawal after the run was queued lands here even though the run was legitimately requested. */
  consent_state:=public.interview_consent_status(run.interview_id);
  if coalesce(consent_state,'') <> 'granted' then
    return jsonb_build_object('allowed',false,'reason','consent_not_granted','permanent',true);
  end if;

  /* Every transcript frozen into the bundle must still be readable and still belong here. A purge
   * between request and execution removes the rows; sending the remainder would analyse a
   * conversation the candidate has already had deleted. */
  select count(*) into linked_total
  from public.interview_analysis_run_transcripts l where l.analysis_run_id=p_run_id;
  if linked_total=0 then
    return jsonb_build_object('allowed',false,'reason','transcript_required','permanent',true);
  end if;

  select count(*) into usable_total
  from public.interview_analysis_run_transcripts l
  join public.interview_transcripts t on t.id=l.transcript_id
  where l.analysis_run_id=p_run_id
    and t.purged_at is null
    and t.interview_id=run.interview_id
    and t.organization_id=run.organization_id;
  if usable_total <> linked_total then
    return jsonb_build_object('allowed',false,'reason','transcript_unavailable','permanent',true);
  end if;

  -- The interview, its candidate link and both rubrics must still resolve inside this organisation.
  if not exists(
    select 1 from public.interviews i
    join public.job_candidates jc on jc.id=i.job_candidate_id
    join public.candidates c on c.id=jc.candidate_id and c.organization_id=run.organization_id
    where i.id=run.interview_id and i.organization_id=run.organization_id
  ) then
    return jsonb_build_object('allowed',false,'reason','subject_unresolved','permanent',true);
  end if;

  if not exists(
    select 1 from public.interview_rubrics r
    where r.id=run.core_rubric_id and r.organization_id=run.organization_id
  ) or not exists(
    select 1 from public.interview_rubrics r
    where r.id=run.job_rubric_id and r.organization_id=run.organization_id
  ) then
    return jsonb_build_object('allowed',false,'reason','rubric_unresolved','permanent',true);
  end if;

  /* A speaker mapped to somebody who has since left must not become the subject of a performance
   * assessment nobody can act on. Counted rather than joined so the reason is specific. */
  select count(*) into subject_missing
  from public.interview_transcript_speakers s
  join public.interview_analysis_run_transcripts l on l.transcript_id=s.transcript_id
  left join public.organization_members m
    on m.id=s.member_id and m.organization_id=run.organization_id and m.status='active'
  where l.analysis_run_id=p_run_id
    and s.speaker_role='consultant'
    and s.member_id is not null
    and m.id is null;
  if subject_missing>0 then
    return jsonb_build_object('allowed',false,'reason','consultant_subject_inactive','permanent',true);
  end if;

  return jsonb_build_object('allowed',true,'reason',null,'permanent',false);
end $$;
revoke all on function public.interview_analysis_execution_gate(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.interview_analysis_execution_gate(uuid,text,text,text) to service_role;

/* Stops a run without calling it a failure.
 *
 * Bounded reason codes only -- the vocabulary the gate returns -- so nothing a provider or a
 * transcript said can reach this column. A cancelled run keeps its identifiers and its input hash,
 * which is what lets the same request be made again legitimately once the blocker is resolved.
 */
create or replace function public.cancel_interview_analysis(
  p_run_id uuid,
  p_reason text
)
returns text language plpgsql security definer set search_path=public as $$
declare
  allowed constant text[]:=array[
    'run_not_found','run_not_executable','configuration_mismatch','feature_disabled',
    'consent_not_granted','transcript_required','transcript_unavailable','subject_unresolved',
    'rubric_unresolved','consultant_subject_inactive'];
  updated public.interview_analysis_runs;
begin
  if p_reason is null or not (p_reason = any(allowed)) then
    raise exception 'invalid_cancellation_reason';
  end if;

  update public.interview_analysis_runs
  set status='cancelled', completed_at=now(), error_code=p_reason, error_message=null
  where id=p_run_id and status in ('queued','processing')
  returning * into updated;

  -- Already terminal is not an error: a second worker arriving late should stop quietly.
  if updated.id is null then return 'noop'; end if;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(updated.organization_id,null,'interview_analysis.cancelled','interview_analysis_run',p_run_id,
    jsonb_build_object('reason',p_reason));

  return 'cancelled';
end $$;
revoke all on function public.cancel_interview_analysis(uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_interview_analysis(uuid,text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Cancelling queued work for an interview
-- ---------------------------------------------------------------------------------------------

/* Stops analysis work for one interview before it can reach a provider.
 *
 * Used by consent withdrawal, which must take effect immediately rather than at the next sweep. It
 * cancels the runs and removes the queued jobs that would recreate them; a job already claimed by a
 * running worker is left alone, because that worker re-checks the gate before its provider call and
 * will cancel itself.
 */
create or replace function public.cancel_interview_analysis_for_interview(
  p_interview_id uuid,
  p_reason text
)
returns integer language plpgsql security definer set search_path=public as $$
declare cancelled_count integer:=0; run record;
begin
  for run in
    select id from public.interview_analysis_runs
    where interview_id=p_interview_id and status in ('queued','processing')
  loop
    if public.cancel_interview_analysis(run.id,p_reason)='cancelled' then
      cancelled_count:=cancelled_count+1;
    end if;
  end loop;

  /* Pending jobs only. A processing job belongs to a live worker, and deleting the row underneath it
   * would leave that worker unable to report what it did. */
  delete from public.background_jobs
  where status='pending'
    and job_type in ('interview_analysis','interview_auto_analysis')
    and (payload->>'interview_id')::uuid = p_interview_id;

  return cancelled_count;
end $$;
revoke all on function public.cancel_interview_analysis_for_interview(uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_interview_analysis_for_interview(uuid,text) to service_role;

commit;
