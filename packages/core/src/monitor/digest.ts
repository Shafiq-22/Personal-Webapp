import type { Digest, DigestEntry, DigestPeriod, InfoItem, ItemSummary, Topic } from '../domain/index.js';
import { randomId } from '../util/id.js';
import { bestScorePerItem, type ScoredItem } from './ranking.js';

export interface BuildDigestOptions {
  userId: string;
  period: DigestPeriod;
  windowStart: Date;
  windowEnd: Date;
  maxEntries?: number;
  /** Items below this relevance never make the digest. */
  minScore?: number;
  /** AFM-generated summaries, when the device uploaded them. */
  summaries?: ItemSummary[];
  /** Cap per topic so one busy topic cannot fill the whole digest. */
  maxPerTopic?: number;
}

/**
 * Assemble a digest from scored items.
 *
 * The digest is *data*, not prose: entries carry the item, its score, the
 * topics it matched and the reason it was picked. The iOS app renders it with
 * an AFM-written headline; the web app renders the same data without one.
 */
export function buildDigest(
  items: InfoItem[],
  scores: ScoredItem[],
  topics: Topic[],
  options: BuildDigestOptions,
): Digest {
  const { userId, period, windowStart, windowEnd, maxEntries = 12, minScore = 0.25, maxPerTopic = 4 } = options;

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  const summariesByItem = new Map<string, ItemSummary>();
  for (const summary of options.summaries ?? []) {
    if (summary.style === 'tldr' && !summariesByItem.has(summary.itemId)) summariesByItem.set(summary.itemId, summary);
  }

  const topicsPerItem = new Map<string, Set<string>>();
  for (const score of scores) {
    if (!score.topicId) continue;
    const set = topicsPerItem.get(score.itemId) ?? new Set<string>();
    set.add(score.topicId);
    topicsPerItem.set(score.itemId, set);
  }

  const inWindow = (item: InfoItem): boolean => {
    const at = Date.parse(item.publishedAt ?? item.fetchedAt);
    return at >= windowStart.getTime() && at <= windowEnd.getTime();
  };

  const ranked = [...bestScorePerItem(scores).values()]
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const perTopicCount = new Map<string, number>();
  const entries: DigestEntry[] = [];

  for (const score of ranked) {
    if (entries.length >= maxEntries) break;
    const item = itemsById.get(score.itemId);
    if (!item || !inWindow(item)) continue;

    const topicKey = score.topicId ?? 'untagged';
    const used = perTopicCount.get(topicKey) ?? 0;
    if (used >= maxPerTopic) continue;
    perTopicCount.set(topicKey, used + 1);

    const labels = [...(topicsPerItem.get(item.id) ?? [])]
      .map((id) => topicsById.get(id)?.label)
      .filter((l): l is string => Boolean(l));

    entries.push({
      itemId: item.id,
      title: item.title,
      url: item.canonicalUrl ?? item.url,
      score: score.score,
      topicLabels: labels,
      reason: score.explanation,
      summary: summariesByItem.get(item.id)?.text ?? null,
    });
  }

  return {
    id: randomId(),
    userId,
    period,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    entries,
    itemCount: entries.length,
    headline: entries.length ? defaultHeadline(entries, period) : null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * A plain, factual headline. When AFM is available the iOS app replaces this
 * with a written one - but the digest is never empty-handed without it.
 */
function defaultHeadline(entries: DigestEntry[], period: DigestPeriod): string {
  const topics = [...new Set(entries.flatMap((e) => e.topicLabels))].slice(0, 3);
  const label = period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'Just now';
  if (topics.length === 0) return `${label}: ${entries.length} new item${entries.length === 1 ? '' : 's'}`;
  return `${label}: ${entries.length} new item${entries.length === 1 ? '' : 's'} across ${topics.join(', ')}`;
}

/** Group digest entries by topic for rendering. */
export function groupByTopic(digest: Digest): Array<{ topic: string; entries: DigestEntry[] }> {
  const groups = new Map<string, DigestEntry[]>();
  for (const entry of digest.entries) {
    const key = entry.topicLabels[0] ?? 'Other';
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([topic, entries]) => ({ topic, entries }))
    .sort((a, b) => b.entries.length - a.entries.length || a.topic.localeCompare(b.topic));
}
