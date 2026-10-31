import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { GlobalErrorBoundary } from '@/components/common/GlobalErrorBoundary';
import { SystemInitializer } from '@/components/common/SystemInitializer';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata: Metadata = {
  title: 'Helixis AI | Clinical Intelligence & Health Platform',
  description:
    'Helixis AI delivers clinical intelligence and an offline-first hospital platform with governed clinical workflows, longitudinal records, diagnostics, billing, and auditable operations.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const reqHeaders = await headers();
  const nonce = reqHeaders.get('x-nonce') || undefined;

  return (
    <html lang="en" suppressHydrationWarning nonce={nonce}>
      <body className="antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-blue-100 selection:text-blue-900 dark:selection:bg-blue-900 dark:selection:text-blue-100 min-h-screen">
        <GlobalErrorBoundary>
          <ThemeProvider>
            <SystemInitializer>
              <AppProviders>
                {children}
              </AppProviders>
            </SystemInitializer>
          </ThemeProvider>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}

