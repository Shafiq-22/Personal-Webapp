-- Schema and RLS behaviour tests.
--
-- Run with:  npm run db:test   (see scripts/db-test.sh)
-- Every check raises an exception on failure, so psql -v ON_ERROR_STOP=1 turns
-- the file into a pass/fail gate suitable for CI.

\set ON_ERROR_STOP on

create or replace function assert(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Fixtures: two users who must never see each other's rows.
-- --------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-a111-111111111111', 'ada@example.com'),
  ('22222222-2222-4222-a222-222222222222', 'grace@example.com')
on conflict (id) do nothing;

do $$
begin
  perform assert(
    (select count(*) from profiles where id in ('11111111-1111-4111-a111-111111111111', '22222222-2222-4222-a222-222222222222')) = 2,
    'signing up must create a profile row via the auth trigger'
  );
  perform assert(
    (select count(*) from user_settings where user_id = '11111111-1111-4111-a111-111111111111') = 1,
    'signing up must create a user_settings row'
  );
end;
$$;

insert into projects (id, user_id, name) values
  ('aaaaaaaa-0000-4000-a000-000000000001', '11111111-1111-4111-a111-111111111111', 'Ada grant'),
  ('bbbbbbbb-0000-4000-a000-000000000002', '22222222-2222-4222-a222-222222222222', 'Grace compiler');

insert into tasks (id, user_id, project_id, title, priority, due_at) values
  ('aaaaaaaa-0000-4000-a000-000000000011', '11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000001', 'Draft methods', 'p1', now() + interval '1 day'),
  ('bbbbbbbb-0000-4000-a000-000000000012', '22222222-2222-4222-a222-222222222222', 'bbbbbbbb-0000-4000-a000-000000000002', 'Write the compiler', 'p2', now() + interval '2 days');

-- --------------------------------------------------------------------------
-- Completion bookkeeping
-- --------------------------------------------------------------------------
do $$
begin
  update tasks set status = 'done' where id = 'aaaaaaaa-0000-4000-a000-000000000011';
  perform assert(
    (select completed_at is not null from tasks where id = 'aaaaaaaa-0000-4000-a000-000000000011'),
    'marking a task done must stamp completed_at even when the client forgets'
  );

  update tasks set status = 'todo' where id = 'aaaaaaaa-0000-4000-a000-000000000011';
  perform assert(
    (select completed_at is null from tasks where id = 'aaaaaaaa-0000-4000-a000-000000000011'),
    'reopening a task must clear completed_at'
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Reminder invariants
-- --------------------------------------------------------------------------
do $$
declare
  ok boolean;
begin
  begin
    insert into reminders (user_id, task_id, kind)
    values ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000011', 'time');
    ok := false;
  exception when check_violation then
    ok := true;
  end;
  perform assert(ok, 'a time reminder without trigger_at or offset_minutes must be rejected');

  begin
    insert into reminders (user_id, task_id, kind, latitude)
    values ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000011', 'location', 51.5);
    ok := false;
  exception when check_violation then
    ok := true;
  end;
  perform assert(ok, 'a location reminder without a full coordinate and trigger must be rejected');

  insert into reminders (user_id, task_id, kind, escalation_steps)
  values ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000011', 'escalating', '[{"afterMinutes":15}]'::jsonb);
  perform assert(true, 'a valid escalating reminder is accepted');
end;
$$;

-- --------------------------------------------------------------------------
-- Item dedupe
-- --------------------------------------------------------------------------
insert into sources (id, user_id, kind, name, url)
values ('aaaaaaaa-0000-4000-a000-000000000021', '11111111-1111-4111-a111-111111111111', 'rss', 'Battery Weekly', 'https://batteryweekly.example/feed.xml');

do $$
declare
  first_run integer;
  second_run integer;
begin
  select count(*) into first_run from upsert_info_items(
    '11111111-1111-4111-a111-111111111111',
    '[{"sourceId":"aaaaaaaa-0000-4000-a000-000000000021","url":"https://x.example/a","canonicalUrl":"https://x.example/a","title":"Solid state advance","contentHash":"aaaaaaaabbbbbbbb","authors":["R. Okafor"],"publishedAt":"2026-09-12T00:00:00Z"}]'::jsonb
  ) where was_inserted;
  perform assert(first_run = 1, 'a new item is inserted');

  select count(*) into second_run from upsert_info_items(
    '11111111-1111-4111-a111-111111111111',
    '[{"sourceId":"aaaaaaaa-0000-4000-a000-000000000021","url":"https://x.example/a?utm_source=rss","canonicalUrl":"https://x.example/a","title":"Solid state advance","contentHash":"aaaaaaaabbbbbbbb"}]'::jsonb
  ) where was_inserted;
  perform assert(second_run = 0, 'the same content hash must not be inserted twice');

  perform assert(
    (select count(*) from info_items where user_id = '11111111-1111-4111-a111-111111111111') = 1,
    'only one row survives for a duplicated item'
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Row level security
-- --------------------------------------------------------------------------
do $$
declare
  visible integer;
begin
  -- Act as Ada.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', true);
  set local role authenticated;

  select count(*) into visible from tasks;
  perform assert(visible = 1, format('Ada must see exactly her own task, saw %s', visible));

  select count(*) into visible from projects;
  perform assert(visible = 1, 'Ada must see exactly her own project');

  -- Writing on someone else's behalf must fail the WITH CHECK clause.
  begin
    insert into tasks (user_id, title) values ('22222222-2222-4222-a222-222222222222', 'smuggled');
    perform assert(false, 'inserting a row owned by another user must be rejected');
  exception when insufficient_privilege then
    null;
  end;

  -- Stealing an existing row must fail too.
  update tasks set title = 'hijacked' where id = 'bbbbbbbb-0000-4000-a000-000000000012';
  perform assert(
    (select count(*) from tasks where title = 'hijacked') = 0,
    'updating another user row must affect nothing'
  );

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- OAuth tokens must be unreachable from a normal client session.
do $$
declare
  denied boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', true);
  set local role authenticated;
  begin
    perform encrypted_tokens from calendar_accounts limit 1;
  exception when insufficient_privilege then
    denied := true;
  end;
  perform assert(denied, 'authenticated clients must not be able to select calendar_accounts directly');
  reset role;
end;
$$;

-- --------------------------------------------------------------------------
-- Public share resolution
-- --------------------------------------------------------------------------
insert into shares (user_id, token, resource_type, resource_id, title)
values ('11111111-1111-4111-a111-111111111111', 'share-token-abcdef123456', 'project', 'aaaaaaaa-0000-4000-a000-000000000001', 'Ada grant');

do $$
declare
  payload jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;

  payload := resolve_share('share-token-abcdef123456');
  perform assert(payload is not null, 'a valid share token resolves for an anonymous visitor');
  perform assert(payload ->> 'title' = 'Ada grant', 'the share carries its title');
  perform assert(jsonb_array_length(payload -> 'items') = 1, 'the share lists the project tasks');
  perform assert(payload -> 'items' -> 0 ->> 'notes' is null, 'notes stay private unless the share opted in');

  perform assert(resolve_share('no-such-token-000000') is null, 'an unknown token resolves to nothing');

  reset role;
end;
$$;

do $$
begin
  update shares set revoked_at = now() where token = 'share-token-abcdef123456';
  set local role anon;
  perform assert(resolve_share('share-token-abcdef123456') is null, 'a revoked share stops resolving');
  reset role;
end;
$$;

-- --------------------------------------------------------------------------
-- Merged timeline
-- --------------------------------------------------------------------------
insert into calendar_accounts (id, user_id, account_email)
values ('aaaaaaaa-0000-4000-a000-000000000031', '11111111-1111-4111-a111-111111111111', 'ada@example.com');
insert into calendars (id, user_id, account_id, external_id, name)
values ('aaaaaaaa-0000-4000-a000-000000000041', '11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000031', 'primary', 'Work');
insert into calendar_events (user_id, calendar_id, title, start_at, end_at)
values ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000041', 'Lab meeting', now() + interval '1 hour', now() + interval '2 hours');
insert into time_blocks (user_id, task_id, title, start_at, end_at, rationale)
values ('11111111-1111-4111-a111-111111111111', 'aaaaaaaa-0000-4000-a000-000000000011', 'Draft methods', now() + interval '3 hours', now() + interval '4 hours', 'first free slot');

do $$
declare
  kinds text[];
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', true);
  set local role authenticated;

  select array_agg(distinct kind order by kind) into kinds
  from merged_timeline(now() - interval '1 day', now() + interval '3 days');

  perform assert(kinds @> array['block', 'event', 'task'], format('the merged timeline must return all three kinds, got %s', kinds));
  reset role;
end;
$$;

select 'ALL SCHEMA TESTS PASSED' as result;
