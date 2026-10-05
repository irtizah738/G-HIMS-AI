'use client';

import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  Receipt,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import {
  ComprehensiveOpdEncounter,
  OpdInvoice,
  PaymentTransaction,
  PaymentMode,
  PaymentStatus,
} from '@/types/opd-domain';

interface OpdBillingLedgerProps {
  encounter: ComprehensiveOpdEncounter;
  invoice: OpdInvoice;
  canSettlePayment?: boolean;
  onSettlePayment: (payment: PaymentTransaction) => void | Promise<void>;
}

export function OpdBillingLedger({
  encounter,
  invoice,
  canSettlePayment = false,
  onSettlePayment,
}: OpdBillingLedgerProps) {
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentMode>('CASH');
  const [paymentAmount, setPaymentAmount] = useState<number>(
    invoice.balanceDueMinorUnits / 100
  );
  const [transactionRef, setTransactionRef] = useState<string>(
    `TXN-${Date.now().toString().slice(-6)}`
  );
  const [cashierName, setCashierName] = useState<string>('');

  useEffect(() => {
    setPaymentAmount(invoice.balanceDueMinorUnits / 100);
    setTransactionRef(`TXN-${Date.now().toString().slice(-6)}`);
  }, [invoice.id, invoice.balanceDueMinorUnits]);

  const currency = invoice.currency || 'PKR';
  const grossTotal = invoice.totalAmountMinorUnits / 100;
  const payerPortion = invoice.payerCoverageAmountMinorUnits / 100;
  const copayDue = invoice.patientCopayAmountMinorUnits / 100;
  const balanceDue = invoice.balanceDueMinorUnits / 100;

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSettlePayment) {
      alert('The authenticated user is not authorized to collect or settle patient payments.');
      return;
    }

    const payment: PaymentTransaction = {
      id: `pay-${Date.now()}`,
      invoiceId: invoice.id,
      amountMinorUnits: paymentAmount * 100,
      mode: selectedPaymentMode,
      referenceNumber: transactionRef,
      status: 'CAPTURED',
      processedAt: Date.now(),
      processedBy: cashierName,
      glJournalEntryId: '',
    };

    try {
      await onSettlePayment(payment);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Cash settlement failed.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-teal-600" />
              Authoritative Patient Financial Settlement
            </h2>
            <p className="text-xs text-slate-500">
              Invoice #{invoice.invoiceNumber} | Purpose:{' '}
              <strong>{(invoice.billingPurpose || 'FINAL_ENCOUNTER').replace(/_/g, ' ')}</strong>{' '}
              | Tariff: <strong>{invoice.payerTariffPlan.replace(/_/g, ' ')}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                invoice.settlementStatus === 'SETTLED'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {invoice.settlementStatus}
            </span>
          </div>
        </div>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-500">Gross Total Billed</span>
            <p className="text-xl font-black text-slate-900 dark:text-slate-100 mt-1">{currency} {grossTotal.toLocaleString()}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800">
            <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Payer Covered (AR)</span>
            <p className="text-xl font-black text-blue-600 mt-1">{currency} {payerPortion.toLocaleString()}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800">
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Patient Co-Pay Due</span>
            <p className="text-xl font-black text-amber-600 mt-1">{currency} {copayDue.toLocaleString()}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800">
            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Outstanding Balance</span>
            <p className="text-xl font-black text-emerald-600 mt-1">{currency} {balanceDue.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Detailed Itemized Billing Lines */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
            <span>Itemized Billable Encounters & Clinical Ancillaries ({invoice.lineItems.length})</span>
            <span className="text-xs font-mono text-slate-400">Zero Revenue Leakage Enforced</span>
          </h3>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Service / Item</th>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-center">Qty</th>
                  <th className="p-3 text-right">Unit Price</th>
                  <th className="p-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoice.lineItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{item.description}</p>
                      <p className="text-[10px] font-mono text-slate-400">{item.serviceCode}</p>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {item.category}
                      </span>
                    </td>
                    <td className="p-3 text-center font-bold">{item.quantity}</td>
                    <td className="p-3 text-right font-mono">
                      {currency} {(item.unitPriceMinorUnits / 100).toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {currency} {(item.totalMinorUnits / 100).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50/80 dark:bg-slate-800/80 font-bold border-t border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
                <tr>
                  <td colSpan={4} className="p-3 text-right">Total Payable Amount:</td>
                  <td className="p-3 text-right font-mono text-sm text-teal-600">{currency} {grossTotal.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div>
                <p className="font-bold">Server-owned double-entry posting</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  The browser does not calculate or assert ledger accounts. Cash
                  receipt, AR allocation, diagnostic clearance, deferred-revenue
                  handling and journal IDs are committed by the finance command
                  boundary and returned as authoritative evidence.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Payment Collection Ingress */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-teal-600" />
            Cashier Payment Ingress
          </h3>

          <form onSubmit={handleSettle} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Payment Channel / Mode
              </label>
              <select
                value={selectedPaymentMode}
                onChange={(e) => setSelectedPaymentMode(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                <option value="CASH">Cash Over Counter — Offline Capable</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Amount to Collect ({currency})
              </label>
              <input
                type="number"
                min={0.01}
                max={balanceDue}
                step={0.01}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-black text-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Reference / Authorization / Trace #
              </label>
              <input
                type="text"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Cashier display name (optional)
              </label>
              <input
                type="text"
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                placeholder="Authenticated actor identity is server-authoritative"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <button
              type="submit"
              disabled={!canSettlePayment}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              Collect Cash Through Finance Authority
            </button>
          </form>

          {/* Historical Payment Receipts */}
          {invoice.payments.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Captured Receipts ({invoice.payments.length})</span>
              {invoice.payments.map((p) => (
                <div key={p.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  <div className="flex justify-between font-bold">
                    <span>{p.mode.replace(/_/g, ' ')}</span>
                    <span className="text-teal-600 font-mono">{currency} {(p.amountMinorUnits / 100).toLocaleString()}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">Ref: {p.referenceNumber} • JE: {p.glJournalEntryId}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
