import { describe, expect, it } from 'vitest';
import { Task, buildTaskTree, isOverdue, subtaskProgress } from '../src/domain/task.js';
import { Reminder, escalationSchedule, nextFireAt } from '../src/domain/reminder.js';
import { computeStreak, isDueOn } from '../src/domain/habit.js';
import { projectPath } from '../src/domain/project.js';
import { computeProductivityStats, buildWeeklyReview } from '../src/analytics.js';
import { extractForStyle, extractiveSummary, canExtractStyle, splitSentences } from '../src/summarize.js';
import { contentHash, slugify } from '../src/util/id.js';
import { relativeLabel, startOfIsoWeek } from '../src/util/date.js';
import { makeProject, makeTask, USER_ID } from './factories.js';

describe('Task schema', () => {
  it('applies defaults and rejects an empty title', () => {
    const parsed = Task.safeParse({
      id: '00000000-0000-4000-a000-000000000002',
      userId: USER_ID,
      title: 'Do the thing',
      createdAt: '2026-09-13T00:00:00Z',
      updatedAt: '2026-09-13T00:00:00Z',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('todo');
      expect(parsed.data.priority).toBe('p3');
      expect(parsed.data.tagIds).toEqual([]);
    }
    expect(Task.safeParse({ id: 'x', userId: USER_ID, title: '' }).success).toBe(false);
  });
});

describe('task helpers', () => {
  it('flags overdue open tasks only', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    expect(isOverdue({ status: 'todo', dueAt: '2026-09-13T00:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'done', dueAt: '2026-09-13T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'todo', dueAt: null }, now)).toBe(false);
  });

  it('builds a depth-first tree and keeps orphans visible', () => {
    const parent = makeTask({ title: 'Parent', sortOrder: 0 });
    const child = makeTask({ title: 'Child', parentTaskId: parent.id, sortOrder: 0 });
    const grandchild = makeTask({ title: 'Grandchild', parentTaskId: child.id });
    const orphan = makeTask({ title: 'Orphan', parentTaskId: 'missing-parent' });

    const tree = buildTaskTree([grandchild, orphan, child, parent]);
    expect(tree.map((n) => [n.task.title, n.depth])).toEqual([
      ['Parent', 0],
      ['Child', 1],
      ['Grandchild', 2],
      ['Orphan', 0],
    ]);
  });

  it('computes subtask progress', () => {
    const parent = makeTask();
    const subs = [makeTask({ parentTaskId: parent.id, status: 'done' }), makeTask({ parentTaskId: parent.id })];
    expect(subtaskProgress([parent, ...subs], parent.id)).toEqual({ done: 1, total: 2 });
  });
});

describe('projectPath', () => {
  it('returns the ancestor chain root first and survives a cycle', () => {
    const root = makeProject({ name: 'Research' });
    const child = makeProject({ name: 'Batteries', parentId: root.id });
    expect(projectPath([root, child], child.id).map((p) => p.name)).toEqual(['Research', 'Batteries']);

    const a = makeProject({ name: 'A' });
    const b = makeProject({ name: 'B', parentId: a.id });
    a.parentId = b.id;
    expect(projectPath([a, b], b.id).length).toBe(2);
  });
});

