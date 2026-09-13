import type { Habit, HabitEntry, Task, TimeBlock } from './domain/index.js';
import { computeStreak } from './domain/habit.js';
import { DAY_MS, dateKey, addDays, minutesBetween, startOfIsoWeek } from './util/date.js';

export interface CompletionPoint {
  day: string;
  created: number;
  completed: number;
}

export interface ProductivityStats {
  openCount: number;
  completedCount: number;
  overdueCount: number;
  completedThisWeek: number;
  completedLastWeek: number;
  weekOverWeekDelta: number;
  /** Median hours between creation and completion. */
  medianCycleHours: number | null;
  onTimeRate: number | null;
  byPriority: Record<string, { open: number; completed: number }>;
  byProject: Array<{ projectId: string | null; open: number; completed: number }>;
  series: CompletionPoint[];
  focusMinutesScheduled: number;
  focusMinutesCompleted: number;
}

/** Everything the analytics dashboard needs, computed in one pass. */
export function computeProductivityStats(
  tasks: Task[],
  options: { now?: Date; days?: number; timeBlocks?: TimeBlock[] } = {},
): ProductivityStats {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  const windowStart = new Date(now.getTime() - days * DAY_MS);

  const series = new Map<string, CompletionPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKey(addDays(now, -i));
    series.set(key, { day: key, created: 0, completed: 0 });
  }

  const byPriority: ProductivityStats['byPriority'] = {};
  const projectTotals = new Map<string | null, { open: number; completed: number }>();
  const cycleTimes: number[] = [];
  let onTime = 0;
  let withDueAndDone = 0;
  let openCount = 0;
  let completedCount = 0;
  let overdueCount = 0;

  const thisWeekStart = startOfIsoWeek(now);
  const lastWeekStart = addDays(thisWeekStart, -7);
  let completedThisWeek = 0;
  let completedLastWeek = 0;

  for (const task of tasks) {
    const priority = (byPriority[task.priority] ??= { open: 0, completed: 0 });
    const project = projectTotals.get(task.projectId) ?? { open: 0, completed: 0 };

    const createdKey = dateKey(new Date(task.createdAt));
    const createdPoint = series.get(createdKey);
    if (createdPoint) createdPoint.created += 1;

    if (task.status === 'done' && task.completedAt) {
      completedCount += 1;
      priority.completed += 1;
      project.completed += 1;
      const completedAt = new Date(task.completedAt);
      const point = series.get(dateKey(completedAt));
      if (point) point.completed += 1;
      if (completedAt >= thisWeekStart) completedThisWeek += 1;
      else if (completedAt >= lastWeekStart) completedLastWeek += 1;
      if (completedAt >= windowStart) {
        cycleTimes.push((completedAt.getTime() - Date.parse(task.createdAt)) / 3_600_000);
      }
      if (task.dueAt) {
        withDueAndDone += 1;
        if (completedAt.getTime() <= Date.parse(task.dueAt)) onTime += 1;
      }
    } else if (task.status === 'todo' || task.status === 'in_progress') {
      openCount += 1;
      priority.open += 1;
      project.open += 1;
      if (task.dueAt && Date.parse(task.dueAt) < now.getTime()) overdueCount += 1;
    }

    projectTotals.set(task.projectId, project);
  }

  const blocks = options.timeBlocks ?? [];
  const focusMinutesScheduled = blocks
    .filter((b) => b.status === 'approved' || b.status === 'completed')
    .reduce((sum, b) => sum + minutesBetween(new Date(b.startAt), new Date(b.endAt)), 0);
  const focusMinutesCompleted = blocks
    .filter((b) => b.status === 'completed')
    .reduce((sum, b) => sum + minutesBetween(new Date(b.startAt), new Date(b.endAt)), 0);

  return {
    openCount,
    completedCount,
    overdueCount,
    completedThisWeek,
    completedLastWeek,
    weekOverWeekDelta: completedThisWeek - completedLastWeek,
    medianCycleHours: median(cycleTimes),
    onTimeRate: withDueAndDone === 0 ? null : Math.round((onTime / withDueAndDone) * 100) / 100,
    byPriority,
    byProject: [...projectTotals.entries()]
      .map(([projectId, totals]) => ({ projectId, ...totals }))
      .sort((a, b) => b.open + b.completed - (a.open + a.completed)),
    series: [...series.values()],
    focusMinutesScheduled,
    focusMinutesCompleted,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return Math.round(value * 10) / 10;
}

export interface WeeklyReview {
  windowStart: string;
  windowEnd: string;
  completed: Task[];
  slipped: Task[];
  stale: Task[];
  upcoming: Task[];
  habitStreaks: Array<{ habitId: string; name: string; current: number; longest: number; completionRate: number }>;
  suggestions: string[];
}

/**
 * The guided Weekly Review: what got done, what slipped, what has gone stale,
 * and what is coming. The suggestions here are rule-based; on iOS, AFM turns
 * the same inputs into prose and proposes concrete next actions.
 */
export function buildWeeklyReview(
  tasks: Task[],
  habits: Habit[],
  habitEntries: HabitEntry[],
  options: { now?: Date } = {},
): WeeklyReview {
  const now = options.now ?? new Date();
  const windowStart = startOfIsoWeek(now);
  const windowEnd = addDays(windowStart, 7);

  const completed = tasks.filter(
    (t) => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= windowStart,
  );
  const slipped = tasks.filter(
    (t) => (t.status === 'todo' || t.status === 'in_progress') && t.dueAt && Date.parse(t.dueAt) < now.getTime(),
  );
  const stale = tasks.filter(
    (t) =>
      (t.status === 'todo' || t.status === 'in_progress') &&
      now.getTime() - Date.parse(t.updatedAt) > 21 * DAY_MS,
  );
  const upcoming = tasks
    .filter((t) => (t.status === 'todo' || t.status === 'in_progress') && t.dueAt && Date.parse(t.dueAt) >= now.getTime() && Date.parse(t.dueAt) < windowEnd.getTime() + 7 * DAY_MS)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));

  const habitStreaks = habits
    .filter((h) => !h.archived)
    .map((habit) => {
      const streak = computeStreak(habit, habitEntries.filter((e) => e.habitId === habit.id), now);
      return {
        habitId: habit.id,
        name: habit.name,
        current: streak.current,
        longest: streak.longest,
        completionRate: streak.completionRate,
      };
    });

  const suggestions: string[] = [];
  if (slipped.length >= 5) {
    suggestions.push(`${slipped.length} tasks are past due. Reschedule or drop the bottom half before adding anything new.`);
  }
  if (stale.length) {
    suggestions.push(`${stale.length} task${stale.length === 1 ? ' has' : 's have'} not moved in three weeks - archive or break them down.`);
  }
  const strugglingHabit = habitStreaks.find((h) => h.completionRate < 0.5);
  if (strugglingHabit) {
    suggestions.push(`"${strugglingHabit.name}" is at ${Math.round(strugglingHabit.completionRate * 100)}% - shrink the commitment or protect a calendar block for it.`);
  }
  if (completed.length === 0) {
    suggestions.push('Nothing was completed this week. Pick the single smallest open task and finish it today.');
  }
  if (upcoming.length > 12) {
    suggestions.push(`${upcoming.length} tasks are due in the next fortnight - that is more than a normal week absorbs.`);
  }

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    completed,
    slipped,
    stale,
    upcoming,
    habitStreaks,
    suggestions,
  };
}
