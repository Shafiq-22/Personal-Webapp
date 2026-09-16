# Cortex

**A privacy-first personal productivity and research intelligence platform.**
Tasks, calendar and the latest information from across the internet — where the
system works out what you are actually working on and goes and finds the newest
work on exactly that, and where every piece of AI runs on your own iPhone.

```
Web app (Next.js 15)  ·  iOS companion (SwiftUI + Apple Foundation Models)
Supabase Postgres     ·  Obsidian two-way sync  ·  Browser clipper
```

---

## The idea

Most tools that "find relevant papers" ask you to describe your interests, then
match keywords against that description. Cortex reads your own **open tasks,
recent calendar events and (with permission) Obsidian notes**, works out the
subjects you are genuinely working on, and proposes those as monitoring topics —
showing you the evidence for each, and activating none of them without your
say-so.

Then it goes looking: arXiv, RSS, news, blogs, forums, regulators, patent
offices, company announcements, release feeds. What comes back is ranked against
your work, not against a keyword list — and on an iPhone with Apple
Intelligence, that ranking is done by a model that understands what the work
*is*, on the device, offline.

**No cloud model is ever called.** Not for summarising, not for ranking, not for
understanding what you typed. That constraint shaped the whole architecture; see
[`docs/afm.md`](docs/afm.md) for how it is enforced rather than merely promised.

---

## What is here

### Tasks and reminders
Hierarchical projects and subtasks · four priorities · recurring tasks (RFC 5545
subset) that roll forward instead of closing · four reminder kinds — time,
location, dependency and escalating · natural-language capture · habits with
streaks · "Plan my day" and a guided Weekly Review · a productivity dashboard.

### Calendar
Two-way Google Calendar sync with incremental sync tokens · a merged timeline of
events, due tasks and time blocks · free-slot detection inside your working
hours · conflict detection with resolutions you can act on · time blocks that
reach your calendar only after you approve them.

### Monitoring
Sixteen source kinds · automatic topic discovery from your own work · explainable
hybrid ranking (keyword, similarity, recency, source trust, and a signal learned
from what you save) · realtime alerts above a threshold you set · daily and
weekly digests in your own time zone · a research library with notes, tags and
BibTeX/RIS export.

### On-device AI (iPhone)
Summaries in six styles · contextual re-ranking · natural-language understanding
· task breakdown · prioritisation with reasons · time-block suggestions ·
writing helpers. All offline, all local.

### Obsidian
Two-way Markdown sync with a real three-way merge · frontmatter that round-trips
· Obsidian Tasks plugin syntax · a daily-note section that leaves your own
journal alone · iCloud Drive, Obsidian Sync, WebDAV, Remotely Save, LiveSync,
Google Drive or the Local REST API.

### Everywhere else
Installable PWA with an offline queue · MV3 web clipper · read-only share links ·
export to Markdown, ICS, CSV, BibTeX and RIS.

---

## Quick start

```bash
git clone https://github.com/Shafiq-22/Personal-Webapp.git
cd Personal-Webapp
npm install
npm run build:core

cp apps/web/.env.example apps/web/.env.local   # add your Supabase keys
supabase db push                                # apply the schema
npm run dev                                     # http://localhost:3000
```

Full walkthrough — Google Calendar, scheduled jobs, the iOS build — in
[`docs/setup.md`](docs/setup.md).

---

## Repository

```
packages/core/      framework-agnostic domain: models, scheduling, ranking,
                    Obsidian format, exporters, deterministic AI fallbacks
apps/web/           Next.js 15 app + REST API for the companion clients
apps/extension/     MV3 web clipper
supabase/           migrations, RLS, edge functions, schema tests
ios/Cortex/         SwiftUI app · CortexKit · CortexAI
docs/               setup · architecture · api · afm · obsidian-frontmatter
```

`@cortex/core` has one runtime dependency and does no I/O, which is what lets
the same logic run in the Next.js server, inside a Deno edge function, and in
tests. The Swift side ports the parts the phone needs offline and shares test
fixtures with it, so the two cannot drift apart quietly.

---

## The design decisions worth knowing

**The web app is complete without the iPhone.** Every AI-shaped feature has a
deterministic implementation next to it. That is not a fallback bolted on; it is
the product working on a laptop, with the model improving those answers when a
capable device is present.

**The interface never pretends.** When Foundation Models is unavailable, the app
says which of the five reasons applies and what it is doing instead. Extracted
sentences are labelled as extracted sentences. The fallback declines ELI5 and
generative writing outright rather than returning something that reads like a
bad model.

**Every AI decision can be expanded.** Relevance scores keep their component
signals; scheduling proposals keep the sentence that justifies them. "Why am I
seeing this?" is answered from stored data, not regenerated prose.

**Model output is treated as untrusted.** Guided generation means no free-text
parsing; unknown ids are dropped, scores and durations clamped, and the
scheduler returns a slot index rather than a timestamp so a hallucinated time
cannot reach your calendar.

**Authorisation lives in Postgres.** RLS on every table, applied in one loop so a
new table cannot be added without a policy. OAuth refresh tokens are unreachable
from a browser session. Anonymous share access goes through one auditable
security-definer function.

---

## Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Core | `npm run test:core` | 131 cases: capture grammar, recurrence, free slots, conflicts, planner, feed parsing, dedupe, topic extraction, ranking, digests, Obsidian round-trip and sync, exporters |
| Web | `npm test --workspace @cortex/web` | 18 cases: row/domain mappers, malformed-settings degradation, timezone handling |
| Database | `npm run db:test` | schema, constraints, cross-user isolation, token unreachability, share expiry, item dedupe |
| iOS | `cd ios/Cortex && swift test` | capture grammar (shared fixtures), scheduling, recurrence, Markdown contract, fallback refusals, malformed generations, coordinator fallback |

```bash
npm test          # core + web
npm run db:test   # needs a local Postgres
```

---

## Running instance

A live instance is deployed for the repository owner - Supabase in `ap-south-1`
for the database, auth and scheduled jobs, Vercel for the web app, installable
to an iPhone Home Screen as a PWA. It needs no environment configuration,
because the only values the browser needs are publishable ones. See
[`docs/deployment.md`](docs/deployment.md) for how the scheduler authenticates
without a service role key, and what is deliberately not switched on.

## Status

The web app, the database layer and the shared core are built and verified here:
the production build succeeds, ESLint is clean, and 149 JavaScript tests plus
the SQL suite pass against a real Postgres 16.

The iOS companion is complete in source — app, both libraries, widgets, App
Intents, Share Sheet extension and its own test suites — but **has not been
compiled**, because building Swift for iOS 26 needs Xcode on macOS and this
repository was assembled on Linux. Expect to fix the ordinary things a first
compile turns up. The `FoundationModels` usage follows the framework's public
API (`SystemLanguageModel.availability`, `LanguageModelSession`, `@Generable`,
`@Guide`, `GenerationOptions`); verify it against the SDK you build with.

---

## Licence

MIT.
