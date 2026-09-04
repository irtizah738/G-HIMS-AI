'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { HrManagementView } from '@/components/views/hr-management-view';
import { ResourceCapacityView } from '@/components/views/resource-capacity-view';
import { Users, Boxes, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function HcmMasterPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';
  const [activeModule, setActiveModule] = useState<'workforce' | 'resources'>('workforce');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header & Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <span className="text-[11px] font-mono text-blue-600 uppercase font-bold tracking-wider">
                G-HIMS OS • Human Capital & Operations
              </span>
              <h1 className="text-lg font-black text-slate-900 dark:text-slate-100">
                Hospital Workforce & Resource Management
              </h1>
            </div>
          </div>

          <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setActiveModule('workforce')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeModule === 'workforce'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Workforce & HR (9 Modules)</span>
            </button>
            <button
              onClick={() => setActiveModule('resources')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeModule === 'resources'
                  ? 'bg-white dark:bg-slate-900 text-purple-600 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Resource & Capacity (7 Modules)</span>
            </button>
          </div>
        </div>

        {/* Active Module View */}
        {activeModule === 'workforce' ? <HrManagementView /> : <ResourceCapacityView />}
      </div>
    </div>
  );
}
