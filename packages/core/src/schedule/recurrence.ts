import { addDays, startOfDay } from '../util/date.js';
import { err, ok, type Result } from '../util/result.js';

/**
 * RFC 5545 RRULE subset.
 *
 * Supported: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL, BYDAY (weekly),
 * BYMONTHDAY (monthly), COUNT, UNTIL. That covers everything the capture
 * grammar can produce and everything Google Calendar sends back for the
 * recurring events Cortex mirrors.
 */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay: number[]; // ISO weekdays 1-7
  byMonthDay: number[];
  count: number | null;
  until: Date | null;
}

const DAY_CODES: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const DAY_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function parseRRule(rule: string): Result<RecurrenceRule> {
  const body = rule.trim().replace(/^RRULE:/i, '');
  if (!body) return err('empty recurrence rule');

  const parsed: RecurrenceRule = { freq: 'DAILY', interval: 1, byDay: [], byMonthDay: [], count: null, until: null };
  let sawFreq = false;

  for (const part of body.split(';')) {
    if (!part) continue;
    const [rawKey, rawValue] = part.split('=');
    const key = (rawKey ?? '').trim().toUpperCase();
    const value = (rawValue ?? '').trim();
    if (!key || !value) continue;
    switch (key) {
      case 'FREQ': {
        const freq = value.toUpperCase();
        if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
          return err(`unsupported FREQ: ${freq}`);
        }
        parsed.freq = freq;
        sawFreq = true;
        break;
      }
      case 'INTERVAL': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 366) return err(`invalid INTERVAL: ${value}`);
        parsed.interval = n;
        break;
      }
      case 'BYDAY': {
        for (const code of value.toUpperCase().split(',')) {
          const day = DAY_CODES[code.replace(/^[+-]?\d/, '')];
          if (!day) return err(`invalid BYDAY: ${code}`);
          parsed.byDay.push(day);
        }
        break;
      }
      case 'BYMONTHDAY': {
        for (const raw of value.split(',')) {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > 31) return err(`invalid BYMONTHDAY: ${raw}`);
          parsed.byMonthDay.push(n);
        }
        break;
      }
      case 'COUNT': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 1000) return err(`invalid COUNT: ${value}`);
        parsed.count = n;
        break;
      }
      case 'UNTIL': {
        const iso = value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59Z` : value;
        const d = new Date(iso.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
        if (Number.isNaN(d.getTime())) return err(`invalid UNTIL: ${value}`);
        parsed.until = d;
        break;
      }
      default:
        break; // unknown parts are ignored, not fatal
    }
  }

  if (!sawFreq) return err('recurrence rule is missing FREQ');
  parsed.byDay.sort((a, b) => a - b);
  return ok(parsed);
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
  if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.map((d) => DAY_NAMES[d - 1]).join(',')}`);
  if (rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  return parts.join(';');
}

