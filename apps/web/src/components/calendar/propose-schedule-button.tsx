'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { proposeSchedule } from '@/app/actions/scheduling';
import { Button } from '@/components/ui/button';

export function ProposeScheduleButton({ days = 3 }: { days?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await proposeSchedule(days);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.data?.proposed
              ? `Proposed ${result.data.proposed} block${result.data.proposed === 1 ? '' : 's'} - approve the ones you want.`
              : 'No free slots matched your working hours.',
          );
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
      Propose schedule
    </Button>
  );
}
