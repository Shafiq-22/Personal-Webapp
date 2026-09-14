/**
 * Deterministic natural-language date/time parsing.
 *
 * This is the offline, everywhere-available parser. On iPhone the same user
 * input is first handed to Apple Foundation Models, which handles the messy
 * long tail ("the Thursday after the grant deadline"); when AFM is unavailable
 * - or returns nothing usable - the app falls back to exactly this grammar, so
 * behaviour stays predictable across platforms.
 *
 * All arithmetic is done on "local wall clock" components derived from an
 * explicit UTC offset, so results do not depend on the host time zone.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function toLocalParts(date: Date, offsetMinutes: number): LocalParts {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function fromLocalParts(parts: LocalParts, offsetMinutes: number): Date {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return new Date(utc - offsetMinutes * 60_000);
}

export function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function localIsoWeekday(parts: LocalParts): number {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

export const WEEKDAY_NAMES: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
};

export const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

export const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export interface MatchedSpan {
  start: number;
  end: number;
}

export interface DateTimeMatch {
  /** Resolved instant in UTC. */
  date: Date;
  /** True when only a date was given, so the task is due "that day". */
  allDay: boolean;
  spans: MatchedSpan[];
  /** Recognised recurrence, as an RFC 5545 RRULE body. */
  recurrence?: string;
  /** Explicit duration in minutes ("for 45 minutes"). */
  durationMinutes?: number;
}

interface TimeOfDay {
  hour: number;
  minute: number;
  span: MatchedSpan;
}

const TIME_RE =
  /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b|\b(noon|midday|midnight)\b/i;

function matchTime(text: string): TimeOfDay | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  const span = { start: m.index, end: m.index + m[0].length };

  const word = m[8]?.toLowerCase();
  if (word) return { hour: word === 'midnight' ? 0 : 12, minute: 0, span };

  if (m[1]) {
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = (m[3] ?? '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute, span };
  }

  const hour = Number(m[4] ?? m[6]);
  const minute = Number(m[5] ?? m[7]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute, span };
}

const DURATION_RE = /\b(?:for|takes?|approx\.?|about|~)\s*(\d{1,3})\s*(minutes|minute|mins|min|hours|hour|hrs|hr|m|h)\b/i;

export function matchDuration(text: string): { minutes: number; span: MatchedSpan } | null {
  const m = DURATION_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  const minutes = unit.startsWith('h') ? n * 60 : n;
  if (minutes <= 0 || minutes > 24 * 60) return null;
  return { minutes, span: { start: m.index, end: m.index + m[0].length } };
}

