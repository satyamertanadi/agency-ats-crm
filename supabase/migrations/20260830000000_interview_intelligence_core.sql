begin;

-- Interview Intelligence, Release A0 domain.
--
-- Two assessments per analysed interview, kept independent on purpose: what the candidate's evidence
-- supports, and how thoroughly the consultant interviewed. A weak interview must never lower the
-- candidate -- a question that was never asked produces `not_evidenced` against the candidate and a
-- coverage finding against the consultant. Everything the model concludes is immutable and must
-- resolve to stored evidence; disagreement is an append-only record alongside it, never an edit.
--
-- The design contract, including the five points where the implementation plan and this repository
-- disagreed, is docs/interview-intelligence.md. Consent policy is docs/interview-transcript-consent.md.

-- ---------------------------------------------------------------------------------------------
-- Workspace settings
-- ---------------------------------------------------------------------------------------------

-- Disabled for every existing organization, including the ones already running. Turning this on is a
-- deliberate act by an owner who has read what it does, not a side effect of deploying it.
alter table public.organization_settings
  add column if not exists interview_intelligence_enabled boolean not null default false,
  add column if not exists transcript_retention_days integer not null default 90,
  add column if not exists interview_rubric_generation_enabled boolean not null default true,
  add column if not exists interview_consent_notice_version text;

-- Bounded in both directions. The floor stops a workspace setting retention so short that the feature
-- silently stops working; the ceiling is what makes the consent conversation truthful -- an agency
-- cannot promise a candidate their interview is kept "for a while" and mean forever.
alter table public.organization_settings
  drop constraint if exists organization_settings_transcript_retention_range;
alter table public.organization_settings
  add constraint organization_settings_transcript_retention_range
  check (transcript_retention_days between 7 and 365);

comment on column public.organization_settings.interview_intelligence_enabled is
  'Master switch. Off for every organization until an owner turns it on.';
comment on column public.organization_settings.transcript_retention_days is
  'Days a transcript survives before scheduled-maintenance purges it and everything derived from it.';
comment on column public.organization_settings.interview_consent_notice_version is
  'Identifier of the transcription notice text candidates were shown, recorded against each consent event.';

-- ---------------------------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------------------------

-- Four keys rather than one. `use` is operational (import a transcript, ask for an analysis),
-- `view_own` is a consultant seeing findings about their own interviews, `review_team` is the
-- management view over colleagues, and `configure` is the blueprint and settings. Separating
-- view_own from review_team is what stops ordinary candidate access from turning into a window onto
-- a colleague's interview technique.
insert into public.permissions(key,description) values
  ('interview_intelligence.use','Import interview transcripts and request analysis'),
  ('interview_intelligence.view_own','See interview quality findings about your own interviews'),
  ('interview_intelligence.review_team','Review interview quality findings across the team'),
  ('interview_intelligence.configure','Configure interview blueprints and Interview Intelligence settings')
on conflict (key) do nothing;

/* The implementation plan's permission matrix names Owner, Admin, Manager, Consultant, Sourcer, BD,
 * Finance and Read-only. 20260810070000_three_seeded_roles.sql deliberately collapsed the pre-baked
 * bundles to owner / consultant / readonly, retiring the other five wherever nobody held one, while
 * leaving every permission KEY intact. The security intent maps without resurrecting them:
 * owner takes all four, consultant takes use + view_own, readonly takes none, and review_team is
 * reached through the explicit key -- exactly the shape can_view_team_reports already uses. Custom
 * roles receive nothing automatically. */
create or replace function public.seed_organization_roles(p_organization_id uuid)
returns table(role_key text,role_id uuid) language plpgsql security definer set search_path=public as $$
declare r record; new_id uuid;
begin
  for r in select * from (values
    ('owner','Agency Owner'),('consultant','Recruitment Consultant'),('readonly','Read-only User')
  ) as v(role_key,name) loop
    insert into public.roles(organization_id,name,role_key,is_system) values(p_organization_id,r.name,r.role_key,true) returning id into new_id;
    if r.role_key='owner' then insert into public.role_permissions select new_id,key from public.permissions;
    elsif r.role_key='consultant' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','jobs.read','jobs.write','pipeline.move','submissions.read','submissions.write','activities.read','activities.write','tasks.read','tasks.write','placements.read','interviews.write','offers.write','placements.write','reports.read','ai.use','interview_intelligence.use','interview_intelligence.view_own');
    else insert into public.role_permissions select new_id,key from public.permissions where key like '%.read'; end if;
    role_key:=r.role_key; role_id:=new_id; return next;
  end loop;
end $$;
revoke all on function public.seed_organization_roles(uuid) from public, anon, authenticated;

-- Backfill organizations provisioned before this migration. Only the two system bundles are touched:
-- a custom role never gains a permission because a migration ran, and readonly gains nothing at all.
insert into public.role_permissions(role_id,permission_key)
select r.id, p.key
from public.roles r
cross join (values
  ('interview_intelligence.use'),
  ('interview_intelligence.view_own'),
  ('interview_intelligence.review_team'),
  ('interview_intelligence.configure')
) as p(key)
where r.is_system and r.role_key='owner'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id, p.key
from public.roles r
cross join (values
  ('interview_intelligence.use'),
  ('interview_intelligence.view_own')
) as p(key)
where r.is_system and r.role_key='consultant'
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- Composite identity keys
-- ---------------------------------------------------------------------------------------------

/* Every reference this domain makes to an existing record is tenancy-checked by the database rather
 * than by the code that writes it.
 *
 * A speaker mapping is the clearest case: `member_id uuid references organization_members(id)` is
 * satisfied by ANY member row in the instance, so a Northstar transcript could name a Rival
 * consultant as its subject and the foreign key would happily resolve. That is a cross-tenant write
 * reachable from ordinary user input -- picking a name from a list -- and RLS does not catch it,
 * because RLS governs which rows you can SEE, not which ids you may store in a column.
 *
 * Referencing (id, organization_id) instead makes the mismatch unrepresentable. `id` is already the
 * primary key of each table below, so these uniqueness constraints assert nothing new about the data;
 * they exist only to give the composite foreign keys something to point at. */
