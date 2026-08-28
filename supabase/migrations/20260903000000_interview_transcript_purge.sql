begin;

-- WS5: retention and the consent-withdrawal purge.
--
-- Purge is complete deletion, not anonymisation. The alternative -- keeping an assessment while
-- removing the transcript under it -- produces the one artifact that is worse than keeping
-- everything: a conclusion about a named person that nobody can explain, challenge or verify.

/* Removes a transcript and everything derived from it.
 *
 * Deleting the analysis RUN is what does most of the work: assessments, findings, evidence and both
 * metric tables all cascade from it. That is deliberate rather than incidental -- it means there is
 * no path where a finding survives its run, and no list of child tables here to fall out of date the
 * next time one is added.
 *
 * A run that read several transcripts is deleted too, not recomputed. Pretending the remaining
 * evidence reproduces the same analysis would be a claim nobody checked.
 *
 * The transcript row itself survives as a tombstone: status 'purged' with its metadata, so the
 * interface can say the transcript was removed rather than silently showing an interview that never
 * had one.
 */
create or replace function public.purge_interview_transcript(p_transcript_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  transcript public.interview_transcripts;
  target_candidate uuid;
  on_legal_hold boolean;
  purged_runs integer:=0;
  purged_entries integer:=0;
begin
  select * into transcript from public.interview_transcripts where id=p_transcript_id for update;
  if transcript.id is null then raise exception 'transcript_not_found'; end if;
  if transcript.purged_at is not null then
    return jsonb_build_object('transcript_id',p_transcript_id,'skipped','already_purged');
  end if;

  -- Named target_candidate, not candidate_id: a variable sharing a column name makes
  -- `p.candidate_id=candidate_id` below resolve to the column on both sides, so the legal-hold check
  -- would silently read some other candidate's hold state.
  select jc.candidate_id into target_candidate
  from public.interviews i
  join public.job_candidates jc on jc.id=i.job_candidate_id
  where i.id=transcript.interview_id;

  /* Legal hold wins over both retention expiry and consent withdrawal. A preservation obligation is
   * not something this sweep gets to override, and a transcript left in place under one has to be
   * visible as skipped rather than quietly retried forever. */
  select coalesce(p.legal_hold,false) into on_legal_hold
  from public.candidate_private_details p where p.candidate_id=target_candidate;
  if coalesce(on_legal_hold,false) then
    return jsonb_build_object('transcript_id',p_transcript_id,'skipped','legal_hold');
  end if;

  with doomed as (
    delete from public.interview_analysis_runs r
    where r.id in (
      select l.analysis_run_id from public.interview_analysis_run_transcripts l
      where l.transcript_id=p_transcript_id
    )
    returning 1
  ) select count(*) into purged_runs from doomed;

  with removed as (
    delete from public.interview_transcript_entries e where e.transcript_id=p_transcript_id returning 1
  ) select count(*) into purged_entries from removed;

  delete from public.interview_transcript_speakers s where s.transcript_id=p_transcript_id;

  update public.interview_transcripts
  set status='purged', purged_at=now(), entry_count=0, has_timestamps=false,
      error_code=null, error_message=null
  where id=p_transcript_id;

  /* Identifiers, counts, and a reason code. Never a line of transcript, a speaker label, a band or an
   * evidence excerpt -- an audit trail that quoted the interview would recreate, in a table with
   * longer retention and broader access, exactly what this function just deleted. */
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(transcript.organization_id,null,'interview_transcript.purged','interview_transcript',p_transcript_id,
    jsonb_build_object('interview_id',transcript.interview_id,'reason',p_reason,
      'analysis_runs_removed',purged_runs,'entries_removed',purged_entries));

  return jsonb_build_object('transcript_id',p_transcript_id,'purged',true,
    'analysis_runs_removed',purged_runs,'entries_removed',purged_entries);
end $$;
revoke all on function public.purge_interview_transcript(uuid,text) from public, anon, authenticated;
grant execute on function public.purge_interview_transcript(uuid,text) to service_role;

/* The sweep the scheduled worker runs.
 *
 * Two reasons a transcript goes: its retention window expired, or the candidate withdrew consent.
 * Withdrawal is checked against the LATEST consent event rather than a flag, so a candidate who
 * withdrew and later granted again for a fresh interview does not have the new one deleted.
 *
 * Bounded per run. A workspace that turns the feature on and immediately shortens retention could
 * otherwise put thousands of transcripts through one maintenance request.
 */
create or replace function public.purge_due_interview_transcripts(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target record;
  purged integer:=0; skipped integer:=0;
  outcome jsonb;
begin
  for target in
    select t.id, case when t.purge_due_at<=now() then 'retention_expired' else 'consent_withdrawn' end as reason
    from public.interview_transcripts t
    where t.purged_at is null
      and (
        t.purge_due_at<=now()
        or coalesce(public.interview_consent_status(t.interview_id),'') in ('withdrawn','declined')
      )
    order by t.purge_due_at
    limit greatest(coalesce(p_limit,50),1)
  loop
    outcome:=public.purge_interview_transcript(target.id,target.reason);
    if outcome ? 'purged' then purged:=purged+1; else skipped:=skipped+1; end if;
  end loop;

  return jsonb_build_object('purged',purged,'skipped',skipped);
end $$;
revoke all on function public.purge_due_interview_transcripts(integer) from public, anon, authenticated;
grant execute on function public.purge_due_interview_transcripts(integer) to service_role;

commit;
