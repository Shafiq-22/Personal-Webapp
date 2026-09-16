import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Cortex', template: '%s · Cortex' },
  description:
    'Privacy-first personal productivity and research intelligence: tasks, calendar, and the latest information from the internet, with all AI running on your own device.',
  applicationName: 'Cortex',
  manifest: '/manifest.webmanifest',
  // iOS ignores the manifest's icons for "Add to Home Screen" and uses
  // apple-touch-icon, which must be a PNG with no transparency.
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Cortex', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          {children}
          <Toaster position="bottom-right" closeButton richColors />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
