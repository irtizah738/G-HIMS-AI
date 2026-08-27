import React from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, FlaskConical, Printer, ShieldCheck, AlertCircle } from 'lucide-react';

interface PageProps {
  params: Promise<{
    tenantId: string;
    orderId: string;
  }>;
}

export default async function DiagnosticsResultPage({ params }: PageProps) {
  const { tenantId, orderId } = await params;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Hospital Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-200">
              Tenant: {tenantId}
            </span>
          </div>
        </div>

        {/* Diagnostic Report Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                  <FlaskConical className="w-5 h-5" />
                </span>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Laboratory & Diagnostic Report</h1>
                  <p className="text-xs text-slate-500 font-mono">Order ID: {orderId}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Verified & Released
              </span>
            </div>
          </div>

          {/* Patient Meta Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Patient Name</span>
              <strong className="text-slate-800 text-sm">Elena Rostova</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">MRN Number</span>
              <span className="font-mono text-slate-700 font-bold">GH-2026-9812</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Specimen Type</span>
              <span className="text-slate-700 font-medium">Venous Whole Blood</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Reporting Date</span>
              <span className="text-slate-700 font-medium">Aug 13, 2026 10:15 AM</span>
            </div>
          </div>

          {/* Test Table Results */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Analyte Quantitative Breakdown</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="p-3 font-semibold">Test Parameter</th>
                    <th className="p-3 font-semibold">Measured Value</th>
                    <th className="p-3 font-semibold">Unit</th>
                    <th className="p-3 font-semibold">Reference Interval</th>
                    <th className="p-3 font-semibold">Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">High-Sensitivity Cardiac Troponin I</td>
                    <td className="p-3 font-bold text-rose-600">0.042</td>
                    <td className="p-3 text-slate-500">ng/mL</td>
                    <td className="p-3 text-slate-500">&lt; 0.014</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">HIGH</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">Total Serum Cholesterol</td>
                    <td className="p-3 font-bold text-amber-600">215</td>
                    <td className="p-3 text-slate-500">mg/dL</td>
                    <td className="p-3 text-slate-500">&lt; 200</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">HIGH</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">Low-Density Lipoprotein (LDL-C)</td>
                    <td className="p-3 font-bold text-amber-600">138</td>
                    <td className="p-3 text-slate-500">mg/dL</td>
                    <td className="p-3 text-slate-500">&lt; 100</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">HIGH</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">High-Density Lipoprotein (HDL-C)</td>
                    <td className="p-3 font-bold text-amber-600">46</td>
                    <td className="p-3 text-slate-500">mg/dL</td>
                    <td className="p-3 text-slate-500">&gt; 50</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">LOW</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-800">Serum Triglycerides</td>
                    <td className="p-3 font-bold text-slate-800">155</td>
                    <td className="p-3 text-slate-500">mg/dL</td>
                    <td className="p-3 text-slate-500">&lt; 150</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">HIGH</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Pathologist Note */}
          <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 text-xs space-y-1">
            <h4 className="font-semibold text-blue-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Pathologist Clinical Impression
            </h4>
            <p className="text-blue-800">
              Cardiac biomarker troponin I shows post-acute trending with mild elevation consistent with recent revascularization. Correlation with telemetry and 12-lead ECG is advised.
            </p>
            <div className="pt-2 flex items-center justify-between text-[11px] text-blue-600/80">
              <span>Pathologist: Dr. Raymond Holt, MD, FCAP</span>
              <span>Signature verified electronically</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
