begin;

-- Reverses 20260715000000_seat_enforcement.sql.
--
-- A hard database cap of six active members, raisable only by service_role, on a product whose
-- entire pitch is "flat monthly fee, not per-user, unlike Vincere". The client's seventh hire would
-- have become a support ticket filed against our own positioning -- and the trigger fires on the
-- accept path, so the person who discovers the workspace is full is the new joiner, mid-signup.
--
-- is_vendor_support stays. It has a second, better use: excluding our own staff from the client's
-- performance reports.

drop trigger if exists organization_members_seat_limit on public.organization_members;
drop function if exists public.enforce_member_seat_limit();

-- Restored to its pre-seat-limit shape (20260713001000_secure_invitations.sql): same permission
-- check, same email and role validation, same single-outstanding-invitation-per-address behaviour,
-- without the read-side seat guard.
create or replace function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role_id uuid,p_expiry_days integer default 7)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare raw_token text; invitation_id uuid; normalized_email text:=lower(trim(p_email));
begin
  if not public.has_permission(p_organization_id,'organization.manage') then raise exception 'permission_denied' using errcode='42501'; end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'invalid_email' using errcode='22023'; end if;
  if not exists(select 1 from public.roles where id=p_role_id and organization_id=p_organization_id) then raise exception 'invalid_role' using errcode='22023'; end if;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  update public.organization_invitations set revoked_at=now() where organization_id=p_organization_id and lower(email)=normalized_email and accepted_at is null and revoked_at is null;
  insert into public.organization_invitations(organization_id,email,role_id,token_hash,invited_by,expires_at)
  values(p_organization_id,normalized_email,p_role_id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),now()+make_interval(days=>least(greatest(p_expiry_days,1),30))) returning id into invitation_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'invitation.created','organization_invitation',invitation_id,jsonb_build_object('email',normalized_email));
  return jsonb_build_object('invitation_id',invitation_id,'token',raw_token,'expires_at',now()+make_interval(days=>least(greatest(p_expiry_days,1),30)));
end$$;

revoke all on function public.create_organization_invitation(uuid,text,uuid,integer) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,uuid,integer) to authenticated;

alter table public.organizations drop column if exists seat_limit;

commit;
