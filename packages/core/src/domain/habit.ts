import { z } from 'zod';
import { isoDate, isoDateTime, uuid } from './primitives.js';
import { dateKey, addDays } from '../util/date.js';

export const HabitCadence = z.enum(['daily', 'weekly', 'custom']);
export type HabitCadence = z.infer<typeof HabitCadence>;

export const Habit = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().min(1).max(200),
  cadence: HabitCadence.default('daily'),
  /** ISO weekdays (1 = Monday) the habit is expected on. Empty = every day. */
  weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  targetPerPeriod: z.number().int().min(1).max(30).default(1),
  /** Minutes of protected focus time this habit should get on the calendar. */
  blockMinutes: z.number().int().min(5).max(480).nullable().default(null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  archived: z.boolean().default(false),
  createdAt: isoDateTime,
});
export type Habit = z.infer<typeof Habit>;

export const HabitEntry = z.object({
  id: uuid,
  userId: uuid,
  habitId: uuid,
  day: isoDate,
  count: z.number().int().min(0).max(100).default(1),
  note: z.string().max(1000).nullable().default(null),
  createdAt: isoDateTime,
});
export type HabitEntry = z.infer<typeof HabitEntry>;

export interface StreakSummary {
  current: number;
  longest: number;
  completionRate: number;
  lastCompletedOn: string | null;
}

/** Is the habit expected on this day? */
export function isDueOn(habit: Pick<Habit, 'cadence' | 'weekdays'>, day: Date): boolean {
  if (habit.cadence === 'weekly') return true;
  if (habit.weekdays.length === 0) return true;
  const iso = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  return habit.weekdays.includes(iso);
}

/**
 * Streaks count consecutive *expected* days that were logged. Days the habit is
 * not expected on never break a streak.
 */
export function computeStreak(
  habit: Pick<Habit, 'cadence' | 'weekdays' | 'targetPerPeriod'>,
  entries: Array<Pick<HabitEntry, 'day' | 'count'>>,
  today: Date = new Date(),
  window = 365,
): StreakSummary {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.day, (totals.get(e.day) ?? 0) + e.count);

  const met = (day: Date) => (totals.get(dateKey(day)) ?? 0) >= habit.targetPerPeriod;

  let current = 0;
  let longest = 0;
  let running = 0;
  let expected = 0;
  let completed = 0;
  let lastCompletedOn: string | null = null;
  let currentBroken = false;

  for (let i = 0; i < window; i++) {
    const day = addDays(today, -i);
    if (!isDueOn(habit, day)) continue;
    expected += 1;
    if (met(day)) {
      completed += 1;
      running += 1;
      longest = Math.max(longest, running);
      if (!lastCompletedOn) lastCompletedOn = dateKey(day);
      if (!currentBroken) current = running;
    } else {
      // Today not yet logged should not break the streak - only close it.
      if (i === 0) {
        currentBroken = false;
      } else {
        currentBroken = true;
      }
      running = 0;
    }
  }

  return {
    current,
    longest,
    completionRate: expected === 0 ? 0 : Math.round((completed / expected) * 100) / 100,
    lastCompletedOn,
  };
}
