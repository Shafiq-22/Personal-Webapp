import { z } from 'zod';
import { AiEngine, isoDateTime, Origin, uuid } from './primitives.js';

/**
 * Cortex treats "the internet" as a set of typed adapters. Each kind knows how
 * to turn a configured endpoint into normalised `InfoItem`s.
 */
export const SourceKind = z.enum([
  'rss',
  'atom',
  'arxiv',
  'pubmed',
  'biorxiv',
  'scholar_alert',
  'news',
  'blog',
  'forum',
  'regulatory',
  'patents',
  'company_news',
  'x_list',
  'github_releases',
  'web_page',
  'json_api',
]);
export type SourceKind = z.infer<typeof SourceKind>;

/** Adapters that are plain feed fetches versus ones needing a dedicated client. */
export const FEED_LIKE_SOURCES: SourceKind[] = [
  'rss',
  'atom',
  'arxiv',
  'biorxiv',
  'scholar_alert',
  'news',
  'blog',
  'forum',
  'regulatory',
  'patents',
  'company_news',
  'github_releases',
];

export const Source = z.object({
  id: uuid,
  userId: uuid,
  kind: SourceKind,
  name: z.string().min(1).max(300),
  /** Feed or page URL. For `arxiv` this may be a category query URL. */
  url: z.string().url(),
  /** Adapter-specific knobs: arXiv categories, CSS selector, query string, ... */
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  /** Trust/quality multiplier applied during ranking (0.5 - 1.5). */
  weight: z.number().min(0.1).max(2).default(1),
  fetchIntervalMinutes: z.number().int().min(15).max(10_080).default(180),
  lastFetchedAt: isoDateTime.nullable().default(null),
  lastStatus: z.enum(['ok', 'error', 'never']).default('never'),
  lastError: z.string().max(2000).nullable().default(null),
  etag: z.string().nullable().default(null),
  createdAt: isoDateTime,
});
export type Source = z.infer<typeof Source>;

export const SourceInput = Source.pick({ kind: true, name: true, url: true, config: true, weight: true, fetchIntervalMinutes: true })
  .partial({ config: true, weight: true, fetchIntervalMinutes: true });
export type SourceInput = z.infer<typeof SourceInput>;

/**
 * A topic is the user's standing interest. Topics are either declared by hand or
 * derived automatically from open tasks, recent calendar events and (with
 * explicit permission) Obsidian notes.
 */
export const TopicOrigin = z.enum(['manual', 'task', 'calendar', 'obsidian', 'item_feedback']);
export type TopicOrigin = z.infer<typeof TopicOrigin>;

export const Topic = z.object({
  id: uuid,
  userId: uuid,
  label: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1).max(80)).default([]),
  /** Terms that veto an item outright. */
  excludeKeywords: z.array(z.string().min(1).max(80)).default([]),
  origin: TopicOrigin.default('manual'),
  /** Ids of the tasks/events/notes that produced an auto topic. */
  derivedFrom: z.array(z.string()).default([]),
  weight: z.number().min(0).max(2).default(1),
  active: z.boolean().default(true),
  /** Auto topics decay if their originating work disappears. */
  lastSeenAt: isoDateTime.nullable().default(null),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Topic = z.infer<typeof Topic>;

export const ItemKind = z.enum(['paper', 'preprint', 'article', 'post', 'release', 'patent', 'regulation', 'announcement', 'thread', 'other']);
export type ItemKind = z.infer<typeof ItemKind>;

/** A normalised piece of "latest information" from anywhere on the internet. */
export const InfoItem = z.object({
  id: uuid,
  userId: uuid,
  sourceId: uuid.nullable().default(null),
  kind: ItemKind.default('article'),
  externalId: z.string().max(500).nullable().default(null),
  url: z.string().url(),
  canonicalUrl: z.string().url().nullable().default(null),
  title: z.string().min(1).max(1000),
  authors: z.array(z.string().max(200)).default([]),
  summaryRaw: z.string().max(20_000).nullable().default(null),
  contentText: z.string().max(200_000).nullable().default(null),
  publishedAt: isoDateTime.nullable().default(null),
  fetchedAt: isoDateTime,
  /** Bibliographic extras, present for papers/patents. */
  doi: z.string().max(200).nullable().default(null),
  arxivId: z.string().max(64).nullable().default(null),
  venue: z.string().max(300).nullable().default(null),
  patentNumber: z.string().max(64).nullable().default(null),
  language: z.string().max(16).default('en'),
  /** Stable dedupe key across sources (canonical url + title). */
  contentHash: z.string().length(16),
  origin: Origin.default('feed'),
  raw: z.record(z.unknown()).default({}),
});
export type InfoItem = z.infer<typeof InfoItem>;

