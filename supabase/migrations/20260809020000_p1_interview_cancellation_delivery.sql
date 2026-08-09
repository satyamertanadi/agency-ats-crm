-- P1: cancelling an interview must not leave attendees holding a live invitation.
-- Queue one durable, idempotent email delivery per attendee in the same transaction that marks the
-- interview cancelled. The Edge Function can then safely retry Calendar and Resend side effects.
begin;

alter table public.email_deliveries
  drop constraint if exists email_deliveries_email_type_check;
alter table public.email_deliveries
  add constraint email_deliveries_email_type_check
  check (email_type in ('team_invitation','client_submission','calendar_failure','interview_cancellation'));

create unique index if not exists email_deliveries_interview_cancellation_recipient_unique
  on public.email_deliveries(related_entity_id,recipient_email)
  where email_type='interview_cancellation';

create or replace function public.queue_interview_cancellation(
  p_organization_id uuid,
  p_interview_id uuid
) returns table(delivery_id uuid,recipient_email text,delivery_status text)
language plpgsql security definer set search_path=public as $$
declare
  v_interview public.interviews%rowtype;
  v_email text;
  v_changed boolean:=false;
begin
  if auth.uid() is null or not public.has_permission(p_organization_id,'interviews.write') then
    raise exception 'interview_not_found' using errcode='P0002';
  end if;

  select * into v_interview
  from public.interviews
  where id=p_interview_id and organization_id=p_organization_id
  for update;
  if not found then raise exception 'interview_not_found' using errcode='P0002'; end if;
  if v_interview.status not in ('scheduled','cancelled') then
    raise exception 'interview_not_cancellable' using errcode='22023';
  end if;

  if v_interview.status='scheduled' then
    update public.interviews set
      status='cancelled',cancelled_at=now(),
      calendar_sync_status=case when calendar_event_id is null then 'cancelled' else 'pending' end,
      calendar_last_error=null,updated_at=now()
    where id=v_interview.id;
    v_changed:=true;
  end if;

  for v_email in
    select distinct lower(trim(value))
    from unnest(coalesce(v_interview.attendee_emails,'{}'::text[])) value
    where trim(value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  loop
    insert into public.email_deliveries(
      organization_id,email_type,recipient_email,status,related_entity_type,related_entity_id,requested_by
    ) values(
      p_organization_id,'interview_cancellation',v_email,'pending','interview',v_interview.id,auth.uid()
    ) on conflict do nothing;
  end loop;

  if v_changed then
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'interview.cancelled','interview',v_interview.id,
      jsonb_build_object('attendee_count',(select count(distinct lower(trim(value))) from unnest(coalesce(v_interview.attendee_emails,'{}'::text[])) value)));
  end if;

  return query
  select delivery.id,delivery.recipient_email,delivery.status
  from public.email_deliveries delivery
  where delivery.organization_id=p_organization_id
    and delivery.email_type='interview_cancellation'
    and delivery.related_entity_id=v_interview.id
  order by delivery.recipient_email;
end $$;

revoke all on function public.queue_interview_cancellation(uuid,uuid) from public,anon;
grant execute on function public.queue_interview_cancellation(uuid,uuid) to authenticated;

commit;
