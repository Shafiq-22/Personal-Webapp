import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type {
  CalendarEvent,
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
import { createSupabaseServerClient } from './supabase/server';
import {
  toDigest,
  toEvent,
  toHabit,
  toHabitEntry,
  toInfoItem,
  toProject,
  toSettings,
  toSource,
  toSummary,
  toTag,
  toTask,
  toTimeBlock,
  toTopic,
  toVault,
} from './mappers';
import type {
  DeviceRow,
  ItemScoreRow,
  ItemStateRow,
  ProfileRow,
  TopicCandidateRow,
} from './supabase/types';

/**
 * Read-side data access.
 *
 * Everything here runs on the server with the caller's session, so RLS does
 * the authorisation - no query filters by user id by hand, and none of these
 * functions can leak another account's rows even if a filter is forgotten.
 * `cache()` dedupes repeated reads inside a single render pass.
 */

export interface SessionContext {
  user: User;
  profile: ProfileRow;
  settings: UserSettings;
}

export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: settingsRow }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  const resolvedProfile: ProfileRow = (profile as ProfileRow | null) ?? {
    id: user.id,
    email: user.email ?? null,
    display_name: user.email?.split('@')[0] ?? null,
    avatar_url: null,
    time_zone: 'UTC',
    week_starts_on: 1,
    onboarded_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    user,
    profile: resolvedProfile,
    settings: toSettings(settingsRow, user.id, resolvedProfile.time_zone, resolvedProfile.week_starts_on),
  };
});

/** Use in every authenticated page; redirects instead of rendering an error. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export const getProjects = cache(async (): Promise<Project[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('projects').select('*').order('sort_order').order('name');
  return (data ?? []).map(toProject);
});

export const getTags = cache(async (): Promise<Tag[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('tags').select('*').order('name');
  return (data ?? []).map(toTag);
});

export interface TaskFilter {
  status?: Array<Task['status']>;
  projectId?: string | null;
  tagId?: string;
  dueBefore?: string;
  search?: string;
  limit?: number;
}

export const getTasks = cache(async (filter: TaskFilter = {}): Promise<Task[]> => {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('tasks')
    .select('*, task_tags(tag_id)')
    .order('sort_order')
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 500);

  if (filter.status?.length) query = query.in('status', filter.status);
  if (filter.projectId !== undefined) {
    query = filter.projectId === null ? query.is('project_id', null) : query.eq('project_id', filter.projectId);
  }
  if (filter.dueBefore) query = query.lte('due_at', filter.dueBefore);
  if (filter.search) query = query.ilike('title', `%${filter.search}%`);

  const { data } = await query;
  let tasks = (data ?? []).map(toTask);
  if (filter.tagId) tasks = tasks.filter((task) => task.tagIds.includes(filter.tagId as string));
  return tasks;
});

export const getOpenTasks = cache(async (): Promise<Task[]> => getTasks({ status: ['todo', 'in_progress'] }));

export const getEvents = cache(async (from: string, to: string): Promise<CalendarEvent[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .neq('status', 'cancelled')
    .lt('start_at', to)
    .gt('end_at', from)
    .order('start_at');
  return (data ?? []).map(toEvent);
});

export const getTimeBlocks = cache(async (from: string, to: string): Promise<TimeBlock[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('time_blocks')
    .select('*')
    .in('status', ['proposed', 'approved', 'completed'])
    .lt('start_at', to)
    .gt('end_at', from)
    .order('start_at');
  return (data ?? []).map(toTimeBlock);
});

export const getCalendarAccounts = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('calendar_accounts_public').select('*').order('created_at');
  return data ?? [];
});

export const getCalendars = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('calendars').select('*').order('name');
  return data ?? [];
});

export const getSources = cache(async (): Promise<Source[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('sources').select('*').order('name');
  return (data ?? []).map(toSource);
});

export const getTopics = cache(async (): Promise<Topic[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('topics').select('*').order('weight', { ascending: false }).order('label');
  return (data ?? []).map(toTopic);
});

export const getTopicCandidates = cache(async (): Promise<TopicCandidateRow[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('topic_candidates')
    .select('*')
    .is('decided_at', null)
    .order('weight', { ascending: false });
  return (data ?? []) as TopicCandidateRow[];
});

export interface FeedEntry {
  item: InfoItem;
  score: number | null;
  explanation: string | null;
  engine: 'afm' | 'heuristic' | 'none';
  signals: Record<string, number>;
  matchedTerms: string[];
  topicLabels: string[];
  state: ItemStateRow['state'];
  stateRow: ItemStateRow | null;
  summaries: ItemSummary[];
}

export interface FeedFilter {
  state?: Array<ItemStateRow['state']>;
  topicId?: string;
  sourceId?: string;
  minScore?: number;
  search?: string;
  tag?: string;
  limit?: number;
}

/**
 * The feed and the library are the same query with different filters: items,
 * their best relevance score, the reason behind it, the user's reading state
 * and any on-device summaries that were synced.
 */
