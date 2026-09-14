import { describe, expect, it } from 'vitest';
import { parseCapture, parseQuery } from '../src/nl/parse-task.js';
import { parseDateTime, stripSpans } from '../src/nl/datetime.js';

// Sunday 2026-09-13 09:00 UTC
const REF = new Date('2026-09-13T09:00:00.000Z');

describe('parseDateTime', () => {
  it('resolves "tomorrow at 3pm"', () => {
    const match = parseDateTime('ship the draft tomorrow at 3pm', { reference: REF });
    expect(match).not.toBeNull();
    expect(match?.date.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(match?.allDay).toBe(false);
  });

  it('treats a bare date as all-day at the default hour', () => {
    const match = parseDateTime('renew the licence on 2026-10-01', { reference: REF, defaultHour: 9 });
    expect(match?.date.toISOString()).toBe('2026-10-01T09:00:00.000Z');
    expect(match?.allDay).toBe(true);
  });

  it('honours a UTC offset when resolving wall-clock times', () => {
    // 09:00 local in UTC-7 is 16:00 UTC.
    const match = parseDateTime('standup tomorrow at 9am', { reference: REF, offsetMinutes: -420 });
    expect(match?.date.toISOString()).toBe('2026-09-14T16:00:00.000Z');
  });

  it('rolls a bare weekday forward, never backwards', () => {
    const match = parseDateTime('call the vendor on friday', { reference: REF });
    expect(match?.date.toISOString().slice(0, 10)).toBe('2026-09-18');
  });

  it('pushes "next friday" a full week past the coming one', () => {
    const match = parseDateTime('retro next friday', { reference: REF });
    expect(match?.date.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('rolls a past time-of-day to the next day', () => {
    const match = parseDateTime('gym at 7am', { reference: REF });
    expect(match?.date.toISOString()).toBe('2026-09-14T07:00:00.000Z');
  });

  it('extracts recurrence and duration', () => {
    const match = parseDateTime('lab meeting every monday for 90 minutes', { reference: REF });
    expect(match?.recurrence).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO');
    expect(match?.durationMinutes).toBe(90);
    expect(match?.date.toISOString().slice(0, 10)).toBe('2026-09-14');
  });

  it('returns null when there is nothing temporal', () => {
    expect(parseDateTime('read the polymer review', { reference: REF })).toBeNull();
  });
});

describe('stripSpans', () => {
  it('removes matched ranges and tidies whitespace', () => {
    const text = 'write the intro tomorrow at 3pm';
    const match = parseDateTime(text, { reference: REF });
    expect(stripSpans(text, match?.spans ?? [])).toBe('write the intro');
  });
});

describe('parseCapture', () => {
  it('pulls out every structured field and leaves a clean title', () => {
    const parsed = parseCapture('Draft grant section tomorrow at 9am for 90m #Grant-Renewal @writing !1', {
      reference: REF,
    });
    expect(parsed.title).toBe('Draft grant section');
    expect(parsed.priority).toBe('p1');
    expect(parsed.projectName).toBe('Grant Renewal');
    expect(parsed.tagNames).toEqual(['writing']);
    expect(parsed.estimateMinutes).toBe(90);
    expect(parsed.dueAt).toBe('2026-09-14T09:00:00.000Z');
    expect(parsed.confidence).toBeGreaterThan(0.5);
  });

  it('accepts p2 style priorities', () => {
    expect(parseCapture('email the reviewers p2', { reference: REF }).priority).toBe('p2');
  });

  it('falls back to the raw text when nothing is recognised', () => {
    const parsed = parseCapture('think about the thing', { reference: REF });
    expect(parsed.title).toBe('think about the thing');
    expect(parsed.dueAt).toBeNull();
    expect(parsed.confidence).toBe(0);
  });

  it('never produces an empty title', () => {
    const parsed = parseCapture('tomorrow', { reference: REF });
    expect(parsed.title.length).toBeGreaterThan(0);
  });
});

describe('parseQuery', () => {
  it('splits filters from free text', () => {
    const query = parseQuery('overdue p1 #grant reviewer comments', { reference: REF });
    expect(query.overdue).toBe(true);
    expect(query.priority).toBe('p1');
    expect(query.projectName).toBe('grant');
    expect(query.text).toContain('reviewer comments');
  });
});
