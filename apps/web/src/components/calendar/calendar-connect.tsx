'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { syncCalendarNow } from '@/app/actions/scheduling';
import { Button } from '@/components/ui/button';

export function CalendarConnect({
  accounts,
}: {
  accounts: Array<{ id: string; account_email: string; last_synced_at: string | null; last_sync_error: string | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return (
      <Button variant="outline" asChild>
        <a href="/api/calendar/google/connect">
          <Link2 className="h-4 w-4" /> Connect Google Calendar
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      disabled={pending}
      title={accounts.map((a) => a.account_email).join(', ')}
      onClick={() =>
        startTransition(async () => {
          const result = await syncCalendarNow();
          if (result.ok) {
            toast.success(result.data?.message ?? 'Synced');
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Sync calendar
    </Button>
  );
}