alter table public.organization_members add constraint organization_members_id_org_key unique (id, organization_id);
alter table public.candidates add constraint candidates_id_org_key unique (id, organization_id);
alter table public.contacts add constraint contacts_id_org_key unique (id, organization_id);
alter table public.jobs add constraint jobs_id_org_key unique (id, organization_id);
alter table public.job_candidates add constraint job_candidates_id_org_key unique (id, organization_id);
alter table public.interviews add constraint interviews_id_org_key unique (id, organization_id);
alter table public.documents add constraint documents_id_org_key unique (id, organization_id);

-- ---------------------------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------------------------

-- The caller's member id in one organization, or null. Subject-scoped visibility ("my own findings")
-- needs the member id rather than the user id, because every subject column in this domain points at
-- organization_members.
create or replace function public.my_member_id(p_organization_id uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select m.id from public.organization_members m
  where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active'
$$;
revoke all on function public.my_member_id(uuid) from public, anon;
grant execute on function public.my_member_id(uuid) to authenticated;

/* Who may read the raw record of what was said in an interview.
 *
 * Deliberately NOT "anyone who can read the candidate". General candidate access is held by every
 * consultant on the desk, and a transcript is a recording of a named colleague conducting an
 * interview as much as it is candidate data -- treating it as ordinary candidate data would hand the
 * whole team a window onto each other's technique that nobody agreed to.
 *
 * So: team reviewers, or someone who was actually in the room (the organiser, or a mapped attendee).
 * Feature-disabled workspaces get nothing regardless of permission. */
create or replace function public.can_access_interview_transcript(p_interview_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.interviews i
    join public.organization_settings s on s.organization_id=i.organization_id
    where i.id=p_interview_id
      and s.interview_intelligence_enabled
      and public.is_organization_member(i.organization_id)
      and (
        public.has_permission(i.organization_id,'interview_intelligence.review_team')
        or (
          public.has_permission(i.organization_id,'interview_intelligence.use')
          and (
            i.organizer_member_id = public.my_member_id(i.organization_id)
            or exists(
              select 1 from public.interview_attendees a
              where a.interview_id=i.id and a.member_id = public.my_member_id(i.organization_id)
            )
          )
        )
      )
  )
$$;
revoke all on function public.can_access_interview_transcript(uuid) from public, anon;
grant execute on function public.can_access_interview_transcript(uuid) to authenticated;

-- Operational use of the feature: the master switch and the `use` permission together. Every write
-- path in this domain goes through this rather than checking the permission alone, so that turning
-- the feature off actually stops it rather than merely hiding it.
create or replace function public.can_use_interview_intelligence(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_settings s
    where s.organization_id=p_organization_id
      and s.interview_intelligence_enabled
      and public.has_permission(p_organization_id,'interview_intelligence.use')
  )
$$;
revoke all on function public.can_use_interview_intelligence(uuid) from public, anon;
grant execute on function public.can_use_interview_intelligence(uuid) to authenticated;

create or replace function public.can_review_interview_quality(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_settings s
    where s.organization_id=p_organization_id
      and s.interview_intelligence_enabled
      and public.has_permission(p_organization_id,'interview_intelligence.review_team')
  )
$$;
revoke all on function public.can_review_interview_quality(uuid) from public, anon;
grant execute on function public.can_review_interview_quality(uuid) to authenticated;

create or replace function public.can_configure_interview_intelligence(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_permission(p_organization_id,'interview_intelligence.configure')
$$;
revoke all on function public.can_configure_interview_intelligence(uuid) from public, anon;
grant execute on function public.can_configure_interview_intelligence(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------------------------------

/* Append-oriented history, never a flag. The current state is the latest event, and the sequence is
 * what an audit actually asks for: a candidate who granted, withdrew, then granted again for a later
 * interview is a different situation from one who never withdrew, and "was this interview analysed
 * lawfully" is answered by the event that was current when the run happened -- not by whatever a
 * mutable column holds today.
 *
 * notice_* records what the candidate was SHOWN; status/consent_method record what they AGREED to.
 * A platform transcription notice is evidence of the former and never of the latter, so a workspace
 * relying on the meeting tool's banner alone cannot analyse anything. */
create table public.interview_transcription_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null,
  candidate_id uuid not null,
  foreign key (interview_id, organization_id) references public.interviews(id, organization_id) on delete cascade,
  foreign key (candidate_id, organization_id) references public.candidates(id, organization_id) on delete cascade,
  status text not null check (status in ('granted','declined','withdrawn')),
  consent_method text not null check (consent_method in ('spoken','written','other')),
  notice_method text check (notice_method is null or notice_method in ('spoken','written','platform_notice','other')),
  notice_version text,
  evidence text,
  occurred_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint interview_consent_evidence_bounded check (evidence is null or char_length(evidence) <= 2000)
);
create index interview_consents_current on public.interview_transcription_consents(interview_id, occurred_at desc, created_at desc);
create index interview_consents_org on public.interview_transcription_consents(organization_id, created_at desc);

-- The latest consent event for an interview. One implementation, used by RLS, by the analysis request
-- path and by the UI, so "is this interview consented" cannot mean three different things.
/* Deliberately security INVOKER, unlike most functions in this schema.
 *
 * As a definer it would bypass RLS, and since it takes a bare interview id and checks nothing, any
 * authenticated user in any workspace who held that id would learn whether the interview had been
 * consented to. As an invoker the table's own policy applies, so the answer is null for anyone who
 * could not have read the row anyway -- indistinguishable from "no consent recorded", which is the
 * correct thing for a stranger to see. It also means the rule lives in exactly one place instead of
 * being restated here and drifting from the policy. */
create or replace function public.interview_consent_status(p_interview_id uuid)
returns text language sql stable security invoker set search_path=public as $$
  select c.status
  from public.interview_transcription_consents c
  where c.interview_id=p_interview_id
  order by c.occurred_at desc, c.created_at desc
  limit 1
$$;
revoke all on function public.interview_consent_status(uuid) from public, anon;
grant execute on function public.interview_consent_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Rubrics
-- ---------------------------------------------------------------------------------------------

/* An analysis reads two active rubrics at once -- the agency core rubric and the job-specific one --
 * so a run is never described by a single rubric_id.
 *
 * job_brief_hash is computed over interview-relevant job inputs only. Deriving staleness from
 * jobs.updated_at would mark the blueprint outdated when somebody reassigns the job owner, which
 * trains people to ignore the warning. */
create table public.interview_rubrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid,
  rubric_type text not null check (rubric_type in ('core','job')),
  name text not null,
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  job_brief_hash text,
  source_document_id uuid,
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade,
  -- The column list matters: a bare `set null` on a composite key would null organization_id too,
  -- which is NOT NULL. Postgres 15+ (this project is on 17) lets the action name the column that
  -- should be cleared, so deleting a JD detaches it from the blueprint instead of failing.
  foreign key (source_document_id, organization_id) references public.documents(id, organization_id) on delete set null (source_document_id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  activated_by uuid references auth.users(id),
  activated_at timestamptz,
  archived_at timestamptz,
  -- A core rubric belongs to the agency; a job rubric belongs to exactly one job.
  constraint interview_rubric_job_scope check (
    (rubric_type='core' and job_id is null) or (rubric_type='job' and job_id is not null)
  ),
  constraint interview_rubric_activation_complete check (
    (status='active' and activated_at is not null and activated_by is not null)
    or status <> 'active'
  ),
  -- Target for the composite foreign keys below. Every reference inside this domain carries
  -- organization_id too, so a row can never point at a sibling in another workspace.
  unique (id, organization_id)
);
-- One active core rubric per organization, one active rubric per job. Partial unique indexes rather
-- than a trigger: the constraint is what the product promises, and the database should be the thing
-- that refuses to break it.
create unique index interview_rubrics_one_active_core
  on public.interview_rubrics(organization_id)
  where rubric_type='core' and status='active';
create unique index interview_rubrics_one_active_job
  on public.interview_rubrics(job_id)
  where rubric_type='job' and status='active';
create index interview_rubrics_org_lookup on public.interview_rubrics(organization_id, rubric_type, status);

create table public.interview_rubric_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rubric_id uuid not null,
  foreign key (rubric_id, organization_id) references public.interview_rubrics(id, organization_id) on delete cascade,
  unique (id, organization_id),
  dimension text not null check (dimension in ('essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity')),
  item_type text not null check (item_type in ('essential_question','requirement','role_presentation','logistics','next_steps','quality_criterion')),
  label text not null,
  question_text text,
  evidence_expected text,
  requirement_level text not null default 'nice_to_have' check (requirement_level in ('must_have','nice_to_have','not_applicable')),
  weight numeric(5,2) not null default 1 check (weight >= 0 and weight <= 10),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index interview_rubric_items_rubric on public.interview_rubric_items(rubric_id, sort_order);

/* A rubric is the yardstick a historical analysis was measured against, so editing one after
 * activation would silently rewrite the meaning of every run that cites it. Activated rubrics are
 * frozen: produce a new version instead. Only the lifecycle columns may move, and only forwards. */
create or replace function public.guard_interview_rubric_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status in ('active','archived') then
    if new.rubric_type is distinct from old.rubric_type
      or new.job_id is distinct from old.job_id
      or new.version is distinct from old.version
      or new.job_brief_hash is distinct from old.job_brief_hash
      or new.source_document_id is distinct from old.source_document_id
      or new.organization_id is distinct from old.organization_id then
      raise exception 'interview_rubric_immutable_after_activation';
    end if;
  end if;
  if old.status='archived' and new.status <> 'archived' then
    raise exception 'interview_rubric_archived_is_final';
  end if;
  return new;
end $$;
create trigger interview_rubrics_immutable
  before update on public.interview_rubrics
  for each row execute function public.guard_interview_rubric_immutability();

create or replace function public.guard_interview_rubric_items_frozen()
returns trigger language plpgsql set search_path=public as $$
declare parent_status text; target_rubric uuid;
begin
  -- NEW is unassigned in a DELETE trigger and OLD is unassigned in an INSERT one, so the branch has
  -- to be on TG_OP. Reaching for the wrong one raises "record is not assigned yet" at runtime, which
  -- would only surface the first time somebody deleted a draft item.
  if tg_op = 'DELETE' then target_rubric := old.rubric_id; else target_rubric := new.rubric_id; end if;

  select status into parent_status from public.interview_rubrics where id = target_rubric;

  -- A cascade from the rubric itself leaves no parent row to check, and must not be blocked.
  if parent_status is not null and parent_status in ('active','archived') then
    raise exception 'interview_rubric_items_frozen_after_activation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger interview_rubric_items_frozen
  before insert or update or delete on public.interview_rubric_items
  for each row execute function public.guard_interview_rubric_items_frozen();

/* Postgres grants EXECUTE to PUBLIC on every new function, and nothing in this schema alters that
 * default. audit_function_grants() excludes trigger functions -- Postgres refuses to invoke one
 * outside a trigger context regardless of grant, so the entry is inert -- but leaving it there is an
 * ACL that says something the schema does not mean, and the repository has already had to clean up
 * that class of entry twice. */
revoke all on function public.guard_interview_rubric_immutability() from public, anon, authenticated;
revoke all on function public.guard_interview_rubric_items_frozen() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Transcripts
-- ---------------------------------------------------------------------------------------------

/* Transcript state and analysis state are separate lifecycles. A transcript is received, normalised,
 * possibly waiting on speaker mapping, then ready; it is never "analysing" or "completed", because
 * those describe a run and one interview can carry several transcripts across several runs.
 *
 * A corrected import supersedes its predecessor rather than mutating it: the old artifact's metadata
 * stays, so a historical run can still say what it actually read. */
create table public.interview_transcripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null,
  foreign key (interview_id, organization_id) references public.interviews(id, organization_id) on delete cascade,
  source text not null check (source in ('manual_text','manual_file','google_meet')),
  external_resource_name text,
  status text not null default 'received' check (status in ('received','normalizing','needs_mapping','ready','failed','purged')),
  language_codes text[] not null default '{}'::text[],
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  entry_count integer not null default 0 check (entry_count >= 0),
  has_timestamps boolean not null default false,
  checksum text not null,
  input_version integer not null default 1,
  completeness text not null default 'unknown' check (completeness in ('complete','partial','unknown')),
  error_code text,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purge_due_at timestamptz not null,
  purged_at timestamptz,
  superseded_by_transcript_id uuid,
  superseded_at timestamptz,
  constraint interview_transcript_window check (ended_at is null or started_at is null or ended_at >= started_at),
  constraint interview_transcript_supersede_complete check (
    (superseded_by_transcript_id is null and superseded_at is null)
    or (superseded_by_transcript_id is not null and superseded_at is not null)
  ),
  constraint interview_transcript_no_self_supersede check (superseded_by_transcript_id is null or superseded_by_transcript_id <> id),
  unique (id, organization_id)
);
create trigger interview_transcripts_touch before update on public.interview_transcripts
for each row execute function public.touch_updated_at();

-- Self-referencing, so it is added after the table exists and its (id, organization_id) key is in
-- place. A correction can only supersede a transcript in the same workspace.
alter table public.interview_transcripts
  add constraint interview_transcripts_supersedes_fkey
  foreign key (superseded_by_transcript_id, organization_id)
  references public.interview_transcripts(id, organization_id)
  on delete set null (superseded_by_transcript_id);

-- The same file imported twice is the same artifact. Scoped to the interview rather than the
-- organization: the same generic transcript legitimately belongs to two different interviews.
create unique index interview_transcripts_dedupe
  on public.interview_transcripts(interview_id, checksum)
  where purged_at is null;
create index interview_transcripts_interview on public.interview_transcripts(interview_id, created_at desc);
-- Drives the retention sweep inside scheduled-maintenance.
create index interview_transcripts_purge_due on public.interview_transcripts(purge_due_at)
  where purged_at is null;

/* The transcripts a fresh analysis would read right now: ready, not purged, not superseded. One
 * interview can legitimately carry several -- a Meet session split in two, or a manual transcript
 * plus a correction -- so "the transcript for this interview" is a bundle, not a row. */
create or replace function public.current_interview_transcripts(p_interview_id uuid)
returns setof public.interview_transcripts language sql stable security definer set search_path=public as $$
  select t.* from public.interview_transcripts t
  where t.interview_id=p_interview_id
    and t.status='ready'
    and t.purged_at is null
    and t.superseded_by_transcript_id is null
  order by t.started_at nulls last, t.created_at
$$;
/* Service-side only, following candidate_profile_token_spend_this_month: the analysis worker resolves
 * the bundle, no client has a reason to. The explicit grant matters -- service_role's EXECUTE comes
 * from PUBLIC, so revoking PUBLIC takes it away too, and the worker would fail with "permission
 * denied for function" the first time it ran. */
revoke all on function public.current_interview_transcripts(uuid) from public, anon, authenticated;
grant execute on function public.current_interview_transcripts(uuid) to service_role;

create table public.interview_transcript_speakers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transcript_id uuid not null,
  foreign key (transcript_id, organization_id) references public.interview_transcripts(id, organization_id) on delete cascade,
  unique (id, organization_id),
  source_speaker_id text not null,
  display_name text,
  speaker_role text not null default 'unknown' check (speaker_role in ('consultant','candidate','client','other','unknown')),
  -- Composite so a transcript cannot name someone from another workspace as its speaker. This is the
  -- mapping a user drives from a picker, so it is the reference most exposed to a wrong id.
  member_id uuid,
  candidate_id uuid,
  contact_id uuid,
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id) on delete set null (member_id),
  foreign key (candidate_id, organization_id) references public.candidates(id, organization_id) on delete set null (candidate_id),
  foreign key (contact_id, organization_id) references public.contacts(id, organization_id) on delete set null (contact_id),
  mapping_confidence numeric(4,3) check (mapping_confidence is null or (mapping_confidence >= 0 and mapping_confidence <= 1)),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (transcript_id, source_speaker_id),
  -- A speaker resolves to at most one identity, and the identity has to match the claimed role.
  constraint interview_speaker_single_identity check (num_nonnulls(member_id,candidate_id,contact_id) <= 1),
  constraint interview_speaker_role_identity check (
    (speaker_role='consultant' and candidate_id is null and contact_id is null)
    or (speaker_role='candidate' and member_id is null and contact_id is null)
    or (speaker_role='client' and member_id is null and candidate_id is null)
    or speaker_role in ('other','unknown')
  ),
  constraint interview_speaker_confirmation_complete check (
    (confirmed_by is null and confirmed_at is null) or (confirmed_by is not null and confirmed_at is not null)
  )
);
create index interview_speakers_transcript on public.interview_transcript_speakers(transcript_id);

