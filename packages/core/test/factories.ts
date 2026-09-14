import type { CalendarEvent, InfoItem, Project, Source, Task, Topic } from '../src/domain/index.js';

let counter = 0;
const id = (prefix: string): string => {
  counter += 1;
  return `${prefix}${String(counter).padStart(8, '0')}-0000-4000-a000-000000000000`.slice(0, 36);
};

export const USER_ID = '00000000-0000-4000-a000-000000000001';

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = '2026-09-13T08:00:00.000Z';
  return {
    id: id('t'),
    userId: USER_ID,
    projectId: null,
    parentTaskId: null,
    title: 'Untitled task',
    notes: null,
    status: 'todo',
    priority: 'p3',
    energy: null,
    dueAt: null,
    dueAllDay: false,
    startAt: null,
    estimateMinutes: null,
    recurrenceRule: null,
    recurrenceAnchor: null,
    completedAt: null,
    sortOrder: 0,
    origin: 'manual',
    captureText: null,
    sourceItemId: null,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: id('p'),
    userId: USER_ID,
    parentId: null,
    name: 'Project',
    description: null,
    color: null,
    icon: null,
    archived: false,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: id('e'),
    userId: USER_ID,
    calendarId: id('c'),
    externalId: null,
    title: 'Event',
    description: null,
    location: null,
    startAt: '2026-09-14T10:00:00.000Z',
    endAt: '2026-09-14T11:00:00.000Z',
    allDay: false,
    transparency: 'opaque',
    status: 'confirmed',
    organizerEmail: null,
    attendeeCount: 1,
    recurringEventId: null,
    htmlLink: null,
    etag: null,
    createdByCortex: false,
    linkedTaskId: null,
    origin: 'calendar',
    updatedAt: '2026-09-13T08:00:00.000Z',
    ...overrides,
  };
}

export function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: id('o'),
    userId: USER_ID,
    label: 'Topic',
    keywords: [],
    excludeKeywords: [],
    origin: 'manual',
    derivedFrom: [],
    weight: 1,
    active: true,
    lastSeenAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeItem(overrides: Partial<InfoItem> = {}): InfoItem {
  return {
    id: id('i'),
    userId: USER_ID,
    sourceId: null,
    kind: 'article',
    externalId: null,
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    title: 'An article',
    authors: [],
    summaryRaw: null,
    contentText: null,
    publishedAt: '2026-09-12T00:00:00.000Z',
    fetchedAt: '2026-09-13T00:00:00.000Z',
    doi: null,
    arxivId: null,
    venue: null,
    patentNumber: null,
    language: 'en',
    contentHash: '0123456789abcdef',
    origin: 'feed',
    raw: {},
    ...overrides,
  };
}

export function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: id('s'),
    userId: USER_ID,
    kind: 'rss',
    name: 'Source',
    url: 'https://example.com/feed.xml',
    config: {},
    enabled: true,
    weight: 1,
    fetchIntervalMinutes: 180,
    lastFetchedAt: null,
    lastStatus: 'never',
    lastError: null,
    etag: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