export const ItemState = z.enum(['new', 'read', 'saved', 'dismissed', 'snoozed']);
export type ItemState = z.infer<typeof ItemState>;

/** Per-user reading state and library metadata for an item. */
export const ItemUserState = z.object({
  id: uuid,
  userId: uuid,
  itemId: uuid,
  state: ItemState.default('new'),
  notes: z.string().max(20_000).nullable().default(null),
  tags: z.array(z.string().max(64)).default([]),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  snoozedUntil: isoDateTime.nullable().default(null),
  readAt: isoDateTime.nullable().default(null),
  savedAt: isoDateTime.nullable().default(null),
  createdTaskId: uuid.nullable().default(null),
  updatedAt: isoDateTime,
});
export type ItemUserState = z.infer<typeof ItemUserState>;

/** Explainable relevance: every score keeps the signals that produced it. */
export const RelevanceSignals = z.object({
  keyword: z.number(),
  semantic: z.number(),
  recency: z.number(),
  sourceWeight: z.number(),
  topicWeight: z.number(),
  feedback: z.number().default(0),
});
export type RelevanceSignals = z.infer<typeof RelevanceSignals>;

export const ItemScore = z.object({
  id: uuid,
  userId: uuid,
  itemId: uuid,
  topicId: uuid.nullable().default(null),
  score: z.number().min(0).max(1),
  signals: RelevanceSignals,
  matchedTerms: z.array(z.string()).default([]),
  /** `afm` when the iPhone re-ranked it on device, `heuristic` for the server pass. */
  engine: AiEngine.default('heuristic'),
  explanation: z.string().max(1000).nullable().default(null),
  createdAt: isoDateTime,
});
export type ItemScore = z.infer<typeof ItemScore>;

export const SummaryStyle = z.enum(['tldr', 'key_points', 'implications', 'eli5', 'methodology', 'actions']);
export type SummaryStyle = z.infer<typeof SummaryStyle>;

export const ALL_SUMMARY_STYLES: SummaryStyle[] = ['tldr', 'key_points', 'implications', 'eli5', 'methodology', 'actions'];

export const SUMMARY_STYLE_LABELS: Record<SummaryStyle, string> = {
  tldr: 'TL;DR',
  key_points: 'Key points',
  implications: 'Practical implications',
  eli5: 'Explain like I am five',
  methodology: 'Methodology',
  actions: 'Actionable takeaways',
};

/**
 * Summaries are produced **on device** by Apple Foundation Models and uploaded
 * only when the user has enabled summary sync. `engine` records which model
 * produced the text so the UI can be honest about provenance.
 */
export const ItemSummary = z.object({
  id: uuid,
  userId: uuid,
  itemId: uuid,
  style: SummaryStyle,
  text: z.string().min(1).max(20_000),
  engine: AiEngine.default('afm'),
  modelIdentifier: z.string().max(120).nullable().default(null),
  deviceId: uuid.nullable().default(null),
  createdAt: isoDateTime,
});
export type ItemSummary = z.infer<typeof ItemSummary>;

export const DigestPeriod = z.enum(['daily', 'weekly', 'realtime']);
export type DigestPeriod = z.infer<typeof DigestPeriod>;

export const DigestEntry = z.object({
  itemId: uuid,
  title: z.string(),
  url: z.string(),
  score: z.number(),
  topicLabels: z.array(z.string()).default([]),
  reason: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
});
export type DigestEntry = z.infer<typeof DigestEntry>;

export const Digest = z.object({
  id: uuid,
  userId: uuid,
  period: DigestPeriod,
  windowStart: isoDateTime,
  windowEnd: isoDateTime,
  entries: z.array(DigestEntry).default([]),
  itemCount: z.number().int().min(0).default(0),
  headline: z.string().max(500).nullable().default(null),
  deliveredAt: isoDateTime.nullable().default(null),
  createdAt: isoDateTime,
});
export type Digest = z.infer<typeof Digest>;
