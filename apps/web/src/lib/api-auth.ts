import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabase/server';

/**
 * Authentication for the REST API.
 *
 * The API is what the iOS companion and the browser extension talk to. Both
 * send the user's Supabase access token as a bearer token; the session cookie
 * is accepted too so the same endpoints work from the web app and from curl
 * during development. Either way RLS is what actually enforces ownership.
 */
export interface ApiContext {
  supabase: SupabaseClient;
  userId: string;
}

export async function authenticate(request: Request): Promise<ApiContext | NextResponse> {
  const supabase = await createSupabaseServerClient();
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  const {
    data: { user },
    error,
  } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Send a Supabase access token as `Authorization: Bearer <token>`.' },
      { status: 401 },
    );
  }
  return { supabase, userId: user.id };
}

export function isResponse(value: ApiContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export function apiError(message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** Consistent JSON envelope so clients can rely on the shape. */
export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}
