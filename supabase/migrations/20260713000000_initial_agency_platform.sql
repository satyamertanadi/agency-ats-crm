begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.normalize_email(value text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(trim(value)), '')
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  base_currency char(3) not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  primary_color text not null default '#287A72',
  logo_path text,
  default_submission_expiry_days integer not null default 7 check (default_submission_expiry_days between 1 and 30),
  candidate_retention_months integer not null default 24 check (candidate_retention_months between 1 and 120),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('invited','active','suspended')),
  job_title text,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  role_key text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, role_key),
  unique (organization_id, name)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.member_roles (
  member_id uuid not null references public.organization_members(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (member_id, role_id)
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role_id uuid not null references public.roles(id),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  industry text,
  website text,
  location text,
  company_size text,
  account_status text not null default 'prospect' check (account_status in ('prospect','active_client','inactive','do_not_contact')),
  business_development_stage text not null default 'lead',
  owner_member_id uuid references public.organization_members(id),
  notes_summary text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  full_name text not null,
  position text,
  email text,
  phone text,
  linkedin_url text,
  contact_status text not null default 'active',
  decision_authority text,
  relationship_owner_id uuid references public.organization_members(id),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.commercial_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  fee_type text not null check (fee_type in ('percentage','fixed','retained')),
  fee_percentage numeric(6,3) check (fee_percentage between 0 and 100),
  fixed_fee numeric(14,2) check (fixed_fee >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  guarantee_days integer not null default 90 check (guarantee_days between 0 and 730),
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','active','expired')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fee_percentage is not null or fixed_fee is not null)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  current_company text,
  current_position text,
  location text,
  linkedin_url text,
  portfolio_url text,
  status text not null default 'active' check (status in ('active','passive','placed','do_not_contact','archived')),
  owner_member_id uuid references public.organization_members(id),
  source text,
  availability text,
  notice_period_days integer check (notice_period_days >= 0),
  last_contacted_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.candidate_private_details (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  canonical_email text generated always as (public.normalize_email(email)) stored,
  phone text,
  current_salary numeric(14,2),
  expected_salary numeric(14,2),
  salary_currency char(3) check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  work_authorization text,
  consent_status text not null default 'unknown' check (consent_status in ('unknown','requested','granted','withdrawn','expired')),
  consent_expires_at timestamptz,
  legal_hold boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index candidate_active_email_unique on public.candidate_private_details(organization_id, canonical_email) where canonical_email is not null;

create table public.candidate_employment (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade, company_name text not null, title text not null,
  location text, started_on date, ended_on date, is_current boolean not null default false, summary text, sort_order integer not null default 0
);
create table public.candidate_education (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade, institution text not null, degree text, field_of_study text,
  started_on date, ended_on date, sort_order integer not null default 0
);
create table public.skills (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, normalized_name text not null, unique (organization_id, normalized_name)
);
create table public.candidate_skills (
  candidate_id uuid not null references public.candidates(id) on delete cascade, skill_id uuid not null references public.skills(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, proficiency text, years_experience numeric(4,1), primary key(candidate_id, skill_id)
);
create table public.candidate_languages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade, language text not null, proficiency text, unique(candidate_id, language)
);
create table public.candidate_preferred_locations (
  candidate_id uuid not null references public.candidates(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
  location text not null, primary key(candidate_id, location)
);
create table public.candidate_consents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade, status text not null, legal_basis text,
  notice_version text, occurred_at timestamptz not null default now(), recorded_by uuid references auth.users(id), evidence text
);
create table public.candidate_merge_history (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  kept_candidate_id uuid not null references public.candidates(id), merged_candidate_id uuid not null, merged_by uuid not null references auth.users(id),
  reason text not null, merged_at timestamptz not null default now()
);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, kind text not null check (kind in ('template','job')), source_pipeline_id uuid references public.pipelines(id),
  is_default boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_default_pipeline on public.pipelines(organization_id) where is_default and kind='template';
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade, name text not null, stage_key text not null,
  stage_type text not null default 'active' check (stage_type in ('active','placed','rejected','withdrawn','on_hold')),
  position integer not null check (position >= 0), color text, is_client_visible boolean not null default false,
  unique(pipeline_id, stage_key), unique(pipeline_id, position)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id), pipeline_id uuid, title text not null,
  location text, employment_type text, salary_min numeric(14,2), salary_max numeric(14,2), currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  placement_fee_percentage numeric(6,3), fixed_fee numeric(14,2), priority text not null default 'normal',
  status text not null default 'open' check(status in ('draft','open','on_hold','filled','cancelled','closed')),
  owner_member_id uuid references public.organization_members(id), description text, requirements text, internal_notes text, client_visible_notes text,
  opened_at timestamptz, target_close_date date, created_by uuid not null references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (salary_min is null or salary_max is null or salary_min <= salary_max)
);
alter table public.pipelines add column job_id uuid unique references public.jobs(id) deferrable initially deferred;
alter table public.jobs add constraint jobs_pipeline_fk foreign key(pipeline_id) references public.pipelines(id) deferrable initially deferred;

create table public.job_contacts (
  job_id uuid not null references public.jobs(id) on delete cascade, contact_id uuid not null references public.contacts(id),
  organization_id uuid not null references public.organizations(id) on delete cascade, is_primary boolean not null default false, primary key(job_id,contact_id)
);
create table public.job_team_members (
  job_id uuid not null references public.jobs(id) on delete cascade, member_id uuid not null references public.organization_members(id),
  organization_id uuid not null references public.organizations(id) on delete cascade, team_role text, primary key(job_id,member_id)
);
create table public.job_target_companies (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, company_name text not null,
  mode text not null check(mode in ('target','excluded')), unique(job_id, company_name, mode)
);
create table public.job_candidates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id), candidate_id uuid not null references public.candidates(id), current_stage_id uuid not null references public.pipeline_stages(id),
  source text, owner_member_id uuid references public.organization_members(id), added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz,
  unique(job_id,candidate_id)
);
create table public.stage_history (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_candidate_id uuid not null references public.job_candidates(id) on delete cascade, from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id), changed_by uuid references auth.users(id), source text not null default 'manual',
  note text, occurred_at timestamptz not null default now()
);

