'use client';

import React, { useState } from 'react';
import { Invoice } from '@/types/billing';
import {
  Printer,
  X,
  FileCheck2,
  Receipt,
  User,
  Calendar,
  Building2,
  DollarSign,
  CreditCard,
  Layers,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';

interface BulkReceiptsModalProps {
  invoices: Invoice[];
  onClose: () => void;
}

export function BulkReceiptsModal({ invoices, onClose }: BulkReceiptsModalProps) {
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'all_pages' | 'single_pager'>('all_pages');

  if (!invoices || invoices.length === 0) {
    return null;
  }

  const handlePrint = () => {
    window.print();
  };

  const totalBatchGross = invoices.reduce((acc, inv) => acc + (inv.totalGross || 0), 0);
  const totalBatchCoverage = invoices.reduce((acc, inv) => acc + (inv.totalCoverage || 0), 0);
  const totalBatchPatientDue = invoices.reduce((acc, inv) => acc + (inv.totalPatientDue || 0), 0);
  const totalBatchPaid = invoices.reduce((acc, inv) => acc + (inv.totalPaid || 0), 0);
  const totalBatchBalance = invoices.reduce((acc, inv) => acc + (inv.balanceDue || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-4 flex flex-col max-h-[94vh]">
        {/* Top Modal Bar (Hidden in Print) */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-xl text-white shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Bulk Patient Receipts Printing Terminal</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-slate-950">
                  {invoices.length} Receipts Selected
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Simultaneous batch layout with auto-pagination and official audit stamps
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl shadow-xs transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print All ({invoices.length}) Receipts</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Batch Overview Summary Strip (Hidden in Print) */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0 print:hidden">
          <div className="flex items-center gap-4 text-slate-700 font-medium">
            <span>
              Batch Gross: <strong className="font-mono text-slate-900">${totalBatchGross.toFixed(2)}</strong>
            </span>
            <span>•</span>
            <span>
              Payer Coverage: <strong className="font-mono text-blue-700">${totalBatchCoverage.toFixed(2)}</strong>
            </span>
            <span>•</span>
            <span>
              Patient Due: <strong className="font-mono text-emerald-700">${totalBatchPatientDue.toFixed(2)}</strong>
            </span>
            <span>•</span>
            <span>
              Total Collected: <strong className="font-mono text-emerald-800">${totalBatchPaid.toFixed(2)}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'all_pages' ? 'single_pager' : 'all_pages')}
              className="px-3 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 transition text-[11px]"
            >
              {viewMode === 'all_pages' ? 'View One by One' : 'View Continuous Document'}
            </button>

            {viewMode === 'single_pager' && (
              <div className="flex items-center gap-1">
                <button
                  disabled={activePreviewIndex === 0}
                  onClick={() => setActivePreviewIndex((prev) => Math.max(0, prev - 1))}
                  className="p-1 bg-white border border-slate-300 rounded disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono font-bold text-slate-800 px-2">
                  {activePreviewIndex + 1} of {invoices.length}
                </span>
                <button
                  disabled={activePreviewIndex === invoices.length - 1}
                  onClick={() => setActivePreviewIndex((prev) => Math.min(invoices.length - 1, prev + 1))}
                  className="p-1 bg-white border border-slate-300 rounded disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Printable Area */}
        <div
          id="bulk-receipts-printable-container"
          className="p-6 sm:p-8 overflow-y-auto space-y-12 flex-1 bg-slate-50 print:bg-white print:p-0 print:m-0 print:space-y-0"
        >
          {invoices
            .filter((_, idx) => (viewMode === 'all_pages' ? true : idx === activePreviewIndex))
            .map((inv, index) => {
              const paymentList = inv.paymentHistory || [];
              const latestPayment = paymentList[paymentList.length - 1];

              return (
                <div
                  key={inv.id}
                  className="bg-white p-8 rounded-2xl border border-slate-300 shadow-md print:shadow-none print:border-0 print:p-8 max-w-2xl mx-auto space-y-6 break-after-page page-break-after-always"
                  style={{ pageBreakAfter: 'always', breakAfter: 'page' }}
                >
                  {/* Hospital Official Header */}
                  <div className="text-center border-b-2 border-slate-900 pb-5 space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-700" />
                      <h1 className="text-xl font-black text-slate-900 tracking-tight uppercase">
                        METRO HEALTHCARE SYSTEMS
                      </h1>
                    </div>
                    <p className="text-xs text-slate-600 font-medium">
                      Tertiary Care Teaching Hospital & Clinical Research Center
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Plot 42 Medical District, Sector G-8 • Tax NTN: 8839210-9 • UAN: (021) 111-METRO-1
                    </p>
                    <div className="pt-2 flex items-center justify-between text-xs font-mono font-bold text-slate-700 border-t border-slate-200 mt-2">
                      <span>OFFICIAL PATIENT SETTLEMENT RECEIPT</span>
                      <span>RECEIPT #: {inv.invoiceNumber}</span>
                    </div>
                  </div>

                  {/* Patient & Encounter Details Grid */}
                  <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="space-y-1">
                      <div>
                        <span className="text-slate-400 font-semibold uppercase text-[10px]">Patient Full Name</span>
                        <div className="font-bold text-slate-900 text-sm">{inv.patientName}</div>
                      </div>
                      <div className="font-mono text-slate-600">
                        MRN: <strong className="text-slate-900">{inv.mrn}</strong>
                      </div>
                      <div className="font-mono text-slate-600">
                        Encounter ID: <strong className="text-slate-900">{inv.encounterId}</strong>
                      </div>
                    </div>

                    <div className="text-right space-y-1">
                      <div>
                        <span className="text-slate-400 font-semibold uppercase text-[10px]">Coverage Plan / Tariff</span>
                        <div className="font-bold text-blue-700">{inv.tariffName || inv.payerName}</div>
                      </div>
                      <div className="font-mono text-slate-600">
                        Policy #: {inv.policyNumber || 'N/A (Self-Pay Cash)'}
                      </div>
                      <div className="font-mono text-slate-600">
                        Date Issued: {new Date(inv.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Itemized Services Rendered */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Itemized Clinical Services & Medication
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3">Service / Procedure</th>
                            <th className="py-2 px-2 text-center">Qty</th>
                            <th className="py-2 px-2 text-right">Gross</th>
                            <th className="py-2 px-2 text-right text-blue-700">Insurance</th>
                            <th className="py-2 px-3 text-right text-emerald-700">Patient Due</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {inv.items.map((item) => (
                            <tr key={item.id}>
                              <td className="py-2 px-3">
                                <div className="font-semibold text-slate-800">{item.description}</div>
                                <span className="text-[10px] font-mono text-slate-400">{item.code}</span>
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-slate-700">{item.quantity}</td>
                              <td className="py-2 px-2 text-right font-mono text-slate-600">
                                ${item.grossAmount.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-blue-700 font-semibold">
                                ${item.insurancePortion.toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                ${item.patientPortion.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Financial Settlement Totals */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Total Gross Billed Charges:</span>
                      <span className="font-mono font-bold">${inv.totalGross.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600">
                      <span>Contract Negotiated Discount:</span>
                      <span className="font-mono font-bold">-${inv.totalDiscount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-blue-700 font-semibold">
                      <span>Payer / Third-Party Insurance Coverage:</span>
                      <span className="font-mono font-bold">-${inv.totalCoverage.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-900 font-bold text-sm border-t border-slate-200 pt-2">
                      <span>Net Patient Responsibility:</span>
                      <span className="font-mono">${inv.totalPatientDue.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-bold text-sm">
                      <span>Total Amount Settled to Date:</span>
                      <span className="font-mono">${inv.totalPaid.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-900 font-black text-sm border-t-2 border-slate-900 pt-2">
                      <span>Current Outstanding Balance:</span>
                      <span className="font-mono text-rose-700">${inv.balanceDue.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Recorded Payment Settlement Receipts */}
                  {paymentList.length > 0 && (
                    <div className="space-y-2 text-xs">
                      <div className="font-bold text-slate-800 text-[11px] uppercase">
                        Recorded Point-of-Sale Payments
                      </div>
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-100 text-slate-500 font-bold">
                            <tr>
                              <th className="p-2">Date & Time</th>
                              <th className="p-2">Method</th>
                              <th className="p-2">Reference #</th>
                              <th className="p-2">Cashier / Station</th>
                              <th className="p-2 text-right">Amount Paid</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {paymentList.map((pmt) => (
                              <tr key={pmt.id}>
                                <td className="p-2 text-slate-600">
                                  {new Date(pmt.timestamp).toLocaleDateString()} {new Date(pmt.timestamp).toLocaleTimeString()}
                                </td>
                                <td className="p-2 font-bold uppercase text-slate-700">{pmt.method}</td>
                                <td className="p-2 font-mono text-slate-600">{pmt.referenceNumber}</td>
                                <td className="p-2 text-slate-600">
                                  {pmt.recordedBy} ({pmt.cashierId || 'CSH-4091'})
                                </td>
                                <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                  +${pmt.amount.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Official Audit & Signatures Block */}
                  <div className="pt-6 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
                    <div className="border-t border-slate-400 pt-2 space-y-1">
                      <div className="font-bold text-slate-800">
                        {latestPayment?.recordedBy || 'Zainab Qureshi (Cashier ID: CSH-4091)'}
                      </div>
                      <div className="text-[10px] text-slate-400">Authorized Billing Cashier Signature & Stamp</div>
                    </div>
                    <div className="border-t border-slate-400 pt-2 space-y-1">
                      <div className="font-bold text-slate-800">{inv.patientName}</div>
                      <div className="text-[10px] text-slate-400">Patient / Authorized Guardian Signature</div>
                    </div>
                  </div>

                  {/* Receipt Footer Note */}
                  <div className="text-center text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                    This is a computer-generated tax invoice and settlement receipt issued by G-HIMS. Document {index + 1} of {invoices.length}.
                  </div>
                </div>
              );
            })}
        </div>

        {/* Modal Bottom Actions (Hidden in Print) */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Ready for high-resolution printing or PDF export ({invoices.length} slips queued)</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition font-bold"
            >
              Close
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-xs transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print All Receipts</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
