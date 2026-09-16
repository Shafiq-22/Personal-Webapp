/**
 * Publishable configuration.
 *
 * These two values are *designed* to be public: the Supabase URL is a hostname,
 * and the anon key is a JWT that Supabase ships inside the JavaScript bundle of
 * every app that uses it. Neither grants any access on its own - row level
 * security is the boundary, and every table in this project has it.
 *
 * They are committed here rather than read only from the environment so the app
 * deploys and runs with no configuration step. An environment variable of the
 * same name always wins, so moving them into the hosting provider's settings
 * later needs no code change.
 *
 * The service role key is *not* here and never should be. Nothing in the web app
 * requires it: scheduled work runs in Supabase Edge Functions, which receive it
 * from the platform, and public share links go through a security-definer
 * function that the anon role is allowed to call.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '__SUPABASE_URL__';

export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '__SUPABASE_ANON_KEY__';

/** False when neither a committed default nor an environment variable is set. */
export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL) && !SUPABASE_URL.startsWith('__') && Boolean(SUPABASE_ANON_KEY) && !SUPABASE_ANON_KEY.startsWith('__');
}

/**
 * The origin to send auth redirects back to.
 *
 * Prefers an explicit setting, then the deployment URL the host injects, and
 * falls back to the browser's own origin - which is what makes preview
 * deployments work without being listed anywhere.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}
