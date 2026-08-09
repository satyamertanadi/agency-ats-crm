begin;

-- schedule_maintenance_cron authenticated the cron's POST with an x-worker-secret header only, which
-- assumed CV_PARSE_WORKER_SECRET was configured for the production environment. It is not -- the
-- first production run of this step posted an empty secret, the function rejected it as invalid
-- (correctly), and the failing step took promote-production down with it.
--
-- scheduled-maintenance accepts either credential: x-worker-secret matching WORKER_SECRET, or a
-- bearer token matching SUPABASE_SERVICE_ROLE_KEY. Sending both headers means the schedule works
-- against whichever of the two a given project actually has configured, rather than depending on an
-- optional one. The service role key is always present in an Edge Function's environment, so the
-- bearer path is the one that cannot be misconfigured.
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
    'select %I.http_post(url := %L, headers := jsonb_build_object(''content-type'', ''application/json'', ''x-worker-secret'', %L, ''authorization'', %L), body := ''{}''::jsonb)',
    net_schema, trim(p_function_url), p_worker_secret, 'Bearer ' || p_worker_secret
  );

  perform cron.unschedule('scheduled-maintenance') where exists(select 1 from cron.job where jobname = 'scheduled-maintenance');
  perform cron.schedule('scheduled-maintenance', '17 * * * *', command);
  return 'scheduled';
end
$$;

revoke all on function public.schedule_maintenance_cron(text, text) from public;

commit;
