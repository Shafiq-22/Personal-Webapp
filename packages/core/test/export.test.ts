import { describe, expect, it } from 'vitest';
import { buildIcs, eventsToIcs, tasksToIcs } from '../src/export/ics.js';
import { itemsToCsv, tasksToCsv, toCsv } from '../src/export/csv.js';
import { bibtexKey, toBibtex, toRis } from '../src/export/bibliography.js';
import { makeEvent, makeItem, makeTask } from './factories.js';

describe('ICS', () => {
  it('emits a valid calendar envelope with CRLF line endings', () => {
    const ics = buildIcs([
      { uid: 'a@cortex', summary: 'Deep work', start: new Date('2026-09-14T09:00:00Z'), end: new Date('2026-09-14T10:30:00Z') },
    ]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20260914T090000Z');
    expect(ics).toContain('DTEND:20260914T103000Z');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('escapes commas, semicolons and newlines', () => {
    const ics = buildIcs([
      { uid: 'b@cortex', summary: 'Review; then, write', description: 'line one\nline two', start: new Date('2026-09-14T09:00:00Z'), end: new Date('2026-09-14T10:00:00Z') },
    ]);
    expect(ics).toContain('SUMMARY:Review\; then\\, write');
    expect(ics).toContain('line one\\nline two');
  });

  it('folds long lines at 75 octets', () => {
    const ics = buildIcs([
      { uid: 'c@cortex', summary: 'x'.repeat(200), start: new Date('2026-09-14T09:00:00Z'), end: new Date('2026-09-14T10:00:00Z') },
    ]);
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
    expect(ics).toContain('\r\n x');
  });

  it('exports tasks as VTODO with a DUE field', () => {
    const ics = tasksToIcs([makeTask({ title: 'File the report', dueAt: '2026-09-20T09:00:00Z', status: 'done' })]);
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('DUE:20260920T090000Z');
    expect(ics).toContain('STATUS:COMPLETED');
  });

  it('marks all-day events as DATE values', () => {
    const ics = eventsToIcs([makeEvent({ allDay: true, startAt: '2026-09-14T00:00:00Z', endAt: '2026-09-15T00:00:00Z' })]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260914');
  });
});

describe('CSV', () => {
  it('quotes cells containing separators and quotes', () => {
    const csv = toCsv([{ a: 'plain', b: 'has, comma', c: 'has "quote"', d: 'line\nbreak' }]);
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it('exports tasks with resolved project and tag names', () => {
    const csv = tasksToCsv([makeTask({ title: 'Draft', projectId: 'proj-1', tagIds: ['tag-1'] })], {
      projectName: () => 'Grant renewal',
      tagNames: () => ['writing'],
    });
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('project');
    expect(row).toContain('Grant renewal');
    expect(row).toContain('writing');
  });

  it('includes relevance in the item export when known', () => {
    const item = makeItem();
    const csv = itemsToCsv([item], new Map([[item.id, 0.82]]));
    expect(csv.trim().split('\n')[1]).toContain('0.82');
  });

  it('returns just a header row for an empty export', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b\n');
  });
});

describe('BibTeX and RIS', () => {
  const paper = makeItem({
    kind: 'paper',
    title: 'Sulfide electrolytes & dendrite suppression',
    authors: ['Akiko Nakamura', 'Priya Sharma'],
    doi: '10.1000/xyz123',
    venue: 'Journal of Power Sources',
    publishedAt: '2026-03-04T00:00:00Z',
    summaryRaw: 'We study transport.',
  });

  it('produces a parseable BibTeX entry', () => {
    const bib = toBibtex([paper]);
    expect(bib).toContain('@article{');
    expect(bib).toContain('author = {Akiko Nakamura and Priya Sharma}');
    expect(bib).toContain('year = {2026}');
    expect(bib).toContain('journal = {Journal of Power Sources}');
    expect(bib).toContain('doi = {10.1000/xyz123}');
    // Special characters must be escaped for LaTeX.
    expect(bib).toContain('\\&');
    expect(bib.split('{').length).toBe(bib.split('}').length);
  });

  it('uses a stable citation key', () => {
    expect(bibtexKey(paper)).toBe('nakamura2026sulfide');
  });

  it('maps preprints to misc with an eprint field', () => {
    const bib = toBibtex([makeItem({ kind: 'preprint', arxivId: '2609.01234', title: 'A preprint', publishedAt: '2026-09-01T00:00:00Z' })]);
    expect(bib).toContain('@misc{');
    expect(bib).toContain('eprint = {2609.01234}');
    expect(bib).toContain('archiveprefix = {arXiv}');
  });

  it('produces RIS records terminated with ER', () => {
    const ris = toRis([paper]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('AU  - Akiko Nakamura');
    expect(ris).toContain('AU  - Priya Sharma');
    expect(ris).toContain('DO  - 10.1000/xyz123');
    expect(ris.trimEnd().endsWith('ER  -')).toBe(true);
  });

  it('handles an empty library', () => {
    expect(toBibtex([])).toBe('');
    expect(toRis([])).toBe('');
  });
});
