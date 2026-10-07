'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTenant } from '@/lib/tenant/context';
import { useHospital } from '@/lib/context/hospital-context';
import {
  fetchWave2Workspace,
  wave2Client,
  type Wave2WorkspaceSnapshot,
} from '@/lib/clinical/wave2-client';

export type Wave2Domain =
  | 'nursing'
  | 'renal'
  | 'obstetrics'
  | 'oncology'
  | 'rehabilitation';

const domainLabels: Record<Wave2Domain, string> = {
  nursing: 'Nursing & eMAR',
  renal: 'Renal / Dialysis',
  obstetrics: 'Obstetrics / Partogram',
  oncology: 'Oncology / Tumor Board',
  rehabilitation: 'Rehabilitation',
};

function splitLines(value: string): string[] {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function text(record: Record<string, unknown>, key: string): string {
  return String(record[key] || '').trim();
}

function recordId(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(record, key);
    if (value) return value;
  }
  return '';
}

function medicationLabel(record: Record<string, unknown>): string {
  const medication = record.medication as Record<string, unknown> | undefined;
  const codings = Array.isArray(medication?.codings)
    ? (medication?.codings as Array<Record<string, unknown>>)
    : [];
  return (
    String(medication?.text || '').trim() ||
    String(codings[0]?.display || '').trim() ||
    String(record.dosageText || '').trim() ||
    recordId(record, 'medicationOrderId', 'id')
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">{props.label}</span>
      <input
        data-testid={props.testId}
        type={props.type || 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );
}

function TextArea(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">{props.label}</span>
      <textarea
        data-testid={props.testId}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={3}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );
}

function ActionButton(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      data-testid={props.testId}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
    >
      {props.children}
    </button>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h3 className="font-semibold text-slate-900 dark:text-white">{props.title}</h3>
      {props.children}
    </section>
  );
}

function RecordSelect(props: {
  label: string;
  value: string;
  records: Record<string, unknown>[];
  idKeys: string[];
  labelFor: (record: Record<string, unknown>) => string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  testId?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">{props.label}</span>
      <select
        data-testid={props.testId}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <option value="">{props.emptyLabel || 'Select authoritative record'}</option>
        {props.records.map((record) => {
          const id = recordId(record, ...props.idKeys);
          return id ? (
            <option key={id} value={id}>
              {props.labelFor(record)}
            </option>
          ) : null;
        })}
      </select>
    </label>
  );
}

