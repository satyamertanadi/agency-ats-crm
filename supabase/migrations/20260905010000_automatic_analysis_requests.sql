begin;

/* Automatic analysis needs to request a run with nobody signed in, and request_interview_analysis
 * derives its requester from auth.uid(). Rather than duplicate its preconditions -- which is how the
 * consent check ends up existing twice and drifting -- the body moves into an internal function that
 * takes the requester explicitly, and both entry points delegate to it.
 *
 * The internal function is not granted to any client role. It performs no permission check of its
 * own, deliberately: its two callers do that, one against auth.uid() and one against the workspace's
 * explicit auto-analysis setting, and burying a third check here would make it unclear which one is
 * authoritative.
 */
create or replace function public.internal_request_interview_analysis(
  p_organization_id uuid,
  p_interview_id uuid,
  p_requested_by uuid,
  p_provider text,
  p_model text,
  p_prompt_version text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  interview public.interviews;
  core_id uuid; job_rubric_id uuid; candidate uuid; job uuid;
  transcript_hash text; rubric_hash text; job_hash text; candidate_hash text; combined text;
  existing public.interview_analysis_runs;
  new_run uuid; unmapped integer; ready_count integer; source_document uuid;
begin
  select * into interview from public.interviews
  where id=p_interview_id and organization_id=p_organization_id;
  if interview.id is null then raise exception 'interview_not_found'; end if;

  if coalesce(public.interview_consent_status(p_interview_id),'') <> 'granted' then
    raise exception 'transcript_consent_required';
  end if;

  select jc.candidate_id, jc.job_id into candidate, job
  from public.job_candidates jc where jc.id=interview.job_candidate_id;

  /* Order matters, because each of these is advice. A transcript that exists but still needs its
   * speakers mapped is never 'ready', so checking readiness first would tell a consultant to "add the
   * transcript" they just added. Existence, then mapping, then readiness. */
  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  select count(*) into unmapped from public.interview_transcript_speakers s
  join public.interview_transcripts t on t.id=s.transcript_id
  where t.interview_id=p_interview_id and t.purged_at is null and t.superseded_by_transcript_id is null
    and s.confirmed_at is null;
  if unmapped>0 then raise exception 'speaker_mapping_required'; end if;

  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  select id into core_id from public.interview_rubrics
  where organization_id=p_organization_id and rubric_type='core' and status='active';
  if core_id is null then raise exception 'core_rubric_required'; end if;

  select id, source_document_id into job_rubric_id, source_document from public.interview_rubrics
  where job_id=job and rubric_type='job' and status='active';
  if job_rubric_id is null then raise exception 'job_rubric_required'; end if;

  transcript_hash:=public.interview_transcript_bundle_hash(p_interview_id);
  rubric_hash:=public.interview_rubric_bundle_hash(core_id,job_rubric_id);
  job_hash:=public.interview_job_brief_hash(job,source_document);
  candidate_hash:=public.interview_candidate_input_hash(candidate);

  combined:=encode(sha256(convert_to(concat_ws(chr(31),
    transcript_hash,rubric_hash,job_hash,candidate_hash,p_prompt_version,p_model),'utf8')),'hex');

  /* The dedup that makes automatic analysis safe to call repeatedly. A Meet import, a manual request
   * and a speaker remap can all reach this within a minute of each other; identical inputs must
   * produce one paid run. */
  select * into existing from public.interview_analysis_runs
  where organization_id=p_organization_id and input_hash=combined
    and status in ('queued','processing','completed')
  limit 1;
  if existing.id is not null then
    return jsonb_build_object('run_id',existing.id,'status',existing.status,'reused',true);
  end if;

  insert into public.interview_analysis_runs(
    organization_id,interview_id,job_candidate_id,core_rubric_id,job_rubric_id,
    provider,model,prompt_version,transcript_bundle_hash,rubric_bundle_hash,
    job_input_hash,candidate_input_hash,input_hash,status,requested_by
  ) values (
    p_organization_id,p_interview_id,interview.job_candidate_id,core_id,job_rubric_id,
    p_provider,p_model,p_prompt_version,transcript_hash,rubric_hash,
    job_hash,candidate_hash,combined,'queued',p_requested_by
  ) returning id into new_run;

  insert into public.interview_analysis_run_transcripts(organization_id,analysis_run_id,transcript_id,sort_order)
  select p_organization_id,new_run,t.id,row_number() over (order by t.started_at nulls last, t.created_at)
  from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;

  insert into public.background_jobs(organization_id,job_type,payload,idempotency_key)
  values(p_organization_id,'interview_analysis',
    jsonb_build_object('analysis_run_id',new_run,'interview_id',p_interview_id),
    'interview_analysis:'||combined);

  return jsonb_build_object('run_id',new_run,'status','queued','reused',false);
end $$;
revoke all on function public.internal_request_interview_analysis(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;

-- The client entry point keeps its signature and its checks, and now delegates the body.
create or replace function public.request_interview_analysis(
  p_organization_id uuid,
  p_interview_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text
)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_use_interview_intelligence(p_organization_id) then raise exception 'permission_denied'; end if;
  if not public.can_access_interview_transcript(p_interview_id) then raise exception 'permission_denied'; end if;

  return public.internal_request_interview_analysis(
    p_organization_id,p_interview_id,auth.uid(),p_provider,p_model,p_prompt_version);
end $$;
revoke all on function public.request_interview_analysis(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.request_interview_analysis(uuid,uuid,text,text,text) to authenticated;

/* Automatic analysis: queues a request for the worker to make, rather than making it here.
 *
 * The model identifier lives in the worker's environment and nowhere else. Reading it from a database
 * setting would put a second copy somewhere it can drift, and a run pinned to the wrong model is a
 * run whose idempotency hash no longer matches anything -- so this queues intent and lets the one
 * component that knows the model turn it into a run.
 *
 * Attributed to the interview's organiser, not to "the system": a run with no requester is a paid
 * action nobody owns, and the cost, the audit trail and the rate limit should all land on a person.
 *
 * Called speculatively after an import and again after speaker mapping, so "not yet" is the ordinary
 * outcome and every refusal is a reason string rather than an exception.
 */
create or replace function public.maybe_queue_automatic_analysis(p_interview_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare interview public.interviews; auto_enabled boolean; organiser_user uuid; unmapped integer; ready_count integer;
begin
  select * into interview from public.interviews where id=p_interview_id;
  if interview.id is null then return jsonb_build_object('queued',false,'reason','interview_not_found'); end if;

  select interview_auto_analysis_enabled into auto_enabled
  from public.organization_settings where organization_id=interview.organization_id;
  if not coalesce(auto_enabled,false) then return jsonb_build_object('queued',false,'reason','auto_analysis_disabled'); end if;

  if coalesce(public.interview_consent_status(p_interview_id),'') <> 'granted' then
    return jsonb_build_object('queued',false,'reason','consent_required');
  end if;

  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then return jsonb_build_object('queued',false,'reason','transcript_required'); end if;

  select count(*) into unmapped from public.interview_transcript_speakers s
  join public.interview_transcripts t on t.id=s.transcript_id
  where t.interview_id=p_interview_id and t.purged_at is null
    and t.superseded_by_transcript_id is null and s.confirmed_at is null;
  if unmapped>0 then return jsonb_build_object('queued',false,'reason','speaker_mapping_required'); end if;

  select m.user_id into organiser_user from public.organization_members m
  where m.id=interview.organizer_member_id and m.status='active';
  if organiser_user is null then return jsonb_build_object('queued',false,'reason','organiser_unavailable'); end if;

  /* Keyed on the interview, so the import and the speaker-mapping call cannot queue two requests for
   * the same conversation. The run-level input hash catches the rest. */
  insert into public.background_jobs(organization_id,job_type,payload,idempotency_key)
  values(interview.organization_id,'interview_auto_analysis',
    jsonb_build_object('interview_id',p_interview_id,'requested_by',organiser_user),
    'interview_auto_analysis:'||p_interview_id::text)
  on conflict do nothing;

  return jsonb_build_object('queued',true,'reason',null);
end $$;
revoke all on function public.maybe_queue_automatic_analysis(uuid) from public, anon, authenticated;
grant execute on function public.maybe_queue_automatic_analysis(uuid) to service_role;

/* Speaker mapping is the moment a fetched transcript becomes analysable, so the check happens here
 * too. Declines silently when auto-analysis is off, which is the default. */
create or replace function public.bulk_confirm_interview_transcript_speakers(
  p_organization_id uuid,
  p_transcript_id uuid,
  p_mappings jsonb
)
returns integer language plpgsql security definer set search_path=public as $$
declare mapping jsonb; confirmed integer:=0; owning_interview uuid;
begin
  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then raise exception 'invalid_speaker_identity'; end if;

  for mapping in select * from jsonb_array_elements(p_mappings) loop
    perform public.confirm_interview_transcript_speaker(
      p_organization_id,
      (mapping->>'speaker_id')::uuid,
      mapping->>'speaker_role',
      nullif(mapping->>'member_id','')::uuid,
      nullif(mapping->>'candidate_id','')::uuid,
      nullif(mapping->>'contact_id','')::uuid
    );
    confirmed:=confirmed+1;
  end loop;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_transcript.speakers_confirmed','interview_transcript',p_transcript_id,
    jsonb_build_object('speaker_count',confirmed));

  select t.interview_id into owning_interview from public.interview_transcripts t where t.id=p_transcript_id;
  if owning_interview is not null then
    perform public.maybe_queue_automatic_analysis(owning_interview);
  end if;

  return confirmed;
end $$;
revoke all on function public.bulk_confirm_interview_transcript_speakers(uuid,uuid,jsonb) from public, anon;
grant execute on function public.bulk_confirm_interview_transcript_speakers(uuid,uuid,jsonb) to authenticated;

commit;
