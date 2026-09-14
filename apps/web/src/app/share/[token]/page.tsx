import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServiceClient, hasSupabaseConfig } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Shared', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface SharePayload {
  type: string;
  title: string | null;
  window_start?: string;
  window_end?: string;
  items: Array<{
    title: string;
    url?: string;
    status?: string;
    priority?: string;
    due_at?: string | null;
    notes?: string | null;
    authors?: string[];
    published_at?: string | null;
    score?: number;
  }>;
}

/**
 * Public, read-only share page.
 *
 * Resolution goes through the `resolve_share` security-definer function, which
 * is the only door an anonymous visitor has into the database. It validates the
 * token, honours expiry and revocation, and returns exactly the fields the
 * share was created for - notes only when the owner opted in.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!hasSupabaseConfig()) notFound();

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc('resolve_share', { share_token: token });
  if (error || !data) notFound();

  const payload = data as SharePayload;

  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          Cortex
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{payload.title ?? 'Shared collection'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A read-only snapshot shared with you. {payload.items.length} item{payload.items.length === 1 ? '' : 's'}.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="capitalize">{payload.type.replace('_', ' ')}</CardTitle>
          {payload.window_start ? (
            <CardDescription>
              {new Date(payload.window_start).toISOString().slice(0, 10)} to{' '}
              {payload.window_end ? new Date(payload.window_end).toISOString().slice(0, 10) : ''}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {payload.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">This collection is empty.</p>
          ) : (
            <ul className="space-y-3">
              {payload.items.map((item, index) => (
                <li key={`${item.title}-${index}`} className="border-l-2 pl-3">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-sm hover:underline">
                      {item.title}
                    </a>
                  ) : (
                    <p className="text-sm">{item.title}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {item.status ? <Badge variant="outline">{item.status}</Badge> : null}
                    {item.priority && item.priority !== 'p3' ? <Badge variant="secondary">{item.priority}</Badge> : null}
                    {item.due_at ? <span>due {new Date(item.due_at).toISOString().slice(0, 10)}</span> : null}
                    {item.authors?.length ? <span>{item.authors.slice(0, 3).join(', ')}</span> : null}
                    {item.published_at ? <span>{new Date(item.published_at).toISOString().slice(0, 10)}</span> : null}
                  </div>
                  {item.notes ? <p className="mt-1 text-sm text-muted-foreground">{item.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        Shared from Cortex. The owner can revoke this link at any time.
      </p>
    </main>
  );
}
