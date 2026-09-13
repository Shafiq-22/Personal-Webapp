import { describe, expect, it } from 'vitest';
import { expandOccurrences, formatRRule, describeRRule, nextOccurrence, parseRRule, rollForward } from '../src/schedule/recurrence.js';
import { findFreeSlots, mergeBusy, totalFreeMinutes, chunkSlot } from '../src/schedule/free-slots.js';
import { blockCollides, detectConflicts } from '../src/schedule/conflicts.js';
import { planDay, prioritizeTasks, proposeTimeBlocks, replanBlocks } from '../src/schedule/planner.js';
import { DEFAULT_SCHEDULING } from '../src/domain/settings.js';
import { makeEvent, makeTask, USER_ID } from './factories.js';

describe('parseRRule', () => {
  it('parses a weekday rule', () => {
    const parsed = parseRRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.freq).toBe('WEEKLY');
    expect(parsed.value.byDay).toEqual([1, 3, 5]);
  });

  it('rejects an unsupported frequency', () => {
    const parsed = parseRRule('FREQ=HOURLY');
    expect(parsed.ok).toBe(false);
  });

  it('requires FREQ', () => {
    expect(parseRRule('INTERVAL=2').ok).toBe(false);
  });

  it('round-trips through formatRRule', () => {
    const text = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU';
    const parsed = parseRRule(text);
    expect(parsed.ok && formatRRule(parsed.value)).toBe(text);
  });
});

describe('expandOccurrences', () => {
  const anchor = new Date('2026-09-14T09:00:00.000Z'); // Monday

  it('expands a daily rule with an interval', () => {
    const rule = parseRRule('FREQ=DAILY;INTERVAL=3');
    expect(rule.ok).toBe(true);
    if (!rule.ok) return;
    const dates = expandOccurrences(rule.value, anchor, anchor, new Date('2026-09-24T00:00:00.000Z'));
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-14', '2026-09-17', '2026-09-20', '2026-09-23']);
  });

  it('expands weekly BYDAY across weeks and keeps the time of day', () => {
    const rule = parseRRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH');
    if (!rule.ok) throw new Error(rule.error);
    const dates = expandOccurrences(rule.value, anchor, anchor, new Date('2026-09-28T00:00:00.000Z'));
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-09-14T09:00:00.000Z',
      '2026-09-17T09:00:00.000Z',
      '2026-09-21T09:00:00.000Z',
      '2026-09-24T09:00:00.000Z',
    ]);
  });

  it('honours COUNT and UNTIL', () => {
    const counted = parseRRule('FREQ=DAILY;COUNT=2');
    if (!counted.ok) throw new Error(counted.error);
    expect(expandOccurrences(counted.value, anchor, anchor, new Date('2026-10-14T00:00:00.000Z'))).toHaveLength(2);

    const until = parseRRule('FREQ=DAILY;UNTIL=20260916T000000Z');
    if (!until.ok) throw new Error(until.error);
    expect(expandOccurrences(until.value, anchor, anchor, new Date('2026-10-14T00:00:00.000Z'))).toHaveLength(2);
  });

  it('skips months that are too short for the anchor day', () => {
    const rule = parseRRule('FREQ=MONTHLY;INTERVAL=1');
    if (!rule.ok) throw new Error(rule.error);
    const jan31 = new Date('2026-01-31T09:00:00.000Z');
    const dates = expandOccurrences(rule.value, jan31, jan31, new Date('2026-04-01T00:00:00.000Z'));
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-03-31']);
  });
});

