import type { Metadata } from 'next';
import { ListTodo } from 'lucide-react';
import { buildTaskTree, parseQuery } from '@cortex/core';
import { getProjects, getTags, getTasks, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskRow } from '@/components/tasks/task-row';
import { TaskFilters } from '@/components/tasks/task-filters';
import { NewProjectButton } from '@/components/tasks/new-project-button';
import { pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  project?: string;
  tag?: string;
  status?: string;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { settings } = await requireSession();
  const [projects, tags] = await Promise.all([getProjects(), getTags()]);

  // The search box accepts the same grammar as capture: "overdue p1 #grant".
  const parsed = params.q ? parseQuery(params.q) : null;
  const statusFilter =
    params.status === 'done'
      ? (['done'] as const)
      : params.status === 'all'
        ? (['todo', 'in_progress', 'done', 'cancelled'] as const)
        : (['todo', 'in_progress'] as const);

  const projectByName = new Map(projects.map((project) => [project.name.toLowerCase(), project]));
  const resolvedProjectId =
    params.project ?? (parsed?.projectName ? projectByName.get(parsed.projectName.toLowerCase())?.id : undefined);

  const tagByName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
  const resolvedTagId = params.tag ?? (parsed?.tagNames[0] ? tagByName.get(parsed.tagNames[0])?.id : undefined);

  const tasks = await getTasks({
    status: [...statusFilter],
    ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
    ...(resolvedTagId ? { tagId: resolvedTagId } : {}),
    ...(parsed?.text ? { search: parsed.text } : {}),
  });

  const filtered = parsed?.overdue
    ? tasks.filter((task) => task.dueAt && Date.parse(task.dueAt) < Date.now() && task.status !== 'done')
    : parsed?.priority
      ? tasks.filter((task) => task.priority === parsed.priority)
      : tasks;

  const tree = buildTaskTree(filtered);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">{pluralize(filtered.length, 'task')} matching your filters.</p>
        </div>
        <NewProjectButton />
      </header>

      <TaskFilters
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        current={{ q: params.q ?? '', project: params.project ?? '', tag: params.tag ?? '', status: params.status ?? 'open' }}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            {resolvedProjectId ? projectNames.get(resolvedProjectId) ?? 'Project' : 'All tasks'}
          </CardTitle>
          <CardDescription>
            Subtasks are nested under their parent. Completing a recurring task rolls it forward instead of closing it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {tree.length === 0 ? (
            <EmptyState
              className="m-6 mt-2"
              icon={ListTodo}
              title="Nothing here"
              description="Capture a task with the bar at the top of the page, or relax your filters."
            />
          ) : (
            <ul>
              {tree.map(({ task, depth }) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  depth={depth}
                  timeZone={settings.timeZone}
                  projectName={task.projectId ? projectNames.get(task.projectId) : null}
                  tagNames={task.tagIds.map((id) => tagNames.get(id)).filter((name): name is string => Boolean(name))}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
