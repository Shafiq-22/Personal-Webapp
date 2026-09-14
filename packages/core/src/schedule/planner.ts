import type { EnergyLevel, Task } from '../domain/index.js';
import { PRIORITY_WEIGHT } from '../domain/primitives.js';
import type { BusyInterval, TimeBlock } from '../domain/calendar.js';
import type { SchedulingSettings } from '../domain/settings.js';
import { DAY_MS, MINUTE_MS, addMinutes, minutesBetween } from '../util/date.js';
import { randomId } from '../util/id.js';
import { chunkSlot, findFreeSlots, type FreeSlot } from './free-slots.js';

export interface TaskScore {
  taskId: string;
  score: number;
  reasons: string[];
}

export interface PrioritizeOptions {
  now?: Date;
  /** Tasks blocked by an unfinished dependency sink to the bottom. */
  blockedTaskIds?: Set<string>;
}

/**
 * Deterministic priority scoring.
 *
 * Signals: explicit priority, due proximity (with overdue boost), estimated
 * effort (small wins surface), staleness, and whether the task is a subtask of
 * something already in flight. Apple Foundation Models re-ranks the top slice
 * of this list on device with real context; without AFM the ordering here is
 * what the user sees, and it is good enough to be useful on its own.
 */
export function prioritizeTasks(tasks: Task[], options: PrioritizeOptions = {}): TaskScore[] {
  const now = options.now ?? new Date();
  const blocked = options.blockedTaskIds ?? new Set<string>();

  return tasks
    .map((task) => {
      const reasons: string[] = [];
      let score = PRIORITY_WEIGHT[task.priority] * 0.35;
      reasons.push(`priority ${task.priority.toUpperCase()}`);

      if (task.dueAt) {
        const hoursOut = (Date.parse(task.dueAt) - now.getTime()) / 3_600_000;
        if (hoursOut < 0) {
          score += 0.35;
          reasons.push(`overdue by ${Math.round(-hoursOut)}h`);
        } else if (hoursOut <= 24) {
          score += 0.3;
          reasons.push('due within 24h');
        } else if (hoursOut <= 72) {
          score += 0.18;
          reasons.push('due within 3 days');
        } else if (hoursOut <= 24 * 7) {
          score += 0.08;
          reasons.push('due this week');
        }
      }

      if (task.status === 'in_progress') {
        score += 0.12;
        reasons.push('already in progress');
      }

      if (task.estimateMinutes !== null && task.estimateMinutes <= 15) {
        score += 0.06;
        reasons.push('quick win');
      }

      const ageDays = (now.getTime() - Date.parse(task.createdAt)) / DAY_MS;
      if (ageDays > 14) {
        score += 0.05;
        reasons.push(`open for ${Math.round(ageDays)} days`);
      }

      // A blocked task cannot be worked on at all, so it is damped rather than
      // merely penalised - otherwise an overdue p1 that nobody can start still
      // outranks work the user could actually finish today.
      if (blocked.has(task.id)) {
        score *= 0.15;
        reasons.push('blocked by an unfinished dependency');
      }

      return { taskId: task.id, score: Math.max(0, Math.min(1, score)), reasons };
    })
    .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
}

export interface PlanDayOptions {
  now?: Date;
  /** How many tasks the day plan should contain. */
  limit?: number;
  capacityMinutes?: number;
}

export interface DayPlan {
  focus: Task[];
  quickWins: Task[];
  deferred: Task[];
  plannedMinutes: number;
  capacityMinutes: number;
  overCommitted: boolean;
}

/** "Plan my Day": pick a realistic set of tasks for the available capacity. */
export function planDay(tasks: Task[], options: PlanDayOptions = {}): DayPlan {
  const { limit = 6, capacityMinutes = 240 } = options;
  const scored = prioritizeTasks(tasks, options.now ? { now: options.now } : {});
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const focus: Task[] = [];
  const quickWins: Task[] = [];
  const deferred: Task[] = [];
  let planned = 0;

  for (const { taskId } of scored) {
    const task = byId.get(taskId);
    if (!task) continue;
    const estimate = task.estimateMinutes ?? 30;
    if (estimate <= 15 && quickWins.length < 3) {
      quickWins.push(task);
      planned += estimate;
      continue;
    }
    if (focus.length < limit && planned + estimate <= capacityMinutes) {
      focus.push(task);
      planned += estimate;
    } else {
      deferred.push(task);
    }
  }

  return {
    focus,
    quickWins,
    deferred,
    plannedMinutes: planned,
    capacityMinutes,
    overCommitted: planned > capacityMinutes,
  };
}

