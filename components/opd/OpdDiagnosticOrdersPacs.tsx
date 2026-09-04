'use client';

import React, { useState } from 'react';
import {
  Activity,
  FileCheck,
  Barcode,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Sparkles,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  Sun,
  Layers,
} from 'lucide-react';
import {
  ComprehensiveOpdEncounter,
  DiagnosticOrderItem,
  DiagnosticCategory,
} from '@/types/opd-domain';

interface OpdDiagnosticOrdersPacsProps {
  encounter: ComprehensiveOpdEncounter;
  orders: DiagnosticOrderItem[];
  onAddOrder: (order: DiagnosticOrderItem) => void;
  onUpdateOrderStatus: (orderId: string, status: any, resultsSummary?: string) => void;
}

const CATALOG_ITEMS: { code: string; name: string; category: DiagnosticCategory; price: number; specimen?: string; consentNeeded?: boolean }[] = [
  { code: 'LAB-CBC-01', name: 'Complete Blood Count (CBC) with Differential', category: 'LABORATORY', price: 1200, specimen: 'EDTA Whole Blood' },
  { code: 'LAB-RFT-02', name: 'Renal Function Test (Urea, Creatinine, Electrolytes)', category: 'LABORATORY', price: 1800, specimen: 'Serum Gel Tube' },
  { code: 'LAB-BNP-03', name: 'Serum NT-proBNP Quantitative', category: 'LABORATORY', price: 4500, specimen: 'Serum Gel Tube' },
  { code: 'LAB-HBA1C-04', name: 'Glycated Hemoglobin (HbA1c)', category: 'LABORATORY', price: 1600, specimen: 'EDTA Whole Blood' },
  { code: 'RAD-CXR-01', name: 'Chest X-Ray (PA View)', category: 'RADIOLOGY', price: 2200 },
  { code: 'RAD-ECHO-02', name: 'Transthoracic Echocardiogram (TTE with Doppler)', category: 'RADIOLOGY', price: 8500 },
  { code: 'RAD-USG-03', name: 'Abdominal & Pelvic Ultrasound (USG)', category: 'RADIOLOGY', price: 3500 },
  { code: 'PROC-ECG-01', name: '12-Lead Diagnostic Electrocardiogram (ECG)', category: 'PROCEDURE', price: 1500, consentNeeded: false },
  { code: 'PROC-NEB-02', name: 'Therapeutic Salbutamol Nebulization Session', category: 'PROCEDURE', price: 800, consentNeeded: false },
  { code: 'PROC-DRS-03', name: 'Sterile Minor Wound Debridement & Dressing', category: 'PROCEDURE', price: 2500, consentNeeded: true },
];

