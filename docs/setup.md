# Setup

Getting Cortex running end to end: the database, the web app, the scheduled
jobs, the calendar connection and the iOS companion.

Everything except the iOS build works on Linux, macOS and Windows.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node | 20.11+ (22 recommended) | web app, shared core |
| npm | 10+ | workspaces |
| Supabase CLI | 1.200+ | migrations, edge functions |
| Postgres | 16 | running the schema tests locally (optional) |
| Xcode | 26+ | the iOS companion (macOS only) |
| XcodeGen | latest | generating the iOS project |

## 1. Install

```bash
git clone https://github.com/Shafiq-22/Personal-Webapp.git
cd Personal-Webapp
npm install
npm run build:core     # the web app imports the compiled core
```

## 2. Create the Supabase project

Either a hosted project or `supabase start` locally.

```bash
supabase link --project-ref <your-ref>
supabase db push
```

That applies, in order:

| Migration | Contents |
| --- | --- |
| `20260901000000_init_core` | profiles, settings, projects, tags, tasks, reminders, habits |
| `20260901000100_calendar` | calendar accounts, calendars, events, time blocks |
| `20260901000200_monitoring` | sources, topics, items, scores, states, summaries, digests |
| `20260901000300_obsidian_devices_sharing` | vaults, file mappings, devices, saved views, shares |
| `20260901000400_rls` | grants and row level security for every table |
| `20260901000500_functions` | merged timeline, bulk ingest, feedback, analytics, realtime |
| `20260901000600_cron` | scheduled jobs (see step 5) |

To verify the schema without a project — this needs only a local Postgres:

```bash
npm run db:test
```

It recreates a throwaway database, applies every migration and runs
`supabase/tests/schema.test.sql`, which asserts cross-user isolation, that OAuth
tokens are unreachable from a client session, share expiry, item dedupe and the
reminder constraints.

## 3. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | safe in the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page | safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | same page | **server only** — never prefix with `NEXT_PUBLIC_` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud console | see step 4 |
| `NEXT_PUBLIC_SITE_URL` | your deployment URL | `http://localhost:3000` in development |

```bash
npm run dev      # http://localhost:3000
```

Sign up with an email address. The database trigger creates your profile and
settings rows automatically.

## 4. Google Calendar (optional)

1. Google Cloud console → **APIs & Services** → enable the **Google Calendar API**
2. **Credentials** → Create credentials → OAuth client ID → *Web application*
3. Authorised redirect URI: `<NEXT_PUBLIC_SITE_URL>/api/calendar/google/callback`
4. Put the client id and secret in `.env.local`, and also in Supabase secrets so
   the sync function can refresh tokens:

```bash
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

Then open **Calendar → Connect Google Calendar** in the app.

Signing in with Google does *not* grant calendar access — the scopes are
requested separately here, so the two can be revoked independently.

## 5. Scheduled jobs

The three edge functions do the recurring work: polling sources, building
digests and syncing calendars.

```bash
./scripts/sync-edge-core.sh       # copies the compiled core next to the functions
supabase functions deploy monitor-fetch digest-build google-calendar-sync
```

Then let pg_cron reach them:

```sql
alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
alter database postgres set app.settings.service_role_key = '<service role key>';
```

The schedules themselves came from `20260901000600_cron.sql`: sources hourly,
digests hourly (each user's digest fires at their own local hour), calendars
every fifteen minutes, housekeeping nightly.

## 6. Add something to monitor

**Settings → Monitoring** has three one-click starters (arXiv cs.LG, Nature,
GitHub releases) or paste any feed URL.

**Settings → Topics → Discover** reads your own open tasks and recent calendar
events and proposes topics from them, with the evidence for each. Nothing is
activated until you accept it.

Then **Feed → Re-score** ranks what has arrived. The first fetch happens on the
next hourly run, or immediately if you invoke the function by hand:

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/monitor-fetch" \
  -H "Authorization: Bearer <service role key>"
```

## 7. The iOS companion (optional, macOS)

```bash
brew install xcodegen
cd ios/Cortex
xcodegen generate
open Cortex.xcodeproj
```

Set your development team on the three targets, run on a device, and point it at
your deployment under **Settings → Server**. On an iPhone with Apple
Intelligence enabled, the AI features switch on by themselves; the app reports
its model availability back to the account, so the web app can say precisely
which features are live.

See [`docs/afm.md`](./afm.md) for what runs on device and what does not.

## 8. Browser extension (optional)

`chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension`. Set your address and access token in its options.

## Deploying the web app

It is a standard Next.js 15 app; anything that runs Next will do. On Vercel:

```bash
vercel --prod
```

Set the same environment variables in the project settings, and update
`NEXT_PUBLIC_SITE_URL` and the Google redirect URI to the deployed origin.

## Troubleshooting

**"Supabase is not configured yet" on the login page** — `.env.local` is missing
or the dev server was not restarted after creating it.

**Google returns "no refresh token"** — Google only issues one on first consent.
Remove Cortex at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and connect again.

**The feed stays empty** — check **Settings → Monitoring** for a red status on a
source, and confirm at least one topic is active. Items are stored regardless,
but nothing is *ranked* without a topic.

**Summaries do not appear in the web app** — that is the default. They are
written on the iPhone and stay there unless you turn on
**Settings → Privacy → Sync on-device summaries**.
