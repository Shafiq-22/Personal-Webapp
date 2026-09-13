import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-6">
      <Card className="max-w-md">
        <CardHeader>
          <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden />
          <CardTitle className="mt-2">You are offline</CardTitle>
          <CardDescription>
            Pages you have already opened are still available, and anything you change now is queued and sent when you
            reconnect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            The iOS companion is fully usable offline, including the AI features - Apple Foundation Models runs on the
            device itself and needs no connection at all.
          </p>
          <Link href="/today" className="text-primary underline-offset-4 hover:underline">
            Try again
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
