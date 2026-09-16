// Shared helpers for every Cortex edge function.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS_HEADERS }) : null;
}

/** Service-role client. Bypasses RLS - only ever used for scheduled work. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Client scoped to the caller's JWT, so RLS still applies. Used when a
 * function acts on behalf of one signed-in user.
 */
export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

/**
 * Authorise a scheduled invocation.
 *
 * The caller is pg_cron running inside this project's own database, which
 * cannot hold the service role key (nothing outside the platform should). It
 * sends a random token from the `cron_tokens` table instead, and this function
 * - which does hold the service role key, injected by the platform - checks it.
 *
 * The comparison is length-constant so a timing signal cannot leak the token,
 * and a missing or unknown token is a 401 rather than a hint about which.
 */
export async function assertCronCaller(req: Request): Promise<void> {
  const provided = req.headers.get('x-cortex-cron') ?? '';
  const unauthorised = Object.assign(new Error('this function is only callable by the scheduler'), { status: 401 });
  if (provided.length < 32) throw unauthorised;

  const { data, error } = await serviceClient()
    .from('cron_tokens')
    .select('token')
    .eq('name', 'scheduler')
    .maybeSingle();

  if (error || !data?.token) throw unauthorised;
  if (!timingSafeEqual(provided, data.token)) throw unauthorised;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function currentUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw Object.assign(new Error('not authenticated'), { status: 401 });
  return data.user.id;
}

/** Small concurrency limiter - feeds are fetched in parallel but politely. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function errorResponse(error: unknown): Response {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: number }).status) : 500;
  const message = error instanceof Error ? error.message : 'unexpected error';
  console.error('edge function failed:', message);
  return json({ error: message }, Number.isFinite(status) ? status : 500);
}
