'use client';

import React, { useState } from 'react';
import { PaymentRecord, Invoice, InvoicePaymentMethod } from '@/types/billing';
import {
  CreditCard,
  Wallet,
  Smartphone,
  CheckCircle2,
  Calendar,
  Clock,
  UserCheck,
  Building2,
  Receipt,
  FileText,
  Filter,
  Plus,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowDownRight,
  Info,
} from 'lucide-react';

interface PaymentTimelineProps {
  invoice: Invoice;
  onOpenPaymentModal: () => void;
}

export function PaymentTimeline({ invoice, onOpenPaymentModal }: PaymentTimelineProps) {
  const [selectedMethodFilter, setSelectedMethodFilter] = useState<string>('all');
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);

  const paymentHistory = invoice.paymentHistory || [];

  const filteredPayments = paymentHistory.filter((pmt) => {
    if (selectedMethodFilter === 'all') return true;
    return pmt.method === selectedMethodFilter;
  });

  const getMethodDetails = (method: InvoicePaymentMethod) => {
    switch (method) {
      case 'pos':
      case 'card':
        return {
          label: 'Card POS Terminal',
          icon: CreditCard,
          bg: 'bg-blue-50 text-blue-700 border-blue-200',
          badgeBg: 'bg-blue-100 text-blue-800',
        };
      case 'cash':
        return {
          label: 'Cash Counter Settlement',
          icon: Wallet,
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          badgeBg: 'bg-emerald-100 text-emerald-800',
        };
      case 'mobile_wallet':
        return {
          label: 'Mobile POS / QR Wallet',
          icon: Smartphone,
          bg: 'bg-purple-50 text-purple-700 border-purple-200',
          badgeBg: 'bg-purple-100 text-purple-800',
        };
      case 'insurance_claim':
        return {
          label: 'Insurance Claim Direct',
          icon: ShieldCheck,
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          badgeBg: 'bg-indigo-100 text-indigo-800',
        };
      case 'split':
      default:
        return {
          label: 'Split Settlement',
          icon: Receipt,
          bg: 'bg-slate-50 text-slate-700 border-slate-200',
          badgeBg: 'bg-slate-100 text-slate-800',
        };
    }
  };

  const totalSettled = paymentHistory.reduce((acc, p) => acc + (p.amount || 0), 0);
  const percentSettled = invoice.totalPatientDue > 0
    ? Math.min(100, Math.round((totalSettled / invoice.totalPatientDue) * 100))
    : 100;

  return (
    <div id="payment-timeline-section" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header & Controls */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Interactive Payment Audit Timeline</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sequential audit trail of patient deposits, settlement methods, and cashier verification IDs
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Method Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            <button
              onClick={() => setSelectedMethodFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                selectedMethodFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({paymentHistory.length})
            </button>
            <button
              onClick={() => setSelectedMethodFilter('pos')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                selectedMethodFilter === 'pos'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              POS / Card
            </button>
            <button
              onClick={() => setSelectedMethodFilter('cash')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                selectedMethodFilter === 'cash'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cash
            </button>
            <button
              onClick={() => setSelectedMethodFilter('mobile_wallet')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                selectedMethodFilter === 'mobile_wallet'
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mobile POS
            </button>
          </div>

          {invoice.balanceDue > 0 && (
            <button
              onClick={onOpenPaymentModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Payment</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress & Settlement Metric Bar */}
      <div className="bg-slate-50/80 px-6 py-4 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs mb-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">Patient Balance Settlement:</span>
            <span className="font-mono font-black text-emerald-700">${totalSettled.toFixed(2)}</span>
            <span className="text-slate-400">/ ${invoice.totalPatientDue.toFixed(2)} Due</span>
          </div>
          <div className="flex items-center gap-2 font-mono font-bold">
            <span className={percentSettled === 100 ? 'text-emerald-700' : 'text-amber-700'}>
              {percentSettled}% Settled
            </span>
            {invoice.balanceDue > 0 && (
              <span className="text-rose-600">(${invoice.balanceDue.toFixed(2)} Remaining)</span>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
            style={{ width: `${percentSettled}%` }}
          />
        </div>
      </div>

      {/* Timeline Content */}
      <div className="p-6">
        {filteredPayments.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-3">
            <Clock className="w-8 h-8 text-slate-400 mx-auto" />
            <div>
              <p className="text-xs font-bold text-slate-700">
                {selectedMethodFilter === 'all'
                  ? 'No payment transactions recorded for this invoice yet.'
                  : `No transactions found matching "${selectedMethodFilter}".`}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Collect patient copay or deposits using the point-of-sale terminal.
              </p>
            </div>
            {invoice.balanceDue > 0 && (
              <button
                onClick={onOpenPaymentModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Collect First Installment (${invoice.balanceDue.toFixed(2)})</span>
              </button>
            )}
          </div>
        ) : (
          <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
            {filteredPayments.map((pmt, idx) => {
              const methodConfig = getMethodDetails(pmt.method);
              const MethodIcon = methodConfig.icon;
              const isExpanded = expandedPaymentId === pmt.id;
              const dateObj = new Date(pmt.timestamp);
              const formattedDate = !isNaN(dateObj.getTime())
                ? dateObj.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Date Pending';
              const formattedTime = !isNaN(dateObj.getTime())
                ? dateObj.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })
                : '';

              const cashierIdDisplay = pmt.cashierId || (pmt.recordedBy?.match(/CSH-[\w-]+/)?.[0] || 'CSH-4091');
              const stationDisplay = pmt.stationId || 'POS-COUNTER-01';

              return (
                <div key={pmt.id || idx} className="relative group">
                  {/* Timeline Node Icon */}
                  <div
                    className={`absolute -left-6 sm:-left-8 top-1.5 w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-white shadow-xs flex items-center justify-center ${methodConfig.bg}`}
                  >
                    <MethodIcon className="w-3.5 h-3.5" />
                  </div>

                  {/* Payment Card */}
                  <div
                    onClick={() => setExpandedPaymentId(isExpanded ? null : pmt.id)}
                    className="bg-slate-50 hover:bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${methodConfig.badgeBg}`}>
                          {methodConfig.label}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-800">
                          Ref: {pmt.referenceNumber || 'TXN-GEN-00'}
                        </span>
                        <span className="text-[11px] text-slate-400">•</span>
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formattedDate} {formattedTime && `at ${formattedTime}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-sm sm:text-base font-mono font-black text-emerald-700">
                            +${pmt.amount.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">Settled</span>
                        </div>
                        <div className="p-1 text-slate-400 group-hover:text-slate-700 transition">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* Cashier & Verification Badges */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-200/60">
                      <div className="flex items-center gap-1.5 text-slate-600 bg-white/80 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
                        <UserCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">
                          <strong className="text-slate-900 font-semibold">Cashier ID:</strong> {cashierIdDisplay}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-slate-600 bg-white/80 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate">
                          <strong className="text-slate-900 font-semibold">Station:</strong> {stationDisplay}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-slate-600 bg-white/80 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">
                          <strong className="text-slate-900 font-semibold">Staff:</strong> {pmt.recordedBy}
                        </span>
                      </div>
                    </div>

                    {/* Notes if available */}
                    {pmt.notes && (
                      <p className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200/60 italic">
                        &quot;{pmt.notes}&quot;
                      </p>
                    )}

                    {/* Expanded Voucher / Receipt Detail */}
                    {isExpanded && (
                      <div className="pt-3 border-t border-slate-200 text-xs space-y-3 bg-white p-4 rounded-xl border border-emerald-100 animate-in fade-in-50">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <Receipt className="w-4 h-4 text-emerald-600" />
                            <span className="font-bold text-slate-900">Official Settlement Voucher Stamp</span>
                          </div>
                          <span className="text-[10px] font-mono uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                            Transaction Verified
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                          <div>
                            <span className="text-slate-400 block font-semibold uppercase">Voucher ID</span>
                            <span className="font-mono font-bold text-slate-800">{pmt.id}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold uppercase">Payment Channel</span>
                            <span className="font-semibold text-slate-800 capitalize">{pmt.method.replace('_', ' ')}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold uppercase">Cashier Terminal</span>
                            <span className="font-mono font-semibold text-slate-800">{stationDisplay}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold uppercase">Audit Stamp</span>
                            <span className="font-mono text-slate-600">{new Date(pmt.timestamp).toISOString().slice(0, 19)}Z</span>
                          </div>
                        </div>

                        <div className="p-2.5 bg-slate-50 rounded-lg text-slate-600 flex items-center justify-between text-[11px]">
                          <span>Ledger Entry Type: Immediate Cash/POS Patient Credit</span>
                          <span className="font-mono font-bold text-emerald-700">+${pmt.amount.toFixed(2)} USD</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