create table public.interview_transcript_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transcript_id uuid not null,
  speaker_id uuid not null,
  foreign key (transcript_id, organization_id) references public.interview_transcripts(id, organization_id) on delete cascade,
  foreign key (speaker_id, organization_id) references public.interview_transcript_speakers(id, organization_id) on delete cascade,
  sequence_number integer not null check (sequence_number >= 0),
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer check (end_ms is null or end_ms >= 0),
  text text not null check (char_length(btrim(text)) > 0),
  language_code text,
  created_at timestamptz not null default now(),
  unique (transcript_id, sequence_number),
  constraint interview_entry_timespan check (start_ms is null or end_ms is null or end_ms >= start_ms)
);
create index interview_entries_paging on public.interview_transcript_entries(transcript_id, sequence_number);
create index interview_entries_speaker on public.interview_transcript_entries(transcript_id, speaker_id);

-- ---------------------------------------------------------------------------------------------
-- Analysis runs
-- ---------------------------------------------------------------------------------------------

/* No raw model response is stored. The validated structured result IS the persisted output, which
 * keeps a second copy of the transcript and the candidate's answers out of a table with its own
 * retention, its own access rules and its own export path. */
create table public.interview_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null,
  job_candidate_id uuid not null,
  core_rubric_id uuid not null,
  job_rubric_id uuid not null,
  foreign key (interview_id, organization_id) references public.interviews(id, organization_id) on delete cascade,
  foreign key (job_candidate_id, organization_id) references public.job_candidates(id, organization_id) on delete cascade,
  -- A run cites the exact rubric versions it was measured against, and both must belong to the same
  -- workspace as the run.
  foreign key (core_rubric_id, organization_id) references public.interview_rubrics(id, organization_id),
  foreign key (job_rubric_id, organization_id) references public.interview_rubrics(id, organization_id),
  provider text not null,
  model text not null,
  prompt_version text not null,
  transcript_bundle_hash text not null,
  rubric_bundle_hash text not null,
  job_input_hash text not null,
  candidate_input_hash text not null,
  input_hash text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','superseded')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  processing_ms integer check (processing_ms is null or processing_ms >= 0),
  error_code text,
  error_message text,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (id, organization_id)
);
/* Idempotency, enforced by the database rather than by a check-then-insert race in the worker. The
 * same effective inputs may not produce a second live run -- reopening a drawer must never spend
 * money. Failed and superseded runs are excluded so a retry is still possible. */
