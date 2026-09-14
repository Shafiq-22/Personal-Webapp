import type {
  CalendarEvent,
  Origin,
  Digest,
  Habit,
  HabitEntry,
  InfoItem,
  ItemSummary,
  Project,
  Source,
  Tag,
  Task,
  TimeBlock,
  Topic,
  UserSettings,
  VaultConfig,
} from '@cortex/core';
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_PRIVACY,
  DEFAULT_SCHEDULING,
  NotificationSettings,
  PrivacySettings,
  SchedulingSettings,
} from '@cortex/core';
import type {
  CalendarEventRow,
  DigestRow,
  HabitEntryRow,
  HabitRow,
  InfoItemRow,
  ItemSummaryRow,
  ProjectRow,
  SettingsRow,
  SourceRow,
  TagRow,
  TaskRow,
  TimeBlockRow,
  TopicRow,
  VaultRow,
} from './supabase/types';

/**
 * Row <-> domain mapping.
 *
 * Postgres is snake_case, the shared core is camelCase, and the two are
 * deliberately decoupled: the core has no idea a database exists, which is what
 * lets the same logic run in an edge function and (ported) on iOS.
 */

const ORIGINS: Origin[] = ['manual', 'nl_capture', 'calendar', 'obsidian', 'feed', 'clipper', 'ios', 'system'];

/** Coerce an origin column to a known value; anything unexpected reads as manual. */
function toOrigin(value: string | null | undefined, fallback: Origin = 'manual'): Origin {
  return ORIGINS.find((origin) => origin === value) ?? fallback;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    energy: row.energy,
    dueAt: row.due_at,
    dueAllDay: row.due_all_day,
    startAt: row.start_at,
    estimateMinutes: row.estimate_minutes,
    recurrenceRule: row.recurrence_rule,
    recurrenceAnchor: row.recurrence_anchor,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    origin: toOrigin(row.origin),
    captureText: row.capture_text,
    sourceItemId: row.source_item_id,
    tagIds: (row.task_tags ?? []).map((t) => t.tag_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Only the columns a client is allowed to set; ids and stamps stay server-side. */
export function taskToRow(patch: Partial<Task>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const map: Array<[keyof Task, string]> = [
    ['projectId', 'project_id'],
    ['parentTaskId', 'parent_task_id'],
    ['title', 'title'],
    ['notes', 'notes'],
    ['status', 'status'],
    ['priority', 'priority'],
    ['energy', 'energy'],
    ['dueAt', 'due_at'],
    ['dueAllDay', 'due_all_day'],
    ['startAt', 'start_at'],
    ['estimateMinutes', 'estimate_minutes'],
    ['recurrenceRule', 'recurrence_rule'],
    ['recurrenceAnchor', 'recurrence_anchor'],
    ['completedAt', 'completed_at'],
    ['sortOrder', 'sort_order'],
    ['origin', 'origin'],
    ['captureText', 'capture_text'],
    ['sourceItemId', 'source_item_id'],
  ];
  for (const [key, column] of map) {
    if (patch[key] !== undefined) row[column] = patch[key];
  }
  return row;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    archived: row.archived,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTag(row: TagRow): Tag {
  return { id: row.id, userId: row.user_id, name: row.name, color: row.color, createdAt: row.created_at };
}

export function toEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    calendarId: row.calendar_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day,
    transparency: row.transparency,
    status: row.status,
    organizerEmail: row.organizer_email,
    attendeeCount: row.attendee_count,
    recurringEventId: row.recurring_event_id,
    htmlLink: row.html_link,
    etag: row.etag,
    createdByCortex: row.created_by_cortex,
    linkedTaskId: row.linked_task_id,
    origin: toOrigin(row.origin, 'calendar'),
    updatedAt: row.updated_at,
  };
}

export function toTimeBlock(row: TimeBlockRow): TimeBlock {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    habitId: row.habit_id,
    eventId: row.event_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    rationale: row.rationale,
    engine: row.engine,
    createdAt: row.created_at,
  };
}

