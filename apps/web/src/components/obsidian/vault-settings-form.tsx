'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { VaultConfig } from '@cortex/core';
import { saveVaultConfig } from '@/app/actions/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const TRANSPORTS = [
  { value: 'icloud_drive', label: 'iCloud Drive' },
  { value: 'obsidian_sync', label: 'Obsidian Sync' },
  { value: 'webdav', label: 'WebDAV' },
  { value: 'remotely_save', label: 'Remotely Save' },
  { value: 'livesync', label: 'Self-hosted LiveSync' },
  { value: 'google_drive', label: 'Google Drive' },
  { value: 'local_rest_api', label: 'Obsidian Local REST API' },
  { value: 'manual_export', label: 'Manual export only' },
];

export function VaultSettingsForm({ vault }: { vault: VaultConfig | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(vault?.name ?? 'My vault');
  const [transport, setTransport] = useState(vault?.transport ?? 'icloud_drive');
  const [direction, setDirection] = useState<'push' | 'pull' | 'two_way'>(vault?.direction ?? 'two_way');
  const [allowTopicScan, setAllowTopicScan] = useState(vault?.allowTopicScan ?? false);
  const [encryptionEnabled, setEncryptionEnabled] = useState(vault?.encryptionEnabled ?? false);
  const [restApiBaseUrl, setRestApiBaseUrl] = useState(vault?.restApiBaseUrl ?? '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault</CardTitle>
        <CardDescription>
          Where your Markdown lives and which direction changes flow. The transport only decides where the bytes go -
          the note format is identical either way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await saveVaultConfig({
                ...(vault?.id ? { id: vault.id } : {}),
                name,
                transport,
                direction,
                allowTopicScan,
                encryptionEnabled,
                restApiBaseUrl: restApiBaseUrl || null,
              });
              if (result.ok) {
                toast.success('Vault settings saved');
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="vault-name">Name</Label>
            <Input id="vault-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vault-transport">Transport</Label>
            <Select value={transport} onValueChange={(value) => setTransport(value as VaultConfig['transport'])}>
              <SelectTrigger id="vault-transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vault-direction">Direction</Label>
            <Select value={direction} onValueChange={(value) => setDirection(value as typeof direction)}>
              <SelectTrigger id="vault-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="two_way">Two-way</SelectItem>
                <SelectItem value="push">Cortex writes only</SelectItem>
                <SelectItem value="pull">Obsidian wins</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {transport === 'local_rest_api' ? (
            <div className="space-y-1.5">
              <Label htmlFor="vault-rest">Local REST API base URL</Label>
              <Input
                id="vault-rest"
                value={restApiBaseUrl}
                onChange={(event) => setRestApiBaseUrl(event.target.value)}
                placeholder="https://127.0.0.1:27124"
              />
            </div>
          ) : null}

          <div className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="vault-scan">Let Cortex read the vault for topics</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Note text is scanned on your iPhone to propose monitoring topics. Only the proposed topic labels leave
                the device - never the note contents. Revocable at any time.
              </p>
            </div>
            <Switch id="vault-scan" checked={allowTopicScan} onCheckedChange={setAllowTopicScan} />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="vault-encrypt">Encrypt vault metadata in the cloud</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                File paths and content hashes are encrypted client-side before they are stored. Cortex holds a key
                reference, never your passphrase - which also means a lost passphrase cannot be recovered.
              </p>
            </div>
            <Switch id="vault-encrypt" checked={encryptionEnabled} onCheckedChange={setEncryptionEnabled} />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Save vault settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