function ToggleList(props: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{props.label}</div>
      <div className="flex max-h-44 flex-wrap gap-2 overflow-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
        {props.options.length === 0 && (
          <span className="text-xs text-slate-500">No authoritative options available.</span>
        )}
        {props.options.map((option) => {
          const active = props.selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                props.onChange(
                  active
                    ? props.selected.filter((item) => item !== option.id)
                    : [...props.selected, option.id]
                )
              }
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Wave2ClinicalWorkspace({
  initialDomain = 'nursing',
}: {
  initialDomain?: Wave2Domain;
}) {
  const { currentTenant } = useTenant();
  const { selectedPatientId, patients } = useHospital();
  const tenantId = currentTenant?.id || '';
  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId),
    [patients, selectedPatientId]
  );

  const [domain, setDomain] = useState<Wave2Domain>(initialDomain);
  const [patientId, setPatientId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [workspace, setWorkspace] = useState<Wave2WorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastEntityId, setLastEntityId] = useState('');

  const [medicationOrderId, setMedicationOrderId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [emarSlotId, setEmarSlotId] = useState('');
  const [emarOutcome, setEmarOutcome] =
    useState<'GIVEN' | 'HELD' | 'REFUSED' | 'MISSED' | 'DELAYED'>('GIVEN');
  const [emarReason, setEmarReason] = useState('');
  const [carePlanTitle, setCarePlanTitle] = useState('');
  const [carePlanGoals, setCarePlanGoals] = useState('');
  const [carePlanInterventions, setCarePlanInterventions] = useState('');
  const [nursingCarePlanId, setNursingCarePlanId] = useState('');
  const [nursingInterventionId, setNursingInterventionId] = useState('');
  const [nursingInterventionStatus, setNursingInterventionStatus] =
    useState<'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'>('COMPLETED');

  const [dialysisOrderId, setDialysisOrderId] = useState('');
  const [dialysisSessionId, setDialysisSessionId] = useState('');
  const [dialysisMachineId, setDialysisMachineId] = useState('');
  const [dialysisAccess, setDialysisAccess] = useState('');
  const [dialysisModality, setDialysisModality] = useState('HEMODIALYSIS');
  const [dialysisPreWeight, setDialysisPreWeight] = useState('');
  const [dialysisPostWeight, setDialysisPostWeight] = useState('');
  const [dialysisUf, setDialysisUf] = useState('');
  const [dialysisComplications, setDialysisComplications] = useState('');

  const [obEpisodeId, setObEpisodeId] = useState('');
  const [gestWeeks, setGestWeeks] = useState('39');
  const [gravida, setGravida] = useState('1');
  const [para, setPara] = useState('0');
  const [fhr, setFhr] = useState('');
  const [dilation, setDilation] = useState('');
  const [maternalHr, setMaternalHr] = useState('');
  const [systolicBp, setSystolicBp] = useState('');
  const [diastolicBp, setDiastolicBp] = useState('');
  const [contractions, setContractions] = useState('');
  const [obStage, setObStage] = useState('LABOR');
  const [obReason, setObReason] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'VAGINAL' | 'ASSISTED' | 'CESAREAN'>('VAGINAL');
  const [newbornIds, setNewbornIds] = useState('');
  const [maternalOutcome, setMaternalOutcome] = useState('');
  const [neonatalOutcome, setNeonatalOutcome] = useState('');

  const [oncologyCaseId, setOncologyCaseId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [oncEvidenceIds, setOncEvidenceIds] = useState<string[]>([]);
  const [tumorAttendees, setTumorAttendees] = useState('');
  const [tumorRecommendation, setTumorRecommendation] = useState('');
  const [tumorRecommendationId, setTumorRecommendationId] = useState('');
  const [regimenName, setRegimenName] = useState('');
  const [regimenMedicationIds, setRegimenMedicationIds] = useState<string[]>([]);
  const [oncologyRegimenId, setOncologyRegimenId] = useState('');
  const [chemoAdministrationId, setChemoAdministrationId] = useState('');
  const [chemoCycle, setChemoCycle] = useState('1');
  const [toxicityGrade, setToxicityGrade] = useState('1');
  const [toxicityFindings, setToxicityFindings] = useState('');

  const [rehabPlanId, setRehabPlanId] = useState('');
  const [rehabGoals, setRehabGoals] = useState('');
  const [rehabDiscipline, setRehabDiscipline] = useState('PHYSIOTHERAPY');
  const [rehabOutcome, setRehabOutcome] = useState('');
  const [rehabGoalId, setRehabGoalId] = useState('');
  const [rehabHandoffId, setRehabHandoffId] = useState('');

  const scopeReady = Boolean(tenantId && patientId.trim() && encounterId.trim());

  useEffect(() => {
    if (!selectedPatientId) return;
    setPatientId(selectedPatientId);
    if (selectedPatient?.activeEncounterId) {
      setEncounterId(selectedPatient.activeEncounterId);
    }
  }, [selectedPatientId, selectedPatient?.activeEncounterId]);

  useEffect(() => {
    setDomain(initialDomain);
  }, [initialDomain]);

  const selectedCarePlan = useMemo(
    () =>
      workspace?.nursingCarePlans.find(
        (item) => recordId(item, 'carePlanId', 'id') === nursingCarePlanId
      ),
    [workspace, nursingCarePlanId]
  );

  const selectedRehabPlan = useMemo(
    () =>
      workspace?.rehabilitationPlans.find(
        (item) => recordId(item, 'rehabilitationPlanId', 'id') === rehabPlanId
      ),
    [workspace, rehabPlanId]
  );

  const oncologyMedicationOptions = useMemo(
    () =>
      (workspace?.activeMedicationOrders || []).map((item) => ({
        id: recordId(item, 'medicationOrderId', 'id'),
        label: medicationLabel(item),
      })).filter((item) => item.id),
    [workspace]
  );

  const oncologyEvidenceOptions = useMemo(
    () =>
      (workspace?.oncologyEvidenceSources || []).map((item) => ({
        id: item.evidenceId,
        label: `${item.evidenceType}: ${item.label || item.evidenceId}`,
      })),
    [workspace]
  );

  function chooseDefaults(snapshot: Wave2WorkspaceSnapshot) {
    const activeOrder = snapshot.activeMedicationOrders.find(
      (item) => text(item, 'status') === 'ACTIVE'
    );
    setMedicationOrderId(recordId(activeOrder || {}, 'medicationOrderId', 'id'));

    const dueSlot = snapshot.emarScheduleSlots.find(
      (item) => text(item, 'status') === 'DUE'
    );
    setEmarSlotId(recordId(dueSlot || {}, 'emarSlotId', 'id'));

    const activeCarePlan = snapshot.nursingCarePlans.find(
      (item) => text(item, 'status') === 'ACTIVE'
    );
    const carePlanId = recordId(activeCarePlan || {}, 'carePlanId', 'id');
    setNursingCarePlanId(carePlanId);
    const carePlanInterventions = Array.isArray(activeCarePlan?.interventions)
      ? (activeCarePlan?.interventions as Array<Record<string, unknown>>)
      : [];
    const openIntervention = carePlanInterventions.find(
      (item) => !['COMPLETED', 'CANCELLED'].includes(text(item, 'status'))
    );
    setNursingInterventionId(recordId(openIntervention || {}, 'interventionId'));

    const activeDialysisOrder = snapshot.renalDialysisOrders.find(
      (item) => text(item, 'status') === 'ACTIVE'
    );
    setDialysisOrderId(
      recordId(activeDialysisOrder || {}, 'dialysisOrderId', 'id')
    );
    const activeDialysisSession = snapshot.renalDialysisSessions.find(
      (item) => text(item, 'status') === 'IN_PROGRESS'
    );
    setDialysisSessionId(
      recordId(activeDialysisSession || {}, 'dialysisSessionId', 'id')
    );

    const activeObEpisode = snapshot.obstetricEpisodes.find(
      (item) => text(item, 'stage') !== 'COMPLETED'
    );
    setObEpisodeId(
      recordId(activeObEpisode || {}, 'obstetricEpisodeId', 'id')
    );

    const activeOncologyCase = snapshot.oncologyCases.find(
      (item) => text(item, 'status') !== 'CLOSED'
    );
    const caseId = recordId(activeOncologyCase || {}, 'oncologyCaseId', 'id');
    setOncologyCaseId(caseId);
    const recommendation = snapshot.oncologyTumorBoardRecommendations.find(
      (item) => text(item, 'oncologyCaseId') === caseId
    );
    setTumorRecommendationId(
      recordId(recommendation || {}, 'recommendationId', 'id')
    );
    const regimen = snapshot.oncologyRegimens.find(
      (item) =>
        text(item, 'oncologyCaseId') === caseId &&
        !['COMPLETED', 'STOPPED'].includes(text(item, 'status'))
    );
    setOncologyRegimenId(recordId(regimen || {}, 'regimenId', 'id'));

    const activeRehab = snapshot.rehabilitationPlans.find(
      (item) => text(item, 'status') === 'ACTIVE'
    );
    const planId = recordId(activeRehab || {}, 'rehabilitationPlanId', 'id');
    setRehabPlanId(planId);
    const goals = Array.isArray(activeRehab?.goals)
      ? (activeRehab?.goals as Array<Record<string, unknown>>)
      : [];
    setRehabGoalId(
      recordId(
        goals.find((goal) => text(goal, 'status') === 'ACTIVE') || goals[0] || {},
        'goalId'
      )
    );
    setRehabHandoffId(
      recordId(
        snapshot.acceptedClinicalHandoffs[0] || {},
        'handoffId',
        'id'
      )
    );
  }

  async function hydrateWorkspace() {
    if (!scopeReady) return null;
    const snapshot = await fetchWave2Workspace(
      tenantId,
      patientId.trim(),
      encounterId.trim()
    );
    setWorkspace(snapshot);
    chooseDefaults(snapshot);
    return snapshot;
  }

  async function run(
    action: () => Promise<{
      success: boolean;
      entityId?: string;
      queuedOffline?: boolean;
      error?: { message?: string };
    }>
  ) {
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (!result.success) {
        throw new Error(result.error?.message || 'Command was rejected.');
      }
      setLastEntityId(String(result.entityId || ''));
      setMessage(
        result.queuedOffline
          ? 'Queued securely for governed replay. No authoritative state is assumed until server acceptance.'
          : result.entityId
            ? `Committed: ${result.entityId}`
            : 'Command committed.'
      );
      if (!result.queuedOffline && scopeReady) {
        try {
          await hydrateWorkspace();
        } catch {
          // The authoritative command has already committed. A transient read
          // refresh failure must not imply the mutation failed.
        }
      }
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadWorkspace() {
    setBusy(true);
    setMessage('');
    try {
      await hydrateWorkspace();
      setMessage('Authoritative Wave 2 workspace loaded.');
    } catch (error) {
      setWorkspace(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const dueSlots = (workspace?.emarScheduleSlots || []).filter(
    (item) => text(item, 'status') === 'DUE'
  );
  const activeDialysisOrders = (workspace?.renalDialysisOrders || []).filter(
    (item) => text(item, 'status') === 'ACTIVE'
  );
  const activeDialysisSessions = (workspace?.renalDialysisSessions || []).filter(
    (item) => text(item, 'status') === 'IN_PROGRESS'
  );
  const activeObEpisodes = (workspace?.obstetricEpisodes || []).filter(
    (item) => text(item, 'stage') !== 'COMPLETED'
  );
  const activeOncologyCases = (workspace?.oncologyCases || []).filter(
    (item) => text(item, 'status') !== 'CLOSED'
  );
  const caseRecommendations = (workspace?.oncologyTumorBoardRecommendations || []).filter(
    (item) => text(item, 'oncologyCaseId') === oncologyCaseId
  );
  const caseRegimens = (workspace?.oncologyRegimens || []).filter(
    (item) => text(item, 'oncologyCaseId') === oncologyCaseId
  );
  const givenAdministrations = (workspace?.medicationAdministrations || []).filter(
    (item) => text(item, 'status') === 'GIVEN'
  );
  const activeRehabPlans = (workspace?.rehabilitationPlans || []).filter(
    (item) => text(item, 'status') === 'ACTIVE'
  );

  return (
    <div className="space-y-6" data-testid="wave2-clinical-workspace">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Wave 2 Clinical Domains
            </div>
            <h1 className="mt-1 text-2xl font-bold">
              Authoritative Specialty Care Workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Commands are server-governed. Medication orders, clinical evidence,
              regimens and lifecycle transitions cannot be invented by this browser.
            </p>
          </div>
          <div
            data-testid="wave2-scope"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
          >
            {scopeReady
              ? `${patientId} · ${encounterId}`
              : 'Select a patient with an active encounter'}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Field
            label="Patient ID"
            value={patientId}
            onChange={setPatientId}
            placeholder="Inherited from global patient context when available"
            testId="wave2-patient-id"
          />
          <Field
            label="Active Encounter ID"
            value={encounterId}
            onChange={setEncounterId}
            placeholder="Inherited from selected patient's active encounter"
            testId="wave2-encounter-id"
          />
        </div>
        <div className="mt-3">
          <ActionButton
            testId="wave2-load-workspace"
            disabled={busy || !scopeReady}
            onClick={() => void loadWorkspace()}
          >
            Load authoritative workspace
          </ActionButton>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(domainLabels) as Wave2Domain[]).map((item) => (
            <button
              key={item}
              data-testid={`wave2-tab-${item}`}
              type="button"
              onClick={() => setDomain(item)}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                domain === item
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'border border-slate-200 dark:border-slate-700'
              }`}
            >
              {domainLabels[item]}
            </button>
          ))}
        </div>

        {workspace && (
          <div className="mt-4 text-xs text-slate-500">
            Hydrated {new Date(workspace.generatedAt).toLocaleString()} ·
            {' '}{workspace.activeMedicationOrders.length} active/on-hold medication orders ·
            {' '}{workspace.acceptedClinicalHandoffs.length} accepted handoffs
          </div>
        )}

        {message && (
          <div
            data-testid="wave2-message"
            className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {message}
          </div>
        )}
      </header>

      {domain === 'nursing' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Medication schedule">
            <RecordSelect
              label="Active medication order"
              value={medicationOrderId}
              records={(workspace?.activeMedicationOrders || []).filter(
                (item) => text(item, 'status') === 'ACTIVE'
              )}
              idKeys={['medicationOrderId', 'id']}
              labelFor={(item) =>
                `${medicationLabel(item)} · ${text(item, 'dosageText') || 'dose per order'}`
              }
              onChange={setMedicationOrderId}
              testId="wave2-medication-order"
            />
            <Field
              label="Scheduled time"
              value={scheduledFor}
              onChange={setScheduledFor}
              type="datetime-local"
              testId="wave2-emar-scheduled-for"
            />
            <ActionButton
              testId="wave2-emar-schedule"
              disabled={busy || !workspace || !medicationOrderId || !scheduledFor}
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.scheduleMedication(tenantId, {
                    patientId,
                    encounterId,
                    medicationOrderId,
                    scheduledFor: toTimestamp(scheduledFor),
                  });
                  if (result.entityId) setEmarSlotId(result.entityId);
                  return result;
                })
              }
            >
              Create authoritative eMAR slot
            </ActionButton>
          </Card>

          <Card title="Bedside administration">
            <RecordSelect
              label="Due eMAR slot"
              value={emarSlotId}
              records={dueSlots}
              idKeys={['emarSlotId', 'id']}
              labelFor={(item) =>
                `${text(item, 'medicationOrderId')} · ${new Date(
                  Number(item.scheduledFor || 0)
                ).toLocaleString()}`
              }
              onChange={setEmarSlotId}
              testId="wave2-emar-slot"
            />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Outcome</span>
              <select
                data-testid="wave2-emar-outcome"
                value={emarOutcome}
                onChange={(event) =>
                  setEmarOutcome(event.target.value as typeof emarOutcome)
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                {['GIVEN', 'HELD', 'REFUSED', 'MISSED', 'DELAYED'].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  )
                )}
              </select>
            </label>
            {emarOutcome !== 'GIVEN' && (
              <TextArea
                label="Exception reason"
                value={emarReason}
                onChange={setEmarReason}
                testId="wave2-emar-reason"
              />
            )}
            <ActionButton
              testId="wave2-emar-administer"
              disabled={busy || !workspace || !emarSlotId}
              onClick={() => {
                const slot = dueSlots.find(
                  (item) => recordId(item, 'emarSlotId', 'id') === emarSlotId
                );
                const slotOrderId = text(slot || {}, 'medicationOrderId');
                const order = workspace?.activeMedicationOrders.find(
                  (item) =>
                    recordId(item, 'medicationOrderId', 'id') === slotOrderId
                );
                void run(() =>
                  wave2Client.administerMedication(tenantId, {
                    patientId,
                    encounterId,
                    emarSlotId,
                    outcome: emarOutcome,
                    administeredAt: Date.now(),
                    expectedMedicationOrderVersion: Number(
                      order?._serverVersion || 0
                    ),
                    ...(emarOutcome !== 'GIVEN' ? { reason: emarReason } : {}),
                  })
                );
              }}
            >
              Commit administration outcome
            </ActionButton>
          </Card>

          <Card title="Nursing care plan">
            <Field
              label="Plan title"
              value={carePlanTitle}
              onChange={setCarePlanTitle}
            />
            <TextArea
              label="Goals (one per line)"
              value={carePlanGoals}
              onChange={setCarePlanGoals}
            />
            <TextArea
              label="Interventions (one per line)"
              value={carePlanInterventions}
              onChange={setCarePlanInterventions}
            />
            <ActionButton
              disabled={busy || !workspace}
              onClick={() =>
                void run(() =>
                  wave2Client.createNursingCarePlan(tenantId, {
                    patientId,
                    encounterId,
                    title: carePlanTitle,
                    goals: splitLines(carePlanGoals),
                    interventions: splitLines(carePlanInterventions).map(
                      (description) => ({ description })
                    ),
                  })
                )
              }
            >
              Create nursing care plan
            </ActionButton>
          </Card>

          <Card title="Care-plan intervention">
            <RecordSelect
              label="Active care plan"
              value={nursingCarePlanId}
              records={(workspace?.nursingCarePlans || []).filter(
                (item) => text(item, 'status') === 'ACTIVE'
              )}
              idKeys={['carePlanId', 'id']}
              labelFor={(item) => text(item, 'title') || recordId(item, 'id')}
              onChange={(value) => {
                setNursingCarePlanId(value);
                const plan = workspace?.nursingCarePlans.find(
                  (item) => recordId(item, 'carePlanId', 'id') === value
                );
                const interventions = Array.isArray(plan?.interventions)
                  ? (plan?.interventions as Array<Record<string, unknown>>)
                  : [];
                setNursingInterventionId(
                  recordId(
                    interventions.find(
                      (item) =>
                        !['COMPLETED', 'CANCELLED'].includes(
                          text(item, 'status')
                        )
                    ) || {},
                    'interventionId'
                  )
                );
              }}
            />
            <RecordSelect
              label="Intervention"
              value={nursingInterventionId}
              records={
                Array.isArray(selectedCarePlan?.interventions)
                  ? (selectedCarePlan?.interventions as Array<
                      Record<string, unknown>
                    >)
                  : []
              }
              idKeys={['interventionId']}
              labelFor={(item) =>
                `${text(item, 'description')} · ${text(item, 'status')}`
              }
              onChange={setNursingInterventionId}
            />
            <label className="space-y-1 text-sm">
              <span className="font-medium">New status</span>
              <select
                value={nursingInterventionStatus}
                onChange={(event) =>
                  setNursingInterventionStatus(
                    event.target.value as typeof nursingInterventionStatus
                  )
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <option>IN_PROGRESS</option>
                <option>COMPLETED</option>
                <option>CANCELLED</option>
              </select>
            </label>
            <ActionButton
              disabled={busy || !nursingCarePlanId || !nursingInterventionId}
              onClick={() =>
                void run(() =>
                  wave2Client.updateNursingIntervention(tenantId, {
                    patientId,
                    encounterId,
                    carePlanId: nursingCarePlanId,
                    interventionId: nursingInterventionId,
                    status: nursingInterventionStatus,
                  })
                )
              }
            >
              Update intervention
            </ActionButton>
          </Card>
        </div>
      )}

      {domain === 'renal' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="Dialysis order">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Modality</span>
              <select
                value={dialysisModality}
                onChange={(event) => setDialysisModality(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                {[
                  'HEMODIALYSIS',
                  'HEMOFILTRATION',
                  'HEMODIAFILTRATION',
                  'PERITONEAL',
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <Field
              label="Vascular access plan"
              value={dialysisAccess}
              onChange={setDialysisAccess}
            />
            <ActionButton
              disabled={busy || !workspace || !dialysisAccess}
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.createDialysisOrder(
                    tenantId,
                    {
                      patientId,
                      encounterId,
                      modality: dialysisModality,
                      prescribedDurationMinutes: 240,
                      vascularAccessPlan: dialysisAccess,
                    }
                  );
                  if (result.entityId) setDialysisOrderId(result.entityId);
                  return result;
                })
              }
            >
              Create dialysis order
            </ActionButton>
          </Card>

          <Card title="Start session">
            <RecordSelect
              label="Active dialysis order"
              value={dialysisOrderId}
              records={activeDialysisOrders}
              idKeys={['dialysisOrderId', 'id']}
              labelFor={(item) =>
                `${text(item, 'modality')} · ${text(
                  item,
                  'vascularAccessPlan'
                )}`
              }
              onChange={setDialysisOrderId}
            />
            <Field
              label="Machine ID"
              value={dialysisMachineId}
              onChange={setDialysisMachineId}
            />
            <Field
              label="Pre-dialysis weight (kg)"
              value={dialysisPreWeight}
              onChange={setDialysisPreWeight}
              type="number"
            />
            <ActionButton
              disabled={busy || !dialysisOrderId || !dialysisMachineId}
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.startDialysisSession(
                    tenantId,
                    {
                      patientId,
                      encounterId,
                      dialysisOrderId,
                      machineId: dialysisMachineId,
                      preObservation: {
                        ...(dialysisPreWeight
                          ? { weightKg: Number(dialysisPreWeight) }
                          : {}),
                      },
                    }
                  );
                  if (result.entityId) setDialysisSessionId(result.entityId);
                  return result;
                })
              }
            >
              Start dialysis session
            </ActionButton>
          </Card>

          <Card title="Complete session">
            <RecordSelect
              label="In-progress session"
              value={dialysisSessionId}
              records={activeDialysisSessions}
              idKeys={['dialysisSessionId', 'id']}
              labelFor={(item) =>
                `${text(item, 'machineId')} · ${new Date(
                  Number(item.startedAt || 0)
                ).toLocaleString()}`
              }
              onChange={setDialysisSessionId}
            />
            <Field
              label="Post-dialysis weight (kg)"
              value={dialysisPostWeight}
              onChange={setDialysisPostWeight}
              type="number"
            />
            <Field
              label="Ultrafiltration (mL)"
              value={dialysisUf}
              onChange={setDialysisUf}
              type="number"
            />
            <TextArea
              label="Complications"
              value={dialysisComplications}
              onChange={setDialysisComplications}
            />
            <ActionButton
              disabled={busy || !dialysisSessionId}
              onClick={() =>
                void run(() =>
                  wave2Client.completeDialysisSession(tenantId, {
                    patientId,
                    encounterId,
                    dialysisSessionId,
                    status: 'COMPLETED',
                    postObservation: {
                      ...(dialysisPostWeight
                        ? { weightKg: Number(dialysisPostWeight) }
                        : {}),
                    },
                    ...(dialysisUf
                      ? { ultrafiltrationMl: Number(dialysisUf) }
                      : {}),
                    complications: splitLines(dialysisComplications),
                  })
                )
              }
            >
              Complete dialysis session
            </ActionButton>
          </Card>
        </div>
      )}

      {domain === 'obstetrics' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Obstetric episode">
            <div className="grid grid-cols-3 gap-2">
              <Field
                label="Gest. weeks"
                value={gestWeeks}
                onChange={setGestWeeks}
                type="number"
              />
              <Field
                label="Gravida"
                value={gravida}
                onChange={setGravida}
                type="number"
              />
              <Field
                label="Para"
                value={para}
                onChange={setPara}
                type="number"
              />
            </div>
            <ActionButton
              disabled={busy || !workspace}
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.createObstetricEpisode(
                    tenantId,
                    {
                      patientId,
                      encounterId,
                      gestationalAgeWeeks: Number(gestWeeks),
                      gravida: Number(gravida),
                      para: Number(para),
                    }
                  );
                  if (result.entityId) setObEpisodeId(result.entityId);
                  return result;
                })
              }
            >
              Open obstetric episode
            </ActionButton>
          </Card>

          <Card title="Partogram observation">
            <RecordSelect
              label="Active obstetric episode"
              value={obEpisodeId}
              records={activeObEpisodes}
              idKeys={['obstetricEpisodeId', 'id']}
              labelFor={(item) =>
                `${text(item, 'stage')} · ${text(
                  item,
                  'gestationalAgeWeeks'
                )} weeks`
              }
              onChange={setObEpisodeId}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Fetal HR" value={fhr} onChange={setFhr} type="number" />
              <Field
                label="Cervical dilation cm"
                value={dilation}
                onChange={setDilation}
                type="number"
              />
              <Field
                label="Maternal HR"
                value={maternalHr}
                onChange={setMaternalHr}
                type="number"
              />
              <Field
                label="Systolic BP"
                value={systolicBp}
                onChange={setSystolicBp}
                type="number"
              />
              <Field
                label="Diastolic BP"
                value={diastolicBp}
                onChange={setDiastolicBp}
                type="number"
              />
              <Field
                label="Contractions / 10 min"
                value={contractions}
                onChange={setContractions}
                type="number"
              />
            </div>
            <ActionButton
              disabled={busy || !obEpisodeId}
              onClick={() =>
                void run(() =>
                  wave2Client.recordPartogramObservation(tenantId, {
                    patientId,
                    encounterId,
                    obstetricEpisodeId: obEpisodeId,
                    ...(fhr ? { fetalHeartRateBpm: Number(fhr) } : {}),
                    ...(dilation
                      ? { cervicalDilationCm: Number(dilation) }
                      : {}),
                    ...(maternalHr
                      ? { maternalHeartRateBpm: Number(maternalHr) }
                      : {}),
                    ...(systolicBp
                      ? { systolicBp: Number(systolicBp) }
                      : {}),
                    ...(diastolicBp
                      ? { diastolicBp: Number(diastolicBp) }
                      : {}),
                    ...(contractions
                      ? { contractionsPer10Min: Number(contractions) }
                      : {}),
                  })
                )
              }
            >
              Record partogram
            </ActionButton>
          </Card>

          <Card title="Stage transition">
            <RecordSelect
              label="Episode"
              value={obEpisodeId}
              records={activeObEpisodes}
              idKeys={['obstetricEpisodeId', 'id']}
              labelFor={(item) => text(item, 'stage')}
              onChange={setObEpisodeId}
            />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Target stage</span>
              <select
                value={obStage}
                onChange={(event) => setObStage(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                {['LABOR', 'DELIVERY', 'THEATRE', 'POSTPARTUM', 'COMPLETED'].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  )
                )}
              </select>
            </label>
            <TextArea
              label="Clinical reason"
              value={obReason}
              onChange={setObReason}
            />
            <ActionButton
              disabled={busy || !obEpisodeId || obReason.trim().length < 5}
              onClick={() =>
                void run(() =>
                  wave2Client.transitionObstetricEpisode(tenantId, {
                    patientId,
                    encounterId,
                    obstetricEpisodeId: obEpisodeId,
                    targetStage: obStage,
                    reason: obReason,
                  })
                )
              }
            >
              Commit stage transition
            </ActionButton>
          </Card>

          <Card title="Delivery outcome">
            <RecordSelect
              label="Delivery/theatre episode"
              value={obEpisodeId}
              records={activeObEpisodes.filter((item) =>
                ['DELIVERY', 'THEATRE'].includes(text(item, 'stage'))
              )}
              idKeys={['obstetricEpisodeId', 'id']}
              labelFor={(item) => text(item, 'stage')}
              onChange={setObEpisodeId}
            />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Mode</span>
              <select
                value={deliveryMode}
                onChange={(event) =>
                  setDeliveryMode(event.target.value as typeof deliveryMode)
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <option>VAGINAL</option>
                <option>ASSISTED</option>
                <option>CESAREAN</option>
              </select>
            </label>
            <TextArea
              label="Newborn IDs"
              value={newbornIds}
              onChange={setNewbornIds}
              placeholder="Only already-created authoritative newborn patient IDs"
            />
            <TextArea
              label="Maternal outcome"
              value={maternalOutcome}
              onChange={setMaternalOutcome}
            />
            <TextArea
              label="Neonatal outcome"
              value={neonatalOutcome}
              onChange={setNeonatalOutcome}
            />
            <ActionButton
              disabled={
                busy ||
                !obEpisodeId ||
                !maternalOutcome.trim() ||
                !neonatalOutcome.trim()
              }
              onClick={() =>
                void run(() =>
                  wave2Client.recordDeliveryOutcome(tenantId, {
                    patientId,
                    encounterId,
                    obstetricEpisodeId: obEpisodeId,
                    mode: deliveryMode,
                    newbornIds: splitLines(newbornIds),
                    maternalOutcome,
                    neonatalOutcome,
                  })
                )
              }
            >
              Record delivery outcome
            </ActionButton>
          </Card>
        </div>
      )}

      {domain === 'oncology' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Oncology case">
            <TextArea
              label="Primary diagnosis"
              value={diagnosis}
              onChange={setDiagnosis}
            />
            <ToggleList
              label="Authoritative clinical evidence"
              options={oncologyEvidenceOptions}
              selected={oncEvidenceIds}
              onChange={setOncEvidenceIds}
            />
            <ActionButton
              disabled={
                busy ||
                !workspace ||
                !diagnosis.trim() ||
                oncEvidenceIds.length === 0
              }
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.openOncologyCase(tenantId, {
                    patientId,
                    encounterId,
                    primaryDiagnosis: diagnosis,
                    evidenceRefs: oncEvidenceIds,
                  });
                  if (result.entityId) setOncologyCaseId(result.entityId);
                  return result;
                })
              }
            >
              Open evidence-linked case
            </ActionButton>
          </Card>

          <Card title="Tumor board">
            <RecordSelect
              label="Active oncology case"
              value={oncologyCaseId}
              records={activeOncologyCases}
              idKeys={['oncologyCaseId', 'id']}
              labelFor={(item) =>
                `${text(item, 'primaryDiagnosis')} · ${text(item, 'status')}`
              }
              onChange={setOncologyCaseId}
            />
            <TextArea
              label="Attendees"
              value={tumorAttendees}
              onChange={setTumorAttendees}
            />
            <TextArea
              label="Recommendation"
              value={tumorRecommendation}
              onChange={setTumorRecommendation}
            />
            <ToggleList
              label="Evidence reviewed"
              options={oncologyEvidenceOptions}
              selected={oncEvidenceIds}
              onChange={setOncEvidenceIds}
            />
            <ActionButton
              disabled={
                busy ||
                !oncologyCaseId ||
                splitLines(tumorAttendees).length < 2 ||
                oncEvidenceIds.length === 0
              }
              onClick={() =>
                void run(async () => {
                  const result =
                    await wave2Client.recordTumorBoardRecommendation(
                      tenantId,
                      {
                        patientId,
                        encounterId,
                        oncologyCaseId,
                        attendees: splitLines(tumorAttendees),
                        recommendation: tumorRecommendation,
                        evidenceRefs: oncEvidenceIds,
                      }
                    );
                  if (result.entityId) {
                    setTumorRecommendationId(result.entityId);
                  }
                  return result;
                })
              }
            >
              Record tumor board recommendation
            </ActionButton>
          </Card>

          <Card title="Regimen approval">
            <RecordSelect
              label="Tumor-board recommendation"
              value={tumorRecommendationId}
              records={caseRecommendations}
              idKeys={['recommendationId', 'id']}
              labelFor={(item) =>
                `${new Date(Number(item.recordedAt || 0)).toLocaleDateString()} · ${text(
                  item,
                  'recommendation'
                ).slice(0, 80)}`
              }
              onChange={setTumorRecommendationId}
            />
            <Field
              label="Regimen name"
              value={regimenName}
              onChange={setRegimenName}
            />
            <ToggleList
              label="Active medication orders in regimen"
              options={oncologyMedicationOptions}
              selected={regimenMedicationIds}
              onChange={setRegimenMedicationIds}
            />
            <ActionButton
              disabled={
                busy ||
                !oncologyCaseId ||
                !tumorRecommendationId ||
                !regimenName.trim() ||
                regimenMedicationIds.length === 0
              }
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.approveOncologyRegimen(
                    tenantId,
                    {
                      patientId,
                      encounterId,
                      oncologyCaseId,
                      recommendationId: tumorRecommendationId,
                      name: regimenName,
                      cycleCount: 1,
                      medicationOrderIds: regimenMedicationIds,
                    }
                  );
                  if (result.entityId) setOncologyRegimenId(result.entityId);
                  return result;
                })
              }
            >
              Approve regimen
            </ActionButton>
          </Card>

          <Card title="Chemotherapy administration linkage">
            <RecordSelect
              label="Approved/active regimen"
              value={oncologyRegimenId}
              records={caseRegimens.filter((item) =>
                ['APPROVED', 'ACTIVE'].includes(text(item, 'status'))
              )}
              idKeys={['regimenId', 'id']}
              labelFor={(item) =>
                `${text(item, 'name')} · ${text(item, 'status')}`
              }
              onChange={setOncologyRegimenId}
            />
            <RecordSelect
              label="Given medication administration"
              value={chemoAdministrationId}
              records={givenAdministrations}
              idKeys={['administrationId', 'id']}
              labelFor={(item) =>
                `${text(item, 'medicationName')} · ${new Date(
                  Number(item.administeredAt || 0)
                ).toLocaleString()}`
              }
              onChange={setChemoAdministrationId}
            />
            <Field
              label="Cycle number"
              value={chemoCycle}
              onChange={setChemoCycle}
              type="number"
            />
            <ActionButton
              disabled={
                busy || !oncologyCaseId || !oncologyRegimenId || !chemoAdministrationId
              }
              onClick={() =>
                void run(() =>
                  wave2Client.linkChemotherapyAdministration(tenantId, {
                    patientId,
                    encounterId,
                    oncologyCaseId,
                    regimenId: oncologyRegimenId,
                    medicationAdministrationId: chemoAdministrationId,
                    cycleNumber: Number(chemoCycle),
                  })
                )
              }
            >
              Link chemotherapy administration
            </ActionButton>
          </Card>

          <Card title="Toxicity monitoring">
            <RecordSelect
              label="Regimen"
              value={oncologyRegimenId}
              records={caseRegimens}
              idKeys={['regimenId', 'id']}
              labelFor={(item) =>
                `${text(item, 'name')} · ${text(item, 'status')}`
              }
              onChange={setOncologyRegimenId}
            />
            <Field
              label="Toxicity grade 0–5"
              value={toxicityGrade}
              onChange={setToxicityGrade}
              type="number"
            />
            <TextArea
              label="Findings"
              value={toxicityFindings}
              onChange={setToxicityFindings}
            />
            <ActionButton
              disabled={
                busy ||
                !oncologyCaseId ||
                splitLines(toxicityFindings).length === 0
              }
              onClick={() =>
                void run(() =>
                  wave2Client.recordOncologyToxicity(tenantId, {
                    patientId,
                    encounterId,
                    oncologyCaseId,
                    ...(oncologyRegimenId
                      ? { regimenId: oncologyRegimenId }
                      : {}),
                    grade: Number(toxicityGrade),
                    findings: splitLines(toxicityFindings),
                    action:
                      Number(toxicityGrade) >= 3 ? 'REVIEW' : 'CONTINUE',
                  })
                )
              }
            >
              Record toxicity assessment
            </ActionButton>
          </Card>
        </div>
      )}

      {domain === 'rehabilitation' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Rehabilitation plan">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Discipline</span>
              <select
                value={rehabDiscipline}
                onChange={(event) => setRehabDiscipline(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                {[
                  'PHYSIOTHERAPY',
                  'OCCUPATIONAL_THERAPY',
                  'SPEECH_THERAPY',
                  'CARDIAC_REHAB',
                  'OTHER',
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <TextArea
              label="Goals"
              value={rehabGoals}
              onChange={setRehabGoals}
            />
            <ActionButton
              disabled={busy || !workspace || splitLines(rehabGoals).length === 0}
              onClick={() =>
                void run(async () => {
                  const result = await wave2Client.createRehabilitationPlan(
                    tenantId,
                    {
                      patientId,
                      encounterId,
                      disciplines: [rehabDiscipline],
                      goals: splitLines(rehabGoals).map((description) => ({
                        description,
                      })),
                    }
                  );
                  if (result.entityId) setRehabPlanId(result.entityId);
                  return result;
                })
              }
            >
              Create rehabilitation plan
            </ActionButton>
          </Card>

          <Card title="Therapy session">
            <RecordSelect
              label="Active plan"
              value={rehabPlanId}
              records={activeRehabPlans}
              idKeys={['rehabilitationPlanId', 'id']}
              labelFor={(item) =>
                `${(
                  Array.isArray(item.disciplines) ? item.disciplines : []
                ).join(', ')} · ${text(item, 'status')}`
              }
              onChange={(value) => {
                setRehabPlanId(value);
                const plan = workspace?.rehabilitationPlans.find(
                  (item) =>
                    recordId(item, 'rehabilitationPlanId', 'id') === value
                );
                const goals = Array.isArray(plan?.goals)
                  ? (plan?.goals as Array<Record<string, unknown>>)
                  : [];
                setRehabGoalId(recordId(goals[0] || {}, 'goalId'));
              }}
            />
            <RecordSelect
              label="Goal"
              value={rehabGoalId}
              records={
                Array.isArray(selectedRehabPlan?.goals)
                  ? (selectedRehabPlan?.goals as Array<Record<string, unknown>>)
                  : []
              }
              idKeys={['goalId']}
              labelFor={(item) =>
                `${text(item, 'description')} · ${text(item, 'status')}`
              }
              onChange={setRehabGoalId}
            />
            <TextArea
              label="Session outcome"
              value={rehabOutcome}
              onChange={setRehabOutcome}
            />
            <ActionButton
              disabled={busy || !rehabPlanId || !rehabOutcome.trim()}
              onClick={() =>
                void run(() =>
                  wave2Client.recordRehabilitationSession(tenantId, {
                    patientId,
                    encounterId,
                    rehabilitationPlanId: rehabPlanId,
                    discipline: rehabDiscipline,
                    goalIds: rehabGoalId ? [rehabGoalId] : [],
                    outcome: rehabOutcome,
                    status: 'COMPLETED',
                  })
                )
              }
            >
              Record therapy session
            </ActionButton>
          </Card>

          <Card title="Goal disposition">
            <RecordSelect
              label="Goal"
              value={rehabGoalId}
              records={
                Array.isArray(selectedRehabPlan?.goals)
                  ? (selectedRehabPlan?.goals as Array<Record<string, unknown>>)
                  : []
              }
              idKeys={['goalId']}
              labelFor={(item) =>
                `${text(item, 'description')} · ${text(item, 'status')}`
              }
              onChange={setRehabGoalId}
            />
            <ActionButton
              disabled={busy || !rehabPlanId || !rehabGoalId}
              onClick={() =>
                void run(() =>
                  wave2Client.updateRehabilitationGoal(tenantId, {
                    patientId,
                    encounterId,
                    rehabilitationPlanId: rehabPlanId,
                    goalId: rehabGoalId,
                    status: 'ACHIEVED',
                  })
                )
              }
            >
              Mark goal achieved
            </ActionButton>
          </Card>

          <Card title="Complete plan">
            <RecordSelect
              label="Accepted clinical handoff"
              value={rehabHandoffId}
              records={workspace?.acceptedClinicalHandoffs || []}
              idKeys={['handoffId', 'id']}
              labelFor={(item) =>
                `${text(item, 'currentProblemSummary').slice(0, 100)} · accepted`
              }
              onChange={setRehabHandoffId}
            />
            <ActionButton
              disabled={busy || !rehabPlanId || !rehabHandoffId}
              onClick={() =>
                void run(() =>
                  wave2Client.completeRehabilitationPlan(tenantId, {
                    patientId,
                    encounterId,
                    rehabilitationPlanId: rehabPlanId,
                    dischargeHandoffId: rehabHandoffId,
                  })
                )
              }
            >
              Complete rehabilitation plan
            </ActionButton>
          </Card>
        </div>
      )}

      {lastEntityId && (
        <footer className="text-xs text-slate-500">
          Last authoritative entity: <code>{lastEntityId}</code>
        </footer>
      )}
    </div>
  );
}
