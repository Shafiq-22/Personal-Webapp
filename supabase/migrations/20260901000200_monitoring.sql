-- Internet monitoring: sources, topics, items, relevance and digests.

create type source_kind as enum (
  'rss', 'atom', 'arxiv', 'pubmed', 'biorxiv', 'scholar_alert', 'news', 'blog',
  'forum', 'regulatory', 'patents', 'company_news', 'x_list', 'github_releases',
  'web_page', 'json_api'
);
create type source_status as enum ('ok', 'error', 'never');
create type topic_origin as enum ('manual', 'task', 'calendar', 'obsidian', 'item_feedback');
create type item_kind as enum ('paper', 'preprint', 'article', 'post', 'release', 'patent', 'regulation', 'announcement', 'thread', 'other');
create type item_state as enum ('new', 'read', 'saved', 'dismissed', 'snoozed');
create type summary_style as enum ('tldr', 'key_points', 'implications', 'eli5', 'methodology', 'actions');
create type digest_period as enum ('daily', 'weekly', 'realtime');

create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind source_kind not null,
  name text not null,
  url text not null,
  -- Adapter-specific configuration (arXiv categories, CSS selectors, queries).
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  weight real not null default 1 check (weight between 0.1 and 2),
  fetch_interval_minutes integer not null default 180 check (fetch_interval_minutes between 15 and 10080),
  last_fetched_at timestamptz,
  last_status source_status not null default 'never',
  last_error text,
  etag text,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
-- The scheduler's hot query: which sources are due for a fetch?
create index sources_due_idx on sources (last_fetched_at nulls first) where enabled;

create table topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  origin topic_origin not null default 'manual',
  -- Ids of the tasks / events / note paths an automatic topic came from.
  derived_from text[] not null default '{}',
  weight real not null default 1 check (weight between 0 and 2),
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);
create index topics_active_idx on topics (user_id) where active;

-- Proposed topics awaiting the user's yes/no. Auto-discovery never activates
-- a topic silently; the evidence is kept so the UI can justify the proposal.
create table topic_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  label text not null,
  keywords text[] not null default '{}',
  origin topic_origin not null,
  derived_from text[] not null default '{}',
  evidence text[] not null default '{}',
  weight real not null default 0,
  decided_at timestamptz,
  accepted boolean,
  created_at timestamptz not null default now(),
  unique (user_id, label)
);

create table info_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source_id uuid references sources on delete set null,
  kind item_kind not null default 'article',
  external_id text,
  url text not null,
  canonical_url text,
  title text not null,
  authors text[] not null default '{}',
  summary_raw text,
  -- Null when the user turned off full-content storage in privacy settings.
  content_text text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  doi text,
  arxiv_id text,
  venue text,
  patent_number text,
  language text not null default 'en',
  content_hash text not null,
  origin record_origin not null default 'feed',
  raw jsonb not null default '{}'::jsonb,
  -- One row per user per distinct piece of content.
  unique (user_id, content_hash)
);
create index info_items_recent_idx on info_items (user_id, coalesce(published_at, fetched_at) desc);
create index info_items_source_idx on info_items (source_id);
create index info_items_title_trgm_idx on info_items using gin (title gin_trgm_ops);

create table item_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references info_items on delete cascade,
  topic_id uuid references topics on delete cascade,
  score real not null check (score between 0 and 1),
  -- Component signals, kept so the UI can explain the number.
  signals jsonb not null default '{}'::jsonb,
  matched_terms text[] not null default '{}',
  engine ai_engine not null default 'heuristic',
  explanation text,
  created_at timestamptz not null default now(),
  unique (item_id, topic_id)
);
create index item_scores_rank_idx on item_scores (user_id, score desc);

create table item_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references info_items on delete cascade,
  state item_state not null default 'new',
  notes text,
  tags text[] not null default '{}',
  rating smallint check (rating between 1 and 5),
  snoozed_until timestamptz,
  read_at timestamptz,
  saved_at timestamptz,
  created_task_id uuid references tasks on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);
create index item_states_library_idx on item_states (user_id, state) where state = 'saved';

-- Summaries are produced on the user's iPhone by Apple Foundation Models and
-- uploaded only when `privacy.syncAiSummaries` is on. `engine` records the
-- producer so the UI never presents an extractive fallback as a written
-- summary, and `device_id` shows which device did the work.
create table item_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references info_items on delete cascade,
  style summary_style not null,
  text text not null,
  engine ai_engine not null default 'afm',
  model_identifier text,
  device_id uuid,
  created_at timestamptz not null default now(),
  unique (item_id, style, engine)
);

create table digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  period digest_period not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  entries jsonb not null default '[]'::jsonb,
  item_count integer not null default 0,
  headline text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, period, window_start)
);
create index digests_recent_idx on digests (user_id, window_start desc);

create trigger topics_updated_at before update on topics for each row execute function set_updated_at();
create trigger item_states_updated_at before update on item_states for each row execute function set_updated_at();

-- Link a task back to the item it came from (declared in the core migration
-- without the constraint, because info_items did not exist yet).
alter table tasks
  add constraint tasks_source_item_fk
  foreign key (source_item_id) references info_items (id) on delete set null;
