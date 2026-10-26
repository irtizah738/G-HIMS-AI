'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ClinicalIntelligenceLanding } from '@/components/marketing/clinical-intelligence-landing';

// Keep the large clinical application out of the anonymous marketing bundle.
const TenantDashboard = dynamic(
  () => import('@/components/tenant-dashboard').then((module) => module.TenantDashboard),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-sm font-medium text-slate-200">
        Opening your hospital workspace…
      </div>
    ),
  }
);

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
