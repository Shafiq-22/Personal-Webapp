import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

/**
 * Finish the Google Calendar connection.
 *
 * The refresh token is written with the service-role client into a column the
 * browser cannot read (see the RLS migration): the web client only ever sees
 * `calendar_accounts_public`, which omits it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const fail = (reason: string) => NextResponse.redirect(new URL(`/calendar?error=${encodeURIComponent(reason)}`, request.url));

  if (error) return fail(error);
  if (!code) return fail('Google did not return an authorisation code.');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('cortex_google_state')?.value;
  if (!expectedState || expectedState !== state) return fail('The connection request expired. Please try again.');

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  if (!clientId || !clientSecret) return fail('Google OAuth is not configured on this deployment.');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${siteUrl}/api/calendar/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) return fail(`Google rejected the token exchange (HTTP ${tokenResponse.status}).`);

  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    return fail('Google did not return a refresh token. Remove Cortex from your Google account permissions and reconnect.');
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = profileResponse.ok ? ((await profileResponse.json()) as { email?: string }) : {};

  const service = createSupabaseServiceClient();
  if (!service) {
    return fail('Connecting a calendar needs SUPABASE_SERVICE_ROLE_KEY set on this deployment.');
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { data: account, error: accountError } = await service
    .from('calendar_accounts')
    .upsert(
      {
        user_id: user.id,
        provider: 'google',
        account_email: profile.email ?? user.email ?? 'unknown',
        scopes: tokens.scope.split(' '),
        encrypted_tokens: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
        }),
        token_expires_at: expiresAt,
        sync_enabled: true,
      },
      { onConflict: 'user_id,provider,account_email' },
    )
    .select('id')
    .single();
  if (accountError) return fail(accountError.message);

  // Pull the calendar list straight away so the user has something to select.
  const listResponse = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (listResponse.ok) {
    const list = (await listResponse.json()) as {
      items?: Array<{ id: string; summary: string; description?: string; timeZone?: string; backgroundColor?: string; primary?: boolean; accessRole?: string }>;
    };
    const calendars = (list.items ?? []).map((calendar) => ({
      user_id: user.id,
      account_id: account.id,
      external_id: calendar.id,
      name: calendar.summary ?? calendar.id,
      description: calendar.description ?? null,
      time_zone: calendar.timeZone ?? 'UTC',
      color: calendar.backgroundColor ?? null,
      selected: true,
      is_primary_target: Boolean(calendar.primary),
      access_role: (['owner', 'writer', 'reader', 'freeBusyReader'] as const).includes(calendar.accessRole as never)
        ? (calendar.accessRole as 'owner')
        : 'reader',
    }));
    if (calendars.length) await service.from('calendars').upsert(calendars, { onConflict: 'account_id,external_id' });
  }

  const response = NextResponse.redirect(new URL('/calendar?connected=google', request.url));
  response.cookies.delete('cortex_google_state');
  return response;
}
