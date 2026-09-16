/**
 * Hand-written row types for the tables the web app touches.
 *
 * `supabase gen types typescript` output can replace this file wholesale
 * (`npm run db:types`); it is written by hand here so the repository
 * typechecks without a live project.
 */
export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  time_zone: string;
  week_starts_on: number;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  user_id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  energy: 'low' | 'medium' | 'high' | null;
  due_at: string | null;
  due_all_day: boolean;
  start_at: string | null;
  estimate_minutes: number | null;
  recurrence_rule: string | null;
  recurrence_anchor: string | null;
  completed_at: string | null;
  sort_order: number;
  origin: string;
  capture_text: string | null;
  source_item_id: string | null;
  created_at: string;
  updated_at: string;
  task_tags?: Array<{ tag_id: string }>;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface CalendarEventRow {
  id: string;
  user_id: string;
  calendar_id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  transparency: 'opaque' | 'transparent';
  status: 'confirmed' | 'tentative' | 'cancelled';
  organizer_email: string | null;
  attendee_count: number;
  recurring_event_id: string | null;
  html_link: string | null;
  etag: string | null;
  created_by_cortex: boolean;
  linked_task_id: string | null;
  origin: string;
  updated_at: string;
}

export interface TimeBlockRow {
  id: string;
  user_id: string;
  task_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  title: string;
  kind: 'task' | 'focus' | 'habit' | 'review' | 'buffer';
  status: 'proposed' | 'approved' | 'rejected' | 'completed';
  start_at: string;
  end_at: string;
  rationale: string | null;
  engine: 'afm' | 'heuristic' | 'manual';
  created_at: string;
}

export interface SourceRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  url: string;
  config: Record<string, unknown>;
  enabled: boolean;
  weight: number;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  last_status: 'ok' | 'error' | 'never';
  last_error: string | null;
  etag: string | null;
  created_at: string;
}

export interface TopicRow {
  id: string;
  user_id: string;
  label: string;
  keywords: string[];
  exclude_keywords: string[];
  origin: 'manual' | 'task' | 'calendar' | 'obsidian' | 'item_feedback';
  derived_from: string[];
  weight: number;
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicCandidateRow {
  id: string;
  user_id: string;
  label: string;
  keywords: string[];
  origin: string;
  derived_from: string[];
  evidence: string[];
  weight: number;
  decided_at: string | null;
  accepted: boolean | null;
  created_at: string;
}

export interface InfoItemRow {
  id: string;
  user_id: string;
  source_id: string | null;
  kind: string;
  external_id: string | null;
  url: string;
  canonical_url: string | null;
  title: string;
  authors: string[];
  summary_raw: string | null;
  content_text: string | null;
  published_at: string | null;
  fetched_at: string;
  doi: string | null;
  arxiv_id: string | null;
  venue: string | null;
  patent_number: string | null;
  language: string;
  content_hash: string;
  origin: string;
  raw: Record<string, unknown>;
}

export interface ItemScoreRow {
  id: string;
  user_id: string;
  item_id: string;
  topic_id: string | null;
  score: number;
  signals: Record<string, number>;
  matched_terms: string[];
  engine: 'afm' | 'heuristic' | 'none';
  explanation: string | null;
  created_at: string;
}

export interface ItemStateRow {
  id: string;
  user_id: string;
  item_id: string;
  state: 'new' | 'read' | 'saved' | 'dismissed' | 'snoozed';
  notes: string | null;
  tags: string[];
  rating: number | null;
  snoozed_until: string | null;
  read_at: string | null;
  saved_at: string | null;
  created_task_id: string | null;
  updated_at: string;
}

export interface ItemSummaryRow {
  id: string;
  user_id: string;
  item_id: string;
  style: 'tldr' | 'key_points' | 'implications' | 'eli5' | 'methodology' | 'actions';
  text: string;
  engine: 'afm' | 'heuristic' | 'none';
  model_identifier: string | null;
  device_id: string | null;
  created_at: string;
}

export interface DigestRow {
  id: string;
  user_id: string;
  period: 'daily' | 'weekly' | 'realtime';
  window_start: string;
  window_end: string;
  entries: Array<{
    itemId: string;
    title: string;
    url: string;
    score: number;
    topicLabels: string[];
    reason: string | null;
    summary: string | null;
  }>;
  item_count: number;
  headline: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface SettingsRow {
  user_id: string;
  privacy: Record<string, unknown>;
  notifications: Record<string, unknown>;
  scheduling: Record<string, unknown>;
  updated_at: string;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: 'ios' | 'ipados' | 'macos' | 'web';
  push_token: string | null;
  afm_availability:
    | 'available'
    | 'device_not_eligible'
    | 'model_not_ready'
    | 'apple_intelligence_disabled'
    | 'unsupported_os'
    | 'unknown';
  app_version: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface VaultRow {
  id: string;
  user_id: string;
  name: string;
  transport: string;
  folders: Record<string, string>;
  direction: 'push' | 'pull' | 'two_way';
  allow_topic_scan: boolean;
  scan_folders: string[];
  encryption_enabled: boolean;
  encryption_key_ref: string | null;
  rest_api_base_url: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  cadence: 'daily' | 'weekly' | 'custom';
  weekdays: number[];
  target_per_period: number;
  block_minutes: number | null;
  color: string | null;
  archived: boolean;
  created_at: string;
}

export interface HabitEntryRow {
  id: string;
  user_id: string;
  habit_id: string;
  day: string;
  count: number;
  note: string | null;
  created_at: string;
}

export interface TimelineRow {
  kind: 'event' | 'task' | 'block';
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  status: string;
  meta: Record<string, unknown>;
}
