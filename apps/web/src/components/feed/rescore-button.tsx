'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { rescoreFeed } from '@/app/actions/monitoring';
import { Button } from '@/components/ui/button';

export function RescoreButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await rescoreFeed();
          if (result.ok) {
            toast.success(`Re-scored ${result.data?.scored ?? 0} item/topic pairs.`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
      Re-score
    </Button>
  );
}
