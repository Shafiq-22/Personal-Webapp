'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function TaskFilters({
  projects,
  tags,
  current,
}: {
  projects: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  current: { q: string; project: string; tag: string; status: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all-projects' && value !== 'all-tags') params.set(key, value);
    else params.delete(key);
    router.push(`/tasks?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-[240px] flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          const input = new FormData(event.currentTarget).get('q');
          update('q', typeof input === 'string' ? input : '');
        }}
      >
        <label htmlFor="task-search" className="sr-only">
          Search tasks
        </label>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="task-search"
          name="q"
          defaultValue={current.q}
          placeholder='Search - try "overdue p1 #grant"'
          className="pl-9"
        />
      </form>

      <Select value={current.project || 'all-projects'} onValueChange={(value) => update('project', value)}>
        <SelectTrigger className="w-[180px]" aria-label="Filter by project">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-projects">All projects</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={current.tag || 'all-tags'} onValueChange={(value) => update('tag', value)}>
        <SelectTrigger className="w-[150px]" aria-label="Filter by tag">
          <SelectValue placeholder="All tags" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-tags">All tags</SelectItem>
          {tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>
              @{tag.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={current.status || 'open'} onValueChange={(value) => update('status', value)}>
        <SelectTrigger className="w-[130px]" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="done">Done</SelectItem>
          <SelectItem value="all">Everything</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
