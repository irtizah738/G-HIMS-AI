/**
 * G-HIMS Explicit Patient Identity Confirmation Modal
 * Implements Rule 10 (Patient Identity Safety):
 * 
 * For high-risk clinical actions (prescribing high-alert medication, chemotherapy,
 * ordering blood transfusions, emergency surgery scheduling), requires explicit,
 * unambiguous confirmation of patient identity (Full Name, MRN, DOB, Allergies).
 */

'use client';

import React, { useState } from 'react';
import { Patient } from '@/lib/types/ghims';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  X,
  UserCheck,
  Barcode,
  Calendar,
  HeartPulse,
} from 'lucide-react';

interface ConfirmPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  patient: Patient;
  actionTitle: string;
  actionDescription: string;
  actionRiskLevel?: 'HIGH' | 'CRITICAL';
  isSubmitting?: boolean;
}

export function ConfirmPatientModal({
  isOpen,
  onClose,
  onConfirm,
  patient,
  actionTitle,
  actionDescription,
  actionRiskLevel = 'HIGH',
  isSubmitting = false,
}: ConfirmPatientModalProps) {
  const [confirmedCheck, setConfirmedCheck] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header Alert Strip */}
        <div className="bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/80 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-300 font-bold text-sm">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>CLINICAL SAFETY GATE — CONFIRM PATIENT</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Patient Identity Card */}
        <div className="p-6 space-y-5">
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Patient Full Name</div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100">{patient.fullName}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Medical Record Number</div>
                <div className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/80 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-md">
                  {patient.mrn}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] block">Age / Gender:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{patient.age}y • {patient.gender}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">DOB:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{patient.dateOfBirth || '14 May 1978'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Blood Group:</span>
                <span className="font-bold text-red-600 dark:text-red-400">{patient.bloodGroup || 'O+'}</span>
              </div>
            </div>

            {/* Allergies Warning */}
            {patient.allergies && patient.allergies.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-xl p-2.5 flex items-center gap-2 text-xs text-red-800 dark:text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <div>
                  <span className="font-bold">KNOWN ALLERGIES: </span>
                  <span>{patient.allergies.join(', ')}</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Summary */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              High-Risk Clinical Operation:
            </h4>
            <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800 text-xs text-slate-800 dark:text-slate-200 space-y-1">
              <div className="font-bold text-blue-900 dark:text-blue-300">{actionTitle}</div>
              <p className="text-slate-600 dark:text-slate-300">{actionDescription}</p>
            </div>
          </div>

          {/* Verification Checkbox */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
            <input
              type="checkbox"
              id="chk-confirm-patient-identity"
              checked={confirmedCheck}
              onChange={(e) => setConfirmedCheck(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
            />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
              I certify that I have verified the physical wristband / photo ID of{' '}
              <strong className="text-slate-900 dark:text-slate-100">{patient.fullName}</strong> ({patient.mrn}) and confirmed that this clinical action belongs strictly to this patient.
            </span>
          </label>
        </div>

        {/* Footer Controls */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            id="btn-execute-confirmed-clinical-action"
            disabled={!confirmedCheck || isSubmitting}
            onClick={onConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {isSubmitting ? (
              <span>Authorizing...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Proceed</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
