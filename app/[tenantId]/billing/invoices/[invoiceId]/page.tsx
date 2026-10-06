'use client';

import React, { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { hydrateEdgeSnapshot } from '@/lib/offline/hydration';
import {
  buildBillingInvoiceReadModel,
  type AuthoritativeBillingInvoice,
} from '@/lib/billing/authoritative-read-model';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

interface PageProps {
  params: Promise<{
    tenantId: string;
    invoiceId: string;
  }>;
}

function money(value: number, currency: string) {
  return `${currency} ${formatCurrency(value).replace(/^[^\d-]*/, '')}`;
}

export default function InvoicePosTerminalPage({ params }: PageProps) {
  const resolved = use(params);
  const tenantId = String(resolved.tenantId || '').trim().toLowerCase();
  const invoiceId = String(resolved.invoiceId || '').trim();

  const [invoice, setInvoice] =
    useState<AuthoritativeBillingInvoice | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<
    'SERVER' | 'LOCAL' | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');

  const refresh = useCallback(async () => {
    if (!tenantId || !invoiceId) {
      setInvoice(null);
      setSnapshotSource(null);
      setError('BILLING_INVOICE_ROUTE_INVALID');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const snapshot = await hydrateEdgeSnapshot(tenantId);
      const model = buildBillingInvoiceReadModel(snapshot);
      setSnapshotSource(model.source);
      const nextInvoice =
        model.invoices.find((candidate) => candidate.id === invoiceId) || null;
      if (!nextInvoice) {
        throw new Error(
          'BILLING_INVOICE_NOT_AUTHORIZED_OR_NOT_FOUND: the requested invoice is outside this session scope or no longer exists.'
        );
      }
      setInvoice(nextInvoice);
      setAmount(
        nextInvoice.balanceDue > 0
          ? nextInvoice.balanceDue.toFixed(2)
          : '0.00'
      );
    } catch (cause) {
      setInvoice(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to hydrate authoritative invoice.'
      );
    } finally {
      setLoading(false);
    }
  }, [invoiceId, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const amountMinorUnits = useMemo(() => {
    const numeric = Number(amount);
    const minor = Math.round(numeric * 100);
    return Number.isFinite(numeric) && Number.isSafeInteger(minor)
      ? minor
      : 0;
  }, [amount]);

  const balanceMinorUnits = invoice
    ? Math.round(invoice.balanceDue * 100)
    : 0;

  const collectCash = async () => {
    if (!invoice) return;
    if (snapshotSource !== 'SERVER') {
      setError(
        'BILLING_SERVER_SNAPSHOT_REQUIRED: cash collection is disabled while the financial read model is offline or cached.'
      );
      return;
    }
    if (invoice.paymentStatus === 'paid' || balanceMinorUnits <= 0) {
      setError('INVOICE_ALREADY_SETTLED');
      return;
    }
    if (amountMinorUnits <= 0 || amountMinorUnits > balanceMinorUnits) {
      setError(
        'INVALID_PAYMENT_AMOUNT: cash amount must be positive and cannot exceed the authoritative balance.'
      );
      return;
    }

    setCollecting(true);
    setError(null);
    setSuccess(null);
    try {
      const receiptId = `receipt_${crypto.randomUUID()}`;
      const result = await executeActiveTenantCommand<{
        receipt?: { receiptId?: string; journalId?: string };
        invoice?: Record<string, unknown>;
      }>(
        'RecordCashReceiptCommand',
        {
          receiptId,
          invoiceId: invoice.id,
          encounterId: invoice.encounterId,
          patientId: invoice.patientId,
          amountMinorUnits,
          currency: invoice.currency,
          ...(referenceNumber.trim()
            ? { referenceNumber: referenceNumber.trim() }
            : {}),
          collectedAt: Date.now(),
        },
        {
          idempotencyKey: `billing-pos-cash:${receiptId}`,
        }
      );

      if (!result.success) {
        throw new Error(
          result.error?.message || 'Cash receipt command was rejected.'
        );
      }

      setSuccess(
        `Cash receipt ${result.data?.receipt?.receiptId || receiptId} was committed by the finance authority.`
      );
      setReferenceNumber('');
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to commit authoritative cash receipt.'
      );
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <Link
            href={`/${encodeURIComponent(tenantId)}/billing/invoices`}
            className="rounded-xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold">
              <Receipt className="h-4 w-4 text-blue-600" />
              {invoice
                ? `Invoice ${invoice.invoiceNumber}`
                : 'Authoritative Invoice'}
            </h1>
            <p className="mt-1 text-[11px] text-slate-500">
              Read from the authenticated billing projection. Cash settlement is
              committed only through the server finance command boundary.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || collecting}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50 dark:border-slate-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Loading authoritative invoice…
        </div>
      ) : invoice ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-black text-blue-600">
                    {invoice.invoiceNumber}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {invoice.patientName} · {invoice.mrn} ·{' '}
                    {invoice.encounterId}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  {invoice.billingPurpose || 'SERVER INVOICE'} · {snapshotSource || 'UNKNOWN'}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2.5">Code</th>
                      <th className="px-3 py-2.5">Description</th>
                      <th className="px-3 py-2.5 text-right">Qty</th>
                      <th className="px-3 py-2.5 text-right">Patient</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {invoice.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-mono text-[10px]">
                          {item.code}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold">{item.description}</div>
                          <div className="mt-0.5 text-[10px] uppercase text-slate-400">
                            {item.entitySource}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-3 text-right font-bold">
                          {money(item.patientPortion, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">
                    Gross
                  </div>
                  <div className="font-bold">
                    {money(invoice.totalGross, invoice.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">
                    Patient due
                  </div>
                  <div className="font-bold">
                    {money(invoice.totalPatientDue, invoice.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">
                    Paid
                  </div>
                  <div className="font-bold text-emerald-700">
                    {money(invoice.totalPaid, invoice.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">
                    Balance
                  </div>
                  <div className="font-black text-rose-700">
                    {money(invoice.balanceDue, invoice.currency)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Banknote className="h-4 w-4 text-emerald-600" />
                Governed Cash Collection
              </h2>
              <p className="text-[11px] leading-relaxed text-slate-500">
                The controlled pilot supports cash settlement here. Card,
                wallet, insurance and ad-hoc charge mutations remain disabled
                until their own server authorities are qualified.
              </p>
              {snapshotSource !== 'SERVER' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
                  Cached billing data is view-only. Reconnect and refresh a
                  server snapshot before collecting money.
                </div>
              )}

              {invoice.balanceDue > 0 ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold">
                      Amount ({invoice.currency})
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      max={invoice.balanceDue}
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold">
                      Cash reference (optional)
                    </label>
                    <input
                      value={referenceNumber}
                      onChange={(event) =>
                        setReferenceNumber(event.target.value)
                      }
                      maxLength={150}
                      placeholder="Receipt / till reference"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void collectCash()}
                    disabled={
                      collecting ||
                      amountMinorUnits <= 0 ||
                      snapshotSource !== 'SERVER'
                    }
                    className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {collecting
                      ? 'Committing receipt…'
                      : 'Collect cash through finance authority'}
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Invoice has no outstanding patient balance.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
