import { isStopword } from './stopwords.js';

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}+#.\-_]*/gu;

export interface TokenizeOptions {
  /** Drop stop words (default true). */
  removeStopwords?: boolean;
  /** Minimum token length kept (default 2). */
  minLength?: number;
  /** Apply the light suffix stemmer (default true). */
  stem?: boolean;
}

/**
 * Very light Porter-ish stemmer. Full Porter is overkill here and its
 * aggressive truncation hurts scientific vocabulary ("polymerase" -> "polymeras").
 * This only folds the endings that actually matter for matching.
 */
export function stem(term: string): string {
  let t = term;
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('sses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('ses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed') && !t.endsWith('eed')) t = t.slice(0, -2);
  return t;
}

export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[.\-_]+|[.\-_]+$/g, '');
}

export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const { removeStopwords = true, minLength = 2, stem: useStem = true } = options;
  const out: string[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const raw = normalizeTerm(match[0]);
    if (raw.length < minLength) continue;
    if (removeStopwords && isStopword(raw)) continue;
    const term = useStem ? stem(raw) : raw;
    if (term.length < minLength) continue;
    if (removeStopwords && isStopword(term)) continue;
    out.push(term);
  }
  return out;
}

/** Contiguous n-grams over the *unstemmed* token stream, for phrase matching. */
export function ngrams(text: string, n: number): string[] {
  const words = tokenize(text, { removeStopwords: false, stem: false });
  if (words.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - n; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}
