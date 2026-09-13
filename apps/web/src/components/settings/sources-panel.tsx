'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Source } from '@cortex/core';
import { addSource, deleteSource, setSourceEnabled } from '@/app/actions/monitoring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/utils';

const KINDS = [
  { value: 'arxiv', label: 'arXiv', hint: 'Paste an arXiv Atom query URL, e.g. export.arxiv.org/api/query?...' },
  { value: 'rss', label: 'RSS feed', hint: 'Any RSS or Atom feed URL' },
  { value: 'news', label: 'News site', hint: 'A publication feed' },
  { value: 'blog', label: 'Blog', hint: 'Personal or company blog feed' },
  { value: 'forum', label: 'Forum', hint: 'Discourse, Reddit or mailing list feed' },
  { value: 'regulatory', label: 'Regulatory', hint: 'Agency notices and rule changes' },
  { value: 'patents', label: 'Patents', hint: 'A patent office alert feed' },
  { value: 'company_news', label: 'Company announcements', hint: 'Press or investor relations feed' },
  { value: 'github_releases', label: 'GitHub releases', hint: 'github.com/<owner>/<repo>/releases.atom' },
  { value: 'scholar_alert', label: 'Scholar alert', hint: 'A Google Scholar alert forwarded as a feed' },
  { value: 'pubmed', label: 'PubMed', hint: 'A saved PubMed search feed' },
  { value: 'biorxiv', label: 'bioRxiv', hint: 'A bioRxiv subject feed' },
  { value: 'x_list', label: 'X / Twitter list', hint: 'A list bridged to RSS' },
  { value: 'web_page', label: 'Web page', hint: 'A page polled for changes' },
];

const STARTERS = [
  { kind: 'arxiv', name: 'arXiv cs.LG (recent)', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=50' },
  { kind: 'github_releases', name: 'Obsidian releases', url: 'https://github.com/obsidianmd/obsidian-releases/releases.atom' },
  { kind: 'news', name: 'Nature briefing', url: 'https://www.nature.com/nature.rss' },
];

export function SourcesPanel({ sources, timeZone }: { sources: Source[]; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState('rss');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const activeKind = KINDS.find((option) => option.value === kind);

  function submit(payload: { kind: string; name: string; url: string }) {
    startTransition(async () => {
      const result = await addSource(payload);
      if (result.ok) {
        toast.success(`Now monitoring ${payload.name}`);
        setName('');
        setUrl('');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a source</CardTitle>
          <CardDescription>
            Anything that publishes a feed can be monitored: papers, news, blogs, forums, regulators, patent offices,
            company announcements, release notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[180px_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              submit({ kind, name, url });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="source-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="source-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-name">Name</Label>
              <Input id="source-name" value={name} onChange={(event) => setName(event.target.value)} required placeholder="Battery Weekly" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-url">Feed URL</Label>
              <Input id="source-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://..." />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={pending}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </form>

          {activeKind ? <p className="text-xs text-muted-foreground">{activeKind.hint}</p> : null}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Quick start:</span>
            {STARTERS.map((starter) => (
              <Button key={starter.url} size="sm" variant="outline" disabled={pending} onClick={() => submit(starter)}>
                {starter.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your sources ({sources.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sources.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing monitored yet.</p>
          ) : (
            <ul className="divide-y">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center gap-3 px-6 py-3">
                  <Switch
                    checked={source.enabled}
                    aria-label={`${source.enabled ? 'Pause' : 'Resume'} ${source.name}`}
                    onCheckedChange={(checked) =>
                      startTransition(async () => {
                        const result = await setSourceEnabled(source.id, checked);
                        if (result.ok) router.refresh();
                        else toast.error(result.error);
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{source.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{source.url}</p>
                    {source.lastError ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" aria-hidden /> {source.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{source.kind}</Badge>
                    <Badge variant={source.lastStatus === 'error' ? 'destructive' : source.lastStatus === 'ok' ? 'success' : 'secondary'}>
                      {source.lastFetchedAt ? formatDateTime(source.lastFetchedAt, timeZone, { dateStyle: 'short', timeStyle: 'short' }) : 'never fetched'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${source.name}`}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteSource(source.id);
                          if (result.ok) {
                            toast.success('Source removed');
                            router.refresh();
                          } else {
                            toast.error(result.error);
                          }
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
