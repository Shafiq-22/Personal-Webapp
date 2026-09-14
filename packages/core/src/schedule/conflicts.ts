import type { CalendarEvent } from '../domain/calendar.js';
import { MINUTE_MS, minutesBetween } from '../util/date.js';

export type ConflictSeverity = 'hard' | 'soft';

export interface EventConflict {
  a: CalendarEvent;
  b: CalendarEvent;
  severity: ConflictSeverity;
  overlapMinutes: number;
  /** Ordered, most-recommended first. */
  suggestions: ConflictSuggestion[];
}

export interface ConflictSuggestion {
  kind: 'decline' | 'shorten' | 'move_later' | 'move_earlier' | 'delegate' | 'make_async' | 'keep_both';
  label: string;
  /** Which event the action applies to. */
  targetEventId: string;
  /** Proposed new window when the action implies one. */
  proposedStart?: string;
  proposedEnd?: string;
}

const overlaps = (a: CalendarEvent, b: CalendarEvent): number => {
  const start = Math.max(Date.parse(a.startAt), Date.parse(b.startAt));
  const end = Math.min(Date.parse(a.endAt), Date.parse(b.endAt));
  return end > start ? Math.round((end - start) / MINUTE_MS) : 0;
};

/** Tentative/transparent/all-day overlaps are "soft" - they rarely need action. */
function severityOf(a: CalendarEvent, b: CalendarEvent): ConflictSeverity {
  const soft =
    a.transparency === 'transparent' ||
    b.transparency === 'transparent' ||
    a.status === 'tentative' ||
    b.status === 'tentative' ||
    a.allDay ||
    b.allDay;
  return soft ? 'soft' : 'hard';
}

/**
 * Pairwise conflict detection across the merged timeline.
 *
 * Suggestions are deterministic heuristics: the iOS app may re-rank or re-word
 * them with Apple Foundation Models, but the *options* come from here so the
 * web app offers the same resolutions with no model present.
 */
export function detectConflicts(events: CalendarEvent[]): EventConflict[] {
  const active = events
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const conflicts: EventConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i] as CalendarEvent;
      const b = active[j] as CalendarEvent;
      if (Date.parse(b.startAt) >= Date.parse(a.endAt)) break;
      const overlapMinutes = overlaps(a, b);
      if (overlapMinutes <= 0) continue;
      conflicts.push({
        a,
        b,
        severity: severityOf(a, b),
        overlapMinutes,
        suggestions: suggestResolutions(a, b, overlapMinutes),
      });
    }
  }
  return conflicts;
}

export function suggestResolutions(a: CalendarEvent, b: CalendarEvent, overlapMinutes: number): ConflictSuggestion[] {
  const suggestions: ConflictSuggestion[] = [];
  const aMinutes = minutesBetween(new Date(a.startAt), new Date(a.endAt));
  const bMinutes = minutesBetween(new Date(b.startAt), new Date(b.endAt));
  // The block Cortex itself proposed always yields first.
  const cortexBlock = a.createdByCortex ? a : b.createdByCortex ? b : null;
  const shorter = aMinutes <= bMinutes ? a : b;
  const later = Date.parse(a.startAt) >= Date.parse(b.startAt) ? a : b;
  const earlier = later.id === a.id ? b : a;

  if (cortexBlock) {
    suggestions.push({
      kind: 'move_later',
      label: `Reschedule "${cortexBlock.title}" - it is a Cortex focus block, not a commitment to other people`,
      targetEventId: cortexBlock.id,
      proposedStart: new Date(Date.parse(earlier.endAt)).toISOString(),
      proposedEnd: new Date(Date.parse(earlier.endAt) + minutesBetween(new Date(cortexBlock.startAt), new Date(cortexBlock.endAt)) * MINUTE_MS).toISOString(),
    });
  }

  if (overlapMinutes < Math.min(aMinutes, bMinutes) / 2) {
    suggestions.push({
      kind: 'shorten',
      label: `Shorten "${earlier.title}" by ${overlapMinutes} min to clear the overlap`,
      targetEventId: earlier.id,
      proposedStart: earlier.startAt,
      proposedEnd: new Date(Date.parse(later.startAt)).toISOString(),
    });
  }

  suggestions.push({
    kind: 'move_later',
    label: `Move "${later.title}" to start after "${earlier.title}" ends`,
    targetEventId: later.id,
    proposedStart: earlier.endAt,
    proposedEnd: new Date(Date.parse(earlier.endAt) + minutesBetween(new Date(later.startAt), new Date(later.endAt)) * MINUTE_MS).toISOString(),
  });

  if (later.attendeeCount > 1 || earlier.attendeeCount > 1) {
    const bigger = later.attendeeCount >= earlier.attendeeCount ? earlier : later;
    suggestions.push({
      kind: 'delegate',
      label: `Send a delegate to "${bigger.title}" (${bigger.attendeeCount} attendees) and keep the other`,
      targetEventId: bigger.id,
    });
    suggestions.push({
      kind: 'make_async',
      label: `Ask for notes instead of attending "${shorter.title}"`,
      targetEventId: shorter.id,
    });
  } else {
    suggestions.push({
      kind: 'decline',
      label: `Decline "${shorter.title}"`,
      targetEventId: shorter.id,
    });
  }

  if (a.allDay || b.allDay) {
    suggestions.push({
      kind: 'keep_both',
      label: 'Keep both - one of these is an all-day marker, not a hard commitment',
      targetEventId: a.allDay ? a.id : b.id,
    });
  }

  return suggestions;
}

/** Does a proposed block collide with anything already on the calendar? */
export function blockCollides(
  proposed: { startAt: string; endAt: string },
  events: Array<Pick<CalendarEvent, 'startAt' | 'endAt' | 'transparency' | 'status'>>,
): boolean {
  const start = Date.parse(proposed.startAt);
  const end = Date.parse(proposed.endAt);
  return events.some((e) => {
    if (e.status === 'cancelled' || e.transparency === 'transparent') return false;
    return Date.parse(e.startAt) < end && Date.parse(e.endAt) > start;
  });
}
