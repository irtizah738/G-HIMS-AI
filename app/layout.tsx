import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { GlobalErrorBoundary } from '@/components/common/GlobalErrorBoundary';
import { SystemInitializer } from '@/components/common/SystemInitializer';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata: Metadata = {
  title: 'G-HIMS OS | Generative Healthcare Information Management System',
  description: 'Hospital Management, Bed Occupancy, Billing, Staff Schedules, LIS, EHR & AI Copilot',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('ghims_theme');
                  var isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches) || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                    document.documentElement.setAttribute('data-theme', 'dark');
                    document.documentElement.setAttribute('data-mode', 'dark');
                    document.documentElement.style.colorScheme = 'dark';
                  } else {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.setAttribute('data-theme', 'light');
                    document.documentElement.setAttribute('data-mode', 'light');
                    document.documentElement.style.colorScheme = 'light';
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
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

