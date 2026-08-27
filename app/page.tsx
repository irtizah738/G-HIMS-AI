'use client';

import React from 'react';
import { TenantDashboard } from '@/components/tenant-dashboard';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function HomePage() {
  return (
    <AuthGuard>
      <TenantDashboard />
    </AuthGuard>
  );
}

