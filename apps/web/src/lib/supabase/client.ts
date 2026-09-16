'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../public-config';

let cached: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client, used for auth flows and realtime subscriptions. */
export function createSupabaseBrowserClient() {
  if (cached) return cached;
  cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
