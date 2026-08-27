'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Plus,
  BedDouble,
  FlaskConical,
  DollarSign,
  UserPlus,
  CheckCircle2,
  X,
  Sparkles,
  AlertTriangle,
  FileCheck,
  Stethoscope,
  ChevronRight,
  ShieldCheck,
  Zap,
  FileSpreadsheet,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function QuickAccessToolbar() {
  const {
    patients,
    beds,
    staff,
    mismatches,
    admitPatientToBed,
    addLabOrder,
    registerNewPatient,
    reconcileMismatch,
    setActiveTab,
  } = useHospital();

  const [fabOpen, setFabOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'admit' | 'lab' | 'billing' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form states for Admit Patient Modal
  const [admitPatientId, setAdmitPatientId] = useState('');
  const [admitBedId, setAdmitBedId] = useState('');
  const [admitDoctor, setAdmitDoctor] = useState('Dr. Sarah Jenkins');
  const [admitNurse, setAdmitNurse] = useState('Nurse John Davis');
  const [admitReason, setAdmitReason] = useState('');
  const [admitAcuity, setAdmitAcuity] = useState('Urgent');

  // Form states for Lab Order Modal
  const [labPatientId, setLabPatientId] = useState('');
  const [labTestName, setLabTestName] = useState('High-Sensitivity Troponin I & CK-MB');
  const [labCategory, setLabCategory] = useState<'Biochemistry' | 'Hematology' | 'Microbiology' | 'Radiology'>('Biochemistry');
  const [labPriority, setLabPriority] = useState('STAT');
  const [labIndication, setLabIndication] = useState('Acute chest tightness with ischemic ECG alterations');

  const availableBeds = beds.filter((b) => b.status === 'available');
  const pendingMismatches = mismatches.filter((m) => m.status === 'pending_review');
  const doctorsList = staff.filter((s) => s.role === 'Physician' || s.role === 'Surgeon');
  const nursesList = staff.filter((s) => s.role === 'Nurse');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleAdmitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitPatientId || !admitBedId) {
      alert('Please select both a patient and an available bed.');
      return;
    }

    admitPatientToBed(admitBedId, admitPatientId, admitDoctor, admitNurse);
    const bed = beds.find((b) => b.id === admitBedId);
    const patient = patients.find((p) => p.id === admitPatientId);

    showToast(`Patient ${patient?.fullName || 'Patient'} successfully admitted to ${bed?.bedNumber || 'Bed'}`);
    setActiveModal(null);
    setFabOpen(false);
  };

  const handleLabSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labPatientId) {
      alert('Please select a patient.');
      return;
    }

    const testCosts: Record<string, number> = {
      'High-Sensitivity Troponin I & CK-MB': 140,
      'Complete Blood Count (CBC) with Differential': 45,
      'Arterial Blood Gas (ABG) & Lactate': 85,
      'Comprehensive Metabolic Panel (CMP)': 65,
      'Coagulation Profile (PT/INR, aPTT)': 55,
      'Lipid Profile & hs-CRP': 70,
    };

    addLabOrder(labPatientId, {
      testName: labTestName,
      category: labCategory,
      status: 'ordered',
      sampleId: `SMP-${Math.floor(1000 + Math.random() * 9000)}`,
      technician: 'On-Call LIS Tech',
      cost: testCosts[labTestName] || 60,
    });

    const patient = patients.find((p) => p.id === labPatientId);
    showToast(`Lab order "${labTestName}" dispatched to LIS for ${patient?.fullName || 'Patient'}`);
    setActiveModal(null);
    setFabOpen(false);
  };

  const handleBatchReconcile = () => {
    pendingMismatches.forEach((m) => reconcileMismatch(m.id));
    showToast(`Successfully reconciled all ${pendingMismatches.length} unbilled items!`);
    setActiveModal(null);
    setFabOpen(false);
  };

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-24 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Action Speed Dial / Quick Toolbar */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2.5">
        {/* Speed Dial Actions */}
        {fabOpen && (
          <div className="flex flex-col items-end gap-2 mb-1 animate-in fade-in slide-in-from-bottom-3 duration-200">
            {/* Quick Action 1: Admit Patient */}
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold shadow-md border border-slate-700 whitespace-nowrap">
                Admit Patient to Bed
              </span>
              <button
                id="fab-action-admit"
                onClick={() => {
                  setAdmitPatientId(patients[0]?.id || '');
                  setAdmitBedId(availableBeds[0]?.id || '');
                  setActiveModal('admit');
                }}
                className="w-12 h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-blue-400 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title="Admit Patient"
              >
                <BedDouble className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action 2: New Lab Order */}
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold shadow-md border border-slate-700 whitespace-nowrap">
                New Lab / Diagnostic Order
              </span>
              <button
                id="fab-action-lab"
                onClick={() => {
                  setLabPatientId(patients[0]?.id || '');
                  setActiveModal('lab');
                }}
                className="w-12 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg border border-emerald-400 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title="New Lab Order"
              >
                <FlaskConical className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action 3: Billing & Revenue Review */}
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold shadow-md border border-slate-700 whitespace-nowrap flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                Billing Review ({pendingMismatches.length})
              </span>
              <button
                id="fab-action-billing"
                onClick={() => setActiveModal('billing')}
                className="w-12 h-12 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center shadow-lg border border-amber-400 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title="Billing Review"
              >
                <DollarSign className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action 4: Google Sheets Live Interop */}
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold shadow-md border border-slate-700 whitespace-nowrap">
                Google Sheets Hub
              </span>
              <button
                id="fab-action-sheets"
                onClick={() => {
                  setActiveTab('sheets');
                  setFabOpen(false);
                }}
                className="w-12 h-12 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center shadow-lg border border-teal-400 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title="Google Sheets & Drive Hub"
              >
                <FileSpreadsheet className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Master Floating Trigger Button */}
        <button
          id="btn-main-fab-toggle"
          onClick={() => setFabOpen(!fabOpen)}
          className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-xl transition-all duration-200 cursor-pointer ${
            fabOpen
              ? 'bg-slate-900 rotate-45 border border-slate-700'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-500/25 active:scale-95'
          }`}
          title="Quick Workflow Actions (Admit, Order Labs, Billing)"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>

      {/* MODAL 1: Admit Patient */}
      {activeModal === 'admit' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
                  <BedDouble className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Inpatient Admission</h3>
                  <p className="text-xs text-slate-500">Assign bed, attending physician, and care protocols</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdmitSubmit} className="space-y-4 text-xs">
              {/* Select Patient */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Patient</label>
                <select
                  value={admitPatientId}
                  onChange={(e) => setAdmitPatientId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-500"
                  required
                >
                  <option value="" disabled>Choose patient...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn}) • {p.age}y {p.gender}
                    </option>
                  ))}
                </select>
              </div>

              {/* Select Available Bed */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Assign Bed ({availableBeds.length} Available)
                </label>
                <select
                  value={admitBedId}
                  onChange={(e) => setAdmitBedId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-500"
                  required
                >
                  <option value="" disabled>Choose ward bed...</option>
                  {availableBeds.map((b) => (
                    <option key={b.id} value={b.id}>
                      Bed {b.bedNumber} — {b.ward} ({b.room})
                    </option>
                  ))}
                </select>
              </div>

              {/* Physician & Nurse Assignment */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Attending Physician</label>
                  <select
                    value={admitDoctor}
                    onChange={(e) => setAdmitDoctor(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800"
                  >
                    {doctorsList.map((doc) => (
                      <option key={doc.id} value={doc.fullName}>
                        {doc.fullName} ({doc.department})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Primary Staff Nurse</label>
                  <select
                    value={admitNurse}
                    onChange={(e) => setAdmitNurse(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800"
                  >
                    {nursesList.map((nurse) => (
                      <option key={nurse.id} value={nurse.fullName}>
                        {nurse.fullName} ({nurse.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Acuity Level & Reason */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Triage Priority & Admission Indication</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {['Emergency (Level 1)', 'Urgent (Level 2)', 'Elective (Level 3)'].map((level) => (
                    <button
                      type="button"
                      key={level}
                      onClick={() => setAdmitAcuity(level)}
                      className={`p-2 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                        admitAcuity === level
                          ? 'bg-blue-50 text-blue-700 border-blue-300'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {level.split(' ')[0]}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={admitReason}
                  onChange={(e) => setAdmitReason(e.target.value)}
                  placeholder="e.g. Post-cardiac catheterization monitoring, IV titrations"
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md"
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: New Lab Order */}
      {activeModal === 'lab' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Dispatch Diagnostic Lab Order</h3>
                  <p className="text-xs text-slate-500">Auto-routes to LIS analyzer via HL7 ORM^O01 socket</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLabSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Patient</label>
                <select
                  value={labPatientId}
                  onChange={(e) => setLabPatientId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:bg-white focus:outline-hidden focus:border-emerald-500"
                  required
                >
                  <option value="" disabled>Select patient record...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn}) • Bed: {p.activeBedId || 'Outpatient'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Diagnostic Test Panel</label>
                <select
                  value={labTestName}
                  onChange={(e) => setLabTestName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800"
                >
                  <option>High-Sensitivity Troponin I & CK-MB ($140)</option>
                  <option>Complete Blood Count (CBC) with Differential ($45)</option>
                  <option>Arterial Blood Gas (ABG) & Lactate ($85)</option>
                  <option>Comprehensive Metabolic Panel (CMP) ($65)</option>
                  <option>Coagulation Profile (PT/INR, aPTT) ($55)</option>
                  <option>Lipid Profile & hs-CRP ($70)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Laboratory Discipline</label>
                  <select
                    value={labCategory}
                    onChange={(e) => setLabCategory(e.target.value as any)}
                    className="w-full p-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800"
                  >
                    <option value="Biochemistry">Biochemistry</option>
                    <option value="Hematology">Hematology</option>
                    <option value="Microbiology">Microbiology</option>
                    <option value="Radiology">Radiology / PACS</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Urgency Priority</label>
                  <select
                    value={labPriority}
                    onChange={(e) => setLabPriority(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800"
                  >
                    <option value="STAT">STAT (Turnaround &lt; 30 min)</option>
                    <option value="Urgent">Urgent (Turnaround 2h)</option>
                    <option value="Routine">Routine (Same Day)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Clinical Indication</label>
                <input
                  type="text"
                  value={labIndication}
                  onChange={(e) => setLabIndication(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400"
                  placeholder="Diagnostic rationale for medical necessity..."
                />
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200/80 text-[11px] text-emerald-800 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Dispatches real-time HL7 v2 ORM message with automated barcode specimen ID generation.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md"
                >
                  Dispatch to LIS
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Billing & Revenue Review */}
      {activeModal === 'billing' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Point-of-Care Billing Review</h3>
                  <p className="text-xs text-slate-500">Uncaptured procedures detected in physician clinical documentation</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs">
                <div>
                  <p className="font-extrabold text-amber-900">
                    {pendingMismatches.length} Unbilled Documentation Discrepancies
                  </p>
                  <p className="text-[11px] text-amber-700">
                    Total Estimated Recoverable: {formatCurrency(pendingMismatches.reduce((sum, m) => sum + m.estimatedRecoverableRevenue, 0))}
                  </p>
                </div>
                <button
                  onClick={handleBatchReconcile}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Reconcile All
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {pendingMismatches.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{item.documentedItem}</span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px] font-bold border border-blue-200">
                          {item.suggestedCptCode}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 italic">
                        &quot;{item.evidenceSnippet}&quot;
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Patient: {item.patientName} • Confidence: {Math.round(item.confidenceScore * 100)}%
                      </p>
                    </div>

                    <div className="text-right shrink-0 space-y-1.5">
                      <span className="font-bold text-emerald-600 block">
                        +{formatCurrency(item.estimatedRecoverableRevenue)}
                      </span>
                      <button
                        onClick={() => {
                          reconcileMismatch(item.id);
                          showToast(`Reconciled +$${item.estimatedRecoverableRevenue} to invoice`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-2xs cursor-pointer"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                onClick={() => {
                  setActiveTab('billing');
                  setActiveModal(null);
                  setFabOpen(false);
                }}
                className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
              >
                Open Full Billing ERP Module <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
