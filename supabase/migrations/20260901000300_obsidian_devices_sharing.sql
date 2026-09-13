-- Obsidian vault mapping, devices, saved views and read-only shares.

create type vault_transport as enum (
  'icloud_drive', 'obsidian_sync', 'webdav', 'remotely_save', 'livesync',
  'google_drive', 'local_rest_api', 'manual_export'
);
create type obsidian_entity_type as enum ('task', 'item', 'digest', 'event', 'project', 'daily_note');
create type sync_direction as enum ('push', 'pull', 'two_way');
create type device_platform as enum ('ios', 'ipados', 'macos', 'web');
create type afm_availability as enum (
  'available', 'device_not_eligible', 'model_not_ready',
  'apple_intelligence_disabled', 'unsupported_os', 'unknown'
);
create type share_resource_type as enum ('project', 'saved_view', 'library_tag', 'digest');
create type saved_view_surface as enum ('tasks', 'feed', 'library', 'calendar');

create table vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Vault',
  transport vault_transport not null default 'icloud_drive',
  folders jsonb not null default '{}'::jsonb,
  direction sync_direction not null default 'two_way',
  -- Reading the vault for topic discovery is opt-in and revocable.
  allow_topic_scan boolean not null default false,
  scan_folders text[] not null default '{}',
  -- When on, note bodies Cortex caches server-side are encrypted client-side.
  encryption_enabled boolean not null default false,
  -- A key *reference* (public key or wrapped-key id). Never a passphrase.
  encryption_key_ref text,
  rest_api_base_url text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- The mapping that makes three-way sync possible: base_hash is the content
-- both sides last agreed on, so an edit in Obsidian is distinguishable from an
-- edit in Cortex without trusting file timestamps.
create table obsidian_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  vault_id uuid not null references vaults on delete cascade,
  entity_type obsidian_entity_type not null,
  entity_id text not null,
  vault_path text not null,
  base_hash text,
  local_hash text,
  remote_hash text,
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  conflict boolean not null default false,
  deleted_in_vault boolean not null default false,
  unique (vault_id, entity_type, entity_id),
  unique (vault_id, vault_path)
);
create index obsidian_files_conflict_idx on obsidian_files (user_id) where conflict;

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'iPhone',
  platform device_platform not null default 'ios',
  push_token text,
  -- Mirrors SystemLanguageModel.availability from the companion app, so the
  -- web app can tell the user *why* on-device AI features are unavailable.
  afm_availability afm_availability not null default 'unknown',
  app_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

create table saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  surface saved_view_surface not null,
  filter jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- Read-only snapshots addressable by an unguessable token. Anonymous readers
-- reach them through a security-definer RPC, never by selecting the table.
create table shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  token text not null unique check (char_length(token) between 16 and 64),
  resource_type share_resource_type not null,
  resource_id text not null,
  title text,
  include_notes boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index shares_token_idx on shares (token) where revoked_at is null;

-- Append-only record of every AI decision surfaced to the user, so
-- "explain this" works even after the underlying data moved on.
create table ai_explanations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_type text not null,
  subject_id text not null,
  decision text not null,
  rationale text not null,
  engine ai_engine not null,
  model_identifier text,
  device_id uuid references devices on delete set null,
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_explanations_subject_idx on ai_explanations (user_id, subject_type, subject_id);
