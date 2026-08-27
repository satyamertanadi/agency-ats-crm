begin;

-- Transcript ingestion and speaker mapping, WS3.
--
-- The parser, the transcript tables and the bounded paging RPC already exist. What lands here is the
-- write path: one transactional insert of metadata, speakers and entries, and the audited RPCs that
-- turn parser-supplied speaker labels into real people.

-- ---------------------------------------------------------------------------------------------
-- Ingestion
-- ---------------------------------------------------------------------------------------------

/* Metadata, speakers and entries in one transaction.
 *
 * Three PostgREST calls would leave a transcript with speakers and no entries if the third failed --
 * which reads as a successfully imported empty interview rather than as a failure, and would be
 * analysed as one.
 *
 * Consent is re-checked here rather than trusted from the caller. The Edge Function checks it too,
 * but this is the last point before candidate speech is stored, and "the caller said it was fine" is
 * not something the database should take on faith about a recording of a named person.
 */
create or replace function public.ingest_interview_transcript(
  p_organization_id uuid,
  p_interview_id uuid,
  p_created_by uuid,
  p_source text,
  p_checksum text,
  p_language_codes text[],
  p_has_timestamps boolean,
  p_completeness text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_duration_seconds integer,
  p_retention_days integer,
  p_supersedes_transcript_id uuid,
  p_speakers jsonb,
  p_entries jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid; existing_id uuid; entry_total integer; speaker_total integer;
begin
  if not exists(
    select 1 from public.interviews i
    where i.id=p_interview_id and i.organization_id=p_organization_id
  ) then raise exception 'interview_not_found'; end if;

  -- The gate the whole feature hangs on. Latest event wins; anything but an explicit grant refuses.
  if coalesce(public.interview_consent_status(p_interview_id),'') <> 'granted' then
    raise exception 'transcript_consent_required';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries)=0 then
    raise exception 'transcript_empty';
  end if;
  if p_speakers is null or jsonb_typeof(p_speakers) <> 'array' or jsonb_array_length(p_speakers)=0 then
    raise exception 'transcript_empty';
  end if;

  /* Content-addressed duplicate detection. The same file pasted twice is the same artifact, and
   * returning the original rather than raising means a double-click on Import is harmless. */
  select id into existing_id from public.interview_transcripts
  where interview_id=p_interview_id and checksum=p_checksum and purged_at is null;
  if existing_id is not null then
    return jsonb_build_object('transcript_id',existing_id,'duplicate',true,
      'status',(select status from public.interview_transcripts where id=existing_id));
  end if;

  if p_supersedes_transcript_id is not null and not exists(
    select 1 from public.interview_transcripts t
    where t.id=p_supersedes_transcript_id and t.organization_id=p_organization_id
      and t.interview_id=p_interview_id and t.purged_at is null
  ) then raise exception 'transcript_not_found'; end if;

  insert into public.interview_transcripts(
    organization_id,interview_id,source,status,language_codes,started_at,ended_at,duration_seconds,
    entry_count,has_timestamps,checksum,completeness,created_by,purge_due_at
  ) values (
    p_organization_id,p_interview_id,p_source,
    -- Always needs_mapping on arrival. Parser labels are strings off somebody's meeting tool; until a
    -- human says which string is the candidate, nothing downstream can attribute a word to anyone.
    'needs_mapping',
    coalesce(p_language_codes,'{}'::text[]),p_started_at,p_ended_at,p_duration_seconds,
    jsonb_array_length(p_entries),coalesce(p_has_timestamps,false),p_checksum,
    coalesce(p_completeness,'unknown'),p_created_by,
    now()+make_interval(days=>greatest(coalesce(p_retention_days,90),1))
  ) returning id into new_id;

  insert into public.interview_transcript_speakers(
    organization_id,transcript_id,source_speaker_id,display_name,speaker_role
  )
  select p_organization_id,new_id,s->>'sourceSpeakerId',nullif(s->>'displayName',''),'unknown'
  from jsonb_array_elements(p_speakers) s;
  get diagnostics speaker_total=row_count;

  /* Sequence numbers come from array position rather than from the payload. The parser already
   * orders, but a duplicated or missing number in the payload would violate the unique index and
   * fail the whole import for a reason nobody could act on. */
  insert into public.interview_transcript_entries(
    organization_id,transcript_id,speaker_id,sequence_number,start_ms,end_ms,text,language_code
  )
  select p_organization_id,new_id,sp.id,ord,
    nullif(e->>'startMs','')::integer,
    nullif(e->>'endMs','')::integer,
    e->>'text',
    nullif(e->>'languageCode','')
  from jsonb_array_elements(p_entries) with ordinality as t(e,ord)
  join public.interview_transcript_speakers sp
    on sp.transcript_id=new_id and sp.source_speaker_id=e->>'sourceSpeakerId';
  get diagnostics entry_total=row_count;

  -- An entry whose speaker label was not in the speaker list would be silently dropped by that join,
  -- and a transcript missing lines is worse than one that failed to import.
  if entry_total <> jsonb_array_length(p_entries) then
    raise exception 'transcript_speaker_mismatch';
  end if;

  if p_supersedes_transcript_id is not null then
    update public.interview_transcripts
    set superseded_by_transcript_id=new_id, superseded_at=now()
    where id=p_supersedes_transcript_id;
  end if;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_created_by,'interview_transcript.imported','interview_transcript',new_id,
    jsonb_build_object('interview_id',p_interview_id,'source',p_source,'entry_count',entry_total,
      'speaker_count',speaker_total,'supersedes',p_supersedes_transcript_id));

  return jsonb_build_object('transcript_id',new_id,'duplicate',false,'status','needs_mapping',
    'entry_count',entry_total,'speaker_count',speaker_total);
