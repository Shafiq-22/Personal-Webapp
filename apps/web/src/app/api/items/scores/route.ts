import { z } from 'zod';
import { apiError, apiOk, authenticate, isResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const ScoreSchema = z.object({
  itemId: z.string().uuid(),
  topicId: z.string().uuid().nullish(),
  score: z.number().min(0).max(1),
  signals: z.record(z.number()).default({}),
  matchedTerms: z.array(z.string().max(80)).default([]),
  explanation: z.string().max(1000).nullish(),
});

/**
 * POST /api/items/scores - relevance scores computed on device.
 *
 * Apple Foundation Models re-ranks the feed against the user's open work with
 * actual language understanding, which the server-side keyword ranker cannot
 * do. Rows written here carry `engine = 'afm'` and take precedence in the feed.
 * The explanation is stored too, so the "why am I seeing this?" panel shows the
 * model's own reasoning rather than a generic sentence.
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

  const parsed = z.union([ScoreSchema, z.array(ScoreSchema).max(200)]).safeParse(payload);
  if (!parsed.success) return apiError('Invalid score payload', 422, parsed.error.issues);

  const scores = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const { data, error } = await context.supabase
    .from('item_scores')
    .upsert(
      scores.map((score) => ({
        user_id: context.userId,
        item_id: score.itemId,
        topic_id: score.topicId ?? null,
        score: score.score,
        signals: score.signals,
        matched_terms: score.matchedTerms,
        engine: 'afm',
        explanation: score.explanation ?? null,
      })),
      { onConflict: 'item_id,topic_id' },
    )
    .select('id');
  if (error) return apiError(error.message, 500);

  return apiOk({ written: data?.length ?? 0 }, 201);
}
