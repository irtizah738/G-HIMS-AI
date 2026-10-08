'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';

export interface PatientContextSafetyBlockProps {
  code:
    | 'CLINICAL_CONTEXT_REQUIRED'
    | 'CLINICAL_CONTEXT_RESOLVING'
    | 'PATIENT_CONTEXT_UNRESOLVED'
    | 'PATIENT_CONTEXT_MISMATCH'
    | 'TENANT_CONTEXT_MISMATCH';
  encounterId?: string;
  patientId?: string;
  detail?: string;
}

export function PatientContextSafetyBlock({
  code,
  encounterId,
  patientId,
  detail,
}: PatientContextSafetyBlockProps) {
  const resolving = code === 'CLINICAL_CONTEXT_RESOLVING';

  return (
    <div
      data-testid="patient-context-safety-block"
      data-context-error-code={code}
      className={
        resolving
          ? 'rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
          : 'rounded-2xl border border-rose-300 bg-rose-50 p-5 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100'
      }
      role="alert"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold">
            {resolving ? 'Resolving verified patient context…' : 'Patient context safety lock'}
          </h3>
          <p className="text-xs font-semibold">
            {code}: clinical actions are disabled until the active encounter and canonical patient identity are reconciled.
          </p>
          {(encounterId || patientId) && (
            <p className="font-mono text-[11px] opacity-80">
              encounter={encounterId || 'UNRESOLVED'} · patient={patientId || 'UNRESOLVED'}
            </p>
          )}
          {detail && <p className="text-xs opacity-90">{detail}</p>}
        </div>
      </div>
    </div>
  );
}
