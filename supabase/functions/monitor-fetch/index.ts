/**
 * monitor-fetch - poll every due source, normalise what comes back, store the
 * new items and score them against the user's topics.
 *
 * Scheduled hourly with pg_cron (see supabase/README.md). Runs with the
 * service role because it works across all users, so it re-scopes every write
 * to the source's owner by hand.
 *
 * The ranking done here is the deterministic hybrid scorer from @cortex/core.
 * When the user's iPhone is around it re-ranks the top slice on device with
 * Apple Foundation Models and overwrites these rows with `engine = 'afm'`.
 * No cloud model is ever called from this function.
 */
import {
  assertServiceRole,
  errorResponse,
  json,
  mapWithConcurrency,
  preflight,
  serviceClient,
} from './shared.ts';
import {
  dedupe,
  normalizeEntry,
  parseFeed,
  scoreItemAgainstTopics,
  selectRealtimeAlerts,
  type NormalizedItem,
} from './core.js';

const USER_AGENT = 'CortexMonitor/0.1 (+https://github.com/Shafiq-22/Personal-Webapp)';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ITEMS_PER_SOURCE = 60;

interface SourceRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  url: string;
  config: Record<string, unknown>;
  weight: number;
  etag: string | null;
}

async function fetchFeed(source: SourceRow): Promise<{ body: string | null; etag: string | null; notModified: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' };
    if (source.etag) headers['If-None-Match'] = source.etag;

    const response = await fetch(source.url, { headers, signal: controller.signal, redirect: 'follow' });
    if (response.status === 304) return { body: null, etag: source.etag, notModified: true };
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return { body: await response.text(), etag: response.headers.get('etag'), notModified: false };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  try {
    assertServiceRole(req);
    const supabase = serviceClient();

    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
    const { data: sources, error } = await supabase.rpc('sources_due', { p_limit: limit });
    if (error) throw error;

    const rows = (sources ?? []) as SourceRow[];
    if (rows.length === 0) return json({ polled: 0, inserted: 0, alerts: 0 });

    let inserted = 0;
    let alerted = 0;
    const failures: Array<{ source: string; error: string }> = [];

    await mapWithConcurrency(rows, 6, async (source) => {
      try {
        const { body, etag, notModified } = await fetchFeed(source);
        if (notModified || !body) {
          await supabase
            .from('sources')
            .update({ last_fetched_at: new Date().toISOString(), last_status: 'ok', last_error: null })
            .eq('id', source.id);
          return;
        }

        const parsed = parseFeed(body);
        if (!parsed.ok) throw new Error(parsed.error);

        // Respect the user's "don't store article bodies" setting.
        const { data: settings } = await supabase
          .from('user_settings')
          .select('privacy')
          .eq('user_id', source.user_id)
          .maybeSingle();
        const storeContent = (settings?.privacy as { storeItemContent?: boolean } | null)?.storeItemContent !== false;

        const normalized: NormalizedItem[] = dedupe(
          parsed.value.entries.slice(0, MAX_ITEMS_PER_SOURCE).map((entry) =>
            normalizeEntry(entry, {
              sourceId: source.id,
              sourceKind: source.kind as never,
              sourceName: source.name,
              storeContent,
            }),
          ),
        );

        const { data: written, error: writeError } = await supabase.rpc('upsert_info_items', {
          p_user_id: source.user_id,
          p_items: normalized,
        });
        if (writeError) throw writeError;

        const fresh = ((written ?? []) as Array<{ item_id: string; item_hash: string; was_inserted: boolean }>).filter(
          (row) => row.was_inserted,
        );
        inserted += fresh.length;

        if (fresh.length > 0) {
          alerted += await scoreNewItems(supabase, source, fresh.map((f) => f.item_id));
        }

        await supabase
          .from('sources')
          .update({ last_fetched_at: new Date().toISOString(), last_status: 'ok', last_error: null, etag })
          .eq('id', source.id);
      } catch (sourceError) {
        const message = sourceError instanceof Error ? sourceError.message : String(sourceError);
        failures.push({ source: source.name, error: message });
        await supabase
          .from('sources')
          .update({ last_fetched_at: new Date().toISOString(), last_status: 'error', last_error: message.slice(0, 2000) })
          .eq('id', source.id);
      }
    });

    return json({ polled: rows.length, inserted, alerts: alerted, failures });
  } catch (error) {
    return errorResponse(error);
  }
});