create unique index interview_analysis_runs_idempotent
  on public.interview_analysis_runs(organization_id, input_hash)
  where status in ('queued','processing','completed');
create index interview_analysis_runs_interview on public.interview_analysis_runs(interview_id, created_at desc);
create index interview_analysis_runs_claimable on public.interview_analysis_runs(status, created_at)
  where status in ('queued','processing');

create table public.interview_analysis_run_transcripts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  transcript_id uuid not null,
  foreign key (analysis_run_id, organization_id) references public.interview_analysis_runs(id, organization_id) on delete cascade,
  foreign key (transcript_id, organization_id) references public.interview_transcripts(id, organization_id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (analysis_run_id, transcript_id)
);
create index interview_run_transcripts_transcript on public.interview_analysis_run_transcripts(transcript_id);

-- ---------------------------------------------------------------------------------------------
-- Assessments and findings
-- ---------------------------------------------------------------------------------------------

/* Two rows per completed run, and the subject columns are mutually exclusive by constraint rather
 * than by convention -- a consultant-quality assessment that could name a candidate subject is one
 * refactor away from a candidate being scored on their interviewer's technique.
 *
 * No user-facing overall numeric score in V1. The bands and the confidence are the output; a decimal
 * would imply a precision the evidence does not support, and calibration has not yet justified a
 * deterministic aggregation rule. */
