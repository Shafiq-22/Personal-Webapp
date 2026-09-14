import type { InfoItem, RelevanceSignals, Source, Topic } from '../domain/index.js';
import { expandKeywords } from '../text/keywords.js';
import { cosineSimilarity } from '../text/similarity.js';
import { termFrequency, tokenize } from '../text/tokenize.js';
import { DAY_MS } from '../util/date.js';

export interface ScoredItem {
  itemId: string;
  topicId: string | null;
  score: number;
  signals: RelevanceSignals;
  matchedTerms: string[];
  explanation: string;
}

export interface RankOptions {
  now?: Date;
  /** Half-life of the recency signal, in days. */
  recencyHalfLifeDays?: number;
  /** Per-topic feedback: saved items raise, dismissed items lower. */
  feedback?: Map<string, number>;
  /** Weights for the four signals; must be positive. */
  weights?: Partial<RankWeights>;
}

export interface RankWeights {
  keyword: number;
  semantic: number;
  recency: number;
  source: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { keyword: 0.4, semantic: 0.3, recency: 0.2, source: 0.1 };

interface TopicIndex {
  topic: Topic;
  terms: Set<string>;
  excluded: Set<string>;
  vector: Map<string, number>;
}

function indexTopic(topic: Topic): TopicIndex {
  const terms = expandKeywords([topic.label, ...topic.keywords]);
  return {
    topic,
    terms,
    excluded: expandKeywords(topic.excludeKeywords),
    vector: termFrequency([...terms]),
  };
}

function itemText(item: Pick<InfoItem, 'title' | 'summaryRaw' | 'contentText' | 'authors' | 'venue'>): string {
  return [item.title, item.summaryRaw ?? '', (item.contentText ?? '').slice(0, 4000), item.venue ?? '', item.authors.join(' ')]
    .filter(Boolean)
    .join('\n');
}

/**
 * Hybrid keyword + bag-of-words-semantic relevance scoring.
 *
 * The server runs this so the web app is useful on its own and so push alerts
 * can fire without the phone being awake. When the iOS companion is present it
 * re-ranks the top slice with Apple Foundation Models, which understands the
 * *meaning* of the user's open work rather than its vocabulary; the AFM score
 * replaces `semantic` and the row's `engine` flips to `afm`.
 *
 * Every score keeps its component signals so the UI can explain itself.
 */
export function scoreItemAgainstTopics(
  item: Pick<InfoItem, 'id' | 'title' | 'summaryRaw' | 'contentText' | 'authors' | 'venue' | 'publishedAt' | 'fetchedAt' | 'sourceId'>,
  topics: Topic[],
  sources: Source[] = [],
  options: RankOptions = {},
): ScoredItem[] {
  const { now = new Date(), recencyHalfLifeDays = 5, feedback } = options;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const text = itemText(item);
  const tokens = tokenize(text);
  const itemVector = termFrequency(tokens);
  const tokenSet = new Set(tokens);

  const source = sources.find((s) => s.id === item.sourceId);
  const sourceWeight = source ? Math.min(1, source.weight / 1.5) : 0.6;

  const publishedMs = item.publishedAt ? Date.parse(item.publishedAt) : Date.parse(item.fetchedAt);
  const ageDays = Math.max(0, (now.getTime() - publishedMs) / DAY_MS);
  const recency = Math.pow(0.5, ageDays / recencyHalfLifeDays);

  const results: ScoredItem[] = [];

  for (const topic of topics.filter((t) => t.active)) {
    const index = indexTopic(topic);

    let vetoed = false;
    for (const term of index.excluded) {
      if (tokenSet.has(term)) {
        vetoed = true;
        break;
      }
    }
    if (vetoed) continue;

    const matchedTerms = [...index.terms].filter((t) => tokenSet.has(t));
    if (matchedTerms.length === 0 && index.terms.size > 0) {
      const semanticOnly = cosineSimilarity(itemVector, index.vector);
      if (semanticOnly < 0.08) continue;
    }

    const keyword = index.terms.size === 0 ? 0 : Math.min(1, matchedTerms.length / Math.min(index.terms.size, 4));
    // Title hits are worth more than body hits.
    const titleTokens = new Set(tokenize(item.title));
    const titleHits = matchedTerms.filter((t) => titleTokens.has(t)).length;
    const keywordBoosted = Math.min(1, keyword + titleHits * 0.15);

    const semantic = cosineSimilarity(itemVector, index.vector);
    const topicWeight = Math.min(1, topic.weight / 1.5);
    const feedbackSignal = feedback?.get(topic.id) ?? 0;

    const signals: RelevanceSignals = {
      keyword: round(keywordBoosted),
      semantic: round(semantic),
      recency: round(recency),
      sourceWeight: round(sourceWeight),
      topicWeight: round(topicWeight),
      feedback: round(feedbackSignal),
    };

    const base =
      weights.keyword * keywordBoosted +
      weights.semantic * semantic +
      weights.recency * recency +
      weights.source * sourceWeight;

    const score = clamp01(base * (0.6 + 0.4 * topicWeight) + feedbackSignal * 0.1);

    results.push({
      itemId: item.id,
      topicId: topic.id,
      score: round(score),
      signals,
      matchedTerms: matchedTerms.slice(0, 12),
      explanation: explain(topic.label, signals, matchedTerms),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

function explain(topicLabel: string, signals: RelevanceSignals, matchedTerms: string[]): string {
  const parts: string[] = [];
  if (matchedTerms.length) {
    parts.push(`matches "${topicLabel}" on ${matchedTerms.slice(0, 4).join(', ')}`);
  } else {
    parts.push(`related to "${topicLabel}" by overall wording`);
  }
  if (signals.recency > 0.7) parts.push('published very recently');
  else if (signals.recency < 0.2) parts.push('older than your usual window');
  if (signals.sourceWeight > 0.8) parts.push('from a source you rated highly');
  if (signals.feedback > 0) parts.push('similar to items you saved before');
  if (signals.feedback < 0) parts.push('similar to items you dismissed before');
  return parts.join('; ');
}

/** Best score per item, for the single "relevance" number shown in lists. */
export function bestScorePerItem(scores: ScoredItem[]): Map<string, ScoredItem> {
  const best = new Map<string, ScoredItem>();
  for (const score of scores) {
    const current = best.get(score.itemId);
    if (!current || score.score > current.score) best.set(score.itemId, score);
  }
  return best;
}

/**
 * Learn a per-topic feedback signal from library actions. Saving an item pulls
 * its topics up, dismissing pushes them down; the value is bounded so feedback
 * nudges rather than dominates.
 */
export function feedbackFromHistory(
  history: Array<{ topicId: string | null; state: 'saved' | 'dismissed' | 'read' }>,
): Map<string, number> {
  const totals = new Map<string, { positive: number; negative: number }>();
  for (const row of history) {
    if (!row.topicId) continue;
    const entry = totals.get(row.topicId) ?? { positive: 0, negative: 0 };
    if (row.state === 'saved') entry.positive += 1;
    else if (row.state === 'dismissed') entry.negative += 1;
    else entry.positive += 0.25;
    totals.set(row.topicId, entry);
  }
  const out = new Map<string, number>();
  for (const [topicId, { positive, negative }] of totals) {
    const total = positive + negative;
    if (total < 3) continue; // not enough evidence yet
    out.set(topicId, round(Math.max(-1, Math.min(1, (positive - negative) / total))));
  }
  return out;
}

/** Items above the alert threshold deserve a realtime push, not just a digest. */
export function selectRealtimeAlerts(scores: ScoredItem[], threshold: number): ScoredItem[] {
  return [...bestScorePerItem(scores).values()].filter((s) => s.score >= threshold).sort((a, b) => b.score - a.score);
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
