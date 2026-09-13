import type { InfoItem } from '../domain/index.js';
import { slugify } from '../util/id.js';

/**
 * BibTeX / RIS export for the research library.
 *
 * Field choice follows what reference managers actually need; `note` carries
 * the Cortex id so a re-import can be matched back to the library entry.
 */

const BIBTEX_ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, '\\textbackslash{}'],
  [/([&%$#_{}])/g, '\\$1'],
  [/~/g, '\\textasciitilde{}'],
  [/\^/g, '\\textasciicircum{}'],
];

export function escapeBibtex(value: string): string {
  let out = value;
  for (const [re, replacement] of BIBTEX_ESCAPES) out = out.replace(re, replacement);
  return out;
}

function entryType(item: InfoItem): string {
  switch (item.kind) {
    case 'paper':
      return 'article';
    case 'preprint':
      return 'misc';
    case 'patent':
      return 'patent';
    case 'release':
    case 'announcement':
    case 'regulation':
      return 'misc';
    default:
      return 'online';
  }
}

export function bibtexKey(item: InfoItem): string {
  const firstAuthor = item.authors[0]?.split(/\s+/).pop() ?? 'anon';
  const year = item.publishedAt ? new Date(item.publishedAt).getUTCFullYear() : 'nd';
  const word = item.title.split(/\s+/).find((w) => w.length > 3) ?? 'item';
  return `${slugify(firstAuthor, 24)}${year}${slugify(word, 16)}`.replace(/-/g, '');
}

export function toBibtex(items: InfoItem[]): string {
  return items
    .map((item) => {
      const fields: Array<[string, string | null]> = [
        ['title', item.title],
        ['author', item.authors.length ? item.authors.join(' and ') : null],
        ['year', item.publishedAt ? String(new Date(item.publishedAt).getUTCFullYear()) : null],
        ['month', item.publishedAt ? monthAbbrev(new Date(item.publishedAt)) : null],
        ['journal', item.kind === 'paper' ? item.venue : null],
        ['howpublished', item.kind !== 'paper' ? item.venue : null],
        ['doi', item.doi],
        ['eprint', item.arxivId],
        ['archiveprefix', item.arxivId ? 'arXiv' : null],
        ['number', item.patentNumber],
        ['url', item.canonicalUrl ?? item.url],
        ['urldate', item.fetchedAt.slice(0, 10)],
        ['abstract', item.summaryRaw ? item.summaryRaw.replace(/\s+/g, ' ').slice(0, 4000) : null],
        ['note', `Cortex item ${item.id}`],
      ];
      const body = fields
        .filter((f): f is [string, string] => Boolean(f[1]))
        .map(([key, value]) => `  ${key} = {${escapeBibtex(value)}}`)
        .join(',\n');
      return `@${entryType(item)}{${bibtexKey(item)},\n${body}\n}`;
    })
    .join('\n\n') + (items.length ? '\n' : '');
}

const RIS_TYPES: Record<string, string> = {
  paper: 'JOUR',
  preprint: 'UNPB',
  article: 'ELEC',
  post: 'BLOG',
  release: 'COMP',
  patent: 'PAT',
  regulation: 'STAT',
  announcement: 'ELEC',
  thread: 'ELEC',
  other: 'GEN',
};

export function toRis(items: InfoItem[]): string {
  return items
    .map((item) => {
      const lines: string[] = [`TY  - ${RIS_TYPES[item.kind] ?? 'GEN'}`];
      lines.push(`TI  - ${item.title}`);
      for (const author of item.authors) lines.push(`AU  - ${author}`);
      if (item.publishedAt) {
        const d = new Date(item.publishedAt);
        lines.push(`PY  - ${d.getUTCFullYear()}`);
        lines.push(`DA  - ${d.toISOString().slice(0, 10).replace(/-/g, '/')}`);
      }
      if (item.venue) lines.push(`JO  - ${item.venue}`);
      if (item.doi) lines.push(`DO  - ${item.doi}`);
      if (item.summaryRaw) lines.push(`AB  - ${item.summaryRaw.replace(/\s+/g, ' ').slice(0, 4000)}`);
      lines.push(`UR  - ${item.canonicalUrl ?? item.url}`);
      lines.push(`ID  - ${item.id}`);
      lines.push('ER  - ');
      return lines.join('\n');
    })
    .join('\n\n') + (items.length ? '\n' : '');
}

function monthAbbrev(date: Date): string {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][date.getUTCMonth()] ?? 'jan';
}
