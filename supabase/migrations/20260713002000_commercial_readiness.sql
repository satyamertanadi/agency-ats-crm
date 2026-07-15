begin;

-- Commercial pilot lifecycle and privacy defaults.
alter table public.organizations
  add column if not exists pilot_status text not null default 'preparing'
    check (pilot_status in ('preparing','uat','pilot','active','suspended','closed')),
  add column if not exists onboarding_completed_at timestamptz;

alter table public.organization_settings
  add column if not exists support_email text,
  add column if not exists allowed_email_domains text[] not null default '{}'::text[],
  add column if not exists require_invitation boolean not null default true,
  add column if not exists calendar_sync_enabled boolean not null default true,
  add column if not exists document_migration_completed boolean not null default false;

alter table public.profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists accepted_terms_at timestamptz;

alter table public.organization_invitations
  add column if not exists provider text not null default 'google' check (provider='google'),
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending','sent','delivered','failed','bounced','suppressed')),
  add column if not exists delivery_id text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists delivery_error text;

create unique index if not exists organization_invitations_active_email_unique
  on public.organization_invitations(organization_id, public.normalize_email(email))
  where accepted_at is null and revoked_at is null;

alter table public.interviews
  add column if not exists organizer_member_id uuid references public.organization_members(id),
  add column if not exists attendee_emails text[] not null default '{}'::text[],
  add column if not exists create_google_meet boolean not null default false,
  add column if not exists calendar_event_id text,
  add column if not exists calendar_event_url text,
  add column if not exists calendar_sync_status text not null default 'not_requested'
    check (calendar_sync_status in ('not_requested','pending','synced','failed','cancelled')),
  add column if not exists calendar_last_synced_at timestamptz,
  add column if not exists calendar_last_error text,
  add column if not exists calendar_retry_count integer not null default 0,
  add column if not exists calendar_sync_version bigint not null default 1,
  add column if not exists calendar_synced_version bigint not null default 0,
  add column if not exists cancelled_at timestamptz;

create or replace function public.bump_interview_calendar_version()
returns trigger language plpgsql set search_path=public as $$
begin
  new.calendar_sync_version=old.calendar_sync_version+1;
  if new.status<>'cancelled' then new.calendar_sync_status='pending'; end if;
  return new;
end $$;
drop trigger if exists interviews_calendar_version on public.interviews;
create trigger interviews_calendar_version before update of starts_at,ends_at,timezone,location,meeting_url,attendee_emails,create_google_meet on public.interviews for each row execute function public.bump_interview_calendar_version();

create or replace function public.mark_calendar_sync_failed(p_interview_id uuid,p_message text)
returns void language sql security definer set search_path=public as $$
  update public.interviews set calendar_sync_status='failed',calendar_last_error=left(p_message,500),calendar_retry_count=calendar_retry_count+1 where id=p_interview_id;
$$;
revoke all on function public.mark_calendar_sync_failed(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_calendar_sync_failed(uuid,text) to service_role;

alter table public.documents
  add column if not exists original_filename text,
  add column if not exists visibility text not null default 'internal'
    check (visibility in ('internal','submission'));

alter table public.imports
  add column if not exists source_filename text,
  add column if not exists source_format text check (source_format in ('csv','xlsx','zip')),
  add column if not exists mapping jsonb not null default '{}'::jsonb,
  add column if not exists validation_summary jsonb not null default '{}'::jsonb,
  add column if not exists reconciliation_summary jsonb not null default '{}'::jsonb,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rolled_back_at timestamptz,
  add column if not exists rollback_reason text;

alter table public.imports drop constraint if exists imports_entity_type_check;
alter table public.imports add constraint imports_entity_type_check check(entity_type in ('candidates','candidate_employment','candidate_education','candidate_languages','companies','contacts','jobs','job_candidates','tasks','activities','interviews','offers','placements','revenue_splits','invoices'));
alter table public.imports drop constraint if exists imports_status_check;
alter table public.imports add constraint imports_status_check check(status in ('staged','validating','ready','approved','committing','completed','failed','rolled_back'));

create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.organization_members(id) on delete cascade,
  google_email text not null,
  calendar_id text not null default 'primary',
  status text not null default 'connected' check (status in ('connected','reauthorization_required','disconnected','error')),
  scopes text[] not null default '{}'::text[],
  token_secret_id uuid,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, member_id)
);