create table public.submission_packages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id), contact_id uuid references public.contacts(id), title text not null,
  message text, status text not null default 'draft' check(status in ('draft','shared','reviewed','closed')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.candidate_submissions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null references public.submission_packages(id) on delete cascade, job_candidate_id uuid not null references public.job_candidates(id),
  candidate_summary text not null, recruiter_comments text, suitability_assessment text, relevant_experience text,
  salary numeric(14,2), expected_salary numeric(14,2), currency char(3), notice_period text, availability text, motivation text,
  relocation_willingness text, interview_availability text, status text not null default 'submitted', created_at timestamptz not null default now(),
  unique(package_id,job_candidate_id)
);
create table public.public_submission_links (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null references public.submission_packages(id) on delete cascade, token_hash text not null unique,
  token_prefix text not null, recipient_name text, recipient_email text, expires_at timestamptz not null,
  revoked_at timestamptz, last_accessed_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.submission_feedback (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  link_id uuid not null references public.public_submission_links(id), candidate_submission_id uuid not null references public.candidate_submissions(id),
  decision text not null check(decision in ('approve','reject','interview','hold')), comments text, reviewer_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(link_id,candidate_submission_id)
);
create table public.submission_link_events (
  id bigint generated always as identity primary key, link_id uuid not null references public.public_submission_links(id) on delete cascade,
  event_type text not null, ip_hash text, occurred_at timestamptz not null default now()
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_candidate_id uuid not null references public.job_candidates(id), interview_type text, stage_label text,
  starts_at timestamptz not null, ends_at timestamptz not null, timezone text not null, location text, meeting_url text,
  status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled','no_show')),
  notes text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at > starts_at)
);
create table public.interview_attendees (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade, member_id uuid references public.organization_members(id),
  contact_id uuid references public.contacts(id), external_name text, external_email text,
  check(num_nonnulls(member_id,contact_id,external_email)=1)
);
create table public.offers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_candidate_id uuid not null references public.job_candidates(id), salary numeric(14,2) not null check(salary>=0), currency char(3) not null,
  offered_at date not null default current_date, start_date date, status text not null default 'draft' check(status in ('draft','presented','accepted','declined','withdrawn')),
  notes text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.placements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_candidate_id uuid not null unique references public.job_candidates(id), offer_id uuid references public.offers(id),
  candidate_id uuid not null references public.candidates(id), job_id uuid not null references public.jobs(id), company_id uuid not null references public.companies(id),
  start_date date not null, salary numeric(14,2) not null, placement_fee numeric(14,2) not null check(placement_fee>=0),
  fee_percentage numeric(6,3), fixed_fee numeric(14,2), currency char(3) not null, owner_member_id uuid references public.organization_members(id),
  guarantee_days integer not null default 90, guarantee_ends_on date generated always as (start_date + guarantee_days) stored,
  status text not null default 'confirmed' check(status in ('confirmed','started','failed_guarantee','completed','cancelled')),
  replacement_status text, notes text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.placement_revenue_splits (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  placement_id uuid not null references public.placements(id) on delete cascade, member_id uuid not null references public.organization_members(id),
  split_percentage numeric(6,3) not null check(split_percentage between 0 and 100), split_amount numeric(14,2), unique(placement_id,member_id)
);
create table public.placement_invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  placement_id uuid not null references public.placements(id), invoice_reference text, amount numeric(14,2) not null check(amount>=0), currency char(3) not null,
  issued_on date, due_on date, status text not null default 'not_issued' check(status in ('not_issued','draft','issued','overdue','paid','void')),
  paid_on date, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.guarantee_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  placement_id uuid not null references public.placements(id), event_type text not null, occurred_on date not null default current_date,
  notes text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_type text not null check(activity_type in ('call','email','whatsapp','meeting','interview','status_change','submission','client_feedback','placement','other')),
  direction text check(direction in ('inbound','outbound','internal')), subject text, summary text not null,
  occurred_at timestamptz not null default now(), owner_member_id uuid references public.organization_members(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.activity_links (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, candidate_id uuid references public.candidates(id),
  company_id uuid references public.companies(id), contact_id uuid references public.contacts(id), job_id uuid references public.jobs(id),
  candidate_submission_id uuid references public.candidate_submissions(id), placement_id uuid references public.placements(id),
  check(num_nonnulls(candidate_id,company_id,contact_id,job_id,candidate_submission_id,placement_id)=1)
);
create table public.notes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  content text not null, visibility text not null default 'internal' check(visibility in ('internal','client_visible')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.note_links (
  id uuid primary key default gen_random_uuid(), note_id uuid not null references public.notes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, candidate_id uuid references public.candidates(id),
  company_id uuid references public.companies(id), contact_id uuid references public.contacts(id), job_id uuid references public.jobs(id),
  candidate_submission_id uuid references public.candidate_submissions(id), placement_id uuid references public.placements(id),
  check(num_nonnulls(candidate_id,company_id,contact_id,job_id,candidate_submission_id,placement_id)=1)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null, description text, status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')), due_at timestamptz,
  owner_member_id uuid references public.organization_members(id), completed_at timestamptz, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.task_links (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, candidate_id uuid references public.candidates(id),
  company_id uuid references public.companies(id), contact_id uuid references public.contacts(id), job_id uuid references public.jobs(id),
  candidate_submission_id uuid references public.candidate_submissions(id), placement_id uuid references public.placements(id),
  check(num_nonnulls(candidate_id,company_id,contact_id,job_id,candidate_submission_id,placement_id)=1)
);
create table public.task_reminders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade, remind_at timestamptz not null, delivered_at timestamptz, unique(task_id,remind_at)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, color text, unique(organization_id,name)
);
create table public.candidate_tags(candidate_id uuid references public.candidates(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade, primary key(candidate_id,tag_id));
create table public.company_tags(company_id uuid references public.companies(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade, primary key(company_id,tag_id));
create table public.contact_tags(contact_id uuid references public.contacts(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade, primary key(contact_id,tag_id));
create table public.job_tags(job_id uuid references public.jobs(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade, primary key(job_id,tag_id));

create table public.documents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null, storage_path text not null, mime_type text not null, size_bytes bigint not null check(size_bytes>=0),
  document_type text not null, version integer not null default 1, is_current boolean not null default true,
  uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique(organization_id,storage_path)
);
create table public.document_links (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, candidate_id uuid references public.candidates(id),
  company_id uuid references public.companies(id), contact_id uuid references public.contacts(id), job_id uuid references public.jobs(id),
  candidate_submission_id uuid references public.candidate_submissions(id), placement_id uuid references public.placements(id),
  check(num_nonnulls(candidate_id,company_id,contact_id,job_id,candidate_submission_id,placement_id)=1)
);

create table public.templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, template_type text not null, content text not null, variables jsonb not null default '[]'::jsonb,
  is_default boolean not null default false, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.saved_views (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_member_id uuid not null references public.organization_members(id), resource text not null, name text not null,
  filters jsonb not null default '{}'::jsonb, columns jsonb not null default '[]'::jsonb, is_shared boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_member_id,resource,name)
);
create table public.imports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check(entity_type in ('candidates','companies','contacts','jobs')), file_name text not null,
  status text not null default 'staged' check(status in ('staged','validating','ready','committing','completed','failed')),
  mapping jsonb not null default '{}'::jsonb, total_rows integer not null default 0, valid_rows integer not null default 0,
  failed_rows integer not null default 0, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.import_rows (
  id bigint generated always as identity primary key, import_id uuid not null references public.imports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, row_number integer not null,
  source_data jsonb not null, mapped_data jsonb, errors jsonb not null default '[]'::jsonb, duplicate_candidate_id uuid references public.candidates(id),
  status text not null default 'pending', unique(import_id,row_number)
);
create table public.exports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  export_type text not null, status text not null default 'pending', storage_path text, requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz
);
create table public.integrations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null, status text not null default 'disconnected', configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,provider)
);
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null, payload jsonb not null default '{}'::jsonb, idempotency_key text, status text not null default 'pending' check(status in ('pending','processing','completed','failed','dead_letter')),
  priority integer not null default 0, attempts integer not null default 0, max_attempts integer not null default 5,
  available_at timestamptz not null default now(), locked_at timestamptz, locked_by text, error_message text,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index background_job_idempotency on public.background_jobs(organization_id,idempotency_key) where idempotency_key is not null and status in ('pending','processing');
create table public.ai_evaluations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id), job_id uuid references public.jobs(id), evaluation_type text not null,
  provider text not null, model text not null, prompt_version text not null, status text not null,
  evidence jsonb not null default '[]'::jsonb, matched_requirements jsonb not null default '[]'::jsonb,
  missing_requirements jsonb not null default '[]'::jsonb, uncertainties jsonb not null default '[]'::jsonb,
  summary text, score numeric(5,2), raw_response jsonb, requested_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Search and list indexes.
