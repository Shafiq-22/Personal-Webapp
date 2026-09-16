import type { CalendarEvent, Digest, InfoItem, ItemSummary, Project, Task, VaultConfig } from '../domain/index.js';
import { describeRRule } from '../schedule/recurrence.js';
import { dateKey } from '../util/date.js';
import { slugify } from '../util/id.js';
import { asStringArray, parseNote, renderNote, type Frontmatter } from './frontmatter.js';

/**
 * Note rendering for Obsidian.
 *
 * Two hard requirements shape every template here:
 *  1. The task line is valid **Obsidian Tasks plugin** syntax, so the user's
 *     existing queries pick Cortex tasks up with no configuration.
 *  2. Frontmatter round-trips: everything Cortex needs to sync a note back is
 *     in the frontmatter, so a note edited in Obsidian can be re-imported
 *     without guessing.
 */

export const FRONTMATTER_SCHEMA_VERSION = 1;

const PRIORITY_EMOJI: Record<string, string> = { p1: '⏫', p2: '🔼', p3: '', p4: '🔽' };

export interface TaskNoteContext {
  project?: Project | null;
  tags?: string[];
  subtasks?: Task[];
  sourceItem?: Pick<InfoItem, 'title' | 'url'> | null;
}

/** The single-line Obsidian Tasks representation of a task. */
export function taskLine(task: Task, context: TaskNoteContext = {}): string {
  const box = task.status === 'done' ? '[x]' : task.status === 'cancelled' ? '[-]' : '[ ]';
  const parts = [`- ${box} ${task.title}`];
  const emoji = PRIORITY_EMOJI[task.priority];
  if (emoji) parts.push(emoji);
  for (const tag of context.tags ?? []) parts.push(`#${slugify(tag)}`);
  if (task.recurrenceRule) parts.push(`🔁 ${describeRRule(task.recurrenceRule)}`);
  if (task.startAt) parts.push(`🛫 ${dateKey(new Date(task.startAt))}`);
  if (task.dueAt) parts.push(`📅 ${dateKey(new Date(task.dueAt))}`);
  if (task.completedAt) parts.push(`✅ ${dateKey(new Date(task.completedAt))}`);
  return parts.join(' ');
}

export function taskFrontmatter(task: Task, context: TaskNoteContext = {}): Frontmatter {
  return {
    cortex_type: 'task',
    cortex_id: task.id,
    cortex_schema: FRONTMATTER_SCHEMA_VERSION,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project: context.project?.name ?? null,
    tags: (context.tags ?? []).map((t) => slugify(t)),
    due: task.dueAt ? (task.dueAllDay ? dateKey(new Date(task.dueAt)) : task.dueAt) : null,
    start: task.startAt,
    estimate_minutes: task.estimateMinutes,
    energy: task.energy,
    recurrence: task.recurrenceRule,
    completed: task.completedAt,
    origin: task.origin,
    source_url: context.sourceItem?.url ?? null,
    updated: task.updatedAt,
  };
}

export function renderTaskNote(task: Task, context: TaskNoteContext = {}): string {
  const lines: string[] = [`# ${task.title}`, '', taskLine(task, context)];

  if (task.notes) lines.push('', task.notes.trim());

  if (context.subtasks?.length) {
    lines.push('', '## Subtasks', '');
    for (const sub of context.subtasks) lines.push(taskLine(sub));
  }

  if (context.sourceItem) {
    lines.push('', '## Source', '', `- [${context.sourceItem.title}](${context.sourceItem.url})`);
  }

  lines.push('', '---', '', `*Synced from Cortex. Edit freely - changes flow back on the next sync.*`);
  return renderNote(taskFrontmatter(task, context), lines.join('\n'));
}

export interface ItemNoteContext {
  summaries?: ItemSummary[];
  topicLabels?: string[];
  relevance?: number | null;
  reason?: string | null;
  userNotes?: string | null;
  userTags?: string[];
}

export function itemFrontmatter(item: InfoItem, context: ItemNoteContext = {}): Frontmatter {
  return {
    cortex_type: 'item',
    cortex_id: item.id,
    cortex_schema: FRONTMATTER_SCHEMA_VERSION,
    title: item.title,
    kind: item.kind,
    authors: item.authors,
    url: item.canonicalUrl ?? item.url,
    doi: item.doi,
    arxiv: item.arxivId,
    venue: item.venue,
    published: item.publishedAt,
    captured: item.fetchedAt,
    topics: context.topicLabels ?? [],
    tags: ['cortex/research', ...(context.userTags ?? []).map((t) => slugify(t))],
    relevance: context.relevance ?? null,
    ai_engine: context.summaries?.[0]?.engine ?? 'none',
  };
}

