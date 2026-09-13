import type { ItemKind, SourceKind } from '../domain/monitor.js';
import { contentHash } from '../util/id.js';
import { err, ok, type Result } from '../util/result.js';
import { childText, findAll, parseXml, stripHtml, type XmlNode } from './xml.js';

export interface FeedEntry {
  externalId: string | null;
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  publishedAt: string | null;
  authors: string[];
  categories: string[];
  doi: string | null;
  arxivId: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  entries: FeedEntry[];
  /** `rss`, `atom` or `unknown` - useful for diagnostics in the sources UI. */
  format: 'rss' | 'atom' | 'unknown';
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  // Some feeds emit "2026-09-13 10:00:00" with no timezone.
  const patched = Date.parse(trimmed.replace(' ', 'T') + 'Z');
  return Number.isNaN(patched) ? null : new Date(patched).toISOString();
}

function entryLink(node: XmlNode): string {
  const links = node.children.filter((c) => c.localName === 'link');
  for (const link of links) {
    const rel = link.attributes['rel'];
    const href = link.attributes['href'];
    if (href && (!rel || rel === 'alternate')) return href;
  }
  for (const link of links) {
    if (link.text.trim()) return link.text.trim();
  }
  const guid = node.children.find((c) => c.localName === 'guid');
  if (guid && /^https?:\/\//i.test(guid.text.trim())) return guid.text.trim();
  const id = node.children.find((c) => c.localName === 'id');
  if (id && /^https?:\/\//i.test(id.text.trim())) return id.text.trim();
  return '';
}

function entryAuthors(node: XmlNode): string[] {
  const authors: string[] = [];
  for (const author of node.children.filter((c) => c.localName === 'author')) {
    const name = childText(author, 'name') || author.text.trim();
    if (name) authors.push(name);
  }
  for (const creator of node.children.filter((c) => c.localName === 'creator')) {
    const name = creator.text.trim();
    if (name) authors.push(name);
  }
  // "A. Smith, B. Jones" in a single dc:creator
  return [...new Set(authors.flatMap((a) => (a.includes(';') ? a.split(';') : [a])).map((a) => a.trim()).filter(Boolean))];
}

function entryCategories(node: XmlNode): string[] {
  const out: string[] = [];
  for (const cat of node.children.filter((c) => c.localName === 'category')) {
    const term = cat.attributes['term'] ?? cat.text.trim();
    if (term) out.push(term);
  }
  return [...new Set(out)];
}

const ARXIV_ID_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/[0-9]{7}(?:v\d+)?)/i;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/;

/** Parse an RSS 2.0 / Atom 1.0 / RDF feed document. */
export function parseFeed(xml: string): Result<ParsedFeed> {
  if (!xml || !xml.includes('<')) return err('response did not look like XML');
  const root = parseXml(xml);

  const channel = findAll(root, 'channel')[0] ?? null;
  const feedNode = findAll(root, 'feed')[0] ?? null;
  const entryNodes = [...findAll(root, 'item'), ...findAll(root, 'entry')];
  if (entryNodes.length === 0) return err('feed contained no <item> or <entry> elements');

  const format: ParsedFeed['format'] = feedNode ? 'atom' : channel ? 'rss' : 'unknown';
  const container = channel ?? feedNode;

  const entries: FeedEntry[] = [];
  for (const node of entryNodes) {
    const title = stripHtml(childText(node, 'title')) || '(untitled)';
    const url = entryLink(node);
    if (!url) continue;

    const rawSummary = childText(node, 'summary', 'description', 'subtitle');
    const rawContent = childText(node, 'content', 'encoded');
    const published =
      normalizeDate(childText(node, 'published', 'pubdate', 'date', 'updated', 'created')) ?? null;

    const idText = childText(node, 'guid', 'id') || null;
    const combined = `${url} ${idText ?? ''} ${rawSummary}`;
    const arxivMatch = ARXIV_ID_RE.exec(combined);
    const doiMatch = DOI_RE.exec(`${childText(node, 'doi')} ${combined}`);

    entries.push({
      externalId: idText,
      title,
      url,
      summary: rawSummary ? stripHtml(rawSummary).slice(0, 20_000) : null,
      content: rawContent ? stripHtml(rawContent).slice(0, 200_000) : null,
      publishedAt: published,
      authors: entryAuthors(node),
      categories: entryCategories(node),
      doi: doiMatch?.[1] ?? null,
      arxivId: arxivMatch?.[1] ?? null,
    });
  }

  return ok({
    title: container ? stripHtml(childText(container, 'title')) || 'Untitled feed' : 'Untitled feed',
    siteUrl: container ? (entryLink(container) || null) : null,
    entries,
    format,
  });
}

const KIND_BY_SOURCE: Partial<Record<SourceKind, ItemKind>> = {
  arxiv: 'preprint',
  biorxiv: 'preprint',
  pubmed: 'paper',
  scholar_alert: 'paper',
  patents: 'patent',
  regulatory: 'regulation',
  company_news: 'announcement',
  github_releases: 'release',
  forum: 'thread',
  news: 'article',
  blog: 'post',
  rss: 'article',
  atom: 'article',
  web_page: 'article',
  json_api: 'other',
  x_list: 'post',
};

export function itemKindFor(sourceKind: SourceKind, entry: FeedEntry): ItemKind {
  if (entry.arxivId) return 'preprint';
  if (entry.doi) return 'paper';
  return KIND_BY_SOURCE[sourceKind] ?? 'article';
}

/** Strip tracking parameters so the same article from two feeds dedupes. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'source', 'at_medium', 'at_campaign',
]);

export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    const keys: string[] = [];
    url.searchParams.forEach((_value, key) => keys.push(key));
    for (const key of keys) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    // arXiv: abs and pdf are the same work, and version suffixes churn.
    const arxiv = ARXIV_ID_RE.exec(url.href);
    if (arxiv?.[1]) return `https://arxiv.org/abs/${arxiv[1].replace(/v\d+$/i, '')}`;
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return raw.trim();
  }
}

export interface NormalizedItem {
  sourceId: string | null;
  kind: ItemKind;
  externalId: string | null;
  url: string;
  canonicalUrl: string;
  title: string;
  authors: string[];
  summaryRaw: string | null;
  contentText: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  doi: string | null;
  arxivId: string | null;
  venue: string | null;
  patentNumber: string | null;
  language: string;
  contentHash: string;
  raw: Record<string, unknown>;
}

export interface NormalizeOptions {
  sourceId: string | null;
  sourceKind: SourceKind;
  sourceName?: string;
  fetchedAt?: Date;
  /** Off when the user disabled full-content storage. */
  storeContent?: boolean;
}