create index candidates_org_name on public.candidates(organization_id,full_name) where deleted_at is null;
create index candidates_name_trgm on public.candidates using gin(full_name extensions.gin_trgm_ops);
create index companies_org_name on public.companies(organization_id,name) where deleted_at is null;
create index companies_name_trgm on public.companies using gin(name extensions.gin_trgm_ops);
create index contacts_org_name on public.contacts(organization_id,full_name) where deleted_at is null;
create index jobs_org_status on public.jobs(organization_id,status,updated_at desc) where deleted_at is null;
create index job_candidates_job_stage on public.job_candidates(job_id,current_stage_id);
create index stage_history_candidate_date on public.stage_history(job_candidate_id,occurred_at desc);
create index tasks_org_due on public.tasks(organization_id,status,due_at) where deleted_at is null;
create index activities_org_date on public.activities(organization_id,occurred_at desc);
create index placements_org_start on public.placements(organization_id,start_date desc);

-- Updated-at triggers.
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','organizations','roles','companies','contacts','commercial_terms','candidates','candidate_private_details','pipelines','jobs','job_candidates','submission_packages','submission_feedback','interviews','offers','placements','placement_invoices','notes','tasks','templates','saved_views','integrations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name||'_touch', table_name);
  end loop;
end $$;

insert into public.permissions(key,description) values
('organization.manage','Manage workspace settings and team'),('roles.manage','Manage roles and permissions'),
('candidates.read','Read candidates'),('candidates.write','Create and update candidates'),('candidates.delete','Archive and merge candidates'),('candidates_private.read','Read private candidate details'),
('companies.read','Read client companies'),('companies.write','Manage client companies'),('contacts.read','Read contacts'),('contacts.write','Manage contacts'),
('commercial_terms.read','Read commercial terms'),('commercial_terms.write','Manage commercial terms'),
('jobs.read','Read jobs'),('jobs.write','Manage jobs'),('pipeline.move','Move candidates through pipelines'),
('submissions.read','Read submissions'),('submissions.write','Create submissions and client links'),
('activities.read','Read activities and notes'),('activities.write','Create activities and notes'),('tasks.read','Read tasks'),('tasks.write','Manage tasks'),
('placements.read','Read placements'),('placements.write','Manage offers and placements'),('finance.read','Read fees and invoices'),('finance.write','Manage invoices and revenue splits'),
('reports.read','Read dashboards and reports'),('imports.manage','Import data'),('exports.manage','Export organization data'),('ai.use','Request AI evaluations')
on conflict do nothing;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active')
$$;
create or replace function public.has_permission(p_organization_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members m
    join public.member_roles mr on mr.member_id=m.id
    join public.role_permissions rp on rp.role_id=mr.role_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active' and rp.permission_key=p_permission
  )