describe('reminders', () => {
  it('validates each kind against its required fields', () => {
    const base = {
      id: '00000000-0000-4000-a000-000000000003',
      userId: USER_ID,
      taskId: '00000000-0000-4000-a000-000000000004',
      createdAt: '2026-09-13T00:00:00Z',
    };
    expect(Reminder.safeParse({ ...base, kind: 'time' }).success).toBe(false);
    expect(Reminder.safeParse({ ...base, kind: 'time', offsetMinutes: -30 }).success).toBe(true);
    expect(Reminder.safeParse({ ...base, kind: 'location', latitude: 51.5, longitude: -0.12, geofenceTrigger: 'enter' }).success).toBe(true);
    expect(Reminder.safeParse({ ...base, kind: 'location', latitude: 51.5 }).success).toBe(false);
    expect(Reminder.safeParse({ ...base, kind: 'dependency' }).success).toBe(false);
    expect(Reminder.safeParse({ ...base, kind: 'escalating', escalationSteps: [] }).success).toBe(false);
    expect(Reminder.safeParse({ ...base, kind: 'escalating', escalationSteps: [{ afterMinutes: 15 }] }).success).toBe(true);
  });

  it('schedules escalation steps cumulatively', () => {
    const times = escalationSchedule(new Date('2026-09-14T09:00:00Z'), [
      { afterMinutes: 15, channel: 'notification' },
      { afterMinutes: 30, channel: 'notification' },
      { afterMinutes: 60, channel: 'critical_alert' },
    ]);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-09-14T09:15:00.000Z',
      '2026-09-14T09:45:00.000Z',
      '2026-09-14T10:45:00.000Z',
    ]);
  });

  it('resolves the next fire time for offsets, snoozes and escalations', () => {
    const now = new Date('2026-09-14T09:00:00Z');
    const task = { dueAt: '2026-09-14T12:00:00Z' };

    expect(
      nextFireAt({ kind: 'time', triggerAt: null, offsetMinutes: -30, snoozedUntil: null, escalationSteps: [], enabled: true }, task, now)?.toISOString(),
    ).toBe('2026-09-14T11:30:00.000Z');

    expect(
      nextFireAt({ kind: 'time', triggerAt: '2026-09-14T10:00:00Z', offsetMinutes: null, snoozedUntil: '2026-09-14T14:00:00Z', escalationSteps: [], enabled: true }, task, now)?.toISOString(),
    ).toBe('2026-09-14T14:00:00.000Z');

    expect(
      nextFireAt({ kind: 'escalating', triggerAt: '2026-09-14T08:00:00Z', offsetMinutes: null, snoozedUntil: null, escalationSteps: [{ afterMinutes: 30, channel: 'notification' }, { afterMinutes: 120, channel: 'critical_alert' }], enabled: true }, task, now)?.toISOString(),
    ).toBe('2026-09-14T10:30:00.000Z');

    expect(nextFireAt({ kind: 'location', triggerAt: null, offsetMinutes: null, snoozedUntil: null, escalationSteps: [], enabled: true }, task, now)).toBeNull();
    expect(nextFireAt({ kind: 'time', triggerAt: '2026-09-14T10:00:00Z', offsetMinutes: null, snoozedUntil: null, escalationSteps: [], enabled: false }, task, now)).toBeNull();
  });
});

describe('habits', () => {
  const habit = { cadence: 'daily' as const, weekdays: [1, 2, 3, 4, 5], targetPerPeriod: 1 };

  it('knows which days it is expected on', () => {
    expect(isDueOn(habit, new Date('2026-09-14T00:00:00Z'))).toBe(true); // Monday
    expect(isDueOn(habit, new Date('2026-09-19T00:00:00Z'))).toBe(false); // Saturday
  });

  it('counts a streak across a weekend gap', () => {
    const entries = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21'].map((day) => ({ day, count: 1 }));
    const streak = computeStreak(habit, entries, new Date('2026-09-21T20:00:00Z'));
    expect(streak.current).toBe(6);
    expect(streak.longest).toBe(6);
    expect(streak.lastCompletedOn).toBe('2026-09-21');
  });

  it('does not break the streak just because today is not logged yet', () => {
    const entries = ['2026-09-14', '2026-09-15', '2026-09-16'].map((day) => ({ day, count: 1 }));
    const streak = computeStreak(habit, entries, new Date('2026-09-17T09:00:00Z'));
    expect(streak.current).toBe(3);
  });

  it('breaks the streak on a genuinely missed day', () => {
    const entries = ['2026-09-14', '2026-09-16', '2026-09-17'].map((day) => ({ day, count: 1 }));
    const streak = computeStreak(habit, entries, new Date('2026-09-17T20:00:00Z'));
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
  });
});

