import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';
import { hasSupabaseConfig } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-lg font-semibold tracking-tight">
          Cortex
        </Link>

        {configured ? (
          <LoginForm next={params.next ?? '/today'} initialError={params.error ?? null} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Supabase is not configured yet</CardTitle>
              <CardDescription>
                Copy <code className="font-mono text-xs">apps/web/.env.example</code> to{' '}
                <code className="font-mono text-xs">.env.local</code> and set{' '}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then restart the dev server.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              See <code className="font-mono text-xs">docs/setup.md</code> for the full walkthrough, including creating
              the database schema with <code className="font-mono text-xs">supabase db push</code>.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
