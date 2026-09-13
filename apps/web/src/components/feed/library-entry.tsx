'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FeedEntry } from '@/lib/queries';
import { setItemState } from '@/app/actions/monitoring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatDate, hostname } from '@/lib/utils';

export function LibraryEntry({ entry, timeZone }: { entry: FeedEntry; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(entry.stateRow?.notes ?? '');
  const [tagInput, setTagInput] = useState((entry.stateRow?.tags ?? []).join(', '));
  const { item } = entry;

  function save() {
    startTransition(async () => {
      const tags = tagInput
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      const result = await setItemState(item.id, 'saved', { notes: notes || null, tags });
      if (result.ok) {
        toast.success('Saved');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <article className="space-y-3 p-4">
      <div>
        <a
          href={item.canonicalUrl ?? item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm font-medium hover:underline"
        >
          {item.title} <ExternalLink className="inline h-3 w-3" aria-hidden />
        </a>
        <p className="mt-1 text-xs text-muted-foreground">
          {hostname(item.canonicalUrl ?? item.url)}
          {item.authors.length ? ` · ${item.authors.slice(0, 4).join(', ')}` : ''}
          {item.publishedAt ? ` · ${formatDate(item.publishedAt, timeZone)}` : ''}
          {item.doi ? ` · DOI ${item.doi}` : ''}
          {item.arxivId ? ` · arXiv:${item.arxivId}` : ''}
        </p>
        {entry.topicLabels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.topicLabels.slice(0, 4).map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_240px]">
        <div className="space-y-1">
          <label htmlFor={`notes-${item.id}`} className="text-xs font-medium text-muted-foreground">
            Notes
          </label>
          <Textarea
            id={`notes-${item.id}`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Why this matters to you..."
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`tags-${item.id}`} className="text-xs font-medium text-muted-foreground">
            Tags (comma separated)
          </label>
          <Input id={`tags-${item.id}`} value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="methods, to-cite" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setItemState(item.id, 'read');
              if (result.ok) {
                toast.success('Removed from library');
                router.refresh();
              } else {
                toast.error(result.error);
              }
            })
          }
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </div>
    </article>
  );
}
