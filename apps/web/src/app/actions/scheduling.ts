'use server';

import { revalidatePath } from 'next/cache';
import { proposeHabitBlocks, proposeTimeBlocks, replanBlocks, eventToBusy, type BusyInterval } from '@cortex/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { toEvent, toHabit, toSettings, toTask, toTimeBlock } from '@/lib/mappers';
import { zoneOffsetMinutes } from '@/lib/utils';
import type { ActionResult } from './tasks';

async function context() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: settingsRow }] = await Promise.all([
    supabase.from('profiles').select('time_zone').eq('id', user.id).maybeSingle(),
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
  ]);
  const timeZone = profile?.time_zone ?? 'UTC';
  return { supabase, userId: user.id, timeZone, settings: toSettings(settingsRow, user.id, timeZone) };
}

/**
 * Propose time blocks for the next few days.
 *
 * The proposal is deterministic and explained: each block carries the sentence
 * that justifies it. On iPhone the same free slots and the same task list are
 * handed to Apple Foundation Models, which may reorder them and write a better
 * rationale - those blocks come back with `engine = 'afm'`. Either way nothing
 * reaches Google Calendar until the user approves it.
 */
export async function proposeSchedule(days = 3): Promise<ActionResult<{ proposed: number }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: 'You are signed out.' };
  const { supabase, userId, timeZone, settings } = ctx;

  const now = new Date();
  const from = now;
  const to = new Date(now.getTime() + days * 86_400_000);

  const [{ data: taskRows }, { data: eventRows }, { data: blockRows }, { data: habitRows }] = await Promise.all([
    supabase.from('tasks').select('*, task_tags(tag_id)').in('status', ['todo', 'in_progress']).limit(200),
    supabase.from('calendar_events').select('*').lt('start_at', to.toISOString()).gt('end_at', from.toISOString()).neq('status', 'cancelled'),
    supabase.from('time_blocks').select('*').in('status', ['approved']).lt('start_at', to.toISOString()).gt('end_at', from.toISOString()),
    supabase.from('habits').select('*').eq('archived', false),
  ]);

  // Discard stale proposals so the view never mixes two generations.
  await supabase.from('time_blocks').delete().eq('status', 'proposed').gte('start_at', from.toISOString());

  const busy: BusyInterval[] = [
    ...(eventRows ?? []).map(toEvent).map(eventToBusy).filter((b): b is BusyInterval => b !== null),
    ...(blockRows ?? []).map(toTimeBlock).map((block) => ({
      start: new Date(block.startAt),
      end: new Date(block.endAt),
      label: block.title,
      sourceId: block.id,
    })),
  ];

  const options = {
    from,
    to,
    busy,
    settings: settings.scheduling,
    offsetMinutes: zoneOffsetMinutes(timeZone, now),
    now,
    userId,
  };

  const habitBlocks = proposeHabitBlocks(
    (habitRows ?? []).map(toHabit).filter((habit) => habit.blockMinutes !== null),
    options,
  );

  // Habit blocks are protected time, so tasks are placed around them.
  const taskBlocks = proposeTimeBlocks((taskRows ?? []).map(toTask), {
    ...options,
    busy: [...busy, ...habitBlocks.map((block) => ({ start: new Date(block.startAt), end: new Date(block.endAt), label: block.title }))],
  });

  const proposals = [...habitBlocks, ...taskBlocks];
  if (proposals.length === 0) return { ok: true, data: { proposed: 0 } };

  const { error } = await supabase.from('time_blocks').insert(
    proposals.map((block) => ({
      user_id: userId,
      task_id: block.taskId,
      habit_id: block.habitId,
      title: block.title,
      kind: block.kind,
      status: 'proposed',
      start_at: block.startAt,
      end_at: block.endAt,
      rationale: block.rationale,
      engine: block.engine,
    })),
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/calendar');
  revalidatePath('/today');
  return { ok: true, data: { proposed: proposals.length } };
}

export async function decideTimeBlock(id: string, decision: 'approved' | 'rejected' | 'completed'): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('time_blocks').update({ status: decision }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/calendar');
  revalidatePath('/today');
  return { ok: true };
}

export async function approveAllBlocks(): Promise<ActionResult<{ approved: number }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('time_blocks')
    .update({ status: 'approved' })
    .eq('status', 'proposed')
    .select('id');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/calendar');
  revalidatePath('/today');
  return { ok: true, data: { approved: data?.length ?? 0 } };
}

/** When the calendar moved under approved blocks, suggest where they go now. */
export async function replanSchedule(): Promise<ActionResult<{ suggestions: Array<{ blockId: string; title: string; reason: string; proposedStart: string | null; proposedEnd: string | null }> }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: 'You are signed out.' };
  const { supabase, userId, timeZone, settings } = ctx;

  const now = new Date();
  const to = new Date(now.getTime() + 7 * 86_400_000);

  const [{ data: blockRows }, { data: eventRows }] = await Promise.all([
    supabase.from('time_blocks').select('*').eq('status', 'approved').gte('start_at', now.toISOString()).lt('start_at', to.toISOString()),
    supabase.from('calendar_events').select('*').lt('start_at', to.toISOString()).gt('end_at', now.toISOString()).neq('status', 'cancelled'),
  ]);

  const busy = (eventRows ?? []).map(toEvent).map(eventToBusy).filter((b): b is BusyInterval => b !== null);
  const suggestions = replanBlocks((blockRows ?? []).map(toTimeBlock), busy, {
    from: now,
    to,
    busy,
    settings: settings.scheduling,
    offsetMinutes: zoneOffsetMinutes(timeZone, now),
    now,
    userId,
  });

  return {
    ok: true,
    data: {
      suggestions: suggestions.map((s) => ({
        blockId: s.block.id,
        title: s.block.title,
        reason: s.reason,
        proposedStart: s.proposedStart,
        proposedEnd: s.proposedEnd,
      })),
    },
  };
}

export async function moveTimeBlock(id: string, startAt: string, endAt: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('time_blocks').update({ start_at: startAt, end_at: endAt }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

/** Ask the edge function to sync now instead of waiting for the schedule. */
export async function syncCalendarNow(): Promise<ActionResult<{ message: string }>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You are signed out.' };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { ok: false, error: 'Supabase is not configured.' };

  try {
    const response = await fetch(`${base}/functions/v1/google-calendar-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) return { ok: false, error: `Sync failed: HTTP ${response.status}` };
    revalidatePath('/calendar');
    return { ok: true, data: { message: 'Calendar sync finished.' } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Sync failed.' };
  }
}
