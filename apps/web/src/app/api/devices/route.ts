import { z } from 'zod';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const DeviceSchema = z.object({
  name: z.string().max(200).default('iPhone'),
  platform: z.enum(['ios', 'ipados', 'macos', 'web']).default('ios'),
  pushToken: z.string().max(500).nullish(),
  /**
   * Mirrors `SystemLanguageModel.availability` on the device. The web app uses
   * it to explain precisely why an AI feature is unavailable rather than
   * silently hiding it.
   */
  afmAvailability: z
    .enum(['available', 'device_not_eligible', 'model_not_ready', 'apple_intelligence_disabled', 'unsupported_os', 'unknown'])
    .default('unknown'),
  appVersion: z.string().max(40).nullish(),
});

/** POST /api/devices - register or refresh this device. */
export async function POST(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const parsed = DeviceSchema.safeParse(payload);
  if (!parsed.success) return apiError('Invalid device payload', 422, parsed.error.issues);

  const device = parsed.data;
  const { data, error } = await context.supabase
    .from('devices')
    .upsert(
      {
        user_id: context.userId,
        name: device.name,
        platform: device.platform,
        push_token: device.pushToken ?? null,
        afm_availability: device.afmAvailability,
        app_version: device.appVersion ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,push_token' },
    )
    .select('*')
    .single();
  if (error) return apiError(error.message, 500);

  return apiOk(data, 201);
}

export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const { data, error } = await context.supabase.from('devices').select('*').order('last_seen_at', { ascending: false });
  if (error) return apiError(error.message, 500);
  return apiOk(data ?? []);
}
