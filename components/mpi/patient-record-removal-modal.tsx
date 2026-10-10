'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useHospital } from '@/lib/context/hospital-context';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import { AuthClient } from '@/lib/auth/auth-client';

type RemovalCareBlocker = {
  source: 'ENCOUNTER' | 'ACTIVE_CARE_POINTER' | 'ACTIVE_BED';
  domain: string;
  encounterId?: string;
  status: string;
  detail: string;
};
type RemovalReadiness = {
  success: true;
  readyForRemoval: boolean;
  checkedAt: number;
  blockers: RemovalCareBlocker[];
};

export interface RemovablePatient {
  id: string;
  mrn: string;
  fullName: string;
  activeBedId?: string;
  activeEncounterId?: string;
  activeCareContexts?: {
    activeIpdEncounterId?: string;
    activeEmergencyEncounterId?: string;
    activeOpdEncounterIds?: string[];
    activeTelehealthEncounterIds?: string[];
  };
  encounters?: Array<{ id: string; status: string; type?: string }>;
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
  const { patients: hospitalPatients } = useHospital();
  const fullPatientRecord = hospitalPatients?.find((p) => p.id === patient.id);
  const effectivePatient = { ...fullPatientRecord, ...patient };

  const terminalStatuses = new Set([
    'COMPLETED', 'CLOSED', 'DISCHARGED', 'CANCELLED', 'CANCELED', 'TRANSFERRED',
  ]);
  const activeEncounters = (effectivePatient.encounters || []).filter((e) => {
    const s = String(e.status || '').trim().toUpperCase();
    return !terminalStatuses.has(s);
  });
  const hasActiveCarePointers = Boolean(
    effectivePatient.activeBedId ||
    effectivePatient.activeEncounterId ||
    effectivePatient.activeCareContexts?.activeIpdEncounterId ||
    effectivePatient.activeCareContexts?.activeEmergencyEncounterId ||
    (effectivePatient.activeCareContexts?.activeOpdEncounterIds?.length ?? 0) > 0 ||
    (effectivePatient.activeCareContexts?.activeTelehealthEncounterIds?.length ?? 0) > 0
  );
  const hasActiveCare = hasActiveCarePointers || activeEncounters.length > 0;

