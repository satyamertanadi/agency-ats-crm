begin;

-- Why the maintenance job has read "never completed a successful run" for sixteen days.
--
-- The schedule itself has been registered on every production promotion since 2026-08-09 (the
-- deploy step asserts on schedule_maintenance_cron returning 'scheduled', and it has). So the cron
-- exists and has fired ~380 times. Yet the heartbeat still says never_run, with no last_error.
--
-- That combination is only reachable if the POST never reaches the function's own bookkeeping. FIVE
-- distinct faults produce it, and every one of them looks identical in Admin:
--
--   1. pg_cron fires but pg_net cannot deliver (DNS, TLS, gateway 5xx) -- the failure is recorded in
--      net._http_response, a table nothing in this product has ever read.
--   2. The function rejects the call 401. index.ts deliberately skips the heartbeat write on 401 so
--      an anonymous caller cannot mark a healthy job failed -- correct, but it makes an auth
--      mismatch (a rotated service role key, a stale GitHub secret) the ONE failure that leaves
--      no trace anywhere the client can see.
--   3. pg_net's timeout_milliseconds defaults to 5000 and the command never passed one. A run with a
--      real backlog -- up to 100 CV parses plus up to 100 sequential candidate anonymisations, each
--      a storage round trip -- cannot finish in five seconds, so the request is aborted and the
--      isolate torn down before the heartbeat write at the end of runMaintenance().
--   4. The run dies partway for any other reason before reaching that final write.
--   5. The heartbeat UPDATE itself fails.
--
-- Cause 3 is self-perpetuating and fits the evidence best: the same backlog is re-picked every hour
-- and times out at the same point forever, which is exactly "never completed a successful run" with
-- an empty last_error. But guessing which one it is from here is the actual problem -- so rather
-- than patch the most likely and hope, this migration makes each layer record its own evidence at
-- the layer that owns it:
--
--   * the CRON records that it fired          (in-database, unforgeable, needs no authentication)
--   * pg_net records what the transport got   (already does -- we just start reading it)
--   * the FUNCTION records start and finish   (separately, so a death in between is visible)
--
-- The gap between "fired" and "started" then localises the fault without a production shell:
-- attempt recent + start null => delivery or auth; start recent + finish null => the run is dying
-- mid-flight; no attempt at all => the schedule is not running.

alter table public.maintenance_heartbeats
  -- Written by the cron wrapper immediately before the POST. This is the load-bearing column: it is
  -- the only evidence that does not depend on the request succeeding, or authenticating, or the
  -- function being reachable at all.
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_started_at timestamptz,
  add column if not exists last_finished_at timestamptz,
  -- pg_net hands back a request id synchronously and fills the response in asynchronously. Storing
  -- the id lets the diagnostics view below join to net._http_response at read time, so the transport
  -- outcome is retrievable without a second cron job to reconcile it.
  add column if not exists last_request_id bigint,
  add column if not exists consecutive_failures integer not null default 0;

-- 'running' is new: a run that started and never finished must not read as either healthy or as
-- never having run. It is the state cause 3 and 4 leave behind.
alter table public.maintenance_heartbeats drop constraint if exists maintenance_heartbeats_last_status_check;
alter table public.maintenance_heartbeats
  add constraint maintenance_heartbeats_last_status_check
  check (last_status in ('never_run','running','succeeded','failed'));

commit;

begin;