describe('analytics', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // Wednesday

  it('summarises open, completed and overdue work', () => {
    const tasks = [
      makeTask({ status: 'done', createdAt: '2026-09-14T09:00:00Z', completedAt: '2026-09-15T09:00:00Z', dueAt: '2026-09-16T09:00:00Z' }),
      makeTask({ status: 'done', createdAt: '2026-09-07T09:00:00Z', completedAt: '2026-09-09T09:00:00Z', dueAt: '2026-09-08T09:00:00Z' }),
      makeTask({ status: 'todo', dueAt: '2026-09-15T09:00:00Z' }),
      makeTask({ status: 'todo' }),
    ];
    const stats = computeProductivityStats(tasks, { now });
    expect(stats.completedCount).toBe(2);
    expect(stats.openCount).toBe(2);
    expect(stats.overdueCount).toBe(1);
    expect(stats.completedThisWeek).toBe(1);
    expect(stats.completedLastWeek).toBe(1);
    expect(stats.weekOverWeekDelta).toBe(0);
    expect(stats.onTimeRate).toBe(0.5);
    expect(stats.medianCycleHours).toBeGreaterThan(0);
    expect(stats.series).toHaveLength(30);
  });

  it('builds a weekly review with actionable suggestions', () => {
    const tasks = [
      ...Array.from({ length: 6 }, () => makeTask({ status: 'todo', dueAt: '2026-09-10T09:00:00Z' })),
      makeTask({ status: 'todo', updatedAt: '2026-08-01T09:00:00Z' }),
    ];
    const review = buildWeeklyReview(tasks, [], [], { now });
    expect(review.windowStart).toBe(startOfIsoWeek(now).toISOString());
    expect(review.slipped).toHaveLength(6);
    expect(review.stale.length).toBeGreaterThan(0);
    expect(review.suggestions.join(' ')).toContain('past due');
    expect(review.suggestions.join(' ')).toContain('Nothing was completed');
  });
});

describe('extractive summarizer', () => {
  const abstract =
    'Solid-state batteries promise higher energy density. We present a sulfide electrolyte synthesised by ball milling. ' +
    'The method uses a two-step anneal and we evaluate 1200 cycles at 1C. Results show a coulombic efficiency of 99.9 percent. ' +
    'This implies that dendrite suppression should enable automotive packs within three years.';

  it('picks whole sentences and stays under the character budget', () => {
    const summary = extractiveSummary(abstract, { maxSentences: 2, maxChars: 300 });
    expect(summary.length).toBeLessThanOrEqual(300);
    expect(splitSentences(abstract).some((s) => summary.includes(s.slice(0, 30)))).toBe(true);
  });

  it('biases towards sentences containing the user topic terms', () => {
    const withQuery = extractiveSummary(abstract, { maxSentences: 1, queryTerms: ['dendrite'] });
    expect(withQuery.toLowerCase()).toContain('dendrite');
  });

  it('shapes key points as a bullet list', () => {
    expect(extractForStyle(abstract, 'key_points')).toMatch(/^- /);
  });

  it('finds methodology sentences when they exist', () => {
    expect(extractForStyle(abstract, 'methodology').toLowerCase()).toContain('method');
  });

  it('refuses to fake an ELI5 rather than returning nonsense', () => {
    expect(extractForStyle(abstract, 'eli5')).toBe('');
    expect(canExtractStyle('eli5')).toBe(false);
    expect(canExtractStyle('tldr')).toBe(true);
  });

  it('handles empty input', () => {
    expect(extractiveSummary('')).toBe('');
  });
});

describe('util', () => {
  it('slugifies unicode titles safely', () => {
    expect(slugify('Étude of the "Solid-State" Battery!')).toBe('etude-of-the-solid-state-battery');
    expect(slugify('')).toBe('untitled');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('hashes content stably and distinguishes different content', () => {
    expect(contentHash('a', 'b')).toBe(contentHash('a', 'b'));
    expect(contentHash('a', 'b')).not.toBe(contentHash('a', 'c'));
    expect(contentHash('x')).toHaveLength(16);
  });

  it('formats relative labels', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    expect(relativeLabel(new Date('2026-09-15T12:00:00Z'), now)).toBe('in 1 day');
    expect(relativeLabel(new Date('2026-09-14T10:00:00Z'), now)).toBe('2 hours ago');
  });
});