export interface ProposeBlocksOptions {
  from: Date;
  to: Date;
  busy: BusyInterval[];
  settings: SchedulingSettings;
  offsetMinutes?: number;
  now?: Date;
  userId: string;
  maxBlocks?: number;
}

const ENERGY_WINDOW: Record<EnergyLevel, [number, number]> = {
  high: [8, 12],
  medium: [12, 16],
  low: [16, 20],
};

function slotFitsEnergy(slot: FreeSlot, energy: EnergyLevel | null, offsetMinutes: number): boolean {
  if (!energy) return true;
  const localHour = new Date(slot.start.getTime() + offsetMinutes * MINUTE_MS).getUTCHours();
  const [lo, hi] = ENERGY_WINDOW[energy];
  return localHour >= lo && localHour < hi;
}

/**
 * Greedy time-block proposal.
 *
 * Blocks are always created as `proposed`; nothing reaches Google Calendar
 * until the user approves. `rationale` is stored verbatim and shown in the UI,
 * which is how the "transparent AI decisions" requirement is met even for the
 * non-AI path.
 */
export function proposeTimeBlocks(tasks: Task[], options: ProposeBlocksOptions): TimeBlock[] {
  const { from, to, busy, settings, offsetMinutes = 0, userId, maxBlocks = 8 } = options;
  const now = options.now ?? new Date();

  const slots = findFreeSlots(busy, {
    from,
    to,
    workingHours: settings.workingHours,
    offsetMinutes,
    bufferMinutes: settings.bufferMinutes,
    minimumMinutes: settings.minBlockMinutes,
    notBefore: now,
  });

  const remaining = slots.map((s) => ({ ...s }));
  const ranked = prioritizeTasks(tasks, { now });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blocks: TimeBlock[] = [];

  for (const { taskId, reasons, score } of ranked) {
    if (blocks.length >= maxBlocks) break;
    const task = byId.get(taskId);
    if (!task) continue;

    const wanted = Math.min(
      Math.max(task.estimateMinutes ?? settings.minBlockMinutes, settings.minBlockMinutes),
      settings.maxBlockMinutes,
    );

    const index = remaining.findIndex(
      (slot) => slot.minutes >= wanted && slotFitsEnergy(slot, task.energy, offsetMinutes) && (!task.dueAt || slot.start.getTime() <= Date.parse(task.dueAt)),
    );
    const fallbackIndex = index >= 0 ? index : remaining.findIndex((slot) => slot.minutes >= wanted);
    if (fallbackIndex < 0) continue;

    const slot = remaining[fallbackIndex] as FreeSlot;
    const start = new Date(slot.start);
    const end = addMinutes(start, wanted);

    const rationale = [
      `Scheduled ${wanted} min for "${task.title}"`,
      reasons.length ? `because ${reasons.slice(0, 3).join(', ')}` : '',
      task.energy ? `and ${task.energy}-energy work suits this part of the day` : '',
      index < 0 ? '(no slot matched the preferred energy window, used the next opening)' : '',
    ]
      .filter(Boolean)
      .join(' ');

    blocks.push({
      id: randomId(),
      userId,
      taskId: task.id,
      habitId: null,
      eventId: null,
      title: task.title,
      kind: 'task',
      status: 'proposed',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      rationale,
      engine: 'heuristic',
      createdAt: now.toISOString(),
    });

    // Consume the slot.
    const consumedEnd = addMinutes(end, settings.bufferMinutes);
    if (minutesBetween(consumedEnd, slot.end) >= settings.minBlockMinutes) {
      remaining[fallbackIndex] = {
        start: consumedEnd,
        end: slot.end,
        minutes: minutesBetween(consumedEnd, slot.end),
        weekday: slot.weekday,
      };
    } else {
      remaining.splice(fallbackIndex, 1);
    }
    void score;
  }

  return blocks;
}

