'use client';

import React, { use } from 'react';
import { SupplyChainScmView } from '@/components/views/supply-chain-scm-view';
import { CollapsibleSidebar } from '@/components/navigation/collapsible-sidebar';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { HeartPulse, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function SCMPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'metro-health';

  return (
    <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 shadow-xs">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/`}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Return to Main Operations Command"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs">
                <HeartPulse className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm tracking-tight">
                    G-HIMS SCM
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold">
                    Enterprise
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Hospital Supply Chain, Procurement & Inventory OS
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        <SupplyChainScmView tenantId={tenantId} />
      </main>
    </div>
  );
}