end $$;
revoke all on function public.ingest_interview_transcript(uuid,uuid,uuid,text,text,text[],boolean,text,timestamptz,timestamptz,integer,integer,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_interview_transcript(uuid,uuid,uuid,text,text,text[],boolean,text,timestamptz,timestamptz,integer,integer,uuid,jsonb,jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Speaker mapping
-- ---------------------------------------------------------------------------------------------

/* Turns one parser label into one person.
 *
 * Cross-workspace mapping is already unrepresentable -- the speaker table's identity columns carry
 * composite (id, organization_id) foreign keys -- so this does not re-check tenancy. What it does is
 * enforce the role/identity agreement the constraint cannot express on its own, record who decided,
 * and promote the transcript to `ready` once every speaker has been decided.
 *
 * `confirmed_at` is the thing downstream trusts. An automatic suggestion may fill member_id, but only
 * a person sets confirmed_by -- mapping confidence never overrides an explicit confirmation.
 */
create or replace function public.confirm_interview_transcript_speaker(
  p_organization_id uuid,
  p_speaker_id uuid,
  p_speaker_role text,
  p_member_id uuid default null,
  p_candidate_id uuid default null,
  p_contact_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare target public.interview_transcript_speakers; owning_interview uuid; unresolved integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select s.* into target from public.interview_transcript_speakers s
  where s.id=p_speaker_id and s.organization_id=p_organization_id
  for update;
  if target.id is null then raise exception 'transcript_speaker_not_found'; end if;

  select t.interview_id into owning_interview from public.interview_transcripts t where t.id=target.transcript_id;
  if not public.can_use_interview_intelligence(p_organization_id)
     or not public.can_access_interview_transcript(owning_interview) then
    raise exception 'permission_denied';
  end if;

  if p_speaker_role not in ('consultant','candidate','client','other','unknown') then
    raise exception 'invalid_speaker_role';
  end if;
  if num_nonnulls(p_member_id,p_candidate_id,p_contact_id) > 1 then
    raise exception 'invalid_speaker_identity';
  end if;
  -- A consultant with nobody behind it cannot be a performance subject, and a candidate with nobody
  -- behind it cannot be the person a fit assessment is about.
  if p_speaker_role='consultant' and p_member_id is null then raise exception 'invalid_speaker_identity'; end if;
  if p_speaker_role='candidate' and p_candidate_id is null then raise exception 'invalid_speaker_identity'; end if;
  if p_speaker_role='client' and p_contact_id is null then raise exception 'invalid_speaker_identity'; end if;

  update public.interview_transcript_speakers
  set speaker_role=p_speaker_role,
      member_id=case when p_speaker_role='consultant' then p_member_id else null end,
      candidate_id=case when p_speaker_role='candidate' then p_candidate_id else null end,
      contact_id=case when p_speaker_role='client' then p_contact_id else null end,
      confirmed_by=auth.uid(),
      confirmed_at=now()
  where id=p_speaker_id;

  /* A transcript is ready when every speaker has been decided -- including the ones decided to be
   * `other` or `unknown`, which are real answers. Unknown speech stays visible in the metrics rather
   * than blocking the import forever. */
  select count(*) into unresolved from public.interview_transcript_speakers
  where transcript_id=target.transcript_id and confirmed_at is null;

  update public.interview_transcripts
  set status=case when unresolved=0 then 'ready' else 'needs_mapping' end
  where id=target.transcript_id and status in ('needs_mapping','ready');

  return p_speaker_id;
end $$;
revoke all on function public.confirm_interview_transcript_speaker(uuid,uuid,text,uuid,uuid,uuid) from public, anon;
grant execute on function public.confirm_interview_transcript_speaker(uuid,uuid,text,uuid,uuid,uuid) to authenticated;

/* The same decision for a whole transcript in one round trip, because mapping is done as one act at
 * one screen: four speakers confirmed one at a time is four chances to leave it half-finished, and a
 * half-mapped transcript is exactly the state that produces a confident, wrong speaking share. */
create or replace function public.bulk_confirm_interview_transcript_speakers(
  p_organization_id uuid,
  p_transcript_id uuid,
  p_mappings jsonb
)
returns integer language plpgsql security definer set search_path=public as $$
declare mapping jsonb; confirmed integer:=0;
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

  -- Recorded once for the act, not once per speaker: the audit question is "who mapped this
  -- transcript", and one row per label would bury that under four.
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_transcript.speakers_confirmed','interview_transcript',p_transcript_id,
    jsonb_build_object('speaker_count',confirmed));

  return confirmed;
end $$;
revoke all on function public.bulk_confirm_interview_transcript_speakers(uuid,uuid,jsonb) from public, anon;
grant execute on function public.bulk_confirm_interview_transcript_speakers(uuid,uuid,jsonb) to authenticated;

/* Everything the import and mapping screens need about one interview's transcripts, in one call.
 * Returns the current bundle plus how much of each is still undecided. */
create or replace function public.get_interview_transcript_overview(p_organization_id uuid, p_interview_id uuid)
returns table(
  transcript_id uuid,
  source text,
  status text,
  entry_count integer,
  has_timestamps boolean,
  completeness text,
  created_at timestamptz,
  purge_due_at timestamptz,
  superseded_by_transcript_id uuid,
  unmapped_speaker_count integer,
  speaker_count integer
)
language sql stable security definer set search_path=public as $$
  select t.id,t.source,t.status,t.entry_count,t.has_timestamps,t.completeness,t.created_at,t.purge_due_at,
    t.superseded_by_transcript_id,
    (select count(*) from public.interview_transcript_speakers s where s.transcript_id=t.id and s.confirmed_at is null)::integer,
    (select count(*) from public.interview_transcript_speakers s where s.transcript_id=t.id)::integer
  from public.interview_transcripts t
  where t.interview_id=p_interview_id
    and t.organization_id=p_organization_id
    and t.purged_at is null
    and public.can_access_interview_transcript(t.interview_id)
  order by t.created_at desc
$$;
revoke all on function public.get_interview_transcript_overview(uuid,uuid) from public, anon;
grant execute on function public.get_interview_transcript_overview(uuid,uuid) to authenticated;

commit;
