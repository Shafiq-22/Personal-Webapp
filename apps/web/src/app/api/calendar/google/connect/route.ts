import { NextResponse } from 'next/server';
import { randomId } from '@cortex/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Start the Google Calendar OAuth flow.
 *
 * Deliberately separate from signing in with Google: calendar scopes are only
 * ever requested here, when the user explicitly connects a calendar, so signing
 * in never implies access to it. `access_type=offline` with `prompt=consent`
 * is what yields a refresh token, which is stored server-side only.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  if (!clientId) {
    return NextResponse.redirect(new URL('/calendar?error=google_not_configured', request.url));
  }

  // CSRF protection: the state is signed into a short-lived, http-only cookie
  // and compared on the way back.
  const state = randomId();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${siteUrl}/api/calendar/google/callback`,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set('cortex_google_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
