'use client';

import React, { useState } from 'react';
import { WorkflowStage, WorkflowSnapshot } from '@/types/encounter-runtime';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserCheck,
  Clock,
  X,
} from 'lucide-react';

interface StageTransitionGuardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmTransition: (actorRole: string, actorName: string, metadata?: Record<string, unknown>) => Promise<void>;
  currentStage: WorkflowStage;
  nextStage?: { id: string; name: string; requiredRoles: string[] };
  isSubmitting?: boolean;
}

export function StageTransitionGuardModal({
  isOpen,
  onClose,
  onConfirmTransition,
  currentStage,
  nextStage,
  isSubmitting = false,
}: StageTransitionGuardModalProps) {
  const [selectedRole, setSelectedRole] = useState(currentStage.requiredRoles[0] || 'practitioner');
  const [actorName, setActorName] = useState('Dr. Sarah Al-Mansoor, MD');
  const [notes, setNotes] = useState('All mandatory clinical requirements verified and completed.');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Mock stage requirements check based on current stage
  const getStagePrerequisites = (stageId: string) => {
    switch (stageId) {
      case 'REGISTRATION':
        return [
          { name: 'Patient MPI Record deduplicated & active', met: true },
          { name: 'National ID / MRN verified', met: true },
          { name: 'OPD Token generated & Queue routed', met: true },
        ];
      case 'TRIAGE':
        return [
          { name: 'NEWS2 / EWS Vital signs recorded', met: true },
          { name: 'Chief complaint and allergy flags logged', met: true },
          { name: 'Acuity level assigned', met: true },
        ];
      case 'CONSULTATION':
        return [
          { name: 'Physician SOAP notes signed', met: true },
          { name: 'Diagnostic lab/radiology orders placed', met: true },
          { name: 'Prescription e-signed', met: true },
        ];
      case 'DIAGNOSTICS_PHARMACY':
        return [
          { name: 'LIS/RIS verified results returned', met: true },
          { name: 'FEFO pharmacy batch stock reserved', met: true },
          { name: 'Dispensing pharmacist signature verified', met: true },
        ];
      case 'BILLING_DISCHARGE':
        return [
          { name: 'Split-billing copay ledger balanced', met: true },
          { name: 'Patient receipt generated', met: true },
          { name: 'Discharge instructions handed over', met: true },
        ];
      default:
        return [{ name: 'Clinical prerequisites satisfied', met: true }];
    }
  };

  const prerequisites = getStagePrerequisites(currentStage.id);
  const allPrerequisitesMet = prerequisites.every((p) => p.met);

  const handleConfirm = async () => {
    setErrorMsg(null);
    try {
      await onConfirmTransition(selectedRole, actorName, {
        notes,
        verifiedAt: new Date().toISOString(),
        stageId: currentStage.id,
      });
      onClose();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || 'Transition rejected by system guard.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Clinical Transition Guard & Sign-off
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Advancing from <strong className="text-slate-800 dark:text-slate-200">{currentStage.name}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Prerequisites Checklist */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Prerequisite Verification Checklist:
          </label>
          <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/80 dark:border-slate-800 flex flex-col gap-2">
            {prerequisites.map((req, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-300">{req.name}</span>
                {req.met ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Passed
                  </span>
                ) : (
                  <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 text-[11px]">
                    <XCircle className="w-3.5 h-3.5" />
                    Pending
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actor RBAC Authorization Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Signing Role *
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
            >
              {currentStage.requiredRoles.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </option>
              ))}
              <option value="practitioner">Practitioner (Override)</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Practitioner Name *
            </label>
            <input
              type="text"
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Clinical Handover Notes
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!allPrerequisitesMet || isSubmitting}
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Authorizing Transition...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Complete & Advance Stage</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
