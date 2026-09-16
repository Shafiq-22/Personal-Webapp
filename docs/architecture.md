# Architecture

## The shape of the problem

Cortex has one constraint that determines everything else: **all AI runs on the
user's own device.** Not "we do not train on your data" — no model outside the
iPhone ever sees the content.

That rules out the usual architecture, where a server does the interesting work
and clients render it. Instead:

- the **server** does what servers are actually good at: durable storage,
  authorisation, polling the internet on a schedule, and arithmetic
- the **device** does what needs to understand meaning
- the **web app** must be completely usable with no device present, because
  most days it will be the only thing open

Everything below follows from that split.

```
                    ┌──────────────────────────────────────┐
                    │  iPhone  (Apple Foundation Models)   │
                    │                                      │
                    │  summarise · rank · prioritise       │
                    │  parse capture · break down · plan    │
                    │  Obsidian vault I/O · notifications   │
                    └───────────────┬──────────────────────┘
                          context ↓ │ ↑ results (scores, blocks, summaries*)
┌──────────────┐    ┌───────────────┴──────────────────────┐
│  Extension   │───▶│         Next.js 15 web app           │
│  (clipper)   │    │  Server Actions · REST API · PWA     │
└──────────────┘    └───────────────┬──────────────────────┘
                                    │
                    ┌───────────────┴──────────────────────┐
                    │        Supabase (Postgres)           │
                    │  RLS · realtime · edge functions      │
                    │  monitor-fetch · digest-build ·       │
                    │  google-calendar-sync                 │
                    └───────────────┬──────────────────────┘
                                    │
                       ┌────────────┴────────────┐
                       │  the internet           │
                       │  arXiv · RSS · news ·   │
                       │  patents · regulators   │
                       └─────────────────────────┘

* summaries only when the user turns on summary sync; off by default
```

## Repository layout

```
packages/core/     framework-agnostic TypeScript: the whole domain
apps/web/          Next.js 15 app + REST API
apps/extension/    MV3 web clipper
supabase/          migrations, RLS, edge functions, schema tests
ios/Cortex/        SwiftUI app + CortexKit + CortexAI
docs/              this
```

## `@cortex/core`

One runtime dependency (zod) and no I/O at all, which is what lets the same code
run in the Next.js server, in a Deno edge function, and in tests. It holds:

| Module | Responsibility |
| --- | --- |
| `domain/` | zod schemas for every entity; the single definition of what a task *is* |
| `nl/` | the natural-language capture grammar |
| `schedule/` | RRULE subset, free slots, conflicts, prioritisation, time blocks |
| `monitor/` | feed parsing, canonicalisation, topic extraction, relevance ranking, digests |
| `obsidian/` | frontmatter, note rendering, the Obsidian Tasks line format, three-way sync |
| `export/` | ICS, CSV, BibTeX, RIS |
| `summarize.ts` | the extractive fallback, explicitly *not* presented as AI output |

The Swift side ports the parts the phone needs offline — the capture grammar,
free-slot arithmetic, recurrence, the Markdown format — and the test suites
share fixtures so the two cannot drift apart silently.

### Why the fallbacks are in the core rather than the UI

Every AI-shaped feature has a deterministic implementation sitting next to it:
ranking, prioritisation, capture, summarisation. This is not defensive
programming; it is the product working on a laptop. The AI path improves those
answers when a capable device is present.

## Data model

Twenty-five tables, all owned by exactly one user. Highlights:

- **tasks** — self-referencing for subtasks, `project_id` for grouping, RRULE
  text for recurrence. A trigger keeps `completed_at` honest no matter which
  client wrote the row.
- **reminders** — one table, four kinds (time, location, dependency,
  escalating), with check constraints so a reminder cannot exist without the
  fields its kind requires. The same invariants are expressed in zod, and the
  schema tests assert both.
- **info_items** — unique on `(user_id, content_hash)`, where the hash is over
  the canonical URL plus normalised title. Clipping something a feed later
  publishes therefore cannot create a duplicate.
- **item_scores** — one row per (item, topic) with the component signals kept in
  `signals` jsonb, so "why am I seeing this?" is answerable from data rather
  than regenerated prose. `engine` records whether the phone or the server
  produced it; the feed prefers `afm`.
- **item_summaries** — unique on `(item_id, style, engine)`. Present only when
  the user allowed summary sync.
- **obsidian_files** — `base_hash` is the content both sides last agreed on,
  which is what makes three-way sync possible without trusting file timestamps.

### Authorisation

RLS on every table, applied in a single loop in `20260901000400_rls.sql` so a
table cannot be added later without a policy. There are no teams and no shared
workspaces, so every policy is the same shape: `user_id = auth.uid()`.

