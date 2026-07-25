-- Fix the salary_period divergence introduced by 20260721000000_candidate_salary_monthly.sql.
--
-- That migration flipped every EXISTING organization to salary_period='monthly' (the comment there
-- states plainly that every salary in this workspace has always in fact been monthly), but the
-- column's default -- set in 20260716120000_organization_salary_period.sql and never revisited --
-- stayed 'annual'. create_organization never sets salary_period explicitly, so every organization
-- created since 20260721 silently inherited the wrong convention. Because list_company_pipeline and
-- list_job_health multiply salary by 12 only when salary_period='monthly'
-- (20260721000000:71,73,113,115), any such organization has every expected/quoted fee computed at
-- exactly 1/12 of its real value -- the number a consultant reads and quotes a client with.
--
-- Verified against production and staging before writing this: production carries a single
-- organization, created before the 20260721 flip and already 'monthly' -- this migration is a no-op
-- there. Staging carries CI-generated test organizations; those created after 20260721 are exactly
-- the ones on 'annual' that this corrects, which is the live reproduction of the bug this fixes.
begin;

alter table public.organizations alter column salary_period set default 'monthly';

-- Scoped to the exact window the default was wrong (after the flip migration ran), not to every
-- 'annual' row -- an organization that was already 'annual' before 20260721 chose that on purpose
-- under the old (documented, if never-actually-true) default and is left alone.
update public.organizations
  set salary_period = 'monthly'
  where salary_period = 'annual' and created_at > timestamptz '2026-07-21 00:00:00+00';

-- Workspace settings previously exposed no way to change this once set, which is why the bad default
-- had no in-product remedy. Mirrors update_member_access: security definer, permission-gated,
-- authenticated only.
create or replace function public.update_organization_salary_period(p_organization_id uuid, p_salary_period text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_permission(p_organization_id,'organization.manage') then raise exception 'Access denied'; end if;
  if p_salary_period not in ('annual','monthly') then raise exception 'Invalid salary period' using errcode='22023'; end if;
  update public.organizations set salary_period=p_salary_period, updated_at=now() where id=p_organization_id;
end $$;
revoke all on function public.update_organization_salary_period(uuid,text) from public, anon;
grant execute on function public.update_organization_salary_period(uuid,text) to authenticated;

commit;
