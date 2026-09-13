import type { Metadata } from 'next';
import { ExternalLink, Mail } from 'lucide-react';
import { groupByTopic } from '@cortex/core';
import { getDigests, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { BuildDigestButtons } from '@/components/feed/build-digest-buttons';
import { formatDate, percent } from '@/lib/utils';

export const metadata: Metadata = { title: 'Digests' };
export const dynamic = 'force-dynamic';

export default async function DigestsPage() {
  const { settings } = await requireSession();
  const digests = await getDigests(20);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Digests</h1>
          <p className="text-sm text-muted-foreground">
            Built at {String(settings.notifications.dailyDigestHour).padStart(2, '0')}:00 in your own time zone, and
            weekly on day {settings.notifications.weeklyDigestWeekday}.
          </p>
        </div>
        <BuildDigestButtons />
      </header>

      {digests.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No digests yet"
          description="A digest is built once your sources have produced items that clear the relevance bar. You can also build one now."
        />
      ) : (
        <div className="space-y-6">
          {digests.map((digest) => (
            <Card key={digest.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{digest.period}</Badge>
                  <CardTitle>{digest.headline ?? 'Digest'}</CardTitle>
                </div>
                <CardDescription>
                  {formatDate(digest.windowStart, settings.timeZone)} to {formatDate(digest.windowEnd, settings.timeZone)} ·{' '}
                  {digest.itemCount} item{digest.itemCount === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {groupByTopic(digest).map((group) => (
                  <section key={group.topic}>
                    <h3 className="mb-1.5 text-sm font-medium">{group.topic}</h3>
                    <ul className="space-y-2">
                      {group.entries.map((entry) => (
                        <li key={entry.itemId} className="border-l-2 pl-3">
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-sm hover:underline"
                          >
                            {entry.title} <ExternalLink className="inline h-3 w-3" aria-hidden />
                          </a>
                          <p className="text-xs text-muted-foreground">
                            {percent(entry.score)} relevant{entry.reason ? ` · ${entry.reason}` : ''}
                          </p>
                          {entry.summary ? <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