export function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as Source['kind'],
    name: row.name,
    url: row.url,
    config: row.config ?? {},
    enabled: row.enabled,
    weight: row.weight,
    fetchIntervalMinutes: row.fetch_interval_minutes,
    lastFetchedAt: row.last_fetched_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    etag: row.etag,
    createdAt: row.created_at,
  };
}

export function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    keywords: row.keywords ?? [],
    excludeKeywords: row.exclude_keywords ?? [],
    origin: row.origin,
    derivedFrom: row.derived_from ?? [],
    weight: row.weight,
    active: row.active,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toInfoItem(row: InfoItemRow): InfoItem {
  return {
    id: row.id,
    userId: row.user_id,
    sourceId: row.source_id,
    kind: row.kind as InfoItem['kind'],
    externalId: row.external_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    authors: row.authors ?? [],
    summaryRaw: row.summary_raw,
    contentText: row.content_text,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    doi: row.doi,
    arxivId: row.arxiv_id,
    venue: row.venue,
    patentNumber: row.patent_number,
    language: row.language,
    contentHash: row.content_hash,
    origin: toOrigin(row.origin, 'feed'),
    raw: row.raw ?? {},
  };
}

export function toSummary(row: ItemSummaryRow): ItemSummary {
  return {
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    style: row.style,
    text: row.text,
    engine: row.engine,
    modelIdentifier: row.model_identifier,
    deviceId: row.device_id,
    createdAt: row.created_at,
  };
}

export function toDigest(row: DigestRow): Digest {
  return {
    id: row.id,
    userId: row.user_id,
    period: row.period,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    entries: row.entries ?? [],
    itemCount: row.item_count,
    headline: row.headline,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

export function toHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    cadence: row.cadence,
    weekdays: row.weekdays ?? [],
    targetPerPeriod: row.target_per_period,
    blockMinutes: row.block_minutes,
    color: row.color,
    archived: row.archived,
    createdAt: row.created_at,
  };
}

export function toHabitEntry(row: HabitEntryRow): HabitEntry {
  return {
    id: row.id,
    userId: row.user_id,
    habitId: row.habit_id,
    day: row.day,
    count: row.count,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function toVault(row: VaultRow): VaultConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    transport: row.transport as VaultConfig['transport'],
    folders: {
      tasks: row.folders?.tasks ?? 'Cortex/Tasks',
      items: row.folders?.items ?? 'Cortex/Research',
      digests: row.folders?.digests ?? 'Cortex/Digests',
      events: row.folders?.events ?? 'Cortex/Calendar',
      projects: row.folders?.projects ?? 'Cortex/Projects',
      dailyNotes: row.folders?.dailyNotes ?? 'Daily Notes',
    },
    direction: row.direction,
    allowTopicScan: row.allow_topic_scan,
    scanFolders: row.scan_folders ?? [],
    encryptionEnabled: row.encryption_enabled,
    encryptionKeyRef: row.encryption_key_ref,
    restApiBaseUrl: row.rest_api_base_url,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

/**
 * Settings are stored as jsonb and validated on the way out, so an older or
 * partially-written blob degrades to defaults instead of crashing a page.
 */
export function toSettings(row: SettingsRow | null, userId: string, timeZone = 'UTC', weekStartsOn = 1): UserSettings {
  const privacy = PrivacySettings.safeParse(row?.privacy ?? {});
  const notifications = NotificationSettings.safeParse(row?.notifications ?? {});
  const scheduling = SchedulingSettings.safeParse(row?.scheduling ?? {});
  return {
    userId,
    timeZone,
    weekStartsOn,
    privacy: privacy.success ? privacy.data : DEFAULT_PRIVACY,
    notifications: notifications.success ? notifications.data : DEFAULT_NOTIFICATIONS,
    scheduling: scheduling.success ? scheduling.data : DEFAULT_SCHEDULING,
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}
