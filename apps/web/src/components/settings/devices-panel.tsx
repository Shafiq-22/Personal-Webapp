import { Cpu, Smartphone } from 'lucide-react';
import type { DeviceRow } from '@/lib/supabase/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

const AVAILABILITY_COPY: Record<DeviceRow['afm_availability'], { label: string; variant: 'success' | 'warning' | 'secondary' }> = {
  available: { label: 'Foundation Models ready', variant: 'success' },
  model_not_ready: { label: 'Model still downloading', variant: 'warning' },
  apple_intelligence_disabled: { label: 'Apple Intelligence is off', variant: 'warning' },
  device_not_eligible: { label: 'Device not eligible', variant: 'secondary' },
  unsupported_os: { label: 'OS too old', variant: 'secondary' },
  unknown: { label: 'Not reported yet', variant: 'secondary' },
};

export function DevicesPanel({ devices, timeZone }: { devices: DeviceRow[]; timeZone: string }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Paired devices</CardTitle>
          <CardDescription>
            The iOS companion registers itself here and reports whether Apple Foundation Models is usable, so the web
            app can be honest about which AI features are currently available.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {devices.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              <p className="mb-2">No device paired yet.</p>
              <p>
                Install the Cortex companion from <code className="font-mono text-xs">ios/</code>, sign in with the same
                account, and it will appear here. Without it the web app still works in full - it simply uses the
                deterministic planner and ranker instead of the on-device model.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {devices.map((device) => {
                const status = AVAILABILITY_COPY[device.afm_availability];
                return (
                  <li key={device.id} className="flex items-center gap-3 px-6 py-3">
                    <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.platform}
                        {device.app_version ? ` · v${device.app_version}` : ''}
                        {device.last_seen_at ? ` · last seen ${formatDateTime(device.last_seen_at, timeZone)}` : ''}
                      </p>
                    </div>
                    <Badge variant={status.variant} className="shrink-0 gap-1">
                      {device.afm_availability === 'available' ? <Cpu className="h-3 w-3" aria-hidden /> : null}
                      {status.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
