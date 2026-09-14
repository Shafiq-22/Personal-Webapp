import { describe, expect, it } from 'vitest';
import { formatDateTime, hostname, initials, percent, pluralize, zoneOffsetMinutes } from '@/lib/utils';

describe('zoneOffsetMinutes', () => {
  it('computes the offset for a fixed zone', () => {
    expect(zoneOffsetMinutes('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(0);
    expect(zoneOffsetMinutes('Asia/Kolkata', new Date('2026-06-15T12:00:00Z'))).toBe(330);
  });

  it('accounts for daylight saving at the given instant', () => {
    const winter = zoneOffsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z'));
    const summer = zoneOffsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z'));
    expect(winter).toBe(0);
    expect(summer).toBe(60);
  });

  it('falls back to UTC for an unknown zone rather than throwing', () => {
    expect(zoneOffsetMinutes('Not/AZone')).toBe(0);
  });
});

describe('formatDateTime', () => {
  it('renders in the requested zone', () => {
    const value = '2026-09-14T23:30:00Z';
    expect(formatDateTime(value, 'UTC', { dateStyle: 'short', timeStyle: 'short', hour12: false })).toContain('23:30');
    // Same instant is the next morning in Tokyo.
    expect(formatDateTime(value, 'Asia/Tokyo', { dateStyle: 'short', timeStyle: 'short', hour12: false })).toContain('08:30');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatDateTime(null, 'UTC')).toBe('');
    expect(formatDateTime('not a date', 'UTC')).toBe('');
  });
});

describe('small helpers', () => {
  it('pluralizes and formats percentages', () => {
    expect(pluralize(1, 'task')).toBe('1 task');
    expect(pluralize(2, 'task')).toBe('2 tasks');
    expect(percent(0.826)).toBe('83%');
  });

  it('extracts hostnames and initials safely', () => {
    expect(hostname('https://www.nature.com/articles/x')).toBe('nature.com');
    expect(hostname('nonsense')).toBe('nonsense');
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials(null)).toBe('?');
  });
});
