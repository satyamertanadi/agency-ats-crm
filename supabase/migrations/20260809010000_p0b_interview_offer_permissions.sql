-- Interviews, offers and placements are different commercial decisions. Bundling all three behind
-- placements.write meant a custom sourcer role either lost ordinary interview work or gained the
-- ability to confirm revenue-bearing placements. Give each write path its own least-privilege key.
begin;

insert into public.permissions(key,description) values
  ('interviews.write','Schedule and manage interviews'),
  ('offers.write','Create and manage offers')
on conflict (key) do update set description=excluded.description;

-- Preserve today's intended access for recruitment roles while removing interview/offer authority
-- from finance-only roles. Owner/admin/manager and consultant can still perform the whole consultant
-- journey; sourcer, BD, finance and read-only roles do not gain either new capability.
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key
from public.roles r
cross join public.permissions p
where r.role_key in ('owner','admin','manager','consultant')
  and p.key in ('interviews.write','offers.write')
on conflict do nothing;

-- New organizations must receive the same role model as organizations migrated above.
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
    elsif r.role_key='consultant' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','jobs.read','jobs.write','pipeline.move','submissions.read','submissions.write','activities.read','activities.write','tasks.read','tasks.write','placements.read','interviews.write','offers.write','placements.write','reports.read','ai.use');
    elsif r.role_key='sourcer' then insert into public.role_permissions select new_id,key from public.permissions where key in ('candidates.read','candidates.write','candidates_private.read','companies.read','jobs.read','pipeline.move','activities.read','activities.write','tasks.read','tasks.write','ai.use');
    elsif r.role_key='bd' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','companies.write','contacts.read','contacts.write','commercial_terms.read','commercial_terms.write','jobs.read','jobs.write','submissions.read','activities.read','activities.write','tasks.read','tasks.write','reports.read');
    elsif r.role_key='finance' then insert into public.role_permissions select new_id,key from public.permissions where key in ('companies.read','jobs.read','placements.read','placements.write','finance.read','finance.write','reports.read','tasks.read','tasks.write');
    else insert into public.role_permissions select new_id,key from public.permissions where key like '%.read'; end if;
    role_key:=r.role_key; role_id:=new_id; return next;
  end loop;
end $$;

-- Keep the existing placements.read boundary for viewing lifecycle details, but split writes so a
-- role can schedule interviews without presenting offers or creating placements.
drop policy if exists interviews_write on public.interviews;
create policy interviews_insert on public.interviews for insert to authenticated
  with check(public.has_permission(organization_id,'interviews.write'));
create policy interviews_update on public.interviews for update to authenticated
  using(public.has_permission(organization_id,'interviews.write'))
  with check(public.has_permission(organization_id,'interviews.write'));
create policy interviews_delete on public.interviews for delete to authenticated
  using(public.has_permission(organization_id,'interviews.write'));

drop policy if exists interview_attendees_write on public.interview_attendees;
create policy interview_attendees_insert on public.interview_attendees for insert to authenticated
  with check(public.has_permission(organization_id,'interviews.write'));
create policy interview_attendees_update on public.interview_attendees for update to authenticated
  using(public.has_permission(organization_id,'interviews.write'))
  with check(public.has_permission(organization_id,'interviews.write'));
create policy interview_attendees_delete on public.interview_attendees for delete to authenticated
  using(public.has_permission(organization_id,'interviews.write'));

drop policy if exists offers_write on public.offers;
create policy offers_insert on public.offers for insert to authenticated
  with check(public.has_permission(organization_id,'offers.write'));
create policy offers_update on public.offers for update to authenticated
  using(public.has_permission(organization_id,'offers.write'))
  with check(public.has_permission(organization_id,'offers.write'));
create policy offers_delete on public.offers for delete to authenticated
  using(public.has_permission(organization_id,'offers.write'));

commit;