/** Protected habit/focus blocks, placed before task blocks are considered. */
export function proposeHabitBlocks(
  habits: Array<{ id: string; name: string; blockMinutes: number | null; weekdays: number[] }>,
  options: ProposeBlocksOptions,
): TimeBlock[] {
  const { from, to, busy, settings, offsetMinutes = 0, userId } = options;
  const now = options.now ?? new Date();
  if (!settings.protectHabits) return [];

  const slots = findFreeSlots(busy, {
    from,
    to,
    workingHours: settings.workingHours,
    offsetMinutes,
    bufferMinutes: settings.bufferMinutes,
    minimumMinutes: 15,
    notBefore: now,
  });

  const blocks: TimeBlock[] = [];
  const used = new Set<number>();

  for (const habit of habits) {
    const minutes = habit.blockMinutes ?? 30;
    const index = slots.findIndex(
      (slot, i) => !used.has(i) && slot.minutes >= minutes && (habit.weekdays.length === 0 || habit.weekdays.includes(slot.weekday)),
    );
    if (index < 0) continue;
    used.add(index);
    const slot = slots[index] as FreeSlot;
    const [chunk] = chunkSlot(slot, minutes, settings.bufferMinutes);
    if (!chunk) continue;
    blocks.push({
      id: randomId(),
      userId,
      taskId: null,
      habitId: habit.id,
      eventId: null,
      title: habit.name,
      kind: 'habit',
      status: 'proposed',
      startAt: chunk.start.toISOString(),
      endAt: chunk.end.toISOString(),
      rationale: `Protected ${minutes} min for the habit "${habit.name}" in the first free window that matches its cadence`,
      engine: 'heuristic',
      createdAt: now.toISOString(),
    });
  }
  return blocks;
}

/**
 * When the calendar changes underneath approved blocks, work out which ones
 * are now colliding and where they could move to.
 */
export interface ReplanSuggestion {
  block: TimeBlock;
  reason: string;
  proposedStart: string | null;
  proposedEnd: string | null;
}

export function replanBlocks(blocks: TimeBlock[], busy: BusyInterval[], options: ProposeBlocksOptions): ReplanSuggestion[] {
  const { settings, offsetMinutes = 0, from, to } = options;
  const now = options.now ?? new Date();
  const suggestions: ReplanSuggestion[] = [];

  const colliding = blocks.filter((block) => {
    const start = Date.parse(block.startAt);
    const end = Date.parse(block.endAt);
    return busy.some((b) => b.start.getTime() < end && b.end.getTime() > start);
  });
  if (colliding.length === 0) return [];

  const slots = findFreeSlots(busy, {
    from,
    to,
    workingHours: settings.workingHours,
    offsetMinutes,
    bufferMinutes: settings.bufferMinutes,
    minimumMinutes: settings.minBlockMinutes,
    notBefore: now,
  });
  const remaining = slots.map((s) => ({ ...s }));

  for (const block of colliding) {
    const minutes = minutesBetween(new Date(block.startAt), new Date(block.endAt));
    const index = remaining.findIndex((slot) => slot.minutes >= minutes);
    if (index < 0) {
      suggestions.push({
        block,
        reason: 'A new calendar event now covers this block and no free slot of the same length is left in the window',
        proposedStart: null,
        proposedEnd: null,
      });
      continue;
    }
    const slot = remaining[index] as FreeSlot;
    const start = new Date(slot.start);
    const end = addMinutes(start, minutes);
    suggestions.push({
      block,
      reason: 'A new calendar event overlaps this block; this is the next free window of the same length',
      proposedStart: start.toISOString(),
      proposedEnd: end.toISOString(),
    });
    const consumedEnd = addMinutes(end, settings.bufferMinutes);
    if (minutesBetween(consumedEnd, slot.end) >= settings.minBlockMinutes) {
      remaining[index] = { start: consumedEnd, end: slot.end, minutes: minutesBetween(consumedEnd, slot.end), weekday: slot.weekday };
    } else {
      remaining.splice(index, 1);
    }
  }
  return suggestions;
}
