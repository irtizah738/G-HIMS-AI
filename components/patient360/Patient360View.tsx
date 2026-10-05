'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  ArrowLeft,
  FileText,
  FlaskConical,
  HeartPulse,
  Loader2,
  Pill,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  acknowledgeCriticalDiagnosticResult,
  completeMedicationReconciliation,
  loadPatient360ClinicalView,
  recordConsultantPatientReview,
  recordDischargeReadinessReview,
  type Patient360ClinicalView,
} from '@/lib/clinical/patient360/patient360-client';
import type { Patient360ObservationSummary } from '@/types/patient360-projection';
import type { KnownStatus } from '@/types/clinical-canonical';
import { ClinicalCopilotWorkspace } from '@/components/patient360/ClinicalCopilotWorkspace';

function valueText(value: Patient360ObservationSummary['value']): string {
  switch (value.valueType) {
    case 'QUANTITY':
      return `${value.quantity.value} ${value.quantity.unit || value.quantity.code || ''}`.trim();
    case 'STRING':
      return value.value;
    case 'CODED':
      return value.value.text || value.value.codings[0]?.display || value.value.codings[0]?.code || 'Coded value';
    case 'BOOLEAN':
      return value.value ? 'Yes' : 'No';
    case 'COMPONENTS':
      return value.components
        .map((component) => {
          const label =
            component.code.text ||
            component.code.codings[0]?.display ||
            component.code.codings[0]?.code ||
            'Component';
          return `${label}: ${valueText(component.value)}`;
        })
        .join(' · ');
  }
}

