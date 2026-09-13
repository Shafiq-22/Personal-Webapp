import { z } from 'zod';
import { captureToTaskInput, parseCapture } from '@cortex/core';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { taskToRow, toTask } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const CaptureSchema = z.object({
  text: z.string().min(1).max(2000),
  /** Minutes to add to UTC for the user's wall clock, e.g. -420 for PDT. */
  offsetMinutes: z.number().int().min(-840).max(840).default(0),
  /**
   * When the iOS app has already parsed the text with Apple Foundation Models
   * it sends the structured result here and the server trusts it rather than
   * re-parsing. `engine` records which side did the work.
   */
  parsed: z
    .object({
      title: z.string().min(1).max(500),
      dueAt: z.string().nullish(),
      dueAllDay: z.boolean().optional(),
      estimateMinutes: z.number().int().min(5).max(600).nullish(),
      priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
      energy: z.enum(['low', 'medium', 'high']).nullish(),
      recurrenceRule: z.string().max(300).nullish(),
      projectName: z.string().max(200).nullish(),
      tagNames: z.array(z.string().max(64)).optional(),
    })
    .optional(),
  engine: z.enum(['afm', 'heuristic']).default('heuristic'),
});

/**
 * POST /api/capture - turn a line of natural language into a task.
 *
 * The parse can happen in either place. On iPhone, Apple Foundation Models does
 * it on device and posts the structured result; everywhere else the server runs
 * the deterministic grammar from @cortex/core. Both paths produce the same
 * shape, so a task looks identical wherever it was captured.
 */
export async function POST(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const input = CaptureSchema.safeParse(payload);
  if (!input.success) return apiError('Invalid capture payload', 422, input.error.issues);

  const { text, offsetMinutes, engine } = input.data;
  const parsed = input.data.parsed ?? parseCapture(text, { offsetMinutes });
  const taskInput = captureToTaskInput({
    title: parsed.title,
    dueAt: parsed.dueAt ?? null,
    dueAllDay: parsed.dueAllDay ?? false,
    estimateMinutes: parsed.estimateMinutes ?? null,
    priority: parsed.priority ?? 'p3',
    energy: parsed.energy ?? null,
    recurrenceRule: parsed.recurrenceRule ?? null,
    projectName: parsed.projectName ?? null,
    tagNames: parsed.tagNames ?? [],
    // A device parse is authoritative; a server parse reports how much it recognised.
    confidence: 'confidence' in parsed && typeof parsed.confidence === 'number' ? parsed.confidence : 1,
    raw: text,
  });

  // Resolve `#project` and `@tag` by name, creating them when they are new.
  let projectId: string | null = null;
  if (parsed.projectName) {
    const { data: existing } = await context.supabase
      .from('projects')
      .select('id')
      .ilike('name', parsed.projectName)
      .limit(1)
      .maybeSingle();
    projectId = existing?.id ?? null;
    if (!projectId) {
      const { data: created } = await context.supabase
        .from('projects')
        .insert({ user_id: context.userId, name: parsed.projectName })
        .select('id')
        .single();
      projectId = created?.id ?? null;
    }
  }

  const { data: task, error } = await context.supabase
    .from('tasks')
    .insert({
      ...taskToRow(taskInput as never),
      user_id: context.userId,
      title: taskInput.title,
      project_id: projectId,
      origin: engine === 'afm' ? 'ios' : 'nl_capture',
    })
    .select('*, task_tags(tag_id)')
    .single();
  if (error) return apiError(error.message, 500);

  const tagNames = parsed.tagNames ?? [];
  if (tagNames.length) {
    const tagIds: string[] = [];
    for (const name of tagNames) {
      const { data: existing } = await context.supabase.from('tags').select('id').eq('name', name).maybeSingle();
      if (existing) tagIds.push(existing.id);
      else {
        const { data: created } = await context.supabase
          .from('tags')
          .insert({ user_id: context.userId, name })
          .select('id')
          .single();
        if (created) tagIds.push(created.id);
      }
    }
    if (tagIds.length) {
      await context.supabase
        .from('task_tags')
        .insert(tagIds.map((tagId) => ({ task_id: task.id, tag_id: tagId, user_id: context.userId })));
    }
  }

  // Record how the task was understood, for the "explain this" surface.
  await context.supabase.from('ai_explanations').insert({
    user_id: context.userId,
    subject_type: 'task',
    subject_id: task.id,
    decision: 'natural_language_capture',
    rationale: `Parsed "${text}" into a task${parsed.dueAt ? ` due ${parsed.dueAt}` : ''}.`,
    engine,
    inputs: { text, offsetMinutes },
  });

  return apiOk({ task: toTask(task), engine }, 201);
}