-- RLS is deliberately enabled without an authenticated policy. Only the service role
-- can read encrypted provider credentials.
create table if not exists public.google_calendar_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.google_calendar_connections(id) on delete cascade,
  encrypted_refresh_token text not null,
  encryption_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections
  drop constraint if exists google_calendar_connections_token_secret_id_fkey;
alter table public.google_calendar_connections
  add constraint google_calendar_connections_token_secret_id_fkey
  foreign key (token_secret_id) references public.google_calendar_secrets(id) on delete set null
  deferrable initially deferred;

create table if not exists public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.organization_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_path text not null default '/app',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_type text not null check (email_type in ('team_invitation','client_submission','calendar_failure')),
  recipient_email text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending','sent','delivered','failed','bounced','suppressed')),
  related_entity_type text,
  related_entity_id uuid,
  error_code text,
  error_message text,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submission_documents (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_submission_id, document_id)
);

create table if not exists public.import_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null references public.imports(id) on delete cascade,
  entity_type text not null,
  legacy_id text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, entity_type, legacy_id)
);

create table if not exists public.import_change_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null references public.imports(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null default 'insert' check (operation in ('insert','update')),
  previous_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists google_calendar_connections_member on public.google_calendar_connections(member_id);
create index if not exists google_oauth_states_expiry on public.google_oauth_states(expires_at) where consumed_at is null;
create index if not exists email_deliveries_org_created on public.email_deliveries(organization_id, created_at desc);
create index if not exists submission_documents_org on public.submission_documents(organization_id);
create index if not exists import_entity_mappings_import on public.import_entity_mappings(import_id, entity_type);

do $$ declare table_name text; begin
  foreach table_name in array array['google_calendar_connections','google_calendar_secrets','email_deliveries'] loop
    if not exists(select 1 from pg_trigger where tgname=table_name||'_touch') then
      execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name||'_touch', table_name);
    end if;
  end loop;
end $$;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_secrets enable row level security;
alter table public.google_oauth_states enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.submission_documents enable row level security;
alter table public.import_entity_mappings enable row level security;
alter table public.import_change_log enable row level security;

create policy google_calendar_connections_read on public.google_calendar_connections
  for select to authenticated using (
    public.has_permission(organization_id,'organization.manage') or exists(
      select 1 from public.organization_members member
      where member.id=member_id and member.user_id=auth.uid() and member.status='active'
    )
  );
create policy email_deliveries_manage on public.email_deliveries
  for select to authenticated using (public.has_permission(organization_id,'organization.manage'));
create policy submission_documents_read on public.submission_documents
  for select to authenticated using (public.has_permission(organization_id,'submissions.read'));
create policy submission_documents_write on public.submission_documents
  for all to authenticated using (public.has_permission(organization_id,'submissions.write'))
  with check (public.has_permission(organization_id,'submissions.write'));
create policy import_entity_mappings_manage on public.import_entity_mappings
  for all to authenticated using (public.has_permission(organization_id,'imports.manage'))
  with check (public.has_permission(organization_id,'imports.manage'));
create policy import_change_log_manage on public.import_change_log
  for all to authenticated using (public.has_permission(organization_id,'imports.manage'))
  with check (public.has_permission(organization_id,'imports.manage'));

revoke all on public.google_calendar_secrets, public.google_oauth_states from anon, authenticated;
grant all on public.google_calendar_secrets, public.google_oauth_states to service_role;

-- Consultants need to operate their client records, but not workspace administration,
-- bulk exports, integration secrets, or organization-wide finance.
insert into public.role_permissions(role_id, permission_key)
select role.id, permission.key
from public.roles role
join public.permissions permission on permission.key in ('companies.write','contacts.write','commercial_terms.read')
where role.role_key='consultant'
on conflict do nothing;

