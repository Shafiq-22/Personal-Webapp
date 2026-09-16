'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  buildDigest,
  extractTopicCandidates,
  feedbackFromHistory,
  reconcileTopics,
  scoreItemAgainstTopics,
  type ScoredItem,
} from '@cortex/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { toEvent, toInfoItem, toSource, toSummary, toTask, toTopic } from '@/lib/mappers';
import type { ActionResult } from './tasks';

async function currentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const SourceSchema = z.object({
  kind: z.enum([
    'rss', 'atom', 'arxiv', 'pubmed', 'biorxiv', 'scholar_alert', 'news', 'blog', 'forum',
    'regulatory', 'patents', 'company_news', 'x_list', 'github_releases', 'web_page', 'json_api',
  ]),
  name: z.string().min(1).max(300),
  url: z.string().url(),
  weight: z.number().min(0.1).max(2).default(1),
  fetchIntervalMinutes: z.number().int().min(15).max(10080).default(180),
  config: z.record(z.unknown()).default({}),
});

export async function addSource(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = SourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid source' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('sources')
    .insert({
      user_id: userId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      url: parsed.data.url,
      weight: parsed.data.weight,
      fetch_interval_minutes: parsed.data.fetchIntervalMinutes,
      config: parsed.data.config,
    })
    .select('id')
    .single();

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'You are already monitoring that URL.' : error.message,
    };
  }

  revalidatePath('/settings');
  revalidatePath('/feed');
  return { ok: true, data: { id: data.id } };
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('sources').update({ enabled }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

export async function deleteSource(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('sources').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

const TopicSchema = z.object({
  label: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1).max(80)).default([]),
  excludeKeywords: z.array(z.string().min(1).max(80)).default([]),
  weight: z.number().min(0).max(2).default(1),
});

export async function addTopic(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = TopicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid topic' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('topics')
    .insert({
      user_id: userId,
      label: parsed.data.label,
      keywords: parsed.data.keywords,
      exclude_keywords: parsed.data.excludeKeywords,
      weight: parsed.data.weight,
      origin: 'manual',
      last_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'That topic already exists.' : error.message };
  }

  revalidatePath('/settings');
  revalidatePath('/feed');
  return { ok: true, data: { id: data.id } };
}

export async function setTopicActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('topics').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

export async function deleteTopic(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('topics').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Read the user's own work and propose monitoring topics from it.
 *
 * Nothing is activated here: candidates are written to `topic_candidates` with
 * the evidence that produced them, and the settings page asks the user to
 * accept or reject each one. Obsidian notes are only included when the vault
 * has `allow_topic_scan` on and the iOS app has uploaded a scan.
 */
export async function discoverTopics(): Promise<ActionResult<{ proposed: number; refreshed: number }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const [{ data: taskRows }, { data: eventRows }, { data: topicRows }] = await Promise.all([
    supabase.from('tasks').select('*, task_tags(tag_id)').in('status', ['todo', 'in_progress']).limit(300),
    supabase.from('calendar_events').select('*').gte('start_at', since).neq('status', 'cancelled').limit(300),
    supabase.from('topics').select('*'),
  ]);

  const candidates = extractTopicCandidates(
    {
      tasks: (taskRows ?? []).map(toTask),
      events: (eventRows ?? []).map(toEvent),
    },
    { now, maxTopics: 15 },
  );

  const reconciliation = reconcileTopics((topicRows ?? []).map(toTopic), candidates, { now });

  if (reconciliation.created.length) {
    await supabase.from('topic_candidates').upsert(
      reconciliation.created.map((candidate) => ({
        user_id: userId,
        label: candidate.label,
        keywords: candidate.keywords,
        origin: candidate.origin,
        derived_from: candidate.derivedFrom,
        evidence: candidate.evidence,
        weight: candidate.weight,
        decided_at: null,
        accepted: null,
      })),
      { onConflict: 'user_id,label' },
    );
  }

  for (const refreshed of reconciliation.refreshed) {
    await supabase
      .from('topics')
      .update({
        keywords: refreshed.keywords,
        weight: refreshed.weight,
        derived_from: refreshed.derivedFrom,
        last_seen_at: now.toISOString(),
      })
      .eq('id', refreshed.topicId);
  }

  revalidatePath('/settings');
  return { ok: true, data: { proposed: reconciliation.created.length, refreshed: reconciliation.refreshed.length } };
}

export async function decideTopicCandidate(id: string, accept: boolean): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { data: candidate, error } = await supabase.from('topic_candidates').select('*').eq('id', id).single();
  if (error) return { ok: false, error: error.message };

  if (accept) {
    const { error: insertError } = await supabase.from('topics').insert({
      user_id: userId,
      label: candidate.label,
      keywords: candidate.keywords,
      origin: candidate.origin,
      derived_from: candidate.derived_from,
      weight: Math.max(0.5, Number(candidate.weight)),
      active: true,
      last_seen_at: new Date().toISOString(),
    });
    if (insertError && insertError.code !== '23505') return { ok: false, error: insertError.message };
  }

  await supabase.from('topic_candidates').update({ decided_at: new Date().toISOString(), accepted: accept }).eq('id', id);
  revalidatePath('/settings');
  revalidatePath('/feed');
  return { ok: true };
}

/**
 * Re-score every recent item against the current topics.
 *
 * Uses the deterministic ranker, which is what the server can honestly do. If
 * the iPhone later re-ranks any of these items with Apple Foundation Models it
 * writes rows with `engine = 'afm'`, and the feed prefers those.
 */
