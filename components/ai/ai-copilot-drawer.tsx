'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Sparkles,
  X,
  Send,
  Stethoscope,
  Receipt,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Mic,
  MicOff,
  CheckCircle2,
  ChevronRight,
  BedDouble,
  FlaskConical,
  DollarSign,
  FileSpreadsheet,
  Zap,
  Activity,
  Plus,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function AiCopilotDrawer() {
  const {
    copilotOpen,
    setCopilotOpen,
    patients,
    beds,
    staff,
    mismatches,
    selectedPatientId,
    addClinicalNote,
    admitPatientToBed,
    addLabOrder,
    reconcileMismatch,
    setActiveTab,
  } = useHospital();

  const [activeTabMode, setActiveTabMode] = useState<'scribe' | 'quick-actions'>('scribe');
  const [noteInput, setNoteInput] = useState(
    'Patient arrived with 4-hour acute retrosternal chest pain. Bedside 2D Echocardiogram performed showing mild inferior wall hypokinesis. Started IV Nitroglycerin infusion 20mcg/min over 4 hours. Administered IV Morphine 4mg and ordered stat Troponin I panel.'
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Sub-Action Modal in Copilot
  const [activeModal, setActiveModal] = useState<'admit' | 'lab' | 'billing' | null>(null);

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

  const patient = patients.find((p) => p.id === selectedPatientId) || patients[0];
  const availableBeds = beds.filter((b) => b.status === 'available');
  const pendingMismatches = mismatches.filter((m) => m.status === 'pending_review');
  const doctorsList = staff.filter((s) => s.role === 'Physician' || s.role === 'Surgeon');
  const nursesList = staff.filter((s) => s.role === 'Nurse');

  if (!copilotOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/gemini/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteText: noteInput,
          patientContext: {
            name: patient?.fullName,
            mrn: patient?.mrn,
            age: patient?.age,
            allergies: patient?.allergies,
            chronicConditions: patient?.chronicConditions,
          },
        }),
      });
      const data = await res.json();
      setAnalysisResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyToPatient = () => {
    if (!patient || !analysisResult) return;
    addClinicalNote(patient.id, {
      author: 'Dr. Sarah Jenkins (via AI Copilot)',
      role: 'Attending Physician',
      category: 'SOAP',
      content: noteInput,
      aiStructuredData: analysisResult,
    });
    showToast('Clinical note & billing items logged to patient chart');
    setCopilotOpen(false);
  };

  const handleAdmitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitPatientId || !admitBedId) {
      showToast('Please select both a patient and an available bed.');
      return;
    }

    admitPatientToBed(admitBedId, admitPatientId, admitDoctor, admitNurse);
    const bed = beds.find((b) => b.id === admitBedId);
    const targetPat = patients.find((p) => p.id === admitPatientId);

    showToast(`Patient ${targetPat?.fullName || 'Patient'} admitted to ${bed?.bedNumber || 'Bed'}`);
    setActiveModal(null);
  };

  const handleLabSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labPatientId) {
      showToast('Please select a patient.');
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

    const targetPat = patients.find((p) => p.id === labPatientId);
    showToast(`Lab order "${labTestName}" dispatched for ${targetPat?.fullName || 'Patient'}`);
    setActiveModal(null);
  };

  const handleBatchReconcile = () => {
    pendingMismatches.forEach((m) => reconcileMismatch(m.id));
    showToast(`Reconciled all ${pendingMismatches.length} unbilled items!`);
    setActiveModal(null);
  };

  return (
    <>
      {/* Mobile / Tablet Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 transition-opacity cursor-pointer animate-in fade-in duration-200"
        onClick={() => setCopilotOpen(false)}
        aria-hidden="true"
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 sm:right-[500px] z-60 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-in fade-in slide-in-from-top-5 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Copilot Dialog Box / Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[500px] max-w-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col font-sans transition-all animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">G-HIMS AI Clinical Copilot</h3>
              <p className="text-[10px] text-blue-200">Point-of-Care Scribe, Decision Support & Quick Actions</p>
            </div>
          </div>
          <button
            onClick={() => setCopilotOpen(false)}
            className="min-w-[36px] min-h-[36px] p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center cursor-pointer"
            aria-label="Close AI Copilot"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector: Scribe vs Quick Actions */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-1">
          <button
            onClick={() => setActiveTabMode('scribe')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTabMode === 'scribe'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Clinical Scribe & AI
          </button>
          <button
            onClick={() => setActiveTabMode('quick-actions')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTabMode === 'quick-actions'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Quick Actions
            {pendingMismatches.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            )}
          </button>
        </div>

        {/* Target Patient Context Tag */}
        <div className="px-4 py-2.5 bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/50 flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            Target Patient: <strong className="text-slate-900 dark:text-slate-100">{patient?.fullName}</strong> ({patient?.mrn})
          </span>
          <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded">
            Age: {patient?.age}y • {patient?.gender}
          </span>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* TAB 1: Scribe & AI Intelligence */}
          {activeTabMode === 'scribe' && (
            <div className="space-y-4">
              {/* Quick Actions Shortcuts Bar */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-500" /> Quick Point-of-Care Actions
                  </span>
                  <button
                    onClick={() => setActiveTabMode('quick-actions')}
                    className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-0.5"
                  >
                    View All <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setAdmitPatientId(patient?.id || patients[0]?.id || '');
                      setAdmitBedId(availableBeds[0]?.id || '');
                      setActiveModal('admit');
                    }}
                    className="p-2 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-left hover:border-blue-500 transition-all flex flex-col gap-1 cursor-pointer"
                  >
                    <BedDouble className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="font-bold text-[11px] text-slate-900 dark:text-white leading-tight">Admit to Bed</span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400">{availableBeds.length} available</span>
                  </button>

                  <button
                    onClick={() => {
                      setLabPatientId(patient?.id || patients[0]?.id || '');
                      setActiveModal('lab');
                    }}
                    className="p-2 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-left hover:border-emerald-500 transition-all flex flex-col gap-1 cursor-pointer"
                  >
                    <FlaskConical className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-bold text-[11px] text-slate-900 dark:text-white leading-tight">Order Lab</span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400">HL7 LIS dispatch</span>
                  </button>

                  <button
                    onClick={() => setActiveModal('billing')}
                    className="p-2 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-left hover:border-amber-500 transition-all flex flex-col gap-1 cursor-pointer relative"
                  >
                    <DollarSign className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="font-bold text-[11px] text-slate-900 dark:text-white leading-tight">Billing Review</span>
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">{pendingMismatches.length} unbilled</span>
                  </button>
                </div>
              </div>

              {/* Ambient Dictation Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Doctor Dictation / Clinical Scribe Input
                  </label>
                  <button
                    onClick={() => setIsRecording(!isRecording)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      isRecording ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {isRecording ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                    {isRecording ? 'Listening...' : 'Voice Dictate'}
                  </button>
                </div>

                <textarea
                  rows={4}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Type or dictate clinical findings, procedures, and prescriptions..."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-750 transition-all font-sans leading-relaxed"
                />

                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !noteInput.trim()}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer min-h-[44px]"
                >
                  {isAnalyzing ? (
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin" /> Structuring SOAP & Billing Codes...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Parse Clinical Note & Cross-Audit Billing
                    </span>
                  )}
                </button>
              </div>

              {/* Structured Results */}
              {analysisResult && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                    <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider block">
                      Structured Clinical Extraction
                    </span>

                    {analysisResult.diagnoses && (
                      <div>
                        <span className="font-bold text-slate-700 dark:text-slate-300 block">Diagnoses (ICD-10):</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {analysisResult.diagnoses.map((d: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[11px] font-medium text-slate-800 dark:text-slate-200">
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysisResult.medicationsPrescribed && analysisResult.medicationsPrescribed.length > 0 && (
                      <div>
                        <span className="font-bold text-slate-700 dark:text-slate-300 block">Prescriptions:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {analysisResult.medicationsPrescribed.map((m: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded text-[11px]">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Auto-extracted Billing Codes */}
                  {analysisResult.billingCodes && analysisResult.billingCodes.length > 0 && (
                    <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1">
                          <Receipt className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Detected Billable CPT Procedures
                        </span>
                        <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                          +{formatCurrency(analysisResult.billingCodes.reduce((sum: number, c: any) => sum + (c.fee || 0), 0))}
                        </span>
                      </div>

                      <div className="space-y-1">
                        {analysisResult.billingCodes.map((code: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded border border-emerald-200 dark:border-emerald-800/80 text-xs">
                            <div>
                              <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">CPT {code.code}</span>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400">{code.description}</p>
                            </div>
                            <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(code.fee || 0)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Apply Button */}
                  <button
                    onClick={handleApplyToPatient}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer min-h-[44px]"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Save Note & Push Unbilled Items to Audit Ledger
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Full Quick Actions Options */}
          {activeTabMode === 'quick-actions' && (
            <div className="space-y-3">
              <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl">
                <h4 className="font-bold text-indigo-950 dark:text-indigo-200 text-xs mb-1">
                  Point-of-Care Quick Workflows
                </h4>
                <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300">
                  Execute direct clinical orders, admissions, reconciliations, and external hub integrations without leaving this screen.
                </p>
              </div>

              {/* Action 1: Inpatient Admission */}
              <div
                onClick={() => {
                  setAdmitPatientId(patient?.id || patients[0]?.id || '');
                  setAdmitBedId(availableBeds[0]?.id || '');
                  setActiveModal('admit');
                }}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <BedDouble className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      Admit Patient to Bed
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Assign ward bed, attending doctor, and protocol ({availableBeds.length} beds free)
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Action 2: Diagnostic Lab Order */}
              <div
                onClick={() => {
                  setLabPatientId(patient?.id || patients[0]?.id || '');
                  setActiveModal('lab');
                }}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 transition-all flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FlaskConical className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      New Diagnostic Lab Order
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Dispatch stat blood, urine, or pathology order to LIS
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Action 3: Billing & Revenue Review */}
              <div
                onClick={() => setActiveModal('billing')}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500 transition-all flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                      Billing & Revenue Audit ({pendingMismatches.length})
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Review uncaptured documentation items and prevent revenue leakage
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Action 4: Google Sheets & Drive Hub */}
              <div
                onClick={() => {
                  setActiveTab('sheets');
                  setCopilotOpen(false);
                }}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-teal-500 dark:hover:border-teal-500 transition-all flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      Google Sheets Live Interop
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sync census, roster rosters, and billing batches to Sheets
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Action 5: Emergency Triage Protocol */}
              <div
                onClick={() => {
                  setActiveTab('emergency');
                  setCopilotOpen(false);
                }}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 transition-all flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                      Emergency Room Triage (ESI 1-5)
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Rapid trauma intake and resus bay allocation
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SUB-MODAL 1: Admit Patient */}
      {activeModal === 'admit' && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400">
                  <BedDouble className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Inpatient Admission</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Assign bed, attending physician, and care protocols</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdmitSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Select Patient</label>
                <select
                  value={admitPatientId}
                  onChange={(e) => setAdmitPatientId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-750"
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

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Assign Bed ({availableBeds.length} Available)
                </label>
                <select
                  value={admitBedId}
                  onChange={(e) => setAdmitBedId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-750"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Attending Physician</label>
                  <select
                    value={admitDoctor}
                    onChange={(e) => setAdmitDoctor(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    {doctorsList.map((doc) => (
                      <option key={doc.id} value={doc.fullName}>
                        {doc.fullName} ({doc.department})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Primary Staff Nurse</label>
                  <select
                    value={admitNurse}
                    onChange={(e) => setAdmitNurse(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    {nursesList.map((nurse) => (
                      <option key={nurse.id} value={nurse.fullName}>
                        {nurse.fullName} ({nurse.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Triage Priority & Admission Indication</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {['Emergency (Level 1)', 'Urgent (Level 2)', 'Elective (Level 3)'].map((level) => (
                    <button
                      type="button"
                      key={level}
                      onClick={() => setAdmitAcuity(level)}
                      className={`p-2 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                        admitAcuity === level
                          ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
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
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md cursor-pointer"
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUB-MODAL 2: New Lab Order */}
      {activeModal === 'lab' && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Dispatch Diagnostic Lab Order</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Auto-routes to LIS analyzer via HL7 ORM^O01 socket</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLabSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Select Patient</label>
                <select
                  value={labPatientId}
                  onChange={(e) => setLabPatientId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-750"
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
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Diagnostic Test Panel</label>
                <select
                  value={labTestName}
                  onChange={(e) => setLabTestName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200"
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
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Laboratory Discipline</label>
                  <select
                    value={labCategory}
                    onChange={(e) => setLabCategory(e.target.value as any)}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    <option value="Biochemistry">Biochemistry</option>
                    <option value="Hematology">Hematology</option>
                    <option value="Microbiology">Microbiology</option>
                    <option value="Radiology">Radiology / PACS</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Urgency Priority</label>
                  <select
                    value={labPriority}
                    onChange={(e) => setLabPriority(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    <option value="STAT">STAT (Turnaround &lt; 30 min)</option>
                    <option value="Urgent">Urgent (Turnaround 2h)</option>
                    <option value="Routine">Routine (Same Day)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Clinical Indication</label>
                <input
                  type="text"
                  value={labIndication}
                  onChange={(e) => setLabIndication(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                  placeholder="Diagnostic rationale for medical necessity..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md cursor-pointer"
                >
                  Dispatch to LIS
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUB-MODAL 3: Billing & Revenue Review */}
      {activeModal === 'billing' && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Point-of-Care Billing Review</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Uncaptured procedures detected in physician clinical documentation</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs">
                <div>
                  <p className="font-extrabold text-amber-900 dark:text-amber-200">
                    {pendingMismatches.length} Unbilled Documentation Discrepancies
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Total Estimated Recoverable: {formatCurrency(pendingMismatches.reduce((sum, m) => sum + m.estimatedRecoverableRevenue, 0))}
                  </p>
                </div>
                {pendingMismatches.length > 0 && (
                  <button
                    onClick={handleBatchReconcile}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Reconcile All
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {pendingMismatches.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="font-bold text-xs">No pending revenue leakage items!</p>
                    <p className="text-[11px]">All documented clinical notes and orders are reconciled with invoices.</p>
                  </div>
                ) : (
                  pendingMismatches.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">{item.documentedItem}</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-bold border border-blue-200 dark:border-blue-700">
                            {item.suggestedCptCode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                          &quot;{item.evidenceSnippet}&quot;
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Patient: {item.patientName} • Confidence: {Math.round(item.confidenceScore * 100)}%
                        </p>
                      </div>

                      <div className="text-right shrink-0 space-y-1.5">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 block">
                          +{formatCurrency(item.estimatedRecoverableRevenue)}
                        </span>
                        <button
                          onClick={() => {
                            reconcileMismatch(item.id);
                            showToast(`Reconciled +$${item.estimatedRecoverableRevenue} to invoice`);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-xs cursor-pointer"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  setActiveTab('billing');
                  setActiveModal(null);
                  setCopilotOpen(false);
                }}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Open Full Billing ERP Module <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
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
