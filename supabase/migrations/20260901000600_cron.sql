-- Scheduled jobs.
--
-- pg_cron calls the edge functions over HTTP. It cannot hold the service role
-- key - nothing outside the platform should - so instead it presents a random
-- token from `cron_tokens`, and the edge function (which does hold the service
-- role key, injected by Supabase) verifies it. The token never leaves the
-- project, and rotating it is a single UPDATE.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Scheduler credentials
-- ---------------------------------------------------------------------------
create table if not exists cron_tokens (
  name text primary key,
  token text not null,
  functions_url text not null,
  rotated_at timestamptz not null default now()
);

-- No policies, no grants: readable only by the service role and the
-- security-definer function below.
alter table cron_tokens enable row level security;
revoke all on cron_tokens from anon, authenticated;

create or replace function invoke_edge_function(fn text, query text default '')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  credentials cron_tokens%rowtype;
begin
  select * into credentials from cron_tokens where name = 'scheduler';

  if not found then
    raise warning 'skipping %: no scheduler token is configured', fn;
    return null;
  end if;

  return net.http_post(
    url := credentials.functions_url || '/' || fn || query,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cortex-cron', credentials.token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function invoke_edge_function(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
-- Poll due sources every hour; each source has its own interval, so this only
-- fetches the ones that are actually ready.
select cron.schedule('cortex-monitor-fetch', '7 * * * *', $$select invoke_edge_function('monitor-fetch', '?limit=100')$$);

-- Build digests hourly; the function decides whose local delivery hour it is.
select cron.schedule('cortex-digest-build', '0 * * * *', $$select invoke_edge_function('digest-build')$$);

-- Calendar sync every 15 minutes. Harmless while no calendar is connected.
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
