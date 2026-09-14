import type { CalendarEvent, Task, TimeBlock } from '@cortex/core';
import { Badge } from '@/components/ui/badge';
import { cn, formatTime } from '@/lib/utils';

interface TimelineItem {
  id: string;
  kind: 'event' | 'task' | 'block';
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  detail?: string | null;
  muted?: boolean;
}

const KIND_STYLES: Record<TimelineItem['kind'], string> = {
  event: 'border-l-primary',
  task: 'border-l-amber-500',
  block: 'border-l-emerald-500',
};

/**
 * The merged view.
 *
 * Server-rendered on purpose: it is the page most likely to be opened on a
 * slow connection, and it needs no interactivity to be useful.
 */
export function Timeline({
  events,
  blocks,
  tasks,
  timeZone,
  from,
  days,
}: {
  events: CalendarEvent[];
  blocks: TimeBlock[];
  tasks: Task[];
  timeZone: string;
  from: string;
  days: number;
}) {
  const items: TimelineItem[] = [
    ...events.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event' as const,
      title: event.title,
      start: event.startAt,
      end: event.endAt,
      allDay: event.allDay,
      detail: event.location,
      muted: event.transparency === 'transparent',
    })),
    ...blocks
      .filter((block) => block.status === 'approved' || block.status === 'completed')
      .map((block) => ({
        id: `block-${block.id}`,
        kind: 'block' as const,
        title: block.title,
        start: block.startAt,
        end: block.endAt,
        allDay: false,
        detail: block.rationale,
      })),
    ...tasks
      .filter((task) => task.dueAt)
      .map((task) => ({
        id: `task-${task.id}`,
        kind: 'task' as const,
        title: task.title,
        start: task.dueAt as string,
        end: null,
        allDay: task.dueAllDay,
        detail: task.estimateMinutes ? `${task.estimateMinutes} min estimated` : null,
      })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const dayKeys = Array.from({ length: days }, (_, index) =>
    new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-5">
      {dayKeys.map((day) => {
        const dayItems = items.filter((item) => item.start.slice(0, 10) === day);
        return (
          <section key={day} aria-labelledby={`day-${day}`}>
            <h3 id={`day-${day}`} className="mb-2 text-sm font-medium">
              {new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'short' }).format(
                new Date(`${day}T12:00:00Z`),
              )}
            </h3>
            {dayItems.length === 0 ? (
              <p className="pl-3 text-sm text-muted-foreground">Clear.</p>
            ) : (
              <ul className="space-y-1.5">
                {dayItems.map((item) => (
                  <li
                    key={item.id}
                    className={cn('flex gap-3 border-l-2 py-1.5 pl-3 text-sm', KIND_STYLES[item.kind], item.muted && 'opacity-60')}
                  >
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {item.allDay
                        ? 'all day'
                        : `${formatTime(item.start, timeZone)}${item.end ? `-${formatTime(item.end, timeZone)}` : ''}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      {item.detail ? <span className="block truncate text-xs text-muted-foreground">{item.detail}</span> : null}
                    </span>
                    <Badge variant="outline" className="h-fit shrink-0">
                      {item.kind}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
