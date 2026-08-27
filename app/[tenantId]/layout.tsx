import React from 'react';
import { TenantProvider } from '@/lib/tenant/context';
import { RbacProvider } from '@/lib/auth/rbac-context';
import { TenantShellHeader } from '@/components/tenant/tenant-shell-header';
import { SyncStatusBanner } from '@/components/offline/SyncStatusBanner';

interface TenantLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    tenantId: string;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const resolvedParams = await params;
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';

  return (
    <TenantProvider initialTenantId={tenantId}>
      <RbacProvider>
        <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
          {/* Top Tenant Navigation Bar */}
          <TenantShellHeader />

          {/* Real-Time Clinical PWA Offline & Sync Status Ribbon */}
          <SyncStatusBanner tenantId={tenantId} />

          {/* Dynamic Route Content */}
          <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </RbacProvider>
    </TenantProvider>
  );
}
