'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Flame } from 'lucide-react';
import { toast } from 'sonner';
import { logHabit } from '@/app/actions/tasks';
import { Checkbox } from '@/components/ui/checkbox';

export function HabitChecklist({
  habits,
  today,
}: {
  habits: Array<{ id: string; name: string; streak: number; loggedToday: boolean }>;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <ul className="space-y-2">
      {habits.map((habit) => (
        <li key={habit.id} className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={habit.loggedToday}
            disabled={pending || habit.loggedToday}
            aria-label={`Log ${habit.name} for today`}
            onCheckedChange={() =>
              startTransition(async () => {
                const result = await logHabit(habit.id, today);
                if (result.ok) {
                  toast.success(`${habit.name} logged`);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          />
          <span className="min-w-0 flex-1 truncate">{habit.name}</span>
          {habit.streak > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <Flame className="h-3 w-3" aria-hidden />
              {habit.streak}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
