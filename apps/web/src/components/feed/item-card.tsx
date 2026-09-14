'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookmarkPlus, CalendarPlus, ChevronDown, Cpu, ExternalLink, Info, ListPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ItemSummary } from '@cortex/core';
import { SUMMARY_STYLE_LABELS } from '@cortex/core';
import type { FeedEntry } from '@/lib/queries';
import { createTaskFromItem, setItemState } from '@/app/actions/monitoring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatDate, hostname, percent } from '@/lib/utils';

const SIGNAL_LABELS: Record<string, string> = {
  keyword: 'Keyword match',
  semantic: 'Wording similarity',
  recency: 'Freshness',
  sourceWeight: 'Source trust',
  topicWeight: 'Topic weight',
  feedback: 'Your past choices',
};

export function ItemCard({ entry, timeZone }: { entry: FeedEntry; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showWhy, setShowWhy] = useState(false);
  const { item } = entry;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? 'That did not work.');
      }
    });
  }

  const afmSummaries = entry.summaries.filter((s) => s.engine === 'afm');
  const fallbackSummaries = entry.summaries.filter((s) => s.engine !== 'afm');

  return (
    <Card className={cn('transition-opacity', entry.state === 'dismissed' && 'opacity-50')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <a
              href={item.canonicalUrl ?? item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium leading-snug hover:underline"
            >
              {item.title}
              <ExternalLink className="ml-1 inline h-3 w-3 align-baseline" aria-hidden />
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              {hostname(item.canonicalUrl ?? item.url)}
              {item.authors.length ? ` · ${item.authors.slice(0, 3).join(', ')}${item.authors.length > 3 ? ' et al.' : ''}` : ''}
              {item.publishedAt ? ` · ${formatDate(item.publishedAt, timeZone)}` : ''}
            </p>
          </div>
          {entry.score !== null ? (
            <Badge variant={entry.score >= 0.7 ? 'default' : 'secondary'} className="shrink-0">
              {percent(entry.score)}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{item.kind}</Badge>
          {entry.topicLabels.slice(0, 3).map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
          {entry.engine === 'afm' ? (
            <Badge variant="outline" className="gap-1">
              <Cpu className="h-3 w-3" aria-hidden /> ranked on device
            </Badge>
          ) : null}
        </div>

        {afmSummaries.length ? (
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            {afmSummaries.slice(0, 2).map((summary: ItemSummary) => (
              <div key={summary.id}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {SUMMARY_STYLE_LABELS[summary.style]}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{summary.text}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Written on your iPhone with Apple Foundation Models.</p>
          </div>
        ) : fallbackSummaries.length ? (
          <div className="space-y-1 rounded-md border border-dashed p-3">
            <p className="text-sm">{fallbackSummaries[0]?.text}</p>
            <p className="text-xs text-muted-foreground">
              Sentences extracted from the original text - not a written summary. Open this item on your iPhone for one.
            </p>
          </div>
        ) : item.summaryRaw ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{item.summaryRaw}</p>
        ) : null}

        {entry.explanation ? (
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setShowWhy((value) => !value)}
              aria-expanded={showWhy}
            >
              <Info className="h-3 w-3" aria-hidden /> Why am I seeing this?
              <ChevronDown className={cn('h-3 w-3 transition-transform', showWhy && 'rotate-180')} aria-hidden />
            </button>
            {showWhy ? (
              <div className="mt-2 space-y-2 rounded-md border p-3 text-xs">
                <p>{entry.explanation}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {Object.entries(entry.signals)
                    .filter(([key]) => key in SIGNAL_LABELS)
                    .map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{SIGNAL_LABELS[key]}</dt>
                        <dd className="tabular-nums">{percent(Number(value))}</dd>
                      </div>
                    ))}
                </dl>
                {entry.matchedTerms.length ? (
                  <p className="text-muted-foreground">Matched on: {entry.matchedTerms.join(', ')}</p>
                ) : null}
                <p className="text-muted-foreground">
                  Scored by {entry.engine === 'afm' ? 'Apple Foundation Models on your device' : 'the built-in ranker'}.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act(() => createTaskFromItem(item.id), 'Task created from this update')}
          >
            <ListPlus className="h-3.5 w-3.5" /> Create task
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act(() => createTaskFromItem(item.id, `Review: ${item.title}`), 'Review task added - propose a schedule to block time')}
          >
            <CalendarPlus className="h-3.5 w-3.5" /> Schedule review
          </Button>
          <Button
            size="sm"
            variant={entry.state === 'saved' ? 'secondary' : 'outline'}
            disabled={pending}
            onClick={() => act(() => setItemState(item.id, entry.state === 'saved' ? 'read' : 'saved'), entry.state === 'saved' ? 'Removed from library' : 'Saved to library')}
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> {entry.state === 'saved' ? 'Saved' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setItemState(item.id, 'dismissed'), 'Dismissed')}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
