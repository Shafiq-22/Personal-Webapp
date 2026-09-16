# Supabase project

Postgres schema, row level security, server-side functions and the three
scheduled edge functions.

## Layout

```
migrations/
  20260901000000_init_core.sql       profiles, settings, projects, tags, tasks, reminders, habits
  20260901000100_calendar.sql        calendar accounts/calendars/events, time blocks
  20260901000200_monitoring.sql      sources, topics, items, scores, states, summaries, digests
  20260901000300_obsidian_...sql     vaults, file mappings, devices, saved views, shares, AI explanations
  20260901000400_rls.sql             grants + row level security for every table, public share RPC
  20260901000500_functions.sql       merged timeline, bulk ingest, feedback, analytics, realtime
  20260901000600_cron.sql            pg_cron schedules (apply last, after secrets are set)
functions/
  _shared/                           helpers + generated copy of @cortex/core
  monitor-fetch/                     poll sources, normalise, store, score
  digest-build/                      daily + weekly digests
  google-calendar-sync/              two-way Google Calendar sync
tests/
  schema.test.sql                    schema, constraint and RLS assertions
```

## Applying migrations

```bash
supabase link --project-ref <ref>
supabase db push
```

`20260901000600_cron.sql` needs two database settings before its schedules can
reach the edge functions:

```sql
alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
alter database postgres set app.settings.service_role_key = '<service role key>';
```

## Running the schema tests

`./scripts/db-test.sh` recreates a throwaway database, applies every migration
and runs `tests/schema.test.sql`. It uses a plain local Postgres plus a small
shim for the Supabase-specific pieces (`auth.users`, `auth.uid()`, the three
roles), so it needs no Docker and no project.

The tests assert the things that would be expensive to get wrong: the signup
trigger, `completed_at` bookkeeping, reminder constraints per kind, item
dedupe, cross-user isolation under RLS, that OAuth tokens are unreachable from
a client session, and that public shares resolve only while valid.

## Deploying the edge functions

Edge functions run on Deno and cannot resolve the `@cortex/core` workspace
package, so the compiled core is copied next to them first:

```bash
./scripts/sync-edge-core.sh
supabase functions deploy monitor-fetch digest-build google-calendar-sync
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

`supabase/functions/_shared/core/` is generated and git-ignored.

## What never happens here

No function in this project calls a cloud language model. Ranking, topic
extraction and digest assembly use the deterministic algorithms in
`@cortex/core`; every *written* summary in Cortex is produced on the user's
iPhone by Apple Foundation Models and reaches this database only if the user
turned summary sync on. Rows that hold model output always carry an `engine`
column so the interface can say which engine produced them.
