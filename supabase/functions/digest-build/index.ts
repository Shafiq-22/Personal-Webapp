/**
 * digest-build - assemble the daily and weekly digests.
 *
 * Runs hourly; for each user it only builds the digest whose delivery hour has
 * just arrived in that user's own time zone, so "07:00 daily" means 07:00 where
 * they are. The digest body is structured data, not prose: the headline written
 * here is a plain factual one, and the iOS companion replaces it with an
 * AFM-written line on device when the user opens it.
 */
import { assertCronCaller, errorResponse, json, preflight, serviceClient } from './shared.ts';
import { buildDigest } from './core.js';

interface Profile {
  id: string;
  time_zone: string;
}

/** Current hour and ISO weekday in an IANA zone, without pulling in a date lib. */
function localParts(zone: string, now: Date): { hour: number; weekday: number; dateKey: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
    const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      hour: Number(parts.hour ?? '0'),
      weekday: weekdayMap[parts.weekday ?? 'Mon'] ?? 1,
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return { hour: now.getUTCHours(), weekday: now.getUTCDay() === 0 ? 7 : now.getUTCDay(), dateKey: now.toISOString().slice(0, 10) };
  }
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  try {
    await assertCronCaller(req);
    const supabase = serviceClient();
    const now = new Date();
    const forced = new URL(req.url).searchParams.get('period');

    const { data: profiles, error } = await supabase.from('profiles').select('id, time_zone');
    if (error) throw error;

    const built: Array<{ userId: string; period: string; items: number }> = [];

    for (const profile of (profiles ?? []) as Profile[]) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('notifications')
        .eq('user_id', profile.id)
        .maybeSingle();
      const notifications = (settings?.notifications ?? {}) as { dailyDigestHour?: number; weeklyDigestWeekday?: number };
      const dailyHour = notifications.dailyDigestHour ?? 7;
      const weeklyWeekday = notifications.weeklyDigestWeekday ?? 1;
      const local = localParts(profile.time_zone ?? 'UTC', now);

      const periods: Array<'daily' | 'weekly'> = [];
      if (forced === 'daily' || forced === 'weekly') periods.push(forced);
      else {
        if (local.hour === dailyHour) periods.push('daily');
        if (local.hour === dailyHour && local.weekday === weeklyWeekday) periods.push('weekly');
      }
      if (periods.length === 0) continue;

      for (const period of periods) {
        const windowEnd = now;
        const windowStart = new Date(now.getTime() - (period === 'daily' ? 1 : 7) * 24 * 3600 * 1000);

        const { data: items } = await supabase
          .from('info_items')
          .select('*')
          .eq('user_id', profile.id)
          .gte('fetched_at', windowStart.toISOString())
          .order('fetched_at', { ascending: false })
          .limit(400);

        if (!items?.length) continue;
        const itemIds = items.map((i: { id: string }) => i.id);

        const [{ data: scores }, { data: topics }, { data: summaries }] = await Promise.all([
          supabase.from('item_scores').select('*').in('item_id', itemIds),
          supabase.from('topics').select('*').eq('user_id', profile.id),
          supabase.from('item_summaries').select('*').in('item_id', itemIds).eq('style', 'tldr'),
        ]);

        const digest = buildDigest(
          items.map(mapItem),
          (scores ?? []).map((s: Record<string, unknown>) => ({
            itemId: s.item_id as string,
            topicId: (s.topic_id ?? null) as string | null,
            score: Number(s.score),
            signals: s.signals as never,
            matchedTerms: (s.matched_terms ?? []) as string[],
            explanation: (s.explanation ?? '') as string,
          })),
          (topics ?? []).map(mapTopic),
          {
            userId: profile.id,
            period,
            windowStart,
            windowEnd,
            summaries: (summaries ?? []).map((s: Record<string, unknown>) => ({
              id: s.id as string,
              userId: s.user_id as string,
              itemId: s.item_id as string,
              style: s.style as never,
              text: s.text as string,
              engine: s.engine as never,
              modelIdentifier: (s.model_identifier ?? null) as string | null,
              deviceId: (s.device_id ?? null) as string | null,
              createdAt: s.created_at as string,
            })),
          },
        );

        if (digest.entries.length === 0) continue;

        await supabase.from('digests').upsert(
          {
            user_id: profile.id,
            period,
            window_start: digest.windowStart,
            window_end: digest.windowEnd,
            entries: digest.entries,
            item_count: digest.itemCount,
            headline: digest.headline,
          },
          { onConflict: 'user_id,period,window_start' },
        );

        built.push({ userId: profile.id, period, items: digest.itemCount });
      }
    }

    return json({ built: built.length, digests: built });
  } catch (error) {
    return errorResponse(error);
  }
});

function mapItem(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sourceId: (row.source_id ?? null) as string | null,
    kind: row.kind as never,
    externalId: (row.external_id ?? null) as string | null,
    url: row.url as string,
    canonicalUrl: (row.canonical_url ?? null) as string | null,
    title: row.title as string,
    authors: (row.authors ?? []) as string[],
    summaryRaw: (row.summary_raw ?? null) as string | null,
    contentText: (row.content_text ?? null) as string | null,
    publishedAt: (row.published_at ?? null) as string | null,
    fetchedAt: row.fetched_at as string,
    doi: (row.doi ?? null) as string | null,
    arxivId: (row.arxiv_id ?? null) as string | null,
    venue: (row.venue ?? null) as string | null,
    patentNumber: (row.patent_number ?? null) as string | null,
    language: (row.language ?? 'en') as string,
    contentHash: row.content_hash as string,
    origin: row.origin as never,
    raw: (row.raw ?? {}) as Record<string, unknown>,
  };
}

function mapTopic(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    label: row.label as string,
    keywords: (row.keywords ?? []) as string[],
    excludeKeywords: (row.exclude_keywords ?? []) as string[],
    origin: row.origin as never,
    derivedFrom: (row.derived_from ?? []) as string[],
    weight: Number(row.weight ?? 1),
    active: Boolean(row.active),
    lastSeenAt: (row.last_seen_at ?? null) as string | null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at ?? row.created_at) as string,
  };
}
