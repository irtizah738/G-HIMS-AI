'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useHospital } from '@/lib/context/hospital-context';
import {
  DollarSign,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  FileCheck,
  Zap,
  ArrowRight,
  Receipt,
  FileText,
  Filter,
  ShieldCheck,
  Search,
  Sparkles,
  RefreshCw,
  XCircle,
  HelpCircle,
  Eye,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { BillingAuditMismatch } from '@/lib/types/ghims';

export function BillingErpView() {
  const { mismatches, reconcileMismatch, dismissMismatch, patients, stats } = useHospital();
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('p-1001');
  const [activeTab, setActiveTab] = useState<'validator' | 'invoices' | 'performance_share'>('validator');

  const filteredMismatches = mismatches.filter((m) => {
    if (selectedStatus === 'pending') return m.status === 'pending_review';
    if (selectedStatus === 'reconciled') return m.status === 'reconciled';
    if (selectedStatus === 'dismissed') return m.status === 'dismissed';
    return true;
  });

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || patients[0];
  const activeEncounter = selectedPatient?.encounters[0];

  const totalPendingVal = mismatches.filter(m => m.status === 'pending_review').reduce((acc, m) => acc + m.estimatedRecoverableRevenue, 0);
  const totalReconciledVal = mismatches.filter(m => m.status === 'reconciled').reduce((acc, m) => acc + m.estimatedRecoverableRevenue, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner: Core Value Proposition */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-blue-800/40">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-amber-400 text-slate-950">
                Core Value Proposition
              </span>
              <span className="text-xs text-blue-200 font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Point-of-Care Audit Engine
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black">
              Clinical Note vs. Billing Reconciliation Validator
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Solving the <strong className="text-amber-300">80% clinical documentation vs. final bill mismatch</strong>.
              Automatically parses doctor SOAP notes to extract unbilled procedures, infusions, diagnostic labs, and consumables in real-time.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-slate-800/90 border border-slate-700 px-4 py-2.5 rounded-xl text-right">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Recoverable Pending</span>
              <span className="text-lg font-black text-amber-400">{formatCurrency(totalPendingVal)}</span>
            </div>
            <div className="bg-emerald-950/80 border border-emerald-700/60 px-4 py-2.5 rounded-xl text-right">
              <span className="text-[10px] text-emerald-300 uppercase tracking-wider block">Total Recovered</span>
              <span className="text-lg font-black text-emerald-400">+{formatCurrency(totalReconciledVal + 1480)}</span>
            </div>
          </div>
        </div>

        {/* Tab Sub-navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-6 pt-4 border-t border-slate-700/80">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('validator')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'validator'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white bg-slate-800/60'
              }`}
            >
              Real-Time Audit Queue ({mismatches.filter(m => m.status === 'pending_review').length})
            </button>
            <button
              onClick={() => setActiveTab('invoices')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'invoices'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white bg-slate-800/60'
              }`}
            >
              Itemized Inpatient & OPD Invoices
            </button>
            <button
              onClick={() => setActiveTab('performance_share')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'performance_share'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white bg-slate-800/60'
              }`}
            >
              Performance-Share Financial Model ($30k ACV Tier)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/central-metro-hospital/billing/invoices/inv-enc-8092-441"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-400/30 flex items-center gap-1.5 transition-colors"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Invoices & POS Terminal</span>
            </Link>
            <Link
              href="/central-metro-hospital/billing/tariffs"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 border border-blue-400/30 flex items-center gap-1.5 transition-colors"
            >
              <span>Multi-Tariff Admin</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/central-metro-hospital/billing/claims"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border border-emerald-400/30 flex items-center gap-1.5 transition-colors"
            >
              <span>Claims Workbench</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {activeTab === 'validator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Reconciliation List */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    AI-Detected Unbilled Documentation ({filteredMismatches.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    High-confidence procedure extraction matched against hospital CPT & fee schedules
                  </p>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
                  <button
                    onClick={() => setSelectedStatus('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      selectedStatus === 'all' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelectedStatus('pending')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      selectedStatus === 'pending' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Pending ({mismatches.filter(m => m.status === 'pending_review').length})
                  </button>
                  <button
                    onClick={() => setSelectedStatus('reconciled')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      selectedStatus === 'reconciled' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Reconciled
                  </button>
                </div>
              </div>

              {/* Mismatch Cards */}
              <div className="space-y-3 pt-2">
                {filteredMismatches.map((mismatch) => (
                  <div
                    key={mismatch.id}
                    className={`p-4 rounded-xl border transition-all ${
                      mismatch.status === 'pending_review'
                        ? 'bg-amber-50/40 border-amber-200/80 shadow-xs hover:bg-amber-50/70'
                        : mismatch.status === 'reconciled'
                        ? 'bg-emerald-50/30 border-emerald-200'
                        : 'bg-slate-50 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-xs text-slate-900">{mismatch.patientName}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                            CPT {mismatch.suggestedCptCode}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                            {mismatch.category}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Confidence: {Math.round(mismatch.confidenceScore * 100)}%
                          </span>
                        </div>

                        <h3 className="text-sm font-bold text-slate-900">{mismatch.documentedItem}</h3>

                        {/* Evidence Citation */}
                        <div className="p-2.5 rounded-lg bg-white/90 border border-slate-200 text-xs text-slate-700 space-y-1">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
                            Evidence from Doctor Note:
                          </span>
                          <p className="italic text-slate-800 font-mono text-[11px]">{mismatch.evidenceSnippet}</p>
                        </div>
                      </div>

                      {/* Right Action & Value */}
                      <div className="flex sm:flex-col items-end justify-between sm:justify-start gap-2 shrink-0">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 uppercase block">Recoverable Charge</span>
                          <span className="text-base font-black text-emerald-600">
                            +{formatCurrency(mismatch.estimatedRecoverableRevenue)}
                          </span>
                        </div>

                        {mismatch.status === 'pending_review' ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => reconcileMismatch(mismatch.id)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Reconcile
                            </button>
                            <button
                              onClick={() => dismissMismatch(mismatch.id)}
                              title="Dismiss / Clinical Exemption"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-all cursor-pointer"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Billed in Ledger
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Side: Note vs. Bill Side-by-Side Inspector */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">Live Inspector</span>
                <h3 className="text-sm font-bold text-slate-900">Side-by-Side Comparison</h3>
                <p className="text-xs text-slate-500">Inspect patient clinical documentation alongside active charge sheet</p>
              </div>

              {/* Patient Selector */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Select Inpatient:</label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800"
                >
                  {patients.filter(p => p.encounters.length > 0).map(p => (
                    <option key={p.id} value={p.id}>{p.fullName} ({p.mrn})</option>
                  ))}
                </select>
              </div>

              {/* Doctor Clinical Notes Snippet */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-blue-600" /> Physician SOAP Notes
                  </span>
                  <span className="text-[10px] text-slate-500">Dr. Sarah Jenkins</span>
                </div>
                <div className="max-h-40 overflow-y-auto text-xs text-slate-700 leading-relaxed font-sans bg-white p-2.5 rounded border border-slate-200/80">
                  {activeEncounter?.clinicalNotes[0]?.content || 'No clinical note recorded yet for this encounter.'}
                </div>
              </div>

              {/* Active Bill Items */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1">
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" /> Active Bill Items ({activeEncounter?.billing.items.length || 0})
                  </span>
                  <span className="font-bold text-slate-900">
                    Total: {formatCurrency(activeEncounter?.billing.subtotal || 0)}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {activeEncounter?.billing.items.map((item) => (
                    <div key={item.id} className="p-2 rounded bg-white border border-slate-200 text-xs flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{item.description}</p>
                        <span className="text-[10px] text-slate-500">Code: {item.code} | Qty: {item.quantity}</span>
                      </div>
                      <span className="font-bold text-slate-800">{formatCurrency(item.totalPrice)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Hospital Billing Ledger & Insurance Pre-Auth</h2>
              <p className="text-xs text-slate-500">Audited inpatient and outpatient settlement statements</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Select Patient:</span>
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="text-xs font-bold bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5"
              >
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.fullName} ({p.mrn})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Invoice Visualizer */}
          <div className="border border-slate-200 rounded-xl p-6 bg-slate-50/50 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">Metropolitan Memorial Health System</h3>
                <p className="text-xs text-slate-500">Department: {activeEncounter?.department || 'General Medicine'}</p>
                <p className="text-xs text-slate-500">Attending: {activeEncounter?.attendingPhysician || 'Dr. Sarah Jenkins'}</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-slate-500">INVOICE #{activeEncounter?.id.toUpperCase() || 'INV-2026'}</span>
                <p className="text-xs text-slate-600 mt-1">Patient: <strong className="text-slate-900">{selectedPatient?.fullName}</strong></p>
                <p className="text-xs text-slate-600">MRN: <strong className="text-slate-900">{selectedPatient?.mrn}</strong></p>
              </div>
            </div>

            {/* Item Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-2 text-left">Description / Procedure</th>
                    <th className="py-2 text-left">Code</th>
                    <th className="py-2 text-left">Category</th>
                    <th className="py-2 text-center">Qty</th>
                    <th className="py-2 text-right">Unit Price</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeEncounter?.billing.items.map((item) => (
                    <tr key={item.id} className="text-slate-800">
                      <td className="py-2.5 font-medium flex items-center gap-1.5">
                        {item.description}
                        {item.auditedStatus === 'reconciled' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                            Auto-Audited
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-slate-600">{item.code}</td>
                      <td className="py-2.5 text-slate-600">{item.category}</td>
                      <td className="py-2.5 text-center">{item.quantity}</td>
                      <td className="py-2.5 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-2.5 text-right font-bold">{formatCurrency(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end pt-4 border-t border-slate-200">
              <div className="w-72 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-semibold">{formatCurrency(activeEncounter?.billing.subtotal || 0)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Est. Tax (5%):</span>
                  <span className="font-semibold">{formatCurrency(activeEncounter?.billing.tax || 0)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Insurance Covered (80%):</span>
                  <span>-{formatCurrency(activeEncounter?.billing.insuranceCoverage || 0)}</span>
                </div>
                <div className="flex justify-between text-base font-black text-slate-900 border-t border-slate-300 pt-2">
                  <span>Patient Payable:</span>
                  <span>{formatCurrency(activeEncounter?.billing.patientPayable || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'performance_share' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-slate-900">Performance-Share Alignment Model</h2>
            <p className="text-xs text-slate-500">
              How G-HIMS captures $30,000 blended ACV per hospital by sharing in recovered net revenue
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Step 1: Baseline Audit</span>
              <h3 className="font-bold text-slate-900 text-sm">Passive Note Interception</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The local edge AI observes clinical notes and compares them with charge entry. Mismatches are flagged before final discharge.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-2">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Step 2: Revenue Recovery</span>
              <h3 className="font-bold text-blue-950 text-sm">Point-of-Care Validation</h3>
              <p className="text-xs text-blue-800 leading-relaxed">
                Clinicians and billing teams accept auto-suggested missing codes (average recovery ~$150k - $200k/yr per 100-bed hospital).
              </p>
            </div>

            <div className="p-5 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-2">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Step 3: Revenue Share</span>
              <h3 className="font-bold text-emerald-950 text-sm">$30,000 Avg Annual Upside</h3>
              <p className="text-xs text-emerald-800 leading-relaxed">
                G-HIMS bills 15-20% on verified recovered revenue. Hospitals experience positive ROI within 2.3 months of deployment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
