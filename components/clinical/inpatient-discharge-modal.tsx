'use client';

import React, { useState } from 'react';
import {
  FileCheck,
  Pill,
  DollarSign,
  Printer,
  X,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Stethoscope,
  ShieldCheck,
  Calendar,
  Clock,
  Heart,
  Activity,
  BedDouble,
  UserCheck,
  ArrowRight,
  Receipt,
  FileText,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Bed } from '@/types/inpatient-or';

export interface DischargePatientData {
  bedId: string;
  bedNumber: string;
  wardName: string;
  patientId: string;
  patientName: string;
  patientMRN: string;
  patientAge: number;
  patientGender: string;
  admissionDate: string;
  primaryDiagnosis: string;
  attendingDoctor: string;
  assignedNurse?: string;
}

interface InpatientDischargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientData: DischargePatientData;
  onDischargeComplete: (summary: DischargeCompletedSummary) => void;
}

export interface DischargeCompletedSummary {
  dischargeId?: string;
  patientId?: string;
  patientName?: string;
  patientMRN?: string;
  bedId?: string;
  bedNumber?: string;
  condition?: string;
  dischargeDate?: string;
  lengthOfStayDays?: number;
  attendingPhysician?: string;
  totalCharges?: number;
  reconciledMedications?: Array<{ name: string; action: 'discontinued' | 'take_home'; instructions?: string }>;
  dischargeInstructions?: string;
  followUpDate?: string;
  primaryDiagnosis?: string;
  dischargedBy?: string;
  disposition?: string;
  gatePassCode?: string;
  financialStatus?: string;
  summaryNotes?: string;
  dischargedAt?: string;
  dischargingPhysician?: string;
  reconciledMedicationsCount?: number;
  dischargeSummaryNote?: string;
  followUpInstructions?: string;
  financialClearanceApproved?: boolean;
  gatePassId?: string;
}