-- The cron now calls this instead of net.http_post directly, so that firing is recorded in the
-- database BEFORE the request leaves. Previously the cron's only effect was an HTTP POST, which
-- meant a schedule that fired into a black hole was indistinguishable from a schedule that never
-- fired -- the single biggest reason this has been undiagnosable.
--
-- SECURITY DEFINER and owned by postgres: it writes to a default-deny table and holds no secret of
-- its own (the secret is baked into the scheduled command by schedule_maintenance_cron, which is
-- itself trusted-setup only). Revoked from every client role below -- see 20260814120000 for why
-- `from public` alone is not enough.
create or replace function public.run_scheduled_maintenance(p_function_url text, p_worker_secret text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  net_schema text;
  request_id bigint;
begin
  select n.nspname into net_schema
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'http_post' limit 1;
  if net_schema is null then
    update public.maintenance_heartbeats
      set last_attempt_at = now(), last_status = 'failed',
          last_error = 'pg_net http_post not found; the maintenance request was never sent.',
          consecutive_failures = consecutive_failures + 1
      where job_key = 'scheduled-maintenance';
    return null;
  end if;

  -- Recorded before the POST, and deliberately not conditional on it: this row is what proves the
  -- scheduler is alive even when nothing downstream of it is.
  update public.maintenance_heartbeats
    set last_attempt_at = now()
    where job_key = 'scheduled-maintenance';

  -- timeout_milliseconds is the fix for cause 3. pg_net defaults to 5000ms and the previous command
  -- accepted that default silently; a maintenance run carrying a real backlog cannot complete in
  -- five seconds, so every run was being severed mid-flight. 90s is comfortably above a full batch
  -- and still well under the hourly interval, so a wedged run cannot overlap its successor.
  execute format(
    'select %I.http_post(url := %L, headers := jsonb_build_object(''content-type'',''application/json'',''x-worker-secret'',%L,''authorization'',%L), body := ''{}''::jsonb, timeout_milliseconds := 90000)',
    net_schema, trim(p_function_url), p_worker_secret, 'Bearer ' || p_worker_secret
  ) into request_id;

  update public.maintenance_heartbeats
    set last_request_id = request_id
    where job_key = 'scheduled-maintenance';
  return request_id;
end
$$;

revoke all on function public.run_scheduled_maintenance(text, text) from anon, authenticated, public;

-- Re-registers the cron against the wrapper above. Same signature, same idempotence, same
-- trusted-setup-only reachability as before -- the deploy step calling it needs no change.
create or replace function public.schedule_maintenance_cron(p_function_url text, p_worker_secret text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
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

  command := format(
    'select public.run_scheduled_maintenance(%L, %L)',
    trim(p_function_url), p_worker_secret
  );

  perform cron.unschedule('scheduled-maintenance') where exists(select 1 from cron.job where jobname = 'scheduled-maintenance');
  perform cron.schedule('scheduled-maintenance', '17 * * * *', command);
  return 'scheduled';
end
$$;

revoke all on function public.schedule_maintenance_cron(text, text) from anon, authenticated, public;

commit;

begin;

-- Health, now reporting which LAYER is unhealthy rather than only that something is.
-- is_stale keeps exactly its previous definition (no successful run, or none inside the window) so
-- the Admin warning cannot be cleared by this change -- only by a genuine successful run.
create or replace function public.get_maintenance_health(p_organization_id uuid)
returns table(
  job_key text,
  last_successful_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  stale_after_hours integer,
  is_stale boolean,
  last_attempt_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  consecutive_failures integer,
  -- Which layer to go and look at. Derived here rather than in the client so the operator runbook
  -- and the Admin banner cannot drift apart on what a given combination of timestamps means.
  fault_stage text
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
    h.last_successful_run_at is null
      or h.last_successful_run_at < now() - make_interval(hours => h.stale_after_hours),
    h.last_attempt_at,
    h.last_started_at,
    h.last_finished_at,
    h.consecutive_failures,
    case
      when h.last_successful_run_at is not null
       and h.last_successful_run_at >= now() - make_interval(hours => h.stale_after_hours)
        then 'healthy'
      -- Nothing has fired at all: the schedule is missing or pg_cron is not running.
      when h.last_attempt_at is null then 'scheduler'
      -- The cron fired but the function never began: the request is not arriving. In practice a
      -- rejected credential or a transport failure -- get_maintenance_diagnostics separates those.
      when h.last_started_at is null or h.last_started_at < h.last_attempt_at then 'delivery'
      -- The run began and never recorded a finish: it is dying mid-flight (timeout, crash).
      when h.last_finished_at is null or h.last_finished_at < h.last_started_at then 'execution'
      -- It ran to completion and reported failure; last_error carries the reason.
      else 'run_failed'
    end
  from public.maintenance_heartbeats h
  where public.has_permission(p_organization_id, 'organization.manage')
  order by h.job_key
$$;

revoke all on function public.get_maintenance_health(uuid) from anon, public;
grant execute on function public.get_maintenance_health(uuid) to authenticated;

-- Operator-facing detail behind the same organization.manage check as the banner. This is what
-- turns "delivery" into an actual cause: whether a cron row exists at all, when pg_cron last ran it
-- and whether that run errored, and what HTTP status pg_net actually received.
--
-- Everything here is instance operational state, never tenant data. The pg_net response BODY is
-- deliberately not exposed -- it can echo request headers, and those carry the worker secret.
create or replace function public.get_maintenance_diagnostics(p_organization_id uuid)
returns table(
  cron_registered boolean,
  cron_schedule text,
  cron_last_run_at timestamptz,
  cron_last_status text,
  cron_last_error text,
  transport_status_code integer,
  transport_error text,
  transport_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  req_id bigint;
begin
  if not public.has_permission(p_organization_id, 'organization.manage') then
    return;
  end if;
  select h.last_request_id into req_id from public.maintenance_heartbeats h where h.job_key = 'scheduled-maintenance';

  return query
  with job as (
    -- On a project where pg_cron or pg_net was never installed these relations do not exist at all.
    -- The exception handler at the bottom is what makes that safe: a missing-relation error here
    -- would otherwise take out the Admin page rather than reporting the very condition the page
    -- exists to report. Handled there rather than with a to_regclass pre-check so that a catalog
    -- the owner cannot read (insufficient_privilege) lands in the same place as one that is absent.
    select j.jobid, j.schedule
    from cron.job j where j.jobname = 'scheduled-maintenance'
    limit 1
  ), run as (
    select d.start_time, d.status, d.return_message
    from cron.job_run_details d
    join job on job.jobid = d.jobid
    order by d.start_time desc limit 1
  ), resp as (
    select r.status_code, r.error_msg, r.created
    from net._http_response r where req_id is not null and r.id = req_id limit 1
  )
  select
    exists(select 1 from job),
    (select schedule from job),
    (select start_time from run),
    (select status from run),
    (select left(return_message, 500) from run),
    (select status_code from resp),
    (select left(error_msg, 500) from resp),
    (select created from resp);
exception when undefined_table or invalid_schema_name or insufficient_privilege then
  -- pg_cron / pg_net not installed, or their catalogs not readable by this owner. Report the
  -- absence rather than failing the caller.
  return query select false, null::text, null::timestamptz, null::text,
    'pg_cron or pg_net catalogs are not available in this project.'::text,
    null::integer, null::text, null::timestamptz;
end
$$;

revoke all on function public.get_maintenance_diagnostics(uuid) from anon, public;
grant execute on function public.get_maintenance_diagnostics(uuid) to authenticated;

commit;
