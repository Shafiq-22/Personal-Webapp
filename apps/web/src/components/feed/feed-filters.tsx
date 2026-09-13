'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function FeedFilters({
  topics,
  sources,
  current,
}: {
  topics: Array<{ id: string; label: string }>;
  sources: Array<{ id: string; name: string }>;
  current: { topic: string; source: string; min: string; state: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && !value.startsWith('all-')) params.set(key, value);
    else params.delete(key);
    router.push(`/feed?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={current.topic || 'all-topics'} onValueChange={(value) => update('topic', value)}>
        <SelectTrigger className="w-[190px]" aria-label="Filter by topic">
          <SelectValue placeholder="All topics" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-topics">All topics</SelectItem>
          {topics.map((topic) => (
            <SelectItem key={topic.id} value={topic.id}>
              {topic.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={current.source || 'all-sources'} onValueChange={(value) => update('source', value)}>
        <SelectTrigger className="w-[190px]" aria-label="Filter by source">
          <SelectValue placeholder="All sources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-sources">All sources</SelectItem>
          {sources.map((source) => (
            <SelectItem key={source.id} value={source.id}>
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={current.min || 'all-scores'} onValueChange={(value) => update('min', value)}>
        <SelectTrigger className="w-[170px]" aria-label="Minimum relevance">
          <SelectValue placeholder="Any relevance" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-scores">Any relevance</SelectItem>
          <SelectItem value="0.4">Above 40%</SelectItem>
          <SelectItem value="0.6">Above 60%</SelectItem>
          <SelectItem value="0.8">Above 80%</SelectItem>
        </SelectContent>
      </Select>

      <Select value={current.state || 'unread'} onValueChange={(value) => update('state', value)}>
        <SelectTrigger className="w-[150px]" aria-label="Reading state">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unread">Unread</SelectItem>
          <SelectItem value="all">Everything</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
