'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buildDigestNow } from '@/app/actions/monitoring';
import { Button } from '@/components/ui/button';

export function BuildDigestButtons() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function build(period: 'daily' | 'weekly') {
    startTransition(async () => {
      const result = await buildDigestNow(period);
      if (result.ok) {
        toast.success(`Built a ${period} digest with ${result.data?.items ?? 0} items.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={pending} onClick={() => build('daily')}>
        Build daily
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => build('weekly')}>
        Build weekly
      </Button>
    </div>
  );
}