export function renderItemNote(item: InfoItem, context: ItemNoteContext = {}): string {
  const lines: string[] = [`# ${item.title}`, ''];

  if (item.authors.length) lines.push(`**Authors:** ${item.authors.join(', ')}`, '');
  lines.push(`**Source:** [${hostOf(item.canonicalUrl ?? item.url)}](${item.canonicalUrl ?? item.url})`);
  if (item.doi) lines.push(`**DOI:** [${item.doi}](https://doi.org/${item.doi})`);
  if (context.reason) lines.push('', `> Surfaced because ${context.reason}`);

  for (const summary of context.summaries ?? []) {
    lines.push('', `## ${summaryHeading(summary.style)}`, '', summary.text.trim());
  }

  if ((context.summaries ?? []).length) {
    const engine = context.summaries?.[0]?.engine;
    lines.push(
      '',
      engine === 'afm'
        ? '*Summaries generated on device with Apple Foundation Models. Nothing was sent to a server.*'
        : '*Summaries generated by the built-in extractive fallback (no on-device model was available).*',
    );
  }

  if (item.summaryRaw) lines.push('', '## Original abstract', '', item.summaryRaw.trim());

  lines.push('', '## My notes', '', context.userNotes?.trim() ?? '');
  return renderNote(itemFrontmatter(item, context), lines.join('\n'));
}

function summaryHeading(style: string): string {
  return (
    {
      tldr: 'TL;DR',
      key_points: 'Key points',
      implications: 'Practical implications',
      eli5: 'In plain language',
      methodology: 'Methodology',
      actions: 'Actionable takeaways',
    }[style] ?? 'Summary'
  );
}

