-- Server-side helpers the web app and edge functions rely on.

-- ---------------------------------------------------------------------------
-- Merged timeline
-- ---------------------------------------------------------------------------
-- Tasks with a due date, calendar events and time blocks in one ordered
-- stream. Doing the union in Postgres keeps the calendar page to a single
-- round trip and lets the planner reuse the same shape.
create or replace function merged_timeline(p_from timestamptz, p_to timestamptz)
returns table (
  kind text,
  id uuid,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean,
  status text,
  meta jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    'event'::text,
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    e.all_day,
    e.status::text,
    jsonb_build_object(
      'calendar_id', e.calendar_id,
      'location', e.location,
      'attendees', e.attendee_count,
      'transparency', e.transparency,
      'created_by_cortex', e.created_by_cortex,
      'linked_task_id', e.linked_task_id
    )
  from calendar_events e
  where e.user_id = (select auth.uid())
    and e.status <> 'cancelled'
    and e.start_at < p_to
    and e.end_at > p_from

  union all

  select
    'task'::text,
    t.id,
    t.title,
    coalesce(t.start_at, t.due_at),
    t.due_at,
    t.due_all_day,
    t.status::text,
    jsonb_build_object('priority', t.priority, 'project_id', t.project_id, 'estimate_minutes', t.estimate_minutes)
  from tasks t
  where t.user_id = (select auth.uid())
    and t.due_at is not null
    and t.due_at >= p_from
    and t.due_at <= p_to

  union all

  select
    'block'::text,
    b.id,
    b.title,
    b.start_at,
    b.end_at,
    false,
    b.status::text,
    jsonb_build_object('block_kind', b.kind, 'task_id', b.task_id, 'habit_id', b.habit_id, 'rationale', b.rationale, 'engine', b.engine)
  from time_blocks b
  where b.user_id = (select auth.uid())
    and b.status in ('proposed', 'approved')
    and b.start_at < p_to
    and b.end_at > p_from

  order by 4 nulls last;
$$;

-- ---------------------------------------------------------------------------
-- Monitoring helpers
-- ---------------------------------------------------------------------------
-- Which sources the fetcher should poll next. Service-role only: the edge
-- function runs across all users, so this deliberately ignores auth.uid().
create or replace function sources_due(p_limit integer default 50)
returns setof sources
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from sources
  where enabled
    and (
      last_fetched_at is null
      or last_fetched_at < now() - make_interval(mins => fetch_interval_minutes)
    )
  order by last_fetched_at nulls first
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function sources_due(integer) from public, anon, authenticated;
grant execute on function sources_due(integer) to service_role;

-- Bulk ingest. Items already seen (same user + content hash) are skipped
-- rather than updated, so a feed that re-publishes an entry cannot resurrect
-- something the user already dismissed.
create or replace function upsert_info_items(p_user_id uuid, p_items jsonb)
returns table (item_id uuid, item_hash text, was_inserted boolean)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with incoming as (
    select
      (item ->> 'sourceId')::uuid            as source_id,
      coalesce(item ->> 'kind', 'article')::item_kind as kind,
      item ->> 'externalId'                  as external_id,
      item ->> 'url'                         as url,
      item ->> 'canonicalUrl'                as canonical_url,
      item ->> 'title'                       as title,
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(item -> 'authors', '[]'::jsonb)) value),
        '{}'::text[]
      )                                      as authors,
      item ->> 'summaryRaw'                  as summary_raw,
      item ->> 'contentText'                 as content_text,
      (item ->> 'publishedAt')::timestamptz  as published_at,
      coalesce((item ->> 'fetchedAt')::timestamptz, now()) as fetched_at,
      item ->> 'doi'                         as doi,
      item ->> 'arxivId'                     as arxiv_id,
      item ->> 'venue'                       as venue,
      item ->> 'patentNumber'                as patent_number,
      coalesce(item ->> 'language', 'en')    as language,
      item ->> 'contentHash'                 as content_hash,
      coalesce(item -> 'raw', '{}'::jsonb)   as raw
    from jsonb_array_elements(p_items) as item
    where item ->> 'title' is not null and item ->> 'url' is not null and item ->> 'contentHash' is not null
  ),
  written as (
    insert into info_items (
      user_id, source_id, kind, external_id, url, canonical_url, title, authors,
      summary_raw, content_text, published_at, fetched_at, doi, arxiv_id, venue,
      patent_number, language, content_hash, origin, raw
    )
    select
      p_user_id, i.source_id, i.kind, i.external_id, i.url, i.canonical_url, i.title, i.authors,
      i.summary_raw, i.content_text, i.published_at, i.fetched_at, i.doi, i.arxiv_id, i.venue,
      i.patent_number, i.language, i.content_hash, 'feed', i.raw
    from incoming i
    on conflict (user_id, content_hash) do nothing
    returning info_items.id, info_items.content_hash
  )
  select w.id, w.content_hash, true from written w
  union all
  select distinct e.id, e.content_hash, false
  from info_items e
  join incoming i on i.content_hash = e.content_hash
  where e.user_id = p_user_id
    and not exists (select 1 from written w where w.content_hash = e.content_hash);
end;
$$;

-- Per-topic save/dismiss counts, used to learn the feedback signal that nudges
-- relevance ranking. Aggregated in SQL so the client never has to page through
-- the whole library to compute it.
create or replace function topic_feedback()
returns table (topic_id uuid, saved integer, dismissed integer, read_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.topic_id,
    count(*) filter (where st.state = 'saved')::integer,
    count(*) filter (where st.state = 'dismissed')::integer,
    count(*) filter (where st.state = 'read')::integer
  from item_states st
  join item_scores s on s.item_id = st.item_id and s.user_id = st.user_id
  where st.user_id = (select auth.uid()) and s.topic_id is not null
  group by s.topic_id;
$$;

-- ---------------------------------------------------------------------------
-- Analytics helper
-- ---------------------------------------------------------------------------
create or replace function task_completion_series(p_days integer default 30)
returns table (day date, created integer, completed integer)
language sql
stable
security invoker
set search_path = public
as $$
  with days as (
    select generate_series(
      (current_date - (greatest(1, least(p_days, 365)) - 1) * interval '1 day')::date,
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    (select count(*) from tasks t where t.user_id = (select auth.uid()) and t.created_at::date = d.day)::integer,
    (select count(*) from tasks t where t.user_id = (select auth.uid()) and t.completed_at::date = d.day)::integer
  from days d
  order by d.day;
$$;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Cross-device sync of non-AI data. AI artefacts (item_summaries) are
-- deliberately not published: they only ever travel when the user opted in,
-- and then via an explicit request rather than a broadcast.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table tasks, projects, time_blocks, item_states, reminders, habit_entries;
  end if;
end;
$$;
