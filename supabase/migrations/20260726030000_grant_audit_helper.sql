-- Introspection helper for tests/rls/rpc-acl.test.ts (the N3 grant-audit test: see the audit finding
-- on 20260717070000_reharden_resolve_submission_link.sql / 20260726010000 for why this exists --
-- create or replace function silently reinstates whatever grant line follows it, and this repo has
-- shipped that exact regression three times with no automated guard).
--
-- PostgREST only exposes objects in the public schema, so pg_proc/pg_roles/aclexplode cannot be
-- queried directly via the client -- this wraps the introspection in a callable function. It returns
-- schema metadata only (which function names are directly EXECUTE-able by anon/authenticated/PUBLIC),
-- not row data, so authenticated is an appropriate audience: the same trust level already granted to
-- the full permission catalog by permissions_authenticated_read.
--
-- Trigger functions are excluded (prorettype <> 'trigger') because Postgres refuses to invoke them
-- outside a trigger context regardless of their EXECUTE grant -- an ACL entry on one is inert, and
-- including them would make this test flag things that are not actually callable.
--
-- PUBLIC grants are the case this test exists to catch: aclexplode represents a PUBLIC grant with
-- grantee=0, which has no matching pg_roles row, so a naive join would silently drop it. Every
-- function created without an explicit `revoke ... from public` carries this grant by Postgres's own
-- default (EXECUTE to PUBLIC on function creation) -- coalescing a NULL proacl to acldefault('f', ..)
-- surfaces that default explicitly instead of missing it.
create or replace function public.audit_function_grants()
returns table(function_name text, granted_roles text[])
language sql stable security definer set search_path=public as $$
  select p.proname::text,
    array_agg(distinct case when a.grantee=0 then 'public' else r.rolname end
      order by case when a.grantee=0 then 'public' else r.rolname end)
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles r on r.oid=a.grantee
  where a.privilege_type='EXECUTE'
    and (a.grantee=0 or r.rolname in ('anon','authenticated'))
    and p.prorettype <> 'trigger'::regtype
  group by p.proname
  order by p.proname
$$;
revoke all on function public.audit_function_grants() from public, anon;
grant execute on function public.audit_function_grants() to authenticated;
