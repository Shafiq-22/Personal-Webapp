'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Cpu, Info, X } from 'lucide-react';
import { toast } from 'sonner';
import type { TimeBlock } from '@cortex/core';
import { decideTimeBlock } from '@/app/actions/scheduling';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/utils';

export function TimeBlockList({ blocks, timeZone }: { blocks: TimeBlock[]; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const proposed = blocks.filter((block) => block.status === 'proposed');
  const approved = blocks.filter((block) => block.status === 'approved');

  function decide(id: string, decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const result = await decideTimeBlock(id, decision);
      if (result.ok) {
        toast.success(decision === 'approved' ? 'Block approved' : 'Block dismissed');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">No blocks yet. Use &ldquo;Propose schedule&rdquo; to fill your free slots.</p>;
  }

  return (
    <div className="space-y-3">
      {proposed.map((block) => (
        <div key={block.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{block.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatTime(block.startAt, timeZone)} - {formatTime(block.endAt, timeZone)}
              </p>
            </div>
            <Badge variant={block.engine === 'afm' ? 'default' : 'secondary'} className="shrink-0">
              {block.engine === 'afm' ? (
                <>
                  <Cpu className="mr-1 h-3 w-3" aria-hidden /> on device
                </>
              ) : (
                'planner'
              )}
            </Badge>
          </div>

          {block.rationale ? (
            <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>{block.rationale}</span>
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => decide(block.id, 'approved')}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(block.id, 'rejected')}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        </div>
      ))}

      {approved.length ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approved</p>
          {approved.map((block) => (
            <p key={block.id} className="flex justify-between text-sm">
              <span className="truncate">{block.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(block.startAt, timeZone)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
