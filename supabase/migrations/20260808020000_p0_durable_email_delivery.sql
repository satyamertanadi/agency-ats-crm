-- P0: persist the exact secret-bearing delivery payload before an external email provider is called.
-- Authenticated users cannot read this table. The service role can retry the same email with the same
-- provider idempotency key after an explicit provider error, timeout, or function crash.
create table public.email_delivery_payloads (
  delivery_id uuid primary key references public.email_deliveries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  secret_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.email_delivery_payloads enable row level security;
revoke all on table public.email_delivery_payloads from public, anon, authenticated;
create index email_delivery_payloads_expiry on public.email_delivery_payloads(expires_at);
alter table public.email_deliveries add column request_key uuid;
create unique index email_delivery_request_idempotency
  on public.email_deliveries(organization_id,email_type,request_key)
  where request_key is not null;
create unique index email_delivery_one_entity
  on public.email_deliveries(email_type,related_entity_id)
  where related_entity_id is not null and email_type in ('team_invitation','client_submission');

create or replace function public.create_submission_delivery(
  p_organization_id uuid,p_job_id uuid,p_title text,p_items jsonb,p_request_key uuid,p_contact_id uuid default null,
  p_message text default null,p_recipient_name text default null,p_recipient_email text default null,
  p_expiry_days integer default 7
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_delivery_id uuid;
begin
  if public.normalize_email(p_recipient_email) is null then raise exception 'recipient_email_required' using errcode='22023'; end if;
  if p_request_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':client_submission:'||p_request_key::text,0));
  select jsonb_build_object(
    'package_id',delivery.related_entity_id,'delivery_id',delivery.id,
    'token',payload.secret_token,'expires_at',payload.expires_at
  ) into v_result
  from public.email_deliveries delivery
  join public.email_delivery_payloads payload on payload.delivery_id=delivery.id
  where delivery.organization_id=p_organization_id and delivery.email_type='client_submission'
    and delivery.request_key=p_request_key;
  if v_result is not null then return v_result; end if;
  v_result:=public.create_submission_package(
    p_organization_id,p_job_id,p_title,p_items,p_contact_id,p_message,p_recipient_name,p_recipient_email,p_expiry_days
  );
  insert into public.email_deliveries(
    organization_id,email_type,recipient_email,status,related_entity_type,related_entity_id,requested_by,request_key
  ) values(
    p_organization_id,'client_submission',public.normalize_email(p_recipient_email),'pending',
    'submission_package',(v_result->>'package_id')::uuid,auth.uid(),p_request_key
  ) returning id into v_delivery_id;
  insert into public.email_delivery_payloads(delivery_id,organization_id,secret_token,expires_at)
  values(v_delivery_id,p_organization_id,v_result->>'token',(v_result->>'expires_at')::timestamptz);
  return v_result||jsonb_build_object('delivery_id',v_delivery_id);
end $$;

revoke all on function public.create_submission_delivery(uuid,uuid,text,jsonb,uuid,uuid,text,text,text,integer) from public, anon;
grant execute on function public.create_submission_delivery(uuid,uuid,text,jsonb,uuid,uuid,text,text,text,integer) to authenticated;

create or replace function public.create_invitation_delivery(
  p_organization_id uuid,p_email text,p_role_id uuid,p_request_key uuid,p_expiry_days integer default 7
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_delivery_id uuid;
begin
  if p_request_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':team_invitation:'||p_request_key::text,0));
  select jsonb_build_object(
    'invitation_id',delivery.related_entity_id,'delivery_id',delivery.id,
    'token',payload.secret_token,'expires_at',payload.expires_at
  ) into v_result
  from public.email_deliveries delivery
  join public.email_delivery_payloads payload on payload.delivery_id=delivery.id
  where delivery.organization_id=p_organization_id and delivery.email_type='team_invitation'
    and delivery.request_key=p_request_key;
  if v_result is not null then return v_result; end if;
  v_result:=public.create_organization_invitation(p_organization_id,p_email,p_role_id,p_expiry_days);
  insert into public.email_deliveries(
    organization_id,email_type,recipient_email,status,related_entity_type,related_entity_id,requested_by,request_key
  ) values(
    p_organization_id,'team_invitation',public.normalize_email(p_email),'pending',
    'organization_invitation',(v_result->>'invitation_id')::uuid,auth.uid(),p_request_key
  ) returning id into v_delivery_id;
  insert into public.email_delivery_payloads(delivery_id,organization_id,secret_token,expires_at)
  values(v_delivery_id,p_organization_id,v_result->>'token',(v_result->>'expires_at')::timestamptz);
  return v_result||jsonb_build_object('delivery_id',v_delivery_id);
end $$;

revoke all on function public.create_invitation_delivery(uuid,text,uuid,uuid,integer) from public, anon;
grant execute on function public.create_invitation_delivery(uuid,text,uuid,uuid,integer) to authenticated;

-- Persist provider outcomes through one locked transition. Invitation status and
-- the delivery ledger cannot diverge, and a late timeout cannot downgrade a
-- delivery another concurrent attempt has already recorded as sent/delivered.
create or replace function public.finalize_email_delivery(
  p_delivery_id uuid,p_status text,p_provider_message_id text default null,
  p_error_code text default null,p_error_message text default null
) returns text language plpgsql security definer set search_path=public as $$
declare
  v_delivery public.email_deliveries%rowtype;
  v_final_status text;
begin
  if p_status not in ('pending','sent','delivered','failed','bounced','suppressed') then
    raise exception 'invalid_delivery_status' using errcode='22023';
  end if;
  select * into v_delivery from public.email_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='P0002'; end if;

  v_final_status:=case
    when v_delivery.status='delivered' then 'delivered'
    when v_delivery.status='sent' and p_status in ('pending','failed') then 'sent'
    else p_status
  end;
  update public.email_deliveries set
    provider_message_id=coalesce(p_provider_message_id,provider_message_id),
    status=v_final_status,
    error_code=case when v_final_status in ('sent','delivered') then null else p_error_code end,
    error_message=case when v_final_status in ('sent','delivered') then null else p_error_message end
  where id=p_delivery_id;

  if v_delivery.email_type='team_invitation' and v_delivery.related_entity_id is not null then
    update public.organization_invitations set
      delivery_status=v_final_status,
      delivery_id=coalesce(p_provider_message_id,delivery_id),
      last_sent_at=case when v_final_status='pending' then last_sent_at else now() end,
      delivery_error=case when v_final_status in ('sent','delivered') then null else p_error_message end
    where id=v_delivery.related_entity_id and organization_id=v_delivery.organization_id;
    if not found then raise exception 'invitation_not_found' using errcode='P0002'; end if;
  end if;
  return v_final_status;
end $$;

revoke all on function public.finalize_email_delivery(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_email_delivery(uuid,text,text,text,text) to service_role;
