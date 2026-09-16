import type { EnergyLevel, Priority, TaskInput } from '../domain/index.js';
import { parseDateTime, stripSpans, type MatchedSpan } from './datetime.js';

export interface ParsedCapture {
  title: string;
  dueAt: string | null;
  dueAllDay: boolean;
  estimateMinutes: number | null;
  priority: Priority;
  energy: EnergyLevel | null;
  recurrenceRule: string | null;
  /** `#project` - resolved to an id by the caller. */
  projectName: string | null;
  /** `@label` tokens. */
  tagNames: string[];
  /** 0-1, how much structure we actually recognised. */
  confidence: number;
  /** The untouched input, stored on the task for auditability. */
  raw: string;
}

const PRIORITY_RE = /(?:^|\s)(?:!([1-4])|p([1-4]))(?=\s|$)/i;
const PROJECT_RE = /(?:^|\s)#([\p{L}\p{N}_-]{1,60})/u;
const TAG_RE = /(?:^|\s)@([\p{L}\p{N}_-]{1,60})/gu;
const ENERGY_RE = /(?:^|\s)(?:\/(low|medium|high)-?energy|(low|high)\s+energy)(?=\s|$)/i;

export interface ParseCaptureOptions {
  reference?: Date;
  offsetMinutes?: number;
  defaultPriority?: Priority;
  defaultHour?: number;
}

/**
 * Turn one line of natural language into a structured task.
 *
 * Grammar (all parts optional, order-free):
 *   "Draft grant section tomorrow at 9am for 90m #Grant @writing !1 every monday"
 *
 * On iOS this same string is first offered to Apple Foundation Models, which
 * returns the identical shape via a `@Generable` struct. This parser is the
 * deterministic fallback and the web implementation - it never calls out to a
 * network service.
 */
export function parseCapture(input: string, options: ParseCaptureOptions = {}): ParsedCapture {
  const { defaultPriority = 'p3' } = options;
  const raw = input;
  let working = input;
  const consumed: MatchedSpan[] = [];
  let signals = 0;

  let priority: Priority = defaultPriority;
  const pri = PRIORITY_RE.exec(working);
  if (pri) {
    const level = pri[1] ?? pri[2];
    priority = (`p${level}` as Priority);
    consumed.push({ start: pri.index, end: pri.index + pri[0].length });
    signals += 1;
  }

  let projectName: string | null = null;
  const proj = PROJECT_RE.exec(working);
  if (proj?.[1]) {
    projectName = proj[1].replace(/[-_]/g, ' ').trim();
    consumed.push({ start: proj.index, end: proj.index + proj[0].length });
    signals += 1;
  }

  const tagNames: string[] = [];
  for (const m of working.matchAll(TAG_RE)) {
    if (!m[1]) continue;
    tagNames.push(m[1].toLowerCase());
    consumed.push({ start: m.index, end: m.index + m[0].length });
    signals += 1;
  }

  let energy: EnergyLevel | null = null;
  const en = ENERGY_RE.exec(working);
  const energyWord = (en?.[1] ?? en?.[2] ?? '').toLowerCase();
  if (en && (energyWord === 'low' || energyWord === 'medium' || energyWord === 'high')) {
    energy = energyWord;
    consumed.push({ start: en.index, end: en.index + en[0].length });
    signals += 1;
  }

  const when = parseDateTime(working, {
    ...(options.reference ? { reference: options.reference } : {}),
    ...(options.offsetMinutes !== undefined ? { offsetMinutes: options.offsetMinutes } : {}),
    ...(options.defaultHour !== undefined ? { defaultHour: options.defaultHour } : {}),
  });
  if (when) {
    consumed.push(...when.spans);
    signals += 1;
    if (when.recurrence) signals += 1;
    if (when.durationMinutes) signals += 1;
  }

  const title = stripSpans(working, consumed) || raw.trim();

  return {
    title: title.replace(/\s{2,}/g, ' ').trim(),
    dueAt: when ? when.date.toISOString() : null,
    dueAllDay: when ? when.allDay : false,
    estimateMinutes: when?.durationMinutes ?? null,
    priority,
    energy,
    recurrenceRule: when?.recurrence ?? null,
    projectName,
    tagNames,
    confidence: Math.min(1, signals / 4),
    raw,
  };
}

/** Shape the parse result as the API's task payload. */
export function captureToTaskInput(parsed: ParsedCapture): TaskInput {
  return {
    title: parsed.title,
    dueAt: parsed.dueAt,
    dueAllDay: parsed.dueAllDay,
    estimateMinutes: parsed.estimateMinutes,
    priority: parsed.priority,
    energy: parsed.energy,
    recurrenceRule: parsed.recurrenceRule,
    recurrenceAnchor: parsed.recurrenceRule ? parsed.dueAt : null,
    origin: 'nl_capture',
    captureText: parsed.raw,
  };
}

/**
 * Parse a search query the same way, so "overdue p1 #grant" narrows the list.
 * Returns filters plus the leftover free-text terms.
 */
export interface ParsedQuery {
  text: string;
  priority: Priority | null;
  projectName: string | null;
  tagNames: string[];
  dueBefore: string | null;
  overdue: boolean;
  status: 'open' | 'done' | 'all';
}

export function parseQuery(input: string, options: ParseCaptureOptions = {}): ParsedQuery {
  const consumed: MatchedSpan[] = [];
  let overdue = false;
  let status: ParsedQuery['status'] = 'open';

  const overdueMatch = /(?:^|\s)(overdue|late)(?=\s|$)/i.exec(input);
  if (overdueMatch) {
    overdue = true;
    consumed.push({ start: overdueMatch.index, end: overdueMatch.index + overdueMatch[0].length });
  }
  const doneMatch = /(?:^|\s)(done|completed)(?=\s|$)/i.exec(input);
  if (doneMatch) {
    status = 'done';
    consumed.push({ start: doneMatch.index, end: doneMatch.index + doneMatch[0].length });
  }

  const parsed = parseCapture(input, options);
  return {
    text: stripSpans(parsed.title, consumed),
    priority: /!\d|p[1-4]/i.test(input) ? parsed.priority : null,
    projectName: parsed.projectName,
    tagNames: parsed.tagNames,
    dueBefore: parsed.dueAt,
    overdue,
    status,
  };
}
