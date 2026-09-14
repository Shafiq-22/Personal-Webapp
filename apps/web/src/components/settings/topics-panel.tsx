'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Topic } from '@cortex/core';
import { addTopic, decideTopicCandidate, deleteTopic, discoverTopics, setTopicActive } from '@/app/actions/monitoring';
import type { TopicCandidateRow } from '@/lib/supabase/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const ORIGIN_COPY: Record<string, string> = {
  manual: 'you wrote it',
  task: 'from your open tasks',
  calendar: 'from your calendar',
  obsidian: 'from your vault',
  item_feedback: 'from what you save',
};

export function TopicsPanel({ topics, candidates }: { topics: Topic[]; candidates: TopicCandidateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [keywords, setKeywords] = useState('');
  const [excludes, setExcludes] = useState('');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Automatic topic discovery</CardTitle>
            <CardDescription>
              Cortex reads your open tasks and recent calendar events and proposes what you appear to be working on.
              Nothing is activated without you accepting it, and each proposal shows the work it came from.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await discoverTopics();
                if (result.ok) {
                  toast.success(
                    result.data?.proposed
                      ? `${result.data.proposed} new topic${result.data.proposed === 1 ? '' : 's'} proposed.`
                      : 'Nothing new to propose - your topics already cover your open work.',
                  );
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            <Sparkles className="h-4 w-4" /> Discover
          </Button>
        </CardHeader>

        {candidates.length ? (
          <CardContent className="space-y-3">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{candidate.label}</span>
                  <Badge variant="secondary">{ORIGIN_COPY[candidate.origin] ?? candidate.origin}</Badge>
                  <Badge variant="outline">{Math.round(Number(candidate.weight) * 100)}% confidence</Badge>
                </div>
                {candidate.evidence.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {candidate.evidence.slice(0, 3).map((line) => (
                      <li key={line}>&ldquo;{line}&rdquo;</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await decideTopicCandidate(candidate.id, true);
                        if (result.ok) {
                          toast.success(`Now monitoring "${candidate.label}"`);
                          router.refresh();
                        } else {
                          toast.error(result.error);
                        }
                      })
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Monitor this
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await decideTopicCandidate(candidate.id, false);
                        router.refresh();
                      })
                    }
                  >
                    <X className="h-3.5 w-3.5" /> No thanks
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a topic</CardTitle>
          <CardDescription>Exclusions veto an item outright, which is the fastest way to kill a noisy match.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await addTopic({
                  label,
                  keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
                  excludeKeywords: excludes.split(',').map((k) => k.trim()).filter(Boolean),
                });
                if (result.ok) {
                  toast.success(`Now monitoring "${label}"`);
                  setLabel('');
                  setKeywords('');
                  setExcludes('');
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="topic-label">Topic</Label>
              <Input id="topic-label" value={label} onChange={(event) => setLabel(event.target.value)} required placeholder="Solid state batteries" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-keywords">Keywords</Label>
              <Input id="topic-keywords" value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="electrolyte, dendrite" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-excludes">Exclude</Label>
              <Input id="topic-excludes" value={excludes} onChange={(event) => setExcludes(event.target.value)} placeholder="press release" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={pending || !label.trim()}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your topics ({topics.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {topics.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No topics yet - nothing will be ranked until you add one.</p>
          ) : (
            <ul className="divide-y">
              {topics.map((topic) => (
                <li key={topic.id} className="flex items-center gap-3 px-6 py-3">
                  <Switch
                    checked={topic.active}
                    aria-label={`${topic.active ? 'Pause' : 'Resume'} ${topic.label}`}
                    onCheckedChange={(checked) =>
                      startTransition(async () => {
                        const result = await setTopicActive(topic.id, checked);
                        if (result.ok) router.refresh();
                        else toast.error(result.error);
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{topic.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {topic.keywords.join(', ') || 'no extra keywords'}
                      {topic.excludeKeywords.length ? ` · excluding ${topic.excludeKeywords.join(', ')}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {ORIGIN_COPY[topic.origin] ?? topic.origin}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${topic.label}`}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteTopic(topic.id);
                        if (result.ok) {
                          toast.success('Topic deleted');
                          router.refresh();
                        } else {
                          toast.error(result.error);
                        }
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
