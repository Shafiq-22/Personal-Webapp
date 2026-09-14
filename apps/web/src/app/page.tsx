import Link from 'next/link';
import { ArrowRight, CalendarDays, CheckCircle2, Cpu, FileText, Radar, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FEATURES = [
  {
    icon: CheckCircle2,
    title: 'Tasks that understand deadlines',
    description:
      'Hierarchical projects, subtasks, recurring work and four kinds of reminder - time, location, dependency and escalating.',
  },
  {
    icon: CalendarDays,
    title: 'Your calendar, merged',
    description:
      'Two-way Google Calendar sync, a single timeline of events and tasks, free-slot detection and conflict resolutions you can act on.',
  },
  {
    icon: Radar,
    title: 'The internet, filtered by your own work',
    description:
      'Papers, news, blogs, forums, regulations, patents and releases - ranked against topics extracted from your own tasks, calendar and notes.',
  },
  {
    icon: Cpu,
    title: 'AI that never leaves your iPhone',
    description:
      'Summaries, prioritisation, ranking and natural-language capture run on Apple Foundation Models, on device, offline. No cloud model is ever called.',
  },
  {
    icon: FileText,
    title: 'Obsidian, both directions',
    description:
      'Clean Markdown with rich frontmatter, compatible with the Tasks plugin and Daily Notes, over iCloud, Obsidian Sync, WebDAV or Google Drive.',
  },
  {
    icon: ShieldCheck,
    title: 'Local-first by choice',
    description:
      'Decide what is stored in the cloud and what stays on your device. Every AI decision shows the signals behind it.',
  },
];

export default function LandingPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">Cortex</span>
        <Button asChild variant="ghost">
          <Link href="/login">Sign in</Link>
        </Button>
      </header>

      <section className="mt-20 max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Productivity and research intelligence
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your work decides what the internet shows you.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Cortex reads your own to-do list, calendar and notes to work out what you are actually working on, then goes
          and finds the latest on exactly that - papers, news, forums, regulations, patents. The intelligence runs on
          your iPhone with Apple Foundation Models, so nothing you are thinking about is sent to anyone.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/login">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="https://github.com/Shafiq-22/Personal-Webapp#readme">Read the architecture</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <feature.icon className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="mt-2">{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card className="mt-16">
        <CardHeader>
          <CardTitle>Works without the iPhone, better with it</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            The web app is complete on its own: tasks, calendar, monitoring, digests, Obsidian export and every filter
            work with no companion app installed. What the iOS companion adds is the on-device model - written
            summaries in six styles, re-ranking against what you are working on right now, natural-language capture,
            and time-block suggestions you approve. Where an AI feature is unavailable the interface says so plainly
            and falls back to the deterministic behaviour rather than pretending.
          </p>
        </CardContent>
      </Card>

      <footer className="mt-auto pt-16 text-sm text-muted-foreground">
        <p>All AI processing happens on your device. Cortex has no cloud model and no analytics by default.</p>
      </footer>
    </main>
  );
}
