import type { BusyInterval } from '../domain/calendar.js';
import type { WorkingHours } from '../domain/settings.js';
import { addDays, MINUTE_MS, startOfDay } from '../util/date.js';

export interface FreeSlot {
  start: Date;
  end: Date;
  minutes: number;
  /** ISO weekday of the slot start, in the user's local time. */
  weekday: number;
}

export interface FreeSlotOptions {
  from: Date;
  to: Date;
  workingHours: WorkingHours[];
  /** Minutes to add to UTC to reach the user's wall clock. */
  offsetMinutes?: number;
  /** Padding kept around every busy interval. */
  bufferMinutes?: number;
  /** Slots shorter than this are not returned. */
  minimumMinutes?: number;
  /** Ignore anything that starts before this instant (usually "now"). */
  notBefore?: Date;
}

/** Merge overlapping/adjacent intervals, applying a symmetric buffer. */
export function mergeBusy(busy: BusyInterval[], bufferMinutes = 0): BusyInterval[] {
  const padded = busy
    .filter((b) => b.end.getTime() > b.start.getTime())
    .map((b) => ({
      ...b,
      start: new Date(b.start.getTime() - bufferMinutes * MINUTE_MS),
      end: new Date(b.end.getTime() + bufferMinutes * MINUTE_MS),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: BusyInterval[] = [];
  for (const interval of padded) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Every window the user is theoretically available in, from their working
 * hours, clipped to [from, to].
 */
export function workingWindows(options: FreeSlotOptions): FreeSlot[] {
  const { from, to, workingHours, offsetMinutes = 0 } = options;
  const windows: FreeSlot[] = [];
  const byWeekday = new Map(workingHours.map((w) => [w.weekday, w]));

  // Iterate local days: shift into local space, walk days, shift back.
  let cursor = startOfDay(new Date(from.getTime() + offsetMinutes * MINUTE_MS));
  const localEnd = new Date(to.getTime() + offsetMinutes * MINUTE_MS);
  let guard = 0;

  while (cursor.getTime() <= localEnd.getTime() && guard++ < 400) {
    const isoWeekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    const hours = byWeekday.get(isoWeekday);
    if (hours?.enabled && hours.endMinute > hours.startMinute) {
      const localStart = new Date(cursor.getTime() + hours.startMinute * MINUTE_MS);
      const localFinish = new Date(cursor.getTime() + hours.endMinute * MINUTE_MS);
      const start = new Date(Math.max(localStart.getTime() - offsetMinutes * MINUTE_MS, from.getTime()));
      const end = new Date(Math.min(localFinish.getTime() - offsetMinutes * MINUTE_MS, to.getTime()));
      if (end.getTime() > start.getTime()) {
        windows.push({
          start,
          end,
          minutes: Math.round((end.getTime() - start.getTime()) / MINUTE_MS),
          weekday: isoWeekday,
        });
      }
    }
    cursor = addDays(cursor, 1);
  }
  return windows;
}

/**
 * Subtract busy intervals from the working windows.
 *
 * This is the primitive behind "when could I actually do this?" - the planner
 * and the AFM time-block suggester both start from these slots, so the model
 * never has to reason about raw calendar overlap.
 */
export function findFreeSlots(busy: BusyInterval[], options: FreeSlotOptions): FreeSlot[] {
  const { bufferMinutes = 0, minimumMinutes = 15, notBefore } = options;
  const blocked = mergeBusy(busy, bufferMinutes);
  const slots: FreeSlot[] = [];

  for (const window of workingWindows(options)) {
    let cursor = notBefore && notBefore.getTime() > window.start.getTime() ? new Date(notBefore) : window.start;
    for (const interval of blocked) {
      if (interval.end.getTime() <= cursor.getTime()) continue;
      if (interval.start.getTime() >= window.end.getTime()) break;
      if (interval.start.getTime() > cursor.getTime()) {
        const end = new Date(Math.min(interval.start.getTime(), window.end.getTime()));
        pushSlot(slots, cursor, end, window.weekday, minimumMinutes);
      }
      if (interval.end.getTime() > cursor.getTime()) cursor = new Date(interval.end);
      if (cursor.getTime() >= window.end.getTime()) break;
    }
    if (cursor.getTime() < window.end.getTime()) {
      pushSlot(slots, cursor, window.end, window.weekday, minimumMinutes);
    }
  }
  return slots;
}

function pushSlot(out: FreeSlot[], start: Date, end: Date, weekday: number, minimumMinutes: number): void {
  const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
  if (minutes >= minimumMinutes) out.push({ start: new Date(start), end: new Date(end), minutes, weekday });
}

/** Total available minutes, useful for "is this week realistic?" warnings. */
export function totalFreeMinutes(slots: FreeSlot[]): number {
  return slots.reduce((sum, s) => sum + s.minutes, 0);
}

/** Split a long slot into workable chunks with breaks between them. */
export function chunkSlot(slot: FreeSlot, chunkMinutes: number, breakMinutes = 10): FreeSlot[] {
  const chunks: FreeSlot[] = [];
  let cursor = slot.start.getTime();
  while (cursor + chunkMinutes * MINUTE_MS <= slot.end.getTime()) {
    const start = new Date(cursor);
    const end = new Date(cursor + chunkMinutes * MINUTE_MS);
    chunks.push({ start, end, minutes: chunkMinutes, weekday: slot.weekday });
    cursor = end.getTime() + breakMinutes * MINUTE_MS;
  }
  return chunks;
}
