'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { GhimHome } from '@/components/marketing/ghims-pages';

// Anonymous visitors see the public corporate website; existing authenticated
// hospital staff retain the guarded clinical dashboard, not a marketing portal.
const TenantDashboard = dynamic(
  () => import('@/components/tenant-dashboard').then(module => module.TenantDashboard),
  {
    ssr: false,
    loading: () => <div role="status" className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-sm text-slate-200">Opening your hospital workspace…</div>,
  }
);

export default function HomePage() {
  const { user } = useAuth();
  if (!user) return <GhimHome />;
  return <AuthGuard><TenantDashboard /></AuthGuard>;
}
