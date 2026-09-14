# Obsidian note formats

Every note Cortex writes is plain Markdown with YAML frontmatter. Two rules
shape the format:

1. **Task lines are valid Obsidian Tasks plugin syntax**, so existing queries
   pick Cortex tasks up with no configuration.
2. **Frontmatter round-trips.** Everything needed to sync a note back is in it,
   so a note edited in Obsidian can be re-imported without guessing — and can be
   renamed or moved in the vault without breaking the link, because the id
   travels in the frontmatter rather than the filename.

The same renderer exists twice: `packages/core/src/obsidian/markdown.ts` and
`ios/Cortex/Sources/CortexKit/MarkdownNote.swift`. They are byte-compatible on
purpose — a difference would show up as a phantom conflict on every sync.

## Task note

`Cortex/Tasks/draft-the-methods-section-a1b2c3d4.md`

```markdown
---
cortex_type: task
cortex_id: a1b2c3d4-0000-4000-a000-000000000001
cortex_schema: 1
title: Draft the methods section
status: todo
priority: p1
project: Grant renewal
tags:
  - writing
  - grant
due: 2026-09-20
start: 2026-09-18T09:00:00Z
estimate_minutes: 90
energy: high
recurrence: FREQ=WEEKLY;INTERVAL=1;BYDAY=MO
completed: null
origin: nl_capture
source_url: null
updated: 2026-09-14T08:12:00Z
---

# Draft the methods section

- [ ] Draft the methods section ⏫ #writing 📅 2026-09-20 🛫 2026-09-18 🔁 every week on Monday

Focus on the ablation study.

## Subtasks

- [x] Outline the sections ✅ 2026-09-13
- [ ] Write the ablation paragraph

---

*Synced from Cortex. Edit freely - changes flow back on the next sync.*
```

| Field | Type | Notes |
| --- | --- | --- |
| `cortex_type` | `task` | identifies the note to the importer |
| `cortex_id` | uuid | survives renames and moves |
| `cortex_schema` | int | bumped if the format ever changes incompatibly |
| `status` | `todo` · `in_progress` · `done` · `cancelled` | |
| `priority` | `p1`…`p4` | `p1` is most urgent |
| `due` | date or datetime | date-only for all-day tasks |
| `recurrence` | RRULE body | the subset in `schedule/recurrence.ts` |
| `origin` | enum | `manual`, `nl_capture`, `ios`, `feed`, `clipper`, … |

### Task line emoji

Standard Obsidian Tasks syntax:

| Emoji | Meaning |
| --- | --- |
| `⏫` / `🔼` / `🔽` | priority p1 / p2 / p4 |
| `📅` | due date |
| `🛫` | start date |
| `✅` | completion date |
| `🔁` | recurrence, in words |

### Reading edits back

When frontmatter and the checkbox disagree, **the checkbox wins**. Ticking a box
in Obsidian is an edit the user just made; the frontmatter is Cortex's own
bookkeeping from the last push. A note with no Cortex frontmatter at all is
treated as a new task.

## Research note

`Cortex/Research/sulfide-electrolytes-and-dendrite-suppression-b2c3d4e5.md`

```markdown
---
cortex_type: item
cortex_id: b2c3d4e5-0000-4000-a000-000000000002
cortex_schema: 1
title: Sulfide electrolytes and dendrite suppression
kind: paper
authors:
  - Akiko Nakamura
  - Priya Sharma
url: https://doi.org/10.1000/xyz123
doi: 10.1000/xyz123
arxiv: null
venue: Journal of Power Sources
published: 2026-03-04T00:00:00Z
captured: 2026-09-13T06:12:00Z
topics:
  - Solid state batteries
tags:
  - cortex/research
  - to-cite
relevance: 0.86
ai_engine: afm
---

# Sulfide electrolytes and dendrite suppression

**Authors:** Akiko Nakamura, Priya Sharma
**Source:** [doi.org](https://doi.org/10.1000/xyz123)
**DOI:** [10.1000/xyz123](https://doi.org/10.1000/xyz123)

> Surfaced because it bears on your open task about electrolyte stability

## TL;DR

A two-step anneal produces a sulfide electrolyte that holds 99.9% coulombic
efficiency over 1200 cycles.

## Methodology

- Ball-milled synthesis followed by a two-step anneal
- 1200 cycles at 1C, symmetric cell
- Limitation the authors state: single composition, no pouch-cell validation

*Summaries generated on device with Apple Foundation Models. Nothing was sent to a server.*

## Original abstract

...

## My notes

Compare the anneal profile with our own.
```