create or replace function public.get_my_access_state()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'email', public.normalize_email(coalesce(auth.jwt()->>'email','')),
    'provider', coalesce(auth.jwt()->'app_metadata'->>'provider',''),
    'has_membership', exists(
      select 1 from public.organization_members member
      where member.user_id=auth.uid() and member.status='active'
    ),
    'has_invitation', exists(
      select 1 from public.organization_invitations invitation
      where public.normalize_email(invitation.email)=public.normalize_email(auth.jwt()->>'email')
        and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at>now()
    )
  )
$$;
revoke all on function public.get_my_access_state() from public, anon;
grant execute on function public.get_my_access_state() to authenticated;

create or replace function public.update_member_access(
  p_organization_id uuid,
  p_member_id uuid,
  p_status text,
  p_role_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare target public.organization_members; target_role public.roles; owner_count integer;
begin
  if not public.has_permission(p_organization_id,'organization.manage') then raise exception 'Access denied'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid member status'; end if;
  select * into target from public.organization_members where id=p_member_id and organization_id=p_organization_id;
  select * into target_role from public.roles where id=p_role_id and organization_id=p_organization_id;
  if target.id is null or target_role.id is null then raise exception 'Member or role not found'; end if;

  if exists(select 1 from public.member_roles mr join public.roles r on r.id=mr.role_id where mr.member_id=target.id and r.role_key='owner')
     and (p_status<>'active' or target_role.role_key<>'owner') then
    select count(*) into owner_count from public.organization_members member
      join public.member_roles mr on mr.member_id=member.id join public.roles r on r.id=mr.role_id
      where member.organization_id=p_organization_id and member.status='active' and r.role_key='owner' and member.id<>target.id;
    if owner_count=0 then raise exception 'At least one active owner is required'; end if;
  end if;

  update public.organization_members set status=p_status where id=target.id;
  delete from public.member_roles where member_id=target.id;
  insert into public.member_roles(member_id,role_id) values(target.id,target_role.id);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'member.access_updated','organization_member',target.id,jsonb_build_object('status',p_status,'role_id',p_role_id));
