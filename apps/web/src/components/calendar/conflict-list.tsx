'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { EventConflict } from '@cortex/core';
import { moveTimeBlock } from '@/app/actions/scheduling';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';

/**
 * Conflicts with the resolutions Cortex can actually offer.
 *
 * The options are deterministic - decline, shorten, move, delegate, make
 * async - and the only one Cortex can apply itself is moving a block it
 * created. Anything involving other people is handed back as a suggestion
 * rather than done silently.
 */
export function ConflictList({ conflicts, timeZone }: { conflicts: EventConflict[]; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          {conflicts.length} calendar conflict{conflicts.length === 1 ? '' : 's'}
        </CardTitle>
        <CardDescription>Cortex can move its own blocks. Anything involving other people is your call.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conflicts.map((conflict) => (
          <div key={`${conflict.a.id}-${conflict.b.id}`} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{conflict.a.title}</span>
              <span className="text-muted-foreground">overlaps</span>
              <span className="font-medium">{conflict.b.title}</span>
              <Badge variant={conflict.severity === 'hard' ? 'destructive' : 'secondary'}>
                {conflict.overlapMinutes} min
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(conflict.a.startAt, timeZone)}</p>

            <ul className="mt-3 space-y-1.5">
              {conflict.suggestions.slice(0, 4).map((suggestion, index) => {
                const movable =
                  suggestion.proposedStart &&
                  suggestion.proposedEnd &&
                  [conflict.a, conflict.b].some((event) => event.id === suggestion.targetEventId && event.createdByCortex);
                return (
                  <li key={`${suggestion.kind}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{suggestion.label}</span>
                    {movable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await moveTimeBlock(
                              suggestion.targetEventId,
                              suggestion.proposedStart as string,
                              suggestion.proposedEnd as string,
                            );
                            if (result.ok) {
                              toast.success('Block moved');
                              router.refresh();
                            } else {
                              toast.error(result.error);
                            }
                          })
                        }
                      >
                        Apply
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