function isoWeekdayOf(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Expand occurrences from `anchor`, returning at most `limit` instants that
 * fall inside [from, to]. Time-of-day is preserved from the anchor.
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  anchor: Date,
  from: Date,
  to: Date,
  limit = 200,
): Date[] {
  const out: Date[] = [];
  const hard = Math.min(limit, 1000);
  const hours = anchor.getUTCHours();
  const minutes = anchor.getUTCMinutes();
  const stopAt = rule.until && rule.until.getTime() < to.getTime() ? rule.until : to;

  // COUNT is counted from the anchor, not from the requested window, so a
  // narrow window never resurrects occurrences past the end of the series.
  let emitted = 0;
  const push = (d: Date): boolean => {
    if (d.getTime() < anchor.getTime()) return true;
    if (d.getTime() > stopAt.getTime()) return false;
    if (rule.count !== null && emitted >= rule.count) return false;
    emitted += 1;
    if (d.getTime() >= from.getTime()) out.push(new Date(d));
    return out.length < hard && (rule.count === null || emitted < rule.count);
  };

  const withTime = (d: Date): Date => {
    const c = startOfDay(d);
    c.setUTCHours(hours, minutes, 0, 0);
    return c;
  };

  if (rule.freq === 'DAILY') {
    let cursor = startOfDay(anchor);
    let guard = 0;
    while (guard++ < 4000) {
      if (!push(withTime(cursor))) break;
      cursor = addDays(cursor, rule.interval);
      if (cursor.getTime() > stopAt.getTime()) break;
    }
    return out;
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay : [isoWeekdayOf(anchor)];
    // Walk week by week from the anchor's week start.
    let weekStart = addDays(startOfDay(anchor), -(isoWeekdayOf(anchor) - 1));
    let guard = 0;
    outer: while (guard++ < 600) {
      for (const day of days) {
        const occurrence = withTime(addDays(weekStart, day - 1));
        if (occurrence.getTime() > stopAt.getTime()) break outer;
        if (!push(occurrence)) break outer;
      }
      weekStart = addDays(weekStart, 7 * rule.interval);
      if (weekStart.getTime() > stopAt.getTime()) break;
    }
    return out;
  }

  const monthDays = rule.byMonthDay.length ? rule.byMonthDay : [anchor.getUTCDate()];
  const step = rule.freq === 'MONTHLY' ? rule.interval : rule.interval * 12;
  let year = anchor.getUTCFullYear();
  let month = anchor.getUTCMonth();
  let guard = 0;
  outer: while (guard++ < 600) {
    for (const day of monthDays) {
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      if (day > daysInMonth) continue;
      const occurrence = new Date(Date.UTC(year, month, day, hours, minutes));
      if (occurrence.getTime() > stopAt.getTime()) break outer;
      if (!push(occurrence)) break outer;
    }
    month += step;
    year += Math.floor(month / 12);
    month %= 12;
    if (new Date(Date.UTC(year, month, 1)).getTime() > stopAt.getTime()) break;
  }
  return out;
}

/** The next occurrence strictly after `after`, or null when the series ended. */
export function nextOccurrence(ruleText: string, anchor: Date, after: Date): Date | null {
  const parsed = parseRRule(ruleText);
  if (!parsed.ok) return null;
  const horizon = new Date(after.getTime() + 366 * 24 * 3600 * 1000);
  const occurrences = expandOccurrences(parsed.value, anchor, new Date(after.getTime() + 1), horizon, 5);
  return occurrences[0] ?? null;
}

/**
 * Completing a recurring task rolls it forward instead of closing it.
 * Returns the new due instant, or null when the series is finished.
 */
export function rollForward(
  task: { dueAt: string | null; recurrenceRule: string | null; recurrenceAnchor: string | null },
  completedAt: Date = new Date(),
): Date | null {
  if (!task.recurrenceRule) return null;
  const anchor = task.recurrenceAnchor ? new Date(task.recurrenceAnchor) : task.dueAt ? new Date(task.dueAt) : completedAt;
  const from = task.dueAt ? new Date(Math.max(Date.parse(task.dueAt), completedAt.getTime() - 1)) : completedAt;
  return nextOccurrence(task.recurrenceRule, anchor, from);
}

/** Human-readable rule text for the UI and for Obsidian frontmatter. */
export function describeRRule(ruleText: string): string {
  const parsed = parseRRule(ruleText);
  if (!parsed.ok) return ruleText;
  const r = parsed.value;
  const every = r.interval === 1 ? 'every' : `every ${r.interval}`;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  const plural = r.interval === 1 ? unit : `${unit}s`;
  if (r.freq === 'WEEKLY' && r.byDay.length) {
    const names = r.byDay.map((d) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d - 1]);
    const isWeekdays = r.byDay.length === 5 && r.byDay.every((d) => d <= 5);
    if (isWeekdays && r.interval === 1) return 'every weekday';
    return `${every} ${plural} on ${names.join(', ')}`;
  }
  return `${every} ${plural}`;
}
