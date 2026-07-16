alter table public.pipeline_stages
  add column if not exists phase_key text
  check (phase_key in ('sourcing','screening','shortlist','client_review','interview','offer','placed','other'));

update public.pipeline_stages
set phase_key=case
  when stage_key in ('sourced','contacted') then 'sourcing'
  when stage_key in ('interested','screening') then 'screening'
  when stage_key in ('longlisted','shortlisted','assessment','reference_check') then 'shortlist'
  when stage_key in ('submitted_to_client','client_reviewing') then 'client_review'
  when stage_key in ('interview_scheduled','interview_completed') then 'interview'
  when stage_key='offer' then 'offer'
  when stage_key='placed' or stage_type='placed' then 'placed'
  else phase_key
end
where phase_key is null;

create or replace function public.assign_pipeline_phase()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.phase_key is null then
    new.phase_key:=case
      when new.stage_key in ('sourced','contacted') then 'sourcing'
      when new.stage_key in ('interested','screening') then 'screening'
      when new.stage_key in ('longlisted','shortlisted','assessment','reference_check') then 'shortlist'
      when new.stage_key in ('submitted_to_client','client_reviewing') then 'client_review'
      when new.stage_key in ('interview_scheduled','interview_completed') then 'interview'
      when new.stage_key='offer' then 'offer'
      when new.stage_key='placed' or new.stage_type='placed' then 'placed'
      else null
    end;
  end if;
  return new;
end $$;

drop trigger if exists assign_pipeline_phase on public.pipeline_stages;
create trigger assign_pipeline_phase before insert or update of stage_key,stage_type,phase_key
on public.pipeline_stages for each row execute function public.assign_pipeline_phase();

insert into public.permissions(key,description)
values ('reports.team','Read agency-wide and consultant performance reports')
on conflict (key) do nothing;

-- Organization-scoped rollout switch. Existing workspaces enter the pilot by default, while
-- support can set consultant_first_v1=false without moving or copying recruitment data.
update public.organization_settings
set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('consultant_first_v1',true),
    updated_at=now()
where not (coalesce(settings,'{}'::jsonb) ? 'consultant_first_v1');

insert into public.role_permissions(role_id,permission_key)
select r.id,'reports.team'
from public.roles r
where r.role_key in ('owner','admin','manager','finance')
on conflict do nothing;

create table if not exists public.workflow_product_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  event_name text not null check (event_name in ('navigation_changed','action_started','action_completed','action_abandoned')),
  surface text not null,
  action_key text,
  destination text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.workflow_product_events is 'PII-free product telemetry. Never store record names, email addresses, free text, or entity identifiers.';
create index if not exists workflow_product_events_org_date on public.workflow_product_events(organization_id,occurred_at desc);
alter table public.workflow_product_events enable row level security;
create policy workflow_product_events_member_insert on public.workflow_product_events for insert to authenticated
with check (public.is_organization_member(organization_id) and actor_user_id=auth.uid());
create policy workflow_product_events_management_read on public.workflow_product_events for select to authenticated
using (public.has_permission(organization_id,'reports.team'));

create policy email_deliveries_own_read on public.email_deliveries for select to authenticated
using (requested_by=auth.uid() and public.is_organization_member(organization_id));