$$;
revoke all on function public.is_organization_member(uuid),public.has_permission(uuid,text) from public;
grant execute on function public.is_organization_member(uuid),public.has_permission(uuid,text) to authenticated;

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
    elsif r.role_key='manager' then insert into public.role_permissions select new_id,key from public.permissions where key not in ('organization.manage','roles.manage','finance.write');
    elsif r.role_key='consultant' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','jobs.read','jobs.write','pipeline.move','submissions.read','submissions.write','activities.read','activities.write','tasks.read','tasks.write','placements.read','placements.write','reports.read','ai.use');
    elsif r.role_key='sourcer' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','jobs.read','pipeline.move','activities.read','activities.write','tasks.read','tasks.write','ai.use');
    elsif r.role_key='bd' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','commercial_terms.write','jobs.read','jobs.write','submissions.read','activities.read','activities.write','tasks.read','tasks.write','reports.read');
    elsif r.role_key='finance' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','jobs.read','placements.read','placements.write','finance.read','finance.write','reports.read','tasks.read','tasks.write');
    else insert into public.role_permissions select new_id,key from public.permissions where key like '%.read'; end if;
    role_key:=r.role_key; role_id:=new_id; return next;
  end loop;
end $$;

create or replace function public.create_organization(p_name text,p_slug text,p_currency char(3) default 'USD',p_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; member_id uuid; owner_role uuid; pipeline_id uuid; stage text; pos integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.organizations(name,slug,base_currency,timezone,created_by) values(trim(p_name),lower(trim(p_slug)),upper(p_currency),p_timezone,auth.uid()) returning id into org_id;
  insert into public.organization_settings(organization_id) values(org_id);
  insert into public.organization_members(organization_id,user_id,status) values(org_id,auth.uid(),'active') returning id into member_id;
  perform public.seed_organization_roles(org_id);
  select id into owner_role from public.roles where organization_id=org_id and role_key='owner';
  insert into public.member_roles(member_id,role_id) values(member_id,owner_role);
  insert into public.pipelines(organization_id,name,kind,is_default) values(org_id,'Agency recruitment','template',true) returning id into pipeline_id;
  foreach stage in array array['Sourced','Contacted','Interested','Screening','Longlisted','Shortlisted','Submitted to Client','Client Reviewing','Interview Scheduled','Interview Completed','Assessment','Reference Check','Offer','Placed','Rejected','Withdrawn','On Hold'] loop
    insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,position,is_client_visible)
    values(org_id,pipeline_id,stage,lower(replace(stage,' ','_')),case when stage='Placed' then 'placed' when stage='Rejected' then 'rejected' when stage='Withdrawn' then 'withdrawn' when stage='On Hold' then 'on_hold' else 'active' end,pos,stage in ('Submitted to Client','Client Reviewing','Interview Scheduled','Interview Completed','Offer','Placed')); pos:=pos+1;
  end loop;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(org_id,auth.uid(),'organization.created','organization',org_id);
  return org_id;
end $$;
grant execute on function public.create_organization(text,text,char,text) to authenticated;

