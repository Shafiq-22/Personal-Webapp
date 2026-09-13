-- Google Calendar mirror + time blocking.
--
-- OAuth refresh tokens live in `calendar_accounts.encrypted_tokens` and are
-- never selectable by the browser: the table's RLS grants the owner every
-- operation *except* reading that column, which is stripped by the
-- `calendar_accounts_public` view the app actually queries. Only edge
-- functions running with the service role touch the raw column.

create type calendar_provider as enum ('google', 'ics', 'local');
create type event_transparency as enum ('opaque', 'transparent');
create type event_status as enum ('confirmed', 'tentative', 'cancelled');
create type calendar_access_role as enum ('owner', 'writer', 'reader', 'freeBusyReader');
create type time_block_kind as enum ('task', 'focus', 'habit', 'review', 'buffer');
create type time_block_status as enum ('proposed', 'approved', 'rejected', 'completed');
create type ai_engine as enum ('afm', 'heuristic', 'none');

create table calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider calendar_provider not null default 'google',
  account_email text not null,
  scopes text[] not null default '{}',
  -- pgsodium/Vault-encrypted payload holding access + refresh tokens.
  encrypted_tokens text,
  token_expires_at timestamptz,
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  unique (user_id, provider, account_email)
);

-- What the web client is allowed to see about a connected account.
create view calendar_accounts_public
with (security_invoker = true) as
select id, user_id, provider, account_email, scopes, sync_enabled, last_synced_at, last_sync_error, created_at
from calendar_accounts;

create table calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references calendar_accounts on delete cascade,
  external_id text not null,
  name text not null,
  description text,
  time_zone text not null default 'UTC',
  color text,
  selected boolean not null default true,
  is_primary_target boolean not null default false,
  access_role calendar_access_role not null default 'owner',
  sync_token text,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index calendars_user_idx on calendars (user_id) where selected;

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  calendar_id uuid not null references calendars on delete cascade,
  external_id text,
  title text not null default '(no title)',
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  transparency event_transparency not null default 'opaque',
  status event_status not null default 'confirmed',
  organizer_email text,
  attendee_count integer not null default 0,
  recurring_event_id text,
  html_link text,
  etag text,
  created_by_cortex boolean not null default false,
  linked_task_id uuid references tasks on delete set null,
  origin record_origin not null default 'calendar',
  updated_at timestamptz not null default now(),
  unique (calendar_id, external_id),
  constraint event_ends_after_start check (end_at >= start_at)
);
-- The merged-timeline query: everything for a user in a date window.
create index calendar_events_window_idx on calendar_events (user_id, start_at, end_at)
  where status <> 'cancelled';
create index calendar_events_task_idx on calendar_events (linked_task_id);

create table time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  task_id uuid references tasks on delete cascade,
  habit_id uuid references habits on delete cascade,
  event_id uuid references calendar_events on delete set null,
  title text not null,
  kind time_block_kind not null default 'task',
  status time_block_status not null default 'proposed',
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- Shown verbatim in the UI. Populated by the heuristic planner on the server
  -- or by Apple Foundation Models on device; `engine` says which.
  rationale text,
  engine ai_engine not null default 'heuristic',
  created_at timestamptz not null default now(),
  constraint block_ends_after_start check (end_at > start_at)
);
create index time_blocks_window_idx on time_blocks (user_id, start_at);
create index time_blocks_status_idx on time_blocks (user_id, status) where status = 'proposed';

create trigger calendar_events_updated_at before update on calendar_events for each row execute function set_updated_at();
