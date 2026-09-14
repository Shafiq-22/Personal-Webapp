import { z } from 'zod';
import { EnergyLevel, isoDateTime, Origin, Priority, TaskStatus, uuid } from './primitives.js';

export const Task = z.object({
  id: uuid,
  userId: uuid,
  projectId: uuid.nullable().default(null),
  parentTaskId: uuid.nullable().default(null),
  title: z.string().min(1).max(500),
  notes: z.string().max(20_000).nullable().default(null),
  status: TaskStatus.default('todo'),
  priority: Priority.default('p3'),
  energy: EnergyLevel.nullable().default(null),
  /** All-day tasks carry a date-only due value; `dueAt` is then midnight UTC. */
  dueAt: isoDateTime.nullable().default(null),
  dueAllDay: z.boolean().default(false),
  startAt: isoDateTime.nullable().default(null),
  /** Estimated effort in minutes - drives time-block sizing. */
  estimateMinutes: z.number().int().min(5).max(600).nullable().default(null),
  /** RFC 5545 subset, see schedule/recurrence.ts. */
  recurrenceRule: z.string().max(300).nullable().default(null),
  recurrenceAnchor: isoDateTime.nullable().default(null),
  completedAt: isoDateTime.nullable().default(null),
  sortOrder: z.number().int().default(0),
  origin: Origin.default('manual'),
  /** Raw text when the task was captured in natural language. */
  captureText: z.string().max(2000).nullable().default(null),
  /** Information item this task was created from, when applicable. */
  sourceItemId: uuid.nullable().default(null),
  tagIds: z.array(uuid).default([]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Task = z.infer<typeof Task>;

export const TaskInput = Task.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).partial().extend({ title: z.string().min(1).max(500) });
export type TaskInput = z.infer<typeof TaskInput>;

export const TaskPatch = TaskInput.partial();
export type TaskPatch = z.infer<typeof TaskPatch>;

export const isOpen = (t: Pick<Task, 'status'>): boolean => t.status === 'todo' || t.status === 'in_progress';

export function isOverdue(t: Pick<Task, 'status' | 'dueAt'>, now: Date = new Date()): boolean {
  if (!isOpen(t) || !t.dueAt) return false;
  return Date.parse(t.dueAt) < now.getTime();
}

/** Depth-first ordering of a task tree, parents before children. */
export function buildTaskTree(tasks: Task[]): Array<{ task: Task; depth: number }> {
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentTaskId ?? null;
    const bucket = children.get(key);
    if (bucket) bucket.push(t);
    else children.set(key, [t]);
  }
  for (const bucket of children.values()) {
    bucket.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }
  const known = new Set(tasks.map((t) => t.id));
  const out: Array<{ task: Task; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const task of children.get(parentId) ?? []) {
      out.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent filtered out of this page) still need to render.
  for (const t of tasks) {
    if (t.parentTaskId && !known.has(t.parentTaskId) && !out.some((o) => o.task.id === t.id)) {
      out.push({ task: t, depth: 0 });
    }
  }
  return out;
}

/** Progress of a parent task derived from its direct subtasks. */
export function subtaskProgress(tasks: Task[], parentId: string): { done: number; total: number } {
  const subs = tasks.filter((t) => t.parentTaskId === parentId);
  return { done: subs.filter((t) => t.status === 'done').length, total: subs.length };
}
