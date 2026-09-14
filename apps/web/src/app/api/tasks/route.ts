import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildTaskTree } from '@cortex/core';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { taskToRow, toTask } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks - list tasks
 *
 * Query: status (comma separated), project, updatedSince, limit, tree
 * `updatedSince` is what the iOS companion uses for delta sync.
 */
export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const url = new URL(request.url);
  const status = url.searchParams.get('status')?.split(',').filter(Boolean);
  const project = url.searchParams.get('project');
  const updatedSince = url.searchParams.get('updatedSince');
  const limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 200));

  let query = context.supabase
    .from('tasks')
    .select('*, task_tags(tag_id)')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (status?.length) query = query.in('status', status);
  if (project) query = query.eq('project_id', project);
  if (updatedSince) query = query.gt('updated_at', updatedSince);

  const { data, error } = await query;
  if (error) return apiError(error.message, 500);

  const tasks = (data ?? []).map(toTask);
  if (url.searchParams.get('tree') === 'true') {
    return apiOk(buildTaskTree(tasks).map(({ task, depth }) => ({ ...task, depth })));
  }
  return apiOk(tasks);
}

const CreateSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20_000).nullish(),
  projectId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
  priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  energy: z.enum(['low', 'medium', 'high']).nullish(),
  dueAt: z.string().nullish(),
  dueAllDay: z.boolean().optional(),
  startAt: z.string().nullish(),
  estimateMinutes: z.number().int().min(5).max(600).nullish(),
  recurrenceRule: z.string().max(300).nullish(),
  recurrenceAnchor: z.string().nullish(),
  /**
   * Where this came from. `ios` marks a task Apple Foundation Models parsed on
   * device; `captureText` keeps the original phrasing for auditability.
   */
  origin: z.enum(['manual', 'nl_capture', 'calendar', 'obsidian', 'feed', 'clipper', 'ios', 'system']).optional(),
  captureText: z.string().max(2000).nullish(),
  sourceItemId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
});

/** POST /api/tasks - create one task, or an array of them. */
export async function POST(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const parsed = z.union([CreateSchema, z.array(CreateSchema).max(100)]).safeParse(payload);
  if (!parsed.success) return apiError('Invalid task payload', 422, parsed.error.issues);

  const inputs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const rows = inputs.map((input) => {
    const { tagIds: _tagIds, ...task } = input;
    return { ...taskToRow(task as never), user_id: context.userId, title: input.title };
  });

  const { data, error } = await context.supabase.from('tasks').insert(rows).select('*, task_tags(tag_id)');
  if (error) return apiError(error.message, 500);

  const created = (data ?? []).map(toTask);
  const tagLinks = created.flatMap((task, index) =>
    (inputs[index]?.tagIds ?? []).map((tagId) => ({ task_id: task.id, tag_id: tagId, user_id: context.userId })),
  );
  if (tagLinks.length) await context.supabase.from('task_tags').insert(tagLinks);

  return NextResponse.json({ data: Array.isArray(parsed.data) ? created : created[0] }, { status: 201 });
}
