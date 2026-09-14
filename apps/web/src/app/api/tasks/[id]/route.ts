import { z } from 'zod';
import { rollForward } from '@cortex/core';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { taskToRow, toTask } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;
  const { id } = await params;

  const { data, error } = await context.supabase
    .from('tasks')
    .select('*, task_tags(tag_id)')
    .eq('id', id)
    .maybeSingle();
  if (error) return apiError(error.message, 500);
  if (!data) return apiError('No such task', 404);

  return apiOk(toTask(data));
}

const PatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(20_000).nullish(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
  energy: z.enum(['low', 'medium', 'high']).nullish(),
  dueAt: z.string().nullish(),
  dueAllDay: z.boolean().optional(),
  startAt: z.string().nullish(),
  estimateMinutes: z.number().int().min(5).max(600).nullish(),
  projectId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
  recurrenceRule: z.string().max(300).nullish(),
  sortOrder: z.number().int().optional(),
});

/**
 * PATCH /api/tasks/:id
 *
 * Completing a recurring task rolls it forward to its next occurrence instead
 * of closing it, and the response says where it went, so the companion app can
 * show "next on Monday" rather than making the task vanish.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) return apiError('Invalid patch', 422, parsed.error.issues);

  const { data: existing, error: readError } = await context.supabase
    .from('tasks')
    .select('id, due_at, recurrence_rule, recurrence_anchor')
    .eq('id', id)
    .maybeSingle();
  if (readError) return apiError(readError.message, 500);
  if (!existing) return apiError('No such task', 404);

  let patch = taskToRow(parsed.data as never);
  let rolledTo: string | null = null;

  if (parsed.data.status === 'done' && existing.recurrence_rule) {
    const next = rollForward(
      { dueAt: existing.due_at, recurrenceRule: existing.recurrence_rule, recurrenceAnchor: existing.recurrence_anchor },
      new Date(),
    );
    if (next) {
      rolledTo = next.toISOString();
      patch = { ...patch, status: 'todo', due_at: rolledTo, completed_at: null };
    }
  }

  const { data, error } = await context.supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select('*, task_tags(tag_id)')
    .single();
  if (error) return apiError(error.message, 500);

  return apiOk({ task: toTask(data), rolledTo });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;
  const { id } = await params;

  const { error } = await context.supabase.from('tasks').delete().eq('id', id);
  if (error) return apiError(error.message, 500);
  return apiOk({ deleted: id });
}
