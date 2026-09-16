-- Deployment hardening and first-run content.
--
-- Cortex is a single-person system, and a deployed instance publishes its
-- Supabase URL and anon key in the browser bundle (as every Supabase app does).
-- RLS already means those keys grant no access to anyone's data - but with open
-- signups, a stranger who found the URL could still create an account and
-- consume the project's quota. This migration closes that, and seeds enough
-- content that a new account is useful on the first morning.

-- ---------------------------------------------------------------------------
-- Signup allowlist
-- ---------------------------------------------------------------------------
create table if not exists signup_allowlist (
  email text primary key,
  note text,
  added_at timestamptz not null default now()
);

-- No policies and no grants: the table is readable only by the security-definer
-- trigger below and by the service role. Nothing in the client can enumerate it.
alter table signup_allowlist enable row level security;
revoke all on signup_allowlist from anon, authenticated;

create or replace function enforce_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An empty allowlist means "open signups", so a fresh clone of this project
  -- behaves normally until someone deliberately locks it down.
  if not exists (select 1 from public.signup_allowlist) then
    return new;
  end if;

  if not exists (
    select 1 from public.signup_allowlist
    where lower(email) = lower(new.email)
  ) then
    raise exception 'This Cortex instance is private and % is not on its allowlist.', new.email
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_signup_allowlist on auth.users;
create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function enforce_signup_allowlist();

-- ---------------------------------------------------------------------------
-- Starter sources
-- ---------------------------------------------------------------------------
-- A monitoring app with nothing to monitor is dead on arrival, so a new account
-- starts with a broad, general-interest set. They are ordinary rows: the
-- Settings page can disable or delete any of them, and adding better ones for
-- your own field is the first thing worth doing.
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

  insert into public.sources (user_id, kind, name, url, weight, fetch_interval_minutes)
  values
    (new.id, 'arxiv', 'arXiv - artificial intelligence',
     'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=40',
     1.2, 360),
    (new.id, 'news', 'Nature', 'https://www.nature.com/nature.rss', 1.3, 360),
    (new.id, 'forum', 'Hacker News', 'https://hnrss.org/frontpage', 0.9, 180),
    (new.id, 'news', 'MIT Technology Review', 'https://www.technologyreview.com/feed/', 1.0, 360)
  on conflict (user_id, url) do nothing;

  return new;
end;
$$;
