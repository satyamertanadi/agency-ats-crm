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

create or replace function public.accept_organization_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare invitation public.organization_invitations%rowtype; new_member_id uuid; org_slug text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into invitation from public.organization_invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and accepted_at is null and revoked_at is null and expires_at>now() for update;
  if invitation.id is null then return null; end if;
  if lower(coalesce(auth.jwt()->>'email',''))<>lower(invitation.email) then raise exception 'invitation_email_mismatch' using errcode='42501'; end if;
  insert into public.organization_members(organization_id,user_id,status) values(invitation.organization_id,auth.uid(),'active') on conflict(organization_id,user_id) do update set status='active' returning id into new_member_id;
  insert into public.member_roles(member_id,role_id) values(new_member_id,invitation.role_id) on conflict do nothing;
  update public.organization_invitations set accepted_at=now() where id=invitation.id;
  select slug into org_slug from public.organizations where id=invitation.organization_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(invitation.organization_id,auth.uid(),'invitation.accepted','organization_member',new_member_id);
  return jsonb_build_object('organization_id',invitation.organization_id,'organization_slug',org_slug,'member_id',new_member_id);
end$$;

revoke all on function public.create_organization_invitation(uuid,text,uuid,integer) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,uuid,integer) to authenticated;
revoke all on function public.accept_organization_invitation(text) from public,anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;
