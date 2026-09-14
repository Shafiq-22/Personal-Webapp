import {
  eventsToIcs,
  itemsToCsv,
  renderItemNote,
  renderTaskNote,
  tasksToCsv,
  tasksToIcs,
  toBibtex,
  toRis,
} from '@cortex/core';
import { apiError, authenticate, isResponse } from '@/lib/api-auth';
import { toEvent, toInfoItem, toProject, toTask } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
  bibtex: 'application/x-bibtex; charset=utf-8',
  ris: 'application/x-research-info-systems; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

const EXTENSIONS: Record<string, string> = {
  csv: 'csv',
  ics: 'ics',
  bibtex: 'bib',
  ris: 'ris',
  markdown: 'md',
  json: 'json',
};

/**
 * GET /api/export/:format?scope=tasks|library|calendar
 *
 * Exports are a first-class exit: everything in Cortex can be taken out in a
 * format something else can read, without an account or an API key.
 */
export async function GET(request: Request, { params }: { params: Promise<{ format: string }> }) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const { format } = await params;
  if (!(format in CONTENT_TYPES)) return apiError(`Unsupported format "${format}"`, 400);

  const scope = new URL(request.url).searchParams.get('scope') ?? 'tasks';
  let body = '';

  if (scope === 'tasks') {
    const [{ data: taskRows }, { data: projectRows }] = await Promise.all([
      context.supabase.from('tasks').select('*, task_tags(tag_id)').limit(5000),
      context.supabase.from('projects').select('*'),
    ]);
    const tasks = (taskRows ?? []).map(toTask);
    const projects = (projectRows ?? []).map(toProject);
    const projectName = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? null) : null);

    if (format === 'csv') body = tasksToCsv(tasks, { projectName });
    else if (format === 'ics') body = tasksToIcs(tasks);
    else if (format === 'markdown') {
      body = tasks
        .map((task) =>
          renderTaskNote(task, { project: task.projectId ? (projects.find((p) => p.id === task.projectId) ?? null) : null }),
        )
        .join('\n\n---\n\n');
    } else if (format === 'json') body = JSON.stringify(tasks, null, 2);
    else return apiError(`Tasks cannot be exported as ${format}`, 400);
  } else if (scope === 'library') {
    const { data: stateRows } = await context.supabase.from('item_states').select('item_id, notes, tags').eq('state', 'saved');
    const ids = (stateRows ?? []).map((row) => row.item_id as string);
    if (ids.length === 0) {
      body = format === 'json' ? '[]' : '';
    } else {
      const [{ data: itemRows }, { data: scoreRows }] = await Promise.all([
        context.supabase.from('info_items').select('*').in('id', ids),
        context.supabase.from('item_scores').select('item_id, score').in('item_id', ids),
      ]);
      const items = (itemRows ?? []).map(toInfoItem);
      const notesById = new Map((stateRows ?? []).map((row) => [row.item_id as string, row]));
      const bestScore = new Map<string, number>();
      for (const row of scoreRows ?? []) {
        const current = bestScore.get(row.item_id as string) ?? 0;
        if (Number(row.score) > current) bestScore.set(row.item_id as string, Number(row.score));
      }

      if (format === 'bibtex') body = toBibtex(items);
      else if (format === 'ris') body = toRis(items);
      else if (format === 'csv') body = itemsToCsv(items, bestScore);
      else if (format === 'markdown') {
        body = items
          .map((item) =>
            renderItemNote(item, {
              relevance: bestScore.get(item.id) ?? null,
              userNotes: (notesById.get(item.id)?.notes as string) ?? null,
              userTags: (notesById.get(item.id)?.tags as string[]) ?? [],
            }),
          )
          .join('\n\n---\n\n');
      } else if (format === 'json') body = JSON.stringify(items, null, 2);
      else return apiError(`The library cannot be exported as ${format}`, 400);
    }
  } else if (scope === 'calendar') {
    const { data: eventRows } = await context.supabase
      .from('calendar_events')
      .select('*')
      .neq('status', 'cancelled')
      .limit(5000);
    const events = (eventRows ?? []).map(toEvent);
    if (format === 'ics') body = eventsToIcs(events);
    else if (format === 'json') body = JSON.stringify(events, null, 2);
    else return apiError(`The calendar cannot be exported as ${format}`, 400);
  } else {
    return apiError(`Unknown scope "${scope}"`, 400);
  }

  const filename = `cortex-${scope}-${new Date().toISOString().slice(0, 10)}.${EXTENSIONS[format]}`;
  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPES[format] as string,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
