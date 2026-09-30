'use client';

import React, { useEffect, useState } from 'react';
import {
  LogOut,
  X,
  FileCheck,
  Receipt,
  Pill,
  Stethoscope,
  ClipboardList,
  Sparkles,
  ShieldCheck,
  Building2,
  User,
} from 'lucide-react';
import { Bed } from '@/types/inpatient-or';

interface DischargeConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bed: Bed | null;
  onConfirmDischarge: (formData: {
    dischargedBy: string;
    disposition: string;
    notes: string;
    followUpInstructions: string;
    clearanceChecks: Record<string, boolean>;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export const DischargeConfirmationModal: React.FC<DischargeConfirmationModalProps> = ({
  isOpen,
  onClose,
  bed,
  onConfirmDischarge,
  isSubmitting,
}) => {
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');

  // Billing and chart clearance checklist requirements
  const [clearances, setClearances] = useState({
    chartSummarySigned: false,
    billingFolioReconciled: false,
    medRecDelivered: false,
    diagnosticsReviewed: false,
    nursingHandoverComplete: false,
  });

  useEffect(() => {
    if (!isOpen || !bed) return;

    // Never carry discharge inputs or review prompts across patients/encounters.
    setDisposition('');
    setNotes('');
    setFollowUpInstructions('');
    setClearances({
      chartSummarySigned: false,
      billingFolioReconciled: false,
      medRecDelivered: false,
      diagnosticsReviewed: false,
      nursingHandoverComplete: false,
    });
  }, [isOpen, bed?.id]);

  if (!isOpen || !bed) return null;

  const allCleared = Object.values(clearances).every(Boolean);

  const toggleClearance = (key: keyof typeof clearances) => {
    setClearances((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllClearances = (state: boolean) => {
    setClearances({
      chartSummarySigned: state,
      billingFolioReconciled: state,
      medRecDelivered: state,
      diagnosticsReviewed: state,
      nursingHandoverComplete: state,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposition || !notes.trim() || !followUpInstructions.trim()) return;

    await onConfirmDischarge({
      dischargedBy: bed.assignedDoctor || '',
      disposition,
      notes: notes.trim(),
      followUpInstructions: followUpInstructions.trim(),
      clearanceChecks: clearances,
    });
  };

  return (
    <div
      id="discharge-confirmation-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto"
    >
      <div
        id="discharge-confirmation-modal"
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900 my-8"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <LogOut className="h-4 w-4" />
              <span>Pre-Discharge Clearance Verification</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
              Discharge Patient & Release Bed
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Patient & Bed Summary Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs dark:border-slate-700/70 dark:bg-slate-800/80">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {bed.patientName}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  MRN: <strong className="text-slate-700 dark:text-slate-200">{bed.patientMRN}</strong> | {bed.patientAge || 52}y • {bed.patientGender || 'Male'}
                </div>
              </div>

              <div className="text-right">
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  <Building2 className="h-3 w-3" />
                  {bed.wardName} — Bed {bed.bedNumber}
                </span>
                <div className="mt-1 text-[10px] text-slate-400">{bed.roomNumber}</div>
              </div>
            </div>
          </div>

          {/* Clinical & Operational Review Prompts */}
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                  Pre-Discharge Review Prompts
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setAllClearances(!allCleared)}
                className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline"
              >
                {allCleared ? 'Uncheck All' : 'Select All Clearances'}
              </button>
            </div>

            <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/80">
              These checkboxes are review prompts only. They do not authorize discharge. The governed workflow first persists the signed discharge summary as an immutable clinical event, then requires the current Patient 360 / CI-7 assessment to be reviewed and acknowledged by a credentialed clinician before the final discharge command can execute. Financial status is tracked separately from clinical discharge safety.
            </p>

            <div className="mt-3 space-y-2 text-xs">
              {/* Item 1: Chart Summary */}
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 cursor-pointer hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-850 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={clearances.chartSummarySigned}
                  onChange={() => toggleClearance('chartSummarySigned')}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <FileCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Clinical Chart & Discharge Summary Signed</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Attending physician diagnosis, progress notes, and formal discharge order finalized in chart.
                  </div>
                </div>
              </label>

              {/* Item 2: Billing Reconciled */}
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 cursor-pointer hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-850 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={clearances.billingFolioReconciled}
                  onChange={() => toggleClearance('billingFolioReconciled')}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Receipt className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Inpatient Billing & 80/20 Co-Pay Reconciled</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Room charges, ancillary medical fees, and insurance pre-authorization folio balanced to zero.
                  </div>
                </div>
              </label>

              {/* Item 3: Medication Reconciliation */}
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 cursor-pointer hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-850 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={clearances.medRecDelivered}
                  onChange={() => toggleClearance('medRecDelivered')}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Pill className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                    <span>Medication Reconciliation & Outpatient Rx Dispensed</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Pharmacy take-home medications dispensed, dosage schedule and counseling reviewed with patient.
                  </div>
                </div>
              </label>

              {/* Item 4: Diagnostics Reviewed */}
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 cursor-pointer hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-850 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={clearances.diagnosticsReviewed}
                  onChange={() => toggleClearance('diagnosticsReviewed')}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Stethoscope className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                    <span>Diagnostics & Pending Lab Results Signed Off</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    All blood panels, cultures, and post-op imaging verified free of unresolved critical findings.
                  </div>
                </div>
              </label>

              {/* Item 5: Nursing Handover */}
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 cursor-pointer hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-850 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={clearances.nursingHandoverComplete}
                  onChange={() => toggleClearance('nursingHandoverComplete')}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <ClipboardList className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Discharge Nursing Handover & Follow-Up Appt Scheduled</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    IV lines removed, vitals stable for discharge, outpatient follow-up booked.
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Authoritative discharge safety is enforced by the server even if these prompts are checked.</span>
            </div>
          </div>

          {/* Discharging Staff & Notes */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Discharge Disposition *
              </label>
              <select
                required
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Select disposition</option>
                <option value="HOME_OR_SELF_CARE">Home / Self Care</option>
                <option value="TRANSFER_TO_FACILITY">Transfer to Another Facility</option>
                <option value="HOSPICE">Hospice / Palliative Facility</option>
                <option value="LEFT_AGAINST_MEDICAL_ADVICE">Left Against Medical Advice</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-[11px] text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
              The authenticated clinician submitting this command is recorded by the server as the discharge actor. Displayed staff names cannot override audit provenance.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Discharge Summary *
              </label>
              <textarea
                required
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Follow-Up Instructions *
              </label>
              <textarea
                required
                rows={2}
                value={followUpInstructions}
                onChange={(e) => setFollowUpInstructions(e.target.value)}
                placeholder="Follow-up appointment, pending-result ownership, medication/return precautions..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Automatic Housekeeping Warning */}
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Automated Workflow:</strong> Bed {bed.bedNumber} will immediately transition to <strong>Housekeeping (Cleaning)</strong> for UV-C terminal disinfection upon confirmation.
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                !disposition ||
                !notes.trim() ||
                !followUpInstructions.trim()
              }
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              <LogOut className="h-4 w-4" />
              <span>{isSubmitting ? 'Processing Governed Discharge...' : 'Continue Governed Discharge'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