create table public.interview_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  interview_id uuid not null,
  assessment_type text not null check (assessment_type in ('candidate_fit','consultant_quality')),
  subject_candidate_id uuid,
  subject_member_id uuid,
  foreign key (analysis_run_id, organization_id) references public.interview_analysis_runs(id, organization_id) on delete cascade,
  foreign key (interview_id, organization_id) references public.interviews(id, organization_id) on delete cascade,
  -- The subject is the access key for consultant_quality rows, so a subject from another workspace
  -- would be an authorization bug, not just a data error.
  foreign key (subject_candidate_id, organization_id) references public.candidates(id, organization_id) on delete cascade,
  foreign key (subject_member_id, organization_id) references public.organization_members(id, organization_id) on delete cascade,
  unique (id, organization_id),
  overall_band text not null,
  confidence text not null check (confidence in ('low','medium','high')),
  summary text not null check (char_length(summary) <= 4000),
  created_at timestamptz not null default now(),
  constraint interview_assessment_subject_matches_type check (
    (assessment_type='candidate_fit' and subject_candidate_id is not null and subject_member_id is null)
    or (assessment_type='consultant_quality' and subject_member_id is not null and subject_candidate_id is null)
  ),
  constraint interview_assessment_band_matches_type check (
    (assessment_type='candidate_fit' and overall_band in ('strong_evidence_of_fit','promising_but_incomplete','material_concerns','clear_mismatch','insufficient_evidence'))
    or (assessment_type='consultant_quality' and overall_band in ('strong','effective','needs_development','needs_attention','insufficient_evidence'))
  )
);
-- One consultant-quality assessment per consultant per run, one candidate-fit assessment per run.
create unique index interview_assessments_candidate_unique
  on public.interview_assessments(analysis_run_id)
  where assessment_type='candidate_fit';
create unique index interview_assessments_consultant_unique
  on public.interview_assessments(analysis_run_id, subject_member_id)
  where assessment_type='consultant_quality';
create index interview_assessments_subject_member on public.interview_assessments(subject_member_id, created_at desc)
  where assessment_type='consultant_quality';
create index interview_assessments_interview on public.interview_assessments(interview_id, created_at desc);

create table public.interview_assessment_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  rubric_item_id uuid,
  foreign key (assessment_id, organization_id) references public.interview_assessments(id, organization_id) on delete cascade,
  foreign key (rubric_item_id, organization_id) references public.interview_rubric_items(id, organization_id) on delete set null (rubric_item_id),
  unique (id, organization_id),
  category text not null,
  result text not null,
  -- The 0-4 rubric is internal. It is persisted per dimension because coaching needs to compare a
  -- consultant against their own history, and never rendered as a decimal.
  score integer check (score is null or (score between 0 and 4)),
  severity text not null default 'info' check (severity in ('info','coaching','attention','critical')),
  confidence text not null check (confidence in ('low','medium','high')),
  title text not null check (char_length(title) <= 300),
  summary text not null check (char_length(summary) <= 4000),
  coaching_suggestion text check (coaching_suggestion is null or char_length(coaching_suggestion) <= 2000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- `not_evidenced` is a first-class result and is NOT a synonym for not_met. Conflating them is the
  -- single most harmful error this system can make: it turns a question the consultant forgot to ask
  -- into a mark against the candidate.
  constraint interview_finding_result_vocabulary check (
    result in ('met','partially_met','not_evidenced','contradicted','not_applicable',
               'strong','effective','needs_development','needs_attention','insufficient_evidence','observation')
  )
);
create index interview_findings_assessment on public.interview_assessment_findings(assessment_id, sort_order);