export function InpatientDischargeModal({
  isOpen,
  onClose,
  patientData,
  onDischargeComplete,
}: InpatientDischargeModalProps) {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);
  const [finalSummary, setFinalSummary] = useState<DischargeCompletedSummary | null>(null);

  // Form State
  const [condition, setCondition] = useState<'Recovered' | 'Improved' | 'Transferred' | 'Palliative' | 'AMA'>('Improved');
  const [destination, setDestination] = useState<string>('Home with Family Support');
  const [dischargeNotes, setDischargeNotes] = useState<string>(
    'Patient has achieved clinical stability. Afebrile for >48h, vital signs stable, surgical incision clean with no erythema or purulent drainage. Ambulation tolerated without assist.'
  );

  // Medication Reconciliation
  const [meds, setMeds] = useState([
    { id: 'm1', name: 'IV Ceftriaxone 1g Daily', route: 'IV Piggyback', action: 'discontinued', instructions: 'Course completed in hospital' },
    { id: 'm2', name: 'Oral Metoprolol Succinate 50mg QD', route: 'Oral', action: 'take_home', instructions: '1 tablet every morning with water. Monitor resting HR.' },
    { id: 'm3', name: 'Atorvastatin 40mg QHS', route: 'Oral', action: 'take_home', instructions: '1 tablet at bedtime daily.' },
    { id: 'm4', name: 'Enoxaparin 40mg SubQ Daily', route: 'Subcutaneous', action: 'discontinued', instructions: 'Transition to full ambulation' },
    { id: 'm5', name: 'Acetaminophen 650mg Q6H PRN Pain', route: 'Oral', action: 'take_home', instructions: 'Take as needed for mild-to-moderate surgical discomfort. Max 3g/24hr.' },
  ]);

  // Instructions & Follow-up
  const [followUpDate, setFollowUpDate] = useState<string>('2026-08-25');
  const [followUpClinic, setFollowUpClinic] = useState<string>('Cardiothoracic & Surgical Outpatient Clinic, Suite 302');
  const [dietActivity, setDietActivity] = useState<string>('Low-sodium cardiac diet. Sternal precautions: do not lift >5kg for 4 weeks.');
  const [redFlags, setRedFlags] = useState<string>('Immediate ER visit if: Fever >38.3°C, sudden shortness of breath, wound dehiscence, or chest pain recurrence.');

  // Financials
  const calculateDays = () => {
    try {
      const admissionTime = new Date(patientData.admissionDate).getTime();
      const now = Date.now();
      const days = Math.max(1, Math.round((now - admissionTime) / (1000 * 60 * 60 * 24)));
      return isNaN(days) ? 4 : days;
    } catch {
      return 4;
    }
  };
  const lengthOfStayDays = calculateDays();
  const dailyRoomRate = 950;
  const roomTotal = lengthOfStayDays * dailyRoomRate;
  const medsTotal = 420;
  const nursingCareTotal = lengthOfStayDays * 350;
  const totalBilled = roomTotal + medsTotal + nursingCareTotal;

  if (!isOpen) return null;

  const handleToggleMedAction = (id: string, newAction: 'discontinued' | 'take_home') => {
    setMeds((prev) =>
      prev.map((m) => (m.id === id ? { ...m, action: newAction } : m))
    );
  };

  const handleFinalizeDischarge = () => {
    setIsProcessing(true);

    const summary: DischargeCompletedSummary = {
      dischargeId: `DC-${Date.now().toString().slice(-6)}`,
      patientId: patientData.patientId,
      patientName: patientData.patientName,
      patientMRN: patientData.patientMRN,
      bedId: patientData.bedId,
      bedNumber: patientData.bedNumber,
      condition,
      dischargeDate: new Date().toISOString(),
      lengthOfStayDays,
      attendingPhysician: patientData.attendingDoctor,
      totalCharges: totalBilled,
      reconciledMedications: meds.map((m) => ({
        name: m.name,
        action: m.action as 'discontinued' | 'take_home',
        instructions: m.instructions,
      })),
      dischargeInstructions: `${dietActivity}\n${redFlags}`,
      followUpDate: `${followUpDate} at ${followUpClinic}`,
    };

    setTimeout(() => {
      setFinalSummary(summary);
      setIsDone(true);
      setIsProcessing(false);
      onDischargeComplete(summary);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center font-bold">
              <FileCheck className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Inpatient Clinical Discharge & Medication Reconciliation
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  {patientData.bedNumber} ({patientData.wardName})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Patient: <strong className="text-slate-900 dark:text-slate-200">{patientData.patientName}</strong> (
                {patientData.patientAge}y, {patientData.patientGender}) • MRN: <span className="font-mono">{patientData.patientMRN}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Tabs */}
        {!isDone && (
          <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setActiveStep(1)}
              className={`p-3 text-center border-b-2 transition-all cursor-pointer ${
                activeStep === 1
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              1. Clinical Summary
            </button>
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              className={`p-3 text-center border-b-2 transition-all cursor-pointer ${
                activeStep === 2
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              2. Med Reconciliation
            </button>
            <button
              type="button"
              onClick={() => setActiveStep(3)}
              className={`p-3 text-center border-b-2 transition-all cursor-pointer ${
                activeStep === 3
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              3. Instructions & Plan
            </button>
            <button
              type="button"
              onClick={() => setActiveStep(4)}
              className={`p-3 text-center border-b-2 transition-all cursor-pointer ${
                activeStep === 4
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              4. Finance & Release
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {isDone && finalSummary ? (
            /* Completed Gate Pass View */
            <div className="space-y-6 text-center py-4 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Discharge Finalized & Gate Pass Issued
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mt-1 text-xs">
                  Discharge ID: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{finalSummary.dischargeId}</span> • Bed {patientData.bedNumber} marked for cleaning & sanitization.
                </p>
              </div>

              {/* Printable Gate Pass Card */}
              <div className="p-6 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 text-left space-y-4 max-w-md mx-auto shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-wider">
                      G-HIMS Inpatient Gate Pass
                    </span>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">{patientData.patientName}</h4>
                  </div>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold rounded-lg text-[10px]">
                    CLEARED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">MRN</span>
                    <strong className="text-slate-800 dark:text-slate-200 font-mono">{patientData.patientMRN}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Length of Stay</span>
                    <strong className="text-slate-800 dark:text-slate-200">{finalSummary.lengthOfStayDays} Days</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Discharge Condition</span>
                    <strong className="text-slate-800 dark:text-slate-200">{finalSummary.condition}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Attending Physician</span>
                    <strong className="text-slate-800 dark:text-slate-200">{patientData.attendingDoctor}</strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-400">
                  <strong className="text-slate-900 dark:text-slate-100 block mb-1">Follow-Up Appointment:</strong>
                  {finalSummary.followUpDate}
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold text-slate-700 dark:text-slate-200 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Official Gate Pass</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all cursor-pointer"
                >
                  Close & Return to Census
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* STEP 1: Clinical Discharge Summary */}
              {activeStep === 1 && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Discharge Condition</label>
                      <select
                        value={condition}
                        onChange={(e: any) => setCondition(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-medium"
                      >
                        <option value="Improved">Improved (Expected Discharge)</option>
                        <option value="Recovered">Recovered / Normal Baseline</option>
                        <option value="Transferred">Transferred to Tertiary Center / Step-Down</option>
                        <option value="Palliative">Palliative / Hospice Care</option>
                        <option value="AMA">Left Against Medical Advice (AMA)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Discharge Destination</label>
                      <input
                        type="text"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Attending Physician Discharge Summary Note
                    </label>
                    <textarea
                      rows={3}
                      value={dischargeNotes}
                      onChange={(e) => setDischargeNotes(e.target.value)}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-sans"
                    />
                  </div>

                  <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-800 text-[11px] text-indigo-900 dark:text-indigo-300 flex items-center justify-between">
                    <span>
                      Primary Admission Diagnosis: <strong>{patientData.primaryDiagnosis}</strong>
                    </span>
                    <span>Length of Stay: <strong>{lengthOfStayDays} Days</strong></span>
                  </div>
                </div>
              )}

              {/* STEP 2: Medication Reconciliation */}
              {activeStep === 2 && (
                <div className="space-y-4 animate-in fade-in">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Pill className="w-4 h-4 text-purple-600" />
                      Inpatient Medication Reconciliation (MAR Review)
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Confirm which inpatient drugs are discontinued and which are converted to take-home prescriptions
                    </p>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="p-2.5">Medication & Route</th>
                          <th className="p-2.5">Discharge Plan</th>
                          <th className="p-2.5">Take-Home Instructions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {meds.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                            <td className="p-2.5">
                              <strong className="text-slate-900 dark:text-slate-100 block">{m.name}</strong>
                              <span className="text-[10px] text-slate-400">{m.route}</span>
                            </td>
                            <td className="p-2.5">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleMedAction(m.id, 'take_home')}
                                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                                    m.action === 'take_home'
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  Take-Home Rx
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleMedAction(m.id, 'discontinued')}
                                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                                    m.action === 'discontinued'
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  Discontinue
                                </button>
                              </div>
                            </td>
                            <td className="p-2.5 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                              {m.instructions}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* STEP 3: Instructions & Follow-up */}
              {activeStep === 3 && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Follow-Up Appointment Date</label>
                      <input
                        type="date"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Follow-Up Clinic & Doctor</label>
                      <input
                        type="text"
                        value={followUpClinic}
                        onChange={(e) => setFollowUpClinic(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Dietary & Activity Restrictions
                    </label>
                    <textarea
                      rows={2}
                      value={dietActivity}
                      onChange={(e) => setDietActivity(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 font-sans"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Red-Flag Emergency Symptoms for Immediate Return
                    </label>
                    <textarea
                      rows={2}
                      value={redFlags}
                      onChange={(e) => setRedFlags(e.target.value)}
                      className="w-full p-2.5 bg-rose-50/50 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-800 font-sans text-rose-900 dark:text-rose-200"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Accounting & Release */}
              {activeStep === 4 && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-emerald-600" />
                      Inpatient Final Bill & General Ledger Posting Preview
                    </h4>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span>Room & Board ({lengthOfStayDays} days @ {formatCurrency(dailyRoomRate)}/day):</span>
                        <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(roomTotal)}</strong>
                      </div>
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span>Inpatient Pharmacy & Dispensed Meds:</span>
                        <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(medsTotal)}</strong>
                      </div>
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span>Nursing & Monitored Telemetry Care:</span>
                        <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(nursingCareTotal)}</strong>
                      </div>
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm font-black text-slate-900 dark:text-slate-100">
                        <span>Total Inpatient Stay Charges:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">{formatCurrency(totalBilled)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <strong>Automated Bed Release & Revenue Cycle Guarantee:</strong> Finalizing will mark bed{' '}
                      <strong>{patientData.bedNumber}</strong> as <em>cleaning/sanitization</em>, release room occupancy locks,
                      and post the double-entry accounting journal lines to Hospital Accounts Receivable.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Navigation */}
        {!isDone && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => {
                if (activeStep > 1) setActiveStep((activeStep - 1) as any);
                else onClose();
              }}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              {activeStep === 1 ? 'Cancel' : 'Back'}
            </button>

            {activeStep < 4 ? (
              <button
                type="button"
                onClick={() => setActiveStep((activeStep + 1) as any)}
                className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                id="btn-confirm-discharge-finalize"
                disabled={isProcessing}
                onClick={handleFinalizeDischarge}
                className="px-6 py-2.5 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? (
                  <span>Reconciling & Clearing...</span>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    <span>Finalize Discharge & Issue Gate Pass</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
