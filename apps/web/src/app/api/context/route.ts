import { prioritizeTasks } from '@cortex/core';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { toEvent, toSettings, toTask, toTopic } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/context - everything the on-device model needs in one request.
 *
 * Apple Foundation Models has a finite context window, so the companion app
 * cannot simply hand it the whole account. This endpoint returns a compact,
 * pre-ranked slice: the open work that matters now, the next few days of
 * calendar, active topics, and the user's scheduling preferences.
 *
 * Note the direction of travel: context flows *to* the device and inferences
 * come back. No prompt, no note text and no item body is ever sent anywhere
 * else - the model runs on the phone.
 */
export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const url = new URL(request.url);
  const taskLimit = Math.min(60, Number(url.searchParams.get('tasks') ?? 25));
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86_400_000);

  const [{ data: taskRows }, { data: eventRows }, { data: topicRows }, { data: settingsRow }, { data: profile }] =
    await Promise.all([
      context.supabase.from('tasks').select('*, task_tags(tag_id)').in('status', ['todo', 'in_progress']).limit(300),
      context.supabase
        .from('calendar_events')
        .select('*')
        .gt('end_at', now.toISOString())
        .lt('start_at', horizon.toISOString())
        .neq('status', 'cancelled')
        .order('start_at')
        .limit(60),
      context.supabase.from('topics').select('*').eq('active', true),
      context.supabase.from('user_settings').select('*').eq('user_id', context.userId).maybeSingle(),
      context.supabase.from('profiles').select('time_zone, display_name').eq('id', context.userId).maybeSingle(),
    ]);

  const tasks = (taskRows ?? []).map(toTask);
  const ranked = prioritizeTasks(tasks, { now });
  const byId = new Map(tasks.map((task) => [task.id, task]));

  // Only the top slice, and only the fields the model actually needs.
  const topTasks = ranked
    .slice(0, taskLimit)
    .map(({ taskId, score, reasons }) => {
      const task = byId.get(taskId);
      if (!task) return null;
      return {
        id: task.id,
        title: task.title,
        notes: task.notes?.slice(0, 500) ?? null,
        priority: task.priority,
        status: task.status,
        dueAt: task.dueAt,
        estimateMinutes: task.estimateMinutes,
        energy: task.energy,
        heuristicScore: score,
        heuristicReasons: reasons,
      };
    })
    .filter(Boolean);

  const settings = toSettings(settingsRow, context.userId, profile?.time_zone ?? 'UTC');

  return apiOk({
    generatedAt: now.toISOString(),
    timeZone: settings.timeZone,
    displayName: profile?.display_name ?? null,
    tasks: topTasks,
    events: (eventRows ?? []).map(toEvent).map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      attendeeCount: event.attendeeCount,
      transparency: event.transparency,
    })),
    topics: (topicRows ?? []).map(toTopic).map((topic) => ({
      id: topic.id,
      label: topic.label,
      keywords: topic.keywords,
      weight: topic.weight,
    })),
    scheduling: settings.scheduling,
    privacy: { explainAiDecisions: settings.privacy.explainAiDecisions, syncAiSummaries: settings.privacy.syncAiSummaries },
  });
}
