'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SettingsView } from '@/components/views/settings-view';
import { AuthGuard } from '@/components/auth/auth-guard';
import { HeaderProfileMenu } from '@/components/auth/header-profile-menu';
import { SyncStatusIndicator } from '@/components/navigation/sync-status-indicator';
import { HeartPulse, ChevronLeft, Building2 } from 'lucide-react';
import { useTenant } from '@/lib/tenant/context';

export default function TenantSettingsPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'central-metro-hospital';
  const { currentTenant } = useTenant();

  return (
    <AuthGuard requiredTenantId={tenantId}>
      <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
        {/* Top App Header */}
        <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            {/* Left Brand + Back Navigation */}
            <div className="flex items-center gap-3">
              <Link
                href={`/${tenantId}`}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 text-xs font-bold"
                title="Return to Hospital Hub"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Hospital</span>
              </Link>

              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
                  <HeartPulse className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-slate-900 dark:text-white text-sm">G-HIMS OS</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      Settings
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium truncate max-w-[200px]">
                    {currentTenant?.name || tenantId}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Action Tools: Sync Status & Profile Menu */}
            <div className="flex items-center gap-2.5">
              <SyncStatusIndicator />
              <HeaderProfileMenu tenantId={tenantId} />
            </div>
          </div>
        </header>

        {/* Main Settings Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
          <SettingsView />
        </main>
      </div>
    </AuthGuard>
  );
}