  const allowed = roles.some((role) =>
    ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(
      String(role).trim().toUpperCase()
    )
  );
  const [reason, setReason] = useState('');
  const [confirmationMrn, setConfirmationMrn] = useState('');
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false);
  const isConfirmedMock =
    (['tenant_02bb76e3', 'central-metro-hospital'].includes(activeTenant?.tenantId || '')) &&
    (patient.mrn === 'MRN-20260820-8790' && patient.fullName.trim().toLowerCase() === 'eleanor vance' ||
      patient.mrn === 'MRN-20260930-3611' && patient.fullName.trim().toLowerCase() === 'test patient');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<RemovalReadiness | null>(null);
  const [inspectPending, setInspectPending] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  useEffect(() => {
    if (!activeTenant?.tenantId || !allowed || isOffline) {
      setReadiness(null);
      return;
    }
    let active = true;
    setInspectPending(true);
    setReadiness(null);
    setInspectionError(null);
    void AuthClient.authorizedFetch(
      '/api/clinical/mpi/removal-readiness',
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenant.tenantId,
          patientId: patient.id,
          expectedMrn: patient.mrn,
        }),
      },
      activeTenant.tenantId
    )
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success !== true ||
            typeof result.readyForRemoval !== 'boolean' ||
            !Array.isArray(result.blockers)) {
          throw new Error(result.error || 'Authoritative care inspection failed.');
        }
        return result as RemovalReadiness;
      })
      .then(result => { if (active) setReadiness(result); })
      .catch(cause => {
        if (active) setInspectionError(cause instanceof Error ? cause.message : 'Unable to verify patient care.');
      })
      .finally(() => { if (active) setInspectPending(false); });
    return () => { active = false; };
  }, [activeTenant?.tenantId, allowed, isOffline, patient.id, patient.mrn, inspectionRevision]);

  const removalBlocked = !readiness?.readyForRemoval;
  const careBlockers = readiness?.blockers || [];
  const canAttemptOrdinaryRemoval = valid && !removalBlocked && !inspectPending;


  const reasonLength = reason.trim().length;
  const verifiedMrn = confirmationMrn.trim().toUpperCase() === patient.mrn.trim().toUpperCase();
  const valid = allowed && !isOffline && Boolean(activeTenant?.tenantId) &&
    reasonLength >= 20 && reasonLength <= 1000 && verifiedMrn &&
    retentionAcknowledged && !pending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAttemptOrdinaryRemoval) {
      setError(
        inspectPending
          ? 'The clinical-care inspection is still running.'
          : inspectionError
            ? 'Authoritative care inspection failed: ' + inspectionError
            : careBlockers.length
              ? 'Removal is blocked by ' + careBlockers.length + ' verified encounter/care reference(s). Review the blockers and complete their authorized workflows.'
              : 'A successful authoritative clinical-care inspection is required before removal.'
      );
      return;
    }
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
        retiredTelehealthSessions?: string[];
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
      className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-slate-950/75 p-2 sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-patient-title"
        aria-describedby="remove-patient-safety"
        aria-busy={pending}
        data-testid="mpi-removal-dialog"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100 sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div className="min-w-0">
            <h2 id="remove-patient-title" className="flex items-center gap-2 text-base font-bold sm:text-lg">
              <Trash2 className="h-5 w-5 shrink-0 text-rose-600" />
              Remove from active patient registry
            </h2>
            <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
              {patient.fullName} · <span className="font-mono">{patient.mrn}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Cancel removal"
            className="shrink-0 rounded-lg p-2 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          id="patient-record-removal-form"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            if (isConfirmedMock && hasActiveCare) {
              event.preventDefault();
              void retireMock();
            } else {
              void submit(event);
            }
          }}
        >
          <div
            data-testid="mpi-removal-dialog-scroll"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5"
          >
            <div
              id="remove-patient-safety"
              className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100"
            >
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                High-impact administrative action
              </p>
              <p className="mt-1">
                This removes the patient from routine MPI searches, not from legal records.
                MRN, prior care, identity provenance, financial history and the immutable audit trail remain retained.
              </p>
            </div>

            {(readiness ? !readiness.readyForRemoval : hasActiveCare) && (
              <div
                data-testid="remove-patient-active-care-warning"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <p className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  Active Clinical Care in Progress
                </p>
                <p className="mt-1">
                  Ordinary removal is blocked while clinical care or an active-care reference remains unresolved.
                  {isConfirmedMock
                    ? ' The special synthetic retirement below requires independent server verification; it never records a clinical discharge.'
                    : ' Complete the appropriate clinical disposition or discharge before requesting removal.'}
                </p>
              </div>
            )}

            {allowed && !isOffline && (
              <section
                id="mpi-removal-readiness-panel"
                aria-label="Authoritative removal readiness"
                data-testid="mpi-removal-readiness"
                className="space-y-2 rounded-lg border border-slate-300 p-3 text-xs dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">Clinical-care removal blockers</p>
                  <button
                    type="button"
                    data-testid="mpi-removal-refresh-blockers"
                    disabled={pending || inspectPending}
                    onClick={() => setInspectionRevision(value => value + 1)}
                    className="rounded-lg border px-3 py-2 font-semibold disabled:opacity-50"
                  >
                    {inspectPending ? 'Checking Firestore…' : 'Refresh blockers'}
                  </button>
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Verified against the authenticated tenant’s authoritative patient and encounters.
                  This check is read-only and never closes care or removes a patient.
                </p>
                {inspectPending && <p role="status">Checking authoritative patient and encounter status…</p>}
                {inspectionError && (
                  <p role="alert" className="text-rose-700 dark:text-rose-300">
                    Inspection unavailable: {inspectionError}. Removal remains disabled.
                  </p>
                )}
                {readiness?.readyForRemoval && hasActiveCare && (
                  <p role="status" className="text-amber-700 dark:text-amber-300">
                    The local hospital view still shows care pointers, but the verified Firestore
                    record currently has no blockers. Its edge cache may be stale; removal will be
                    rechecked by the server and any disagreement will safely reject the request.
                  </p>
                )}
                {readiness?.readyForRemoval && (
                  <p role="status" className="text-emerald-700 dark:text-emerald-300">
                    No active-care blockers were found in the authoritative check.
                    Removal will still be revalidated by the backend.
                  </p>
                )}
                {careBlockers.length > 0 && (
                  <div className="max-h-48 space-y-2 overflow-y-auto" data-testid="mpi-removal-care-blockers">
                    {careBlockers.map((item, index) => (
                      <div key={`${item.source}:${item.encounterId || item.domain}:${index}`}
                           className="rounded-lg border border-amber-400/50 p-2">
                        <p className="font-semibold">{item.domain} · {item.status}</p>
                        {item.encounterId && (
                          <p className="break-all font-mono">Encounter: {item.encounterId}</p>
                        )}
                        <p>{item.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
                {(careBlockers.length > 0 || hasActiveCare) && (
                  <p className="font-medium">
                    Resolve the encounter in its clinical workspace (OPD, IPD, Emergency or Telehealth),
                    then refresh this check. A terminal encounter with a lingering active-care pointer
                    requires authorized reconciliation; administrators cannot clear it by forcing MPI removal.
                  </p>
                )}
              </section>
            )}

            {isConfirmedMock && hasActiveCare && (
              <div
                data-testid="mpi-mock-retirement-options"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <p className="font-bold">Development-only: retire confirmed mock patient and eligible test encounters</p>
                <p>
                  Only the two specifically allowlisted mock identities can use this action.
                  It requires an isolated TEST/DEMO development server and explicit cleanup authorization.
                  The server rejects IPD/emergency care, linked finance or clinical evidence, telehealth sessions with activity, and production requests.
                  Encounter cancellation and the operator's reason are retained in the audit trail.
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={syntheticConfirmed}
                    onChange={(event) => setSyntheticConfirmed(event.target.checked)}
                    data-testid="retire-mock-synthetic-confirmation"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>I confirm all care episodes in this patient record are synthetic and belong to development testing.</span>
                </label>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-sm font-semibold">
                Why are you removing this patient record? <span className="text-rose-600">*</span>
                <textarea
                  data-testid="remove-patient-reason"
                  required
                  rows={3}
                  minLength={20}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Describe the administrative reason, supporting evidence and request/reference number."
                  className="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-transparent p-3 text-sm dark:border-slate-700"
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
                  onChange={(event) => setConfirmationMrn(event.target.value)}
                  required
                  autoComplete="off"
                  className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-transparent p-3 font-mono text-sm dark:border-slate-700"
                />
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={retentionAcknowledged}
                  onChange={(event) => setRetentionAcknowledged(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  I understand this is an audited removal from the active registry, not permanent
                  destruction of clinical, audit, identity or financial records.
                </span>
              </label>
            </div>

            {!allowed && (
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                Hospital administrator authority is required.
              </p>
            )}
            {isOffline && (
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                Online server authorization is required; patient removal cannot be queued offline.
              </p>
            )}
          </div>

          <div
            data-testid="mpi-removal-dialog-actions"
            className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-5"
          >
            {error && (
              <p
                role="alert"
                data-testid="remove-patient-error"
                className="max-h-24 overflow-y-auto text-xs font-medium text-rose-700 dark:text-rose-300"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"
              >
                Cancel
              </button>
              {isConfirmedMock && hasActiveCare ? (
                <button
                  type="submit"
                  data-testid="retire-confirmed-mock-patient"
                  disabled={!valid || !syntheticConfirmed}
                  className="min-h-10 max-w-full rounded-lg bg-amber-800 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Committing audited mock cleanup…' : 'Retire verified mock test record'}
                </button>
              ) : (
                <button
                  type={removalBlocked ? 'button' : 'submit'}
                  data-testid="remove-patient-confirm"
                  disabled={pending || !allowed || isOffline || (!removalBlocked && !valid)}
                  title={removalBlocked ? 'Review the authoritative clinical blockers before removal can be enabled' : undefined}
                  onClick={!removalBlocked ? undefined : () => {
                    document.getElementById('mpi-removal-readiness-panel')?.scrollIntoView({
                      behavior: 'smooth', block: 'nearest',
                    });
                    if (!inspectPending && !inspectionError) setInspectionRevision(value => value + 1);
                  }}
                  className="flex min-h-10 items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {pending ? 'Committing…' : removalBlocked
                    ? 'Review clinical blockers' : 'Confirm audited removal'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
