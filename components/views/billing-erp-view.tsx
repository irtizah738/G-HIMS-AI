'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  FileWarning,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { useTenant } from '@/lib/tenant/context';

export function BillingErpView() {
  const { tenantId, isLoading, error } = useTenant();
  const scopedTenantId = String(tenantId || '').trim();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        Loading authorized billing workspace…
      </div>
    );
  }

  if (!scopedTenantId || error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold">Billing tenant scope unavailable</div>
            <p className="mt-1 text-xs">
              Billing remains fail-closed until an authenticated tenant context is available.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tenantPath = `/${encodeURIComponent(scopedTenantId)}/billing`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-slate-100">
              Billing & Revenue Integrity
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              This workspace does not calculate charges, create invoices, simulate payer outcomes,
              or invent recovery metrics in the browser. Financial authority remains in governed
              server commands and tenant-scoped billing projections.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link
          href={`${tenantPath}/invoices`}
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
            <Receipt className="h-4 w-4 text-blue-600" />
            Authoritative invoices
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Review tenant-scoped invoices and collect supported cash payments through the governed finance command boundary.
          </p>
          <div className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-700">
            Open invoices <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>

        <Link
          href={`${tenantPath}/tariffs`}
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-amber-300 hover:bg-amber-50/40 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
            <FileWarning className="h-4 w-4 text-amber-600" />
            Tariff administration
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Production tariff mutation remains fail-closed until a governed server authority is qualified.
          </p>
          <div className="mt-4 flex items-center gap-1 text-xs font-bold text-amber-700">
            View boundary <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>

        <Link
          href={`${tenantPath}/claims`}
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
            <FileWarning className="h-4 w-4 text-slate-600" />
            Insurance / EDI
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Claims and clearinghouse workflows remain disabled until payer and EDI authorities are qualified end to end.
          </p>
          <div className="mt-4 flex items-center gap-1 text-xs font-bold text-slate-700">
            View boundary <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>
      </div>
    </div>
  );
}
