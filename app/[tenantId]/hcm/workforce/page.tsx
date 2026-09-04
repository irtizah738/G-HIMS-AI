'use client';

import React from 'react';
import { HrManagementView } from '@/components/views/hr-management-view';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function WorkforceMasterPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <span className="text-[11px] font-mono text-blue-600 uppercase font-bold tracking-wider">
              G-HIMS OS • Hospital Human Capital Management
            </span>
            <h1 className="text-lg font-black text-slate-900 dark:text-slate-100">
              Workforce, Credentialing & Rostering Operating System
            </h1>
          </div>
        </div>

        <HrManagementView />
      </div>
    </div>
  );
}