/* Evidence is a normalized reference, never a UUID array inside the finding. The point is that a
 * reference can be VALIDATED -- resolved to a real row inside the caller's organization -- which is
 * what turns "the model must not invent quotes" from a prompt instruction into an enforced property.
 *
 * `prescreen_field` is deliberately absent: this repository has a pipeline stage named "screening"
 * and no prescreening entity, and a source type whose references cannot be checked against stored
 * rows would be a hole in exactly that guarantee. It is added when prescreening exists. */
create table public.interview_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  foreign key (finding_id, organization_id) references public.interview_assessment_findings(id, organization_id) on delete cascade,
  source_type text not null check (source_type in ('transcript_entry','candidate_cv','candidate_field','job_brief')),
  source_record_id uuid,
  source_locator text check (source_locator is null or char_length(source_locator) <= 300),
  -- Bounded so the evidence table cannot quietly become a second copy of the transcript under
  -- different retention rules and broader access than the transcript itself.
  excerpt text check (excerpt is null or char_length(excerpt) <= 1000),
  created_at timestamptz not null default now(),
  -- Everything except a whole-brief citation has to say which record it came from.
  constraint interview_evidence_record_required check (
    source_type='job_brief' or source_record_id is not null
  )
);
create index interview_evidence_finding on public.interview_finding_evidence(finding_id);
create index interview_evidence_source on public.interview_finding_evidence(source_type, source_record_id);

-- ---------------------------------------------------------------------------------------------
-- Deterministic conversation metrics
-- ---------------------------------------------------------------------------------------------

/* Computed in code from real timestamps, never asked of the model and never inferred from word
 * count. Per mapped speaker rather than per interview, because an interview with two consultants has
 * two performance subjects and collapsing them would attribute one colleague's behaviour to another.
 *
 * Percentages are absent on purpose: share is derived through one shared implementation at read time
 * so that two surfaces cannot disagree about the denominator. */
create table public.interview_conversation_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  transcript_id uuid not null,
  speaker_id uuid not null,
  speaker_role text not null check (speaker_role in ('consultant','candidate','client','other','unknown')),
  subject_member_id uuid,
  subject_candidate_id uuid,
  foreign key (analysis_run_id, organization_id) references public.interview_analysis_runs(id, organization_id) on delete cascade,
  foreign key (transcript_id, organization_id) references public.interview_transcripts(id, organization_id) on delete cascade,
  foreign key (speaker_id, organization_id) references public.interview_transcript_speakers(id, organization_id) on delete cascade,
  foreign key (subject_member_id, organization_id) references public.organization_members(id, organization_id) on delete set null (subject_member_id),
  foreign key (subject_candidate_id, organization_id) references public.candidates(id, organization_id) on delete set null (subject_candidate_id),
  speech_ms integer not null default 0 check (speech_ms >= 0),
  turn_count integer not null default 0 check (turn_count >= 0),
  average_turn_ms integer check (average_turn_ms is null or average_turn_ms >= 0),
  longest_turn_ms integer check (longest_turn_ms is null or longest_turn_ms >= 0),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, transcript_id, speaker_id)
);
create index interview_metrics_run on public.interview_conversation_metrics(analysis_run_id);

