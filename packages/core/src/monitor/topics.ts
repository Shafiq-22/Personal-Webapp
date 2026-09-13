import type { CalendarEvent, Project, Task, Topic, TopicOrigin } from '../domain/index.js';
import { extractKeywords } from '../text/keywords.js';
import { tokenize } from '../text/tokenize.js';
import { titleSimilarity } from '../text/similarity.js';
import { DAY_MS } from '../util/date.js';

export interface TopicCandidate {
  label: string;
  keywords: string[];
  origin: TopicOrigin;
  /** Ids of the tasks/events/notes that produced it. */
  derivedFrom: string[];
  /** 0-1 - how strongly the user's own work points at this topic. */
  weight: number;
  evidence: string[];
}

export interface VaultNote {
  /** Vault-relative path, used as the derivation id. */
  path: string;
  title: string;
  content: string;
  /** Obsidian `#tags` found in the note. */
  tags?: string[];
  modifiedAt?: string;
}

export interface ExtractTopicsOptions {
  now?: Date;
  /** Only consider events/notes touched within this many days. */
  lookbackDays?: number;
  maxTopics?: number;
  /** Minimum weight a candidate needs to be worth proposing. */
  minWeight?: number;
}

/**
 * Derive monitoring topics from the user's own work.
 *
 * This is the feature that makes the feed feel personal: instead of asking the
 * user to describe their interests, Cortex reads what they are *actually* doing
 * - open tasks, the last few weeks of calendar events and (only with explicit
 * permission) their Obsidian notes - and proposes topics from that.
 *
 * Proposals are never activated silently; the settings UI shows each candidate
 * with the evidence that produced it and the user accepts or rejects.
 */
