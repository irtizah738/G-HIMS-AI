'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  FlaskConical,
  Pill,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  Plus,
  ArrowRight,
  ShieldAlert,
  FileText,
  Activity,
  Layers,
  Sparkles,
  Eye,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function AncillaryServicesView() {
  const { patients, addLabOrder, stats } = useHospital();
  const [subModule, setSubModule] = useState<'lis' | 'ris' | 'pharmacy'>('lis');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Extract all lab orders from all patients
  const allLabOrders = patients.flatMap((p) =>
    p.encounters.flatMap((e) =>
      e.labOrders.map((lo) => ({
        ...lo,
        patientName: p.fullName,
        patientMrn: p.mrn,
        patientId: p.id,
        encounterId: e.id,
      }))
    )
  );

  // Simulated pharmacy inventory
  const [pharmacyStock, setPharmacyStock] = useState([
    { id: 'rx-1', name: 'Ticagrelor 90mg Tablets', category: 'Cardiovascular', stock: 140, minThreshold: 50, unitPrice: 12.0, status: 'In Stock' },
    { id: 'rx-2', name: 'Atorvastatin 80mg Tablets', category: 'Lipid Lowering', stock: 320, minThreshold: 100, unitPrice: 4.5, status: 'In Stock' },
    { id: 'rx-3', name: 'IV Nitroglycerin 50mg/10ml Vial', category: 'Emergency ICU', stock: 14, minThreshold: 20, unitPrice: 85.0, status: 'Low Stock' },
    { id: 'rx-4', name: 'Methylprednisolone IV 60mg', category: 'Steroids', stock: 45, minThreshold: 30, unitPrice: 35.0, status: 'In Stock' },
    { id: 'rx-5', name: 'Albuterol/Ipratropium Inhaler', category: 'Pulmonary', stock: 80, minThreshold: 40, unitPrice: 18.0, status: 'In Stock' },
    { id: 'rx-6', name: 'Morphine Sulfate 10mg/ml Ampoule', category: 'Controlled Substance', stock: 8, minThreshold: 15, unitPrice: 42.0, status: 'Critical Low' },
  ]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Sub-module selector */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Ancillary & Diagnostic Services Engine</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Laboratory Information System (LIS), Radiology (RIS/PACS), and Pharmacy Dispensing
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            onClick={() => setSubModule('lis')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              subModule === 'lis' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" /> LIS Laboratory ({allLabOrders.filter(o => o.category !== 'Radiology').length})
          </button>
          <button
            onClick={() => setSubModule('ris')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              subModule === 'ris' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Scan className="w-3.5 h-3.5" /> RIS / PACS Radiology
          </button>
          <button
            onClick={() => setSubModule('pharmacy')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              subModule === 'pharmacy' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Pill className="w-3.5 h-3.5" /> Pharmacy & Stock
          </button>
        </div>
      </div>

      {/* LIS Module */}
      {subModule === 'lis' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Active Laboratory Test Orders</h2>
                <p className="text-xs text-slate-500">Auto-routed via HL7 ORM/ORU bi-directional protocol</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Filter:</span>
                <input
                  type="text"
                  placeholder="Search test name, patient, or sample ID..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 w-64"
                />
              </div>
            </div>

            <div className="space-y-3">
              {allLabOrders.filter(o => o.category !== 'Radiology').map((order) => (
                <div key={order.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{order.testName}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 font-mono">
                        {order.sampleId}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">Patient: <strong>{order.patientName}</strong> ({order.patientMrn})</span>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {order.status === 'completed' ? 'Results Published' : 'In Analysis'}
                    </span>
                  </div>

                  {/* Results Parameters Table */}
                  {order.results && order.results.length > 0 && (
                    <div className="bg-white rounded-lg border border-slate-200 p-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 font-semibold border-b border-slate-100">
                            <th className="py-1 text-left">Analyte / Parameter</th>
                            <th className="py-1 text-left">Observed Value</th>
                            <th className="py-1 text-left">Unit</th>
                            <th className="py-1 text-left">Reference Range</th>
                            <th className="py-1 text-right">Flag</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {order.results.map((res, idx) => (
                            <tr key={idx} className="text-slate-800">
                              <td className="py-1.5 font-medium">{res.parameter}</td>
                              <td className="py-1.5 font-bold">{res.value}</td>
                              <td className="py-1.5 text-slate-500">{res.unit}</td>
                              <td className="py-1.5 text-slate-500">{res.normalRange}</td>
                              <td className="py-1.5 text-right">
                                {res.flag === 'High' && <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-700">HIGH</span>}
                                {res.flag === 'Low' && <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-700">LOW</span>}
                                {res.flag === 'Critical' && <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-600 text-white animate-pulse">CRITICAL</span>}
                                {(!res.flag || res.flag === 'Normal') && <span className="text-slate-400">Normal</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RIS / PACS Module */}
      {subModule === 'ris' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-slate-900">Radiology Information System (RIS / PACS)</h2>
            <p className="text-xs text-slate-500">Diagnostic imaging worklist and simulated DICOM viewer</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">Chest X-Ray (AP Portable)</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Verified by Radiologist</span>
              </div>
              <p className="text-xs text-slate-600">Patient: <strong>Elena Rostova</strong> (MRN: GH-2026-9812)</p>

              {/* Simulated DICOM Canvas Box */}
              <div className="w-full h-48 bg-slate-950 rounded-lg flex flex-col items-center justify-center text-slate-400 relative overflow-hidden border border-slate-800">
                <Scan className="w-12 h-12 text-slate-600 mb-2 animate-pulse" />
                <span className="text-xs font-mono text-slate-400">DICOM Series: 1.2.840.10008.5.1.4</span>
                <span className="text-[10px] text-slate-500">Window: 1500 / Level: -600 (Lung Window)</span>
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1">
                <strong className="block text-slate-900">Radiologist Impression:</strong>
                <p>No acute pneumothorax or pleural effusion. Moderate cardiomegaly noted, stable with prior study.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">Bedside 2D Echocardiogram</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Point-of-Care Ultrasound</span>
              </div>
              <p className="text-xs text-slate-600">Patient: <strong>Elena Rostova</strong> (MRN: GH-2026-9812)</p>

              <div className="w-full h-48 bg-slate-950 rounded-lg flex flex-col items-center justify-center text-slate-400 relative overflow-hidden border border-slate-800">
                <Activity className="w-12 h-12 text-blue-500 mb-2" />
                <span className="text-xs font-mono text-slate-400">Echocardiography Cine Loop</span>
                <span className="text-[10px] text-slate-500">EF: 52% | Color Doppler Active</span>
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1">
                <strong className="block text-slate-900">Cardiology Finding:</strong>
                <p>LVEF estimated at 50-55%. Mild hypokinesis of inferior wall. Bubble study negative for intracardiac shunt.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pharmacy Module */}
      {subModule === 'pharmacy' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Hospital Pharmacy Formulary & Stock Management</h2>
              <p className="text-xs text-slate-500">Automated stock decrement upon doctor prescription and billing reconciliation</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                2 Formulary Items Low
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-2.5 text-left">Medication Name & Dosage</th>
                  <th className="py-2.5 text-left">Category</th>
                  <th className="py-2.5 text-center">In Stock</th>
                  <th className="py-2.5 text-center">Min Threshold</th>
                  <th className="py-2.5 text-right">Unit Price</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pharmacyStock.map((med) => (
                  <tr key={med.id} className="text-slate-800">
                    <td className="py-3 font-bold text-slate-900">{med.name}</td>
                    <td className="py-3 text-slate-600">{med.category}</td>
                    <td className="py-3 text-center font-extrabold">{med.stock} units</td>
                    <td className="py-3 text-center text-slate-500">{med.minThreshold} units</td>
                    <td className="py-3 text-right font-semibold">{formatCurrency(med.unitPrice)}</td>
                    <td className="py-3 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        med.status === 'In Stock'
                          ? 'bg-emerald-100 text-emerald-800'
                          : med.status === 'Low Stock'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {med.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
