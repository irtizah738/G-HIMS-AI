'use client';

import React, { useState } from 'react';
import { Invoice, Tariff, ChargeItem } from '@/types/billing';
import {
  ShieldCheck,
  Building2,
  X,
  FileSpreadsheet,
  Percent,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Calculator,
  Sliders,
  Sparkles,
  Info,
  HelpCircle,
  Layers,
  ArrowRight,
  TrendingDown,
  Scale,
} from 'lucide-react';

interface PayerCoverageModalProps {
  invoice: Invoice;
  tariff: Tariff | null;
  onClose: () => void;
}

export function PayerCoverageModal({ invoice, tariff, onClose }: PayerCoverageModalProps) {
  const [activeSubTab, setActiveSubTab] = useState<'explanation' | 'line_items' | 'rules'>('explanation');

  const discountPercent = tariff?.defaultDiscountPercent || 0;
  const copayPercent = tariff?.copayPercent !== undefined ? tariff.copayPercent : (invoice.planName === 'cash' ? 100 : 20);
  const maxCopayCap = tariff?.maxCopayCap !== undefined ? tariff.maxCopayCap : 0;
  const payerSharePercent = Math.max(0, 100 - copayPercent);

  // Check if any items hit the copay cap
  const itemsWithCapApplied = invoice.items.filter((item) => {
    if (!tariff || tariff.planName === 'cash' || maxCopayCap <= 0) return false;
    const rawCopay = (item.grossAmount * copayPercent) / 100;
    return rawCopay > maxCopayCap;
  });

  const totalCapSavings = itemsWithCapApplied.reduce((acc, item) => {
    const rawCopay = (item.grossAmount * copayPercent) / 100;
    return acc + (rawCopay - item.patientPortion);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-xl text-white shadow-xs">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Payer Coverage & Tariff Adjudication Explainer</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-500/30 text-blue-200 border border-blue-400/40">
                  {tariff?.planName ? tariff.planName.replace('_', ' ') : invoice.planName}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Mathematical breakdown of fee schedule discounts, patient copay split, and policy deductible/cap logic
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tariff Contract Identity Strip */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600" />
            <span className="text-slate-500">Contracted Payer:</span>
            <strong className="text-slate-900 font-bold">{invoice.tariffName || invoice.payerName}</strong>
            {tariff?.payerCode && (
              <span className="font-mono bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-[10px] font-bold">
                {tariff.payerCode}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div>
              <span className="text-slate-500">Policy #:</span>{' '}
              <strong className="font-mono text-blue-700">{invoice.policyNumber || 'N/A'}</strong>
            </div>
            <div>
              <span className="text-slate-500">Pre-Auth #:</span>{' '}
              <strong className="font-mono text-emerald-700">{invoice.approvalCode || 'N/A'}</strong>
            </div>
          </div>
        </div>

        {/* Tab Sub-Header */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-slate-200 shrink-0 bg-white">
          <button
            onClick={() => setActiveSubTab('explanation')}
            className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeSubTab === 'explanation'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Adjudication Walkthrough</span>
          </button>
          <button
            onClick={() => setActiveSubTab('line_items')}
            className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeSubTab === 'line_items'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Line-by-Line Split Matrix ({invoice.items.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('rules')}
            className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeSubTab === 'rules'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Tariff Rules & Cap Parameters</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {activeSubTab === 'explanation' && (
            <div className="space-y-6">
              {/* Top 4 Core Rules Summary Bento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/80 space-y-1">
                  <div className="flex items-center justify-between text-blue-700">
                    <span className="font-bold text-[10px] uppercase">1. Contract Discount</span>
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div className="text-xl font-mono font-black text-blue-900">
                    {discountPercent}% Off
                  </div>
                  <p className="text-[11px] text-blue-800 leading-tight">
                    Negotiated price reduction from standard hospital master charge catalog.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200/80 space-y-1">
                  <div className="flex items-center justify-between text-emerald-700">
                    <span className="font-bold text-[10px] uppercase">2. Payer Split Ratio</span>
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="text-xl font-mono font-black text-emerald-900">
                    {payerSharePercent}% Payer
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-tight">
                    Insurance liability coverage on allowable charges under contracted plan.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/80 space-y-1">
                  <div className="flex items-center justify-between text-amber-700">
                    <span className="font-bold text-[10px] uppercase">3. Patient Copay</span>
                    <Percent className="w-4 h-4" />
                  </div>
                  <div className="text-xl font-mono font-black text-amber-900">
                    {copayPercent}% Copay
                  </div>
                  <p className="text-[11px] text-amber-800 leading-tight">
                    Patient responsibility ratio at the point-of-care admission/discharge.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200/80 space-y-1">
                  <div className="flex items-center justify-between text-purple-700">
                    <span className="font-bold text-[10px] uppercase">4. Out-of-Pocket Cap</span>
                    <Scale className="w-4 h-4" />
                  </div>
                  <div className="text-xl font-mono font-black text-purple-900">
                    {maxCopayCap > 0 ? `$${maxCopayCap.toFixed(2)} Cap` : 'No Cap'}
                  </div>
                  <p className="text-[11px] text-purple-800 leading-tight">
                    {maxCopayCap > 0
                      ? 'Maximum allowable copay cap protection per line item.'
                      : 'Standard uncapped co-insurance formula applied.'}
                  </p>
                </div>
              </div>

              {/* Step-by-Step Calculation Steps */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-blue-600" />
                    Four-Stage Adjudication Calculation Workflow
                  </h3>
                  <span className="text-[11px] text-slate-500">Automatic G-HIMS Fee Engine</span>
                </div>

                <div className="space-y-3">
                  {/* Step 1 */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="font-bold text-slate-900">Standard Price Baseline to Contracted Fee Rate</div>
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        Every procedure or medication is cross-walked with the tariff fee schedule. If specific CPT/LOINC overrides exist (e.g. negotiated lab panels), they supersede standard rates. Otherwise, the global <strong>{discountPercent}% discount</strong> reduces the standard fee.
                      </p>
                      <div className="font-mono text-[11px] text-slate-700 bg-slate-50 p-2 rounded border border-slate-200 inline-block">
                        Effective Unit Price = Standard Price × (1 - {discountPercent / 100})
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="font-bold text-slate-900">Patient Co-Payment Split Formula</div>
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        The patient copay responsibility is calculated by multiplying the net line total by the patient copay percentage (<strong>{copayPercent}%</strong>).
                      </p>
                      <div className="font-mono text-[11px] text-slate-700 bg-slate-50 p-2 rounded border border-slate-200 inline-block">
                        Raw Patient Copay = Net Item Total × ({copayPercent} / 100)
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="font-bold text-slate-900">Copay Ceiling Cap & Deductible Protection Logic</div>
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        {maxCopayCap > 0 ? (
                          <>
                            To protect patients from catastrophic high-cost items (e.g. ICU bed days or extensive diagnostics), the patient copay is capped at <strong>${maxCopayCap.toFixed(2)}</strong>. Any excess patient obligation above ${maxCopayCap.toFixed(2)} is automatically shifted into the insurance coverage.
                          </>
                        ) : (
                          <>
                            No copay cap constraint is defined in this tariff schedule. Standard percentage copay applies across all charge line items.
                          </>
                        )}
                      </p>
                      <div className="font-mono text-[11px] text-purple-800 bg-purple-50 p-2 rounded border border-purple-200 inline-block">
                        Final Patient Due = {maxCopayCap > 0 ? `min(Raw Copay, $${maxCopayCap.toFixed(2)})` : 'Raw Copay'}
                      </div>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                      4
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="font-bold text-slate-900">Net Payer Claimable Reimbursement</div>
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        The insurance carrier coverage is the difference between the net billable amount and the patient copay. This forms the exact figure transmitted on the EDI 837 claim batch.
                      </p>
                      <div className="font-mono text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded border border-emerald-200 inline-block">
                        Payer Coverage = Net Amount - Final Patient Due = ${invoice.totalCoverage.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cap Protection Highlight Banner if triggered */}
              {itemsWithCapApplied.length > 0 && (
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-purple-600 shrink-0" />
                    <div>
                      <strong className="font-bold block">Copay Cap Protection Active!</strong>
                      <span className="text-[11px] text-purple-700">
                        {itemsWithCapApplied.length} high-cost line item(s) exceeded the ${maxCopayCap} copay limit, saving the patient ${totalCapSavings.toFixed(2)} in out-of-pocket costs.
                      </span>
                    </div>
                  </div>
                  <span className="font-mono font-black text-purple-800 text-sm shrink-0">
                    -${totalCapSavings.toFixed(2)} Copay Relief
                  </span>
                </div>
              )}
            </div>
          )}

          {activeSubTab === 'line_items' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Line-by-Line Tariff Adjudication Table</h3>
                  <p className="text-[11px] text-slate-500">
                    Exact breakdown of each clinical service item with contract discounts and patient vs. payer split
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3">Service Code & Name</th>
                      <th className="py-2.5 px-2 text-center">Qty</th>
                      <th className="py-2.5 px-2 text-right">Negotiated Rate</th>
                      <th className="py-2.5 px-2 text-right">Gross Total</th>
                      <th className="py-2.5 px-2 text-center">Copay %</th>
                      <th className="py-2.5 px-2 text-center">Cap Status</th>
                      <th className="py-2.5 px-3 text-right text-blue-700">Payer Covered</th>
                      <th className="py-2.5 px-3 text-right text-emerald-700">Patient Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.items.map((item) => {
                      const isCapped = maxCopayCap > 0 && (item.grossAmount * copayPercent) / 100 > maxCopayCap;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60 transition">
                          <td className="py-2.5 px-3">
                            <div className="font-mono font-bold text-slate-900">{item.code}</div>
                            <div className="text-[11px] text-slate-700 truncate max-w-xs">{item.description}</div>
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold">{item.quantity}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                            ${item.unitPrice.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                            ${item.grossAmount.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold text-slate-600">
                            {copayPercent}%
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {isCapped ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">
                                Capped at ${maxCopayCap}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Standard</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                            ${item.insurancePortion.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                            ${item.patientPortion.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Gross Total</div>
                  <div className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                    ${invoice.totalGross.toFixed(2)}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Discounts</div>
                  <div className="font-mono font-bold text-rose-600 text-sm mt-0.5">
                    -${invoice.totalDiscount.toFixed(2)}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-blue-200">
                  <div className="text-[10px] uppercase font-bold text-blue-500">Payer Covered</div>
                  <div className="font-mono font-black text-blue-700 text-sm mt-0.5">
                    ${invoice.totalCoverage.toFixed(2)}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-200">
                  <div className="text-[10px] uppercase font-bold text-emerald-500">Patient Due</div>
                  <div className="font-mono font-black text-emerald-700 text-sm mt-0.5">
                    ${invoice.totalPatientDue.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'rules' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <h3 className="font-bold text-slate-900 text-sm">Contract Configuration Matrix</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Tariff Name</span>
                    <div className="font-bold text-slate-900">{tariff?.name || invoice.tariffName || 'Standard'}</div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Payer Code</span>
                    <div className="font-mono font-bold text-slate-900">{tariff?.payerCode || 'N/A'}</div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Default Plan Discount</span>
                    <div className="font-mono font-bold text-blue-700">{discountPercent}%</div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Patient Copay Ratio</span>
                    <div className="font-mono font-bold text-amber-700">{copayPercent}%</div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Maximum Copay Cap</span>
                    <div className="font-mono font-bold text-purple-700">
                      {maxCopayCap > 0 ? `$${maxCopayCap.toFixed(2)} USD` : 'None / Unlimited'}
                    </div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span className="text-slate-400 font-semibold text-[10px] uppercase">Price Overrides Active</span>
                    <div className="font-bold text-slate-900">
                      {tariff?.priceOverrides ? Object.keys(tariff.priceOverrides).length : 0} Overrides Mapped
                    </div>
                  </div>
                </div>
              </div>

              {tariff?.priceOverrides && Object.keys(tariff.priceOverrides).length > 0 && (
                <div className="space-y-2">
                  <span className="font-bold text-slate-900 text-xs">Contract Negotiated Price Overrides</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {Object.entries(tariff.priceOverrides).map(([code, price]) => (
                      <div key={code} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex justify-between">
                        <span className="font-mono font-bold text-slate-800">{code}</span>
                        <span className="font-mono font-black text-blue-700">${price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-slate-500 text-[11px] flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            Adjudication conforms to Pakistan National Health Insurance and Corporate TPA guidelines
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-xs transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