Two things are handled specially:

- **OAuth tokens.** `calendar_accounts.encrypted_tokens` is unreachable from a
  client session — `SELECT` is revoked for `authenticated`, and the app reads a
  restricted view instead. Only edge functions, running with the service role,
  ever touch the column.
- **Public shares.** Anonymous visitors never query a user table. They call
  `resolve_share(token)`, a security-definer function that validates the token,
  honours expiry and revocation, and returns exactly the fields the share was
  created for.

## The web app

Next.js 15 App Router, React Server Components by default.

- **Reads** go through `lib/queries.ts` — server-only, `cache()`-deduped, using
  the caller's session so RLS does the authorisation. No query filters by user
  id by hand, which means forgetting one cannot leak anything.
- **Writes from the UI** are Server Actions. They return `{ ok }` rather than
  throwing, so a failure is a toast and not an error boundary.
- **Writes from other clients** go through `/api`, a documented REST surface the
  web UI does not itself depend on. See [`api.md`](./api.md).

Both paths share the mappers in `lib/mappers.ts`, which are the only place that
knows Postgres is snake_case and the domain is camelCase.

### Offline

The service worker does network-first for navigations, cache-first for hashed
static assets, and network-first with a short-lived cache for API GETs.
Mutations made offline go into an IndexedDB queue and replay on reconnect. The
iOS app has its own equivalent queue in `SyncEngine`.

## The monitoring pipeline

1. `monitor-fetch` runs hourly and asks Postgres which sources are due — each
   source has its own interval, so a daily journal is not polled every hour.
2. Feeds are parsed by a small hand-written XML scanner. There is no DOM in Deno
   and no dependency worth taking for something this well specified; the scanner
   handles what real RSS and Atom actually use, including CDATA that contains
   markup.
3. URLs are canonicalised — tracking parameters removed, `www.` dropped, arXiv
   `abs`/`pdf` and version suffixes folded together — and hashed for dedupe.
4. New items are scored against active topics by the hybrid ranker: keyword
   overlap (weighted towards title hits), bag-of-words similarity, recency with
   a five-day half-life, source trust, and a feedback signal learned from what
   the user saves and dismisses. Every component is stored.
5. Items above the user's alert threshold produce a realtime alert; the rest
   wait for a digest.
6. When the iPhone next opens the feed it re-ranks the top slice with Foundation
   Models and overwrites those rows with `engine = 'afm'`.

### Topic discovery

The feature that makes the feed personal: instead of asking the user to describe
their interests, `extractTopicCandidates` reads their open tasks, recent
calendar events and — only with explicit permission — Obsidian notes, and
proposes topics using RAKE-style keyphrase extraction weighted by how much of
their actual work each phrase touches.

Candidates land in `topic_candidates` with the evidence that produced them.
Nothing is activated silently.

## Scheduling

Free-slot detection is pure arithmetic: working hours minus merged busy
intervals, with a configurable buffer, in the user's own time zone. It is the
same code on both platforms.

The model never reasons about calendar overlap. It receives the free slots and
the work, and returns a slot index plus an offset — never a timestamp. The app
computes the real instants from its own slots, so a hallucinated time cannot
reach anyone's calendar. Proposals that would overlap are discarded.

Nothing is written to Google Calendar until the user approves it.

## Obsidian sync

Notes are plain Markdown with YAML frontmatter, and task lines follow the
Obsidian Tasks plugin syntax so existing queries pick them up untouched.

Sync is three-way. `base_hash` records the content both sides last agreed on:

| Local changed | Vault changed | Action |
| --- | --- | --- |
| yes | no | push |
| no | yes | pull |
| yes | yes | flag a conflict, overwrite neither |
| no | no | nothing |

Timestamps are not consulted, because iCloud, WebDAV and LiveSync all report
them differently. Whitespace and line-ending churn is normalised away before
hashing, so a sync client touching a file does not look like an edit.

One deliberate asymmetry: when a note's frontmatter and its checkbox disagree,
the checkbox wins. Ticking a box in Obsidian is an edit the user just made;
frontmatter is Cortex's own bookkeeping from the last push.

## What is deliberately not here

- **No cloud model, and no abstraction that would let one be added quietly.**
  The `Intelligence` protocol lives in a module that does not import
  FoundationModels, and its only two implementations are the on-device model and
  a deterministic fallback.
- **No analytics by default.** The setting exists and is off.
- **No background location** beyond the geofences the user creates.
- **No server-side summarisation.** The extractive fallback exists so the web
  app has something to show, and the interface labels it as extracted sentences
  rather than a summary.
