-- Row level security.
--
-- Cortex is single-tenant per user: there are no teams, no shared workspaces
-- and no cross-user reads. Every table therefore gets the same shape of policy
-- - `user_id = auth.uid()` for select/insert/update/delete - applied here in
-- one place so no table can be added later without one.

alter table profiles enable row level security;
alter table user_settings enable row level security;
alter table projects enable row level security;
alter table tags enable row level security;
alter table tasks enable row level security;
alter table task_tags enable row level security;
alter table task_dependencies enable row level security;
alter table reminders enable row level security;
alter table habits enable row level security;
alter table habit_entries enable row level security;
alter table calendar_accounts enable row level security;
alter table calendars enable row level security;
alter table calendar_events enable row level security;
alter table time_blocks enable row level security;
alter table sources enable row level security;
alter table topics enable row level security;
alter table topic_candidates enable row level security;
alter table info_items enable row level security;
alter table item_scores enable row level security;
alter table item_states enable row level security;
alter table item_summaries enable row level security;
alter table digests enable row level security;
alter table vaults enable row level security;
alter table obsidian_files enable row level security;
alter table devices enable row level security;
alter table saved_views enable row level security;
alter table shares enable row level security;
alter table ai_explanations enable row level security;

-- Table privileges. RLS decides *which rows*; grants decide whether the role
-- may touch the table at all, and Cortex states them explicitly rather than
-- relying on a project's default privileges.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- Profiles key on `id`, everything else on `user_id`.
create policy "profiles are private" on profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "settings are private" on user_settings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

do $$
declare
  t text;
  owned text[] := array[
    'projects', 'tags', 'tasks', 'task_tags', 'task_dependencies', 'reminders',
    'habits', 'habit_entries', 'calendars', 'calendar_events', 'time_blocks',
    'sources', 'topics', 'topic_candidates', 'info_items', 'item_scores',
    'item_states', 'item_summaries', 'digests', 'vaults', 'obsidian_files',
    'devices', 'saved_views', 'shares', 'ai_explanations'
  ];
begin
  foreach t in array owned loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner_all', t
    );
  end loop;
end;
$$;

-- Calendar accounts: the owner may manage the row, but the OAuth material in
-- `encrypted_tokens` is only ever read by edge functions using the service
-- role (which bypasses RLS). Clients read `calendar_accounts_public`.
create policy "calendar accounts owner manage" on calendar_accounts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke select on calendar_accounts from authenticated, anon;
grant select on calendar_accounts_public to authenticated;
grant insert, update, delete on calendar_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Public share resolution
-- ---------------------------------------------------------------------------
-- Anonymous visitors never touch a user table directly. This function is the
-- single, auditable door: it validates the token, bumps the view counter and
-- returns exactly the fields the share was created for.
create or replace function resolve_share(share_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s shares%rowtype;
  payload jsonb;
begin
  select * into s from shares
  where token = share_token
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  update shares set view_count = view_count + 1 where id = s.id;

  if s.resource_type = 'project' then
    select jsonb_build_object(
      'type', 'project',
      'title', coalesce(s.title, p.name),
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'title', t.title,
        'status', t.status,
        'priority', t.priority,
        'due_at', t.due_at,
        'notes', case when s.include_notes then t.notes else null end
      ) order by t.sort_order, t.created_at) filter (where t.id is not null), '[]'::jsonb)
    )
    into payload
    from projects p
    left join tasks t on t.project_id = p.id and t.user_id = s.user_id
    where p.id = s.resource_id::uuid and p.user_id = s.user_id
    group by p.name;

  elsif s.resource_type = 'digest' then
    select jsonb_build_object(
      'type', 'digest',
      'title', coalesce(s.title, d.headline),
      'window_start', d.window_start,
      'window_end', d.window_end,
      'items', d.entries
    )
    into payload
    from digests d
    where d.id = s.resource_id::uuid and d.user_id = s.user_id;

  elsif s.resource_type = 'library_tag' then
    select jsonb_build_object(
      'type', 'library_tag',
      'title', coalesce(s.title, s.resource_id),
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'title', i.title,
        'url', coalesce(i.canonical_url, i.url),
        'authors', i.authors,
        'published_at', i.published_at,
        'notes', case when s.include_notes then st.notes else null end
      ) order by i.published_at desc nulls last), '[]'::jsonb)
    )
    into payload
    from item_states st
    join info_items i on i.id = st.item_id
    where st.user_id = s.user_id and st.state = 'saved' and s.resource_id = any (st.tags);

  else
    select jsonb_build_object('type', s.resource_type::text, 'title', s.title, 'items', '[]'::jsonb) into payload;
  end if;

  return payload;
end;
$$;

revoke all on function resolve_share(text) from public;
grant execute on function resolve_share(text) to anon, authenticated;
