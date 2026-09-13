'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clock, CornerDownRight, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Task } from '@cortex/core';
import { describeRRule, isOverdue } from '@cortex/core';
import { deleteTask, setTaskStatus } from '@/app/actions/tasks';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatDateTime } from '@/lib/utils';

const PRIORITY_STYLE: Record<Task['priority'], string> = {
  p1: 'border-l-destructive',
  p2: 'border-l-amber-500',
  p3: 'border-l-transparent',
  p4: 'border-l-transparent',
};

export function TaskRow({
  task,
  depth = 0,
  timeZone,
  projectName,
  tagNames = [],
  reason,
}: {
  task: Task;
  depth?: number;
  timeZone: string;
  projectName?: string | null;
  tagNames?: string[];
  reason?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistic completion: the checkbox responds instantly and only reverts if
  // the server rejects the change.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(task.status);

  const done = optimisticStatus === 'done';
  const overdue = isOverdue({ status: optimisticStatus, dueAt: task.dueAt });

  function toggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticStatus(checked ? 'done' : 'todo');
      const result = await setTaskStatus(task.id, checked ? 'done' : 'todo');
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data?.rolledTo) {
        toast.success(`Done - next occurrence ${formatDateTime(result.data.rolledTo, timeZone)}`);
      }
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if (result.ok) {
        toast.success('Task deleted');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <li
      className={cn(
        'group flex items-start gap-3 border-l-2 px-3 py-2.5 transition-colors hover:bg-accent/40',
        PRIORITY_STYLE[task.priority],
      )}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      {depth > 0 ? <CornerDownRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}

      <Checkbox
        checked={done}
        onCheckedChange={(checked) => toggle(checked === true)}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className="mt-0.5"
      />

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {task.priority !== 'p3' ? (
            <Badge variant={task.priority === 'p1' ? 'destructive' : 'secondary'}>{task.priority.toUpperCase()}</Badge>
          ) : null}
          {projectName ? <Badge variant="outline">{projectName}</Badge> : null}
          {tagNames.map((tag) => (
            <Badge key={tag} variant="outline">
              @{tag}
            </Badge>
          ))}
          {task.dueAt ? (
            <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-destructive')}>
              {overdue ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
              {formatDateTime(task.dueAt, timeZone, task.dueAllDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          ) : null}
          {task.estimateMinutes ? <span>{task.estimateMinutes} min</span> : null}
          {task.recurrenceRule ? (
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" aria-hidden />
              {describeRRule(task.recurrenceRule)}
            </span>
          ) : null}
        </div>

        {reason ? <p className="mt-1 text-xs italic text-muted-foreground">{reason}</p> : null}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={remove}
        aria-label={`Delete ${task.title}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}
