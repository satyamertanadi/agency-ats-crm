-- Seat enforcement.
--
-- The pilot contract commits to six named client users (one owner, five consultants) plus one
-- additional named vendor support administrator. Until now that limit lived only in prose: nothing
-- stopped a seventh invitation. This makes it a database constraint.
--
-- seat_limit lives on public.organizations rather than organization_settings.settings because
-- organizations has no authenticated write policy -- only service_role can change a limit. Putting
-- it in settings would let any owner raise their own cap, and moving it later would mean editing
-- the billing path under pressure.

alter table public.organizations
  add column if not exists seat_limit integer not null default 6
    check (seat_limit between 1 and 500);

comment on column public.organizations.seat_limit is
  'Maximum active client members. Vendor support members are excluded. Writable only by service_role.';

-- Vendor support does not consume a client seat, matching both the pilot contract and the usual
-- SaaS model where the vendor's own staff are not billed to the customer.
alter table public.organization_members
  add column if not exists is_vendor_support boolean not null default false;

comment on column public.organization_members.is_vendor_support is
  'Named vendor support administrator. Excluded from seat_limit accounting. Set by service_role.';

-- security definer is required, not decorative: organizations is readable only by its own members
-- (organizations_member_read), so an invoker-rights trigger would read NULL while inserting the very
-- member being checked, silently skipping enforcement.
create or replace function public.enforce_member_seat_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare allowed integer; used integer;
begin
  -- Only seat-consuming rows matter: invited/suspended members and vendor support are free.
  if new.status <> 'active' or new.is_vendor_support then return new; end if;
  -- An already-active client member is not taking a new seat (e.g. a job_title edit).
  if tg_op = 'UPDATE' and old.status = 'active' and not old.is_vendor_support then return new; end if;

  select seat_limit into allowed from public.organizations where id = new.organization_id;
  if allowed is null then return new; end if;

  select count(*) into used
  from public.organization_members
  where organization_id = new.organization_id
    and status = 'active'
    and not is_vendor_support
    and id <> new.id;

  if used >= allowed then
    raise exception 'seat_limit_reached' using errcode='P0001',
      detail=format('%s of %s client seats are already in use.', used, allowed),
      hint='Suspend an existing member, or ask the vendor to raise this workspace''s seat limit.';
  end if;
  return new;
end$$;

revoke all on function public.enforce_member_seat_limit() from public, anon, authenticated;

-- Covers every path into an active membership: create_organization_invitation ->
-- accept_organization_invitation (which upserts), update_member_access reactivation, and a direct
-- insert by anyone holding organization.manage (organization_members_manage permits `for all`).
-- Guarding only the RPCs would leave that third path open.
drop trigger if exists organization_members_seat_limit on public.organization_members;
create trigger organization_members_seat_limit
  before insert or update of status, is_vendor_support on public.organization_members
  for each row execute function public.enforce_member_seat_limit();

-- Read-side guard so the limit surfaces to the owner at invite time. Without it the first person to
-- learn the workspace is full is the invitee, when their acceptance fails. Outstanding invitations
-- are counted as committed seats: promising a seat that will not exist is the same bug, deferred.
create or replace function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role_id uuid,p_expiry_days integer default 7)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare raw_token text; invitation_id uuid; normalized_email text:=lower(trim(p_email)); allowed integer; committed integer;
begin
  if not public.has_permission(p_organization_id,'organization.manage') then raise exception 'permission_denied' using errcode='42501'; end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'invalid_email' using errcode='22023'; end if;
  if not exists(select 1 from public.roles where id=p_role_id and organization_id=p_organization_id) then raise exception 'invalid_role' using errcode='22023'; end if;

  select seat_limit into allowed from public.organizations where id=p_organization_id;
  select (select count(*) from public.organization_members where organization_id=p_organization_id and status='active' and not is_vendor_support)
       + (select count(*) from public.organization_invitations where organization_id=p_organization_id and accepted_at is null and revoked_at is null and expires_at>now() and lower(email)<>normalized_email)
    into committed;
  if allowed is not null and committed >= allowed then
    raise exception 'seat_limit_reached' using errcode='P0001',
      detail=format('%s of %s client seats are already used or invited.', committed, allowed),
      hint='Suspend a member or revoke a pending invitation before inviting someone new.';
  end if;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  update public.organization_invitations set revoked_at=now() where organization_id=p_organization_id and lower(email)=normalized_email and accepted_at is null and revoked_at is null;
  insert into public.organization_invitations(organization_id,email,role_id,token_hash,invited_by,expires_at)
  values(p_organization_id,normalized_email,p_role_id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),now()+make_interval(days=>least(greatest(p_expiry_days,1),30))) returning id into invitation_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'invitation.created','organization_invitation',invitation_id,jsonb_build_object('email',normalized_email));
  return jsonb_build_object('invitation_id',invitation_id,'token',raw_token,'expires_at',now()+make_interval(days=>least(greatest(p_expiry_days,1),30)));
end$$;

revoke all on function public.create_organization_invitation(uuid,text,uuid,integer) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,uuid,integer) to authenticated;