export function OpdDiagnosticOrdersPacs({
  encounter,
  orders,
  onAddOrder,
  onUpdateOrderStatus,
}: OpdDiagnosticOrdersPacsProps) {
  const [selectedCatalogCode, setSelectedCatalogCode] = useState<string>(CATALOG_ITEMS[0].code);
  const [urgency, setUrgency] = useState<'ROUTINE' | 'URGENT' | 'STAT_EMERGENCY'>('ROUTINE');
  const [clinicalReason, setClinicalReason] = useState<string>('Evaluation of heart failure and exertional dyspnea');
  const [activeDicomViewerOrder, setActiveDicomViewerOrder] = useState<DiagnosticOrderItem | null>(null);

  // PACS Viewer Controls State
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [invert, setInvert] = useState<boolean>(false);

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const item = CATALOG_ITEMS.find((c) => c.code === selectedCatalogCode) || CATALOG_ITEMS[0];

    const newOrder: DiagnosticOrderItem = {
      id: `diag-${Date.now()}`,
      category: item.category,
      testCode: item.code,
      testName: item.name,
      specimenType: item.specimen,
      specimenBarcode: item.specimen ? `SPEC-${encounter.mrn.slice(-4)}-${Date.now().toString().slice(-4)}` : undefined,
      urgency,
      reasonForOrder: clinicalReason,
      status: 'ORDERED',
      orderingDoctor: 'Dr. Sarah Jenkins (Cardiology)',
      orderedAt: Date.now(),
      costAmountMinorUnits: item.price * 100, // Cents
      requiresConsent: item.consentNeeded || false,
      consentVerified: true,
    };

    onAddOrder(newOrder);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-600" />
              Unified Diagnostics, Laboratory (LIS), PACS Radiology & Procedures
            </h2>
            <p className="text-xs text-slate-500">
              Orders automatically generate specimen barcodes, PACS worklist hooks, and post to the patient ledger.
            </p>
          </div>
        </div>

        {/* Order Placement Form */}
        <form onSubmit={handleCreateOrder} className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Select Investigation / Procedure
            </label>
            <select
              value={selectedCatalogCode}
              onChange={(e) => setSelectedCatalogCode(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
            >
              <optgroup label="Laboratory Tests (LIS)">
                {CATALOG_ITEMS.filter((c) => c.category === 'LABORATORY').map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} (PKR {c.price})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Radiology & Imaging (PACS)">
                {CATALOG_ITEMS.filter((c) => c.category === 'RADIOLOGY').map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} (PKR {c.price})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Clinical Procedures">
                {CATALOG_ITEMS.filter((c) => c.category === 'PROCEDURE').map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} (PKR {c.price})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Priority Urgency
            </label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
            >
              <option value="ROUTINE">Routine (Standard Turnaround)</option>
              <option value="URGENT">Urgent (Within 2 Hours)</option>
              <option value="STAT_EMERGENCY">STAT Emergency (Immediate)</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Dispatch Order
            </button>
          </div>
        </form>
      </div>

      {/* Orders Table */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
          <span>Active Diagnostic & Procedure Orders ({orders.length})</span>
          <span className="text-xs font-normal text-slate-400">Total Billed: PKR {(orders.reduce((acc, o) => acc + (o.costAmountMinorUnits ?? (o.price ? o.price * 100 : 0)), 0) / 100).toLocaleString()}</span>
        </h3>

        {orders.length === 0 ? (
          <div className="py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <Activity className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">No diagnostic orders placed for this encounter.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Category</th>
                  <th className="p-3">Investigation Name</th>
                  <th className="p-3">Barcode / Specimen</th>
                  <th className="p-3">Urgency</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions & PACS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {ord.category}
                      </span>
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{ord.testName}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{ord.testCode}</p>
                    </td>
                    <td className="p-3">
                      {ord.specimenBarcode ? (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-blue-600">
                          <Barcode className="w-3.5 h-3.5" />
                          {ord.specimenBarcode}
                        </div>
                      ) : (
                        <span className="text-slate-400">N/A (Non-specimen)</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          ord.urgency === 'STAT_EMERGENCY'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            : ord.urgency === 'URGENT'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {ord.urgency}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ord.status === 'REPORTED' || ord.status === 'VERIFIED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : ord.status === 'PROCESSING'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {ord.category === 'RADIOLOGY' && (
                          <button
                            onClick={() => setActiveDicomViewerOrder(ord)}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            PACS DICOM
                          </button>
                        )}
                        {ord.status === 'ORDERED' && (
                          <button
                            onClick={() =>
                              onUpdateOrderStatus(
                                ord.id,
                                'PROCESSING',
                                'Specimen accessioned into automated analyzer.'
                              )
                            }
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                          >
                            Sample Received
                          </button>
                        )}
                        {ord.status === 'PROCESSING' && (
                          <button
                            onClick={() =>
                              onUpdateOrderStatus(
                                ord.id,
                                'VERIFIED',
                                'Findings: Normal sinus rhythm with mild non-specific ST changes. Biomarkers within expected baseline.'
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                          >
                            Verify Results
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive Simulated PACS / DICOM Radiographic Viewer */}
      {activeDicomViewerOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2 text-indigo-400">
                  <Eye className="w-4 h-4" />
                  PACS Web DICOM Viewer — {activeDicomViewerOrder.testName}
                </h3>
                <p className="text-[11px] text-slate-400 font-mono">
                  Patient: {encounter.patientName} | MRN: {encounter.mrn} | Accession: ACC-{activeDicomViewerOrder.id.slice(-6)}
                </p>
              </div>

              {/* Tool Controls */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setZoomLevel((z) => Math.min(z + 15, 200))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoomLevel((z) => Math.max(z - 15, 50))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setInvert(!invert)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer font-bold"
                  title="Invert Grayscale Window"
                >
                  Invert
                </button>
                <button
                  onClick={() => setActiveDicomViewerOrder(null)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
                >
                  Close PACS
                </button>
              </div>
            </div>

            {/* Viewer Screen Simulation */}
            <div className="relative h-96 bg-black rounded-xl border border-slate-800 flex items-center justify-center overflow-hidden">
              <div
                className="transition-all duration-150 relative text-center"
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  filter: `brightness(${brightness}%) contrast(${contrast}%) ${invert ? 'invert(1)' : ''}`,
                }}
              >
                {/* Simulated Radiograph Canvas */}
                <div className="w-72 h-80 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950 rounded-xl border border-slate-700/60 p-4 shadow-inner flex flex-col justify-between text-left">
                  <div className="text-[10px] text-emerald-400 font-mono">
                    <p>HOSPITAL PACS STATION 04</p>
                    <p>KVp: 120 | mAs: 4.5</p>
                    <p>WL: 40 | WW: 400</p>
                  </div>
                  <div className="text-center text-slate-500 text-xs font-mono">
                    <p className="text-slate-400 font-bold">[ POSTEROANTERIOR CHEST RADIOGRAPH ]</p>
                    <p className="text-[10px] mt-1">Cardiothoracic ratio normal (0.48)</p>
                    <p className="text-[10px]">Costophrenic angles clear</p>
                  </div>
                  <div className="text-right text-[10px] text-amber-400 font-mono">
                    LATERAL: R
                  </div>
                </div>
              </div>

              {/* Overlay Metadata */}
              <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded text-[10px] font-mono text-slate-300">
                Zoom: {zoomLevel}% | Status: Verified by Radiologist Dr. M. Harris
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
