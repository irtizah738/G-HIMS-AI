import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { GlobalErrorBoundary } from '@/components/common/GlobalErrorBoundary';
import { SystemInitializer } from '@/components/common/SystemInitializer';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://g-hims-ai.vercel.app'),
  title: 'G-HIMS | Clinical Intelligence & Hospital Operating System',
  description: 'G-HIMS is a healthcare technology initiative developing clinician-governed Clinical Intelligence and an event-driven Hospital Operating System.',
  applicationName: 'G-HIMS',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'G-HIMS | Clinical Intelligence & Hospital Operating System',
    description: 'Evidence-linked clinical intelligence and governed hospital infrastructure.',
    siteName: 'G-HIMS',
    locale: 'en_US',
  },
  twitter: { card: 'summary', title: 'G-HIMS', description: 'Clinical intelligence and hospital infrastructure.' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const reqHeaders = await headers();
  const nonce = reqHeaders.get('x-nonce') || undefined;
  return (
    <html lang="en" suppressHydrationWarning nonce={nonce}>
      <body className="antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-blue-100 selection:text-blue-900 dark:selection:bg-blue-900 dark:selection:text-blue-100 min-h-screen">
        <GlobalErrorBoundary>
          <ThemeProvider><SystemInitializer><AppProviders>{children}</AppProviders></SystemInitializer></ThemeProvider>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
