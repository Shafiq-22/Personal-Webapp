import { describe, expect, it } from 'vitest';
import {
  taskToRow,
  toDigest,
  toEvent,
  toInfoItem,
  toSettings,
  toTask,
  toVault,
} from '@/lib/mappers';
import type { SettingsRow, TaskRow, VaultRow } from '@/lib/supabase/types';

const TASK_ROW: TaskRow = {
  id: '11111111-1111-4111-a111-111111111111',
  user_id: '22222222-2222-4222-a222-222222222222',
  project_id: null,
  parent_task_id: null,
  title: 'Draft methods',
  notes: null,
  status: 'todo',
  priority: 'p1',
  energy: 'high',
  due_at: '2026-09-20T09:00:00.000Z',
  due_all_day: false,
  start_at: null,
  estimate_minutes: 90,
  recurrence_rule: null,
  recurrence_anchor: null,
  completed_at: null,
  sort_order: 3,
  origin: 'nl_capture',
  capture_text: 'Draft methods tomorrow at 9am',
  source_item_id: null,
  created_at: '2026-09-13T08:00:00.000Z',
  updated_at: '2026-09-13T08:00:00.000Z',
  task_tags: [{ tag_id: '33333333-3333-4333-a333-333333333333' }],
};

describe('toTask', () => {
  it('converts snake_case columns and flattens the tag join', () => {
    const task = toTask(TASK_ROW);
    expect(task.parentTaskId).toBeNull();
    expect(task.dueAllDay).toBe(false);
    expect(task.estimateMinutes).toBe(90);
    expect(task.captureText).toBe('Draft methods tomorrow at 9am');
    expect(task.tagIds).toEqual(['33333333-3333-4333-a333-333333333333']);
  });

  it('defaults origin when the column holds something unexpected', () => {
    const task = toTask({ ...TASK_ROW, origin: '' });
    expect(task.origin).toBe('manual');
  });

  it('handles a row with no tag join present', () => {
    const { task_tags: _ignored, ...withoutTags } = TASK_ROW;
    expect(toTask(withoutTags as TaskRow).tagIds).toEqual([]);
  });
});

describe('taskToRow', () => {
  it('maps only the fields that were supplied', () => {
    expect(taskToRow({ title: 'New', dueAt: '2026-09-20T09:00:00Z' })).toEqual({
      title: 'New',
      due_at: '2026-09-20T09:00:00Z',
    });
  });

  it('keeps explicit nulls so a field can be cleared', () => {
    expect(taskToRow({ dueAt: null })).toEqual({ due_at: null });
  });

  it('never forwards server-owned columns', () => {
    const row = taskToRow({ title: 'x' } as never);
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('user_id');
    expect(row).not.toHaveProperty('created_at');
  });
});

describe('toSettings', () => {
  const userId = '22222222-2222-4222-a222-222222222222';

  it('applies defaults when no row exists yet', () => {
    const settings = toSettings(null, userId, 'Europe/London');
    expect(settings.timeZone).toBe('Europe/London');
    expect(settings.privacy.localFirst).toBe(false);
    expect(settings.privacy.syncAiSummaries).toBe(false);
    expect(settings.scheduling.workingHours).toHaveLength(7);
    expect(settings.notifications.dailyDigestHour).toBe(7);
  });

  it('reads stored values back', () => {
    const row: SettingsRow = {
      user_id: userId,
      privacy: { localFirst: true, syncAiSummaries: true },
      notifications: { dailyDigestHour: 6 },
      scheduling: { bufferMinutes: 20 },
      updated_at: '2026-09-13T00:00:00.000Z',
    };
    const settings = toSettings(row, userId);
    expect(settings.privacy.localFirst).toBe(true);
    expect(settings.notifications.dailyDigestHour).toBe(6);
    expect(settings.scheduling.bufferMinutes).toBe(20);
  });

  it('degrades to defaults rather than throwing on a malformed blob', () => {
    const row = {
      user_id: userId,
      privacy: { localFirst: 'yes please' },
      notifications: { dailyDigestHour: 99 },
      scheduling: null,
      updated_at: '2026-09-13T00:00:00.000Z',
    } as unknown as SettingsRow;
    const settings = toSettings(row, userId);
    expect(settings.privacy.localFirst).toBe(false);
    expect(settings.notifications.dailyDigestHour).toBe(7);
    expect(settings.scheduling.minBlockMinutes).toBe(25);
  });
});

describe('toVault', () => {
  it('fills in the default folder layout', () => {
    const row = {
      id: 'v1',
      user_id: 'u1',
      name: 'Vault',
      transport: 'icloud_drive',
      folders: { tasks: 'Work/Tasks' },
      direction: 'two_way',
      allow_topic_scan: false,
      scan_folders: [],
      encryption_enabled: false,
      encryption_key_ref: null,
      rest_api_base_url: null,
      last_synced_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
    } as VaultRow;
    const vault = toVault(row);
    expect(vault.folders.tasks).toBe('Work/Tasks');
    expect(vault.folders.digests).toBe('Cortex/Digests');
    expect(vault.folders.dailyNotes).toBe('Daily Notes');
  });
});

describe('other mappers', () => {
  it('maps events, items and digests without losing nullable fields', () => {
    const event = toEvent({
      id: 'e1', user_id: 'u1', calendar_id: 'c1', external_id: 'x', title: 'Lab',
      description: null, location: null, start_at: '2026-09-14T10:00:00Z', end_at: '2026-09-14T11:00:00Z',
      all_day: false, transparency: 'opaque', status: 'confirmed', organizer_email: null,
      attendee_count: 3, recurring_event_id: null, html_link: null, etag: null,
      created_by_cortex: true, linked_task_id: null, origin: 'calendar', updated_at: '2026-09-13T00:00:00Z',
    });
    expect(event.createdByCortex).toBe(true);
    expect(event.attendeeCount).toBe(3);

    const item = toInfoItem({
      id: 'i1', user_id: 'u1', source_id: null, kind: 'paper', external_id: null,
      url: 'https://example.com', canonical_url: 'https://example.com', title: 'A paper',
      authors: ['A'], summary_raw: null, content_text: null, published_at: null,
      fetched_at: '2026-09-13T00:00:00Z', doi: '10.1000/x', arxiv_id: null, venue: null,
      patent_number: null, language: 'en', content_hash: '0123456789abcdef', origin: 'feed', raw: {},
    });
    expect(item.doi).toBe('10.1000/x');
    expect(item.contentText).toBeNull();

    const digest = toDigest({
      id: 'd1', user_id: 'u1', period: 'daily', window_start: '2026-09-12T00:00:00Z',
      window_end: '2026-09-13T00:00:00Z', entries: [], item_count: 0, headline: null,
      delivered_at: null, created_at: '2026-09-13T00:00:00Z',
    });
    expect(digest.entries).toEqual([]);
    expect(digest.itemCount).toBe(0);
  });
});
