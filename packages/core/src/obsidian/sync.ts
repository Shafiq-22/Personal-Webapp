import type { ObsidianFile, SyncDirection, Task } from '../domain/index.js';
import { contentHash } from '../util/id.js';
import { parseCortexNote, type ParsedTaskLine } from './markdown.js';

/**
 * Three-way sync decision table.
 *
 * `baseHash` is the content both sides last agreed on. Comparing it with the
 * current Cortex render and the current vault file tells us who changed what,
 * without timestamps (which are unreliable across iCloud, WebDAV and LiveSync).
 */
export type SyncAction =
  | { kind: 'noop'; reason: string }
  | { kind: 'push'; reason: string; content: string }
  | { kind: 'pull'; reason: string; content: string }
  | { kind: 'conflict'; reason: string; local: string; remote: string }
  | { kind: 'delete_local'; reason: string }
  | { kind: 'create_remote'; reason: string; content: string };

export interface SyncInput {
  /** What Cortex would write right now. */
  rendered: string;
  /** What is in the vault right now, or null when the file is absent. */
  remote: string | null;
  mapping: Pick<ObsidianFile, 'baseHash' | 'deletedInVault'> | null;
  direction: SyncDirection;
}

export function decideSync(input: SyncInput): SyncAction {
  const { rendered, remote, mapping, direction } = input;
  const localHash = contentHash(normalize(rendered));
  const remoteHash = remote === null ? null : contentHash(normalize(remote));
  const baseHash = mapping?.baseHash ?? null;

  if (remote === null) {
    if (mapping?.deletedInVault && direction !== 'push') {
      return { kind: 'noop', reason: 'file was deleted in the vault and the user chose not to recreate it' };
    }
    return { kind: 'create_remote', reason: 'no note exists in the vault yet', content: rendered };
  }

  if (localHash === remoteHash) return { kind: 'noop', reason: 'both sides are identical' };

  const localChanged = baseHash === null ? true : localHash !== baseHash;
  const remoteChanged = baseHash === null ? true : remoteHash !== baseHash;

  if (direction === 'push') {
    return { kind: 'push', reason: 'vault is push-only, Cortex is the source of truth', content: rendered };
  }
  if (direction === 'pull') {
    return { kind: 'pull', reason: 'vault is pull-only, Obsidian is the source of truth', content: remote };
  }

  if (localChanged && !remoteChanged) {
    return { kind: 'push', reason: 'changed in Cortex only', content: rendered };
  }
  if (!localChanged && remoteChanged) {
    return { kind: 'pull', reason: 'changed in Obsidian only', content: remote };
  }
  return { kind: 'conflict', reason: 'changed on both sides since the last sync', local: rendered, remote };
}

/** Ignore churn that carries no meaning (trailing space, CRLF, blank runs). */
function normalize(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface TaskUpdateFromVault {
  taskId: string | null;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  dueAt: string | null;
  startAt: string | null;
  completedAt: string | null;
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  tags: string[];
  notes: string | null;
}

/**
 * Turn a note edited in Obsidian back into a task patch.
 *
 * The frontmatter carries the id, so a note can be renamed or moved in the
 * vault without breaking the link. When the frontmatter is gone (the user
 * created the note by hand) the task is treated as new.
 */
export function taskFromNote(source: string): TaskUpdateFromVault | null {
  const note = parseCortexNote(source);
  const fm = note.frontmatter;
  const primary: ParsedTaskLine | undefined = note.taskLines[0];
  const title = primary?.title || (typeof fm['title'] === 'string' && fm['title']) || firstHeading(note.body);
  if (!title) return null;

  // The checkbox is the user's live intent: ticking a box in Obsidian is an
  // edit, while the frontmatter is Cortex's own bookkeeping from the last push.
  // So the task line wins wherever the two disagree, and frontmatter fills in
  // for notes that have no task line at all.
  const statusFromFm = typeof fm['status'] === 'string' ? fm['status'] : null;
  const status =
    primary?.status ??
    (['todo', 'in_progress', 'done', 'cancelled'] as const).find((s) => s === statusFromFm) ??
    'todo';

  const dueRaw = primary?.due ?? fm['due'] ?? null;
  const startRaw = primary?.start ?? fm['start'] ?? null;
  const completedRaw = primary?.completed ?? fm['completed'] ?? null;

  const priorityFm = typeof fm['priority'] === 'string' ? fm['priority'] : null;
  const priority =
    primary?.priority ?? (['p1', 'p2', 'p3', 'p4'] as const).find((p) => p === priorityFm) ?? 'p3';

  return {
    taskId: note.id,
    title: String(title),
    status,
    dueAt: toIsoOrNull(dueRaw),
    startAt: toIsoOrNull(startRaw),
    completedAt: toIsoOrNull(completedRaw),
    priority,
    tags: note.tags.filter((t) => !t.startsWith('cortex/')).map((t) => t.split('/').pop() ?? t),
    notes: bodyWithoutStructure(note.body),
  };
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim() ?? null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Body text minus the heading, the task line and the Cortex footer. */
function bodyWithoutStructure(body: string): string | null {
  const kept = body
    .split('\n')
    .filter((line) => !/^#\s+/.test(line))
    .filter((line) => !/^\s*-\s*\[[ xX\-/]\]/.test(line))
    .filter((line) => !/^\*Synced from Cortex/.test(line))
    .filter((line) => line.trim() !== '---')
    .join('\n')
    .trim();
  return kept.length ? kept : null;
}

/** Compare a vault-derived task against the stored one; null when unchanged. */
export function diffTask(task: Task, incoming: TaskUpdateFromVault): Partial<Task> | null {
  const patch: Partial<Task> = {};
  if (incoming.title && incoming.title !== task.title) patch.title = incoming.title;
  if (incoming.status !== task.status) patch.status = incoming.status;
  if (incoming.priority !== task.priority) patch.priority = incoming.priority;
  if (incoming.dueAt !== task.dueAt) patch.dueAt = incoming.dueAt;
  if (incoming.startAt !== task.startAt) patch.startAt = incoming.startAt;
  if ((incoming.notes ?? null) !== (task.notes ?? null)) patch.notes = incoming.notes;
  if (incoming.status === 'done' && !task.completedAt) {
    patch.completedAt = incoming.completedAt ?? new Date().toISOString();
  }
  if (incoming.status !== 'done' && task.completedAt) patch.completedAt = null;
  return Object.keys(patch).length ? patch : null;
}

/** Bookkeeping after a successful transfer. */
export function mappingAfterSync(action: SyncAction, content: string): { baseHash: string; conflict: boolean } {
  return { baseHash: contentHash(normalize(content)), conflict: action.kind === 'conflict' };
}
