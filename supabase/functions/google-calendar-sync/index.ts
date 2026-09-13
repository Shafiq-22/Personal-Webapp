/**
 * google-calendar-sync - two-way sync with Google Calendar.
 *
 * Pull:  incremental `events.list` using the stored syncToken per calendar,
 *        falling back to a full window when Google invalidates it (410).
 * Push:  time blocks the user approved are written back as real events and
 *        linked to the block, so a change in Google is visible next pull.
 *
 * Refresh tokens never leave the service role: the browser and the iOS app
 * both call this function instead of talking to Google directly.
 */
import {
  CORS_HEADERS,
  assertServiceRole,
  currentUserId,
  errorResponse,
  json,
  preflight,
  serviceClient,
  userClient,
} from '../_shared/supabase.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const WINDOW_DAYS_BACK = 30;
const WINDOW_DAYS_FORWARD = 120;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at?: string;
}

async function accessTokenFor(
  supabase: ReturnType<typeof serviceClient>,
  account: { id: string; encrypted_tokens: string | null; token_expires_at: string | null },
): Promise<string> {
  if (!account.encrypted_tokens) throw new Error('this calendar account has no stored credentials; reconnect it');
  const tokens = JSON.parse(account.encrypted_tokens) as StoredTokens;

  const stillValid = account.token_expires_at && Date.parse(account.token_expires_at) > Date.now() + 60_000;
  if (stillValid && tokens.access_token) return tokens.access_token;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`refreshing the Google token failed: HTTP ${response.status}`);

  const refreshed = (await response.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from('calendar_accounts')
    .update({
      encrypted_tokens: JSON.stringify({ ...tokens, access_token: refreshed.access_token, expires_at: expiresAt }),
      token_expires_at: expiresAt,
    })
    .eq('id', account.id);
  return refreshed.access_token;
}

function mapGoogleEvent(event: Record<string, unknown>, userId: string, calendarId: string) {
  const start = event.start as { dateTime?: string; date?: string } | undefined;
  const end = event.end as { dateTime?: string; date?: string } | undefined;
  const allDay = Boolean(start?.date && !start?.dateTime);
  const attendees = (event.attendees ?? []) as unknown[];

  return {
    user_id: userId,
    calendar_id: calendarId,
    external_id: event.id as string,
    title: (event.summary as string) ?? '(no title)',
    description: (event.description as string) ?? null,
    location: (event.location as string) ?? null,
    start_at: start?.dateTime ?? (start?.date ? `${start.date}T00:00:00Z` : new Date().toISOString()),
    end_at: end?.dateTime ?? (end?.date ? `${end.date}T00:00:00Z` : new Date().toISOString()),
    all_day: allDay,
    transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
    status: (event.status as string) === 'cancelled' ? 'cancelled' : (event.status as string) === 'tentative' ? 'tentative' : 'confirmed',
    organizer_email: (event.organizer as { email?: string } | undefined)?.email ?? null,
    attendee_count: attendees.length,
    recurring_event_id: (event.recurringEventId as string) ?? null,
    html_link: (event.htmlLink as string) ?? null,
    etag: (event.etag as string) ?? null,
    created_by_cortex: Boolean((event.extendedProperties as { private?: Record<string, string> } | undefined)?.private?.cortex_block_id),
    updated_at: (event.updated as string) ?? new Date().toISOString(),
  };
}

async function pullCalendar(
  supabase: ReturnType<typeof serviceClient>,
  accessToken: string,
  calendar: { id: string; user_id: string; external_id: string; sync_token: string | null },
): Promise<{ upserted: number; deleted: number }> {
  let pageToken: string | undefined;
  let syncToken = calendar.sync_token;
  let upserted = 0;
  let deleted = 0;
  let useIncremental = Boolean(syncToken);

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250', showDeleted: 'true' });
    if (useIncremental && syncToken) params.set('syncToken', syncToken);
    else {
      params.set('timeMin', new Date(Date.now() - WINDOW_DAYS_BACK * 86_400_000).toISOString());
      params.set('timeMax', new Date(Date.now() + WINDOW_DAYS_FORWARD * 86_400_000).toISOString());
    }
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${GOOGLE_API}/calendars/${encodeURIComponent(calendar.external_id)}/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 410 && useIncremental) {
      // Google expired the sync token: start over with a full window.
      useIncremental = false;
      syncToken = null;
      pageToken = undefined;
      continue;
    }
    if (!response.ok) throw new Error(`Google events.list failed: HTTP ${response.status}`);

    const payload = (await response.json()) as {
      items?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    const cancelled = (payload.items ?? []).filter((e) => e.status === 'cancelled').map((e) => e.id as string);
    const live = (payload.items ?? []).filter((e) => e.status !== 'cancelled');

    if (live.length) {
      const { error } = await supabase
        .from('calendar_events')
        .upsert(live.map((e) => mapGoogleEvent(e, calendar.user_id, calendar.id)), { onConflict: 'calendar_id,external_id' });
      if (error) throw error;
      upserted += live.length;
    }
    if (cancelled.length) {
      await supabase.from('calendar_events').delete().eq('calendar_id', calendar.id).in('external_id', cancelled);
      deleted += cancelled.length;
    }

    pageToken = payload.nextPageToken;
    if (payload.nextSyncToken) {
      await supabase.from('calendars').update({ sync_token: payload.nextSyncToken }).eq('id', calendar.id);
    }
    if (!pageToken) break;
  }

  return { upserted, deleted };
}

