/**
 * Runs inside the page to pull out what is worth saving.
 *
 * Deliberately no readability library: the metadata publishers already provide
 * (citation_* meta tags, JSON-LD, Open Graph) is more reliable than heuristic
 * article extraction, and for the sources Cortex cares about most - papers,
 * preprints, standards - it is exactly right.
 */
export function extractPageData() {
  const meta = (selector, attribute = 'content') => document.querySelector(selector)?.getAttribute(attribute)?.trim() || null;

  const metaAll = (selector) =>
    [...document.querySelectorAll(selector)].map((node) => node.getAttribute('content')?.trim()).filter(Boolean);

  // Scholarly metadata first, then Open Graph, then the document itself.
  const title =
    meta('meta[name="citation_title"]') ||
    meta('meta[property="og:title"]') ||
    document.title ||
    location.href;

  const authors = [
    ...metaAll('meta[name="citation_author"]'),
    ...metaAll('meta[name="dc.creator"]'),
    ...metaAll('meta[property="article:author"]'),
  ];

  const summary =
    meta('meta[name="citation_abstract"]') ||
    meta('meta[name="description"]') ||
    meta('meta[property="og:description"]');

  const doi = meta('meta[name="citation_doi"]') || meta('meta[name="dc.identifier"]');
  const publishedAt =
    meta('meta[name="citation_publication_date"]') ||
    meta('meta[property="article:published_time"]') ||
    meta('meta[name="dc.date"]');
  const venue = meta('meta[name="citation_journal_title"]') || meta('meta[property="og:site_name"]');

  const selection = window.getSelection()?.toString().trim() || null;

  // Body text, with the furniture removed. Capped so a huge page does not
  // become a huge request.
  const article = document.querySelector('article, main, [role="main"]') || document.body;
  const clone = article.cloneNode(true);
  for (const node of clone.querySelectorAll('script, style, nav, header, footer, aside, form, noscript')) {
    node.remove();
  }
  const content = clone.textContent?.replace(/\s+/g, ' ').trim().slice(0, 20000) || null;

  const arxivMatch = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i.exec(location.href);

  return {
    url: location.href,
    title,
    authors: [...new Set(authors)].slice(0, 30),
    summary: selection || summary,
    content,
    doi,
    arxivId: arxivMatch ? arxivMatch[1] : null,
    venue,
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString() : null,
    kind: doi || arxivMatch ? (arxivMatch ? 'preprint' : 'paper') : 'article',
    hasSelection: Boolean(selection),
  };
}
