begin;

-- Eight pre-baked roles -- owner, admin, manager, consultant, sourcer, bd, finance, readonly -- for a
-- six-person desk. Three of them (admin, manager, owner) differ only in which two or three
-- permissions they withhold from each other, and explaining that difference costs more than it buys.
--
-- Collapsed to owner / consultant / readonly. The permission KEYS are untouched: they are what RLS
-- actually enforces, they are well designed, and a workspace that needs a narrower bundle can still
-- have one created as a custom role. Only the pre-baked bundles collapse -- fewer roles to explain,
-- one permission matrix to reason about, identical enforcement.
create or replace function public.seed_organization_roles(p_organization_id uuid)
returns table(role_key text,role_id uuid) language plpgsql security definer set search_path=public as $$
declare r record; new_id uuid;
begin
  for r in select * from (values
    ('owner','Agency Owner'),('consultant','Recruitment Consultant'),('readonly','Read-only User')
  ) as v(role_key,name) loop
    insert into public.roles(organization_id,name,role_key,is_system) values(p_organization_id,r.name,r.role_key,true) returning id into new_id;
    if r.role_key='owner' then insert into public.role_permissions select new_id,key from public.permissions;
    elsif r.role_key='consultant' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','jobs.read','jobs.write','pipeline.move','submissions.read','submissions.write','activities.read','activities.write','tasks.read','tasks.write','placements.read','interviews.write','offers.write','placements.write','reports.read','ai.use');
    else insert into public.role_permissions select new_id,key from public.permissions where key like '%.read'; end if;
    role_key:=r.role_key; role_id:=new_id; return next;
  end loop;
end $$;

-- seed_organization_roles has no permission check and is called only from other security definer
-- functions in the same transaction, so it stays unreachable from any client role
-- (see 20260726020000_harden_implicit_public_grants.sql).
revoke all on function public.seed_organization_roles(uuid) from public, anon, authenticated;

-- Retire the five withdrawn bundles from organizations that were provisioned before this change --
-- but only where nobody actually holds one. A role with a member behind it is left exactly as it is:
-- reassigning someone's access is a decision for whoever administers the workspace, not a side
-- effect of a migration.
delete from public.role_permissions rp
where exists(
  select 1 from public.roles r
  where r.id=rp.role_id
    and r.is_system
    and r.role_key in ('admin','manager','sourcer','bd','finance')
    and not exists(select 1 from public.member_roles mr where mr.role_id=r.id)
);
delete from public.roles r
where r.is_system
  and r.role_key in ('admin','manager','sourcer','bd','finance')
  and not exists(select 1 from public.member_roles mr where mr.role_id=r.id);

commit;
