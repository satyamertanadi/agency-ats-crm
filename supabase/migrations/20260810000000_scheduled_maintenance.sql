begin;

-- Retention, PII anonymization, expired-CV-draft deletion and rate-limiter reaping used to be
-- driven by an hourly GitHub Actions cron (.github/workflows/cv-parse-cleanup.yml) POSTing
-- {"action":"cleanup"} at the parse-candidate-cv function. GitHub silently disables scheduled
-- workflows after 60 days without a repository commit, so the client's data-deletion guarantee
-- would stop with no alarm anywhere the client can see. Two changes fix that: the schedule now
-- lives in the client's own Supabase project (pg_cron, below), and a heartbeat row makes a stalled
-- job visible inside Admin rather than only in a CI tab nobody opens.

create table public.maintenance_heartbeats (
  job_key text primary key,
  last_successful_run_at timestamptz,
  last_run_at timestamptz,
  last_status text not null default 'never_run' check (last_status in ('never_run','succeeded','failed')),
  last_detail jsonb not null default '{}'::jsonb,
  last_error text,
  -- How long the job may go without a successful run before Admin calls it stale. The worker runs
  -- hourly; three hours tolerates two consecutive misses before raising an alarm.
  stale_after_hours integer not null default 3 check (stale_after_hours between 1 and 168),
  updated_at timestamptz not null default now()
);

create trigger maintenance_heartbeats_touch before update on public.maintenance_heartbeats
for each row execute function public.touch_updated_at();

insert into public.maintenance_heartbeats(job_key) values('scheduled-maintenance')
on conflict (job_key) do nothing;

-- This is instance-level operational state, not tenant data, so it carries no organization_id and
-- therefore no org-scoped policy can be written for it. RLS is enabled with no policies at all:
-- only service_role (the maintenance worker, which bypasses RLS) can touch the table directly.
-- Admins read it through get_maintenance_health() below, which applies a real permission check.
alter table public.maintenance_heartbeats enable row level security;

create or replace function public.get_maintenance_health(p_organization_id uuid)
returns table(
  job_key text,
  last_successful_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  stale_after_hours integer,
  is_stale boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.job_key,
    h.last_successful_run_at,
    h.last_run_at,
    h.last_status,
    h.last_error,
    h.stale_after_hours,
    -- A job that has never run is stale too: "no successful run on record" is exactly the state a
    -- silently-disabled schedule leaves behind, and it must not read as healthy.
    h.last_successful_run_at is null
      or h.last_successful_run_at < now() - make_interval(hours => h.stale_after_hours)
  from public.maintenance_heartbeats h
  where public.has_permission(p_organization_id, 'organization.manage')
  order by h.job_key
$$;

revoke all on function public.get_maintenance_health(uuid) from public;
grant execute on function public.get_maintenance_health(uuid) to authenticated;

-- Registers (or re-registers) the hourly maintenance run inside this Supabase project. The function
-- URL and worker secret are deployment facts, not schema facts, so they are passed in at deploy
-- time rather than baked into a migration and committed to git -- see the "Schedule in-project
-- maintenance cron" step in .github/workflows/deploy.yml, which calls this after every db push.
-- Idempotent: re-running it replaces the existing schedule rather than stacking duplicates.
create or replace function public.schedule_maintenance_cron(p_function_url text, p_worker_secret text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  net_schema text;
  command text;
begin
  if p_function_url is null or length(trim(p_function_url)) = 0 then
    raise exception 'A maintenance function URL is required.' using errcode = '22023';
  end if;
  if p_worker_secret is null or length(trim(p_worker_secret)) = 0 then
    raise exception 'A maintenance worker secret is required.' using errcode = '22023';
  end if;

  begin
    create extension if not exists pg_cron;
  exception when others then
    return 'pg_cron unavailable: ' || sqlerrm;
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    return 'pg_net unavailable: ' || sqlerrm;
  end;

  -- pg_net lands in different schemas depending on how the extension was provisioned (net on
  -- Supabase-managed projects, extensions on some self-hosted setups). Resolve it rather than
  -- assuming, so this works against whichever project a client is running on.
  select n.nspname into net_schema
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'http_post'
  limit 1;
  if net_schema is null then
    return 'pg_net http_post not found';
  end if;

  command := format(
    'select %I.http_post(url := %L, headers := jsonb_build_object(''content-type'', ''application/json'', ''x-worker-secret'', %L), body := ''{}''::jsonb)',
    net_schema, trim(p_function_url), p_worker_secret
  );

  perform cron.unschedule('scheduled-maintenance') where exists(select 1 from cron.job where jobname = 'scheduled-maintenance');
  perform cron.schedule('scheduled-maintenance', '17 * * * *', command);
  return 'scheduled';
end
$$;

-- Deployment-time only, and it takes a secret as an argument: never reachable from a browser
-- session. The deploy workflow calls it with the service role key.
revoke all on function public.schedule_maintenance_cron(text, text) from public;

commit;