create table public.interview_conversation_metric_summaries (
  analysis_run_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  foreign key (analysis_run_id, organization_id) references public.interview_analysis_runs(id, organization_id) on delete cascade,
  -- 0 means no entry carried usable timestamps, and the UI must say "Unavailable" rather than
  -- present a ratio it cannot support. Partial coverage lowers metric_confidence instead of being
  -- quietly rounded up to a number.
  timestamp_coverage numeric(4,3) not null default 0 check (timestamp_coverage >= 0 and timestamp_coverage <= 1),
  unknown_speech_ms integer not null default 0 check (unknown_speech_ms >= 0),
  overlap_ms integer not null default 0 check (overlap_ms >= 0),
  overlap_count integer not null default 0 check (overlap_count >= 0),
  metric_confidence text not null default 'low' check (metric_confidence in ('low','medium','high')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Bounded transcript paging
-- ---------------------------------------------------------------------------------------------

/* The only way an authenticated client reads transcript text. interview_transcript_entries itself
 * carries no client-facing policy at all (see below), so an unbounded `select * from entries` is not
 * merely discouraged -- it returns nothing.
 *
 * Authorization is re-checked inside the function rather than inherited from the caller, because a
 * security definer function that trusts its arguments is how cross-tenant reads happen. */
create or replace function public.get_interview_transcript_page(
  p_organization_id uuid,
  p_transcript_id uuid,
  p_after_sequence integer default null,
  p_limit integer default 50
)
-- `content` rather than `text`: a RETURNS TABLE column becomes a plpgsql variable, and naming one
-- after a built-in type invites a shadowing warning at best and an ambiguous reference at worst.
returns table(
  entry_id uuid,
  sequence_number integer,
  speaker_id uuid,
  speaker_label text,
  speaker_role text,
  start_ms integer,
  end_ms integer,
  content text
)
language plpgsql stable security definer set search_path=public as $$
declare owning_org uuid; owning_interview uuid; effective_limit integer;
begin
  select t.organization_id, t.interview_id into owning_org, owning_interview
  from public.interview_transcripts t
  where t.id=p_transcript_id and t.purged_at is null;

  -- A transcript in another organization is indistinguishable from one that does not exist. Knowing
  -- a UUID must reveal nothing.
  if owning_org is null or owning_org <> p_organization_id then
    raise exception 'transcript_not_found';
  end if;
  if not public.can_access_interview_transcript(owning_interview) then
    raise exception 'permission_denied';
  end if;

  effective_limit := least(greatest(coalesce(p_limit,50),1),100);

  return query
  select e.id, e.sequence_number, e.speaker_id,
         coalesce(s.display_name, s.source_speaker_id) as speaker_label,
         s.speaker_role, e.start_ms, e.end_ms, e.text
  from public.interview_transcript_entries e
  join public.interview_transcript_speakers s on s.id=e.speaker_id
  where e.transcript_id=p_transcript_id
    and (p_after_sequence is null or e.sequence_number > p_after_sequence)
  order by e.sequence_number
  limit effective_limit;
end $$;
revoke all on function public.get_interview_transcript_page(uuid,uuid,integer,integer) from public, anon;
grant execute on function public.get_interview_transcript_page(uuid,uuid,integer,integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array[
    'interview_transcription_consents','interview_rubrics','interview_rubric_items',
    'interview_transcripts','interview_transcript_speakers','interview_transcript_entries',
    'interview_analysis_runs','interview_analysis_run_transcripts',
    'interview_assessments','interview_assessment_findings','interview_finding_evidence',
    'interview_conversation_metrics','interview_conversation_metric_summaries'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon',t);
  end loop;
end $$;

-- Consent: readable by anyone operating or reviewing the feature, writable by operators, and never
-- updatable or deletable by a client -- there is no policy for those commands, which is what makes
-- the history append-only rather than merely conventionally so.
create policy interview_consents_read on public.interview_transcription_consents
  for select to authenticated
  using (public.can_use_interview_intelligence(organization_id) or public.can_review_interview_quality(organization_id));
create policy interview_consents_insert on public.interview_transcription_consents
  for insert to authenticated
  with check (public.can_use_interview_intelligence(organization_id) and recorded_by=auth.uid());

-- Rubrics: consultants read the blueprint they are expected to interview against; only configure
-- may write one.
create policy interview_rubrics_read on public.interview_rubrics
  for select to authenticated
  using (public.can_use_interview_intelligence(organization_id) or public.can_configure_interview_intelligence(organization_id));
create policy interview_rubrics_write on public.interview_rubrics
  for all to authenticated
  using (public.can_configure_interview_intelligence(organization_id))
  with check (public.can_configure_interview_intelligence(organization_id));

create policy interview_rubric_items_read on public.interview_rubric_items
  for select to authenticated
  using (public.can_use_interview_intelligence(organization_id) or public.can_configure_interview_intelligence(organization_id));
create policy interview_rubric_items_write on public.interview_rubric_items
  for all to authenticated
  using (public.can_configure_interview_intelligence(organization_id))
  with check (public.can_configure_interview_intelligence(organization_id));

-- Transcripts: participation or team review, never plain candidate access.
create policy interview_transcripts_read on public.interview_transcripts
  for select to authenticated
  using (public.can_access_interview_transcript(interview_id));
create policy interview_transcripts_write on public.interview_transcripts
  for all to authenticated
  using (public.can_use_interview_intelligence(organization_id) and public.can_access_interview_transcript(interview_id))
  with check (public.can_use_interview_intelligence(organization_id) and public.can_access_interview_transcript(interview_id));

create policy interview_speakers_read on public.interview_transcript_speakers
  for select to authenticated
  using (exists(select 1 from public.interview_transcripts t where t.id=transcript_id and public.can_access_interview_transcript(t.interview_id)));
create policy interview_speakers_write on public.interview_transcript_speakers
  for all to authenticated
  using (exists(select 1 from public.interview_transcripts t where t.id=transcript_id and public.can_use_interview_intelligence(t.organization_id) and public.can_access_interview_transcript(t.interview_id)))
  with check (exists(select 1 from public.interview_transcripts t where t.id=transcript_id and public.can_use_interview_intelligence(t.organization_id) and public.can_access_interview_transcript(t.interview_id)));

/* interview_transcript_entries has NO policy for any client role, deliberately. Transcript text is
 * reachable only through get_interview_transcript_page, which is bounded to 100 rows and re-checks
 * authorization itself. RLS-enabled with zero policies means a direct select returns nothing even to
 * a member who holds every permission in the workspace. */

-- Run metadata: status and timing, visible to operators and reviewers. Never written by a client --
-- analysis results are service-side only, so no insert/update policy exists for any of the result
-- tables below either.
create policy interview_runs_read on public.interview_analysis_runs
  for select to authenticated
  using (public.can_use_interview_intelligence(organization_id) or public.can_review_interview_quality(organization_id));
create policy interview_run_transcripts_read on public.interview_analysis_run_transcripts
  for select to authenticated
  using (public.can_use_interview_intelligence(organization_id) or public.can_review_interview_quality(organization_id));

/* The visibility split that the whole permission model exists for.
 *
 * A candidate-fit assessment follows candidate and job access, because it is a statement about the
 * candidate. A consultant-quality assessment follows the SUBJECT: the consultant it is about, or a
 * team reviewer. A colleague with full candidate access and no review_team sees nothing about how
 * another consultant interviewed, and there is no owner-only variant hidden from the subject --
 * consultants see their own findings. */
create policy interview_assessments_read on public.interview_assessments
  for select to authenticated
  using (
    case assessment_type
      when 'candidate_fit' then
        (public.can_use_interview_intelligence(organization_id) or public.can_review_interview_quality(organization_id))
        and public.has_permission(organization_id,'candidates.read')
        and public.has_permission(organization_id,'jobs.read')
      when 'consultant_quality' then
        public.can_review_interview_quality(organization_id)
        or (
          public.has_permission(organization_id,'interview_intelligence.view_own')
          and subject_member_id = public.my_member_id(organization_id)
        )
      else false
    end
  );

create policy interview_findings_read on public.interview_assessment_findings
  for select to authenticated
  using (exists(select 1 from public.interview_assessments a where a.id=assessment_id));

create policy interview_evidence_read on public.interview_finding_evidence
  for select to authenticated
  using (exists(
    select 1 from public.interview_assessment_findings f
    join public.interview_assessments a on a.id=f.assessment_id
    where f.id=finding_id
  ));

-- Metrics derive from the transcript, so they follow the transcript's rule rather than the
-- candidate's.
create policy interview_metrics_read on public.interview_conversation_metrics
  for select to authenticated
  using (exists(select 1 from public.interview_transcripts t where t.id=transcript_id and public.can_access_interview_transcript(t.interview_id)));
create policy interview_metric_summaries_read on public.interview_conversation_metric_summaries
  for select to authenticated
  using (exists(
    select 1 from public.interview_analysis_runs r
    where r.id=analysis_run_id and public.can_access_interview_transcript(r.interview_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- Capabilities
-- ---------------------------------------------------------------------------------------------

/* Extends the single capability RPC rather than adding a second one: the client already makes one
 * call for this, and the policy derivation stays server-side where it is also enforced. The four new
 * booleans are UX only -- every one of them is independently enforced by RLS above.
 *
 * Dropped first, because `create or replace` cannot add columns to a RETURNS TABLE -- Postgres
 * refuses with 42P13, "cannot change return type of existing function". The drop means this comes
 * back as a brand-new pg_proc row carrying Postgres's default ACL of EXECUTE to PUBLIC, which is the
 * exact regression class 20260726020000_harden_implicit_public_grants.sql was written to clean up,
 * so the revoke below is load-bearing rather than decorative. tests/rls/rpc-acl.test.ts is what
 * proves it stayed revoked. */
drop function if exists public.get_my_workspace_capabilities(uuid);
create function public.get_my_workspace_capabilities(p_organization_id uuid)
returns table(
  role_keys text[],
  can_write_candidates boolean,
  can_write_clients boolean,
  can_write_jobs boolean,
  can_move_pipeline boolean,
  can_submit boolean,
  can_manage_interviews boolean,
  can_manage_offers boolean,
  can_manage_placements boolean,
  can_manage_commercial_terms boolean,
  can_view_team_reports boolean,
  can_manage_finance boolean,
  can_import boolean,
  can_manage_organization boolean,
  can_manage_workspace boolean,
  can_manage_templates boolean,
  can_view_admin boolean,
  read_only boolean,
  can_use_interview_intelligence boolean,
  can_view_own_interview_quality boolean,
  can_review_team_interview_quality boolean,
  can_configure_interview_intelligence boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with member as (
    select m.id
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ),
  member_role_keys as (
    select coalesce(array_agg(distinct r.role_key), '{}'::text[]) as keys
    from member
    join public.member_roles mr on mr.member_id = member.id
    join public.roles r on r.id = mr.role_id
  ),
  member_permissions as (
    select coalesce(array_agg(distinct rp.permission_key), '{}'::text[]) as keys
    from member
    join public.member_roles mr on mr.member_id = member.id
    join public.role_permissions rp on rp.role_id = mr.role_id
  ),
  feature as (
    select coalesce(bool_or(s.interview_intelligence_enabled), false) as interview_intelligence_enabled
    from public.organization_settings s
    where s.organization_id = p_organization_id
  ),
  derived as (
    select
      rk.keys as role_keys,
      'candidates.write' = any(mp.keys) as can_write_candidates,
      'companies.write' = any(mp.keys) as can_write_clients,
      'jobs.write' = any(mp.keys) as can_write_jobs,
      'pipeline.move' = any(mp.keys) as can_move_pipeline,
      'submissions.write' = any(mp.keys) as can_submit,
      'interviews.write' = any(mp.keys) as can_manage_interviews,
      'offers.write' = any(mp.keys) as can_manage_offers,
      'placements.write' = any(mp.keys) as can_manage_placements,
      'commercial_terms.write' = any(mp.keys) as can_manage_commercial_terms,
      'finance.write' = any(mp.keys) as can_manage_finance,
      'imports.manage' = any(mp.keys) as can_import,
      'organization.manage' = any(mp.keys) as can_manage_organization,
      ('reports.team' = any(mp.keys))
        or (('reports.read' = any(mp.keys)) and (rk.keys && array['owner','admin','manager','finance']::text[]))
        as can_view_team_reports,
      -- The master switch gates the three operational capabilities, so a disabled workspace reports
      -- false rather than showing entry points that RLS would then refuse. `configure` is exempt:
      -- somebody has to be able to reach the settings that turn the feature on.
      f.interview_intelligence_enabled and ('interview_intelligence.use' = any(mp.keys)) as can_use_interview_intelligence,
      f.interview_intelligence_enabled and ('interview_intelligence.view_own' = any(mp.keys)) as can_view_own_interview_quality,
      f.interview_intelligence_enabled and ('interview_intelligence.review_team' = any(mp.keys)) as can_review_team_interview_quality,
      'interview_intelligence.configure' = any(mp.keys) as can_configure_interview_intelligence
    from member_role_keys rk, member_permissions mp, feature f
  )
  -- Everything from role_keys through read_only is carried over verbatim from
  -- 20260810010000_workspace_capabilities_rpc.sql. Only the four interview columns are new: this is a
  -- `create or replace` of a live authorization surface, and quietly re-deriving an existing
  -- capability while adding columns is exactly how a permission regression ships unnoticed.
  select
    d.role_keys,
    d.can_write_candidates,
    d.can_write_clients,
    d.can_write_jobs,
    d.can_move_pipeline,
    d.can_submit,
    d.can_manage_interviews,
    d.can_manage_offers,
    d.can_manage_placements,
    d.can_manage_commercial_terms,
    d.can_view_team_reports,
    d.can_manage_finance,
    d.can_import,
    d.can_manage_organization,
    d.can_manage_organization or ('roles.manage' = any(mp.keys)) as can_manage_workspace,
    -- Templates follow workspace management: same audience, no separate permission key exists.
    d.can_manage_organization or ('roles.manage' = any(mp.keys)) as can_manage_templates,
    d.can_view_team_reports
      or d.can_manage_finance
      or d.can_import
      or d.can_manage_organization
      or ('roles.manage' = any(mp.keys))
      as can_view_admin,
    not (
      d.can_write_candidates or d.can_write_clients or d.can_write_jobs or d.can_move_pipeline
      or d.can_submit or d.can_manage_interviews or d.can_manage_offers or d.can_manage_placements
    ) as read_only,
    d.can_use_interview_intelligence,
    d.can_view_own_interview_quality,
    d.can_review_team_interview_quality,
    d.can_configure_interview_intelligence
  from derived d, member_permissions mp
$$;
revoke all on function public.get_my_workspace_capabilities(uuid) from public, anon;
grant execute on function public.get_my_workspace_capabilities(uuid) to authenticated;

commit;