create or replace function public.create_job_with_pipeline(p_organization_id uuid,p_company_id uuid,p_title text,p_owner_member_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare source_id uuid; new_pipeline uuid; new_job uuid;
begin
  if not public.has_permission(p_organization_id,'jobs.write') then raise exception 'Access denied'; end if;
  select id into source_id from public.pipelines where organization_id=p_organization_id and kind='template' and is_default;
  insert into public.jobs(organization_id,company_id,title,owner_member_id,created_by,opened_at) values(p_organization_id,p_company_id,trim(p_title),p_owner_member_id,auth.uid(),now()) returning id into new_job;
  insert into public.pipelines(organization_id,name,kind,source_pipeline_id,job_id) values(p_organization_id,p_title||' pipeline','job',source_id,new_job) returning id into new_pipeline;
  insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,position,color,is_client_visible)
    select p_organization_id,new_pipeline,name,stage_key,stage_type,position,color,is_client_visible from public.pipeline_stages where pipeline_id=source_id order by position;
  update public.jobs set pipeline_id=new_pipeline where id=new_job;
  return new_job;
end $$;
grant execute on function public.create_job_with_pipeline(uuid,uuid,text,uuid) to authenticated;

create or replace function public.move_job_candidate_stage(p_job_candidate_id uuid,p_stage_id uuid,p_note text default null,p_source text default 'manual')
returns public.job_candidates language plpgsql security definer set search_path=public as $$
declare item public.job_candidates; old_stage uuid;
begin
  select * into item from public.job_candidates where id=p_job_candidate_id;
  if item.id is null or not public.has_permission(item.organization_id,'pipeline.move') then raise exception 'Record not found'; end if;
  if not exists(select 1 from public.pipeline_stages s join public.jobs j on j.pipeline_id=s.pipeline_id where s.id=p_stage_id and j.id=item.job_id and s.organization_id=item.organization_id) then raise exception 'Invalid pipeline stage'; end if;
  old_stage:=item.current_stage_id;
  update public.job_candidates set current_stage_id=p_stage_id,updated_at=now() where id=item.id returning * into item;
  insert into public.stage_history(organization_id,job_candidate_id,from_stage_id,to_stage_id,changed_by,source,note) values(item.organization_id,item.id,old_stage,p_stage_id,auth.uid(),p_source,p_note);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(item.organization_id,auth.uid(),'pipeline.stage_changed','job_candidate',item.id,jsonb_build_object('from',old_stage,'to',p_stage_id));
  return item;
end $$;
grant execute on function public.move_job_candidate_stage(uuid,uuid,text,text) to authenticated;

create or replace function public.create_submission_package(p_organization_id uuid,p_job_id uuid,p_title text,p_items jsonb,p_contact_id uuid default null,p_message text default null,p_recipient_name text default null,p_recipient_email text default null,p_expiry_days integer default 7)
returns jsonb language plpgsql security definer set search_path=public as $$
declare package_id uuid; link_id uuid; raw_token text; item jsonb; jc public.job_candidates; expires timestamptz;
begin
  if not public.has_permission(p_organization_id,'submissions.write') then raise exception 'Access denied'; end if;
  if p_expiry_days not between 1 and 30 then raise exception 'Expiry must be 1 to 30 days'; end if;
  insert into public.submission_packages(organization_id,job_id,contact_id,title,message,status,created_by) values(p_organization_id,p_job_id,p_contact_id,p_title,p_message,'shared',auth.uid()) returning id into package_id;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into jc from public.job_candidates where id=(item->>'job_candidate_id')::uuid and job_id=p_job_id and organization_id=p_organization_id;
    if jc.id is null then raise exception 'Candidate not found'; end if;
    insert into public.candidate_submissions(organization_id,package_id,job_candidate_id,candidate_summary,recruiter_comments,suitability_assessment,relevant_experience,expected_salary,currency,notice_period,availability,motivation,relocation_willingness,interview_availability)
    values(p_organization_id,package_id,jc.id,coalesce(item->>'candidate_summary',''),item->>'recruiter_comments',item->>'suitability_assessment',item->>'relevant_experience',nullif(item->>'expected_salary','')::numeric,item->>'currency',item->>'notice_period',item->>'availability',item->>'motivation',item->>'relocation_willingness',item->>'interview_availability');
  end loop;
  raw_token:=encode(extensions.gen_random_bytes(32),'base64'); raw_token:=replace(replace(replace(raw_token,'+','-'),'/','_'),'=',''); expires:=now()+make_interval(days=>p_expiry_days);
  insert into public.public_submission_links(organization_id,package_id,token_hash,token_prefix,recipient_name,recipient_email,expires_at,created_by)
  values(p_organization_id,package_id,encode(extensions.digest(raw_token,'sha256'),'hex'),left(raw_token,8),p_recipient_name,public.normalize_email(p_recipient_email),expires,auth.uid()) returning id into link_id;
  return jsonb_build_object('package_id',package_id,'link_id',link_id,'token',raw_token,'expires_at',expires);
end $$;
grant execute on function public.create_submission_package(uuid,uuid,text,jsonb,uuid,text,text,text,integer) to authenticated;

