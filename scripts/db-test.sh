#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres database and run the schema +
# RLS assertions in supabase/tests.
#
# Uses a plain local Postgres with a tiny shim for the Supabase-specific pieces
# (the `auth` schema, `auth.uid()` and the three Supabase roles), so the suite
# runs in CI without Docker or a Supabase project.
#
#   ./scripts/db-test.sh                 # uses the local cluster as the postgres superuser
#   PGDATABASE=cortex_test ./scripts/db-test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${PGDATABASE:-cortex_test}"
PSQL_USER="${PGUSER:-postgres}"

run_psql() {
  if [[ "$(id -un)" == "$PSQL_USER" ]]; then
    psql -v ON_ERROR_STOP=1 -q "$@"
  else
    sudo -u "$PSQL_USER" psql -v ON_ERROR_STOP=1 -q "$@"
  fi
}

run_admin() {
  if [[ "$(id -un)" == "$PSQL_USER" ]]; then
    "$@"
  else
    sudo -u "$PSQL_USER" "$@"
  fi
}

# psql runs as another OS user, so the SQL has to live somewhere it can read.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/tests/*.sql "$STAGE"/
# pg_cron and pg_net ship with Supabase but not with a stock Postgres, so the
# schedule migration is validated on the project rather than here.
rm -f "$STAGE"/*_cron.sql
cat > "$STAGE/00_shim.sql" <<'SHIM'
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists "pgcrypto";
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants this itself; the shim mirrors it so RLS and functions that
-- call auth.uid() behave the same locally.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SHIM
chmod -R a+rX "$STAGE"

echo "==> recreating database $DB"
run_admin dropdb --if-exists "$DB"
run_admin createdb "$DB"

run_psql -d "$DB" -f "$STAGE/00_shim.sql"

for migration in "$STAGE"/2*.sql; do
  echo "==> $(basename "$migration")"
  run_psql -d "$DB" -f "$migration"
done

echo "==> schema tests"
run_psql -d "$DB" -f "$STAGE/schema.test.sql"
