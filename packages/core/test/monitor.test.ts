import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, dedupe, normalizeEntry, parseFeed } from '../src/monitor/feeds.js';
import { parseXml, stripHtml } from '../src/monitor/xml.js';
import { bestScorePerItem, feedbackFromHistory, scoreItemAgainstTopics, selectRealtimeAlerts } from '../src/monitor/ranking.js';
import { buildDigest, groupByTopic } from '../src/monitor/digest.js';
import { extractTopicCandidates, reconcileTopics } from '../src/monitor/topics.js';
import { makeItem, makeSource, makeTask, makeTopic, makeEvent, USER_ID } from './factories.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Battery Weekly</title>
    <link>https://batteryweekly.example</link>
    <item>
      <title><![CDATA[Solid-state electrolytes reach 99.9% coulombic efficiency]]></title>
      <link>https://batteryweekly.example/posts/solid-state?utm_source=rss&amp;utm_medium=feed</link>
      <guid isPermaLink="false">bw-1042</guid>
      <pubDate>Fri, 11 Sep 2026 08:00:00 GMT</pubDate>
      <dc:creator>R. Okafor</dc:creator>
      <category>batteries</category>
      <description>&lt;p&gt;A new sulfide electrolyte keeps dendrites in check for 1200 cycles.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Grid storage tender opens in Chile</title>
      <link>https://batteryweekly.example/posts/chile-tender</link>
      <pubDate>Thu, 10 Sep 2026 08:00:00 GMT</pubDate>
      <description>Regulatory update for utility scale storage.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv cond-mat.mtrl-sci</title>
  <entry>
    <id>http://arxiv.org/abs/2609.01234v1</id>
    <updated>2026-09-12T18:00:00Z</updated>
    <published>2026-09-12T18:00:00Z</published>
    <title>Machine-learned interatomic potentials for sulfide electrolytes</title>
    <summary>We train a potential on 40k DFT frames and study Li-ion transport.</summary>
    <author><name>A. Nakamura</name></author>
    <author><name>P. Sharma</name></author>
    <link href="http://arxiv.org/abs/2609.01234v1" rel="alternate" type="text/html"/>
    <category term="cond-mat.mtrl-sci"/>
  </entry>