/** Score the freshly inserted items and queue realtime alerts for the best. */
async function scoreNewItems(
  supabase: ReturnType<typeof serviceClient>,
  source: SourceRow,
  itemIds: string[],
): Promise<number> {
  const [{ data: topics }, { data: items }, { data: settings }] = await Promise.all([
    supabase.from('topics').select('*').eq('user_id', source.user_id).eq('active', true),
    supabase.from('info_items').select('*').in('id', itemIds),
    supabase.from('user_settings').select('notifications').eq('user_id', source.user_id).maybeSingle(),
  ]);

  if (!topics?.length || !items?.length) return 0;

  const domainTopics = topics.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    userId: t.user_id as string,
    label: t.label as string,
    keywords: (t.keywords ?? []) as string[],
    excludeKeywords: (t.exclude_keywords ?? []) as string[],
    origin: t.origin as never,
    derivedFrom: (t.derived_from ?? []) as string[],
    weight: Number(t.weight ?? 1),
    active: Boolean(t.active),
    lastSeenAt: (t.last_seen_at ?? null) as string | null,
    createdAt: t.created_at as string,
    updatedAt: (t.updated_at ?? t.created_at) as string,
  }));

  const sourceRow = {
    id: source.id,
    userId: source.user_id,
    kind: source.kind as never,
    name: source.name,
    url: source.url,
    config: source.config,
    enabled: true,
    weight: source.weight,
    fetchIntervalMinutes: 180,
    lastFetchedAt: null,
    lastStatus: 'ok' as const,
    lastError: null,
    etag: source.etag,
    createdAt: new Date().toISOString(),
  };

  const scoreRows: Array<Record<string, unknown>> = [];
  const allScores = [];

  for (const row of items) {
    const item = {
      id: row.id as string,
      title: row.title as string,
      summaryRaw: (row.summary_raw ?? null) as string | null,
      contentText: (row.content_text ?? null) as string | null,
      authors: (row.authors ?? []) as string[],
      venue: (row.venue ?? null) as string | null,
      publishedAt: (row.published_at ?? null) as string | null,
      fetchedAt: row.fetched_at as string,
      sourceId: (row.source_id ?? null) as string | null,
    };
    const scores = scoreItemAgainstTopics(item, domainTopics, [sourceRow]);
    allScores.push(...scores);
    for (const score of scores) {
      scoreRows.push({
        user_id: source.user_id,
        item_id: score.itemId,
        topic_id: score.topicId,
        score: score.score,
        signals: score.signals,
        matched_terms: score.matchedTerms,
        engine: 'heuristic',
        explanation: score.explanation,
      });
    }
  }

  if (scoreRows.length) {
    await supabase.from('item_scores').upsert(scoreRows, { onConflict: 'item_id,topic_id' });
    await supabase.from('item_states').upsert(
      [...new Set(scoreRows.map((r) => r.item_id as string))].map((itemId) => ({
        user_id: source.user_id,
        item_id: itemId,
        state: 'new',
      })),
      { onConflict: 'user_id,item_id', ignoreDuplicates: true },
    );
  }

  const threshold = Number((settings?.notifications as { realtimeAlertThreshold?: number } | null)?.realtimeAlertThreshold ?? 0.8);
  const alerts = selectRealtimeAlerts(allScores, threshold);

  if (alerts.length) {
    // The push itself is delivered by the notify function; this records the
    // decision so the user can see why they were interrupted.
    await supabase.from('ai_explanations').insert(
      alerts.map((alert) => ({
        user_id: source.user_id,
        subject_type: 'info_item',
        subject_id: alert.itemId,
        decision: 'realtime_alert',
        rationale: alert.explanation,
        engine: 'heuristic',
        inputs: alert.signals,
      })),
    );
  }
  return alerts.length;
}
