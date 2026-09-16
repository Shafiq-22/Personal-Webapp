import type { Metadata } from 'next';
import { Library } from 'lucide-react';
import { getFeed, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LibraryEntry } from '@/components/feed/library-entry';
import { ExportMenu } from '@/components/feed/export-menu';
import { pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Library' };
export const dynamic = 'force-dynamic';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tag?: string; q?: string }> }) {
  const params = await searchParams;
  const { settings } = await requireSession();

  const entries = await getFeed({
    state: ['saved'],
    ...(params.tag ? { tag: params.tag } : {}),
    ...(params.q ? { search: params.q } : {}),
    limit: 200,
  });

  const allTags = [...new Set(entries.flatMap((entry) => entry.stateRow?.tags ?? []))].sort();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">
            {pluralize(entries.length, 'saved item')} with your notes, tags and full source links.
          </p>
        </div>
        <ExportMenu scope="library" />
      </header>

      {allTags.length ? (
        <div className="flex flex-wrap gap-1.5">
          <a href="/library">
            <Badge variant={params.tag ? 'outline' : 'default'}>All</Badge>
          </a>
          {allTags.map((tag) => (
            <a key={tag} href={`/library?tag=${encodeURIComponent(tag)}`}>
              <Badge variant={params.tag === tag ? 'default' : 'outline'}>{tag}</Badge>
            </a>
          ))}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Nothing saved yet"
          description="Save anything from the feed and it lands here with its bibliographic metadata, ready to export as BibTeX or RIS."
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Saved</CardTitle>
            <CardDescription>Notes and tags are yours; they never leave your account.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {entries.map((entry) => (
              <LibraryEntry key={entry.item.id} entry={entry} timeZone={settings.timeZone} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
