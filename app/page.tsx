'use client';

import React from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { TenantDashboard } from '@/components/tenant-dashboard';
import { ClinicalIntelligenceLanding } from '@/components/marketing/clinical-intelligence-landing';

/**
 * The public URL is the official website for visitors.
 * Existing authenticated sessions retain the original clinical dashboard,
 * including its AuthGuard and offline-continuity restrictions.
 *
 * Initial SSR markup is public and contains no patient or tenant data.
 * A restored session switches to the guarded workspace on hydration.
 */
export default function HomePage() {
  const { user } = useAuth();

  if (!user) {
    return <ClinicalIntelligenceLanding />;
  }

  return (
    <AuthGuard>
      <TenantDashboard />
    </AuthGuard>
  );
}
