'use client';

import React, { use } from 'react';
import { TenantDashboard } from '@/components/tenant-dashboard';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function TenantDashboardPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';

  return (
    <AuthGuard requiredTenantId={tenantId}>
      <TenantDashboard />
    </AuthGuard>
  );
}
