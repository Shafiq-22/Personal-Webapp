'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Mode = 'password' | 'magic';

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('password');
  const [isSignUp, setIsSignUp] = useState(false);

  const redirectTo = typeof window === 'undefined'
    ? undefined
    : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: authError } = isSignUp
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
      : await supabase.auth.signInWithPassword({ email, password });

    setBusy(false);

    if (authError) {
      setError(authError.message);
      return;
    }
    if (isSignUp) {
      toast.success('Check your inbox to confirm your address, then sign in.');
      setIsSignUp(false);
      return;
    }
    startTransition(() => {
      router.replace(next);
      router.refresh();
    });
  }

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);
    if (authError) setError(authError.message);
    else toast.success(`A sign-in link is on its way to ${email}.`);
  }

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (authError) {
      setBusy(false);
      setError(authError.message);
    }
  }

  const disabled = busy || pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isSignUp ? 'Create your account' : 'Sign in to Cortex'}</CardTitle>
        <CardDescription>
          {isSignUp
            ? 'Your tasks and topics are yours alone - no team, no sharing by default.'
            : 'Email and password, a one-time link, or your Google account.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={disabled}>
          Continue with Google
        </Button>
        <p className="text-xs text-muted-foreground">
          Signing in with Google does not give Cortex access to your calendar. Calendar access is requested separately,
          later, and can be revoked on its own.
        </p>

        <div className="relative py-2 text-center text-xs uppercase text-muted-foreground">
          <span className="bg-card px-2">or</span>
          <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
        </div>

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic">Email link</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={disabled}>
                {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSignUp ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="magic">
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="magic-email">Email</Label>
                <Input
                  id="magic-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={disabled}>
                {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send me a link
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setIsSignUp((value) => !value)}
        >
          {isSignUp ? 'I already have an account' : 'I need an account'}
        </button>
      </CardContent>
    </Card>
  );
}