const RECURRENCE_PATTERNS: Array<{ re: RegExp; rule: (m: RegExpExecArray) => string | null }> = [
  { re: /\bevery\s+day\b|\bdaily\b/i, rule: () => 'FREQ=DAILY;INTERVAL=1' },
  { re: /\bevery\s+weekday\b|\bweekdays\b/i, rule: () => 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { re: /\bevery\s+other\s+day\b/i, rule: () => 'FREQ=DAILY;INTERVAL=2' },
  { re: /\bevery\s+(\d{1,2})\s+days?\b/i, rule: (m) => `FREQ=DAILY;INTERVAL=${Number(m[1])}` },
  { re: /\bevery\s+(\d{1,2})\s+weeks?\b/i, rule: (m) => `FREQ=WEEKLY;INTERVAL=${Number(m[1])}` },
  { re: /\bevery\s+(\d{1,2})\s+months?\b/i, rule: (m) => `FREQ=MONTHLY;INTERVAL=${Number(m[1])}` },
  {
    re: /\bevery\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
    rule: (m) => {
      const day = WEEKDAY_NAMES[(m[1] ?? '').toLowerCase()];
      return day ? `FREQ=WEEKLY;INTERVAL=1;BYDAY=${RRULE_DAYS[day - 1]}` : null;
    },
  },
  { re: /\bevery\s+week\b|\bweekly\b/i, rule: () => 'FREQ=WEEKLY;INTERVAL=1' },
  { re: /\bevery\s+month\b|\bmonthly\b/i, rule: () => 'FREQ=MONTHLY;INTERVAL=1' },
  { re: /\bevery\s+year\b|\byearly\b|\bannually\b/i, rule: () => 'FREQ=YEARLY;INTERVAL=1' },
];

export function matchRecurrence(text: string): { rule: string; span: MatchedSpan } | null {
  for (const { re, rule } of RECURRENCE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const value = rule(m);
    if (!value) continue;
    return { rule: value, span: { start: m.index, end: m.index + m[0].length } };
  }
  return null;
}

interface DateMatch {
  parts: LocalParts;
  span: MatchedSpan;
  /** A weekday/relative word that implies a time of day, e.g. "tonight". */
  impliedHour?: number;
}

function matchDatePhrase(text: string, ref: LocalParts): DateMatch | null {
  const lower = text.toLowerCase();

  const simple: Array<[RegExp, (m: RegExpExecArray) => DateMatch | null]> = [
    [/\btoday\b/, (m) => ({ parts: ref, span: spanOf(m) })],
    [/\btonight\b/, (m) => ({ parts: ref, span: spanOf(m), impliedHour: 20 })],
    [/\btomorrow\b|\btmr\b|\btmrw\b/, (m) => ({ parts: addLocalDays(ref, 1), span: spanOf(m) })],
    [/\bday after tomorrow\b/, (m) => ({ parts: addLocalDays(ref, 2), span: spanOf(m) })],
    [/\byesterday\b/, (m) => ({ parts: addLocalDays(ref, -1), span: spanOf(m) })],
    [/\bin\s+(\d{1,3})\s*(day|days)\b/, (m) => ({ parts: addLocalDays(ref, Number(m[1])), span: spanOf(m) })],
    [/\bin\s+(\d{1,3})\s*(week|weeks)\b/, (m) => ({ parts: addLocalDays(ref, Number(m[1]) * 7), span: spanOf(m) })],
    [/\bin\s+a\s+week\b/, (m) => ({ parts: addLocalDays(ref, 7), span: spanOf(m) })],
    [/\bnext\s+week\b/, (m) => ({ parts: addLocalDays(ref, 8 - localIsoWeekday(ref)), span: spanOf(m) })],
    [/\bnext\s+month\b/, (m) => ({ parts: { ...ref, month: ref.month === 12 ? 1 : ref.month + 1, year: ref.month === 12 ? ref.year + 1 : ref.year }, span: spanOf(m) })],
    [/\bend of (?:the )?week\b/, (m) => ({ parts: addLocalDays(ref, Math.max(0, 5 - localIsoWeekday(ref))), span: spanOf(m) })],
  ];

  function spanOf(m: RegExpExecArray): MatchedSpan {
    return { start: m.index, end: m.index + m[0].length };
  }

  for (const [re, build] of simple) {
    const m = re.exec(lower);
    if (m) {
      const result = build(m);
      if (result) return result;
    }
  }

  // ISO date: 2026-05-12
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) {
    return {
      parts: { ...ref, year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      span: { start: iso.index, end: iso.index + iso[0].length },
    };
  }

  // "next friday" / "on friday" / bare weekday
  const weekday = /\b(?:(next|this|on|by)\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/.exec(lower);
  if (weekday) {
    const target = WEEKDAY_NAMES[(weekday[2] ?? '').toLowerCase()];
    if (target) {
      const current = localIsoWeekday(ref);
      let delta = (target - current + 7) % 7;
      const qualifier = (weekday[1] ?? '').toLowerCase();
      if (delta === 0) delta = 7; // "friday" on a Friday means next Friday
      if (qualifier === 'next' && delta < 7) delta += 7;
      return { parts: addLocalDays(ref, delta), span: { start: weekday.index, end: weekday.index + weekday[0].length } };
    }
  }

  // "12 may" / "may 12" / "may 12th"
  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/.exec(lower);
  const monthDay = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(lower);
  const md = dayMonth
    ? { day: Number(dayMonth[1]), month: MONTH_NAMES[(dayMonth[2] ?? '').toLowerCase()], match: dayMonth }
    : monthDay
      ? { day: Number(monthDay[2]), month: MONTH_NAMES[(monthDay[1] ?? '').toLowerCase()], match: monthDay }
      : null;
  if (md && md.month && md.day >= 1 && md.day <= 31) {
    const candidate: LocalParts = { ...ref, month: md.month, day: md.day };
    const rolled =
      candidate.month < ref.month || (candidate.month === ref.month && candidate.day < ref.day)
        ? { ...candidate, year: ref.year + 1 }
        : candidate;
    return { parts: rolled, span: { start: md.match.index, end: md.match.index + md.match[0].length } };
  }

  return null;
}

export interface ParseDateTimeOptions {
  reference?: Date;
  /** Minutes to add to UTC to get the user's wall clock (e.g. -420 for PDT). */
  offsetMinutes?: number;
  /** Hour used when a date is given without a time and a time is required. */
  defaultHour?: number;
}

/**
 * Pull a due date/time, recurrence and duration out of free text.
 * Returns `null` when nothing temporal was found.
 */
export function parseDateTime(text: string, options: ParseDateTimeOptions = {}): DateTimeMatch | null {
  const { reference = new Date(), offsetMinutes = 0, defaultHour = 9 } = options;
  const ref = toLocalParts(reference, offsetMinutes);
  const spans: MatchedSpan[] = [];

  const recurrence = matchRecurrence(text);
  if (recurrence) spans.push(recurrence.span);

  const duration = matchDuration(text);
  const time = matchTime(text);
  const dateMatch = matchDatePhrase(text, ref);

  if (!dateMatch && !time && !recurrence) return null;

  let parts: LocalParts = dateMatch ? { ...dateMatch.parts } : { ...ref };
  let allDay = true;

  if (time) {
    parts = { ...parts, hour: time.hour, minute: time.minute };
    allDay = false;
    spans.push(time.span);
    // "at 8am" with no date, already past today -> tomorrow
    if (!dateMatch) {
      const candidate = fromLocalParts(parts, offsetMinutes);
      if (candidate.getTime() <= reference.getTime()) parts = addLocalDays(parts, 1);
    }
  } else if (dateMatch?.impliedHour !== undefined) {
    parts = { ...parts, hour: dateMatch.impliedHour, minute: 0 };
    allDay = false;
  } else {
    parts = { ...parts, hour: defaultHour, minute: 0 };
  }

  if (dateMatch) spans.push(dateMatch.span);
  if (duration) spans.push(duration.span);

  // A bare recurrence ("every monday") anchors on the next matching weekday.
  if (!dateMatch && recurrence) {
    const byDay = /BYDAY=([A-Z,]+)/.exec(recurrence.rule);
    const first = byDay?.[1]?.split(',')[0];
    if (first) {
      const target = RRULE_DAYS.indexOf(first as (typeof RRULE_DAYS)[number]) + 1;
      if (target > 0) {
        const delta = (target - localIsoWeekday(parts) + 7) % 7 || 7;
        parts = addLocalDays(parts, delta);
      }
    }
  }

  const result: DateTimeMatch = {
    date: fromLocalParts(parts, offsetMinutes),
    allDay,
    spans: spans.sort((a, b) => a.start - b.start),
  };
  if (recurrence) result.recurrence = recurrence.rule;
  if (duration) result.durationMinutes = duration.minutes;
  return result;
}

/** Remove matched spans from the original text and tidy the remainder. */
export function stripSpans(text: string, spans: MatchedSpan[]): string {
  if (spans.length === 0) return text.trim();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}
