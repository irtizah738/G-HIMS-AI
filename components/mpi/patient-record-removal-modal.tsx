'use client';

import { useState, type FormEvent } from 'react';
import { AlertTriangle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

export interface RemovablePatient {
  id: string;
  mrn: string;
  fullName: string;
}

export function PatientRecordRemovalModal({
  patient,
  onClose,
  onRemoved,
}: {
  patient: RemovablePatient;
  onClose: () => void;
  onRemoved: (patientId: string) => void;
}) {
  const { roles, isOffline, activeTenant } = useAuth();
  const allowed = roles.some((role) =>
    ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(
      String(role).trim().toUpperCase()
    )
  );
  const [reason, setReason] = useState('');
  const [confirmationMrn, setConfirmationMrn] = useState('');
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false);
  const isConfirmedMock = process.env.NODE_ENV === 'development' &&
    activeTenant?.tenantId === 'tenant_02bb76e3' &&
    (patient.mrn === 'MRN-20260820-8790' && patient.fullName.trim().toLowerCase() === 'eleanor vance' ||
      patient.mrn === 'MRN-20260930-3611' && patient.fullName.trim().toLowerCase() === 'test patient');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLength = reason.trim().length;
  const verifiedMrn = confirmationMrn.trim().toUpperCase() === patient.mrn.trim().toUpperCase();
  const valid = allowed && !isOffline && Boolean(activeTenant?.tenantId) &&
    reasonLength >= 20 && reasonLength <= 1000 && verifiedMrn &&
    retentionAcknowledged && !pending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      const result = await executeActiveTenantCommand<{
        patientId: string;
        status: 'REMOVED';
        removedAt: number;
        removedBy: string;
      }>('RemovePatientRecordCommand', {
        patientId: patient.id,
        expectedMrn: confirmationMrn.trim(),
        reason: reason.trim(),
      });

      if (!result.success || result.queuedOffline || result.data?.status !== 'REMOVED') {
        throw new Error(
          result.error?.message ||
          'Patient removal has not been committed by the authoritative server.'
        );
      }

      onRemoved(patient.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to remove patient record.');
    } finally {
      setPending(false);
    }
  };

  const retireMock = async () => {
    if (!valid || !syntheticConfirmed || !isConfirmedMock) return;
    setPending(true);
    setError(null);
    try {
      const result = await executeActiveTenantCommand<{
        patientId: string;
        status: 'REMOVED';
        retiredEncounters: string[];
        retiredQueueTokens: string[];
      }>('RetireConfirmedMockPatientCommand', {
        patientId: patient.id,
        expectedMrn: confirmationMrn.trim(),
        reason: reason.trim(),
        confirmedSynthetic: true,
      });
      if (!result.success || result.queuedOffline || result.data?.status !== 'REMOVED') {
        throw new Error(result.error?.message || 'Synthetic patient retirement was not committed.');
      }
      onRemoved(patient.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Synthetic patient retirement failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-patient-title"
        className="w-full max-w-lg rounded-2xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="remove-patient-title" className="flex items-center gap-2 text-lg font-bold">
            <Trash2 className="h-5 w-5 text-rose-600" />
            Remove from active patient registry
          </h2>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Cancel removal">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" /> High-impact administrative action
          </div>
          <p className="mt-2">
            This action removes the patient from routine MPI searches, not from legal
            clinical or financial history. Their MRN, prior care, identity provenance,
            immutable event and audit trail remain retained.
          </p>
        </div>
        <div className="mt-4 text-sm">
          <span className="font-bold">{patient.fullName}</span>
          <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
            MRN: {patient.mrn} · Patient ID: {patient.id}
          </p>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold">
            Why are you removing this patient record? <span className="text-rose-600">*</span>
            <textarea
              data-testid="remove-patient-reason"
              required
              autoFocus
              rows={4}
              minLength={20}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the administrative reason, supporting evidence and request/reference number."
              className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent p-3 text-sm dark:border-slate-700"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {reasonLength}/1000 characters (minimum 20). This explanation is retained in the audit ledger.
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Type MRN {patient.mrn} to confirm <span className="text-rose-600">*</span>
            <input
              data-testid="remove-patient-mrn"
              value={confirmationMrn}
              onChange={(e) => setConfirmationMrn(e.target.value)}
              required
              autoComplete="off"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent p-3 font-mono text-sm dark:border-slate-700"
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={retentionAcknowledged}
              onChange={(e) => setRetentionAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I understand this is an audited removal from the active registry, not
              a permanent destruction of clinical, audit, identity or financial records.
            </span>
          </label>
          {isConfirmedMock && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-bold">Development-only: retire confirmed mock patient and OPD encounters</p>
              <p>
                This option handles an unresolved OPD test encounter without pretending clinical
                care was completed. It preserves the original records and records the administrative
                cancellation, operator, time and reason. The server rejects production, non-OPD care,
                other MRNs and patients with linked financial records.
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={syntheticConfirmed}
                  onChange={(e) => setSyntheticConfirmed(e.target.checked)}
                  data-testid="retire-mock-synthetic-confirmation"
                  className="mt-0.5"
                />
                <span>I confirm all care episodes in this patient record are synthetic and belong to development testing.</span>
              </label>
              <button
                type="button"
                data-testid="retire-confirmed-mock-patient"
                disabled={!valid || !syntheticConfirmed}
                onClick={retireMock}
                className="rounded-lg bg-amber-800 px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Committing audited mock cleanup…' : 'Retire mock record and linked OPD test encounters'}
              </button>
            </div>
          )}
          {!allowed && (
            <p className="text-sm text-rose-700">Hospital administrator authority is required.</p>
          )}
          {isOffline && (
            <p className="text-sm text-rose-700">Online server authorization is required; patient removal cannot be queued offline.</p>
          )}
          {error && (
            <p role="alert" data-testid="remove-patient-error" className="text-sm text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="remove-patient-confirm"
              disabled={!valid}
              className="flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" />
              {pending ? 'Committing…' : 'Confirm audited removal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
