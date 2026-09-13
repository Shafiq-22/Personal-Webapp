'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import type { ProfileRow } from '@/lib/supabase/types';
import { Button } from '@/components/ui/button';
import { CaptureBar } from '@/components/tasks/capture-bar';
import { cn, initials } from '@/lib/utils';
import { NAV_SECTIONS } from './nav-items';

export function AppHeader({ profile, timeZone }: { profile: ProfileRow; timeZone: string }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <CaptureBar timeZone={timeZone} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
            title={`${profile.display_name ?? profile.email ?? 'Account'} - sign out`}
          >
            {initials(profile.display_name ?? profile.email)}
          </button>
        </form>
      </div>

      {mobileOpen ? (
        <nav aria-label="Main" className="border-t px-4 py-3 md:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {NAV_SECTIONS.flatMap((section) => section.items).map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
                      active ? 'bg-accent font-medium' : 'text-muted-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
