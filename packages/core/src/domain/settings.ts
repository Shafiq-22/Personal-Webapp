import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/** Working hours per ISO weekday, used by free-slot detection and the planner. */
export const WorkingHours = z.object({
  weekday: z.number().int().min(1).max(7),
  /** Minutes from local midnight. */
  startMinute: z.number().int().min(0).max(1440).default(9 * 60),
  endMinute: z.number().int().min(0).max(1440).default(18 * 60),
  enabled: z.boolean().default(true),
});
export type WorkingHours = z.infer<typeof WorkingHours>;

export const DEFAULT_WORKING_HOURS: WorkingHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  enabled: weekday <= 5,
}));

/**
 * Privacy posture. `localFirst` keeps everything that *can* stay on the device
 * on the device; cloud rows are then limited to what sync strictly needs.
 */
export const PrivacySettings = z.object({
  localFirst: z.boolean().default(false),
  /** Upload AFM-generated summaries so the web app can show them too. */
  syncAiSummaries: z.boolean().default(false),
  /** Store fetched article bodies in Postgres (off = metadata + link only). */
  storeItemContent: z.boolean().default(true),
  /** Let the iOS app scan the Obsidian vault for topic discovery. */
  allowVaultTopicScan: z.boolean().default(false),
  /** Client-side encryption for vault-related cloud rows. */
  encryptVaultMetadata: z.boolean().default(false),
  shareAnalytics: z.boolean().default(false),
  /** Show the signal breakdown behind every AI decision. */
  explainAiDecisions: z.boolean().default(true),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;

export const NotificationSettings = z.object({
  dailyDigestHour: z.number().int().min(0).max(23).default(7),
  weeklyDigestWeekday: z.number().int().min(1).max(7).default(1),
  realtimeAlertThreshold: z.number().min(0).max(1).default(0.8),
  quietHoursStart: z.number().int().min(0).max(23).nullable().default(22),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().default(7),
  pushEnabled: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const SchedulingSettings = z.object({
  workingHours: z.array(WorkingHours).default(() => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
    enabled: weekday <= 5,
  }))),
  /** Minutes of breathing room kept around every existing event. */
  bufferMinutes: z.number().int().min(0).max(60).default(10),
  minBlockMinutes: z.number().int().min(10).max(240).default(25),
  maxBlockMinutes: z.number().int().min(15).max(480).default(90),
  /** Protect these ranges from any automatic suggestion. */
  protectHabits: z.boolean().default(true),
  autoReplanOnCalendarChange: z.boolean().default(true),
});
export type SchedulingSettings = z.infer<typeof SchedulingSettings>;

export const UserSettings = z.object({
  userId: uuid,
  timeZone: z.string().default('UTC'),
  weekStartsOn: z.number().int().min(1).max(7).default(1),
  privacy: PrivacySettings.default({}),
  notifications: NotificationSettings.default({}),
  scheduling: SchedulingSettings.default({}),
  updatedAt: isoDateTime,
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_PRIVACY: PrivacySettings = PrivacySettings.parse({});
export const DEFAULT_NOTIFICATIONS: NotificationSettings = NotificationSettings.parse({});
export const DEFAULT_SCHEDULING: SchedulingSettings = SchedulingSettings.parse({});

/** A registered device. Only iOS devices report AFM availability. */
export const Device = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().max(200).default('iPhone'),
  platform: z.enum(['ios', 'ipados', 'macos', 'web']).default('ios'),
  pushToken: z.string().max(500).nullable().default(null),
  /** Mirrors `SystemLanguageModel.availability` from the companion app. */
  afmAvailability: z.enum(['available', 'device_not_eligible', 'model_not_ready', 'apple_intelligence_disabled', 'unsupported_os', 'unknown']).default('unknown'),
  appVersion: z.string().max(40).nullable().default(null),
  lastSeenAt: isoDateTime.nullable().default(null),
  createdAt: isoDateTime,
});
export type Device = z.infer<typeof Device>;

export const SavedView = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().min(1).max(120),
  surface: z.enum(['tasks', 'feed', 'library', 'calendar']),
  filter: z.record(z.unknown()).default({}),
  pinned: z.boolean().default(false),
  createdAt: isoDateTime,
});
export type SavedView = z.infer<typeof SavedView>;

export const Share = z.object({
  id: uuid,
  userId: uuid,
  token: z.string().min(16).max(64),
  resourceType: z.enum(['project', 'saved_view', 'library_tag', 'digest']),
  resourceId: z.string().min(1),
  title: z.string().max(200).nullable().default(null),
  /** Shares are read-only snapshots; nothing private travels with them. */
  includeNotes: z.boolean().default(false),
  expiresAt: isoDateTime.nullable().default(null),
  revokedAt: isoDateTime.nullable().default(null),
  viewCount: z.number().int().min(0).default(0),
  createdAt: isoDateTime,
});
export type Share = z.infer<typeof Share>;
