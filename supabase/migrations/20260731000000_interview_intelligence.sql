begin;

/* Interview intelligence: the transcript of a Google Meet interview, and the AI reading of it.
 *
 * Until now the only thing that survived an interview was `interviews.notes` -- one free-text field
 * written from the "Record interview outcome" dialog. Everything actually said in the call was lost.
 *
 * Three tables, deliberately separate:
 *   interview_transcripts       the captured record. Source-agnostic by design: analysis reads only
 *                               this table, so replacing Google Meet with another capture path later
 *                               changes nothing downstream.
 *   interview_ai_notes          summary + candidate assessment. A draft until a consultant accepts it.
 *   interview_coaching_reviews  the consultant's own interviewing performance. Split into its own
 *                               table for exactly one reason: so RLS can hide it. Same reason
 *                               candidate_private_details is split from candidates.
 *
 * All three are service-written -- the Edge Functions hold the service role and the client cannot
 * forge a transcript, a score, or a performance rating. Authenticated users get SELECT policies and
 * one narrow RPC (accept_interview_notes) for the human review step, following the precedent set by
 * ai_evaluations / candidate_profile_versions / finalize_candidate_profile.
 */

insert into public.permissions(key,description) values
  ('interview_coaching.read','Read AI reviews of consultant interviewing performance'),
  ('interview_coaching.write','Manage AI reviews of consultant interviewing performance')
on conflict do nothing;

/* An AI grading a named member of staff is not ordinary pipeline data. The two keys above go to
 * owner and admin only -- and note the two branches that would otherwise pick them up silently:
 * 'manager' takes everything except an explicit deny-list, and 'readonly' takes every key matching
 * '%.read'. Both are amended here rather than left to leak the reviews to the reviewed. */
create or replace function public.seed_organization_roles(p_organization_id uuid)
returns table(role_key text,role_id uuid) language plpgsql security definer set search_path=public as $$
declare r record; new_id uuid;
begin
  for r in select * from (values
    ('owner','Agency Owner'),('admin','Administrator'),('manager','Recruitment Manager'),('consultant','Recruitment Consultant'),
    ('sourcer','Researcher / Sourcer'),('bd','Business Development Consultant'),('finance','Finance / Operations'),('readonly','Read-only User')
  ) as v(role_key,name) loop
    insert into public.roles(organization_id,name,role_key,is_system) values(p_organization_id,r.name,r.role_key,true) returning id into new_id;
    if r.role_key in ('owner','admin') then insert into public.role_permissions select new_id,key from public.permissions;
    elsif r.role_key='manager' then insert into public.role_permissions select new_id,key from public.permissions where key not in ('organization.manage','roles.manage','finance.write','interview_coaching.read','interview_coaching.write');
    elsif r.role_key='consultant' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','jobs.read','jobs.write','pipeline.move','submissions.read','submissions.write','activities.read','activities.write','tasks.read','tasks.write','placements.read','placements.write','reports.read','ai.use');
    elsif r.role_key='sourcer' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','jobs.read','pipeline.move','activities.read','activities.write','tasks.read','tasks.write','ai.use');
    elsif r.role_key='bd' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','commercial_terms.write','jobs.read','jobs.write','submissions.read','activities.read','activities.write','tasks.read','tasks.write','reports.read');
    elsif r.role_key='finance' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','jobs.read','placements.read','placements.write','finance.read','finance.write','reports.read','tasks.read','tasks.write');
    else insert into public.role_permissions select new_id,key from public.permissions where key like '%.read' and key<>'interview_coaching.read'; end if;
    role_key:=r.role_key; role_id:=new_id; return next;
  end loop;
end $$;

-- Organizations that already exist were seeded before these keys did.
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key
from public.roles r
cross join (values ('interview_coaching.read'),('interview_coaching.write')) as p(key)
where r.role_key in ('owner','admin')
on conflict do nothing;

