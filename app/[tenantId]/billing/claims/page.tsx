'use client';

import React, { use } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

export default function BillingAuthorityUnavailablePage({ params }: PageProps) {
  const { tenantId: routeTenantId } = use(params);
  const tenantId = String(routeTenantId || '').trim().toLowerCase();

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-amber-50 p-3 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Fail-closed production boundary
              </span>
            </div>
            <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">
              Insurance Claims / EDI Is Not Enabled
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              The controlled pilot does not implement external 837/835 claims submission or payer adjudication. No synthetic claims, EDI payloads or simulated clearinghouse success are shown here.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-black">Why this action is disabled</p>
            <p className="mt-2 leading-relaxed">Claims will remain fail-closed until payer eligibility, preauthorization, claim construction, clearinghouse transport, remittance posting, denial handling and audit evidence are qualified end to end.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/${encodeURIComponent(tenantId)}/billing/invoices`}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Authoritative invoices
        </Link>
        <Link
          href={`/${encodeURIComponent(tenantId)}`}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
        >
          Hospital workspace
        </Link>
      </div>
    </div>
  );
}
