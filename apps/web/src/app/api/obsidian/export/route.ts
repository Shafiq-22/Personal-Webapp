import {
  renderDailySection,
  renderDigestNote,
  renderItemNote,
  renderTaskNote,
  vaultPathFor,
  VaultConfig,
} from '@cortex/core';
import { authenticate, isResponse } from '@/lib/api-auth';
import { toDigest, toEvent, toInfoItem, toProject, toTask, toVault } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/obsidian/export - the whole vault as one Markdown bundle.
 *
 * A single concatenated file rather than a zip: it needs no dependency, it is
 * readable as-is, and every note is preceded by the exact vault-relative path
 * it belongs at, so unpacking it is a scriptable operation. The iOS companion
 * writes the same notes directly into iCloud Drive instead.
 */
export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const [{ data: vaultRow }, { data: taskRows }, { data: projectRows }, { data: stateRows }, { data: digestRows }, { data: eventRows }] =
    await Promise.all([
      context.supabase.from('vaults').select('*').limit(1).maybeSingle(),
      context.supabase.from('tasks').select('*, task_tags(tag_id)').in('status', ['todo', 'in_progress']).limit(1000),
      context.supabase.from('projects').select('*'),
      context.supabase.from('item_states').select('item_id, notes, tags').eq('state', 'saved').limit(500),
      context.supabase.from('digests').select('*').order('window_start', { ascending: false }).limit(10),
      context.supabase
        .from('calendar_events')
        .select('*')
        .gte('start_at', new Date().toISOString().slice(0, 10))
        .neq('status', 'cancelled')
        .limit(100),
    ]);

  const vault = vaultRow
    ? toVault(vaultRow)
    : VaultConfig.parse({ id: '00000000-0000-4000-a000-000000000000', userId: context.userId, createdAt: new Date().toISOString() });

  const tasks = (taskRows ?? []).map(toTask);
  const projects = (projectRows ?? []).map(toProject);
  const events = (eventRows ?? []).map(toEvent);

  const savedIds = (stateRows ?? []).map((row) => row.item_id as string);
  const { data: itemRows } = savedIds.length
    ? await context.supabase.from('info_items').select('*').in('id', savedIds)
    : { data: [] };
  const items = (itemRows ?? []).map(toInfoItem);
  const stateById = new Map((stateRows ?? []).map((row) => [row.item_id as string, row]));

  const sections: string[] = [
    '# Cortex vault export',
    '',
    `Generated ${new Date().toISOString()}.`,
    '',
    'Each note below is preceded by the vault-relative path it belongs at.',
    'Unpack with a script, or let the iOS companion write these files directly.',
    '',
  ];

  const emit = (path: string, content: string) => {
    sections.push(`<!-- file: ${path} -->`, '', content.trimEnd(), '', '---', '');
  };

  for (const task of tasks) {
    const project = task.projectId ? (projects.find((p) => p.id === task.projectId) ?? null) : null;
    emit(
      vaultPathFor(vault, { type: 'task', task }),
      renderTaskNote(task, { project, subtasks: tasks.filter((t) => t.parentTaskId === task.id) }),
    );
  }

  for (const item of items) {
    const state = stateById.get(item.id);
    emit(
      vaultPathFor(vault, { type: 'item', item }),
      renderItemNote(item, {
        userNotes: (state?.notes as string) ?? null,
        userTags: (state?.tags as string[]) ?? [],
      }),
    );
  }

  for (const row of digestRows ?? []) {
    const digest = toDigest(row);
    emit(vaultPathFor(vault, { type: 'digest', digest }), renderDigestNote(digest));
  }

  const today = new Date();
  emit(
    vaultPathFor(vault, { type: 'daily', day: today }),
    renderDailySection({
      day: today,
      tasks: tasks.filter((task) => task.dueAt?.slice(0, 10) === today.toISOString().slice(0, 10)),
      events: events.filter((event) => event.startAt.slice(0, 10) === today.toISOString().slice(0, 10)),
      digestHeadline: digestRows?.[0] ? (digestRows[0].headline as string) : null,
    }),
  );

  return new Response(sections.join('\n'), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="cortex-vault-${today.toISOString().slice(0, 10)}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
