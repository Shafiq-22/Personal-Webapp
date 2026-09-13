import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/**
 * Four reminder kinds, all delivered by the iOS companion (local notifications)
 * and mirrored as web notifications when the PWA is installed.
 *
 * - `time`        fires at an absolute instant, or relative to the task due date
 * - `location`    fires on arrival/departure at a geofence
 * - `dependency`  fires when a blocking task is completed
 * - `escalating`  re-fires on a widening schedule until the task is acknowledged
 */
export const ReminderKind = z.enum(['time', 'location', 'dependency', 'escalating']);
export type ReminderKind = z.infer<typeof ReminderKind>;

export const GeofenceTrigger = z.enum(['enter', 'exit']);
export type GeofenceTrigger = z.infer<typeof GeofenceTrigger>;

export const EscalationStep = z.object({
  /** Minutes after the previous step (or after `triggerAt` for the first step). */
  afterMinutes: z.number().int().min(1).max(10_080),
  channel: z.enum(['notification', 'critical_alert', 'email']).default('notification'),
});
export type EscalationStep = z.infer<typeof EscalationStep>;

export const Reminder = z
  .object({
    id: uuid,
    userId: uuid,
    taskId: uuid,
    kind: ReminderKind,
    label: z.string().max(200).nullable().default(null),
    triggerAt: isoDateTime.nullable().default(null),
    /** Negative = before the due date. Ignored when `triggerAt` is set. */
    offsetMinutes: z.number().int().min(-20_160).max(20_160).nullable().default(null),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    radiusMeters: z.number().int().min(50).max(50_000).nullable().default(null),
    geofenceTrigger: GeofenceTrigger.nullable().default(null),
    dependsOnTaskId: uuid.nullable().default(null),
    escalationSteps: z.array(EscalationStep).default([]),
    snoozedUntil: isoDateTime.nullable().default(null),
    lastFiredAt: isoDateTime.nullable().default(null),
    acknowledgedAt: isoDateTime.nullable().default(null),
    enabled: z.boolean().default(true),
    createdAt: isoDateTime,
  })
  .superRefine((r, ctx) => {
    if (r.kind === 'time' && !r.triggerAt && r.offsetMinutes === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'time reminders need triggerAt or offsetMinutes' });
    }
    if (r.kind === 'location' && (r.latitude === null || r.longitude === null || r.geofenceTrigger === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'location reminders need a coordinate and a trigger' });
    }
    if (r.kind === 'dependency' && !r.dependsOnTaskId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dependency reminders need dependsOnTaskId' });
    }
    if (r.kind === 'escalating' && r.escalationSteps.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'escalating reminders need at least one step' });
    }
  });
export type Reminder = z.infer<typeof Reminder>;

/** Absolute instants an escalating reminder will fire at, in order. */
export function escalationSchedule(base: Date, steps: EscalationStep[]): Date[] {
  let cursor = base.getTime();
  return steps.map((step) => {
    cursor += step.afterMinutes * 60_000;
    return new Date(cursor);
  });
}

/** Resolve the next firing instant for any reminder kind. */
export function nextFireAt(
  reminder: Pick<Reminder, 'kind' | 'triggerAt' | 'offsetMinutes' | 'snoozedUntil' | 'escalationSteps' | 'enabled'>,
  task: { dueAt: string | null },
  now: Date = new Date(),
): Date | null {
  if (!reminder.enabled) return null;
  if (reminder.snoozedUntil) {
    const snoozed = new Date(reminder.snoozedUntil);
    if (snoozed.getTime() > now.getTime()) return snoozed;
  }
  if (reminder.kind === 'location' || reminder.kind === 'dependency') return null;

  const base = reminder.triggerAt
    ? new Date(reminder.triggerAt)
    : task.dueAt && reminder.offsetMinutes !== null
      ? new Date(Date.parse(task.dueAt) + reminder.offsetMinutes * 60_000)
      : null;
  if (!base) return null;
  if (reminder.kind === 'time') return base;

  for (const at of escalationSchedule(base, reminder.escalationSteps)) {
    if (at.getTime() > now.getTime()) return at;
  }
  return base.getTime() > now.getTime() ? base : null;
}