export function extractTopicCandidates(
  input: {
    tasks?: Task[];
    projects?: Project[];
    events?: CalendarEvent[];
    notes?: VaultNote[];
  },
  options: ExtractTopicsOptions = {},
): TopicCandidate[] {
  const { now = new Date(), lookbackDays = 30, maxTopics = 20, minWeight = 0.15 } = options;
  const horizon = now.getTime() - lookbackDays * DAY_MS;

  const buckets: Array<{ origin: TopicOrigin; docs: Array<{ id: string; text: string; weight: number }> }> = [];

  const openTasks = (input.tasks ?? []).filter((t) => t.status === 'todo' || t.status === 'in_progress');
  if (openTasks.length) {
    const projectsById = new Map((input.projects ?? []).map((p) => [p.id, p]));
    buckets.push({
      origin: 'task',
      docs: openTasks.map((t) => ({
        id: t.id,
        text: [t.title, t.notes ?? '', t.projectId ? (projectsById.get(t.projectId)?.name ?? '') : ''].join('. '),
        // Urgent and in-flight work should steer the feed harder.
        weight: t.priority === 'p1' ? 1.3 : t.priority === 'p2' ? 1.1 : 1,
      })),
    });
  }

  const recentEvents = (input.events ?? []).filter(
    (e) => e.status !== 'cancelled' && Date.parse(e.startAt) >= horizon && Date.parse(e.startAt) <= now.getTime() + 14 * DAY_MS,
  );
  if (recentEvents.length) {
    buckets.push({
      origin: 'calendar',
      docs: recentEvents.map((e) => ({
        id: e.id,
        text: [e.title, e.description ?? ''].join('. '),
        weight: e.attendeeCount > 1 ? 1.1 : 0.9,
      })),
    });
  }

  const notes = (input.notes ?? []).filter((n) => !n.modifiedAt || Date.parse(n.modifiedAt) >= horizon);
  if (notes.length) {
    buckets.push({
      origin: 'obsidian',
      docs: notes.map((n) => ({
        id: n.path,
        text: [n.title, (n.tags ?? []).join(' '), n.content.slice(0, 8000)].join('. '),
        weight: 1,
      })),
    });
  }

  const candidates = new Map<string, TopicCandidate>();

  for (const bucket of buckets) {
    const keywords = extractKeywords(
      bucket.docs.map((d) => d.text),
      maxTopics,
    );
    const maxScore = keywords[0]?.score ?? 1;

    for (const keyword of keywords) {
      const terms = new Set(tokenize(keyword.term, { removeStopwords: false }));
      const matching = bucket.docs.filter((doc) => {
        const docTerms = new Set(tokenize(doc.text));
        for (const t of terms) if (docTerms.has(t)) return true;
        return false;
      });
      if (matching.length === 0) continue;

      const evidenceWeight = matching.reduce((sum, d) => sum + d.weight, 0) / Math.max(1, bucket.docs.length);
      const normalized = Math.min(1, (keyword.score / (maxScore || 1)) * 0.6 + evidenceWeight * 0.6);
      if (normalized < minWeight) continue;

      const key = keyword.term;
      const existing = candidates.get(key);
      const candidate: TopicCandidate = existing ?? {
        label: titleCase(keyword.term),
        keywords: [keyword.term, ...keyword.term.split(' ').filter((w) => w.length > 4)].slice(0, 8),
        origin: bucket.origin,
        derivedFrom: [],
        weight: 0,
        evidence: [],
      };
      candidate.derivedFrom = [...new Set([...candidate.derivedFrom, ...matching.map((d) => d.id)])].slice(0, 25);
      candidate.weight = Math.min(1, candidate.weight + normalized);
      candidate.evidence = [
        ...new Set([
          ...candidate.evidence,
          ...matching.slice(0, 3).map((d) => d.text.split('.')[0]?.trim().slice(0, 120) ?? ''),
        ]),
      ]
        .filter(Boolean)
        .slice(0, 5);
      candidates.set(key, candidate);
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, maxTopics);
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Merge new candidates against existing topics: refresh `lastSeenAt` and
 * keywords for ones we already track, and return only the genuinely new.
 */
export interface TopicReconciliation {
  created: TopicCandidate[];
  refreshed: Array<{ topicId: string; keywords: string[]; weight: number; derivedFrom: string[] }>;
  /** Auto topics whose originating work has vanished. */
  stale: Array<{ topicId: string; label: string; lastSeenAt: string | null }>;
}

export function reconcileTopics(
  existing: Topic[],
  candidates: TopicCandidate[],
  options: { now?: Date; staleAfterDays?: number } = {},
): TopicReconciliation {
  const { now = new Date(), staleAfterDays = 45 } = options;
  const created: TopicCandidate[] = [];
  const refreshed: TopicReconciliation['refreshed'] = [];
  const matchedIds = new Set<string>();

  for (const candidate of candidates) {
    const match = existing.find(
      (t) =>
        t.label.toLowerCase() === candidate.label.toLowerCase() ||
        titleSimilarity(t.label, candidate.label) > 0.85 ||
        t.keywords.some((k) => candidate.keywords.includes(k.toLowerCase())),
    );
    if (match) {
      matchedIds.add(match.id);
      refreshed.push({
        topicId: match.id,
        keywords: [...new Set([...match.keywords, ...candidate.keywords])].slice(0, 12),
        weight: Math.min(2, Math.max(match.weight, candidate.weight * 1.2)),
        derivedFrom: [...new Set([...match.derivedFrom, ...candidate.derivedFrom])].slice(0, 40),
      });
    } else {
      created.push(candidate);
    }
  }

  const stale = existing
    .filter((t) => t.origin !== 'manual' && !matchedIds.has(t.id))
    .filter((t) => {
      if (!t.lastSeenAt) return false;
      return now.getTime() - Date.parse(t.lastSeenAt) > staleAfterDays * DAY_MS;
    })
    .map((t) => ({ topicId: t.id, label: t.label, lastSeenAt: t.lastSeenAt }));

  return { created, refreshed, stale };
}
