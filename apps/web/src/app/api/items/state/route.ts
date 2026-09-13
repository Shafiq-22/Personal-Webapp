import { z } from 'zod';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const StateSchema = z.object({
  itemId: z.string().uuid(),
  state: z.enum(['new', 'read', 'saved', 'dismissed', 'snoozed']),
  notes: z.string().max(20_000).nullish(),
  tags: z.array(z.string().max(64)).optional(),
  rating: z.number().int().min(1).max(5).nullish(),
  snoozedUntil: z.string().nullish(),
});

/** POST /api/items/state - mark read, save to the library, dismiss or snooze. */
export async function POST(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const parsed = StateSchema.safeParse(payload);
  if (!parsed.success) return apiError('Invalid state payload', 422, parsed.error.issues);

  const input = parsed.data;
  const now = new Date().toISOString();
  const { data, error } = await context.supabase
    .from('item_states')
    .upsert(
      {
        user_id: context.userId,
        item_id: input.itemId,
        state: input.state,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        snoozed_until: input.state === 'snoozed' ? (input.snoozedUntil ?? new Date(Date.now() + 7 * 86_400_000).toISOString()) : null,
        read_at: input.state === 'read' || input.state === 'saved' ? now : null,
        saved_at: input.state === 'saved' ? now : null,
      },
      { onConflict: 'user_id,item_id' },
    )
    .select('*')
    .single();
  if (error) return apiError(error.message, 500);

  return apiOk(data);
}
