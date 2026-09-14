import { z } from 'zod';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { toSummary } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const SummarySchema = z.object({
  itemId: z.string().uuid(),
  style: z.enum(['tldr', 'key_points', 'implications', 'eli5', 'methodology', 'actions']),
  text: z.string().min(1).max(20_000),
  /**
   * `afm` means Apple Foundation Models wrote this on the user's device.
   * `heuristic` means it is an extract, not a written summary. The interface
   * presents the two very differently, so this must be accurate.
   */
  engine: z.enum(['afm', 'heuristic']).default('afm'),
  modelIdentifier: z.string().max(120).nullish(),
  deviceId: z.string().uuid().nullish(),
});

/**
 * POST /api/summaries - upload summaries produced on device.
 *
 * Refused unless the user turned on `privacy.syncAiSummaries`: by default what
 * the phone writes stays on the phone, and the web app shows the original
 * abstract instead.
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

  const parsed = z.union([SummarySchema, z.array(SummarySchema).max(50)]).safeParse(payload);
  if (!parsed.success) return apiError('Invalid summary payload', 422, parsed.error.issues);

  const { data: settings } = await context.supabase
    .from('user_settings')
    .select('privacy')
    .eq('user_id', context.userId)
    .maybeSingle();

  const syncEnabled = (settings?.privacy as { syncAiSummaries?: boolean } | null)?.syncAiSummaries === true;
  if (!syncEnabled) {
    return apiError(
      'Summary sync is off. Turn on "Sync on-device summaries" in privacy settings to store summaries in the cloud.',
      403,
    );
  }

  const summaries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const { data, error } = await context.supabase
    .from('item_summaries')
    .upsert(
      summaries.map((summary) => ({
        user_id: context.userId,
        item_id: summary.itemId,
        style: summary.style,
        text: summary.text,
        engine: summary.engine,
        model_identifier: summary.modelIdentifier ?? null,
        device_id: summary.deviceId ?? null,
      })),
      { onConflict: 'item_id,style,engine' },
    )
    .select('*');
  if (error) return apiError(error.message, 500);

  return apiOk((data ?? []).map(toSummary), 201);
}

/** GET /api/summaries?itemId=... */
export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const itemId = new URL(request.url).searchParams.get('itemId');
  let query = context.supabase.from('item_summaries').select('*').order('created_at', { ascending: false }).limit(200);
  if (itemId) query = query.eq('item_id', itemId);

  const { data, error } = await query;
  if (error) return apiError(error.message, 500);
  return apiOk((data ?? []).map(toSummary));
}
