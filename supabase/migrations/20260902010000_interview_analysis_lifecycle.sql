begin;

-- WS4, second half: requesting an analysis and persisting its result.

/* Creates a queued run, or hands back the one that already covers these inputs.
 *
 * Idempotency is the whole point. An analysis is a paid call, and the two ways to pay twice for the
 * same answer are a double-click and a page refresh -- so the dedup is a database lookup under the
 * same transaction that inserts, backed by a partial unique index, rather than a check the caller
 * performs and then races against itself.
 *
 * Every precondition is re-checked here rather than trusted from the endpoint: this is the point
 * where money starts being spent, and each of these failures is one a person can act on.
 */
create or replace function public.request_interview_analysis(
  p_organization_id uuid,
  p_interview_id uuid,
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
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_use_interview_intelligence(p_organization_id) then raise exception 'permission_denied'; end if;

  select * into interview from public.interviews
  where id=p_interview_id and organization_id=p_organization_id;
  if interview.id is null then raise exception 'interview_not_found'; end if;
  if not public.can_access_interview_transcript(p_interview_id) then raise exception 'permission_denied'; end if;

  if coalesce(public.interview_consent_status(p_interview_id),'') <> 'granted' then
    raise exception 'transcript_consent_required';
  end if;

  select jc.candidate_id, jc.job_id into candidate, job
  from public.job_candidates jc where jc.id=interview.job_candidate_id;

  /* Order matters, because each of these is advice. A transcript that exists but still needs its
   * speakers mapped is never 'ready', so checking readiness first would tell a consultant to "add the
   * transcript" they just added. Existence, then mapping, then readiness.  */
  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  select count(*) into unmapped from public.interview_transcript_speakers s
  join public.interview_transcripts t on t.id=s.transcript_id
  where t.interview_id=p_interview_id and t.purged_at is null and t.superseded_by_transcript_id is null
    and s.confirmed_at is null;
  if unmapped>0 then raise exception 'speaker_mapping_required'; end if;

  -- Mapped, but the artifact itself never normalised cleanly.
  select count(*) into ready_count from public.interview_transcripts t
  where t.interview_id=p_interview_id and t.status='ready'
    and t.purged_at is null and t.superseded_by_transcript_id is null;
  if ready_count=0 then raise exception 'transcript_required'; end if;

  /* Both rubrics, because an analysis is measured against the agency's core standard AND the job's
   * blueprint. Missing either is a setup failure the owner can fix, not a reason to analyse against
   * half a yardstick. */
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

  -- Prompt version and model are folded in, so a prompt revision or a model change produces a new
  -- analysis rather than serving output written to the previous contract indefinitely.
  combined:=encode(sha256(convert_to(concat_ws(chr(31),
    transcript_hash,rubric_hash,job_hash,candidate_hash,p_prompt_version,p_model),'utf8')),'hex');

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
    job_hash,candidate_hash,combined,'queued',auth.uid()
  ) returning id into new_run;

  -- The exact bundle this run reads, frozen now. A later correction supersedes a transcript without
  -- changing what a historical run says it analysed.
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
revoke all on function public.request_interview_analysis(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.request_interview_analysis(uuid,uuid,text,text,text) to authenticated;

/* Writes a completed analysis in one transaction: assessments, findings, evidence and metrics.
 *
 * Partial results are worse than none. A run with a candidate assessment and no consultant one reads
 * as "the consultant was not assessed" rather than as a failed write, and a finding whose evidence
 * failed to insert is exactly the free-floating conclusion the evidence model exists to prevent.
 *
 * The worker has already validated the payload against the source manifest; this function's job is
 * atomicity and the structural constraints, not re-validation it cannot perform.
 */
create or replace function public.persist_interview_analysis(
  p_run_id uuid,
  p_assessments jsonb,
  p_metrics jsonb,
  p_metric_summary jsonb,
  p_input_tokens integer,
  p_output_tokens integer,
  p_processing_ms integer
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  run public.interview_analysis_runs;
  assessment jsonb; finding jsonb; evidence jsonb; metric jsonb;
  assessment_id uuid; finding_id uuid; sort integer;
begin
  select * into run from public.interview_analysis_runs where id=p_run_id for update;
  if run.id is null then raise exception 'analysis_run_not_found'; end if;
  if run.status='completed' then return run.id; end if;

  for assessment in select * from jsonb_array_elements(p_assessments) loop
    insert into public.interview_assessments(
      organization_id,analysis_run_id,interview_id,assessment_type,
      subject_candidate_id,subject_member_id,overall_band,confidence,summary
    ) values (
      run.organization_id,run.id,run.interview_id,assessment->>'assessment_type',
      nullif(assessment->>'subject_candidate_id','')::uuid,
      nullif(assessment->>'subject_member_id','')::uuid,
      assessment->>'overall_band',assessment->>'confidence',assessment->>'summary'
    ) returning id into assessment_id;

    sort:=0;
    for finding in select * from jsonb_array_elements(coalesce(assessment->'findings','[]'::jsonb)) loop
      insert into public.interview_assessment_findings(
        organization_id,assessment_id,rubric_item_id,category,result,score,severity,confidence,
        title,summary,coaching_suggestion,sort_order
      ) values (
        run.organization_id,assessment_id,nullif(finding->>'rubric_item_id','')::uuid,
        finding->>'category',finding->>'result',
        nullif(finding->>'score','')::integer,
        coalesce(nullif(finding->>'severity',''),'info'),
        finding->>'confidence',finding->>'title',finding->>'summary',
        nullif(finding->>'coaching_suggestion',''),sort
      ) returning id into finding_id;
      sort:=sort+1;

      for evidence in select * from jsonb_array_elements(coalesce(finding->'evidence','[]'::jsonb)) loop
        insert into public.interview_finding_evidence(
          organization_id,finding_id,source_type,source_record_id,source_locator,excerpt
        ) values (
          run.organization_id,finding_id,evidence->>'source_type',
          nullif(evidence->>'source_record_id','')::uuid,
          nullif(evidence->>'source_locator',''),
          nullif(evidence->>'excerpt','')
        );
      end loop;
    end loop;
  end loop;

  for metric in select * from jsonb_array_elements(coalesce(p_metrics,'[]'::jsonb)) loop
    insert into public.interview_conversation_metrics(
      organization_id,analysis_run_id,transcript_id,speaker_id,speaker_role,
      subject_member_id,subject_candidate_id,speech_ms,turn_count,average_turn_ms,longest_turn_ms
    ) values (
      run.organization_id,run.id,(metric->>'transcript_id')::uuid,(metric->>'speaker_id')::uuid,
      metric->>'speaker_role',
      nullif(metric->>'subject_member_id','')::uuid,
      nullif(metric->>'subject_candidate_id','')::uuid,
      coalesce((metric->>'speech_ms')::integer,0),
      coalesce((metric->>'turn_count')::integer,0),
      nullif(metric->>'average_turn_ms','')::integer,
      nullif(metric->>'longest_turn_ms','')::integer
    );
  end loop;

  if p_metric_summary is not null then
    insert into public.interview_conversation_metric_summaries(
      analysis_run_id,organization_id,timestamp_coverage,unknown_speech_ms,overlap_ms,overlap_count,metric_confidence
    ) values (
      run.id,run.organization_id,
      coalesce((p_metric_summary->>'timestamp_coverage')::numeric,0),
      coalesce((p_metric_summary->>'unknown_speech_ms')::integer,0),
      coalesce((p_metric_summary->>'overlap_ms')::integer,0),
      coalesce((p_metric_summary->>'overlap_count')::integer,0),
      coalesce(nullif(p_metric_summary->>'metric_confidence',''),'low')
    );
  end if;

  update public.interview_analysis_runs
  set status='completed',completed_at=now(),
      input_tokens=p_input_tokens,output_tokens=p_output_tokens,processing_ms=p_processing_ms
  where id=run.id;

  -- Identifiers and counts. No band, no summary, no evidence -- the audit says an analysis happened,
  -- not what it concluded.
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(run.organization_id,run.requested_by,'interview_analysis.completed','interview_analysis_run',run.id,
    jsonb_build_object('interview_id',run.interview_id,'assessment_count',jsonb_array_length(p_assessments)));

  return run.id;
end $$;
revoke all on function public.persist_interview_analysis(uuid,jsonb,jsonb,jsonb,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.persist_interview_analysis(uuid,jsonb,jsonb,jsonb,integer,integer,integer) to service_role;

/* Marks a run failed with a safe code. Kept as an RPC so the worker cannot accidentally write a
 * provider's raw error body -- which can quote the prompt, and therefore the transcript -- into a
 * column the interface renders. */
create or replace function public.fail_interview_analysis(p_run_id uuid, p_error_code text, p_error_message text)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  update public.interview_analysis_runs
  set status='failed',completed_at=now(),
      error_code=left(coalesce(p_error_code,'unexpected_error'),100),
      error_message=left(coalesce(p_error_message,''),500)
  where id=p_run_id;
  return p_run_id;
end $$;
revoke all on function public.fail_interview_analysis(uuid,text,text) from public, anon, authenticated;
grant execute on function public.fail_interview_analysis(uuid,text,text) to service_role;

commit;