export function normalizeEntry(entry: FeedEntry, options: NormalizeOptions): NormalizedItem {
  const { sourceId, sourceKind, fetchedAt = new Date(), storeContent = true } = options;
  const canonical = canonicalizeUrl(entry.url);
  const patent = /\b([A-Z]{2}\s?\d{6,}(?:\s?[A-Z]\d?)?)\b/.exec(sourceKind === 'patents' ? entry.title : '');

  return {
    sourceId,
    kind: itemKindFor(sourceKind, entry),
    externalId: entry.externalId,
    url: entry.url,
    canonicalUrl: canonical,
    title: entry.title.replace(/\s+/g, ' ').trim().slice(0, 1000),
    authors: entry.authors.slice(0, 40),
    summaryRaw: entry.summary?.slice(0, 20_000) ?? null,
    contentText: storeContent ? (entry.content?.slice(0, 200_000) ?? null) : null,
    publishedAt: entry.publishedAt,
    fetchedAt: fetchedAt.toISOString(),
    doi: entry.doi,
    arxivId: entry.arxivId?.replace(/v\d+$/i, '') ?? null,
    venue: options.sourceName ?? null,
    patentNumber: patent?.[1]?.replace(/\s+/g, '') ?? null,
    language: 'en',
    contentHash: contentHash(canonical, entry.title.toLowerCase().replace(/\s+/g, ' ').trim()),
    raw: { categories: entry.categories, sourceKind },
  };
}

/** Drop entries already seen, by content hash and near-duplicate title. */
export function dedupe(items: NormalizedItem[], knownHashes: Iterable<string> = []): NormalizedItem[] {
  const seen = new Set(knownHashes);
  const out: NormalizedItem[] = [];
  for (const item of items) {
    if (seen.has(item.contentHash)) continue;
    seen.add(item.contentHash);
    out.push(item);
  }
  return out;
}

/** Build an arXiv API query URL from a topic's keywords. */
export function arxivQueryUrl(categories: string[], keywords: string[], maxResults = 50): string {
  const catQuery = categories.map((c) => `cat:${c}`).join('+OR+');
  const kwQuery = keywords
    .map((k) => `all:%22${encodeURIComponent(k).replace(/%20/g, '+')}%22`)
    .join('+OR+');
  const parts = [catQuery, kwQuery].filter(Boolean).map((p) => `%28${p}%29`);
  const search = parts.join('+AND+') || 'all:*';
  return `https://export.arxiv.org/api/query?search_query=${search}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
}
