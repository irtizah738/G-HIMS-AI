'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  FileCheck,
  ShieldCheck,
  AlertOctagon,
  DollarSign,
  Clock,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  FileText,
  Download,
  Code,
  Check,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Edi837Generator, Edi837ClaimPayload } from '@/lib/interop/edi-837-generator';

interface ClaimRecord {
  id: string;
  claimNumber: string;
  patientName: string;
  mrn: string;
  payerName: string;
  cptCodes: string[];
  icd10Codes: string[];
  billedAmount: number;
  expectedReimbursement: number;
  status: 'clean_adjudicated' | 'scrubbing' | 'denied' | 'pre_auth_pending';
  denialReason?: string;
  appealAiReady?: boolean;
}

export function ClaimsPreAuthView() {
  const [claims, setClaims] = useState<ClaimRecord[]>([
    {
      id: 'cl-901',
      claimNumber: 'CLM-2026-88192',
      patientName: 'Elena Rostova',
      mrn: 'GH-2026-9812',
      payerName: 'BlueCross BlueShield Premier',
      cptCodes: ['99223', '93000', '71045'],
      icd10Codes: ['I21.09', 'I50.9'],
      billedAmount: 4850,
      expectedReimbursement: 4120,
      status: 'clean_adjudicated',
    },
    {
      id: 'cl-902',
      claimNumber: 'CLM-2026-88193',
      patientName: 'Eleanor Vance',
      mrn: 'GH-2026-3391',
      payerName: 'Medicare Part B / National Health',
      cptCodes: ['27447', '00600', '99232'],
      icd10Codes: ['M17.11'],
      billedAmount: 18400,
      expectedReimbursement: 14200,
      status: 'pre_auth_pending',
    },
    {
      id: 'cl-903',
      claimNumber: 'CLM-2026-88194',
      patientName: 'Robert Martinez',
      mrn: 'GH-2026-1042',
      payerName: 'Aetna Global Health',
      cptCodes: ['33512', '99291'],
      icd10Codes: ['I25.10'],
      billedAmount: 32500,
      expectedReimbursement: 28000,
      status: 'denied',
      denialReason: 'Missing Prior Authorization modifier for CPT 33512 Off-Pump bypass',
      appealAiReady: true,
    },
    {
      id: 'cl-904',
      patientName: 'Carlos Hernandez',
      mrn: 'GH-2026-8902',
      claimNumber: 'CLM-2026-88195',
      payerName: 'Cigna HealthSpring',
      cptCodes: ['99214', '93000'],
      icd10Codes: ['I10', 'R42'],
      billedAmount: 420,
      expectedReimbursement: 360,
      status: 'scrubbing',
    },
  ]);

  const [generatedAppeal, setGeneratedAppeal] = useState<string | null>(null);
  const [activeEdiView, setActiveEdiView] = useState<{ claimNumber: string; content: string } | null>(null);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  const handleGenerateAppeal = (claim: ClaimRecord) => {
    setGeneratedAppeal(
      `EXPEDITED APPEAL MEMORANDUM\nTo: ${claim.payerName} Claims Appeals Board\nRe: Claim #${claim.claimNumber} (Patient: ${claim.patientName}, MRN: ${claim.mrn})\n\nClinical Justification: The patient presented with acute symptomatic multivessel coronary occlusion necessitating emergent surgical revascularization (CPT 33512). Pursuant to Emergency Care Parity statutes, prior authorization requirement is waived under emergent medical necessity criteria.`
    );
  };

  const handleGenerate837P = (claim: ClaimRecord) => {
    const payload: Edi837ClaimPayload = {
      controlNumber: String(Math.floor(100000000 + Math.random() * 900000000)),
      claimId: claim.claimNumber,
      totalBilledAmount: claim.billedAmount,
      payer: {
        payerId: claim.payerName.includes('BlueCross') ? 'BCBS001' : claim.payerName.includes('Medicare') ? 'MEDICARE_B' : 'PAYER001',
        name: claim.payerName,
      },
      billingProvider: {
        npi: '1982736450',
        taxId: '82-9382104',
        lastName: 'Jenkins',
        firstName: 'Sarah',
        facilityName: 'Central Metro General Hospital',
        facilityAddress: '1000 Hospital Boulevard',
        city: 'Metro City',
        state: 'NY',
        zip: '10001',
      },
      patient: {
        mrn: claim.mrn,
        lastName: claim.patientName.split(' ')[1] || 'Patient',
        firstName: claim.patientName.split(' ')[0] || 'Unknown',
        gender: 'F',
        dob: '19820414',
        address: '742 Evergreen Terrace',
        city: 'Metro City',
        state: 'NY',
        zip: '10001',
        memberId: `MBR-${claim.mrn.replace(/[^0-9]/g, '')}`,
        relationshipToInsured: '18',
      },
      icd10Codes: claim.icd10Codes,
      priorAuthNumber: claim.status === 'pre_auth_pending' ? undefined : 'PA-2026-AUTOGEN',
      serviceLines: claim.cptCodes.map((code, idx) => ({
        lineItemNumber: idx + 1,
        cptCode: code,
        chargeAmount: claim.billedAmount / claim.cptCodes.length,
        unitCount: 1,
        serviceDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        diagnosisPointers: [1],
      })),
    };

    const edi = Edi837Generator.generate837P(payload);
    setActiveEdiView({ claimNumber: claim.claimNumber, content: edi });
  };

  const handleSimulateClearinghouseBatch = () => {
    setSubmittingBatch(true);
    setBatchNotice(null);
    setTimeout(() => {
      setSubmittingBatch(false);
      setBatchNotice('Batch #BATCH-837P-2026-092 validated: 4 Claims scrubbed clean (0 NCCI edits, 100% HIPAA compliant). Transmitted to Clearinghouse gateway.');
      setTimeout(() => setBatchNotice(null), 7000);
    }, 1200);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <FileCheck className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Insurance Claims & Pre-Authorization Scrubber</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-Time EDI 837/835 Scrubbing, Denial Root-Cause Diagnosis & Automated AI Appeal Engine
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-lg border border-emerald-200">
            Clean Claim Pass Rate: 97.4%
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Submitted Volume</span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">{formatCurrency(56170)}</span>
          <span className="text-[11px] text-slate-500">4 Active Batches Today</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Expected Remittance</span>
          <span className="text-2xl font-black text-emerald-600 mt-1 block">{formatCurrency(46680)}</span>
          <span className="text-[11px] text-emerald-700 font-semibold">83% Payer Yield</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Denial Rate</span>
          <span className="text-2xl font-black text-rose-600 mt-1 block">2.6%</span>
          <span className="text-[11px] text-slate-500">Industry Avg: 12.0%</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Days in AR</span>
          <span className="text-2xl font-black text-blue-600 mt-1 block">18.4 Days</span>
          <span className="text-[11px] text-slate-500">Benchmark: &lt;35 Days</span>
        </div>
      </div>

      {/* Claims Ledger */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Active Insurance Submissions & Payer Adjudication Ledger
            </h2>
            <p className="text-xs text-slate-500">Validated against payer fee schedules and national correct coding initiative (NCCI) edits</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="p-3 font-bold">Claim & Patient</th>
                <th className="p-3 font-bold">Payer</th>
                <th className="p-3 font-bold">Coding (CPT / ICD-10)</th>
                <th className="p-3 font-bold text-right">Billed Amount</th>
                <th className="p-3 font-bold text-right">Expected Pay</th>
                <th className="p-3 font-bold">Adjudication Status</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claims.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="p-3">
                    <span className="font-bold text-slate-900 block">{c.patientName}</span>
                    <span className="font-mono text-[11px] text-slate-500">{c.claimNumber}</span>
                  </td>
                  <td className="p-3 font-medium text-slate-700">{c.payerName}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {c.cptCodes.map((code) => (
                        <span key={code} className="px-1.5 py-0.2 bg-blue-50 text-blue-700 font-mono text-[10px] rounded border border-blue-200 font-bold">
                          {code}
                        </span>
                      ))}
                      {c.icd10Codes.map((diag) => (
                        <span key={diag} className="px-1.5 py-0.2 bg-slate-100 text-slate-700 font-mono text-[10px] rounded">
                          {diag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 font-bold text-slate-900 text-right">{formatCurrency(c.billedAmount)}</td>
                  <td className="p-3 font-bold text-emerald-700 text-right">{formatCurrency(c.expectedReimbursement)}</td>
                  <td className="p-3">
                    <span
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${
                        c.status === 'clean_adjudicated'
                          ? 'bg-emerald-100 text-emerald-800'
                          : c.status === 'denied'
                          ? 'bg-rose-100 text-rose-800'
                          : c.status === 'pre_auth_pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {c.status.replace('_', ' ')}
                    </span>
                    {c.denialReason && (
                      <p className="text-[10px] text-rose-600 mt-1 max-w-xs">{c.denialReason}</p>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleGenerate837P(c)}
                        title="Inspect ANSI X12 837P EDI Payload"
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-mono font-medium flex items-center gap-1 border border-slate-300 cursor-pointer"
                      >
                        <Code className="w-3 h-3 text-blue-600" /> 837P
                      </button>
                      {c.status === 'denied' ? (
                        <button
                          onClick={() => handleGenerateAppeal(c)}
                          className="px-2.5 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3 text-amber-300" /> AI Appeal
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium px-1">Ready</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Appeal Generator Modal / Output */}
      {generatedAppeal && (
        <div className="bg-purple-50 rounded-2xl p-5 border border-purple-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-600" />
              AI-Generated Expedited Denial Appeal Letter
            </h3>
            <button
              onClick={() => setGeneratedAppeal(null)}
              className="text-xs font-bold text-purple-700 hover:text-purple-900"
            >
              Dismiss
            </button>
          </div>
          <pre className="text-xs font-mono text-purple-950 bg-white p-4 rounded-xl border border-purple-200 whitespace-pre-wrap">
            {generatedAppeal}
          </pre>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                alert('Appeal submitted via EDI 278 Electronic Prior-Auth transaction.');
                setGeneratedAppeal(null);
              }}
              className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold cursor-pointer"
            >
              Submit Electronic Appeal to Payer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
