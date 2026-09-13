import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, ListTodo, Sparkles, Zap } from 'lucide-react';
import { computeStreak, isOverdue, planDay, prioritizeTasks } from '@cortex/core';
import { getAfmStatus, getEvents, getHabits, getOpenTasks, getProjects, getTags, getTimeBlocks, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskRow } from '@/components/tasks/task-row';
import { TimeBlockList } from '@/components/calendar/time-block-list';
import { ProposeScheduleButton } from '@/components/calendar/propose-schedule-button';
import { HabitChecklist } from '@/components/habits/habit-checklist';
import { AfmNotice } from '@/components/afm-notice';
import { formatTime, pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { settings, profile } = await requireSession();
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [tasks, events, blocks, projects, tags, { habits, entries }, afm] = await Promise.all([
    getOpenTasks(),
    getEvents(dayStart.toISOString(), dayEnd.toISOString()),
    getTimeBlocks(dayStart.toISOString(), dayEnd.toISOString()),
    getProjects(),
    getTags(),
    getHabits(),
    getAfmStatus(),
  ]);

  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const tagNames = new Map(tags.map((t) => [t.id, t.name]));

  // The day plan and the reasons behind it come from the deterministic
  // prioritiser; the iPhone can re-rank the same list on device.
  const plan = planDay(tasks, { now, capacityMinutes: 4 * 60 });
  const reasons = new Map(prioritizeTasks(tasks, { now }).map((score) => [score.taskId, score.reasons.join(', ')]));
  const overdue = tasks.filter((task) => isOverdue(task, now));

  const greeting = `${now.getUTCHours() < 12 ? 'Good morning' : now.getUTCHours() < 18 ? 'Good afternoon' : 'Good evening'}${profile.display_name ? `, ${profile.display_name}` : ''}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted-foreground">
            {pluralize(plan.focus.length + plan.quickWins.length, 'task')} planned,{' '}
            {pluralize(events.length, 'event')} on the calendar
            {overdue.length ? `, ${pluralize(overdue.length, 'task')} past due` : ''}.
          </p>
        </div>
        <ProposeScheduleButton />
      </header>

      <AfmNotice status={afm} context="plan" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {overdue.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Past due</CardTitle>
                <CardDescription>Clear or reschedule these before taking on anything new.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ul>
                  {overdue.slice(0, 5).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      timeZone={settings.timeZone}
                      projectName={task.projectId ? projectNames.get(task.projectId) : null}
                      tagNames={task.tagIds.map((id) => tagNames.get(id)).filter((n): n is string => Boolean(n))}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Focus</CardTitle>
                <CardDescription>
                  {plan.plannedMinutes} of {plan.capacityMinutes} minutes committed
                  {plan.overCommitted ? ' - that is more than a normal day absorbs' : ''}.
                </CardDescription>
              </div>
              <Badge variant={plan.overCommitted ? 'destructive' : 'secondary'}>
                {Math.round((plan.plannedMinutes / plan.capacityMinutes) * 100)}%
              </Badge>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {plan.focus.length === 0 ? (
                <EmptyState
                  className="m-6 mt-0"
                  icon={CheckCircle2}
                  title="Nothing scheduled for deep work"
                  description="Capture something with the bar at the top, or open Tasks to pick work for today."
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href="/tasks">Open tasks</Link>
                    </Button>
                  }
                />
              ) : (
                <ul>
                  {plan.focus.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      timeZone={settings.timeZone}
                      projectName={task.projectId ? projectNames.get(task.projectId) : null}
                      tagNames={task.tagIds.map((id) => tagNames.get(id)).filter((n): n is string => Boolean(n))}
                      reason={reasons.get(task.id)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {plan.quickWins.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" aria-hidden /> Quick wins
                </CardTitle>
                <CardDescription>Fifteen minutes or less each.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ul>
                  {plan.quickWins.map((task) => (
                    <TaskRow key={task.id} task={task} timeZone={settings.timeZone} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" aria-hidden /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on the calendar today.</p>
              ) : (
                <ul className="space-y-2">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                        {event.allDay ? 'all day' : formatTime(event.startAt, settings.timeZone)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" aria-hidden /> Proposed blocks
              </CardTitle>
              <CardDescription>Nothing reaches your calendar until you approve it.</CardDescription>
            </CardHeader>
            <CardContent>
              <TimeBlockList blocks={blocks} timeZone={settings.timeZone} />
            </CardContent>
          </Card>

          {habits.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Habits</CardTitle>
              </CardHeader>
              <CardContent>
                <HabitChecklist
                  habits={habits.map((habit) => ({
                    id: habit.id,
                    name: habit.name,
                    streak: computeStreak(habit, entries.filter((entry) => entry.habitId === habit.id), now).current,
                    loggedToday: entries.some(
                      (entry) => entry.habitId === habit.id && entry.day === now.toISOString().slice(0, 10),
                    ),
                  }))}
                  today={now.toISOString().slice(0, 10)}
                />
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={ListTodo} title="No habits yet" description="Track a habit to protect time for it automatically." />
          )}
        </div>
      </div>
    </div>
  );
}
