'use server';

import { revalidatePath } from 'next/cache';
import { randomId } from '@cortex/core';
import { NotificationSettings, PrivacySettings, SchedulingSettings } from '@cortex/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ActionResult } from './tasks';

async function currentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function updatePrivacySettings(input: unknown): Promise<ActionResult> {
  const parsed = PrivacySettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Those privacy settings are not valid.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, privacy: parsed.data }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  return { ok: true };
}

export async function updateNotificationSettings(input: unknown): Promise<ActionResult> {
  const parsed = NotificationSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Those notification settings are not valid.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, notifications: parsed.data }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  return { ok: true };
}

export async function updateSchedulingSettings(input: unknown): Promise<ActionResult> {
  const parsed = SchedulingSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Those scheduling settings are not valid.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, scheduling: parsed.data }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  revalidatePath('/calendar');
  return { ok: true };
}

export async function updateProfile(input: { displayName?: string; timeZone?: string; weekStartsOn?: number }): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName.slice(0, 200);
  if (input.timeZone !== undefined) patch.time_zone = input.timeZone;
  if (input.weekStartsOn !== undefined) patch.week_starts_on = input.weekStartsOn;

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  return { ok: true };
}

const VAULT_FOLDER_DEFAULTS = {
  tasks: 'Cortex/Tasks',
  items: 'Cortex/Research',
  digests: 'Cortex/Digests',
  events: 'Cortex/Calendar',
  projects: 'Cortex/Projects',
  dailyNotes: 'Daily Notes',
};

export async function saveVaultConfig(input: {
  id?: string;
  name: string;
  transport: string;
  direction: 'push' | 'pull' | 'two_way';
  allowTopicScan: boolean;
  encryptionEnabled: boolean;
  restApiBaseUrl?: string | null;
  folders?: Partial<typeof VAULT_FOLDER_DEFAULTS>;
}): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const row = {
    user_id: userId,
    name: input.name.slice(0, 200) || 'Vault',
    transport: input.transport,
    direction: input.direction,
    allow_topic_scan: input.allowTopicScan,
    encryption_enabled: input.encryptionEnabled,
    rest_api_base_url: input.restApiBaseUrl || null,
    folders: { ...VAULT_FOLDER_DEFAULTS, ...(input.folders ?? {}) },
  };

  const { error } = input.id
    ? await supabase.from('vaults').update(row).eq('id', input.id)
    : await supabase.from('vaults').insert(row);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/obsidian');
  revalidatePath('/settings');
  return { ok: true };
}

/** Create a read-only share link. Notes stay private unless explicitly opted in. */
export async function createShare(input: {
  resourceType: 'project' | 'saved_view' | 'library_tag' | 'digest';
  resourceId: string;
  title?: string;
  includeNotes?: boolean;
  expiresInDays?: number | null;
}): Promise<ActionResult<{ token: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const token = `${randomId().replace(/-/g, '')}`.slice(0, 40);
  const { error } = await supabase.from('shares').insert({
    user_id: userId,
    token,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    title: input.title ?? null,
    include_notes: input.includeNotes ?? false,
    expires_at: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  return { ok: true, data: { token } };
}

export async function revokeShare(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('shares').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Delete every row this user owns.
 *
 * Cascades from auth.users would only fire on account deletion; this is the
 * "erase my data but keep the account" path the privacy page offers.
 */
export async function eraseCloudData(): Promise<ActionResult<{ deleted: string[] }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'You are signed out.' };

  const supabase = await createSupabaseServerClient();
  const tables = [
    'item_summaries', 'item_scores', 'item_states', 'info_items', 'digests',
    'topic_candidates', 'topics', 'sources', 'time_blocks', 'calendar_events',
    'calendars', 'calendar_accounts', 'reminders', 'task_dependencies',
    'task_tags', 'tasks', 'projects', 'tags', 'habit_entries', 'habits',
    'obsidian_files', 'vaults', 'saved_views', 'shares', 'ai_explanations',
  ];

  const deleted: string[] = [];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (!error) deleted.push(table);
  }

  for (const path of ['/today', '/tasks', '/feed', '/library', '/calendar', '/settings']) revalidatePath(path);
  return { ok: true, data: { deleted } };
}