export function renderDigestNote(digest: Digest, headline?: string | null): string {
  const frontmatter: Frontmatter = {
    cortex_type: 'digest',
    cortex_id: digest.id,
    cortex_schema: FRONTMATTER_SCHEMA_VERSION,
    period: digest.period,
    window_start: digest.windowStart,
    window_end: digest.windowEnd,
    item_count: digest.itemCount,
    tags: ['cortex/digest', `cortex/digest/${digest.period}`],
  };

  const lines: string[] = [`# ${headline ?? digest.headline ?? 'Digest'}`, ''];
  if (digest.entries.length === 0) {
    lines.push('_Nothing crossed the relevance threshold in this window._');
  }
  for (const entry of digest.entries) {
    lines.push(`## [${entry.title}](${entry.url})`, '');
    if (entry.topicLabels.length) lines.push(`Topics: ${entry.topicLabels.map((t) => `#${slugify(t)}`).join(' ')}`);
    lines.push(`Relevance: ${Math.round(entry.score * 100)}%`);
    if (entry.reason) lines.push('', `> ${entry.reason}`);
    if (entry.summary) lines.push('', entry.summary.trim());
    lines.push('');
  }
  return renderNote(frontmatter, lines.join('\n'));
}

export function renderEventNote(event: CalendarEvent, linkedTask?: Task | null): string {
  const frontmatter: Frontmatter = {
    cortex_type: 'event',
    cortex_id: event.id,
    cortex_schema: FRONTMATTER_SCHEMA_VERSION,
    title: event.title,
    start: event.startAt,
    end: event.endAt,
    all_day: event.allDay,
    location: event.location,
    attendees: event.attendeeCount,
    link: event.htmlLink,
    tags: ['cortex/calendar'],
  };
  const lines = [`# ${event.title}`, ''];
  if (event.location) lines.push(`**Where:** ${event.location}`, '');
  if (event.description) lines.push(event.description.trim(), '');
  if (linkedTask) lines.push(`Linked task: [[${taskNoteName(linkedTask)}]]`, '');
  lines.push('## Notes', '');
  return renderNote(frontmatter, lines.join('\n'));
}

/** Daily note section Cortex owns; merged into an existing note by `sync.ts`. */
export const DAILY_SECTION_START = '<!-- cortex:start -->';
export const DAILY_SECTION_END = '<!-- cortex:end -->';

export function renderDailySection(input: {
  day: Date;
  tasks: Task[];
  events: CalendarEvent[];
  digestHeadline?: string | null;
}): string {
  const lines = [DAILY_SECTION_START, '', '## Cortex', ''];

  if (input.events.length) {
    lines.push('### Schedule', '');
    for (const event of [...input.events].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
      const start = new Date(event.startAt).toISOString().slice(11, 16);
      const end = new Date(event.endAt).toISOString().slice(11, 16);
      lines.push(`- ${event.allDay ? 'all day' : `${start}-${end}`} ${event.title}`);
    }
    lines.push('');
  }

  lines.push('### Tasks', '');
  if (input.tasks.length === 0) lines.push('- _No tasks due._');
  for (const task of input.tasks) lines.push(taskLine(task));

  if (input.digestHeadline) lines.push('', '### Research', '', `- ${input.digestHeadline}`);

  lines.push('', DAILY_SECTION_END);
  return lines.join('\n');
}

/** Replace (or append) the Cortex-owned block inside a daily note. */
export function upsertDailySection(existing: string, section: string): string {
  const start = existing.indexOf(DAILY_SECTION_START);
  const end = existing.indexOf(DAILY_SECTION_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${section}${existing.slice(end + DAILY_SECTION_END.length)}`;
  }
  return `${existing.trimEnd()}\n\n${section}\n`;
}

export function taskNoteName(task: Pick<Task, 'title' | 'id'>): string {
  return `${slugify(task.title, 60)}-${task.id.slice(0, 8)}`;
}

export function itemNoteName(item: Pick<InfoItem, 'title' | 'id'>): string {
  return `${slugify(item.title, 60)}-${item.id.slice(0, 8)}`;
}

export function vaultPathFor(
  vault: Pick<VaultConfig, 'folders'>,
  entity:
    | { type: 'task'; task: Pick<Task, 'title' | 'id'> }
    | { type: 'item'; item: Pick<InfoItem, 'title' | 'id'> }
    | { type: 'digest'; digest: Pick<Digest, 'period' | 'windowStart'> }
    | { type: 'event'; event: Pick<CalendarEvent, 'title' | 'id'> }
    | { type: 'daily'; day: Date },
): string {
  switch (entity.type) {
    case 'task':
      return `${vault.folders.tasks}/${taskNoteName(entity.task)}.md`;
    case 'item':
      return `${vault.folders.items}/${itemNoteName(entity.item)}.md`;
    case 'digest':
      return `${vault.folders.digests}/${dateKey(new Date(entity.digest.windowStart))}-${entity.digest.period}.md`;
    case 'event':
      return `${vault.folders.events}/${slugify(entity.event.title, 60)}-${entity.event.id.slice(0, 8)}.md`;
    case 'daily':
      return `${vault.folders.dailyNotes}/${dateKey(entity.day)}.md`;
  }
}

const TASK_LINE_RE = /^\s*-\s*\[( |x|X|-|\/)\]\s*(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const TAG_RE = /(?:^|\s)#([\w/-]+)/g;
/** Every date field, so a hand-edited line with duplicates still cleans up. */
const ALL_DATE_FIELDS_RE = /[📅🛫✅⏳➕]\s*\d{4}-\d{2}-\d{2}/g;

export interface ParsedTaskLine {
  title: string;
  status: 'todo' | 'done' | 'cancelled' | 'in_progress';
  due: string | null;
  start: string | null;
  completed: string | null;
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  tags: string[];
  recurrence: string | null;
}

/** Parse one Obsidian Tasks line back into structured fields. */
export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_RE.exec(line);
  if (!match) return null;
  const marker = match[1] ?? ' ';
  const rest = match[2] ?? '';

  const status = marker === 'x' || marker === 'X' ? 'done' : marker === '-' ? 'cancelled' : marker === '/' ? 'in_progress' : 'todo';
  const priority = rest.includes('⏫') ? 'p1' : rest.includes('🔼') ? 'p2' : rest.includes('🔽') ? 'p4' : 'p3';
  const tags = [...rest.matchAll(TAG_RE)].map((m) => m[1] ?? '').filter(Boolean);
  const recurrence = /🔁\s*([^📅🛫✅#⏫🔼🔽]+)/.exec(rest)?.[1]?.trim() ?? null;

  const title = rest
    .replace(ALL_DATE_FIELDS_RE, '')
    .replace(/🔁\s*[^📅🛫✅#⏫🔼🔽]+/g, '')
    .replace(TAG_RE, ' ')
    .replace(/[⏫🔼🔽]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    title,
    status,
    due: DUE_RE.exec(rest)?.[1] ?? null,
    start: START_RE.exec(rest)?.[1] ?? null,
    completed: DONE_RE.exec(rest)?.[1] ?? null,
    priority,
    tags,
    recurrence,
  };
}

/** Read a Cortex note back into the fields the API accepts. */
export function parseCortexNote(source: string): {
  type: string | null;
  id: string | null;
  frontmatter: Frontmatter;
  body: string;
  taskLines: ParsedTaskLine[];
  tags: string[];
} {
  const { frontmatter, body } = parseNote(source);
  const taskLines: ParsedTaskLine[] = [];
  for (const line of body.split('\n')) {
    const parsed = parseTaskLine(line);
    if (parsed) taskLines.push(parsed);
  }
  return {
    type: typeof frontmatter['cortex_type'] === 'string' ? (frontmatter['cortex_type'] as string) : null,
    id: typeof frontmatter['cortex_id'] === 'string' ? (frontmatter['cortex_id'] as string) : null,
    frontmatter,
    body,
    taskLines,
    tags: asStringArray(frontmatter['tags']),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