`ai_engine` is the field to pay attention to: `afm` means the summaries were
written by Apple Foundation Models on the user's device; `heuristic` means they
are extracted sentences, and the note says so in place of the AFM line;
`none` means there are no summaries.

## Digest note

`Cortex/Digests/2026-09-14-daily.md`

```markdown
---
cortex_type: digest
cortex_id: c3d4e5f6-0000-4000-a000-000000000003
cortex_schema: 1
period: daily
window_start: 2026-09-13T07:00:00Z
window_end: 2026-09-14T07:00:00Z
item_count: 4
tags:
  - cortex/digest
  - cortex/digest/daily
---

# Today: 4 new items across Solid state batteries, Grid storage

## [Sulfide electrolytes and dendrite suppression](https://doi.org/10.1000/xyz123)

Topics: #solid-state-batteries
Relevance: 86%

> matches "Solid state batteries" on electrolyte, dendrite; published very recently
```

## Daily note section

Cortex owns a delimited block and nothing else, so it can be merged into a
daily note the user already keeps:

```markdown
# 2026-09-14

My own journal entry, untouched.

<!-- cortex:start -->

## Cortex

### Schedule

- 10:00-11:00 Lab meeting
- 14:00-15:30 Deep work: methods section

### Tasks

- [ ] Draft the methods section ⏫ 📅 2026-09-14
- [x] Email the reviewers ✅ 2026-09-14

### Research

- Today: 4 new items across Solid state batteries, Grid storage

<!-- cortex:end -->

More of my own notes, also untouched.
```

Anything outside the markers is never modified.

## Calendar event note

```markdown
---
cortex_type: event
cortex_id: d4e5f6a7-0000-4000-a000-000000000004
cortex_schema: 1
title: Lab meeting
start: 2026-09-14T10:00:00Z
end: 2026-09-14T11:00:00Z
all_day: false
location: Room 3.14
attendees: 6
link: https://calendar.google.com/...
tags:
  - cortex/calendar
---
```

## YAML conventions

Values are quoted only when a bare scalar would change meaning: a leading YAML
indicator character, an embedded `: ` or ` #`, an exact boolean or null token, a
pure number, or leading/trailing whitespace. So a DOI stays readable as
`10.1000/xyz123`, an ISO date stays a date Obsidian can parse, and `true` as a
*title* is quoted.

Lists are always block style, which is what Obsidian's own property editor
produces.

## Folder layout

Configurable per vault; the defaults are:

| Content | Folder |
| --- | --- |
| Tasks | `Cortex/Tasks` |
| Research | `Cortex/Research` |
| Digests | `Cortex/Digests` |
| Calendar | `Cortex/Calendar` |
| Projects | `Cortex/Projects` |
| Daily notes | `Daily Notes` |

## Dataview and Tasks queries

The frontmatter is designed to be queried:

````markdown
```dataview
TABLE priority, due, project
FROM "Cortex/Tasks"
WHERE cortex_type = "task" AND status != "done"
SORT due ASC
```
````

````markdown
```dataview
TABLE relevance, venue, published
FROM "Cortex/Research"
WHERE relevance > 0.7 AND contains(topics, "Solid state batteries")
SORT published DESC
```
````

````markdown
```tasks
not done
path includes Cortex/Tasks
due before in 7 days
```
````
