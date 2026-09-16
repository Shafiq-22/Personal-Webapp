import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from '../public-config';

export { hasSupabaseConfig };

/**
 * Request-scoped client that carries the user's session. RLS applies.
 *
 * Async because Next 15 made `cookies()` a promise.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the middleware refreshes the
          // session instead, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Anonymous client, with no session at all.
 *
 * Used for the public share page, which must work for a visitor who has never
 * signed in. It reaches exactly one security-definer function (`resolve_share`)
 * that the anon role is granted; it cannot read any table directly.
 */
export function createSupabaseAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Optional: the key is only present when the deployment sets it, and the only
 * feature that needs it is writing Google OAuth tokens. Returns null rather than
 * throwing so a missing key degrades one feature instead of breaking a page.
 */
export function createSupabaseServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
