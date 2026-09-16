'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { NotificationSettings } from '@cortex/core';
import { updateNotificationSettings } from '@/app/actions/settings';
import { AfmNotice } from '@/components/afm-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function NotificationsPanel({
  settings,
  afm,
}: {
  settings: NotificationSettings;
  afm: { available: boolean; reason: string | null; deviceName: string | null };
}) {
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<NotificationSettings>(settings);

  function save(next: NotificationSettings) {
    setValues(next);
    startTransition(async () => {
      const result = await updateNotificationSettings(next);
      if (result.ok) toast.success('Saved');
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <AfmNotice status={afm} context="feed" />

      <Card>
        <CardHeader>
          <CardTitle>Digests and alerts</CardTitle>
          <CardDescription>
            Digest times are interpreted in your own time zone. Push notifications are delivered by the iOS companion.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="daily-hour">Daily digest hour</Label>
            <Input
              id="daily-hour"
              type="number"
              min={0}
              max={23}
              value={values.dailyDigestHour}
              onChange={(event) => setValues({ ...values, dailyDigestHour: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="weekly-day">Weekly digest day</Label>
            <Select
              value={String(values.weeklyDigestWeekday)}
              onValueChange={(value) => save({ ...values, weeklyDigestWeekday: Number(value) })}
            >
              <SelectTrigger id="weekly-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((day, index) => (
                  <SelectItem key={day} value={String(index + 1)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alert-threshold">
              Interrupt me above {Math.round(values.realtimeAlertThreshold * 100)}% relevance
            </Label>
            <Input
              id="alert-threshold"
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={values.realtimeAlertThreshold}
              onChange={(event) => setValues({ ...values, realtimeAlertThreshold: Number(event.target.value) })}
              onMouseUp={() => save(values)}
              onTouchEnd={() => save(values)}
            />
            <p className="text-xs text-muted-foreground">
              Below this, items wait for the next digest instead of pushing a notification.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quiet-start">Quiet hours start</Label>
            <Input
              id="quiet-start"
              type="number"
              min={0}
              max={23}
              value={values.quietHoursStart ?? 22}
              onChange={(event) => setValues({ ...values, quietHoursStart: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quiet-end">Quiet hours end</Label>
            <Input
              id="quiet-end"
              type="number"
              min={0}
              max={23}
              value={values.quietHoursEnd ?? 7}
              onChange={(event) => setValues({ ...values, quietHoursEnd: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3 sm:col-span-2">
            <Label htmlFor="push-enabled">Push notifications</Label>
            <Switch
              id="push-enabled"
              checked={values.pushEnabled}
              disabled={pending}
              onCheckedChange={(checked) => save({ ...values, pushEnabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => save(values)} disabled={pending}>
        Save notification settings
      </Button>
    </div>
  );
}
