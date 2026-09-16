# API reference

The REST surface under `/api`. It exists for the **iOS companion** and the
**browser extension**; the web UI uses Server Actions and does not depend on it,
which keeps this surface small and stable.

## Authentication

Every endpoint takes a Supabase access token:

```
Authorization: Bearer <access token>
```

The session cookie is accepted too, so the same endpoints work from a browser
and from `curl` during development. Either way, Postgres row level security is
what enforces ownership — the API cannot return another account's rows even if a
handler forgets a filter.

Optional: `x-cortex-client: cortex-ios | cortex-extension` to distinguish
first-party clients in logs.

## Conventions

- Request and response bodies are JSON in **camelCase**
- Timestamps are ISO-8601 with an offset
- Success: `{ "data": ... }`
- Failure: `{ "error": "...", "details": [...] }` with a meaningful status
- `422` carries the zod issues that caused the rejection

| Status | Meaning |
| --- | --- |
| 200 / 201 | fine |
| 401 | missing or expired token |
| 403 | refused on purpose — see `/api/summaries` |
| 404 | no such row, *or* it belongs to someone else |
| 422 | the body failed validation |

---

## Tasks

### `GET /api/tasks`

| Query | Default | Notes |
| --- | --- | --- |
| `status` | `todo,in_progress` | comma separated |
| `project` | — | project id |
| `updatedSince` | — | ISO timestamp; this is the delta-sync parameter |
| `limit` | 200 | max 1000 |
| `tree` | `false` | returns a depth-first ordering with a `depth` field |

```bash
curl "$CORTEX/api/tasks?updatedSince=2026-09-13T00:00:00Z" -H "Authorization: Bearer $TOKEN"
```

### `POST /api/tasks`

Accepts one task or an array of up to 100.

```json
{
  "title": "Draft the methods section",
  "priority": "p1",
  "dueAt": "2026-09-20T09:00:00Z",
  "estimateMinutes": 90,
  "energy": "high",
  "origin": "ios",
  "tagIds": []
}
```

`origin: "ios"` marks a task that Apple Foundation Models parsed on device.

### `GET | PATCH | DELETE /api/tasks/:id`

`PATCH` has one behaviour worth knowing: completing a **recurring** task rolls it
forward to its next occurrence instead of closing it, and the response says
where it went.

```json
{ "data": { "task": { "...": "...", "status": "todo", "dueAt": "2026-09-21T09:00:00Z" }, "rolledTo": "2026-09-21T09:00:00Z" } }
```

---

## Capture

### `POST /api/capture`

Turn one line of natural language into a task.

```json
{
  "text": "Draft grant section tomorrow at 9am for 90m #Grant @writing !1",
  "offsetMinutes": -420,
  "engine": "afm",
  "parsed": {
    "title": "Draft grant section",
    "dueAt": "2026-09-14T09:00:00-07:00",
    "estimateMinutes": 90,
    "priority": "p1",
    "projectName": "Grant",
    "tagNames": ["writing"]
  }
}
```

When `parsed` is present the server trusts it. That is the on-device path: the
model understood the sentence with real language ability, and re-parsing it with
the server's grammar would only be a downgrade. Omit `parsed` and the server
parses with the deterministic grammar and records `engine: "heuristic"`.

`#project` and `@tag` are resolved by name and created if new.

---

## Context for on-device inference

### `GET /api/context?tasks=25`

Everything the model needs, in one request, sized for a finite context window:
the pre-ranked open work, the next week of calendar, active topics and the
user's scheduling preferences.

```json
{
  "data": {
    "generatedAt": "2026-09-14T08:00:00Z",
    "timeZone": "Europe/London",
    "tasks": [{ "id": "...", "title": "...", "heuristicScore": 0.82, "heuristicReasons": ["overdue by 14h", "priority P1"] }],
    "events": [...],
    "topics": [...],
    "scheduling": { "workingHours": [...], "minBlockMinutes": 25 }
  }
}
```

Note the direction: context flows *to* the device and inferences come back.
Nothing is sent anywhere for a model to read.

---

## Information items

### `GET /api/items`

Query: `limit` (max 200), `since`, `state`. Returns each item with its scores
and reading state — this is what the companion pulls before re-ranking.

### `POST /api/items`

Add something by hand: the web clipper and the iOS Share Sheet. Deduplicated
against the monitored feed by canonical URL, so clipping an article a feed later
publishes returns the existing row with `deduped: true`.

```json
{ "url": "https://arxiv.org/abs/2609.01234", "title": "...", "kind": "preprint", "arxivId": "2609.01234", "origin": "clipper" }
```

### `POST /api/items/scores`

Relevance judged on device. Rows written here carry `engine: "afm"` and take
precedence over the server's keyword ranking wherever both exist. The
explanation is stored so the "why am I seeing this?" panel shows the model's own
reasoning.

```json
[{ "itemId": "...", "topicId": "...", "score": 0.86, "explanation": "Bears directly on your open task about electrolyte stability" }]
```

### `POST /api/items/state`

`new` · `read` · `saved` · `dismissed` · `snoozed`, plus notes, tags and a
rating. Saving and dismissing feed the learned relevance signal.

---

## Summaries

### `POST /api/summaries`

Upload summaries written on device.

```json
[{ "itemId": "...", "style": "tldr", "text": "...", "engine": "afm", "modelIdentifier": "apple-on-device" }]
```

**Returns 403 unless the user turned on summary sync.** That is the correct
default and not a bug to work around: what the phone writes stays on the phone
unless the user says otherwise. Handle the 403 by keeping the summary locally.

`engine` must be accurate — the interface presents `afm` text as a written
summary and `heuristic` text as extracted sentences, and conflating them would
mislead the user.

### `GET /api/summaries?itemId=...`

---

## Devices

### `POST /api/devices`

```json
{
  "name": "iPhone 16 Pro Max",
  "platform": "ios",
  "pushToken": "...",
  "afmAvailability": "available",
  "appVersion": "0.1.0"
}
```

`afmAvailability` mirrors `SystemLanguageModel.availability`:
`available` · `device_not_eligible` · `model_not_ready` ·
`apple_intelligence_disabled` · `unsupported_os` · `unknown`.

The web app uses it to explain *why* an AI feature is unavailable rather than
hiding it. Send it on every launch and whenever it changes.

---

## Export

### `GET /api/export/:format?scope=...`

| Scope | Formats |
| --- | --- |
| `tasks` | `csv`, `ics` (VTODO), `markdown`, `json` |
| `library` | `bibtex`, `ris`, `csv`, `markdown`, `json` |
| `calendar` | `ics`, `json` |

Returns the file with a `Content-Disposition` attachment header.

### `GET /api/obsidian/export`

The whole vault as one Markdown bundle, each note preceded by
`<!-- file: path -->`. A single readable file rather than a zip, so unpacking it
is scriptable and inspecting it needs nothing.

---

## Calendar

`GET /api/calendar/google/connect` starts the OAuth flow;
`GET /api/calendar/google/callback` finishes it and imports the calendar list.
Both are browser redirects rather than JSON endpoints. Refresh tokens are stored
where the browser cannot read them.

Actual syncing is the `google-calendar-sync` edge function, callable with either
a user token or the service role key.

---

## Rate limits

None are enforced today. The scheduled functions are the only high-volume caller
and they are internal. If you build something noisy against this API, be
considerate of your own Supabase quota.
