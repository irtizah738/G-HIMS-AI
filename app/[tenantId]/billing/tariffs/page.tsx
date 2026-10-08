'use client';

import React, { use, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { executeCommand } from '@/lib/api/command-client';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

export default function BillingTariffAuthorityPage({ params }: PageProps) {
  const { tenantId: routeTenantId } = use(params);
  const tenantId = String(routeTenantId || '').trim().toLowerCase();
  const auth = useAuth();

  const [serviceCode, setServiceCode] = useState('OPD-CONSULT');
  const [description, setDescription] = useState('Standard OPD Consultation');
  const [currency, setCurrency] = useState('PKR');
  const [priceMajor, setPriceMajor] = useState('');
  const [taxPercent, setTaxPercent] = useState('0');
  const [revenueAccountCode, setRevenueAccountCode] = useState('4010');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canConfigure = useMemo(() => {
    const roles = new Set((auth.roles || []).map((role) => role.toUpperCase()));
    return (
      roles.has('BILLING_ADMIN') ||
      roles.has('FINANCE_MANAGER') ||
      roles.has('SYSTEM_ADMIN') ||
      roles.has('ADMINISTRATOR')
    );
  }, [auth.roles]);

  const handleConfigure = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!canConfigure) {
      setError('Your authenticated role is not authorized to configure patient billing.');
      return;
    }
    if (auth.activeTenant?.tenantId !== tenantId) {
      setError('Switch to this tenant before changing its billing configuration.');
      return;
    }

    const major = Number(priceMajor);
    const unitPriceMinorUnits = Math.round(major * 100);
    const taxRateBasisPoints = Math.round(Number(taxPercent) * 100);

    if (!Number.isFinite(major) || major <= 0 || !Number.isSafeInteger(unitPriceMinorUnits)) {
      setError('Enter a valid positive consultation price.');
      return;
    }
    if (
      !Number.isFinite(Number(taxPercent)) ||
      !Number.isInteger(taxRateBasisPoints) ||
      taxRateBasisPoints < 0 ||
      taxRateBasisPoints > 10_000
    ) {
      setError('Tax must be between 0% and 100%.');
      return;
    }

    setBusy(true);
    try {
      const result = await executeCommand({
        tenantId,
        commandType: 'ConfigureOpdConsultationBillingCommand',
        payload: {
          serviceCode: serviceCode.trim(),
          description: description.trim(),
          currency: currency.trim().toUpperCase(),
          unitPriceMinorUnits,
          taxRateBasisPoints,
          revenueAccountCode: revenueAccountCode.trim(),
        },
      });

      if (!result.success) {
        throw new Error(result.error?.message || 'Billing configuration failed.');
      }

      setSuccess(
        'OPD consultation service and standard cash tariff are now configured. New registrations can create the authoritative consultation invoice.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing configuration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Governed server-authoritative billing configuration
              </span>
            </div>
            <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">
              OPD Consultation Billing
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Configure the tenant-owned consultation service used by registration.
              The browser submits a governed command; price, tariff, audit event and
              finance validation are committed on the server.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-black">Required before OPD registration billing can complete</p>
            <p className="mt-2 leading-relaxed">
              Registration creates a consultation invoice immediately. G-HIMS therefore
              refuses to invent a price, currency, tax rate or revenue account. Configure
              those values once for this tenant before retrying registration.
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleConfigure}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold">
            <span>Service code</span>
            <input
              value={serviceCode}
              onChange={(event) => setServiceCode(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-700"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold">
            <span>Currency</span>
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
              maxLength={3}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 font-mono uppercase dark:border-slate-700"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-700"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold">
            <span>Consultation price</span>
            <input
              data-testid="opd-consultation-config-price"
              value={priceMajor}
              onChange={(event) => setPriceMajor(event.target.value)}
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="e.g. 1500"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 font-mono dark:border-slate-700"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold">
            <span>Tax rate (%)</span>
            <input
              value={taxPercent}
              onChange={(event) => setTaxPercent(event.target.value)}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 font-mono dark:border-slate-700"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">
            <span>Revenue account code</span>
            <input
              value={revenueAccountCode}
              onChange={(event) => setRevenueAccountCode(event.target.value)}
              required
              placeholder="4010"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 font-mono dark:border-slate-700"
            />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          The server will reject the command unless the revenue account is uniquely
          active and currency-compatible, Accounts Receivable account 1110 is active,
          output-tax account 2040 exists when tax is non-zero, and the current finance
          period is OPEN or SOFT_CLOSE.
        </div>

        {error && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {success}
          </div>
        )}

        <button
          data-testid="opd-consultation-config-submit"
          type="submit"
          disabled={!canConfigure || busy || auth.loading}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {busy ? 'Validating & committing…' : 'Commit governed billing configuration'}
        </button>

        {!canConfigure && !auth.loading && (
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            A Billing Admin, Finance Manager, System Admin or Administrator role is required.
          </p>
        )}
      </form>

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