describe('rollForward', () => {
  it('advances a recurring task instead of closing it', () => {
    const next = rollForward(
      { dueAt: '2026-09-14T09:00:00.000Z', recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', recurrenceAnchor: '2026-09-14T09:00:00.000Z' },
      new Date('2026-09-14T10:00:00.000Z'),
    );
    expect(next?.toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });

  it('returns null for a non-recurring task', () => {
    expect(rollForward({ dueAt: null, recurrenceRule: null, recurrenceAnchor: null })).toBeNull();
  });

  it('returns null once a COUNT series is exhausted', () => {
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', new Date('2026-09-14T09:00:00Z'), new Date('2026-09-15T09:00:00Z'))).toBeNull();
  });
});

describe('describeRRule', () => {
  it('describes weekdays in words', () => {
    expect(describeRRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR')).toBe('every weekday');
    expect(describeRRule('FREQ=DAILY;INTERVAL=2')).toBe('every 2 days');
  });
});

describe('mergeBusy', () => {
  it('merges overlapping intervals and applies the buffer', () => {
    const merged = mergeBusy(
      [
        { start: new Date('2026-09-14T10:00:00Z'), end: new Date('2026-09-14T11:00:00Z') },
        { start: new Date('2026-09-14T10:30:00Z'), end: new Date('2026-09-14T12:00:00Z') },
        { start: new Date('2026-09-14T14:00:00Z'), end: new Date('2026-09-14T15:00:00Z') },
      ],
      10,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.start.toISOString()).toBe('2026-09-14T09:50:00.000Z');
    expect(merged[0]?.end.toISOString()).toBe('2026-09-14T12:10:00.000Z');
  });
});

describe('findFreeSlots', () => {
  const workingHours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020, enabled: true }));

  it('returns the gaps between meetings inside working hours', () => {
    const slots = findFreeSlots(
      [
        { start: new Date('2026-09-14T10:00:00Z'), end: new Date('2026-09-14T11:00:00Z') },
        { start: new Date('2026-09-14T13:00:00Z'), end: new Date('2026-09-14T14:00:00Z') },
      ],
      {
        from: new Date('2026-09-14T00:00:00Z'),
        to: new Date('2026-09-14T23:59:00Z'),
        workingHours,
        minimumMinutes: 30,
      },
    );
    expect(slots.map((s) => [s.start.toISOString(), s.end.toISOString()])).toEqual([
      ['2026-09-14T09:00:00.000Z', '2026-09-14T10:00:00.000Z'],
      ['2026-09-14T11:00:00.000Z', '2026-09-14T13:00:00.000Z'],
      ['2026-09-14T14:00:00.000Z', '2026-09-14T17:00:00.000Z'],
    ]);
  });

  it('excludes days that are not working days', () => {
    const slots = findFreeSlots([], {
      from: new Date('2026-09-19T00:00:00Z'), // Saturday
      to: new Date('2026-09-20T23:59:00Z'),
      workingHours,
    });
    expect(slots).toHaveLength(0);
  });

  it('respects notBefore so it never proposes the past', () => {
    const slots = findFreeSlots([], {
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:00Z'),
      workingHours,
      notBefore: new Date('2026-09-14T15:00:00Z'),
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.start.toISOString()).toBe('2026-09-14T15:00:00.000Z');
  });

  it('shifts working hours by the user offset', () => {
    // 09:00-17:00 in UTC+2 is 07:00-15:00 UTC.
    const slots = findFreeSlots([], {
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:00Z'),
      workingHours,
      offsetMinutes: 120,
    });
    expect(slots[0]?.start.toISOString()).toBe('2026-09-14T07:00:00.000Z');
    expect(slots[0]?.end.toISOString()).toBe('2026-09-14T15:00:00.000Z');
  });

  it('totals and chunks slots', () => {
    const slots = findFreeSlots([], {
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:00Z'),
      workingHours,
    });
    expect(totalFreeMinutes(slots)).toBe(480);
    const chunks = chunkSlot(slots[0]!, 90, 15);
    expect(chunks).toHaveLength(4);
    expect(chunks[1]?.start.toISOString()).toBe('2026-09-14T10:45:00.000Z');
  });
});

describe('detectConflicts', () => {
  it('finds overlapping events and proposes resolutions', () => {
    const a = makeEvent({ title: 'Lab meeting', startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z', attendeeCount: 6 });
    const b = makeEvent({ title: 'Supervisor 1:1', startAt: '2026-09-14T10:30:00Z', endAt: '2026-09-14T11:30:00Z', attendeeCount: 2 });
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlapMinutes).toBe(30);
    expect(conflicts[0]?.severity).toBe('hard');
    expect(conflicts[0]?.suggestions.length).toBeGreaterThan(1);
    expect(conflicts[0]?.suggestions.some((s) => s.kind === 'move_later')).toBe(true);
  });

  it('treats transparent and all-day overlaps as soft', () => {
    const a = makeEvent({ startAt: '2026-09-14T00:00:00Z', endAt: '2026-09-15T00:00:00Z', allDay: true });
    const b = makeEvent({ startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z' });
    expect(detectConflicts([a, b])[0]?.severity).toBe('soft');
  });

  it('offers the Cortex block first when one side is a focus block', () => {
    const meeting = makeEvent({ title: 'Client call', startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z' });
    const block = makeEvent({ title: 'Deep work', startAt: '2026-09-14T10:30:00Z', endAt: '2026-09-14T12:00:00Z', createdByCortex: true });
    const [conflict] = detectConflicts([meeting, block]);
    expect(conflict?.suggestions[0]?.targetEventId).toBe(block.id);
  });

  it('ignores cancelled events', () => {
    const a = makeEvent({ startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z' });
    const b = makeEvent({ startAt: '2026-09-14T10:30:00Z', endAt: '2026-09-14T11:30:00Z', status: 'cancelled' });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('detects whether a proposed block collides', () => {
    const events = [makeEvent({ startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z' })];
    expect(blockCollides({ startAt: '2026-09-14T10:30:00Z', endAt: '2026-09-14T11:30:00Z' }, events)).toBe(true);
    expect(blockCollides({ startAt: '2026-09-14T11:00:00Z', endAt: '2026-09-14T12:00:00Z' }, events)).toBe(false);
  });
});

describe('prioritizeTasks', () => {
  const now = new Date('2026-09-14T09:00:00Z');

  it('puts overdue p1 work first and blocked work last', () => {
    const overdue = makeTask({ title: 'Overdue', priority: 'p1', dueAt: '2026-09-10T09:00:00Z' });
    const later = makeTask({ title: 'Later', priority: 'p3', dueAt: '2026-10-10T09:00:00Z' });
    const blocked = makeTask({ title: 'Blocked', priority: 'p1', dueAt: '2026-09-10T09:00:00Z' });
    const scores = prioritizeTasks([later, blocked, overdue], { now, blockedTaskIds: new Set([blocked.id]) });
    expect(scores[0]?.taskId).toBe(overdue.id);
    expect(scores[scores.length - 1]?.taskId).toBe(blocked.id);
    expect(scores[0]?.reasons.join(' ')).toContain('overdue');
  });
});

describe('planDay', () => {
  it('stops adding focus work once capacity is used up', () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({ title: `Task ${i}`, priority: 'p2', estimateMinutes: 60, dueAt: '2026-09-15T09:00:00Z' }),
    );
    const plan = planDay(tasks, { now: new Date('2026-09-14T09:00:00Z'), capacityMinutes: 180 });
    expect(plan.focus).toHaveLength(3);
    expect(plan.plannedMinutes).toBeLessThanOrEqual(180);
    expect(plan.deferred.length).toBeGreaterThan(0);
    expect(plan.overCommitted).toBe(false);
  });

  it('routes short tasks to quick wins', () => {
    const plan = planDay([makeTask({ estimateMinutes: 10 }), makeTask({ estimateMinutes: 60 })], {
      now: new Date('2026-09-14T09:00:00Z'),
    });
    expect(plan.quickWins).toHaveLength(1);
    expect(plan.focus).toHaveLength(1);
  });
});

describe('proposeTimeBlocks', () => {
  const base = {
    from: new Date('2026-09-14T00:00:00Z'),
    to: new Date('2026-09-14T23:59:00Z'),
    settings: DEFAULT_SCHEDULING,
    userId: USER_ID,
    now: new Date('2026-09-14T08:00:00Z'),
  };

  it('places tasks into free slots without colliding with events', () => {
    const busy = [{ start: new Date('2026-09-14T10:00:00Z'), end: new Date('2026-09-14T11:00:00Z') }];
    const tasks = [makeTask({ title: 'Write methods', priority: 'p1', estimateMinutes: 60, dueAt: '2026-09-14T17:00:00Z' })];
    const blocks = proposeTimeBlocks(tasks, { ...base, busy });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.status).toBe('proposed');
    expect(blocks[0]?.engine).toBe('heuristic');
    expect(blocks[0]?.rationale).toContain('Write methods');
    expect(blockCollides({ startAt: blocks[0]!.startAt, endAt: blocks[0]!.endAt }, [
      makeEvent({ startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z' }),
    ])).toBe(false);
  });

  it('never double-books two proposals into the same minutes', () => {
    const tasks = [
      makeTask({ title: 'A', priority: 'p1', estimateMinutes: 60 }),
      makeTask({ title: 'B', priority: 'p1', estimateMinutes: 60 }),
    ];
    const blocks = proposeTimeBlocks(tasks, { ...base, busy: [] });
    expect(blocks).toHaveLength(2);
    const [first, second] = blocks;
    expect(Date.parse(second!.startAt)).toBeGreaterThanOrEqual(Date.parse(first!.endAt));
  });

  it('caps a block at the configured maximum', () => {
    const blocks = proposeTimeBlocks([makeTask({ estimateMinutes: 600 })], { ...base, busy: [] });
    const minutes = (Date.parse(blocks[0]!.endAt) - Date.parse(blocks[0]!.startAt)) / 60000;
    expect(minutes).toBe(DEFAULT_SCHEDULING.maxBlockMinutes);
  });
});

describe('replanBlocks', () => {
  it('moves a block that a new event now covers', () => {
    const block = {
      id: 'b1', userId: USER_ID, taskId: null, habitId: null, eventId: null,
      title: 'Deep work', kind: 'task' as const, status: 'approved' as const,
      startAt: '2026-09-14T10:00:00Z', endAt: '2026-09-14T11:00:00Z',
      rationale: null, engine: 'heuristic' as const, createdAt: '2026-09-13T00:00:00Z',
    };
    const busy = [{ start: new Date('2026-09-14T10:30:00Z'), end: new Date('2026-09-14T11:30:00Z') }];
    const suggestions = replanBlocks([block], busy, {
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:00Z'),
      busy,
      settings: DEFAULT_SCHEDULING,
      userId: USER_ID,
      now: new Date('2026-09-14T08:00:00Z'),
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.proposedStart).not.toBeNull();
    expect(Date.parse(suggestions[0]!.proposedStart!)).toBeGreaterThanOrEqual(Date.parse('2026-09-14T09:00:00Z'));
  });

  it('returns nothing when no block is affected', () => {
    expect(
      replanBlocks([], [], {
        from: new Date('2026-09-14T00:00:00Z'),
        to: new Date('2026-09-14T23:59:00Z'),
        busy: [],
        settings: DEFAULT_SCHEDULING,
        userId: USER_ID,
      }),
    ).toEqual([]);
  });
});
