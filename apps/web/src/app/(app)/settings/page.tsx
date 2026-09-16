import type { Metadata } from 'next';
import { getAfmStatus, getDevices, getShares, getSources, getTopicCandidates, getTopics, requireSession } from '@/lib/queries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourcesPanel } from '@/components/settings/sources-panel';
import { TopicsPanel } from '@/components/settings/topics-panel';
import { PrivacyPanel } from '@/components/settings/privacy-panel';
import { SchedulingPanel } from '@/components/settings/scheduling-panel';
import { NotificationsPanel } from '@/components/settings/notifications-panel';
import { DevicesPanel } from '@/components/settings/devices-panel';
import { AccountPanel } from '@/components/settings/account-panel';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { settings, profile } = await requireSession();
  const [sources, topics, candidates, devices, shares, afm] = await Promise.all([
    getSources(),
    getTopics(),
    getTopicCandidates(),
    getDevices(),
    getShares(),
    getAfmStatus(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Signed in as {profile.email}.</p>
      </header>

      <Tabs defaultValue="monitoring">
        <TabsList className="flex-wrap">
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" id="monitoring">
          <SourcesPanel sources={sources} timeZone={settings.timeZone} />
        </TabsContent>

        <TabsContent value="topics">
          <TopicsPanel topics={topics} candidates={candidates} />
        </TabsContent>

        <TabsContent value="scheduling">
          <SchedulingPanel settings={settings.scheduling} />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsPanel settings={settings.notifications} afm={afm} />
        </TabsContent>

        <TabsContent value="privacy">
          <PrivacyPanel settings={settings.privacy} shares={shares as never[]} />
        </TabsContent>

        <TabsContent value="devices">
          <DevicesPanel devices={devices} timeZone={settings.timeZone} />
        </TabsContent>

        <TabsContent value="account">
          <AccountPanel email={profile.email} displayName={profile.display_name} timeZone={settings.timeZone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
