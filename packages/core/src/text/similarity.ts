import { termFrequency, tokenize } from './tokenize.js';

/**
 * Bag-of-words cosine similarity.
 *
 * This is the *fallback* semantic signal. On iOS the same comparison is done by
 * Apple Foundation Models with real language understanding; here we need
 * something deterministic that runs anywhere, including inside a Deno edge
 * function, with no model weights and no network call.
 */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) dot += weight * other;
  }
  if (dot === 0) return 0;
  let magA = 0;
  for (const v of a.values()) magA += v * v;
  let magB = 0;
  for (const v of b.values()) magB += v * v;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function textSimilarity(a: string, b: string): number {
  return cosineSimilarity(termFrequency(tokenize(a)), termFrequency(tokenize(b)));
}

export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const v of sa) if (sb.has(v)) intersection += 1;
  return intersection / (sa.size + sb.size - intersection);
}

/** Normalised Levenshtein similarity, used for fuzzy title dedupe. */
export function titleSimilarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const y = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  const max = Math.max(x.length, y.length);
  if (max > 400) return x.slice(0, 200) === y.slice(0, 200) ? 0.9 : 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return 1 - (prev[y.length] ?? max) / max;
}