function dateTime(value?: number | string): string {
  if (value === undefined || value === null || value === '') return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function knowledgeStatusText(label: string, status: KnownStatus): string {
  switch (status) {
    case 'KNOWN_NONE':
      return `${label} reviewed: none known.`;
    case 'UNKNOWN':
      return `${label} status is unknown.`;
    case 'NOT_ASSESSED':
      return `${label} status has not been assessed.`;
    case 'PATIENT_UNABLE_TO_REPORT':
      return `${label} status could not be established because the patient was unable to report.`;
    case 'KNOWN':
    default:
      return `${label} status is known.`;
  }
}

function KnowledgeBanner({
  label,
  status,
}: {
  label: string;
  status: KnownStatus;
}) {
  if (status === 'KNOWN') return null;
  const reviewedNone = status === 'KNOWN_NONE';
  return (
    <div
      className={
        reviewedNone
          ? 'flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900'
          : 'flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900'
      }
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>{knowledgeStatusText(label, status)}</span>
    </div>
  );
}

function knowledgeEmptyState(label: string, status: KnownStatus): string {
  if (status === 'KNOWN_NONE') return `No known ${label.toLowerCase()} after clinical review.`;
  if (status === 'UNKNOWN') return `${label} status is unknown.`;
  if (status === 'NOT_ASSESSED') return `${label} has not been assessed.`;
  if (status === 'PATIENT_UNABLE_TO_REPORT') {
    return `${label} could not be established from the patient.`;
  }
  return `No active ${label.toLowerCase()} in the canonical projection.`;
}

function readinessStateText(state: string): string {
  switch (state) {
    case 'BLOCKED':
      return 'Blocked';
    case 'REQUIRES_REVIEW':
      return 'Requires review';
    case 'READY_FOR_CLINICIAN_REVIEW':
      return 'Ready for clinician review';
    case 'NOT_APPLICABLE':
      return 'Not applicable';
    default:
      return 'Not evaluated';
  }
}

function readinessStateClass(state: string): string {
  switch (state) {
    case 'BLOCKED':
      return 'border-rose-200 bg-rose-50 text-rose-900';
    case 'REQUIRES_REVIEW':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'READY_FOR_CLINICIAN_REVIEW':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function deteriorationStateText(state: string): string {
  switch (state) {
    case 'STABLE':
      return 'Stable';
    case 'WATCH':
      return 'Watch';
    case 'ESCALATION_REQUIRED':
      return 'Escalation review required';
    case 'CRITICAL_REVIEW_REQUIRED':
      return 'Critical review required';
    case 'NOT_APPLICABLE':
      return 'Not applicable';
    default:
      return 'Not evaluated';
  }
}

function deteriorationStateClass(state: string): string {
  switch (state) {
    case 'CRITICAL_REVIEW_REQUIRED':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'ESCALATION_REQUIRED':
      return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'WATCH':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'STABLE':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
      {children}
    </div>
  );
}

export function Patient360View({
  tenantId,
  patientId,
}: {
  tenantId: string;
  patientId: string;
}) {
  const [view, setView] = useState<Patient360ClinicalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [criticalAckReportId, setCriticalAckReportId] = useState<string | null>(null);
  const [criticalAckMessage, setCriticalAckMessage] = useState<string | null>(null);
  const [careContextRequest, setCareContextRequest] = useState<{
    careSetting?: 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH';
    encounterId?: string;
  }>({});
  const [consultantReviewSubmitting, setConsultantReviewSubmitting] = useState(false);
  const [consultantReviewMessage, setConsultantReviewMessage] = useState<string | null>(null);
  const [medicationReconciliationConfirmed, setMedicationReconciliationConfirmed] =
    useState(false);
  const [medicationReconciliationNotes, setMedicationReconciliationNotes] =
    useState('');
  const [medicationReconciliationSubmitting, setMedicationReconciliationSubmitting] =
    useState(false);
  const [medicationReconciliationMessage, setMedicationReconciliationMessage] =
    useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const next = await loadPatient360ClinicalView(
        tenantId,
        patientId,
        careContextRequest
      );
      setView(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Patient 360 could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // tenant/patient/context are the authority boundary for this clinical view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenantId,
    patientId,
    careContextRequest.careSetting,
    careContextRequest.encounterId,
  ]);

  const submitReadinessReview = async (
    outcome: 'ACKNOWLEDGED' | 'ESCALATE' | 'PROCEED_WITH_WARNINGS'
  ) => {
    if (!view?.dischargeReadiness || view.source === 'LOCAL_EDGE') return;
    if (outcome === 'ESCALATE' && !reviewReason.trim()) {
      setReviewMessage('A clinical reason is required for escalation.');
      return;
    }

    try {
      setReviewSubmitting(true);
      setReviewMessage(null);
      const findings = [
        ...view.dischargeReadiness.blockers,
        ...view.dischargeReadiness.warnings,
        ...view.dischargeReadiness.information,
      ];
      await recordDischargeReadinessReview(tenantId, {
        patientId,
        encounterId: view.dischargeReadiness.encounterId,
        evaluationId: view.dischargeReadiness.evaluationId,
        outcome,
        reviewedFindingIds: findings.map((item) => item.findingId),
        reason: reviewReason.trim() || undefined,
      });
      setReviewMessage(
        outcome === 'ESCALATE'
          ? 'Escalation review recorded in the immutable audit trail.'
          : 'Clinician review recorded in the immutable audit trail.'
      );
      setReviewReason('');
    } catch (caught) {
      setReviewMessage(
        caught instanceof Error
          ? caught.message
          : 'Unable to record clinician review.'
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  const acknowledgeCriticalResult = async (
    reportId: string,
    encounterId: string
  ) => {
    if (!reportId || !encounterId || view?.source === 'LOCAL_EDGE') return;

    try {
      setCriticalAckReportId(reportId);
      setCriticalAckMessage(null);
      await acknowledgeCriticalDiagnosticResult(tenantId, {
        patientId,
        encounterId,
        reportId,
      });
      setCriticalAckMessage(
        'Critical result acknowledgement recorded. CI-7 will update after the authoritative event is projected.'
      );
      // Never clear a safety blocker optimistically.
      await load();
    } catch (caught) {
      setCriticalAckMessage(
        caught instanceof Error
          ? caught.message
          : 'Unable to acknowledge the critical diagnostic result.'
      );
    } finally {
      setCriticalAckReportId(null);
    }
  };

  const completeCurrentMedicationReconciliation = async () => {
    if (
      !view?.selectedCareContext ||
      view.source === 'LOCAL_EDGE' ||
      !medicationReconciliationConfirmed
    ) {
      setMedicationReconciliationMessage(
        view?.source === 'LOCAL_EDGE'
          ? 'Medication reconciliation requires authoritative server connectivity.'
          : 'Confirm that the current medication list has been reviewed and all discrepancies are resolved.'
      );
      return;
    }

    try {
      setMedicationReconciliationSubmitting(true);
      setMedicationReconciliationMessage(null);
      await completeMedicationReconciliation(tenantId, {
        patientId,
        encounterId: view.selectedCareContext.encounterId,
        reconciledMedicationIds: view.projection.currentMedications.map(
          (item) => item.medicationOrderId
        ),
        discrepancyCount: 0,
        unresolvedDiscrepancies: [],
        notes: medicationReconciliationNotes.trim() || undefined,
      });
      setMedicationReconciliationMessage(
        'Medication reconciliation recorded. CI-9 will re-evaluate after the authoritative event is projected.'
      );
      setMedicationReconciliationConfirmed(false);
      setMedicationReconciliationNotes('');
      await load();
    } catch (caught) {
      setMedicationReconciliationMessage(
        caught instanceof Error
          ? caught.message
          : 'Medication reconciliation could not be completed.'
      );
    } finally {
      setMedicationReconciliationSubmitting(false);
    }
  };

  const recordCurrentConsultantReview = async () => {
    if (
      !view?.consultantVisibility ||
      !view.selectedCareContext ||
      view.source === 'LOCAL_EDGE'
    ) {
      return;
    }

    try {
      setConsultantReviewSubmitting(true);
      setConsultantReviewMessage(null);
      await recordConsultantPatientReview(tenantId, {
        patientId,
        encounterId: view.selectedCareContext.encounterId,
        careSetting: view.selectedCareContext.careSetting as
          | 'OPD'
          | 'IPD'
          | 'EMERGENCY'
          | 'TELEHEALTH',
        patient360Revision: view.freshness.revision,
        patient360SourceCheckpoint: view.freshness.sourceCheckpoint,
        reviewedChangeIds: view.consultantVisibility.changes.map(
          (item) => item.changeId
        ),
      });
      setConsultantReviewMessage(
        'Current Patient 360 state marked reviewed for this consultant and care context.'
      );
      await load();
    } catch (caught) {
      setConsultantReviewMessage(
        caught instanceof Error
          ? caught.message
          : 'Unable to record consultant review checkpoint.'
      );
    } finally {
      setConsultantReviewSubmitting(false);
    }
  };

  const latestResultAt = useMemo(() => {
    const timestamps =
      view?.projection.recentResults
        .map((item) => item.issuedAt || 0)
        .filter(Boolean) || [];
    return timestamps.length ? Math.max(...timestamps) : 0;
  }, [view]);

  if (loading && !view) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading authoritative Patient 360…
        </div>
      </div>
    );
  }

  if (!view || error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6">
          <div className="flex items-center gap-2 font-semibold text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            Patient 360 unavailable
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {error || 'No Patient 360 projection is available for this patient.'}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { projection, timeline, source, freshness } = view;
  const offline = source === 'LOCAL_EDGE';
  const highCriticalityAllergies = projection.allergies.filter(
    (item) => item.criticality === 'HIGH'
  );
  const longitudinalProblems = projection.activeProblems.filter(
    (item) => item.category !== 'ENCOUNTER_DIAGNOSIS'
  );
  const encounterDiagnoses = projection.activeProblems.filter(
    (item) => item.category === 'ENCOUNTER_DIAGNOSIS'
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Hospital Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={
                offline
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800'
              }
            >
              {offline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
              {offline ? 'Encrypted offline snapshot' : 'Authoritative server projection'}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-500">
              rev {freshness.revision} · v{freshness.projectionVersion}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {offline && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            You are viewing the last encrypted Patient 360 projection hydrated for this authenticated user.
            The detailed event timeline is unavailable until server connectivity returns.
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">
                  {projection.identity.fullName}
                </h1>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700">
                  {projection.identity.mrn || projection.patientId}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>DOB: {projection.identity.dateOfBirth || 'Unknown'}</span>
                <span>Gender: {projection.identity.gender || 'Unknown'}</span>
                <span>Blood group: {projection.identity.bloodGroup || 'Unknown'}</span>
                <span>Tenant: {tenantId}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[430px]">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Problems</div>
                <div className="mt-1 text-lg font-bold">{longitudinalProblems.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Allergies</div>
                <div className="mt-1 text-lg font-bold">{projection.allergies.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Meds</div>
                <div className="mt-1 text-lg font-bold">{projection.currentMedications.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Results</div>
                <div className="mt-1 text-lg font-bold">{projection.recentResults.length}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <KnowledgeBanner
              label="Allergy"
              status={projection.dataQuality.allergyKnowledge}
            />
            <KnowledgeBanner
              label="Problem list"
              status={projection.dataQuality.problemListKnowledge}
            />
            <KnowledgeBanner
              label="Medication"
              status={projection.dataQuality.medicationKnowledge}
            />
          </div>

          {highCriticalityAllergies.length > 0 && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-rose-800">
                <AlertTriangle className="h-4 w-4" />
                High-criticality allergy alert
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {highCriticalityAllergies.map((item) => (
                  <span
                    key={item.allergyId}
                    className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-800"
                  >
                    {item.substance}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-indigo-600" />
                <h2 className="text-sm font-bold">Care-setting context</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Patient 360 remains longitudinal; actions and consultant attention are scoped to the selected encounter.
              </p>
            </div>
            {view.selectedCareContext && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                <span className="font-bold">{view.selectedCareContext.careSetting}</span>
                {' · '}
                <span className="font-mono">{view.selectedCareContext.encounterId}</span>
                {view.selectedCareContext.department
                  ? ` · ${view.selectedCareContext.department}`
                  : ''}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ...projection.careContexts.activeOpdEncounters,
              ...(projection.careContexts.activeIpdEncounter
                ? [projection.careContexts.activeIpdEncounter]
                : []),
              ...(projection.careContexts.activeEmergencyEncounter
                ? [projection.careContexts.activeEmergencyEncounter]
                : []),
              ...projection.careContexts.activeTelehealthEncounters,
            ].map((encounter) => {
              const selected =
                view.selectedCareContext?.encounterId === encounter.encounterId;
              return (
                <button
                  key={encounter.encounterId}
                  type="button"
                  onClick={() =>
                    setCareContextRequest({
                      careSetting:
                        encounter.careSetting === 'UNKNOWN'
                          ? undefined
                          : encounter.careSetting,
                      encounterId: encounter.encounterId,
                    })
                  }
                  className={
                    selected
                      ? 'rounded-lg border border-indigo-300 bg-indigo-600 px-3 py-2 text-xs font-semibold text-white'
                      : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50'
                  }
                >
                  {encounter.careSetting} · {encounter.department || 'Clinical service'}
                </button>
              );
            })}
          </div>
        </section>

        <ClinicalCopilotWorkspace
          tenantId={tenantId}
          patientId={patientId}
          encounterId={view.selectedCareContext?.encounterId}
          careSetting={view.selectedCareContext?.careSetting}
          offline={offline}
          currentRevision={freshness.revision}
          currentSourceCheckpoint={freshness.sourceCheckpoint}
          onAuthoritativeChange={load}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold">Consultant attention state</h2>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-slate-500">
                Deterministic changes and unresolved work since this consultant last reviewed the selected care context.
              </p>
            </div>
            {view.consultantVisibility && !offline && (
              <button
                type="button"
                onClick={() => void recordCurrentConsultantReview()}
                disabled={consultantReviewSubmitting}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {consultantReviewSubmitting ? 'Recording review…' : 'Mark current state reviewed'}
              </button>
            )}
          </div>

          {view.consultantVisibility ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Since review</div>
                  <div className="mt-1 text-xl font-bold">{view.consultantVisibility.unreadClinicalChanges}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Open items</div>
                  <div className="mt-1 text-xl font-bold">{view.consultantVisibility.unresolvedItemsCount}</div>
                </div>
                <div className="rounded-xl bg-rose-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-rose-500">Critical</div>
                  <div className="mt-1 text-xl font-bold text-rose-800">{view.consultantVisibility.criticalItemsCount}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Pending diagnostics</div>
                  <div className="mt-1 text-xl font-bold">{view.consultantVisibility.pendingDiagnosticCount}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Medication changes</div>
                  <div className="mt-1 text-xl font-bold">{view.consultantVisibility.medicationChangesCount}</div>
                </div>
              </div>

              <div className="mt-3 text-[11px] text-slate-500">
                {offline
                  ? `Offline attention snapshot from ${dateTime(freshness.projectedAt)}. Review checkpoint and since-last-review deltas require authoritative server connectivity.`
                  : view.consultantVisibility.lastReviewedAt
                    ? `Last reviewed ${dateTime(view.consultantVisibility.lastReviewedAt)} · revision ${view.consultantVisibility.lastReviewedRevision ?? '—'}`
                    : 'No prior consultant review checkpoint exists for this care context.'}
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    What changed since your last review
                  </h3>
                  <div className="mt-2 space-y-2">
                    {view.consultantVisibility.changes.length ? (
                      view.consultantVisibility.changes.slice(0, 12).map((item) => (
                        <div
                          key={item.changeId}
                          className={
                            item.severity === 'CRITICAL_REVIEW_REQUIRED'
                              ? 'rounded-xl border border-rose-200 bg-rose-50 p-3'
                              : item.severity === 'ACTION_REQUIRED'
                                ? 'rounded-xl border border-amber-200 bg-amber-50 p-3'
                                : 'rounded-xl border border-slate-200 p-3'
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-xs font-semibold text-slate-800">{item.statement}</div>
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                              {item.severity.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {item.category.replace(/_/g, ' ')} · {dateTime(item.occurredAt)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState>
                        {offline
                          ? 'Since-last-review deltas are unavailable offline. Cached unresolved attention remains visible, but must be treated as potentially stale.'
                          : 'No new authoritative clinical changes since the last review checkpoint.'}
                      </EmptyState>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Unresolved attention
                  </h3>
                  <div className="mt-2 space-y-2">
                    {view.consultantVisibility.openItems.length ? (
                      view.consultantVisibility.openItems.slice(0, 12).map((item) => (
                        <div
                          key={item.openItemId}
                          className={
                            item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED'
                              ? 'rounded-xl border border-rose-200 bg-rose-50 p-3'
                              : 'rounded-xl border border-slate-200 p-3'
                          }
                        >
                          <div className="text-xs font-semibold text-slate-800">{item.description}</div>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {item.category} · owner {item.ownerType}
                            {item.ownerId ? ` ${item.ownerId}` : ''}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState>No unresolved consultant-attention items are currently derived.</EmptyState>
                    )}
                  </div>
                </div>
              </div>

              {consultantReviewMessage && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {consultantReviewMessage}
                </div>
              )}
            </>
          ) : offline ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              Consultant review deltas require authoritative server connectivity. The offline snapshot remains available, but G-HIMS will not fabricate a current review state.
            </div>
          ) : (
            <EmptyState>
              Consultant attention intelligence is available to authenticated consultant/doctor roles for a selected encounter.
            </EmptyState>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Pill className="h-5 w-5 text-indigo-600" />
                <h2 className="text-sm font-bold">
                  Medication Safety & Reconciliation Intelligence
                </h2>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-slate-500">
                Deterministic CI-9 checks over Patient 360 medication, allergy and reconciliation evidence. Exact-match findings are evidence-linked; absence of a finding is not proof a medication is safe.
              </p>
            </div>
            {view.medicationSafety ? (
              <span
                className={
                  view.medicationSafety.state === 'CRITICAL_REVIEW_REQUIRED'
                    ? 'inline-flex w-fit rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800'
                    : view.medicationSafety.state === 'REVIEW_REQUIRED'
                      ? 'inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800'
                      : 'inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800'
                }
              >
                {view.medicationSafety.state.replace(/_/g, ' ')}
              </span>
            ) : (
              <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                Not evaluated
              </span>
            )}
          </div>

          {offline && view.medicationSafety && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This is the last synchronized medication-safety assessment. New offline prescriptions, allergies or reconciliations require server synchronization and re-evaluation.
            </div>
          )}

          {view.medicationSafety ? (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Findings</div>
                  <div className="mt-1 text-xl font-bold">{view.medicationSafety.counts.total}</div>
                </div>
                <div className="rounded-xl bg-rose-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-rose-500">Critical</div>
                  <div className="mt-1 text-xl font-bold text-rose-800">{view.medicationSafety.counts.critical}</div>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-amber-500">Action required</div>
                  <div className="mt-1 text-xl font-bold text-amber-800">{view.medicationSafety.counts.actionRequired}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Evaluated</div>
                  <div className="mt-1 text-xs font-semibold text-slate-700">{dateTime(view.medicationSafety.evaluatedAt)}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {view.medicationSafety.findings.length ? (
                  view.medicationSafety.findings.map((finding) => (
                    <details
                      key={finding.findingId}
                      className={
                        finding.severity === 'CRITICAL_REVIEW_REQUIRED'
                          ? 'group rounded-xl border border-rose-200 bg-rose-50 px-4 py-3'
                          : 'group rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3'
                      }
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{finding.title}</div>
                            <p className="mt-1 text-xs text-slate-600">{finding.description}</p>
                          </div>
                          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                            {finding.severity.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </summary>
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Evidence
                        </div>
                        <div className="mt-2 space-y-1">
                          {finding.evidence.map((evidence, index) => (
                            <div
                              key={`${finding.findingId}-${evidence.entityId}-${index}`}
                              className="rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-slate-600"
                            >
                              {evidence.source} · {evidence.entityId} · {evidence.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>
                  ))
                ) : (
                  <EmptyState>
                    No CI-9 finding is derived from the current evidence. This does not establish medication safety beyond the implemented deterministic rules.
                  </EmptyState>
                )}
              </div>

              {view.medicationSafety.findings.some(
                (finding) => finding.type === 'MEDICATION_RECONCILIATION_REQUIRED'
              ) && (
                <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-950">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-indigo-700" />
                    <strong>Complete medication reconciliation</strong>
                  </div>
                  <p className="mt-2">
                    Review the current Patient 360 medication list against the available history and resolve every discrepancy before marking reconciliation complete.
                  </p>
                  <label className="mt-3 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={medicationReconciliationConfirmed}
                      disabled={offline}
                      onChange={(event) =>
                        setMedicationReconciliationConfirmed(event.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      I confirm that the medication list has been reviewed and there are no unresolved discrepancies.
                    </span>
                  </label>
                  <textarea
                    value={medicationReconciliationNotes}
                    onChange={(event) =>
                      setMedicationReconciliationNotes(event.target.value)
                    }
                    disabled={offline}
                    rows={2}
                    className="mt-3 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:opacity-50"
                    placeholder="Optional reconciliation notes"
                  />
                  <button
                    type="button"
                    disabled={
                      offline ||
                      medicationReconciliationSubmitting ||
                      !medicationReconciliationConfirmed
                    }
                    onClick={() =>
                      void completeCurrentMedicationReconciliation()
                    }
                    className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {medicationReconciliationSubmitting
                      ? 'Recording reconciliation…'
                      : 'Complete reconciliation'}
                  </button>
                  {medicationReconciliationMessage && (
                    <div className="mt-3 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-indigo-800">
                      {medicationReconciliationMessage}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Known limitations
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                  {view.medicationSafety.limitations.map((limitation) => (
                    <li key={limitation}>• {limitation}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <EmptyState>Medication-safety projection has not been generated yet.</EmptyState>
          )}
        </section>

        {view.selectedCareContext && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-rose-600" />
                  <h2 className="text-sm font-bold">
                    Clinical Deterioration & Escalation Intelligence
                  </h2>
                </div>
                <p className="mt-1 max-w-3xl text-xs text-slate-500">
                  Deterministic Patient 360 surveillance. CI-8 surfaces explainable deterioration signals and provenance; it does not diagnose disease, prescribe treatment, or autonomously escalate care.
                </p>
              </div>
              {view.deterioration ? (
                <span
                  className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${deteriorationStateClass(
                    view.deterioration.state
                  )}`}
                >
                  {deteriorationStateText(view.deterioration.state)}
                </span>
              ) : (
                <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Not evaluated
                </span>
              )}
            </div>

            {offline && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This is the last synchronized deterioration assessment. New offline clinical events are not authoritative until synchronization and server re-evaluation complete.
              </div>
            )}

            {view.deterioration ? (
              <>
                <div className="mt-4 grid gap-2 sm:grid-cols-5">
                  <div className="rounded-xl bg-rose-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-rose-500">Critical</div>
                    <div className="mt-1 text-xl font-bold text-rose-800">
                      {view.deterioration.critical.length}
                    </div>
                  </div>
                  <div className="rounded-xl bg-orange-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-orange-500">Escalations</div>
                    <div className="mt-1 text-xl font-bold text-orange-800">
                      {view.deterioration.escalations.length}
                    </div>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-amber-500">Warnings</div>
                    <div className="mt-1 text-xl font-bold text-amber-800">
                      {view.deterioration.warnings.length}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Ruleset</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-700">
                      {view.deterioration.rulesetVersion}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Evaluated</div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">
                      {dateTime(view.deterioration.evaluatedAt)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {[
                    ...view.deterioration.critical,
                    ...view.deterioration.escalations,
                    ...view.deterioration.warnings,
                    ...view.deterioration.information,
                  ].map((finding) => (
                    <details
                      key={finding.findingId}
                      className="group rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  finding.severity === 'CRITICAL'
                                    ? 'rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800'
                                    : finding.severity === 'ESCALATION'
                                      ? 'rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800'
                                      : finding.severity === 'WARNING'
                                        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800'
                                        : 'rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700'
                                }
                              >
                                {finding.severity}
                              </span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                {finding.domain}
                              </span>
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                              {finding.title}
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              {finding.explanation}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400">
                            {finding.ruleId}
                          </span>
                        </div>
                      </summary>
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Evidence & provenance
                        </div>
                        <div className="mt-2 space-y-1">
                          {finding.evidence.map((item, index) => (
                            <div
                              key={`${finding.findingId}-${item.entityId}-${index}`}
                              className="rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-slate-600"
                            >
                              {item.source} · {item.entityType} · {item.entityId}
                              {item.label ? ` · ${item.label}` : ''}
                              {item.occurredAt ? ` · ${dateTime(item.occurredAt)}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>

                <div className="mt-4 text-[10px] text-slate-400">
                  Evaluation {view.deterioration.evaluationId} · Patient 360 rev {view.deterioration.patient360Revision}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                No CI-8 assessment is available for this active encounter yet. A relevant authoritative clinical event will trigger evaluation.
              </div>
            )}
          </section>
        )}

        {view.selectedCareContext?.careSetting === 'IPD' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-sm font-bold">Discharge Readiness Intelligence</h2>
                </div>
                <p className="mt-1 max-w-3xl text-xs text-slate-500">
                  Deterministic Patient 360 decision support. CI-7 surfaces unresolved evidence and safety constraints; it does not authorize discharge.
                </p>
              </div>
              {view.dischargeReadiness ? (
                <span
                  className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${readinessStateClass(
                    view.dischargeReadiness.state
                  )}`}
                >
                  {readinessStateText(view.dischargeReadiness.state)}
                </span>
              ) : (
                <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Not evaluated
                </span>
              )}
            </div>

            {offline && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This is the last synchronized discharge-readiness assessment. New offline clinical events are not authoritative until synchronization and server re-evaluation complete.
              </div>
            )}

            {view.dischargeReadiness ? (
              <>
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-rose-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-rose-500">Blockers</div>
                    <div className="mt-1 text-xl font-bold text-rose-800">{view.dischargeReadiness.blockers.length}</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-amber-500">Warnings</div>
                    <div className="mt-1 text-xl font-bold text-amber-800">{view.dischargeReadiness.warnings.length}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Ruleset</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-700">{view.dischargeReadiness.rulesetVersion}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Evaluated</div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">{dateTime(view.dischargeReadiness.evaluatedAt)}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {[
                    ...view.dischargeReadiness.blockers,
                    ...view.dischargeReadiness.warnings,
                    ...view.dischargeReadiness.information,
                  ].map((finding) => (
                    <details
                      key={finding.findingId}
                      className="group rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  finding.severity === 'BLOCKER'
                                    ? 'rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800'
                                    : finding.severity === 'WARNING'
                                      ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800'
                                      : 'rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700'
                                }
                              >
                                {finding.severity}
                              </span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                {finding.domain}
                              </span>
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{finding.title}</div>
                            <p className="mt-1 text-xs text-slate-600">{finding.explanation}</p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400">{finding.ruleId}</span>
                        </div>
                      </summary>
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Evidence & provenance
                        </div>
                        <div className="mt-2 space-y-1">
                          {finding.evidence.map((item, index) => (
                            <div
                              key={`${finding.findingId}-${item.entityId}-${index}`}
                              className="rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-slate-600"
                            >
                              {item.source} · {item.entityType} · {item.entityId}
                              {item.label ? ` · ${item.label}` : ''}
                              {item.occurredAt ? ` · ${dateTime(item.occurredAt)}` : ''}
                            </div>
                          ))}
                        </div>
                        {finding.code === 'CRITICAL_RESULT_UNACKNOWLEDGED' && (() => {
                          const reportId =
                            finding.evidence.find(
                              (item) => item.source === 'DIAGNOSTIC_RESULT'
                            )?.entityId || '';
                          return reportId ? (
                            <button
                              type="button"
                              disabled={offline || criticalAckReportId === reportId}
                              onClick={() =>
                                void acknowledgeCriticalResult(
                                  reportId,
                                  view.dischargeReadiness!.encounterId
                                )
                              }
                              className="mt-3 inline-flex items-center rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {criticalAckReportId === reportId
                                ? 'Recording acknowledgement…'
                                : 'Acknowledge reviewed critical result'}
                            </button>
                          ) : null;
                        })()}
                      </div>
                    </details>
                  ))}
                </div>

                {criticalAckMessage && (
                  <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    {criticalAckMessage}
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-bold text-slate-800">Clinician review</div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Recording a review does not clear blockers or discharge the patient. Emergency override remains a separate governed pathway.
                  </p>
                  <textarea
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    disabled={offline || reviewSubmitting}
                    placeholder="Optional review note; required for escalation"
                    className="mt-3 min-h-20 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-slate-400 disabled:opacity-50"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={offline || reviewSubmitting}
                      onClick={() => void submitReadinessReview('ACKNOWLEDGED')}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Record clinician review
                    </button>
                    {view.dischargeReadiness.blockers.length === 0 &&
                      view.dischargeReadiness.warnings.length > 0 && (
                        <button
                          type="button"
                          disabled={offline || reviewSubmitting}
                          onClick={() => void submitReadinessReview('PROCEED_WITH_WARNINGS')}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                        >
                          Acknowledge warnings
                        </button>
                      )}
                    <button
                      type="button"
                      disabled={offline || reviewSubmitting}
                      onClick={() => void submitReadinessReview('ESCALATE')}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 disabled:opacity-50"
                    >
                      Escalate
                    </button>
                  </div>
                  {reviewMessage && (
                    <div className="mt-3 text-xs text-slate-600">{reviewMessage}</div>
                  )}
                </div>

                <div className="mt-4 text-[10px] text-slate-400">
                  Evaluation {view.dischargeReadiness.evaluationId} · Patient 360 rev {view.dischargeReadiness.patient360Revision}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                No CI-7 assessment is available for this inpatient encounter yet. A relevant authoritative clinical event will trigger evaluation.
              </div>
            )}
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold">Active clinical context</h2>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Longitudinal problem list
                    </h3>
                    <div className="mt-2 space-y-2">
                      {longitudinalProblems.length ? (
                        longitudinalProblems.map((item) => (
                          <div key={item.conditionId} className="rounded-lg border border-slate-200 p-3">
                            <div className="text-sm font-semibold">{item.display}</div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {item.system || 'LOCAL'} {item.code || ''} · {item.verificationStatus}
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyState>
                          {knowledgeEmptyState('Problem list', projection.dataQuality.problemListKnowledge)}
                        </EmptyState>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Signed encounter diagnoses
                    </h3>
                    <div className="mt-2 space-y-2">
                      {encounterDiagnoses.length ? (
                        encounterDiagnoses.map((item) => (
                          <div key={item.conditionId} className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                            <div className="text-sm font-semibold">{item.display}</div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {item.system || 'ICD10'} {item.code || ''} · {item.verificationStatus}
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyState>No signed encounter diagnosis is currently available.</EmptyState>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Allergies & intolerances
                  </h3>
                  <div className="mt-2 space-y-2">
                    {projection.allergies.length ? (
                      projection.allergies.map((item) => (
                        <div key={item.allergyId} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold">{item.substance}</span>
                            <span className="text-[10px] font-bold text-rose-700">
                              {item.criticality}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.category} · {item.verificationStatus}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState>
                        {knowledgeEmptyState('Allergies', projection.dataQuality.allergyKnowledge)}
                      </EmptyState>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-rose-600" />
                <h2 className="text-sm font-bold">Latest vital observations</h2>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projection.latestVitals.length ? (
                  projection.latestVitals.map((item) => (
                    <div key={item.observationId} className="rounded-xl border border-slate-200 p-4">
                      <div className="text-[11px] font-medium text-slate-500">{item.display}</div>
                      <div className="mt-1 text-lg font-bold">{valueText(item.value)}</div>
                      <div className="mt-2 text-[10px] text-slate-400">
                        {dateTime(item.effectiveAt)}
                        {item.interpretation ? ` · ${item.interpretation}` : ''}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <EmptyState>No canonical vital observations are available.</EmptyState>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-violet-600" />
                  <h2 className="text-sm font-bold">Recent diagnostic reports</h2>
                </div>
                {latestResultAt > 0 && (
                  <span className="text-[10px] text-slate-400">
                    Latest {dateTime(latestResultAt)}
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {projection.recentResults.length ? (
                  projection.recentResults.map((item) => (
                    <Link
                      key={item.diagnosticReportId}
                      href={item.orderId
                        ? `/${encodeURIComponent(tenantId)}/diagnostics/results/${encodeURIComponent(item.orderId)}`
                        : '#'}
                      className="block rounded-xl border border-slate-200 p-4 transition hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{item.display}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.category} · {dateTime(item.issuedAt)}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
                          {item.status}
                        </span>
                      </div>
                      {item.conclusion && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.conclusion}</p>
                      )}
                    </Link>
                  ))
                ) : (
                  <EmptyState>No canonical diagnostic reports are available.</EmptyState>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Pill className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-bold">Current medication orders</h2>
              </div>
              <div className="mt-4 space-y-2">
                {projection.currentMedications.length ? (
                  projection.currentMedications.map((item) => (
                    <div key={item.medicationOrderId} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm font-semibold">{item.medication}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {item.dosageText}
                        {item.frequency ? ` · ${item.frequency}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {item.status} · {dateTime(item.authoredAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState>
                    {knowledgeEmptyState('Medication history', projection.dataQuality.medicationKnowledge)}
                  </EmptyState>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-600" />
                <h2 className="text-sm font-bold">Recent signed documents</h2>
              </div>
              <div className="mt-4 space-y-2">
                {projection.recentDocuments.length ? (
                  projection.recentDocuments.map((item) => (
                    <div key={item.clinicalDocumentId} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm font-semibold">
                        {item.title || item.documentType}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        Signed {dateTime(item.signedAt)} · {item.status}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState>No signed canonical documents are available.</EmptyState>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold">Clinical timeline</h2>
              </div>
              <div className="mt-4 space-y-3">
                {timeline.length ? (
                  timeline.slice(0, 30).map((item) => (
                    <div key={item.timelineItemId} className="border-l-2 border-slate-200 pl-3">
                      <div className="text-xs font-medium text-slate-800">{item.summary}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {dateTime(item.occurredAt)}
                      </div>
                    </div>
                  ))
                ) : offline ? (
                  <EmptyState>Detailed timeline requires server connectivity.</EmptyState>
                ) : (
                  <EmptyState>No patient-scoped timeline events are available.</EmptyState>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="text-[10px] text-slate-400">
          Projection checkpoint: <span className="font-mono">{freshness.sourceCheckpoint}</span>
          {' · '}Projected {dateTime(freshness.projectedAt)}
        </div>
      </div>
    </div>
  );
}