export async function rescoreFeed(): Promise<ActionResult<{ scored: number }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const [{ data: itemRows }, { data: topicRows }, { data: sourceRows }, { data: feedbackRows }] = await Promise.all([
    supabase.from('info_items').select('*').order('fetched_at', { ascending: false }).limit(300),
    supabase.from('topics').select('*').eq('active', true),
    supabase.from('sources').select('*'),
    supabase.rpc('topic_feedback'),
  ]);

  const topics = (topicRows ?? []).map(toTopic);
  if (topics.length === 0) return { ok: false, error: 'Add at least one topic first.' };

  const history = ((feedbackRows ?? []) as Array<{ topic_id: string; saved: number; dismissed: number; read_count: number }>)
    .flatMap((row) => [
      ...Array.from({ length: row.saved }, () => ({ topicId: row.topic_id, state: 'saved' as const })),
      ...Array.from({ length: row.dismissed }, () => ({ topicId: row.topic_id, state: 'dismissed' as const })),
      ...Array.from({ length: row.read_count }, () => ({ topicId: row.topic_id, state: 'read' as const })),
    ]);

  const sources = (sourceRows ?? []).map(toSource);
  const feedback = feedbackFromHistory(history);

  const rows: Array<Record<string, unknown>> = [];
  for (const row of itemRows ?? []) {
    const item = toInfoItem(row);
    for (const score of scoreItemAgainstTopics(item, topics, sources, { feedback })) {
      rows.push({
        user_id: userId,
        item_id: score.itemId,
        topic_id: score.topicId,
        score: score.score,
        signals: score.signals,
        matched_terms: score.matchedTerms,
        engine: 'heuristic',
        explanation: score.explanation,
      });
    }
  }

  if (rows.length) {
    const { error } = await supabase.from('item_scores').upsert(rows, { onConflict: 'item_id,topic_id' });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/feed');
  return { ok: true, data: { scored: rows.length } };
}

export async function setItemState(
  itemId: string,
  state: 'new' | 'read' | 'saved' | 'dismissed' | 'snoozed',
  extra: { notes?: string | null; tags?: string[]; snoozedUntil?: string | null } = {},
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('item_states').upsert(
    {
      user_id: userId,
      item_id: itemId,
      state,
      ...(extra.notes !== undefined ? { notes: extra.notes } : {}),
      ...(extra.tags !== undefined ? { tags: extra.tags } : {}),
      snoozed_until: state === 'snoozed' ? (extra.snoozedUntil ?? new Date(Date.now() + 7 * 86_400_000).toISOString()) : null,
      read_at: state === 'read' || state === 'saved' ? now : null,
      saved_at: state === 'saved' ? now : null,
    },
    { onConflict: 'user_id,item_id' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/feed');
  revalidatePath('/library');
  return { ok: true };
}

/** "Create a task from this update", with the item kept as provenance. */
export async function createTaskFromItem(itemId: string, title?: string): Promise<ActionResult<{ taskId: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { data: item, error: readError } = await supabase
    .from('info_items')
    .select('id, title, url, canonical_url')
    .eq('id', itemId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title: title?.trim() || `Read: ${item.title}`.slice(0, 500),
      notes: `Source: ${item.canonical_url ?? item.url}`,
      origin: 'feed',
      source_item_id: item.id,
      estimate_minutes: 25,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase
    .from('item_states')
    .upsert({ user_id: userId, item_id: itemId, state: 'saved', created_task_id: task.id, saved_at: new Date().toISOString() }, { onConflict: 'user_id,item_id' });

  revalidatePath('/feed');
  revalidatePath('/tasks');
  return { ok: true, data: { taskId: task.id } };
}

/** Build a digest on demand rather than waiting for the scheduled one. */
export async function buildDigestNow(period: 'daily' | 'weekly'): Promise<ActionResult<{ items: number }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - (period === 'daily' ? 1 : 7) * 86_400_000);

  const { data: itemRows } = await supabase
    .from('info_items')
    .select('*')
    .gte('fetched_at', windowStart.toISOString())
    .limit(400);

  const items = (itemRows ?? []).map(toInfoItem);
  if (items.length === 0) return { ok: false, error: 'No new items in this window yet.' };

  const ids = items.map((item) => item.id);
  const [{ data: scoreRows }, { data: topicRows }, { data: summaryRows }] = await Promise.all([
    supabase.from('item_scores').select('*').in('item_id', ids),
    supabase.from('topics').select('*'),
    supabase.from('item_summaries').select('*').in('item_id', ids).eq('style', 'tldr'),
  ]);

  const scores: ScoredItem[] = (scoreRows ?? []).map((row) => ({
    itemId: row.item_id,
    topicId: row.topic_id,
    score: Number(row.score),
    signals: row.signals,
    matchedTerms: row.matched_terms ?? [],
    explanation: row.explanation ?? '',
  }));

  const digest = buildDigest(items, scores, (topicRows ?? []).map(toTopic), {
    userId,
    period,
    windowStart,
    windowEnd,
    summaries: (summaryRows ?? []).map(toSummary),
  });

  const { error } = await supabase.from('digests').upsert(
    {
      user_id: userId,
      period,
      window_start: digest.windowStart,
      window_end: digest.windowEnd,
      entries: digest.entries,
      item_count: digest.itemCount,
      headline: digest.headline,
    },
    { onConflict: 'user_id,period,window_start' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/digests');
  return { ok: true, data: { items: digest.itemCount } };
}
