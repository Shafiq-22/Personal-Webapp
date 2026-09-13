'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { SchedulingSettings } from '@cortex/core';
import { updateSchedulingSettings } from '@/app/actions/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toTimeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromTimeValue(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function SchedulingPanel({ settings }: { settings: SchedulingSettings }) {
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<SchedulingSettings>(settings);

  function save(next: SchedulingSettings) {
    setValues(next);
    startTransition(async () => {
      const result = await updateSchedulingSettings(next);
      if (result.ok) toast.success('Saved');
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Working hours</CardTitle>
          <CardDescription>
            Free-slot detection and every scheduling suggestion stay inside these windows, in your own time zone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {values.workingHours
            .slice()
            .sort((a, b) => a.weekday - b.weekday)
            .map((day) => (
              <div key={day.weekday} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <Switch
                  checked={day.enabled}
                  aria-label={`Work on ${DAY_NAMES[day.weekday - 1]}`}
                  onCheckedChange={(checked) =>
                    save({
                      ...values,
                      workingHours: values.workingHours.map((d) => (d.weekday === day.weekday ? { ...d, enabled: checked } : d)),
                    })
                  }
                />
                <span className="w-24 text-sm">{DAY_NAMES[day.weekday - 1]}</span>
                <Input
                  type="time"
                  className="w-32"
                  aria-label={`${DAY_NAMES[day.weekday - 1]} start`}
                  value={toTimeValue(day.startMinute)}
                  disabled={!day.enabled}
                  onChange={(event) =>
                    save({
                      ...values,
                      workingHours: values.workingHours.map((d) =>
                        d.weekday === day.weekday ? { ...d, startMinute: fromTimeValue(event.target.value) } : d,
                      ),
                    })
                  }
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="w-32"
                  aria-label={`${DAY_NAMES[day.weekday - 1]} end`}
                  value={toTimeValue(day.endMinute)}
                  disabled={!day.enabled}
                  onChange={(event) =>
                    save({
                      ...values,
                      workingHours: values.workingHours.map((d) =>
                        d.weekday === day.weekday ? { ...d, endMinute: fromTimeValue(event.target.value) } : d,
                      ),
                    })
                  }
                />
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="buffer">Buffer around events (min)</Label>
            <Input
              id="buffer"
              type="number"
              min={0}
              max={60}
              value={values.bufferMinutes}
              onChange={(event) => setValues({ ...values, bufferMinutes: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min-block">Shortest block (min)</Label>
            <Input
              id="min-block"
              type="number"
              min={10}
              max={240}
              value={values.minBlockMinutes}
              onChange={(event) => setValues({ ...values, minBlockMinutes: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-block">Longest block (min)</Label>
            <Input
              id="max-block"
              type="number"
              min={15}
              max={480}
              value={values.maxBlockMinutes}
              onChange={(event) => setValues({ ...values, maxBlockMinutes: Number(event.target.value) })}
              onBlur={() => save(values)}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3 sm:col-span-3">
            <div>
              <Label htmlFor="protect-habits">Protect habit time</Label>
              <p className="mt-1 text-xs text-muted-foreground">Habit blocks are placed first and tasks fill in around them.</p>
            </div>
            <Switch
              id="protect-habits"
              checked={values.protectHabits}
              disabled={pending}
              onCheckedChange={(checked) => save({ ...values, protectHabits: checked })}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3 sm:col-span-3">
            <div>
              <Label htmlFor="auto-replan">Suggest a re-plan when the calendar changes</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Suggest, never move: an approved block is only rescheduled when you say so.
              </p>
            </div>
            <Switch
              id="auto-replan"
              checked={values.autoReplanOnCalendarChange}
              disabled={pending}
              onCheckedChange={(checked) => save({ ...values, autoReplanOnCalendarChange: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => save(values)} disabled={pending}>
        Save scheduling settings
      </Button>
    </div>
  );
}
