import { describe, expect, it } from 'vitest';
import { parseNote, renderNote, serializeFrontmatter, asStringArray } from '../src/obsidian/frontmatter.js';
import {
  parseCortexNote,
  parseTaskLine,
  renderDailySection,
  renderDigestNote,
  renderItemNote,
  renderTaskNote,
  taskLine,
  upsertDailySection,
  vaultPathFor,
} from '../src/obsidian/markdown.js';
import { decideSync, diffTask, taskFromNote } from '../src/obsidian/sync.js';
import { contentHash } from '../src/util/id.js';
import { VaultConfig } from '../src/domain/obsidian.js';
import { makeItem, makeProject, makeTask, USER_ID } from './factories.js';

const VAULT = VaultConfig.parse({
  id: '00000000-0000-4000-a000-000000000009',
  userId: USER_ID,
  createdAt: '2026-09-01T00:00:00.000Z',
});

describe('frontmatter', () => {
  it('round-trips scalars, lists and nested maps', () => {
    const data = {
      title: 'Solid state: a review',
      count: 3,
      done: false,
      empty: null,
      tags: ['cortex/research', 'batteries'],
      nested: { a: 1, b: 'two' },
      list: [],
    };
    const parsed = parseNote(renderNote(data, 'body text'));
    expect(parsed.hadFrontmatter).toBe(true);
    expect(parsed.frontmatter['title']).toBe('Solid state: a review');
    expect(parsed.frontmatter['count']).toBe(3);
    expect(parsed.frontmatter['done']).toBe(false);
    expect(parsed.frontmatter['empty']).toBeNull();
    expect(parsed.frontmatter['tags']).toEqual(['cortex/research', 'batteries']);
    expect(parsed.frontmatter['nested']).toEqual({ a: 1, b: 'two' });
    expect(parsed.body).toBe('body text');
  });

  it('quotes values that would otherwise break YAML', () => {
    const yaml = serializeFrontmatter({ title: 'a: b', flag: 'true', dash: '- x' });
    expect(yaml).toContain('title: "a: b"');
    expect(yaml).toContain('flag: "true"');
    const parsed = parseNote(`${yaml}\n\nbody`);
    expect(parsed.frontmatter['title']).toBe('a: b');
    expect(parsed.frontmatter['flag']).toBe('true');
    expect(parsed.frontmatter['dash']).toBe('- x');
  });

  it('keeps ISO dates unquoted so Obsidian treats them as dates', () => {
    expect(serializeFrontmatter({ due: '2026-09-14' })).toContain('due: 2026-09-14');
  });

  it('handles notes with no frontmatter', () => {
    const parsed = parseNote('# Just a heading\n\ntext');
    expect(parsed.hadFrontmatter).toBe(false);
    expect(parsed.frontmatter).toEqual({});
  });

  it('coerces scalars to arrays where the schema expects a list', () => {
    expect(asStringArray('one')).toEqual(['one']);
    expect(asStringArray(undefined)).toEqual([]);
  });
});

