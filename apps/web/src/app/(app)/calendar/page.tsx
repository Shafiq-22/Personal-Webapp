import type { Metadata } from 'next';
import { AlertTriangle, CalendarX2 } from 'lucide-react';
import {
  detectConflicts,
  eventToBusy,
  findFreeSlots,
  totalFreeMinutes,
  type BusyInterval,
} from '@cortex/core';
import { getCalendarAccounts, getEvents, getOpenTasks, getTimeBlocks, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Timeline } from '@/components/calendar/timeline';
import { ConflictList } from '@/components/calendar/conflict-list';
import { TimeBlockList } from '@/components/calendar/time-block-list';
import { ProposeScheduleButton } from '@/components/calendar/propose-schedule-button';
import { CalendarConnect } from '@/components/calendar/calendar-connect';
import { formatDate, zoneOffsetMinutes, pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const { settings } = await requireSession();

  const days = Math.min(14, Math.max(1, Number(params.days ?? 7)));
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86_400_000);

  const [events, blocks, tasks, accounts] = await Promise.all([
    getEvents(from.toISOString(), to.toISOString()),
    getTimeBlocks(from.toISOString(), to.toISOString()),
    getOpenTasks(),
    getCalendarAccounts(),
  ]);

  const conflicts = detectConflicts(events);
  const busy: BusyInterval[] = [
    ...events.map(eventToBusy).filter((b): b is BusyInterval => b !== null),
    ...blocks
      .filter((block) => block.status === 'approved')
      .map((block) => ({ start: new Date(block.startAt), end: new Date(block.endAt), label: block.title })),
  ];

  const freeSlots = findFreeSlots(busy, {
    from: new Date(),
    to,
    workingHours: settings.scheduling.workingHours,
    offsetMinutes: zoneOffsetMinutes(settings.timeZone),
    bufferMinutes: settings.scheduling.bufferMinutes,
    minimumMinutes: settings.scheduling.minBlockMinutes,
    notBefore: new Date(),
  });

  const dueInWindow = tasks.filter(
    (task) => task.dueAt && Date.parse(task.dueAt) >= from.getTime() && Date.parse(task.dueAt) < to.getTime(),
  );
  const committedMinutes = dueInWindow.reduce((sum, task) => sum + (task.estimateMinutes ?? 30), 0);
  const availableMinutes = totalFreeMinutes(freeSlots);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(from, settings.timeZone)} to {formatDate(new Date(to.getTime() - 1), settings.timeZone)} ·{' '}
            {pluralize(events.length, 'event')}, {pluralize(dueInWindow.length, 'task')} due
          </p>
        </div>
        <div className="flex gap-2">
          <CalendarConnect accounts={accounts as Array<{ id: string; account_email: string; last_synced_at: string | null; last_sync_error: string | null }>} />
          <ProposeScheduleButton days={days} />
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Free time in working hours</CardDescription>
            <CardTitle className="text-2xl">{Math.round(availableMinutes / 60)}h</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Work due in this window</CardDescription>
            <CardTitle className="text-2xl">{Math.round(committedMinutes / 60)}h</CardTitle>
          </CardHeader>
        </Card>
        <Card className={committedMinutes > availableMinutes ? 'border-destructive' : undefined}>
          <CardHeader className="pb-2">
            <CardDescription>Realistic?</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {committedMinutes > availableMinutes ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> No
                </>
              ) : (
                'Yes'
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {committedMinutes > availableMinutes
              ? `You are ${Math.round((committedMinutes - availableMinutes) / 60)}h short. Move or drop something.`
              : 'Everything due fits in your free slots.'}
          </CardContent>
        </Card>
      </div>

      {conflicts.length ? <ConflictList conflicts={conflicts} timeZone={settings.timeZone} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Merged timeline</CardTitle>
            <CardDescription>Calendar events, tasks that are due and the blocks you approved, in one stream.</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 && blocks.length === 0 && dueInWindow.length === 0 ? (
              <EmptyState
                icon={CalendarX2}
                title="Nothing scheduled"
                description="Connect Google Calendar to pull events in, or let Cortex propose blocks from your open tasks."
              />
            ) : (
              <Timeline
                events={events}
                blocks={blocks}
                tasks={dueInWindow}
                timeZone={settings.timeZone}
                from={from.toISOString()}
                days={days}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Blocks awaiting you</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeBlockList blocks={blocks} timeZone={settings.timeZone} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Free slots</CardTitle>
              <CardDescription>Inside your working hours, with a {settings.scheduling.bufferMinutes} minute buffer.</CardDescription>
            </CardHeader>
            <CardContent>
              {freeSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No free slots left in this window.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {freeSlots.slice(0, 8).map((slot) => (
                    <li key={slot.start.toISOString()} className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {new Intl.DateTimeFormat('en-GB', {
                          timeZone: settings.timeZone,
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        }).format(slot.start)}
                      </span>
                      <Badge variant="secondary">{slot.minutes} min</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
