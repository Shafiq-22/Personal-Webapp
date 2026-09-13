import { normalizeTerm, stem, tokenize } from './tokenize.js';
import { isStopword } from './stopwords.js';

export interface Keyword {
  term: string;
  score: number;
  /** How many source documents contained it. */
  documentCount: number;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}+#.\-_]*/gu;

/**
 * RAKE-style candidate phrases: runs of non-stopword tokens delimited by stop
 * words and punctuation. Phrases beat single words for topic labels
 * ("solid state battery" is a topic, "battery" is a word).
 */
export function candidatePhrases(text: string, maxWords = 4): string[] {
  const phrases: string[] = [];
  for (const sentence of text.split(/[.!?;:\n\r()[\]{}"|]+/)) {
    let current: string[] = [];
    for (const match of sentence.matchAll(WORD_RE)) {
      const raw = normalizeTerm(match[0]);
      if (raw.length < 3 || isStopword(raw) || /^\d+$/.test(raw)) {
        if (current.length) phrases.push(current.join(' '));
        current = [];
      } else {
        current.push(raw);
        if (current.length === maxWords) {
          phrases.push(current.join(' '));
          current = current.slice(1);
        }
      }
    }
    if (current.length) phrases.push(current.join(' '));
  }
  return phrases;
}

/**
 * Extract ranked keywords/keyphrases from a corpus.
 *
 * Scoring combines RAKE degree/frequency with a document-frequency bonus so a
 * phrase that shows up across several tasks outranks one mentioned five times
 * in a single note.
 */
export function extractKeywords(documents: string[], limit = 12): Keyword[] {
  const degree = new Map<string, number>();
  const frequency = new Map<string, number>();
  const docCount = new Map<string, number>();
  const phraseScore = new Map<string, number>();
  const phraseDocs = new Map<string, Set<number>>();

  documents.forEach((doc, docIndex) => {
    const seenWords = new Set<string>();
    for (const phrase of candidatePhrases(doc)) {
      const words = phrase.split(' ');
      for (const w of words) {
        frequency.set(w, (frequency.get(w) ?? 0) + 1);
        degree.set(w, (degree.get(w) ?? 0) + words.length - 1);
        if (!seenWords.has(w)) {
          seenWords.add(w);
          docCount.set(w, (docCount.get(w) ?? 0) + 1);
        }
      }
      const docs = phraseDocs.get(phrase) ?? new Set<number>();
      docs.add(docIndex);
      phraseDocs.set(phrase, docs);
    }
  });

  for (const [phrase, docs] of phraseDocs) {
    const words = phrase.split(' ');
    let score = 0;
    for (const w of words) {
      const f = frequency.get(w) ?? 1;
      const d = (degree.get(w) ?? 0) + f;
      score += d / f;
    }
    // Multi-word phrases are more specific; multi-document phrases are more durable.
    score *= 1 + 0.25 * (words.length - 1);
    score *= 1 + 0.5 * (docs.size - 1);
    phraseScore.set(phrase, score);
  }

  const ranked = [...phraseScore.entries()]
    .map(([term, score]) => ({ term, score, documentCount: phraseDocs.get(term)?.size ?? 1 }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  // Drop phrases fully contained in a higher ranked phrase.
  const kept: Keyword[] = [];
  for (const cand of ranked) {
    if (kept.some((k) => k.term.includes(cand.term))) continue;
    kept.push(cand);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Stemmed term set for a keyword list, used when matching against items. */
export function expandKeywords(keywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const kw of keywords) {
    for (const t of tokenize(kw, { removeStopwords: false })) out.add(t);
    out.add(stem(normalizeTerm(kw)));
  }
  out.delete('');
  return out;
}
