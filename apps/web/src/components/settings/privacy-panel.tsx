'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { PrivacySettings } from '@cortex/core';
import { eraseCloudData, revokeShare, updatePrivacySettings } from '@/app/actions/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const TOGGLES: Array<{ key: keyof PrivacySettings; label: string; description: string }> = [
  {
    key: 'localFirst',
    label: 'Local-first mode',
    description:
      'Keep everything that can stay on your device on your device. Cloud rows are limited to what cross-device sync strictly needs.',
  },
  {
    key: 'syncAiSummaries',
    label: 'Sync on-device summaries',
    description:
      'Upload summaries your iPhone wrote so the web app can show them too. Off by default: the text stays on the phone.',
  },
  {
    key: 'storeItemContent',
    label: 'Store article text',
    description:
      'Keep the fetched body of monitored items. Turning this off stores only the metadata and the link, which makes offline reading and on-device summarisation weaker.',
  },
  {
    key: 'allowVaultTopicScan',
    label: 'Scan the Obsidian vault for topics',
    description:
      'Your iPhone reads note text locally to propose topics. Only the proposed labels are uploaded, never the notes.',
  },
  {
    key: 'encryptVaultMetadata',
    label: 'Encrypt vault metadata',
    description: 'Client-side encryption for the file paths and hashes Cortex stores about your vault.',
  },
  {
    key: 'explainAiDecisions',
    label: 'Explain AI decisions',
    description: 'Show the signals behind every relevance score and scheduling suggestion.',
  },
  {
    key: 'shareAnalytics',
    label: 'Share anonymous usage analytics',
    description: 'Off by default. Cortex ships with no analytics of any kind unless you switch this on.',
  },
];

export function PrivacyPanel({
  settings,
  shares,
}: {
  settings: PrivacySettings;
  shares: Array<{ id: string; token: string; title: string | null; resource_type: string; view_count: number }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<PrivacySettings>(settings);
  const [confirmErase, setConfirmErase] = useState(false);

  function toggle(key: keyof PrivacySettings, value: boolean) {
    const next = { ...values, [key]: value };
    setValues(next);
    startTransition(async () => {
      const result = await updatePrivacySettings(next);
      if (result.ok) toast.success('Saved');
      else {
        setValues(values);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What leaves your devices</CardTitle>
          <CardDescription>
            All AI processing happens on your iPhone with Apple Foundation Models. There is no cloud model in Cortex,
            so none of these switches affect whether a model provider sees your data - they never do. What they control
            is what Cortex itself stores in your own database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TOGGLES.map((toggleDef) => (
            <div key={toggleDef.key} className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="min-w-0">
                <Label htmlFor={`privacy-${toggleDef.key}`}>{toggleDef.label}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{toggleDef.description}</p>
              </div>
              <Switch
                id={`privacy-${toggleDef.key}`}
                checked={Boolean(values[toggleDef.key])}
                disabled={pending}
                onCheckedChange={(checked) => toggle(toggleDef.key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Share links ({shares.length})</CardTitle>
          <CardDescription>Read-only snapshots. Notes are excluded unless the link was created with them.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {shares.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No active share links.</p>
          ) : (
            <ul className="divide-y">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{share.title ?? share.resource_type}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      /share/{share.token} · {share.view_count} view{share.view_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        const result = await revokeShare(share.id);
                        if (result.ok) {
                          toast.success('Link revoked');
                          router.refresh();
                        } else {
                          toast.error(result.error);
                        }
                      })
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" aria-hidden /> Erase cloud data
          </CardTitle>
          <CardDescription>
            Deletes every row Cortex holds for you - tasks, items, calendar mirror, topics, summaries - while keeping
            your account. This cannot be undone, and anything only stored on your iPhone is untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch id="confirm-erase" checked={confirmErase} onCheckedChange={setConfirmErase} />
          <Label htmlFor="confirm-erase" className="text-sm font-normal">
            I understand this is permanent
          </Label>
          <Button
            variant="destructive"
            disabled={!confirmErase || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await eraseCloudData();
                if (result.ok) {
                  toast.success(`Erased data from ${result.data?.deleted.length ?? 0} tables.`);
                  setConfirmErase(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            Erase everything
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