/** Write approved time blocks back to Google as real events. */
async function pushApprovedBlocks(
  supabase: ReturnType<typeof serviceClient>,
  accessToken: string,
  userId: string,
): Promise<number> {
  const { data: target } = await supabase
    .from('calendars')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('is_primary_target', true)
    .maybeSingle();
  if (!target) return 0;

  const { data: blocks } = await supabase
    .from('time_blocks')
    .select('id, title, start_at, end_at, rationale, engine, kind')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .is('event_id', null)
    .limit(50);

  let pushed = 0;
  for (const block of blocks ?? []) {
    const response = await fetch(`${GOOGLE_API}/calendars/${encodeURIComponent(target.external_id)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: block.title,
        description: block.rationale
          ? `${block.rationale}\n\nScheduled by Cortex (${block.engine === 'afm' ? 'on-device Apple Foundation Models' : 'built-in planner'}).`
          : 'Scheduled by Cortex.',
        start: { dateTime: block.start_at },
        end: { dateTime: block.end_at },
        transparency: block.kind === 'buffer' ? 'transparent' : 'opaque',
        extendedProperties: { private: { cortex_block_id: block.id } },
      }),
    });
    if (!response.ok) continue;

    const created = (await response.json()) as Record<string, unknown>;
    const { data: event } = await supabase
      .from('calendar_events')
      .upsert({ ...mapGoogleEvent(created, userId, target.id), created_by_cortex: true }, { onConflict: 'calendar_id,external_id' })
      .select('id')
      .single();
    if (event) await supabase.from('time_blocks').update({ event_id: event.id }).eq('id', block.id);
    pushed += 1;
  }
  return pushed;
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  try {
    const supabase = serviceClient();

    // Either a signed-in user syncing their own calendars, or the scheduler
    // sweeping everyone.
    let userIds: string[];
    const authorization = req.headers.get('Authorization') ?? '';
    const isService = authorization.replace(/^Bearer\s+/i, '') === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (isService) {
      assertServiceRole(req);
      const { data } = await supabase.from('calendar_accounts').select('user_id').eq('sync_enabled', true);
      userIds = [...new Set((data ?? []).map((row: { user_id: string }) => row.user_id))];
    } else {
      userIds = [await currentUserId(userClient(req))];
    }

    const results: Array<Record<string, unknown>> = [];

    for (const userId of userIds) {
      const { data: accounts } = await supabase
        .from('calendar_accounts')
        .select('id, user_id, encrypted_tokens, token_expires_at')
        .eq('user_id', userId)
        .eq('sync_enabled', true);

      for (const account of accounts ?? []) {
        try {
          const accessToken = await accessTokenFor(supabase, account);
          const { data: calendars } = await supabase
            .from('calendars')
            .select('id, user_id, external_id, sync_token')
            .eq('account_id', account.id)
            .eq('selected', true);

          let upserted = 0;
          let deleted = 0;
          for (const calendar of calendars ?? []) {
            const result = await pullCalendar(supabase, accessToken, calendar);
            upserted += result.upserted;
            deleted += result.deleted;
          }
          const pushed = await pushApprovedBlocks(supabase, accessToken, userId);

          await supabase
            .from('calendar_accounts')
            .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
            .eq('id', account.id);

          results.push({ accountId: account.id, upserted, deleted, pushed });
        } catch (accountError) {
          const message = accountError instanceof Error ? accountError.message : String(accountError);
          await supabase.from('calendar_accounts').update({ last_sync_error: message.slice(0, 2000) }).eq('id', account.id);
          results.push({ accountId: account.id, error: message });
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
