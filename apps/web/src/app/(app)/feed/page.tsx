import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { getAfmStatus, getFeed, getSources, getTopics, requireSession } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ItemCard } from '@/components/feed/item-card';
import { FeedFilters } from '@/components/feed/feed-filters';
import { RescoreButton } from '@/components/feed/rescore-button';
import { AfmNotice } from '@/components/afm-notice';
import { pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; source?: string; min?: string; state?: string; q?: string }>;
}) {
  const params = await searchParams;
  const { settings } = await requireSession();

  const [topics, sources, afm] = await Promise.all([getTopics(), getSources(), getAfmStatus()]);
  const entries = await getFeed({
    ...(params.topic ? { topicId: params.topic } : {}),
    ...(params.source ? { sourceId: params.source } : {}),
    ...(params.q ? { search: params.q } : {}),
    ...(params.min ? { minScore: Number(params.min) } : {}),
    state: params.state === 'all' ? ['new', 'read', 'saved', 'snoozed'] : ['new', 'read'],
    limit: 60,
  });

  const hasSetup = sources.length > 0 && topics.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feed</h1>
          <p className="text-sm text-muted-foreground">
            {pluralize(entries.length, 'item')} from {pluralize(sources.filter((s) => s.enabled).length, 'source')},
            ranked against {pluralize(topics.filter((t) => t.active).length, 'topic')}.
          </p>
        </div>
        <RescoreButton />
      </header>

      <AfmNotice status={afm} context="feed" />

      {hasSetup ? (
        <FeedFilters
          topics={topics.map((topic) => ({ id: topic.id, label: topic.label }))}
          sources={sources.map((source) => ({ id: source.id, name: source.name }))}
          current={{ topic: params.topic ?? '', source: params.source ?? '', min: params.min ?? '', state: params.state ?? 'unread' }}
        />
      ) : null}

      {!hasSetup ? (
        <EmptyState
          icon={Inbox}
          title="Nothing to monitor yet"
          description="Add a few sources - arXiv, an RSS feed, a news site - and either write topics yourself or let Cortex derive them from your own tasks and calendar."
          action={
            <Button asChild>
              <Link href="/settings#monitoring">Set up monitoring</Link>
            </Button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing new"
          description="Your sources have been polled but nothing crossed the relevance bar. Lower the minimum score, or wait for the next fetch."
        />
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <ItemCard key={entry.item.id} entry={entry} timeZone={settings.timeZone} />
          ))}
        </div>
      )}
    </div>
  );
}
