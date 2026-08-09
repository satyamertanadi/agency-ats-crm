begin;

-- useWorkspaceCapabilities issued 15 parallel has_permission() round trips plus listTeamMembers on
-- every mount, and CapabilityRoute gates most routes behind it -- so 16 requests stood between a
-- cold load and the first rendered page. This returns the same answer in one.
--
-- It also moves the policy derivation (which permissions add up to "can view team reports", "can
-- view admin", "read only") out of the client. Those rules are authorization decisions; the client
-- re-deriving them from raw permission booleans meant two places had to agree, and only one of them
-- was enforced by the database.
create or replace function public.get_my_workspace_capabilities(p_organization_id uuid)
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
  read_only boolean
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
    -- Aggregates over a possibly-empty join, so this yields exactly one row (an empty array) for a
    -- non-member rather than no row at all. The caller must always get a well-formed all-false
    -- answer instead of an empty result it would have to special-case.
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
      -- reports.read alone is held by consultants, who should see only their own scorecard. The
      -- team view additionally requires either the explicit reports.team permission or a
      -- management role.
      ('reports.team' = any(mp.keys))
        or (('reports.read' = any(mp.keys)) and (rk.keys && array['owner','admin','manager','finance']::text[]))
        as can_view_team_reports
    from member_role_keys rk, member_permissions mp
  )
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
    ) as read_only
  from derived d, member_permissions mp
$$;

revoke all on function public.get_my_workspace_capabilities(uuid) from public;
grant execute on function public.get_my_workspace_capabilities(uuid) to authenticated;

commit;
