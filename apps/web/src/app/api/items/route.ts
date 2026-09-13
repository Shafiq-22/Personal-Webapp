import { z } from 'zod';
import { canonicalizeUrl, contentHash } from '@cortex/core';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';
import { toInfoItem } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/items - the monitored feed, with scores and reading state.
 *
 * This is what the iOS app pulls to rank on device: it takes the items and
 * the user's open work, re-scores them with Apple Foundation Models and posts
 * the results back to /api/items/scores.
 */
export async function GET(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  const url = new URL(request.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
  const since = url.searchParams.get('since');
  const state = url.searchParams.get('state');

  let query = context.supabase
    .from('info_items')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(limit);
  if (since) query = query.gt('fetched_at', since);

  const { data: itemRows, error } = await query;
  if (error) return apiError(error.message, 500);

  const items = (itemRows ?? []).map(toInfoItem);
  if (items.length === 0) return apiOk([]);

  const ids = items.map((item) => item.id);
  const [{ data: scores }, { data: states }] = await Promise.all([
    context.supabase.from('item_scores').select('*').in('item_id', ids),
    context.supabase.from('item_states').select('*').in('item_id', ids),
  ]);

  const stateByItem = new Map((states ?? []).map((row) => [row.item_id as string, row]));
  const scoresByItem = new Map<string, unknown[]>();
  for (const score of scores ?? []) {
    const bucket = scoresByItem.get(score.item_id as string) ?? [];
    bucket.push(score);
    scoresByItem.set(score.item_id as string, bucket);
  }

  const payload = items
    .map((item) => ({
      item,
      scores: scoresByItem.get(item.id) ?? [],
      state: (stateByItem.get(item.id)?.state as string) ?? 'new',
    }))
    .filter((entry) => (state ? entry.state === state : true));

  return apiOk(payload);
}

const ClipSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(1000),
  summary: z.string().max(20_000).nullish(),
  content: z.string().max(200_000).nullish(),
  authors: z.array(z.string().max(200)).default([]),
  publishedAt: z.string().nullish(),
  kind: z
    .enum(['paper', 'preprint', 'article', 'post', 'release', 'patent', 'regulation', 'announcement', 'thread', 'other'])
    .default('article'),
  doi: z.string().max(200).nullish(),
  arxivId: z.string().max(64).nullish(),
  venue: z.string().max(300).nullish(),
  /** `clipper` for the browser extension, `ios` for the Share Sheet. */
  origin: z.enum(['clipper', 'ios', 'manual']).default('clipper'),
});

/**
 * POST /api/items - add something by hand (web clipper, iOS Share Sheet).
 *
 * Deduped against the monitored feed by the same canonical-URL hash, so
 * clipping an article that a feed later publishes does not create a second row.
 */
export async function POST(request: Request) {
  const context = await authenticate(request);
  if (isResponse(context)) return context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError('The request body must be JSON.');
  }

  const parsed = ClipSchema.safeParse(payload);
  if (!parsed.success) return apiError('Invalid item payload', 422, parsed.error.issues);

  const input = parsed.data;
  const canonical = canonicalizeUrl(input.url);
  const hash = contentHash(canonical, input.title.toLowerCase().replace(/\s+/g, ' ').trim());

  const { data: existing } = await context.supabase
    .from('info_items')
    .select('*')
    .eq('content_hash', hash)
    .maybeSingle();

  if (existing) {
    await context.supabase
      .from('item_states')
      .upsert({ user_id: context.userId, item_id: existing.id, state: 'saved', saved_at: new Date().toISOString() }, { onConflict: 'user_id,item_id' });
    return apiOk({ item: toInfoItem(existing), deduped: true });
  }

  const { data, error } = await context.supabase
    .from('info_items')
    .insert({
      user_id: context.userId,
      source_id: null,
      kind: input.kind,
      url: input.url,
      canonical_url: canonical,
      title: input.title,
      authors: input.authors,
      summary_raw: input.summary ?? null,
      content_text: input.content ?? null,
      published_at: input.publishedAt ?? null,
      doi: input.doi ?? null,
      arxiv_id: input.arxivId ?? null,
      venue: input.venue ?? null,
      content_hash: hash,
      origin: input.origin,
    })
    .select('*')
    .single();
  if (error) return apiError(error.message, 500);

  await context.supabase
    .from('item_states')
    .upsert({ user_id: context.userId, item_id: data.id, state: 'saved', saved_at: new Date().toISOString() }, { onConflict: 'user_id,item_id' });

  return apiOk({ item: toInfoItem(data), deduped: false }, 201);
}
