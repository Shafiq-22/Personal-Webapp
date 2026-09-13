-- Cortex core schema: identity, projects, tasks, reminders, habits.
--
-- Every user-owned table carries `user_id uuid not null references auth.users`
-- and is protected by an identical four-policy RLS block. Nothing in this
-- schema stores AI output produced off-device: summaries (later migration)
-- record which on-device engine produced them and are opt-in to sync at all.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type task_status as enum ('todo', 'in_progress', 'done', 'cancelled');
create type task_priority as enum ('p1', 'p2', 'p3', 'p4');
create type energy_level as enum ('low', 'medium', 'high');
create type record_origin as enum ('manual', 'nl_capture', 'calendar', 'obsidian', 'feed', 'clipper', 'ios', 'system');
create type reminder_kind as enum ('time', 'location', 'dependency', 'escalating');
create type geofence_trigger as enum ('enter', 'exit');
create type habit_cadence as enum ('daily', 'weekly', 'custom');

-- ---------------------------------------------------------------------------
-- Profiles + settings
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  time_zone text not null default 'UTC',
  week_starts_on smallint not null default 1 check (week_starts_on between 1 and 7),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  -- Mirrors PrivacySettings / NotificationSettings / SchedulingSettings in
  -- @cortex/core. Stored as jsonb so the client owns the schema and can evolve
  -- it without a migration; zod validates on read and write.
  privacy jsonb not null default '{}'::jsonb,
  notifications jsonb not null default '{}'::jsonb,
  scheduling jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects, tags
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  parent_id uuid references projects on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text,
  archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_not_own_parent check (id <> parent_id)
);
create index projects_user_idx on projects (user_id) where archived = false;
create index projects_parent_idx on projects (parent_id);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  project_id uuid references projects on delete set null,
  parent_task_id uuid references tasks on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  notes text,
  status task_status not null default 'todo',
  priority task_priority not null default 'p3',
  energy energy_level,
  due_at timestamptz,
  due_all_day boolean not null default false,
  start_at timestamptz,
  estimate_minutes integer check (estimate_minutes between 5 and 600),
  -- RFC 5545 subset, parsed by @cortex/core schedule/recurrence.ts
  recurrence_rule text,
  recurrence_anchor timestamptz,
  completed_at timestamptz,
  sort_order integer not null default 0,
  origin record_origin not null default 'manual',
  capture_text text,
  source_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_not_own_parent check (id <> parent_task_id),
  constraint task_done_has_timestamp check (status <> 'done' or completed_at is not null)
);
create index tasks_user_status_idx on tasks (user_id, status);
create index tasks_due_idx on tasks (user_id, due_at) where status in ('todo', 'in_progress');
create index tasks_project_idx on tasks (project_id);
create index tasks_parent_idx on tasks (parent_task_id);
create index tasks_title_trgm_idx on tasks using gin (title gin_trgm_ops);

create table task_tags (
  task_id uuid not null references tasks on delete cascade,
  tag_id uuid not null references tags on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (task_id, tag_id)
);
create index task_tags_tag_idx on task_tags (tag_id);

-- Explicit blocking relationships drive dependency reminders and the
-- "blocked" damping in the prioritiser.
create table task_dependencies (
  task_id uuid not null references tasks on delete cascade,
  depends_on_task_id uuid not null references tasks on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (task_id, depends_on_task_id),
  constraint no_self_dependency check (task_id <> depends_on_task_id)
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  task_id uuid not null references tasks on delete cascade,
  kind reminder_kind not null,
  label text,
  trigger_at timestamptz,
  offset_minutes integer check (offset_minutes between -20160 and 20160),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  radius_meters integer check (radius_meters between 50 and 50000),
  geofence_trigger geofence_trigger,
  depends_on_task_id uuid references tasks on delete cascade,
  escalation_steps jsonb not null default '[]'::jsonb,
  snoozed_until timestamptz,
  last_fired_at timestamptz,
  acknowledged_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  -- The same invariants the zod schema enforces client-side.
  constraint reminder_time_fields check (
    kind <> 'time' or trigger_at is not null or offset_minutes is not null
  ),
  constraint reminder_location_fields check (
    kind <> 'location' or (latitude is not null and longitude is not null and geofence_trigger is not null)
  ),
  constraint reminder_dependency_fields check (
    kind <> 'dependency' or depends_on_task_id is not null
  ),
  constraint reminder_escalation_fields check (
    kind <> 'escalating' or jsonb_array_length(escalation_steps) > 0
  )
);
create index reminders_task_idx on reminders (task_id);
create index reminders_due_idx on reminders (user_id, trigger_at) where enabled;

-- ---------------------------------------------------------------------------
-- Habits
-- ---------------------------------------------------------------------------
create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  cadence habit_cadence not null default 'daily',
  weekdays smallint[] not null default '{}',
  target_per_period smallint not null default 1 check (target_per_period between 1 and 30),
  block_minutes integer check (block_minutes between 5 and 480),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table habit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  habit_id uuid not null references habits on delete cascade,
  day date not null,
  count smallint not null default 1 check (count between 0 and 100),
  note text,
  created_at timestamptz not null default now(),
  unique (habit_id, day)
);
create index habit_entries_day_idx on habit_entries (user_id, day desc);

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

-- Keep `completed_at` honest no matter which client wrote the row.
create or replace function sync_task_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done' or new.completed_at is null) then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_completion before insert or update on tasks for each row execute function sync_task_completion();

-- Create the profile + settings rows the moment a user signs up.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
