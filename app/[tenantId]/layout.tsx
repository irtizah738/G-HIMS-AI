import React from 'react';
import { TenantProvider } from '@/lib/tenant/context';
import { RbacProvider } from '@/lib/auth/rbac-context';
import { TenantShellHeader } from '@/components/tenant/tenant-shell-header';
import { TenantRouteAuthorityGuard } from '@/components/tenant/tenant-route-authority-guard';
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
      <TenantRouteAuthorityGuard routeTenantId={tenantId}>
      <RbacProvider>
        <div data-ghims-shell="tenant" className="min-h-dvh min-w-0 bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
          {/* Top Tenant Navigation Bar */}
          <TenantShellHeader />

          {/* Real-Time Clinical PWA Offline & Sync Status Ribbon */}
          <SyncStatusBanner tenantId={tenantId} />

          {/* Dynamic Route Content */}
          <main id="tenant-main-content" className="flex-1 w-full min-w-0 max-w-[1600px] mx-auto px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
            {children}
          </main>
        </div>
      </RbacProvider>
      </TenantRouteAuthorityGuard>
    </TenantProvider>
  );
}
