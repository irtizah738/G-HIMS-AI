'use client';

import React, { useMemo, useState } from 'react';
import { useTenant } from '@/lib/tenant/context';
import { wave2Client } from '@/lib/clinical/wave2-client';

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

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">{props.label}</span>
      <input
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
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">{props.label}</span>
      <textarea
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
}) {
  return (
    <button
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

export function Wave2ClinicalWorkspace({
  initialDomain = 'nursing',
}: {
  initialDomain?: Wave2Domain;
}) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id || '';
  const [domain, setDomain] = useState<Wave2Domain>(initialDomain);
  const [patientId, setPatientId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastEntityId, setLastEntityId] = useState('');

  const [medicationOrderId, setMedicationOrderId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [emarSlotId, setEmarSlotId] = useState('');
  const [emarOutcome, setEmarOutcome] = useState<'GIVEN' | 'HELD' | 'REFUSED' | 'MISSED' | 'DELAYED'>('GIVEN');
  const [emarReason, setEmarReason] = useState('');
  const [carePlanTitle, setCarePlanTitle] = useState('');
  const [carePlanGoals, setCarePlanGoals] = useState('');
  const [carePlanInterventions, setCarePlanInterventions] = useState('');

  const [dialysisOrderId, setDialysisOrderId] = useState('');
  const [dialysisSessionId, setDialysisSessionId] = useState('');
  const [dialysisMachineId, setDialysisMachineId] = useState('');
  const [dialysisAccess, setDialysisAccess] = useState('');
  const [dialysisModality, setDialysisModality] = useState('HEMODIALYSIS');

  const [obEpisodeId, setObEpisodeId] = useState('');
  const [gestWeeks, setGestWeeks] = useState('39');
  const [gravida, setGravida] = useState('1');
  const [para, setPara] = useState('0');
  const [fhr, setFhr] = useState('');
  const [dilation, setDilation] = useState('');
  const [obStage, setObStage] = useState('LABOR');
  const [obReason, setObReason] = useState('');

  const [oncologyCaseId, setOncologyCaseId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [oncEvidence, setOncEvidence] = useState('');
  const [tumorAttendees, setTumorAttendees] = useState('');
  const [tumorRecommendation, setTumorRecommendation] = useState('');
  const [tumorRecommendationId, setTumorRecommendationId] = useState('');
  const [regimenName, setRegimenName] = useState('');
  const [regimenMedicationIds, setRegimenMedicationIds] = useState('');
  const [oncologyRegimenId, setOncologyRegimenId] = useState('');
  const [toxicityGrade, setToxicityGrade] = useState('1');
  const [toxicityFindings, setToxicityFindings] = useState('');

  const [rehabPlanId, setRehabPlanId] = useState('');
  const [rehabGoals, setRehabGoals] = useState('');
  const [rehabDiscipline, setRehabDiscipline] = useState('PHYSIOTHERAPY');
  const [rehabOutcome, setRehabOutcome] = useState('');
  const [rehabGoalId, setRehabGoalId] = useState('');
  const [rehabHandoffId, setRehabHandoffId] = useState('');

  const scopeReady = Boolean(tenantId && patientId.trim() && encounterId.trim());
  const scopeLabel = useMemo(
    () => scopeReady ? `${patientId} · ${encounterId}` : 'Select patient and active encounter',
    [scopeReady, patientId, encounterId]
  );

  async function run(action: () => Promise<{ success: boolean; entityId?: string; error?: { message?: string } }>) {
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error?.message || 'Command was rejected.');
      setLastEntityId(String(result.entityId || ''));
      setMessage(result.entityId ? `Committed: ${result.entityId}` : 'Command committed.');
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wave 2 Clinical Domains</div>
            <h1 className="mt-1 text-2xl font-bold">Authoritative Specialty Care Workspace</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              All actions execute governed backend commands. This workspace does not create diagnoses, medication orders, regimens, or clinical authority in the browser.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
            {scopeLabel}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Field label="Patient ID" value={patientId} onChange={setPatientId} placeholder="Authoritative patient ID" />
          <Field label="Active Encounter ID" value={encounterId} onChange={setEncounterId} placeholder="Authoritative encounter ID" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(domainLabels) as Wave2Domain[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDomain(item)}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${domain === item ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'border border-slate-200 dark:border-slate-700'}`}
            >
              {domainLabels[item]}
            </button>
          ))}
        </div>

        {message && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {message}
          </div>
        )}
      </header>

      {domain === 'nursing' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Medication schedule">
            <Field label="Medication order ID" value={medicationOrderId} onChange={setMedicationOrderId} />
            <Field label="Scheduled time" value={scheduledFor} onChange={setScheduledFor} type="datetime-local" />
            <ActionButton
              disabled={busy || !scopeReady || !medicationOrderId || !scheduledFor}
              onClick={() => {
                void run(async () => {
                  const result = await wave2Client.scheduleMedication(tenantId, {
                    patientId, encounterId, medicationOrderId,
                    scheduledFor: toTimestamp(scheduledFor),
                  });
                  if (result.entityId) setEmarSlotId(result.entityId);
                  return result;
                });
              }}
            >
              Create authoritative eMAR slot
            </ActionButton>
          </Card>

          <Card title="Bedside administration">
            <Field label="eMAR slot ID" value={emarSlotId} onChange={setEmarSlotId} />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Outcome</span>
              <select value={emarOutcome} onChange={(e) => setEmarOutcome(e.target.value as typeof emarOutcome)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                {['GIVEN','HELD','REFUSED','MISSED','DELAYED'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            {emarOutcome !== 'GIVEN' && <TextArea label="Exception reason" value={emarReason} onChange={setEmarReason} />}
            <ActionButton
              disabled={busy || !scopeReady || !emarSlotId}
              onClick={() => void run(() => wave2Client.administerMedication(tenantId, {
                patientId, encounterId, emarSlotId, outcome: emarOutcome,
                administeredAt: Date.now(),
                ...(emarOutcome !== 'GIVEN' ? { reason: emarReason } : {}),
              }))}
            >
              Commit administration outcome
            </ActionButton>
          </Card>

          <Card title="Nursing care plan">
            <Field label="Plan title" value={carePlanTitle} onChange={setCarePlanTitle} />
            <TextArea label="Goals (one per line)" value={carePlanGoals} onChange={setCarePlanGoals} />
            <TextArea label="Interventions (one per line)" value={carePlanInterventions} onChange={setCarePlanInterventions} />
            <ActionButton
              disabled={busy || !scopeReady}
              onClick={() => void run(() => wave2Client.createNursingCarePlan(tenantId, {
                patientId, encounterId, title: carePlanTitle,
                goals: splitLines(carePlanGoals),
                interventions: splitLines(carePlanInterventions).map((description) => ({ description })),
              }))}
            >
              Create nursing care plan
            </ActionButton>
          </Card>
        </div>
      )}

      {domain === 'renal' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="Dialysis order">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Modality</span>
              <select value={dialysisModality} onChange={(e) => setDialysisModality(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                {['HEMODIALYSIS','HEMOFILTRATION','HEMODIAFILTRATION','PERITONEAL'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <Field label="Vascular access plan" value={dialysisAccess} onChange={setDialysisAccess} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.createDialysisOrder(tenantId, {
                  patientId, encounterId, modality: dialysisModality,
                  prescribedDurationMinutes: 240, vascularAccessPlan: dialysisAccess,
                });
                if (result.entityId) setDialysisOrderId(result.entityId);
                return result;
              });
            }}>Create dialysis order</ActionButton>
          </Card>

          <Card title="Start session">
            <Field label="Dialysis order ID" value={dialysisOrderId} onChange={setDialysisOrderId} />
            <Field label="Machine ID" value={dialysisMachineId} onChange={setDialysisMachineId} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.startDialysisSession(tenantId, {
                  patientId, encounterId, dialysisOrderId, machineId: dialysisMachineId,
                  preObservation: {},
                });
                if (result.entityId) setDialysisSessionId(result.entityId);
                return result;
              });
            }}>Start dialysis session</ActionButton>
          </Card>

          <Card title="Complete session">
            <Field label="Session ID" value={dialysisSessionId} onChange={setDialysisSessionId} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.completeDialysisSession(tenantId, {
              patientId, encounterId, dialysisSessionId, status: 'COMPLETED',
              postObservation: {},
            }))}>Complete dialysis session</ActionButton>
          </Card>
        </div>
      )}

      {domain === 'obstetrics' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Obstetric episode">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Gest. weeks" value={gestWeeks} onChange={setGestWeeks} type="number" />
              <Field label="Gravida" value={gravida} onChange={setGravida} type="number" />
              <Field label="Para" value={para} onChange={setPara} type="number" />
            </div>
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.createObstetricEpisode(tenantId, {
                  patientId, encounterId,
                  gestationalAgeWeeks: Number(gestWeeks),
                  gravida: Number(gravida), para: Number(para),
                });
                if (result.entityId) setObEpisodeId(result.entityId);
                return result;
              });
            }}>Open obstetric episode</ActionButton>
          </Card>

          <Card title="Partogram observation">
            <Field label="Episode ID" value={obEpisodeId} onChange={setObEpisodeId} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Fetal HR" value={fhr} onChange={setFhr} type="number" />
              <Field label="Cervical dilation cm" value={dilation} onChange={setDilation} type="number" />
            </div>
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.recordPartogramObservation(tenantId, {
              patientId, encounterId, obstetricEpisodeId: obEpisodeId,
              ...(fhr ? { fetalHeartRateBpm: Number(fhr) } : {}),
              ...(dilation ? { cervicalDilationCm: Number(dilation) } : {}),
            }))}>Record partogram</ActionButton>
          </Card>

          <Card title="Stage transition">
            <Field label="Episode ID" value={obEpisodeId} onChange={setObEpisodeId} />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Target stage</span>
              <select value={obStage} onChange={(e) => setObStage(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                {['LABOR','DELIVERY','THEATRE','POSTPARTUM','COMPLETED'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <TextArea label="Clinical reason" value={obReason} onChange={setObReason} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.transitionObstetricEpisode(tenantId, {
              patientId, encounterId, obstetricEpisodeId: obEpisodeId,
              targetStage: obStage, reason: obReason,
            }))}>Commit stage transition</ActionButton>
          </Card>
        </div>
      )}

      {domain === 'oncology' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Oncology case">
            <TextArea label="Primary diagnosis" value={diagnosis} onChange={setDiagnosis} />
            <TextArea label="Evidence references" value={oncEvidence} onChange={setOncEvidence} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.openOncologyCase(tenantId, {
                  patientId, encounterId, primaryDiagnosis: diagnosis,
                  evidenceRefs: splitLines(oncEvidence),
                });
                if (result.entityId) setOncologyCaseId(result.entityId);
                return result;
              });
            }}>Open evidence-linked case</ActionButton>
          </Card>

          <Card title="Tumor board">
            <Field label="Oncology case ID" value={oncologyCaseId} onChange={setOncologyCaseId} />
            <TextArea label="Attendees" value={tumorAttendees} onChange={setTumorAttendees} />
            <TextArea label="Recommendation" value={tumorRecommendation} onChange={setTumorRecommendation} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.recordTumorBoardRecommendation(tenantId, {
                  patientId, encounterId, oncologyCaseId,
                  attendees: splitLines(tumorAttendees),
                  recommendation: tumorRecommendation,
                  evidenceRefs: splitLines(oncEvidence),
                });
                if (result.entityId) setTumorRecommendationId(result.entityId);
                return result;
              });
            }}>Record tumor board recommendation</ActionButton>
          </Card>

          <Card title="Regimen approval">
            <Field label="Recommendation ID" value={tumorRecommendationId} onChange={setTumorRecommendationId} />
            <Field label="Regimen name" value={regimenName} onChange={setRegimenName} />
            <TextArea label="Medication order IDs" value={regimenMedicationIds} onChange={setRegimenMedicationIds} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.approveOncologyRegimen(tenantId, {
                  patientId, encounterId, oncologyCaseId,
                  recommendationId: tumorRecommendationId,
                  name: regimenName, cycleCount: 1,
                  medicationOrderIds: splitLines(regimenMedicationIds),
                });
                if (result.entityId) setOncologyRegimenId(result.entityId);
                return result;
              });
            }}>Approve regimen</ActionButton>
          </Card>

          <Card title="Toxicity monitoring">
            <Field label="Regimen ID" value={oncologyRegimenId} onChange={setOncologyRegimenId} />
            <Field label="Toxicity grade 0-5" value={toxicityGrade} onChange={setToxicityGrade} type="number" />
            <TextArea label="Findings" value={toxicityFindings} onChange={setToxicityFindings} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.recordOncologyToxicity(tenantId, {
              patientId, encounterId, oncologyCaseId,
              ...(oncologyRegimenId ? { regimenId: oncologyRegimenId } : {}),
              grade: Number(toxicityGrade),
              findings: splitLines(toxicityFindings),
              action: Number(toxicityGrade) >= 3 ? 'REVIEW' : 'CONTINUE',
            }))}>Record toxicity assessment</ActionButton>
          </Card>
        </div>
      )}

      {domain === 'rehabilitation' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Rehabilitation plan">
            <TextArea label="Goals" value={rehabGoals} onChange={setRehabGoals} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => {
              void run(async () => {
                const result = await wave2Client.createRehabilitationPlan(tenantId, {
                  patientId, encounterId,
                  disciplines: [rehabDiscipline],
                  goals: splitLines(rehabGoals).map((description) => ({ description })),
                });
                if (result.entityId) setRehabPlanId(result.entityId);
                return result;
              });
            }}>Create rehabilitation plan</ActionButton>
          </Card>

          <Card title="Therapy session">
            <Field label="Plan ID" value={rehabPlanId} onChange={setRehabPlanId} />
            <label className="space-y-1 text-sm">
              <span className="font-medium">Discipline</span>
              <select value={rehabDiscipline} onChange={(e) => setRehabDiscipline(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                {['PHYSIOTHERAPY','OCCUPATIONAL_THERAPY','SPEECH_THERAPY','CARDIAC_REHAB','OTHER'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <TextArea label="Session outcome" value={rehabOutcome} onChange={setRehabOutcome} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.recordRehabilitationSession(tenantId, {
              patientId, encounterId, rehabilitationPlanId: rehabPlanId,
              discipline: rehabDiscipline, goalIds: [],
              outcome: rehabOutcome, status: 'COMPLETED',
            }))}>Record therapy session</ActionButton>
          </Card>

          <Card title="Goal disposition">
            <Field label="Goal ID" value={rehabGoalId} onChange={setRehabGoalId} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.updateRehabilitationGoal(tenantId, {
              patientId, encounterId, rehabilitationPlanId: rehabPlanId,
              goalId: rehabGoalId, status: 'ACHIEVED',
            }))}>Mark goal achieved</ActionButton>
          </Card>

          <Card title="Complete plan">
            <Field label="Accepted clinical handoff ID" value={rehabHandoffId} onChange={setRehabHandoffId} />
            <ActionButton disabled={busy || !scopeReady} onClick={() => void run(() => wave2Client.completeRehabilitationPlan(tenantId, {
              patientId, encounterId, rehabilitationPlanId: rehabPlanId,
              dischargeHandoffId: rehabHandoffId,
            }))}>Complete rehabilitation plan</ActionButton>
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
