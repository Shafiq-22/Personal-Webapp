import type { Metadata } from 'next';
import { ArrowRight, CheckCircle2, Clock, Flame, Lightbulb } from 'lucide-react';
import { buildWeeklyReview } from '@cortex/core';
import { getHabits, getTasks, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskRow } from '@/components/tasks/task-row';
import { formatDate, percent, pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Weekly review' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const { settings } = await requireSession();
  const [tasks, { habits, entries }] = await Promise.all([
    getTasks({ status: ['todo', 'in_progress', 'done'], limit: 1000 }),
    getHabits(),
  ]);

  const review = buildWeeklyReview(tasks, habits, entries);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly review</h1>
        <p className="text-sm text-muted-foreground">
          Week of {formatDate(review.windowStart, settings.timeZone)} · what moved, what slipped, what is next.
        </p>
      </header>

      {review.suggestions.length ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" aria-hidden /> Worth doing something about
            </CardTitle>
            <CardDescription>
              Rule-based observations from your own data. On your iPhone, Apple Foundation Models turns these same
              inputs into concrete next actions you can accept.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {review.suggestions.map((suggestion) => (
                <li key={suggestion} className="flex gap-2 text-sm">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {suggestion}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden /> Completed
            </CardTitle>
            <CardDescription>{pluralize(review.completed.length, 'task')} finished this week.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul>
              {review.completed.slice(0, 12).map((task) => (
                <TaskRow key={task.id} task={task} timeZone={settings.timeZone} />
              ))}
              {review.completed.length === 0 ? <p className="px-6 pb-4 text-sm text-muted-foreground">Nothing yet.</p> : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-destructive" aria-hidden /> Slipped
            </CardTitle>
            <CardDescription>{pluralize(review.slipped.length, 'task')} past their due date.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul>
              {review.slipped.slice(0, 12).map((task) => (
                <TaskRow key={task.id} task={task} timeZone={settings.timeZone} />
              ))}
              {review.slipped.length === 0 ? <p className="px-6 pb-4 text-sm text-muted-foreground">Nothing slipped.</p> : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stale</CardTitle>
            <CardDescription>Open for three weeks without moving - archive or break them down.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul>
              {review.stale.slice(0, 10).map((task) => (
                <TaskRow key={task.id} task={task} timeZone={settings.timeZone} />
              ))}
              {review.stale.length === 0 ? <p className="px-6 pb-4 text-sm text-muted-foreground">Nothing is stalling.</p> : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" aria-hidden /> Habits
            </CardTitle>
          </CardHeader>
          <CardContent>
            {review.habitStreaks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No habits tracked yet.</p>
            ) : (
              <ul className="space-y-2">
                {review.habitStreaks.map((habit) => (
                  <li key={habit.habitId} className="flex items-center justify-between text-sm">
                    <span>{habit.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant={habit.completionRate >= 0.7 ? 'success' : 'warning'}>
                        {percent(habit.completionRate)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {habit.current} day streak · best {habit.longest}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming up</CardTitle>
          <CardDescription>{pluralize(review.upcoming.length, 'task')} due in the next fortnight.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <ul>
            {review.upcoming.slice(0, 15).map((task) => (
              <TaskRow key={task.id} task={task} timeZone={settings.timeZone} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
