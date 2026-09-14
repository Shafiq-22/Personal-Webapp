import { requireSession } from '@/lib/queries';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { AppHeader } from '@/components/shell/app-header';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, settings } = await requireSession();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader profile={profile} timeZone={settings.timeZone} />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
