'use client';

import React, { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { Invoice, InvoicePaymentStatus } from '@/types/billing';
import { formatCurrency } from '@/lib/utils';
import { hydrateEdgeSnapshot } from '@/lib/offline/hydration';
import {
  buildBillingInvoiceReadModel,
  type BillingInvoiceReadModel,
} from '@/lib/billing/authoritative-read-model';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

function statusBadge(status: InvoicePaymentStatus) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        Settled
      </span>
    );
  }
  if (status === 'partially_paid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
        <Clock className="h-3 w-3" />
        Partially paid
      </span>
    );
  }
  if (status === 'waived') {
    return (
      <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
        Waived
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-800">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  );
}

export default function InvoicesDirectoryPage({ params }: PageProps) {
  const { tenantId: routeTenantId } = use(params);
  const tenantId = String(routeTenantId || '').trim().toLowerCase();
  const [model, setModel] = useState<BillingInvoiceReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoicePaymentStatus>(
    'all'
  );

  const refresh = async () => {
    if (!tenantId) {
      setError('BILLING_TENANT_REQUIRED');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const snapshot = await hydrateEdgeSnapshot(tenantId);
      setModel(buildBillingInvoiceReadModel(snapshot));
    } catch (cause) {
      setModel(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to hydrate authoritative billing invoices.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const invoices = model?.invoices || [];
  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const searchMatch =
        !query ||
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        invoice.patientName.toLowerCase().includes(query) ||
        invoice.mrn.toLowerCase().includes(query) ||
        invoice.encounterId.toLowerCase().includes(query);
      const statusMatch =
        statusFilter === 'all' || invoice.paymentStatus === statusFilter;
      return searchMatch && statusMatch;
    });
  }, [invoices, search, statusFilter]);

  const outstanding = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.balanceDue || 0),
    0
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">
                Authoritative Billing Invoices
              </h1>
            </div>
            <p className="max-w-2xl text-xs text-slate-500">
              This directory is hydrated from the authenticated tenant billing
              projection. Invoice creation, charge posting and settlement are
              server-owned command workflows; this page never creates financial
              records locally.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Scoped invoices
            </div>
            <div className="mt-1 text-xl font-black">{invoices.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Outstanding patient balance
            </div>
            <div className="mt-1 text-xl font-black">
              {formatCurrency(outstanding)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <ShieldCheck className="h-3 w-3 text-emerald-600" />
              Projection source
            </div>
            <div className="mt-1 text-sm font-bold">
              {model?.source || (loading ? 'LOADING' : 'UNAVAILABLE')}
            </div>
            <div className="mt-1 truncate font-mono text-[9px] text-slate-400">
              {model?.snapshotVersion || '—'}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Billing hydration failed closed.</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}

      {model && model.rejectedRows > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {model.rejectedRows} malformed or cross-tenant invoice row(s) were
            excluded from this financial read model.
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row dark:border-slate-800">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invoice, patient, MRN or encounter"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as 'all' | InvoicePaymentStatus
              )
            }
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="waived">Waived</option>
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Loading authoritative invoice projection…
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No authorized invoices are available for this tenant/session scope.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Encounter</th>
                  <th className="px-4 py-3 text-right">Patient due</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInvoices.map((invoice: Invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-blue-600">
                        {invoice.invoiceNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{invoice.patientName}</div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {invoice.mrn}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                      {invoice.encounterId}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatCurrency(invoice.totalPatientDue)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-rose-600">
                      {formatCurrency(invoice.balanceDue)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {statusBadge(invoice.paymentStatus)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/${encodeURIComponent(
                          tenantId
                        )}/billing/invoices/${encodeURIComponent(invoice.id)}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700 hover:bg-blue-100"
                      >
                        View
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
