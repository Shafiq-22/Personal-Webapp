import type { SummaryStyle } from './domain/monitor.js';
import { tokenize, termFrequency } from './text/tokenize.js';

/**
 * Extractive fallback summarizer.
 *
 * **This is not an LLM and does not pretend to be one.** Real summarization in
 * Cortex happens on the iPhone with Apple Foundation Models - abstractive,
 * style-aware, offline. This module exists so the web app can still show
 * *something* useful for an item when no device has processed it yet, and so
 * the UI always has a non-AI path. Anything produced here is tagged
 * `engine: 'heuristic'` and labelled as an extract in the interface, never
 * presented as a written summary.
 */

export interface ExtractOptions {
  maxSentences?: number;
  /** Terms from the user's topics; sentences containing them rank higher. */
  queryTerms?: string[];
  maxChars?: number;
}

const SENTENCE_RE = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return (cleaned.match(SENTENCE_RE) ?? [cleaned])
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

/**
 * TextRank-lite: score sentences by the summed frequency of the terms they
 * contain, normalised by length, with a bonus for position and query overlap.
 */
export function extractiveSummary(text: string, options: ExtractOptions = {}): string {
  const { maxSentences = 3, queryTerms = [], maxChars = 800 } = options;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';
  if (sentences.length <= maxSentences) return sentences.join(' ').slice(0, maxChars);

  const corpusFreq = termFrequency(tokenize(text));
  const query = new Set(queryTerms.flatMap((t) => tokenize(t, { removeStopwords: false })));

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenize(sentence);
    if (tokens.length === 0) return { sentence, index, score: 0 };
    let score = 0;
    for (const token of tokens) {
      score += corpusFreq.get(token) ?? 0;
      if (query.has(token)) score += 3;
    }
    score /= Math.sqrt(tokens.length);
    // Abstracts front-load their thesis.
    if (index === 0) score *= 1.3;
    else if (index < 3) score *= 1.1;
    return { sentence, index, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence)
    .join(' ')
    .slice(0, maxChars);
}

/** Shape the extract to roughly match what each AFM style would produce. */
export function extractForStyle(text: string, style: SummaryStyle, options: ExtractOptions = {}): string {
  switch (style) {
    case 'tldr':
      return extractiveSummary(text, { ...options, maxSentences: 2, maxChars: 400 });
    case 'key_points': {
      const points = splitSentences(extractiveSummary(text, { ...options, maxSentences: 5, maxChars: 1200 }));
      return points.map((p) => `- ${p}`).join('\n');
    }
    case 'methodology': {
      const methodSentences = splitSentences(text).filter((s) =>
        /\b(method|approach|we (?:use|used|propose|train|evaluate)|dataset|experiment|protocol|cohort|sample size|procedure)\b/i.test(s),
      );
      return methodSentences.length
        ? methodSentences.slice(0, 4).map((p) => `- ${p}`).join('\n')
        : extractiveSummary(text, { ...options, maxSentences: 3 });
    }
    case 'implications':
    case 'actions': {
      const actionable = splitSentences(text).filter((s) =>
        /\b(should|implies|suggests|enables|requires|recommend|impact|consequence|applies|means that)\b/i.test(s),
      );
      return actionable.length
        ? actionable.slice(0, 4).map((p) => `- ${p}`).join('\n')
        : extractiveSummary(text, { ...options, maxSentences: 3 });
    }
    case 'eli5':
      // There is no honest extractive ELI5 - say so rather than fake it.
      return '';
    default:
      return extractiveSummary(text, options);
  }
}

/** Which styles the non-AI path can serve at all. */
export const HEURISTIC_STYLES: SummaryStyle[] = ['tldr', 'key_points', 'methodology', 'implications', 'actions'];

export function canExtractStyle(style: SummaryStyle): boolean {
  return HEURISTIC_STYLES.includes(style);
}
