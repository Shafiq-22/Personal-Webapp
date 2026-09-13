import type { Metadata } from 'next';
import { Download, FileText } from 'lucide-react';
import { renderItemNote, renderTaskNote, vaultPathFor, VaultConfig } from '@cortex/core';
import { getFeed, getOpenTasks, getProjects, getVault, requireSession } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { VaultSettingsForm } from '@/components/obsidian/vault-settings-form';

export const metadata: Metadata = { title: 'Obsidian' };
export const dynamic = 'force-dynamic';

export default async function ObsidianPage() {
  const { user } = await requireSession();
  const [vault, tasks, projects, saved] = await Promise.all([
    getVault(),
    getOpenTasks(),
    getProjects(),
    getFeed({ state: ['saved'], limit: 5 }),
  ]);

  const effectiveVault =
    vault ??
    VaultConfig.parse({
      id: '00000000-0000-4000-a000-000000000000',
      userId: user.id,
      createdAt: new Date().toISOString(),
    });

  // A real preview built from the user's own first task and saved item, so
  // what they see is exactly what will land in the vault.
  const sampleTask = tasks[0];
  const sampleItem = saved[0]?.item;
  const taskPreview = sampleTask
    ? renderTaskNote(sampleTask, {
        project: sampleTask.projectId ? projects.find((p) => p.id === sampleTask.projectId) ?? null : null,
        tags: [],
      })
    : null;
  const itemPreview = sampleItem
    ? renderItemNote(sampleItem, { topicLabels: saved[0]?.topicLabels ?? [], relevance: saved[0]?.score ?? null })
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Obsidian</h1>
          <p className="text-sm text-muted-foreground">
            Plain Markdown with frontmatter that round-trips. Task lines follow the Tasks plugin syntax, so your
            existing queries pick them up with no configuration.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/obsidian/export" download>
            <Download className="h-4 w-4" /> Download vault bundle
          </a>
        </Button>
      </header>

      <VaultSettingsForm vault={vault} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden /> Task note
            </CardTitle>
            <CardDescription>
              {sampleTask ? vaultPathFor(effectiveVault, { type: 'task', task: sampleTask }) : 'Create a task to see a preview.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              <code>{taskPreview ?? '# No tasks yet'}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden /> Research note
            </CardTitle>
            <CardDescription>
              {sampleItem ? vaultPathFor(effectiveVault, { type: 'item', item: sampleItem }) : 'Save something from the feed to see a preview.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              <code>{itemPreview ?? '# Nothing saved yet'}</code>
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How the two-way sync decides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Cortex stores the hash of the note both sides last agreed on. Comparing that with what Cortex would write
            now and what is actually in the vault tells it who changed what, without trusting file timestamps - which
            iCloud, WebDAV and LiveSync all report differently.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Changed in Cortex only: the note is rewritten.</li>
            <li>Changed in Obsidian only: the change is read back into your task or library entry.</li>
            <li>Changed on both sides: the note is flagged as a conflict and neither side is overwritten.</li>
            <li>Ticking a checkbox in Obsidian wins over the frontmatter, because it is the edit you just made.</li>
          </ul>
          <p>
            The iOS companion performs the file I/O - it is the side with access to your iCloud Drive vault. The web
            app exports a bundle you can unzip into the vault yourself.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
