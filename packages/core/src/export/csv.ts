import type { InfoItem, Task } from '../domain/index.js';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return columns?.length ? `${columns.join(',')}\n` : '';
  const headers = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => cell(row[h])).join(','));
  return `${lines.join('\n')}\n`;
}

export function tasksToCsv(
  tasks: Task[],
  lookup: { projectName?: (id: string | null) => string | null; tagNames?: (ids: string[]) => string[] } = {},
): string {
  return toCsv(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      project: lookup.projectName?.(task.projectId) ?? task.projectId ?? '',
      tags: (lookup.tagNames?.(task.tagIds) ?? task.tagIds).join('; '),
      due_at: task.dueAt ?? '',
      start_at: task.startAt ?? '',
      estimate_minutes: task.estimateMinutes ?? '',
      energy: task.energy ?? '',
      recurrence: task.recurrenceRule ?? '',
      completed_at: task.completedAt ?? '',
      notes: task.notes ?? '',
      origin: task.origin,
      created_at: task.createdAt,
    })),
  );
}

export function itemsToCsv(items: InfoItem[], scores: Map<string, number> = new Map()): string {
  return toCsv(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      authors: item.authors.join('; '),
      url: item.canonicalUrl ?? item.url,
      doi: item.doi ?? '',
      arxiv_id: item.arxivId ?? '',
      venue: item.venue ?? '',
      published_at: item.publishedAt ?? '',
      captured_at: item.fetchedAt,
      relevance: scores.get(item.id) ?? '',
    })),
  );
}