create table public.interview_transcripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  source text not null default 'google_meet' check(source in ('google_meet')),
  status text not null default 'pending' check(status in ('pending','fetching','ready','unavailable','failed')),
  -- Meet resource names ("conferenceRecords/abc", "conferenceRecords/abc/transcripts/def"), kept so a
  -- refetch resolves the same conference instead of re-guessing from the meeting code.
  google_conference_record text,
  google_transcript_name text,
  language text,
  -- [{speaker_id,speaker_name,speaker_role,text,start_ms,end_ms}]. speaker_id is the Meet participant
  -- resource name; there is no email on it, so roles are resolved by display name (see the Edge
  -- Function) rather than by identity, and 'other' is an honest answer when that fails.
  entries jsonb not null default '[]'::jsonb,
  plain_text text not null default '',
  -- Computed from entry timings, never asked of the model: talk balance is arithmetic, and a
  -- rubric criterion that depends on it should not rest on an estimate.
  talk_time jsonb not null default '{"consultant_ms":0,"candidate_ms":0,"other_ms":0}'::jsonb,
  duration_seconds integer not null default 0 check(duration_seconds >= 0),
  entry_count integer not null default 0 check(entry_count >= 0),
  attempts integer not null default 0 check(attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  failure_code text,
  failure_message text,
  fetched_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(interview_id),
  check(status <> 'ready' or (entry_count > 0 and plain_text <> ''))
);

create index interview_transcripts_sweep
  on public.interview_transcripts(next_attempt_at)
  where status in ('pending','failed');
create index interview_transcripts_org_status
  on public.interview_transcripts(organization_id,status,created_at desc);

create table public.interview_ai_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  interview_transcript_id uuid not null references public.interview_transcripts(id) on delete cascade,
  ai_evaluation_id uuid not null references public.ai_evaluations(id),
  version integer not null default 1 check(version >= 1),
  status text not null default 'draft' check(status in ('draft','accepted')),
  prompt_version text not null,
  language text,
  generated_content jsonb not null,
  reviewed_content jsonb,
  -- Calculated from the evidence classifications by the application, never emitted by the model.
  score numeric(5,2) check(score is null or (score >= 0 and score <= 100)),
  input_hash text not null,
  degraded_reason text,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,interview_id,version),
  check(status <> 'accepted' or (reviewed_content is not null and accepted_at is not null))
);

create index interview_ai_notes_interview_version
  on public.interview_ai_notes(organization_id,interview_id,version desc);
create index interview_ai_notes_dedup
  on public.interview_ai_notes(organization_id,interview_id,input_hash)
  where status='draft';

create table public.interview_coaching_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  interview_ai_notes_id uuid not null references public.interview_ai_notes(id) on delete cascade,
  -- The consultant being reviewed. Nullable because an interview can be synced without an organizer
  -- resolved, and an unattributed rubric is still worth keeping over discarding the analysis.
  subject_member_id uuid references public.organization_members(id) on delete set null,
  rubric jsonb not null default '[]'::jsonb,
  rating_summary jsonb not null default '{}'::jsonb,
  missed_topics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(interview_ai_notes_id)
);

create index interview_coaching_reviews_subject
  on public.interview_coaching_reviews(organization_id,subject_member_id,created_at desc);

create trigger interview_transcripts_touch before update on public.interview_transcripts
  for each row execute function public.touch_updated_at();
create trigger interview_ai_notes_touch before update on public.interview_ai_notes
  for each row execute function public.touch_updated_at();

-- Same advisory-lock shape as assign_candidate_profile_version: concurrent regenerations of the same
-- interview must not race to the same version number.
create or replace function public.assign_interview_ai_notes_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||new.interview_id::text,0));
  select coalesce(max(version),0)+1 into new.version
  from public.interview_ai_notes
  where organization_id=new.organization_id and interview_id=new.interview_id;
  return new;
end $$;
revoke all on function public.assign_interview_ai_notes_version() from public,anon,authenticated;

create trigger interview_ai_notes_version
  before insert on public.interview_ai_notes
  for each row execute function public.assign_interview_ai_notes_version();

alter table public.interview_transcripts enable row level security;
alter table public.interview_ai_notes enable row level security;
alter table public.interview_coaching_reviews enable row level security;

/* Read-only for authenticated, matching ai_evaluations and candidate_profile_versions: everything
 * here is a machine-produced record, and the one human write (accepting a draft) goes through the
 * RPC below so the evidence and score cannot be edited into something the model never said. */
create policy interview_transcripts_read on public.interview_transcripts for select to authenticated
  using(public.has_permission(organization_id,'placements.read'));