describe('taskLine', () => {
  it('emits Obsidian Tasks syntax with emoji fields', () => {
    const task = makeTask({
      title: 'Draft methods',
      priority: 'p1',
      dueAt: '2026-09-20T09:00:00Z',
      startAt: '2026-09-18T09:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    });
    const line = taskLine(task, { tags: ['writing'] });
    expect(line).toContain('- [ ] Draft methods');
    expect(line).toContain('⏫');
    expect(line).toContain('#writing');
    expect(line).toContain('📅 2026-09-20');
    expect(line).toContain('🛫 2026-09-18');
    expect(line).toContain('🔁 every week on Monday');
  });

  it('marks completed and cancelled tasks', () => {
    expect(taskLine(makeTask({ status: 'done', completedAt: '2026-09-14T10:00:00Z' }))).toContain('- [x]');
    expect(taskLine(makeTask({ status: 'cancelled' }))).toContain('- [-]');
  });
});

describe('parseTaskLine', () => {
  it('reads a task line back into fields', () => {
    const parsed = parseTaskLine('- [x] Draft methods ⏫ #writing 📅 2026-09-20 ✅ 2026-09-19');
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Draft methods');
    expect(parsed?.status).toBe('done');
    expect(parsed?.priority).toBe('p1');
    expect(parsed?.tags).toEqual(['writing']);
    expect(parsed?.due).toBe('2026-09-20');
    expect(parsed?.completed).toBe('2026-09-19');
  });

  it('returns null for a non-task line', () => {
    expect(parseTaskLine('just a paragraph')).toBeNull();
  });
});

describe('renderTaskNote', () => {
  it('round-trips through parseCortexNote', () => {
    const project = makeProject({ name: 'Grant renewal' });
    const task = makeTask({ title: 'Draft methods', projectId: project.id, priority: 'p2', notes: 'Focus on the ablation.', dueAt: '2026-09-20T09:00:00Z' });
    const note = renderTaskNote(task, { project, tags: ['writing'], subtasks: [makeTask({ title: 'Outline' })] });

    const parsed = parseCortexNote(note);
    expect(parsed.type).toBe('task');
    expect(parsed.id).toBe(task.id);
    expect(parsed.frontmatter['project']).toBe('Grant renewal');
    expect(parsed.taskLines).toHaveLength(2);
    expect(note).toContain('## Subtasks');
  });
});

describe('renderItemNote', () => {
  it('includes bibliographic frontmatter and labels the AI provenance', () => {
    const item = makeItem({ title: 'Sulfide electrolytes', authors: ['A. Nakamura'], doi: '10.1000/xyz', kind: 'paper' });
    const note = renderItemNote(item, {
      topicLabels: ['Batteries'],
      relevance: 0.82,
      reason: 'matches "Batteries" on electrolyte',
      summaries: [
        { id: 's', userId: USER_ID, itemId: item.id, style: 'tldr', text: 'A new electrolyte.', engine: 'afm', modelIdentifier: 'afm-3-core', deviceId: null, createdAt: '2026-09-13T00:00:00Z' },
      ],
    });
    expect(note).toContain('doi: 10.1000/xyz');
    expect(note).toContain('## TL;DR');
    expect(note).toContain('Apple Foundation Models');
    expect(parseCortexNote(note).type).toBe('item');
  });

  it('says so plainly when the fallback produced the text', () => {
    const item = makeItem();
    const note = renderItemNote(item, {
      summaries: [
        { id: 's', userId: USER_ID, itemId: item.id, style: 'tldr', text: 'Extract.', engine: 'heuristic', modelIdentifier: null, deviceId: null, createdAt: '2026-09-13T00:00:00Z' },
      ],
    });
    expect(note).toContain('extractive fallback');
  });
});

describe('daily notes', () => {
  it('replaces only the Cortex-owned section', () => {
    const section = renderDailySection({
      day: new Date('2026-09-14T00:00:00Z'),
      tasks: [makeTask({ title: 'Draft methods' })],
      events: [],
      digestHeadline: 'Today: 3 new items',
    });
    const existing = '# 2026-09-14\n\nMy own journal entry.\n\n<!-- cortex:start -->\nold\n<!-- cortex:end -->\n\nMore of my notes.\n';
    const merged = upsertDailySection(existing, section);
    expect(merged).toContain('My own journal entry.');
    expect(merged).toContain('More of my notes.');
    expect(merged).not.toContain('old');
    expect(merged).toContain('Draft methods');
  });

  it('appends the section when the note has none yet', () => {
    const merged = upsertDailySection('# 2026-09-14\n\nJournal.', renderDailySection({ day: new Date('2026-09-14T00:00:00Z'), tasks: [], events: [] }));
    expect(merged).toContain('Journal.');
    expect(merged).toContain('## Cortex');
    expect(merged).toContain('_No tasks due._');
  });
});

describe('vaultPathFor', () => {
  it('builds stable vault-relative paths', () => {
    const task = makeTask({ title: 'Draft the methods section!' });
    expect(vaultPathFor(VAULT, { type: 'task', task })).toMatch(/^Cortex\/Tasks\/draft-the-methods-section-/);
    expect(vaultPathFor(VAULT, { type: 'daily', day: new Date('2026-09-14T00:00:00Z') })).toBe('Daily Notes/2026-09-14.md');
    expect(
      vaultPathFor(VAULT, { type: 'digest', digest: { period: 'daily', windowStart: '2026-09-14T00:00:00Z' } }),
    ).toBe('Cortex/Digests/2026-09-14-daily.md');
  });
});

describe('decideSync', () => {
  const rendered = '---\ncortex_id: 1\n---\n\nlocal body\n';
  const remote = '---\ncortex_id: 1\n---\n\nremote body\n';

  it('creates the note when the vault has none', () => {
    expect(decideSync({ rendered, remote: null, mapping: null, direction: 'two_way' }).kind).toBe('create_remote');
  });

  it('does nothing when both sides match', () => {
    expect(decideSync({ rendered, remote: rendered, mapping: { baseHash: contentHash(rendered), deletedInVault: false }, direction: 'two_way' }).kind).toBe('noop');
  });

  it('ignores trailing whitespace and CRLF churn', () => {
    const noisy = rendered.replace(/\n/g, '\r\n').replace('local body', 'local body   ');
    expect(decideSync({ rendered, remote: noisy, mapping: null, direction: 'two_way' }).kind).toBe('noop');
  });

  it('pushes when only Cortex changed', () => {
    const base = contentHash('---\ncortex_id: 1\n---\n\nremote body');
    const action = decideSync({ rendered, remote, mapping: { baseHash: base, deletedInVault: false }, direction: 'two_way' });
    expect(action.kind).toBe('push');
  });

  it('pulls when only Obsidian changed', () => {
    const base = contentHash('---\ncortex_id: 1\n---\n\nlocal body');
    const action = decideSync({ rendered, remote, mapping: { baseHash: base, deletedInVault: false }, direction: 'two_way' });
    expect(action.kind).toBe('pull');
  });

  it('reports a conflict when both sides changed', () => {
    const base = contentHash('---\ncortex_id: 1\n---\n\noriginal body');
    const action = decideSync({ rendered, remote, mapping: { baseHash: base, deletedInVault: false }, direction: 'two_way' });
    expect(action.kind).toBe('conflict');
  });

  it('honours one-way directions', () => {
    const base = contentHash('---\ncortex_id: 1\n---\n\noriginal body');
    expect(decideSync({ rendered, remote, mapping: { baseHash: base, deletedInVault: false }, direction: 'push' }).kind).toBe('push');
    expect(decideSync({ rendered, remote, mapping: { baseHash: base, deletedInVault: false }, direction: 'pull' }).kind).toBe('pull');
  });
});

describe('taskFromNote + diffTask', () => {
  it('reads an edit made in Obsidian back into a task patch', () => {
    const task = makeTask({ title: 'Draft methods', priority: 'p3', dueAt: '2026-09-20T09:00:00.000Z' });
    const note = renderTaskNote(task).replace(
      /^- \[ \] Draft methods.*$/m,
      '- [x] Draft methods rewritten in the vault ⏫ 📅 2026-09-22 ✅ 2026-09-21',
    );

    const incoming = taskFromNote(note);
    expect(incoming).not.toBeNull();
    expect(incoming?.taskId).toBe(task.id);

    expect(incoming?.title).toBe('Draft methods rewritten in the vault');

    const patch = diffTask(task, incoming!);
    expect(patch).not.toBeNull();
    expect(patch?.status).toBe('done');
    expect(patch?.completedAt).toBeTruthy();
  });

  it('returns null when nothing changed', () => {
    const task = makeTask({ title: 'Draft methods' });
    const incoming = taskFromNote(renderTaskNote(task));
    expect(diffTask(task, incoming!)).toBeNull();
  });

  it('handles a hand-written note with no Cortex frontmatter', () => {
    const incoming = taskFromNote('# Call the supplier\n\n- [ ] Call the supplier 📅 2026-09-25\n');
    expect(incoming?.taskId).toBeNull();
    expect(incoming?.title).toBe('Call the supplier');
    expect(incoming?.dueAt).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('renderDigestNote', () => {
  it('renders entries with relevance and reasons', () => {
    const note = renderDigestNote({
      id: 'd1', userId: USER_ID, period: 'daily',
      windowStart: '2026-09-12T00:00:00Z', windowEnd: '2026-09-13T00:00:00Z',
      entries: [{ itemId: 'i1', title: 'Sulfide electrolytes', url: 'https://example.com', score: 0.82, topicLabels: ['Batteries'], reason: 'matches "Batteries"', summary: 'A new electrolyte.' }],
      itemCount: 1, headline: 'Today: 1 new item', deliveredAt: null, createdAt: '2026-09-13T00:00:00Z',
    });
    expect(note).toContain('Relevance: 82%');
    expect(note).toContain('#batteries');
    expect(parseCortexNote(note).type).toBe('digest');
  });
});
