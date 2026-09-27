import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { GlobalErrorBoundary } from '@/components/common/GlobalErrorBoundary';
import { SystemInitializer } from '@/components/common/SystemInitializer';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata: Metadata = {
  title: 'G-HIMS OS | Hospital Information System',
  description:
    'Programmable Healthcare + Enterprise Operating System unifying clinical EMR workflows, protocol engines, immutable event store, SAP-style double-entry ERP General Ledger, HCM clinical privileges, diagnostic LIS/RIS, offline-first runtime, and ambient AI intelligence.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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