create policy interview_ai_notes_read on public.interview_ai_notes for select to authenticated
  using(public.has_permission(organization_id,'placements.read'));
create policy interview_coaching_reviews_read on public.interview_coaching_reviews for select to authenticated
  using(public.has_permission(organization_id,'interview_coaching.read'));

/* Accepting a draft is the human review gate every AI flow in this schema ends with. It does three
 * things a direct UPDATE could not be trusted with: it refuses content that has lost its structure,
 * it re-pins the evidence and score from the generated draft so an edited body cannot rewrite the
 * model's findings, and it mirrors the headline onto interviews.notes so every existing surface that
 * already reads that field shows the outcome without knowing this feature exists. */
create or replace function public.accept_interview_notes(
  p_organization_id uuid,
  p_interview_notes_id uuid,
  p_reviewed_content jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare notes_row public.interview_ai_notes%rowtype; headline text;
begin
  if not public.has_permission(p_organization_id,'placements.write') or not public.has_permission(p_organization_id,'ai.use') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select * into notes_row from public.interview_ai_notes
  where id=p_interview_notes_id and organization_id=p_organization_id for update;
  if not found then raise exception 'interview_notes_not_found' using errcode='P0002'; end if;
  if not exists(
    select 1 from public.interviews i
    where i.id=notes_row.interview_id and i.organization_id=p_organization_id
  ) then raise exception 'invalid_interview_scope' using errcode='22023'; end if;
  if notes_row.status='accepted' then return notes_row.id; end if;
  if jsonb_typeof(p_reviewed_content)<>'object'
     or jsonb_typeof(p_reviewed_content->'summary')<>'object'
     -- Trimmed before the emptiness check: a whitespace-only headline would otherwise pass here and
     -- then blank interviews.notes, erasing a note the consultant had already written.
     or coalesce(trim(p_reviewed_content->'summary'->>'headline'),'')='' then
    raise exception 'invalid_interview_notes_content' using errcode='22023';
  end if;
  -- Evidence classifications drive the score, and the score is deterministic. Both are evaluation
  -- facts rather than editable copy, so they are restored from the generated draft either way.
  p_reviewed_content:=jsonb_set(
    p_reviewed_content,
    '{candidate_assessment,requirement_evidence}',
    coalesce(notes_row.generated_content->'candidate_assessment'->'requirement_evidence','[]'::jsonb),
    true
  );
  update public.interview_ai_notes
  set status='accepted',reviewed_content=p_reviewed_content,accepted_by=auth.uid(),accepted_at=now()
  where id=notes_row.id;
  headline:=left(trim(p_reviewed_content->'summary'->>'headline'),2000);
  update public.interviews set notes=headline where id=notes_row.interview_id and organization_id=p_organization_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_notes.accepted','interview',notes_row.interview_id,jsonb_build_object('interview_notes_id',notes_row.id,'version',notes_row.version));
  return notes_row.id;
end $$;
revoke all on function public.accept_interview_notes(uuid,uuid,jsonb) from public,anon;
grant execute on function public.accept_interview_notes(uuid,uuid,jsonb) to authenticated;

/* Bounds AI spend per organization the same way candidate_profile_token_spend_this_month does for
 * profiles -- summed in SQL so the Edge Function cannot be tricked into paging a month of rows. */
create or replace function public.interview_notes_token_spend_this_month(p_organization_id uuid)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::bigint
  from public.ai_evaluations
  where organization_id=p_organization_id
    and evaluation_type='interview_notes'
    and created_at >= date_trunc('month',now())
$$;
revoke all on function public.interview_notes_token_spend_this_month(uuid) from public,anon,authenticated;

/* The transcript row is what the client polls while Meet finishes producing a transcript, so it has
 * to reach an open drawer without a poll interval fast enough to be wasteful the rest of the time.
 * The notes and coaching tables stay off the publication: they are written once, at the end. */
do $$ begin
  -- Idempotent for the same reason 20260719020000 is: `alter publication ... add table` has no
  -- `if not exists`, and re-running must not fail on a table the publication already carries.
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='interview_transcripts'
  ) then
    execute 'alter publication supabase_realtime add table public.interview_transcripts';
  end if;
end $$;

commit;
