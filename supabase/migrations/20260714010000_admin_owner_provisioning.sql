begin;

create or replace function public.provision_initial_organization_owner(
  p_owner_email text,
  p_name text,
  p_slug text,
  p_currency char(3) default 'USD',
  p_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_owner_email text := public.normalize_email(p_owner_email);
  owner_user_id uuid;
  existing_organization_id uuid;
  new_organization_id uuid;
  new_member_id uuid;
  owner_role_id uuid;
  new_pipeline_id uuid;
  stage_name text;
  stage_position integer := 0;
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if normalized_owner_email is null then
    raise exception 'owner_email_required' using errcode = '22023';
  end if;

  select id
  into owner_user_id
  from auth.users
  where public.normalize_email(email) = normalized_owner_email
  order by created_at
  limit 1;

  if owner_user_id is null then
    raise exception 'owner_must_sign_in_first' using errcode = '22023';
  end if;

  select member.organization_id
  into existing_organization_id
  from public.organization_members member
  join public.member_roles member_role on member_role.member_id = member.id
  join public.roles role on role.id = member_role.role_id and role.role_key = 'owner'
  where member.user_id = owner_user_id
    and member.status = 'active'
  order by member.created_at
  limit 1;

  if existing_organization_id is not null then
    return existing_organization_id;
  end if;

  insert into public.organizations(name, slug, base_currency, timezone, created_by)
  values (trim(p_name), lower(trim(p_slug)), upper(p_currency), p_timezone, owner_user_id)
  returning id into new_organization_id;

  insert into public.organization_settings(organization_id)
  values (new_organization_id);

  insert into public.organization_members(organization_id, user_id, status)
  values (new_organization_id, owner_user_id, 'active')
  returning id into new_member_id;

  perform public.seed_organization_roles(new_organization_id);

  select id
  into owner_role_id
  from public.roles
  where organization_id = new_organization_id
    and role_key = 'owner';

  insert into public.member_roles(member_id, role_id)
  values (new_member_id, owner_role_id);

  insert into public.pipelines(organization_id, name, kind, is_default)
  values (new_organization_id, 'Agency recruitment', 'template', true)
  returning id into new_pipeline_id;

  foreach stage_name in array array[
    'Sourced', 'Contacted', 'Interested', 'Screening', 'Longlisted', 'Shortlisted',
    'Submitted to Client', 'Client Reviewing', 'Interview Scheduled', 'Interview Completed',
    'Assessment', 'Reference Check', 'Offer', 'Placed', 'Rejected', 'Withdrawn', 'On Hold'
  ] loop
    insert into public.pipeline_stages(
      organization_id, pipeline_id, name, stage_key, stage_type, position, is_client_visible
    ) values (
      new_organization_id,
      new_pipeline_id,
      stage_name,
      lower(replace(stage_name, ' ', '_')),
      case
        when stage_name = 'Placed' then 'placed'
        when stage_name = 'Rejected' then 'rejected'
        when stage_name = 'Withdrawn' then 'withdrawn'
        when stage_name = 'On Hold' then 'on_hold'
        else 'active'
      end,
      stage_position,
      stage_name in ('Submitted to Client', 'Client Reviewing', 'Interview Scheduled', 'Interview Completed', 'Offer', 'Placed')
    );
    stage_position := stage_position + 1;
  end loop;

  insert into public.audit_logs(
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    new_organization_id,
    owner_user_id,
    'organization.provisioned',
    'organization',
    new_organization_id,
    jsonb_build_object(
      'owner_email', normalized_owner_email,
      'provisioning_method', 'service_role_rpc'
    )
  );

  return new_organization_id;
end
$$;

revoke all on function public.provision_initial_organization_owner(text, text, text, char, text)
from public, anon, authenticated;
grant execute on function public.provision_initial_organization_owner(text, text, text, char, text)
to service_role;

commit;
