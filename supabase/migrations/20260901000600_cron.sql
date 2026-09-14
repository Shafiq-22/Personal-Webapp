-- Scheduled jobs.
--
-- pg_cron calls the edge functions over HTTP with the service role key, which
-- is read from Vault rather than being written into the schedule definition.
-- Apply this migration only after `supabase secrets set` has stored the two
-- settings below; otherwise the schedules are created but the calls fail.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Helper so the schedules stay readable and the key appears in exactly one place.
create or replace function invoke_edge_function(fn text, query text default '')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  service_key text := current_setting('app.settings.service_role_key', true);
begin
  if base_url is null or service_key is null then
    raise warning 'skipping %: app.settings.functions_url / service_role_key are not configured', fn;
    return null;
  end if;

  return net.http_post(
    url := base_url || '/' || fn || query,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function invoke_edge_function(text, text) from public, anon, authenticated;

-- Poll due sources every hour; each source has its own interval, so this only
-- fetches the ones that are actually ready.
select cron.schedule('cortex-monitor-fetch', '7 * * * *', $$select invoke_edge_function('monitor-fetch', '?limit=100')$$);

-- Build digests hourly; the function decides whose local delivery hour it is.
select cron.schedule('cortex-digest-build', '0 * * * *', $$select invoke_edge_function('digest-build')$$);

-- Calendar sync every 15 minutes.
select cron.schedule('cortex-calendar-sync', '*/15 * * * *', $$select invoke_edge_function('google-calendar-sync')$$);

-- Retire auto-discovered topics whose originating work disappeared, and expire
-- snoozed items back into the feed.
select cron.schedule('cortex-housekeeping', '30 3 * * *', $$
  update topics
     set active = false
   where origin <> 'manual'
     and active
     and last_seen_at is not null
     and last_seen_at < now() - interval '45 days';

  update item_states
     set state = 'new', snoozed_until = null
   where state = 'snoozed'
     and snoozed_until is not null
     and snoozed_until <= now();
$$);
