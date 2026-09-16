import { z } from 'zod';
import { isoDateTime, Origin, uuid } from './primitives.js';

export const CalendarProvider = z.enum(['google', 'ics', 'local']);
export type CalendarProvider = z.infer<typeof CalendarProvider>;

/**
 * OAuth tokens never reach the browser: the row is readable only by the
 * service role and by Postgres functions, see the RLS policy in the migrations.
 */
export const CalendarAccount = z.object({
  id: uuid,
  userId: uuid,
  provider: CalendarProvider.default('google'),
  accountEmail: z.string().email(),
  scopes: z.array(z.string()).default([]),
  syncEnabled: z.boolean().default(true),
  lastSyncedAt: isoDateTime.nullable().default(null),
  lastSyncError: z.string().max(2000).nullable().default(null),
  createdAt: isoDateTime,
});
export type CalendarAccount = z.infer<typeof CalendarAccount>;

export const Calendar = z.object({
  id: uuid,
  userId: uuid,
  accountId: uuid,
  externalId: z.string().min(1),
  name: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().default(null),
  timeZone: z.string().max(100).default('UTC'),
  color: z.string().max(32).nullable().default(null),
  /** Only selected calendars are pulled into the merged timeline. */
  selected: z.boolean().default(true),
  /** The calendar Cortex writes approved time blocks back to. */
  isPrimaryTarget: z.boolean().default(false),
  accessRole: z.enum(['owner', 'writer', 'reader', 'freeBusyReader']).default('owner'),
  syncToken: z.string().nullable().default(null),
  createdAt: isoDateTime,
});
export type Calendar = z.infer<typeof Calendar>;

export const EventTransparency = z.enum(['opaque', 'transparent']);
export type EventTransparency = z.infer<typeof EventTransparency>;

export const CalendarEvent = z.object({
  id: uuid,
  userId: uuid,
  calendarId: uuid,
  externalId: z.string().nullable().default(null),
  title: z.string().max(500).default('(no title)'),
  description: z.string().max(20_000).nullable().default(null),
  location: z.string().max(1000).nullable().default(null),
  startAt: isoDateTime,
  endAt: isoDateTime,
  allDay: z.boolean().default(false),
  /** `transparent` events do not block free-slot detection. */
  transparency: EventTransparency.default('opaque'),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
  organizerEmail: z.string().nullable().default(null),
  attendeeCount: z.number().int().min(0).default(0),
  recurringEventId: z.string().nullable().default(null),
  htmlLink: z.string().nullable().default(null),
  etag: z.string().nullable().default(null),
  /** Set when Cortex itself created the event from an approved time block. */
  createdByCortex: z.boolean().default(false),
  linkedTaskId: uuid.nullable().default(null),
  origin: Origin.default('calendar'),
  updatedAt: isoDateTime,
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const TimeBlockKind = z.enum(['task', 'focus', 'habit', 'review', 'buffer']);
export type TimeBlockKind = z.infer<typeof TimeBlockKind>;

export const TimeBlockStatus = z.enum(['proposed', 'approved', 'rejected', 'completed']);
export type TimeBlockStatus = z.infer<typeof TimeBlockStatus>;

/**
 * A time block is always *proposed* first. Nothing is written to Google
 * Calendar until the user approves it - the AFM scheduler only suggests.
 */
export const TimeBlock = z.object({
  id: uuid,
  userId: uuid,
  taskId: uuid.nullable().default(null),
  habitId: uuid.nullable().default(null),
  eventId: uuid.nullable().default(null),
  title: z.string().min(1).max(300),
  kind: TimeBlockKind.default('task'),
  status: TimeBlockStatus.default('proposed'),
  startAt: isoDateTime,
  endAt: isoDateTime,
  /** Why this slot was chosen - surfaced verbatim in the UI for transparency. */
  rationale: z.string().max(2000).nullable().default(null),
  engine: z.enum(['afm', 'heuristic', 'manual']).default('heuristic'),
  createdAt: isoDateTime,
});
export type TimeBlock = z.infer<typeof TimeBlock>;

/** A busy interval fed into free-slot detection. */
export interface BusyInterval {
  start: Date;
  end: Date;
  label?: string;
  sourceId?: string;
}

export function eventToBusy(e: Pick<CalendarEvent, 'startAt' | 'endAt' | 'title' | 'id' | 'transparency' | 'status'>): BusyInterval | null {
  if (e.transparency === 'transparent' || e.status === 'cancelled') return null;
  return { start: new Date(e.startAt), end: new Date(e.endAt), label: e.title, sourceId: e.id };
}