</feed>`;

describe('xml scanner', () => {
  it('parses nested elements, attributes and CDATA', () => {
    const root = parseXml('<a><b id="1">hello</b><c/><d><![CDATA[<raw>]]></d></a>');
    const a = root.children[0];
    expect(a?.localName).toBe('a');
    expect(a?.children[0]?.attributes['id']).toBe('1');
    expect(a?.children[0]?.text).toBe('hello');
    expect(a?.children[2]?.text).toBe('<raw>');
  });

  it('strips html and decodes entities', () => {
    expect(stripHtml('<p>Caf&eacute; &amp; <b>bar</b></p>')).toBe('Caf&eacute; & bar');
    expect(stripHtml('<p>a&#8212;b</p>')).toContain('a');
  });
});

describe('parseFeed', () => {
  it('reads an RSS 2.0 feed', () => {
    const result = parseFeed(RSS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe('rss');
    expect(result.value.title).toBe('Battery Weekly');
    expect(result.value.entries).toHaveLength(2);
    const [first] = result.value.entries;
    expect(first?.title).toBe('Solid-state electrolytes reach 99.9% coulombic efficiency');
    expect(first?.authors).toEqual(['R. Okafor']);
    expect(first?.publishedAt).toBe('2026-09-11T08:00:00.000Z');
    expect(first?.summary).toContain('dendrites');
  });

  it('reads an Atom feed and detects the arXiv id', () => {
    const result = parseFeed(ATOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe('atom');
    const [entry] = result.value.entries;
    expect(entry?.arxivId).toBe('2609.01234v1');
    expect(entry?.authors).toEqual(['A. Nakamura', 'P. Sharma']);
    expect(entry?.categories).toEqual(['cond-mat.mtrl-sci']);
  });

  it('fails cleanly on rubbish', () => {
    expect(parseFeed('not xml at all').ok).toBe(false);
    expect(parseFeed('<html><body>no items</body></html>').ok).toBe(false);
  });
});

describe('canonicalizeUrl', () => {
  it('strips tracking params, www and trailing slashes', () => {
    expect(canonicalizeUrl('https://www.example.com/post/?utm_source=x&id=7')).toBe('https://example.com/post?id=7');
  });

  it('folds arXiv abs/pdf and version suffixes together', () => {
    expect(canonicalizeUrl('https://arxiv.org/pdf/2609.01234v3')).toBe('https://arxiv.org/abs/2609.01234');
    expect(canonicalizeUrl('http://arxiv.org/abs/2609.01234v1')).toBe('https://arxiv.org/abs/2609.01234');
  });

  it('passes through anything unparseable', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('normalizeEntry + dedupe', () => {
  it('normalizes and dedupes the same article from two feeds', () => {
    const rss = parseFeed(RSS);
    const atom = parseFeed(ATOM);
    if (!rss.ok || !atom.ok) throw new Error('feed parse failed');

    const a = normalizeEntry(rss.value.entries[0]!, { sourceId: 's1', sourceKind: 'rss', sourceName: 'Battery Weekly' });
    const duplicate = normalizeEntry(
      { ...rss.value.entries[0]!, url: 'https://www.batteryweekly.example/posts/solid-state' },
      { sourceId: 's2', sourceKind: 'news' },
    );
    const paper = normalizeEntry(atom.value.entries[0]!, { sourceId: 's3', sourceKind: 'arxiv' });

    expect(a.contentHash).toBe(duplicate.contentHash);
    expect(dedupe([a, duplicate, paper])).toHaveLength(2);
    expect(paper.kind).toBe('preprint');
    expect(paper.arxivId).toBe('2609.01234');
    expect(dedupe([a], [a.contentHash])).toHaveLength(0);
  });

  it('honours the no-content-storage privacy setting', () => {
    const rss = parseFeed(RSS);
    if (!rss.ok) throw new Error('parse failed');
    const item = normalizeEntry({ ...rss.value.entries[0]!, content: 'full body text' }, {
      sourceId: 's1',
      sourceKind: 'rss',
      storeContent: false,
    });
    expect(item.contentText).toBeNull();
  });
});

describe('scoreItemAgainstTopics', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  const topic = makeTopic({ label: 'Solid state batteries', keywords: ['solid state', 'electrolyte', 'dendrite'] });
  const source = makeSource({ weight: 1.4 });

  it('scores a matching item highly and explains why', () => {
    const item = makeItem({
      title: 'Sulfide electrolyte suppresses dendrite growth',
      summaryRaw: 'A solid state cell runs 1200 cycles.',
      sourceId: source.id,
      publishedAt: '2026-09-12T00:00:00Z',
    });
    const [score] = scoreItemAgainstTopics(item, [topic], [source], { now });
    expect(score).toBeDefined();
    expect(score!.score).toBeGreaterThan(0.4);
    expect(score!.matchedTerms.length).toBeGreaterThan(0);
    expect(score!.explanation).toContain('Solid state batteries');
  });

  it('drops an unrelated item', () => {
    const item = makeItem({ title: 'Municipal bond yields tick up', summaryRaw: 'Interest rate commentary.' });
    expect(scoreItemAgainstTopics(item, [topic], [source], { now })).toHaveLength(0);
  });

  it('vetoes an item containing an excluded keyword', () => {
    const vetoTopic = makeTopic({ label: 'Batteries', keywords: ['electrolyte'], excludeKeywords: ['press release'] });
    const item = makeItem({ title: 'Electrolyte press release from vendor' });
    expect(scoreItemAgainstTopics(item, [vetoTopic], [], { now })).toHaveLength(0);
  });

  it('decays with age', () => {
    const fresh = makeItem({ title: 'Solid state electrolyte advance', publishedAt: '2026-09-13T00:00:00Z' });
    const old = makeItem({ title: 'Solid state electrolyte advance', publishedAt: '2026-06-13T00:00:00Z' });
    const freshScore = scoreItemAgainstTopics(fresh, [topic], [], { now })[0]?.score ?? 0;
    const oldScore = scoreItemAgainstTopics(old, [topic], [], { now })[0]?.score ?? 0;
    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it('ignores inactive topics', () => {
    const inactive = makeTopic({ label: 'Batteries', keywords: ['electrolyte'], active: false });
    expect(scoreItemAgainstTopics(makeItem({ title: 'Electrolyte news' }), [inactive], [], { now })).toHaveLength(0);
  });

  it('keeps only the best score per item and applies the alert threshold', () => {
    const item = makeItem({ title: 'Solid state electrolyte dendrite breakthrough', publishedAt: '2026-09-13T00:00:00Z' });
    const scores = scoreItemAgainstTopics(item, [topic, makeTopic({ label: 'Dendrites', keywords: ['dendrite'] })], [], { now });
    expect(bestScorePerItem(scores).size).toBe(1);
    expect(selectRealtimeAlerts(scores, 0.95).length).toBeLessThanOrEqual(1);
    expect(selectRealtimeAlerts(scores, 0.05)).toHaveLength(1);
  });
});

describe('feedbackFromHistory', () => {
  it('needs enough evidence before it nudges anything', () => {
    expect(feedbackFromHistory([{ topicId: 'a', state: 'saved' }]).size).toBe(0);
    const learned = feedbackFromHistory([
      { topicId: 'a', state: 'saved' },
      { topicId: 'a', state: 'saved' },
      { topicId: 'a', state: 'dismissed' },
      { topicId: 'a', state: 'saved' },
    ]);
    expect(learned.get('a')).toBeGreaterThan(0);
  });
});

describe('buildDigest', () => {
  const topic = makeTopic({ label: 'Batteries', keywords: ['electrolyte'] });

  it('ranks, caps per topic and stays inside the window', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ title: `Electrolyte result ${i}`, publishedAt: `2026-09-1${2}T0${i}:00:00Z` }),
    );
    const outOfWindow = makeItem({ title: 'Electrolyte result old', publishedAt: '2026-08-01T00:00:00Z' });
    const all = [...items, outOfWindow];
    const scores = all.flatMap((item) => scoreItemAgainstTopics(item, [topic], [], { now: new Date('2026-09-13T00:00:00Z') }));

    const digest = buildDigest(all, scores, [topic], {
      userId: USER_ID,
      period: 'daily',
      windowStart: new Date('2026-09-12T00:00:00Z'),
      windowEnd: new Date('2026-09-13T00:00:00Z'),
      maxPerTopic: 3,
    });

    expect(digest.entries).toHaveLength(3);
    expect(digest.entries.every((e) => e.title !== 'Electrolyte result old')).toBe(true);
    expect(digest.headline).toContain('Batteries');
    expect(digest.entries[0]!.score).toBeGreaterThanOrEqual(digest.entries[1]!.score);
    expect(groupByTopic(digest)[0]?.topic).toBe('Batteries');
  });

  it('produces an empty digest rather than failing', () => {
    const digest = buildDigest([], [], [], {
      userId: USER_ID,
      period: 'weekly',
      windowStart: new Date('2026-09-06T00:00:00Z'),
      windowEnd: new Date('2026-09-13T00:00:00Z'),
    });
    expect(digest.entries).toHaveLength(0);
    expect(digest.headline).toBeNull();
  });
});

describe('extractTopicCandidates', () => {
  it('derives topics from open tasks and recent events', () => {
    const tasks = [
      makeTask({ title: 'Draft solid state electrolyte review', priority: 'p1' }),
      makeTask({ title: 'Order solid state electrolyte samples' }),
      makeTask({ title: 'Analyse dendrite imaging data', notes: 'solid state electrolyte cells' }),
      makeTask({ title: 'Book flights', status: 'done' }),
    ];
    const events = [makeEvent({ title: 'Solid state electrolyte consortium call', startAt: '2026-09-10T10:00:00Z', endAt: '2026-09-10T11:00:00Z', attendeeCount: 5 })];

    const candidates = extractTopicCandidates({ tasks, events }, { now: new Date('2026-09-13T00:00:00Z') });
    expect(candidates.length).toBeGreaterThan(0);
    const labels = candidates.map((c) => c.label.toLowerCase());
    expect(labels.some((l) => l.includes('solid state') || l.includes('electrolyte'))).toBe(true);
    const found = candidates.find((c) => c.label.toLowerCase().includes('electrolyte'));
    expect(found?.derivedFrom.length).toBeGreaterThan(0);
    expect(found?.evidence.length).toBeGreaterThan(0);
  });

  it('ignores completed tasks and stale events', () => {
    const candidates = extractTopicCandidates(
      {
        tasks: [makeTask({ title: 'Quantum annealing benchmark', status: 'done' })],
        events: [makeEvent({ title: 'Quantum annealing sync', startAt: '2025-01-01T10:00:00Z', endAt: '2025-01-01T11:00:00Z' })],
      },
      { now: new Date('2026-09-13T00:00:00Z') },
    );
    expect(candidates).toHaveLength(0);
  });

  it('scans vault notes only when they are supplied', () => {
    const candidates = extractTopicCandidates(
      { notes: [{ path: 'Research/Perovskites.md', title: 'Perovskite stability', content: 'perovskite stability under humidity, perovskite degradation pathways', modifiedAt: '2026-09-10T00:00:00Z' }] },
      { now: new Date('2026-09-13T00:00:00Z') },
    );
    expect(candidates.some((c) => c.label.toLowerCase().includes('perovskite'))).toBe(true);
    expect(candidates[0]?.origin).toBe('obsidian');
  });
});

describe('reconcileTopics', () => {
  it('separates new topics from ones already tracked and flags stale ones', () => {
    const existing = [
      makeTopic({ label: 'Solid state batteries', keywords: ['solid state'], origin: 'task', lastSeenAt: '2026-01-01T00:00:00Z' }),
      makeTopic({ label: 'Manual interest', origin: 'manual', lastSeenAt: '2020-01-01T00:00:00Z' }),
    ];
    const result = reconcileTopics(
      existing,
      [
        { label: 'Solid State Batteries', keywords: ['solid state', 'sulfide'], origin: 'task', derivedFrom: ['t1'], weight: 0.8, evidence: [] },
        { label: 'Dendrite imaging', keywords: ['dendrite'], origin: 'task', derivedFrom: ['t2'], weight: 0.6, evidence: [] },
      ],
      { now: new Date('2026-09-13T00:00:00Z') },
    );
    expect(result.created.map((c) => c.label)).toEqual(['Dendrite imaging']);
    expect(result.refreshed[0]?.keywords).toContain('sulfide');
    expect(result.stale).toHaveLength(0); // the manual topic is never auto-retired
  });
});
