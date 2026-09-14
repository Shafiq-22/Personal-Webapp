/** Date helpers. Everything inside the core is UTC-based ISO-8601 unless noted. */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function toIso(d: Date | string | number): string {
  return new Date(d).toISOString();
}

export function parseIso(value: string | Date | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MINUTE_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Start of the UTC day. */
export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date): Date {
  const c = startOfDay(d);
  c.setUTCHours(23, 59, 59, 999);
  return c;
}

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export function isoWeekday(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfIsoWeek(d: Date): Date {
  return addDays(startOfDay(d), -(isoWeekday(d) - 1));
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** `2026-09-13` - the key used for daily notes and habit entries. */
export function dateKey(d: Date): string {
  return toIso(d).slice(0, 10);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MINUTE_MS);
}

export function clampDate(d: Date, min: Date, max: Date): Date {
  if (d.getTime() < min.getTime()) return new Date(min);
  if (d.getTime() > max.getTime()) return new Date(max);
  return new Date(d);
}

/** Human, locale-free relative label used in digests and note bodies. */
export function relativeLabel(target: Date, now: Date = new Date()): string {
  const diff = target.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const units: Array<[string, number]> = [
    ['day', DAY_MS],
    ['hour', HOUR_MS],
    ['minute', MINUTE_MS],
  ];
  for (const [name, ms] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return past ? `${n} ${name}${n === 1 ? '' : 's'} ago` : `in ${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return past ? 'just now' : 'now';
}
