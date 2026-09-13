'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { captureToTaskInput, parseCapture, rollForward } from '@cortex/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { taskToRow } from '@/lib/mappers';

/**
 * Task mutations.
 *
 * Server Actions rather than API routes: the web UI gets progressive
 * enhancement and optimistic updates for free, and the REST API under
 * `/api` stays a clean, documented surface for the iOS companion and the
 * browser extension rather than something the web UI also depends on.
 *
 * Every action returns `{ ok }` instead of throwing, so a failure renders as a
 * toast rather than an error boundary.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function revalidateTaskSurfaces(): void {
  for (const path of ['/today', '/tasks', '/calendar', '/review', '/analytics']) revalidatePath(path);
}

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20_000).nullish(),
  projectId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
  priority: z.enum(['p1', 'p2', 'p3', 'p4']).default('p3'),
  dueAt: z.string().nullish(),
  dueAllDay: z.boolean().default(false),
  estimateMinutes: z.number().int().min(5).max(600).nullish(),
  energy: z.enum(['low', 'medium', 'high']).nullish(),
  recurrenceRule: z.string().max(300).nullish(),
  tagIds: z.array(z.string().uuid()).default([]),
  sourceItemId: z.string().uuid().nullish(),
  origin: z.string().default('manual'),
  captureText: z.string().nullish(),
});

export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid task' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { tagIds, ...task } = parsed.data;

  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...taskToRow(task as never), user_id: userId, title: task.title })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  if (tagIds.length) {
    await supabase.from('task_tags').insert(tagIds.map((tagId) => ({ task_id: data.id, tag_id: tagId, user_id: userId })));
  }

  revalidateTaskSurfaces();
  return { ok: true, data: { id: data.id } };
}

/**
 * Natural-language capture from the web.
 *
 * The web parses with the deterministic grammar in @cortex/core. The iOS app
 * hands the same string to Apple Foundation Models first and only falls back
 * to this grammar when the model is unavailable - so the result shape is
 * identical either way and the task looks the same wherever it was captured.
 */
export async function captureTask(text: string, timeZoneOffsetMinutes = 0): Promise<ActionResult<{ id: string; title: string }>> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Type something to capture.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const parsed = parseCapture(trimmed, { offsetMinutes: timeZoneOffsetMinutes });
  const taskInput = captureToTaskInput(parsed);

  // `#project` and `@tag` are matched by name, and created when they are new.
  let projectId: string | null = null;
  if (parsed.projectName) {
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .ilike('name', parsed.projectName)
      .limit(1)
      .maybeSingle();
    if (existing) projectId = existing.id;
    else {
      const { data: created } = await supabase
        .from('projects')
        .insert({ user_id: userId, name: parsed.projectName })
        .select('id')
        .single();
      projectId = created?.id ?? null;
    }
  }

  const tagIds: string[] = [];
  for (const name of parsed.tagNames) {
    const { data: existing } = await supabase.from('tags').select('id').eq('name', name).maybeSingle();
    if (existing) tagIds.push(existing.id);
    else {
      const { data: created } = await supabase.from('tags').insert({ user_id: userId, name }).select('id').single();
      if (created) tagIds.push(created.id);
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...taskToRow(taskInput as never), user_id: userId, title: taskInput.title, project_id: projectId })
    .select('id, title')
    .single();

  if (error) return { ok: false, error: error.message };
  if (tagIds.length) {
    await supabase.from('task_tags').insert(tagIds.map((tagId) => ({ task_id: data.id, tag_id: tagId, user_id: userId })));
  }

  revalidateTaskSurfaces();
  return { ok: true, data: { id: data.id, title: data.title } };
}

const UpdateTaskSchema = CreateTaskSchema.partial().extend({ id: z.string().uuid() });

export async function updateTask(input: unknown): Promise<ActionResult> {
  const parsed = UpdateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid update' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { id, tagIds, ...patch } = parsed.data;

  const { error } = await supabase.from('tasks').update(taskToRow(patch as never)).eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (tagIds) {
    await supabase.from('task_tags').delete().eq('task_id', id);
    if (tagIds.length) {
      await supabase.from('task_tags').insert(tagIds.map((tagId) => ({ task_id: id, tag_id: tagId, user_id: userId })));
    }
  }

  revalidateTaskSurfaces();
  return { ok: true };
}

/**
 * Completing a recurring task rolls it forward rather than closing it - the
 * next occurrence is computed from the RRULE and the task stays open.
 */
export async function setTaskStatus(id: string, status: 'todo' | 'in_progress' | 'done' | 'cancelled'): Promise<ActionResult<{ rolledTo: string | null }>> {
  const supabase = await createSupabaseServerClient();

  const { data: task, error: readError } = await supabase
    .from('tasks')
    .select('id, due_at, recurrence_rule, recurrence_anchor')
    .eq('id', id)
    .single();
  if (readError) return { ok: false, error: readError.message };

  if (status === 'done' && task.recurrence_rule) {
    const next = rollForward(
      { dueAt: task.due_at, recurrenceRule: task.recurrence_rule, recurrenceAnchor: task.recurrence_anchor },
      new Date(),
    );
    if (next) {
      const { error } = await supabase
        .from('tasks')
        .update({ due_at: next.toISOString(), status: 'todo', completed_at: null })
        .eq('id', id);
      if (error) return { ok: false, error: error.message };
      revalidateTaskSurfaces();
      return { ok: true, data: { rolledTo: next.toISOString() } };
    }
  }

  const { error } = await supabase
    .from('tasks')
    .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidateTaskSurfaces();
  return { ok: true, data: { rolledTo: null } };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateTaskSurfaces();
  return { ok: true };
}

export async function createProject(name: string, parentId: string | null = null): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };
  if (!name.trim()) return { ok: false, error: 'A project needs a name.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name: name.trim(), parent_id: parentId })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  revalidateTaskSurfaces();
  return { ok: true, data: { id: data.id } };
}

const ReminderSchema = z.object({
  taskId: z.string().uuid(),
  kind: z.enum(['time', 'location', 'dependency', 'escalating']),
  label: z.string().max(200).nullish(),
  triggerAt: z.string().nullish(),
  offsetMinutes: z.number().int().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  radiusMeters: z.number().int().nullish(),
  geofenceTrigger: z.enum(['enter', 'exit']).nullish(),
  dependsOnTaskId: z.string().uuid().nullish(),
  escalationSteps: z.array(z.object({ afterMinutes: z.number().int().min(1), channel: z.string().default('notification') })).default([]),
});

export async function createReminder(input: unknown): Promise<ActionResult> {
  const parsed = ReminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid reminder' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const r = parsed.data;
  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    task_id: r.taskId,
    kind: r.kind,
    label: r.label ?? null,
    trigger_at: r.triggerAt ?? null,
    offset_minutes: r.offsetMinutes ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    radius_meters: r.radiusMeters ?? null,
    geofence_trigger: r.geofenceTrigger ?? null,
    depends_on_task_id: r.dependsOnTaskId ?? null,
    escalation_steps: r.escalationSteps,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/tasks');
  return { ok: true };
}

export async function logHabit(habitId: string, day: string): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('habit_entries')
    .upsert({ user_id: userId, habit_id: habitId, day, count: 1 }, { onConflict: 'habit_id,day' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/today');
  revalidatePath('/review');
  return { ok: true };
}