create or replace function public.request_ip_hash()
returns text language sql stable security definer set search_path=public as $$
  select encode(extensions.digest(coalesce(nullif(split_part((coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for'),',',1),''),'unknown'),'sha256'),'hex')
$$;
revoke all on function public.request_ip_hash() from public;

create or replace function public.resolve_submission_link(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; result jsonb;
begin
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then return null; end if;
  if (select count(*) from public.submission_link_events where link_id=link.id and event_type='view' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=60 then raise exception 'rate_limited' using errcode='P0001'; end if;
  update public.public_submission_links set last_accessed_at=now() where id=link.id;
  insert into public.submission_link_events(link_id,event_type,ip_hash) values(link.id,'view',public.request_ip_hash());
  select jsonb_build_object(
    'package',jsonb_build_object('id',sp.id,'title',sp.title,'message',sp.message,'job_title',j.title,'company_name',co.name,'recipient_name',link.recipient_name,'expires_at',link.expires_at),
    'candidates',coalesce(jsonb_agg(jsonb_build_object('submission_id',cs.id,'candidate_name',c.full_name,'current_company',c.current_company,'current_position',c.current_position,'location',c.location,'linkedin_url',c.linkedin_url,'portfolio_url',c.portfolio_url,'candidate_summary',cs.candidate_summary,'recruiter_comments',cs.recruiter_comments,'suitability_assessment',cs.suitability_assessment,'relevant_experience',cs.relevant_experience,'expected_salary',cs.expected_salary,'currency',cs.currency,'notice_period',cs.notice_period,'availability',cs.availability,'motivation',cs.motivation,'relocation_willingness',cs.relocation_willingness,'interview_availability',cs.interview_availability,'feedback',case when sf.id is null then null else jsonb_build_object('decision',sf.decision,'comments',sf.comments,'reviewer_name',sf.reviewer_name,'updated_at',sf.updated_at) end) order by c.full_name),'[]'::jsonb)
  ) into result
  from public.submission_packages sp join public.jobs j on j.id=sp.job_id join public.companies co on co.id=j.company_id
  join public.candidate_submissions cs on cs.package_id=sp.id join public.job_candidates jc on jc.id=cs.job_candidate_id join public.candidates c on c.id=jc.candidate_id
  left join public.submission_feedback sf on sf.link_id=link.id and sf.candidate_submission_id=cs.id where sp.id=link.package_id group by sp.id,j.id,co.id,link.id;
  return result;
end $$;
revoke all on function public.resolve_submission_link(text) from public;
grant execute on function public.resolve_submission_link(text) to anon,authenticated;

create or replace function public.submit_submission_feedback(p_token text,p_candidate_submission_id uuid,p_decision text,p_comments text default null,p_reviewer_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; submission public.candidate_submissions; feedback_id uuid;
begin
  if p_decision not in ('approve','reject','interview','hold') then raise exception 'Invalid decision'; end if;
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then raise exception 'Link not found'; end if;
  if (select count(*) from public.submission_link_events where link_id=link.id and event_type='feedback' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited' using errcode='P0001'; end if;
  select * into submission from public.candidate_submissions where id=p_candidate_submission_id and package_id=link.package_id;
  if submission.id is null then raise exception 'Candidate not found'; end if;
  insert into public.submission_feedback(organization_id,link_id,candidate_submission_id,decision,comments,reviewer_name)
  values(link.organization_id,link.id,submission.id,p_decision,p_comments,p_reviewer_name)
  on conflict(link_id,candidate_submission_id) do update set decision=excluded.decision,comments=excluded.comments,reviewer_name=excluded.reviewer_name,updated_at=now() returning id into feedback_id;
  insert into public.submission_link_events(link_id,event_type,ip_hash) values(link.id,'feedback',public.request_ip_hash());
  insert into public.activities(organization_id,activity_type,direction,subject,summary,created_by)
    values(link.organization_id,'client_feedback','inbound','Client feedback',coalesce(p_reviewer_name,'Client reviewer')||' selected '||p_decision,(select created_by from public.submission_packages where id=link.package_id));
  return jsonb_build_object('ok',true,'feedback_id',feedback_id);
end $$;
revoke all on function public.submit_submission_feedback(text,uuid,text,text,text) from public;
grant execute on function public.submit_submission_feedback(text,uuid,text,text,text) to anon,authenticated;

create or replace function public.create_placement_from_offer(p_offer_id uuid,p_fee numeric,p_guarantee_days integer default 90)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.offers; jc public.job_candidates; j public.jobs; new_id uuid; placed_stage uuid;
begin
  select * into o from public.offers where id=p_offer_id and status='accepted';
  if o.id is null or not public.has_permission(o.organization_id,'placements.write') then raise exception 'Offer not found'; end if;
  select * into jc from public.job_candidates where id=o.job_candidate_id; select * into j from public.jobs where id=jc.job_id;
  insert into public.placements(organization_id,job_candidate_id,offer_id,candidate_id,job_id,company_id,start_date,salary,placement_fee,fee_percentage,fixed_fee,currency,owner_member_id,guarantee_days,created_by)
  values(o.organization_id,jc.id,o.id,jc.candidate_id,j.id,j.company_id,coalesce(o.start_date,current_date),o.salary,p_fee,j.placement_fee_percentage,j.fixed_fee,o.currency,jc.owner_member_id,p_guarantee_days,auth.uid()) returning id into new_id;
  select id into placed_stage from public.pipeline_stages where pipeline_id=j.pipeline_id and stage_type='placed' order by position limit 1;
  if placed_stage is not null then perform public.move_job_candidate_stage(jc.id,placed_stage,'Placement created','placement'); end if;
  update public.candidates set status='placed',updated_by=auth.uid() where id=jc.candidate_id; update public.jobs set status='filled',updated_by=auth.uid() where id=j.id;
  return new_id;
end $$;
grant execute on function public.create_placement_from_offer(uuid,numeric,integer) to authenticated;

create or replace function public.search_workspace(p_organization_id uuid,p_query text,p_limit integer default 20)
returns table(entity_type text,entity_id uuid,title text,subtitle text,rank real) language sql stable security definer set search_path=public as $$
  select * from (
    select 'candidate'::text,c.id,c.full_name,concat_ws(' · ',c.current_position,c.current_company,c.location),extensions.similarity(c.full_name,p_query)::real from public.candidates c where c.organization_id=p_organization_id and c.deleted_at is null and public.has_permission(p_organization_id,'candidates.read') and (c.full_name ilike '%'||p_query||'%' or c.current_company ilike '%'||p_query||'%' or c.current_position ilike '%'||p_query||'%')
    union all select 'company',co.id,co.name,concat_ws(' · ',co.industry,co.location),extensions.similarity(co.name,p_query)::real from public.companies co where co.organization_id=p_organization_id and co.deleted_at is null and public.has_permission(p_organization_id,'companies.read') and (co.name ilike '%'||p_query||'%' or co.industry ilike '%'||p_query||'%')
    union all select 'contact',ct.id,ct.full_name,concat_ws(' · ',ct.position,co.name),extensions.similarity(ct.full_name,p_query)::real from public.contacts ct join public.companies co on co.id=ct.company_id where ct.organization_id=p_organization_id and ct.deleted_at is null and public.has_permission(p_organization_id,'contacts.read') and (ct.full_name ilike '%'||p_query||'%' or ct.email ilike '%'||p_query||'%')
    union all select 'job',j.id,j.title,concat_ws(' · ',co.name,j.location),extensions.similarity(j.title,p_query)::real from public.jobs j join public.companies co on co.id=j.company_id where j.organization_id=p_organization_id and j.deleted_at is null and public.has_permission(p_organization_id,'jobs.read') and (j.title ilike '%'||p_query||'%' or j.description ilike '%'||p_query||'%')
  ) results(entity_type,entity_id,title,subtitle,rank) order by rank desc,title limit least(p_limit,100)
$$;
grant execute on function public.search_workspace(uuid,text,integer) to authenticated;

-- RLS: all base tables denied until an explicit member policy applies.
do $$ declare t text; begin
  foreach t in array array[
    'profiles','organizations','organization_settings','organization_members','permissions','roles','role_permissions','member_roles','organization_invitations',
    'companies','contacts','commercial_terms','candidates','candidate_private_details','candidate_employment','candidate_education','skills','candidate_skills','candidate_languages','candidate_preferred_locations','candidate_consents','candidate_merge_history',
    'pipelines','pipeline_stages','jobs','job_contacts','job_team_members','job_target_companies','job_candidates','stage_history','submission_packages','candidate_submissions','public_submission_links','submission_feedback','submission_link_events',
    'interviews','interview_attendees','offers','placements','placement_revenue_splits','placement_invoices','guarantee_events','activities','activity_links','notes','note_links','tasks','task_links','task_reminders',
    'tags','candidate_tags','company_tags','contact_tags','job_tags','documents','document_links','templates','saved_views','imports','import_rows','exports','integrations','background_jobs','ai_evaluations','audit_logs'
  ] loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

create policy profiles_self on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy organizations_member_read on public.organizations for select to authenticated using(public.is_organization_member(id));
create policy organization_settings_member_read on public.organization_settings for select to authenticated using(public.is_organization_member(organization_id));
create policy organization_settings_manage on public.organization_settings for all to authenticated using(public.has_permission(organization_id,'organization.manage')) with check(public.has_permission(organization_id,'organization.manage'));
create policy organization_members_read on public.organization_members for select to authenticated using(public.is_organization_member(organization_id));
create policy organization_members_manage on public.organization_members for all to authenticated using(public.has_permission(organization_id,'organization.manage')) with check(public.has_permission(organization_id,'organization.manage'));
create policy permissions_authenticated_read on public.permissions for select to authenticated using(true);
create policy roles_member_read on public.roles for select to authenticated using(public.is_organization_member(organization_id));
create policy roles_manage on public.roles for all to authenticated using(public.has_permission(organization_id,'roles.manage')) with check(public.has_permission(organization_id,'roles.manage'));
create policy role_permissions_member_read on public.role_permissions for select to authenticated using(exists(select 1 from public.roles r where r.id=role_id and public.is_organization_member(r.organization_id)));
create policy role_permissions_manage on public.role_permissions for all to authenticated using(exists(select 1 from public.roles r where r.id=role_id and public.has_permission(r.organization_id,'roles.manage'))) with check(exists(select 1 from public.roles r where r.id=role_id and public.has_permission(r.organization_id,'roles.manage')));
create policy member_roles_member_read on public.member_roles for select to authenticated using(exists(select 1 from public.organization_members m where m.id=member_id and public.is_organization_member(m.organization_id)));
create policy member_roles_manage on public.member_roles for all to authenticated using(exists(select 1 from public.organization_members m where m.id=member_id and public.has_permission(m.organization_id,'roles.manage'))) with check(exists(select 1 from public.organization_members m where m.id=member_id and public.has_permission(m.organization_id,'roles.manage')));
create policy invitations_manage on public.organization_invitations for all to authenticated using(public.has_permission(organization_id,'organization.manage')) with check(public.has_permission(organization_id,'organization.manage'));

do $$ declare spec text[]; tbl text; read_perm text; write_perm text; begin
  foreach spec slice 1 in array array[
    array['companies','companies.read','companies.write'],array['contacts','contacts.read','contacts.write'],array['commercial_terms','commercial_terms.read','commercial_terms.write'],
    array['candidates','candidates.read','candidates.write'],array['candidate_employment','candidates.read','candidates.write'],array['candidate_education','candidates.read','candidates.write'],array['skills','candidates.read','candidates.write'],array['candidate_skills','candidates.read','candidates.write'],array['candidate_languages','candidates.read','candidates.write'],array['candidate_preferred_locations','candidates.read','candidates.write'],array['candidate_consents','candidates_private.read','candidates.write'],array['candidate_merge_history','candidates.read','candidates.delete'],
    array['pipelines','jobs.read','jobs.write'],array['pipeline_stages','jobs.read','jobs.write'],array['jobs','jobs.read','jobs.write'],array['job_contacts','jobs.read','jobs.write'],array['job_team_members','jobs.read','jobs.write'],array['job_target_companies','jobs.read','jobs.write'],array['job_candidates','jobs.read','pipeline.move'],array['stage_history','jobs.read','pipeline.move'],
    array['submission_packages','submissions.read','submissions.write'],array['candidate_submissions','submissions.read','submissions.write'],array['public_submission_links','submissions.read','submissions.write'],array['submission_feedback','submissions.read','submissions.write'],
    array['interviews','placements.read','placements.write'],array['interview_attendees','placements.read','placements.write'],array['offers','placements.read','placements.write'],array['placements','placements.read','placements.write'],array['placement_revenue_splits','finance.read','finance.write'],array['placement_invoices','finance.read','finance.write'],array['guarantee_events','placements.read','placements.write'],
    array['activities','activities.read','activities.write'],array['activity_links','activities.read','activities.write'],array['notes','activities.read','activities.write'],array['note_links','activities.read','activities.write'],array['tasks','tasks.read','tasks.write'],array['task_links','tasks.read','tasks.write'],array['task_reminders','tasks.read','tasks.write'],
    array['tags','candidates.read','candidates.write'],array['candidate_tags','candidates.read','candidates.write'],array['company_tags','companies.read','companies.write'],array['contact_tags','contacts.read','contacts.write'],array['job_tags','jobs.read','jobs.write'],
    array['documents','candidates.read','candidates.write'],array['document_links','candidates.read','candidates.write'],array['templates','submissions.read','submissions.write'],array['saved_views','reports.read','reports.read'],
    array['imports','imports.manage','imports.manage'],array['import_rows','imports.manage','imports.manage'],array['exports','exports.manage','exports.manage'],array['integrations','organization.manage','organization.manage'],array['background_jobs','organization.manage','organization.manage'],array['ai_evaluations','candidates.read','ai.use'],array['audit_logs','organization.manage','organization.manage']
  ] loop tbl:=spec[1]; read_perm:=spec[2]; write_perm:=spec[3];
    execute format('create policy %I on public.%I for select to authenticated using(public.has_permission(organization_id,%L))',tbl||'_read',tbl,read_perm);
    execute format('create policy %I on public.%I for all to authenticated using(public.has_permission(organization_id,%L)) with check(public.has_permission(organization_id,%L))',tbl||'_write',tbl,write_perm,write_perm);
  end loop;
end $$;
create policy candidate_private_read on public.candidate_private_details for select to authenticated using(public.has_permission(organization_id,'candidates_private.read'));
create policy candidate_private_write on public.candidate_private_details for all to authenticated using(public.has_permission(organization_id,'candidates.write')) with check(public.has_permission(organization_id,'candidates.write'));

-- Private storage buckets and organization-prefixed paths.
insert into storage.buckets(id,name,public,file_size_limit) values('candidate-documents','candidate-documents',false,26214400),('exports','exports',false,52428800) on conflict(id) do nothing;
create policy candidate_documents_read on storage.objects for select to authenticated using(bucket_id='candidate-documents' and public.is_organization_member((storage.foldername(name))[1]::uuid));
create policy candidate_documents_write on storage.objects for all to authenticated using(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write')) with check(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write'));
create policy exports_read on storage.objects for select to authenticated using(bucket_id='exports' and public.has_permission((storage.foldername(name))[1]::uuid,'exports.manage'));

-- Auth profile bootstrap; it grants no organization membership.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,email,full_name) values(new.id,coalesce(new.email,''),new.raw_user_meta_data->>'full_name') on conflict(id) do nothing; return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_user();

commit;