end $$;
revoke all on function public.update_member_access(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.update_member_access(uuid,uuid,text,uuid) to authenticated;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare invitation public.organization_invitations;
begin
  select * into invitation from public.organization_invitations where id=p_invitation_id;
  if invitation.id is null or not public.has_permission(invitation.organization_id,'organization.manage') then raise exception 'Invitation not found'; end if;
  update public.organization_invitations set revoked_at=now() where id=invitation.id and accepted_at is null;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(invitation.organization_id,auth.uid(),'invitation.revoked','organization_invitation',invitation.id);
end $$;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;

create or replace function public.revoke_submission_link(p_link_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links;
begin
  select * into link from public.public_submission_links where id=p_link_id;
  if link.id is null or not public.has_permission(link.organization_id,'submissions.write') then raise exception 'Submission link not found'; end if;
  update public.public_submission_links set revoked_at=now() where id=link.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(link.organization_id,auth.uid(),'submission_link.revoked','public_submission_link',link.id);
end $$;
revoke all on function public.revoke_submission_link(uuid) from public, anon;
grant execute on function public.revoke_submission_link(uuid) to authenticated;

create or replace function public.create_placement_revenue_split(p_organization_id uuid,p_placement_id uuid,p_member_id uuid,p_percentage numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare split_id uuid;current_total numeric;
begin
  if not public.has_permission(p_organization_id,'finance.write') then raise exception 'permission_denied'; end if;
  if p_percentage<=0 or p_percentage>100 then raise exception 'invalid_percentage'; end if;
  if not exists(select 1 from public.placements where id=p_placement_id and organization_id=p_organization_id) then raise exception 'placement_not_found'; end if;
  if not exists(select 1 from public.organization_members where id=p_member_id and organization_id=p_organization_id and status='active') then raise exception 'member_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_placement_id::text,0));
  select coalesce(sum(split_percentage),0) into current_total from public.placement_revenue_splits where placement_id=p_placement_id and member_id<>p_member_id;
  if current_total+p_percentage>100 then raise exception 'split_total_exceeds_100'; end if;
  insert into public.placement_revenue_splits(organization_id,placement_id,member_id,split_percentage)
  values(p_organization_id,p_placement_id,p_member_id,p_percentage)
  on conflict(placement_id,member_id) do update set split_percentage=excluded.split_percentage
  returning id into split_id;
  return split_id;
end $$;
revoke all on function public.create_placement_revenue_split(uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.create_placement_revenue_split(uuid,uuid,uuid,numeric) to authenticated;

create or replace function public.merge_candidates(p_organization_id uuid,p_kept_candidate_id uuid,p_merged_candidate_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare kept public.candidates;merged public.candidates;kept_private public.candidate_private_details;merged_private public.candidate_private_details;
begin
  if p_kept_candidate_id=p_merged_candidate_id then raise exception 'same_candidate'; end if;
  if not public.has_permission(p_organization_id,'candidates.write') or not public.has_permission(p_organization_id,'candidates_private.read') then raise exception 'permission_denied'; end if;
  select * into kept from public.candidates where id=p_kept_candidate_id and organization_id=p_organization_id for update;
  select * into merged from public.candidates where id=p_merged_candidate_id and organization_id=p_organization_id for update;
  if kept.id is null or merged.id is null then raise exception 'candidate_not_found'; end if;
  if exists(select 1 from public.job_candidates a join public.job_candidates b on b.job_id=a.job_id where a.candidate_id=p_kept_candidate_id and b.candidate_id=p_merged_candidate_id) then raise exception 'merge_conflicting_job_assignments'; end if;

  select * into kept_private from public.candidate_private_details where candidate_id=p_kept_candidate_id;
  select * into merged_private from public.candidate_private_details where candidate_id=p_merged_candidate_id;
  if merged_private.candidate_id is not null then
    if kept_private.candidate_id is null then update public.candidate_private_details set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
    else
      delete from public.candidate_private_details where candidate_id=p_merged_candidate_id;
      update public.candidate_private_details set
        email=coalesce(email,merged_private.email),phone=coalesce(phone,merged_private.phone),current_salary=coalesce(current_salary,merged_private.current_salary),expected_salary=coalesce(expected_salary,merged_private.expected_salary),salary_currency=coalesce(salary_currency,merged_private.salary_currency),work_authorization=coalesce(work_authorization,merged_private.work_authorization),
        consent_status=case when consent_status='withdrawn' or merged_private.consent_status='withdrawn' then 'withdrawn' when consent_status='granted' or merged_private.consent_status='granted' then 'granted' else consent_status end,
        consent_expires_at=coalesce(consent_expires_at,merged_private.consent_expires_at),legal_hold=legal_hold or merged_private.legal_hold,updated_at=now()
      where candidate_id=p_kept_candidate_id;
    end if;
  end if;

  update public.candidates set current_company=coalesce(current_company,merged.current_company),current_position=coalesce(current_position,merged.current_position),location=coalesce(location,merged.location),linkedin_url=coalesce(linkedin_url,merged.linkedin_url),portfolio_url=coalesce(portfolio_url,merged.portfolio_url),owner_member_id=coalesce(owner_member_id,merged.owner_member_id),source=concat_ws(' / ',nullif(source,''),nullif(merged.source,'')),status=case when status='do_not_contact' or merged.status='do_not_contact' then 'do_not_contact' else status end,updated_by=auth.uid(),updated_at=now() where id=p_kept_candidate_id;
  update public.job_candidates set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.placements set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.candidate_employment set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.candidate_education set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.candidate_consents set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience) select p_kept_candidate_id,skill_id,organization_id,proficiency,years_experience from public.candidate_skills where candidate_id=p_merged_candidate_id on conflict(candidate_id,skill_id) do nothing;
  delete from public.candidate_skills where candidate_id=p_merged_candidate_id;
  insert into public.candidate_languages(candidate_id,organization_id,language,proficiency) select p_kept_candidate_id,organization_id,language,proficiency from public.candidate_languages where candidate_id=p_merged_candidate_id on conflict(candidate_id,language) do nothing;
  delete from public.candidate_languages where candidate_id=p_merged_candidate_id;
  insert into public.candidate_preferred_locations(candidate_id,organization_id,location) select p_kept_candidate_id,organization_id,location from public.candidate_preferred_locations where candidate_id=p_merged_candidate_id on conflict(candidate_id,location) do nothing;
  delete from public.candidate_preferred_locations where candidate_id=p_merged_candidate_id;
  insert into public.candidate_tags(candidate_id,tag_id,organization_id) select p_kept_candidate_id,tag_id,organization_id from public.candidate_tags where candidate_id=p_merged_candidate_id on conflict(candidate_id,tag_id) do nothing;
  delete from public.candidate_tags where candidate_id=p_merged_candidate_id;
  update public.activity_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.note_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.task_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.document_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.ai_evaluations set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  insert into public.candidate_merge_history(organization_id,kept_candidate_id,merged_candidate_id,merged_by,reason) values(p_organization_id,p_kept_candidate_id,p_merged_candidate_id,auth.uid(),coalesce(nullif(trim(p_reason),''),'Duplicate record'));
  update public.candidates set status='archived',deleted_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_merged_candidate_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'candidate.merged','candidate',p_kept_candidate_id,jsonb_build_object('merged_candidate_id',p_merged_candidate_id,'reason',p_reason));
  return p_kept_candidate_id;
end $$;
revoke all on function public.merge_candidates(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.merge_candidates(uuid,uuid,uuid,text) to authenticated;

create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_organization_member(p_organization_id) then raise exception 'Access denied'; end if;
  if p_action !~ '^[a-z0-9_]+\.[a-z0-9_]+$' then raise exception 'Invalid audit action'; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),p_action,left(p_entity_type,80),p_entity_id,coalesce(p_metadata,'{}'::jsonb));
end $$;
revoke all on function public.record_audit_event(uuid,text,text,uuid,jsonb) from public, anon;
grant execute on function public.record_audit_event(uuid,text,text,uuid,jsonb) to authenticated;

create or replace function public.update_candidate_profile(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_candidate jsonb,
  p_private jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'Access denied'; end if;
  if not exists(select 1 from public.candidates where id=p_candidate_id and organization_id=p_organization_id) then raise exception 'Candidate not found'; end if;
  update public.candidates set
    full_name=case when p_candidate?'full_name' then nullif(trim(p_candidate->>'full_name'),'') else full_name end,
    current_company=case when p_candidate?'current_company' then nullif(trim(p_candidate->>'current_company'),'') else current_company end,
    current_position=case when p_candidate?'current_position' then nullif(trim(p_candidate->>'current_position'),'') else current_position end,
    location=case when p_candidate?'location' then nullif(trim(p_candidate->>'location'),'') else location end,
    linkedin_url=case when p_candidate?'linkedin_url' then nullif(trim(p_candidate->>'linkedin_url'),'') else linkedin_url end,
    portfolio_url=case when p_candidate?'portfolio_url' then nullif(trim(p_candidate->>'portfolio_url'),'') else portfolio_url end,
    status=case when p_candidate?'status' then p_candidate->>'status' else status end,
    owner_member_id=case when p_candidate?'owner_member_id' then nullif(p_candidate->>'owner_member_id','')::uuid else owner_member_id end,
    source=case when p_candidate?'source' then nullif(trim(p_candidate->>'source'),'') else source end,
    availability=case when p_candidate?'availability' then nullif(trim(p_candidate->>'availability'),'') else availability end,
    notice_period_days=case when p_candidate?'notice_period_days' then nullif(p_candidate->>'notice_period_days','')::integer else notice_period_days end,
    updated_by=auth.uid(),updated_at=now()
  where id=p_candidate_id and organization_id=p_organization_id;
  insert into public.candidate_private_details(candidate_id,organization_id,email,phone,current_salary,expected_salary,salary_currency,work_authorization,consent_status,consent_expires_at)
  values(p_candidate_id,p_organization_id,nullif(trim(p_private->>'email'),''),nullif(trim(p_private->>'phone'),''),nullif(p_private->>'current_salary','')::numeric,nullif(p_private->>'expected_salary','')::numeric,nullif(upper(p_private->>'salary_currency'),''),nullif(trim(p_private->>'work_authorization'),''),coalesce(nullif(p_private->>'consent_status',''),'unknown'),nullif(p_private->>'consent_expires_at','')::timestamptz)
  on conflict(candidate_id) do update set
    email=case when p_private?'email' then excluded.email else candidate_private_details.email end,
    phone=case when p_private?'phone' then excluded.phone else candidate_private_details.phone end,
    current_salary=case when p_private?'current_salary' then excluded.current_salary else candidate_private_details.current_salary end,
    expected_salary=case when p_private?'expected_salary' then excluded.expected_salary else candidate_private_details.expected_salary end,
    salary_currency=case when p_private?'salary_currency' then excluded.salary_currency else candidate_private_details.salary_currency end,
    work_authorization=case when p_private?'work_authorization' then excluded.work_authorization else candidate_private_details.work_authorization end,
    consent_status=case when p_private?'consent_status' then excluded.consent_status else candidate_private_details.consent_status end,
    consent_expires_at=case when p_private?'consent_expires_at' then excluded.consent_expires_at else candidate_private_details.consent_expires_at end,
    updated_at=now();
end $$;
revoke all on function public.update_candidate_profile(uuid,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.update_candidate_profile(uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; org_id uuid; entity_id uuid;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id:=(row_data->>'organization_id')::uuid;
  entity_id:=nullif(row_data->>'id','')::uuid;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(org_id,auth.uid(),lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,entity_id,
      jsonb_build_object('changed_at',now()));
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['candidates','companies','contacts','jobs','tasks','interviews','offers','placements','placement_invoices','placement_revenue_splits','documents'] loop
    if not exists(select 1 from pg_trigger where tgname=table_name||'_audit') then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', table_name||'_audit', table_name);
    end if;
  end loop;
end $$;

-- Public review document metadata is returned only after the submission token is
-- validated. The Edge Function converts storage paths to short-lived signed URLs.
create or replace function public.resolve_submission_documents(p_token text)
returns table(document_id uuid, storage_path text, filename text, mime_type text)
language sql stable security definer set search_path=public as $$
  select document.id, document.storage_path, coalesce(document.original_filename,document.file_name), document.mime_type
  from public.public_submission_links link
  join public.candidate_submissions submission on submission.package_id=link.package_id
  join public.submission_documents attached on attached.candidate_submission_id=submission.id
  join public.documents document on document.id=attached.document_id and document.organization_id=link.organization_id
  where link.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and link.revoked_at is null and link.expires_at>now() and document.deleted_at is null
$$;
revoke all on function public.resolve_submission_documents(text) from public, anon, authenticated;
grant execute on function public.resolve_submission_documents(text) to service_role;

-- Public review must pass through the rate-limited Edge boundary. The underlying
-- token RPCs are service-only so callers cannot bypass response filtering or
-- document allowlisting through PostgREST.
revoke all on function public.resolve_submission_link(text) from public,anon,authenticated;
grant execute on function public.resolve_submission_link(text) to service_role;
revoke all on function public.submit_submission_feedback(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_submission_feedback(text,uuid,text,text,text) to service_role;

-- Replace invitation acceptance so production identities must come from Google while
-- retaining the local .local seed accounts used by non-production RLS tests.
create or replace function public.accept_organization_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invitation public.organization_invitations; member_id uuid; normalized_user_email text; provider text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  normalized_user_email:=public.normalize_email(auth.jwt()->>'email');
  provider:=coalesce(auth.jwt()->'app_metadata'->>'provider','');
  if provider<>'google' and normalized_user_email not like '%.local' then raise exception 'google_auth_required'; end if;
  select * into invitation from public.organization_invitations
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and accepted_at is null and revoked_at is null and expires_at>now()
    for update;
  if invitation.id is null then return null; end if;
  if public.normalize_email(invitation.email)<>normalized_user_email then raise exception 'email_mismatch'; end if;
  insert into public.organization_members(organization_id,user_id,status)
    values(invitation.organization_id,auth.uid(),'active')
    on conflict(organization_id,user_id) do update set status='active' returning id into member_id;
  insert into public.member_roles(member_id,role_id) values(member_id,invitation.role_id)
    on conflict do nothing;
  update public.organization_invitations set accepted_at=now() where id=invitation.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(invitation.organization_id,auth.uid(),'invitation.accepted','organization_invitation',invitation.id);
  return jsonb_build_object('organization_id',invitation.organization_id,'organization_slug',(select slug from public.organizations where id=invitation.organization_id),'member_id',member_id);
end $$;
revoke all on function public.accept_organization_invitation(text) from public,anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

commit;
