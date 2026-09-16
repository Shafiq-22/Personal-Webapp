'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { updateProfile } from '@/app/actions/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Time zone drives more than it looks: working hours, free-slot detection, the
 * hour the daily digest is built, and what "today" means on every screen.
 */
const TIME_ZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Singapore', 'Asia/Tokyo',
  'Europe/London', 'Europe/Berlin', 'Europe/Lisbon', 'America/New_York',
  'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
];

export function AccountPanel({
  email,
  displayName,
  timeZone,
}: {
  email: string | null;
  displayName: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(displayName ?? '');
  const [zone, setZone] = useState(timeZone);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changing, setChanging] = useState(false);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error('The two passwords do not match.');
      return;
    }
    if (password.length < 10) {
      toast.error('Use at least 10 characters.');
      return;
    }

    setChanging(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setChanging(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setPassword('');
    setConfirmation('');
    toast.success('Password changed. It takes effect on your next sign-in.');
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" aria-hidden /> Profile
          </CardTitle>
          <CardDescription>Signed in as {email ?? 'unknown'}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await updateProfile({ displayName: name, timeZone: zone });
                if (result.ok) {
                  toast.success('Profile saved');
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input id="display-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="time-zone">Time zone</Label>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger id="time-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([zone, ...TIME_ZONES])].map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sets your working hours, free-slot detection and the hour your daily digest is built.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden /> Password
          </CardTitle>
          <CardDescription>
            Change it to something only you know. This takes effect immediately and does not need an email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={changing || !password}>
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