export const getFeed = cache(async (filter: FeedFilter = {}): Promise<FeedEntry[]> => {
  const supabase = await createSupabaseServerClient();
  const limit = filter.limit ?? 60;

  let itemQuery = supabase
    .from('info_items')
    .select('*')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('fetched_at', { ascending: false })
    .limit(limit * 3);

  if (filter.sourceId) itemQuery = itemQuery.eq('source_id', filter.sourceId);
  if (filter.search) itemQuery = itemQuery.ilike('title', `%${filter.search}%`);

  const { data: itemRows } = await itemQuery;
  const items = (itemRows ?? []).map(toInfoItem);
  if (items.length === 0) return [];

  const ids = items.map((item) => item.id);
  const [{ data: scoreRows }, { data: stateRows }, { data: summaryRows }, topics] = await Promise.all([
    supabase.from('item_scores').select('*').in('item_id', ids),
    supabase.from('item_states').select('*').in('item_id', ids),
    supabase.from('item_summaries').select('*').in('item_id', ids),
    getTopics(),
  ]);

  const topicLabels = new Map(topics.map((topic) => [topic.id, topic.label]));
  const scoresByItem = new Map<string, ItemScoreRow[]>();
  for (const row of (scoreRows ?? []) as ItemScoreRow[]) {
    const bucket = scoresByItem.get(row.item_id) ?? [];
    bucket.push(row);
    scoresByItem.set(row.item_id, bucket);
  }
  const stateByItem = new Map((stateRows ?? []).map((row) => [(row as ItemStateRow).item_id, row as ItemStateRow]));
  const summariesByItem = new Map<string, ItemSummary[]>();
  for (const row of summaryRows ?? []) {
    const summary = toSummary(row);
    const bucket = summariesByItem.get(summary.itemId) ?? [];
    bucket.push(summary);
    summariesByItem.set(summary.itemId, bucket);
  }

  const entries: FeedEntry[] = items.map((item) => {
    const scores = (scoresByItem.get(item.id) ?? []).sort((a, b) => b.score - a.score);
    // An AFM score from the phone always wins over the server heuristic.
    const best = scores.find((s) => s.engine === 'afm') ?? scores[0] ?? null;
    const stateRow = stateByItem.get(item.id) ?? null;
    return {
      item,
      score: best ? best.score : null,
      explanation: best?.explanation ?? null,
      engine: best?.engine ?? 'none',
      signals: best?.signals ?? {},
      matchedTerms: best?.matched_terms ?? [],
      topicLabels: scores.map((s) => (s.topic_id ? topicLabels.get(s.topic_id) : null)).filter((l): l is string => Boolean(l)),
      state: stateRow?.state ?? 'new',
      stateRow,
      summaries: summariesByItem.get(item.id) ?? [],
    };
  });

  let filtered = entries;
  if (filter.state?.length) filtered = filtered.filter((entry) => filter.state?.includes(entry.state));
  if (filter.topicId) {
    const label = topicLabels.get(filter.topicId);
    filtered = filtered.filter((entry) => (label ? entry.topicLabels.includes(label) : false));
  }
  if (filter.minScore !== undefined) filtered = filtered.filter((entry) => (entry.score ?? 0) >= (filter.minScore as number));
  if (filter.tag) filtered = filtered.filter((entry) => entry.stateRow?.tags?.includes(filter.tag as string));

  return filtered
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.item.publishedAt ?? '').localeCompare(a.item.publishedAt ?? ''))
    .slice(0, limit);
});

export const getDigests = cache(async (limit = 20): Promise<Digest[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('digests').select('*').order('window_start', { ascending: false }).limit(limit);
  return (data ?? []).map(toDigest);
});

export const getHabits = cache(async (): Promise<{ habits: Habit[]; entries: HabitEntry[] }> => {
  const supabase = await createSupabaseServerClient();
  const [{ data: habitRows }, { data: entryRows }] = await Promise.all([
    supabase.from('habits').select('*').eq('archived', false).order('name'),
    supabase.from('habit_entries').select('*').order('day', { ascending: false }).limit(1000),
  ]);
  return { habits: (habitRows ?? []).map(toHabit), entries: (entryRows ?? []).map(toHabitEntry) };
});

export const getVault = cache(async (): Promise<VaultConfig | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('vaults').select('*').limit(1).maybeSingle();
  return data ? toVault(data) : null;
});

export const getDevices = cache(async (): Promise<DeviceRow[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('devices').select('*').order('last_seen_at', { ascending: false });
  return (data ?? []) as DeviceRow[];
});

export const getSavedViews = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('saved_views').select('*').order('name');
  return data ?? [];
});

export const getShares = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('shares').select('*').is('revoked_at', null).order('created_at', { ascending: false });
  return data ?? [];
});

/**
 * Whether any registered device can actually run Apple Foundation Models.
 * Drives the honest "AI features need your iPhone" messaging in the web UI.
 */
export const getAfmStatus = cache(async (): Promise<{ available: boolean; reason: string | null; deviceName: string | null }> => {
  const devices = await getDevices();
  const ready = devices.find((device) => device.afm_availability === 'available');
  if (ready) return { available: true, reason: null, deviceName: ready.name };

  const latest = devices[0];
  if (!latest) return { available: false, reason: 'no_device', deviceName: null };
  return { available: false, reason: latest.afm_availability, deviceName: latest.name };
});
