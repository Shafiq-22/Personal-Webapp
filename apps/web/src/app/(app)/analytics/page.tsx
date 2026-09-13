import type { Metadata } from 'next';
import { computeProductivityStats } from '@cortex/core';
import { getProjects, getTasks, getTimeBlocks, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CompletionChart } from '@/components/analytics/completion-chart';
import { percent } from '@/lib/utils';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  await requireSession();
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  const [tasks, projects, blocks] = await Promise.all([
    getTasks({ status: ['todo', 'in_progress', 'done', 'cancelled'], limit: 2000 }),
    getProjects(),
    getTimeBlocks(from.toISOString(), now.toISOString()),
  ]);

  const stats = computeProductivityStats(tasks, { now, timeBlocks: blocks });
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  const cards = [
    { label: 'Open', value: String(stats.openCount), hint: `${stats.overdueCount} past due` },
    { label: 'Completed this week', value: String(stats.completedThisWeek), hint: `${stats.weekOverWeekDelta >= 0 ? '+' : ''}${stats.weekOverWeekDelta} vs last week` },
    { label: 'Median cycle time', value: stats.medianCycleHours === null ? '-' : `${stats.medianCycleHours}h`, hint: 'creation to completion' },
    { label: 'Finished on time', value: stats.onTimeRate === null ? '-' : percent(stats.onTimeRate), hint: 'of tasks with a due date' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Computed from your own rows, in your own account. Nothing is sent anywhere to produce this page.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">{card.hint}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Created versus completed</CardTitle>
          <CardDescription>Last 30 days. A rising gap means work is arriving faster than it leaves.</CardDescription>
        </CardHeader>
        <CardContent>
          <CompletionChart series={stats.series} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By priority</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['p1', 'p2', 'p3', 'p4'] as const).map((priority) => {
              const bucket = stats.byPriority[priority] ?? { open: 0, completed: 0 };
              const total = bucket.open + bucket.completed;
              return (
                <div key={priority}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{priority.toUpperCase()}</span>
                    <span className="text-muted-foreground">
                      {bucket.completed} done · {bucket.open} open
                    </span>
                  </div>
                  <Progress value={total === 0 ? 0 : (bucket.completed / total) * 100} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By project</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {stats.byProject.slice(0, 8).map((row) => (
                <li key={row.projectId ?? 'none'} className="flex items-center justify-between">
                  <span className="truncate">{row.projectId ? projectNames.get(row.projectId) ?? 'Unknown' : 'No project'}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.completed} done · {row.open} open
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Focus time</CardTitle>
          <CardDescription>Blocks you approved in the last 30 days.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-8 text-sm">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{Math.round(stats.focusMinutesScheduled / 60)}h</p>
            <p className="text-muted-foreground">scheduled</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{Math.round(stats.focusMinutesCompleted / 60)}h</p>
            <p className="text-muted-foreground">marked complete</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
