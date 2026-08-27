'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  FileCode2,
  FileText,
  DollarSign,
  Building2,
  User,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Download,
  Receipt,
  XCircle,
} from 'lucide-react';
import { Claim, ClaimStatus } from '@/types/billing';
import { formatCurrency } from '@/lib/utils';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function ClaimsWorkbenchPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';

  const [claims, setClaims] = useState<Claim[]>([
    {
      id: 'clm-8891',
      tenantId,
      claimNumber: 'CLM-2026-08891',
      invoiceId: 'inv-enc-8092-441',
      patientId: 'p-1001',
      patientName: 'Robert Martinez',
      mrn: 'GH-2026-1042',
      payerCode: 'BCBS-TX-9901',
      payerName: 'BlueCross BlueShield Texas',
      totalClaimAmount: 3300.0,
      approvedAmount: 3150.0,
      deniedAmount: 150.0,
      status: 'adjudicated',
      edi837Payload: 'ISA*00*          *00*          *ZZ*GHIMSOS        *ZZ*BCBSTX         *260219*1430*U*00401*000008891*0*T*:~GS*HC*GHIMSOS*BCBSTX*20260219*1430*8891*X*004010X098A1~ST*837*0001~BHT*0019*00*CLM8891*20260219*1430*CH~NM1*41*2*CENTRAL METRO HOSPITAL*****46*741029384~CLM*GH20261042*3300***11:B:1*Y*A*Y*Y~HI*BK:I2510~SV1*HC:33512*3400*UN*1~SE*32*0001~GE*1*8891~IEA*1*000008891~',
      lineItems: [
        {
          id: 'cli-1',
          chargeItemId: 'chg-1',
          cptCode: 'CPT-99214',
          description: 'Level 4 Cardiology Outpatient Consultation',
          icd10Code: 'I25.10',
          quantity: 1,
          claimedAmount: 116.0,
          approvedAmount: 116.0,
          status: 'approved',
        },
        {
          id: 'cli-2',
          chargeItemId: 'chg-2',
          cptCode: 'CPT-33512',
          description: 'Coronary Artery Bypass Graft (CABG x3)',
          icd10Code: 'I25.10',
          quantity: 1,
          claimedAmount: 2720.0,
          approvedAmount: 2650.0,
          deniedAmount: 70.0,
          adjudicationReasonCode: 'CARC-45: Charges exceed fee schedule allowed maximum.',
          status: 'adjudicated',
        },
        {
          id: 'cli-3',
          chargeItemId: 'chg-3',
          cptCode: 'BED-ICU-01',
          description: 'ICU Critical Care Day Stay & Telemetry',
          icd10Code: 'I25.10',
          quantity: 1,
          claimedAmount: 464.0,
          approvedAmount: 384.0,
          deniedAmount: 80.0,
          adjudicationReasonCode: 'CARC-97: Bundled telemetry benefit allowance.',
          status: 'adjudicated',
        },
      ],
      createdAt: '2026-02-19T14:45:00Z',
      updatedAt: '2026-02-19T16:00:00Z',
    },
    {
      id: 'clm-8892',
      tenantId,
      claimNumber: 'CLM-2026-08892',
      invoiceId: 'inv-enc-8092-443',
      patientId: 'p-1003',
      patientName: 'Sofia Chen',
      mrn: 'GH-2026-7731',
      payerCode: 'CORP-ARAMCO-01',
      payerName: 'Aramco Corporate Plan',
      totalClaimAmount: 1450.0,
      approvedAmount: 1450.0,
      deniedAmount: 0,
      status: 'submitted',
      lineItems: [
        {
          id: 'cli-4',
          chargeItemId: 'chg-6',
          cptCode: 'LAB-80053',
          description: 'Comprehensive Metabolic Panel (CMP)',
          icd10Code: 'E11.9',
          quantity: 1,
          claimedAmount: 65.0,
          approvedAmount: 65.0,
          status: 'approved',
        },
      ],
      createdAt: '2026-02-19T11:45:00Z',
      updatedAt: '2026-02-19T12:00:00Z',
    },
  ]);

  const [selectedClaim, setSelectedClaim] = useState<Claim>(claims[0]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEdiViewer, setShowEdiViewer] = useState(false);

  const filteredClaims = claims.filter((c) => {
    const payerStr = c.payerName || c.insuranceProviderName || '';
    const matchSearch =
      c.claimNumber.toLowerCase().includes(search.toLowerCase()) ||
      c.patientName.toLowerCase().includes(search.toLowerCase()) ||
      payerStr.toLowerCase().includes(search.toLowerCase());
    const effectiveStatus = c.status || c.claimStatus || 'draft';
    const matchStatus = statusFilter === 'all' || effectiveStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleSimulateSubmit = () => {
    if (!selectedClaim) return;
    setIsSubmitting(true);
    setTimeout(() => {
      const updated = {
        ...selectedClaim,
        status: 'submitted' as ClaimStatus,
        updatedAt: new Date().toISOString(),
      };
      setClaims((prev) => prev.map((c) => (c.id === selectedClaim.id ? updated : c)));
      setSelectedClaim(updated);
      setIsSubmitting(false);
    }, 800);
  };

  const getStatusBadge = (status?: ClaimStatus) => {
    switch (status) {
      case 'adjudicated':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> ERA 835 Settled
          </span>
        );
      case 'submitted':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 flex items-center gap-1">
            <Send className="w-3 h-3" /> Clearinghouse Queued
          </span>
        );
      case 'approved':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Payer Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Denied
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
            Draft
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Payer Claims Builder & Adjudication Workbench
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ANSI ASC X12 EDI 837P / 837I transmission, NCCI edits, and ERA 835 electronic remittance reconciliation for {tenantId}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/${tenantId}/billing/tariffs`}
            className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
          >
            Tariff Schedules
          </Link>
          <Link
            href={`/${tenantId}/billing/invoices`}
            className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>POS Invoices</span>
          </Link>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Claims Batch Queue (4 cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              EDI 837 Queue ({filteredClaims.length})
            </span>
            <div className="relative w-36">
              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {filteredClaims.map((c) => {
              const isSelected = selectedClaim?.id === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedClaim(c)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-purple-50/70 dark:bg-purple-950/40 border-purple-400 dark:border-purple-700 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono font-bold text-xs text-purple-700 dark:text-purple-300 block">
                        {c.claimNumber}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block mt-0.5">
                        {c.patientName}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {c.payerName}
                      </span>
                    </div>
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100">
                      {formatCurrency(c.totalClaimAmount)}
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    {getStatusBadge(c.status)}
                    <span className="text-[10px] text-slate-400 font-mono">{c.lineItems.length} Lines</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Claim Details & EDI 837 Workbench (8 cols) */}
        {selectedClaim ? (
          <div className="lg:col-span-8 space-y-5">
            {/* Claim Header Banner */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-base text-purple-700 dark:text-purple-300">
                      {selectedClaim.claimNumber}
                    </span>
                    {getStatusBadge(selectedClaim.status)}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Payer: <strong className="text-slate-800 dark:text-slate-200">{selectedClaim.payerName}</strong> ({selectedClaim.payerCode}) &bull; Linked Invoice: {selectedClaim.invoiceId}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEdiViewer(!showEdiViewer)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>{showEdiViewer ? 'Hide EDI 837' : 'View EDI 837'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulateSubmit}
                    disabled={isSubmitting}
                    className="px-3.5 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Transmitting...' : 'Dispatch EDI 837'}</span>
                  </button>
                </div>
              </div>

              {/* Financial Metrics */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Claimed Total
                  </span>
                  <span className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {formatCurrency(selectedClaim.totalClaimAmount)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Adjudicated Allowed
                  </span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(selectedClaim.approvedAmount || 0)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Denied / Contractual Adj
                  </span>
                  <span className="text-lg font-black text-rose-600 dark:text-rose-400">
                    {formatCurrency(selectedClaim.deniedAmount || 0)}
                  </span>
                </div>
              </div>

              {/* Raw EDI 837 Viewer */}
              {showEdiViewer && (
                <div className="p-4 rounded-xl bg-slate-950 text-emerald-400 font-mono text-[11px] leading-relaxed overflow-x-auto border border-slate-800">
                  <div className="text-slate-400 text-[10px] font-bold uppercase mb-2">
                    ANSI ASC X12 837 Health Care Claim Professional/Institutional Stream
                  </div>
                  {selectedClaim.edi837Payload || 'ISA*00*...~ST*837*0001~CLM*...~SE*0001~IEA*1*000000001~'}
                </div>
              )}
            </div>

            {/* Line-Item Adjudication Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Claim Service Lines & CARC / RARC Adjudication Codes
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automated ICD-10 cross-walk validation and remittance explanation
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 font-bold">CPT / Service</th>
                      <th className="py-2.5 font-bold">ICD-10 DX</th>
                      <th className="py-2.5 font-bold text-right">Claimed ($)</th>
                      <th className="py-2.5 font-bold text-right">Allowed ($)</th>
                      <th className="py-2.5 font-bold">CARC Explanation</th>
                      <th className="py-2.5 font-bold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedClaim.lineItems.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                        <td className="py-3">
                          <span className="font-mono font-bold text-purple-700 dark:text-purple-300 block">
                            {line.cptCode || line.code || 'CPT-GEN'}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {line.description}
                          </span>
                        </td>
                        <td className="py-3 font-mono font-bold text-slate-600 dark:text-slate-400">
                          {line.icd10Code}
                        </td>
                        <td className="py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrency(line.claimedAmount || line.billedAmount || 0)}
                        </td>
                        <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(line.approvedAmount || 0)}
                        </td>
                        <td className="py-3 text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
                          {line.adjudicationReasonCode || 'Clean Claim - Reimbursed at 100% contracted rate'}
                        </td>
                        <td className="py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              line.status === 'approved' || line.status === 'adjudicated'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {line.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
