import { getAdminFirestore } from '../../server/firebase/admin';
import { assertDemoRuntime } from '../../lib/runtime/runtime-mode';
import { Patient360ProjectionService } from '../../lib/clinical/patient360/patient360-projection-service';

assertDemoRuntime('Clinical Intelligence demo provisioning');

const tenantId = String(
  process.env.GHIMS_DEMO_TENANT_ID || 'central-metro-hospital'
).trim().toLowerCase();
const confirmedTenant = String(
  process.env.GHIMS_DEMO_CONFIRM_TENANT || ''
).trim().toLowerCase();

if (!tenantId || confirmedTenant !== tenantId) {
  throw new Error(
    'CI_DEMO_TENANT_CONFIRMATION_REQUIRED: GHIMS_DEMO_CONFIRM_TENANT must exactly match GHIMS_DEMO_TENANT_ID.'
  );
}

const db = getAdminFirestore();
if (!db) throw new Error('CI_DEMO_FIREBASE_ADMIN_UNAVAILABLE');

const patientId = 'demo-ci-patient-001';
const encounterId = 'demo-ci-opd-current';
const priorEncounterId = 'demo-ci-opd-prior';
const actorId = 'demo.doctor@example.invalid';

const T = {
  priorEncounter: Date.parse('2026-06-08T09:00:00Z'),
  priorNote: Date.parse('2026-06-08T09:35:00Z'),
  medicationChange: Date.parse('2026-09-15T10:00:00Z'),
  oldLabs: Date.parse('2026-09-20T08:00:00Z'),
  newLabs: Date.parse('2026-10-04T08:00:00Z'),
  currentEncounter: Date.parse('2026-10-06T08:30:00Z'),
  currentVitals: Date.parse('2026-10-06T08:45:00Z'),
  knowledgeReview: Date.parse('2026-10-06T08:50:00Z'),
};

const provenance = (
  sourceEvidenceId: string,
  recordedAt: number,
  sourceType: 'CLINICIAN' | 'NURSE' | 'LAB_SYSTEM' = 'CLINICIAN'
) => ({
  provenanceId: `prov_${sourceEvidenceId}`,
  tenantId,
  patientId,
  encounterId,
  sourceEvidenceId,
  sourceType,
  recordedBy: sourceType === 'NURSE' ? 'demo.nurse@example.invalid' : sourceType === 'LAB_SYSTEM' ? 'demo.lab@example.invalid' : actorId,
  recordedAt,
});

const tenantRef = db.collection('tenants').doc(tenantId);
await tenantRef.set(
  {
    name: 'G-HIMS Clinical Intelligence Demo',
    environment: 'DEMO',
    syntheticOnly: true,
    updatedAt: new Date().toISOString(),
  },
  { merge: true }
);

const records: Array<[string, string, Record<string, unknown>]> = [
  ['patients', patientId, {
    id: patientId,
    patientId,
    tenantId,
    mrn: 'CI-DEMO-001',
    fullName: 'Amina Shah (Synthetic)',
    dateOfBirth: '1974-03-12',
    gender: 'female',
    bloodGroup: 'B+',
    status: 'ACTIVE',
    syntheticDemoRecord: true,
    updatedAt: T.currentEncounter,
    _serverVersion: 1,
  }],
  ['encounters', priorEncounterId, {
    id: priorEncounterId,
    encounterId: priorEncounterId,
    patientId,
    tenantId,
    encounterType: 'OPD',
    careSetting: 'OPD',
    status: 'COMPLETED',
    departmentId: 'General Medicine',
    facilityId: 'DEMO_FACILITY',
    chiefComplaint: 'Hypertension and diabetes follow-up',
    startedAt: T.priorEncounter,
    completedAt: T.priorNote,
    assignedProviderId: actorId,
    _serverVersion: 1,
  }],
  ['encounters', encounterId, {
    id: encounterId,
    encounterId,
    patientId,
    tenantId,
    encounterType: 'OPD',
    careSetting: 'OPD',
    status: 'ACTIVE',
    departmentId: 'General Medicine',
    facilityId: 'DEMO_FACILITY',
    chiefComplaint: 'Follow-up after recent laboratory testing',
    startedAt: T.currentEncounter,
    assignedProviderId: actorId,
    _serverVersion: 1,
  }],
  ['clinicalConditions', 'demo-ci-cond-htn', {
    conditionId: 'demo-ci-cond-htn',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-cond-htn',
    provenance: { ...provenance('demo-ci-cond-htn', T.priorEncounter), encounterId: priorEncounterId },
    createdAt: T.priorEncounter,
    updatedAt: T.priorEncounter,
    version: 1,
    code: { codings: [{ system: 'ICD10', code: 'I10', display: 'Essential hypertension' }], text: 'Essential hypertension' },
    category: 'CHRONIC',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    recordedAt: T.priorEncounter,
    recordedBy: actorId,
  }],
  ['clinicalConditions', 'demo-ci-cond-dm2', {
    conditionId: 'demo-ci-cond-dm2',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-cond-dm2',
    provenance: { ...provenance('demo-ci-cond-dm2', T.priorEncounter), encounterId: priorEncounterId },
    createdAt: T.priorEncounter,
    updatedAt: T.priorEncounter,
    version: 1,
    code: { codings: [{ system: 'ICD10', code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' }], text: 'Type 2 diabetes mellitus' },
    category: 'CHRONIC',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    recordedAt: T.priorEncounter,
    recordedBy: actorId,
  }],
  ['clinicalAllergies', 'demo-ci-allergy-pen', {
    allergyId: 'demo-ci-allergy-pen',
    tenantId,
    patientId,
    sourceEvidenceId: 'demo-ci-allergy-pen',
    provenance: provenance('demo-ci-allergy-pen', T.priorEncounter),
    createdAt: T.priorEncounter,
    updatedAt: T.priorEncounter,
    version: 1,
    substance: { codings: [{ system: 'LOCAL', code: 'PENICILLIN', display: 'Penicillin' }], text: 'Penicillin' },
    type: 'ALLERGY',
    category: 'MEDICATION',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    criticality: 'HIGH',
    reactions: [{ manifestation: [{ codings: [{ system: 'LOCAL', code: 'URTICARIA', display: 'Urticaria' }], text: 'Urticaria' }], severity: 'MODERATE' }],
    recordedAt: T.priorEncounter,
    recorderId: actorId,
  }],
  ['medicationOrders', 'demo-ci-med-lisinopril', {
    medicationOrderId: 'demo-ci-med-lisinopril',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-med-lisinopril',
    provenance: { ...provenance('demo-ci-med-lisinopril', T.medicationChange), encounterId: priorEncounterId },
    createdAt: T.medicationChange,
    updatedAt: T.medicationChange,
    version: 1,
    medication: { codings: [{ system: 'RXNORM', code: '314077', display: 'Lisinopril 20 mg oral tablet' }], text: 'Lisinopril 20 mg' },
    status: 'ACTIVE',
    intent: 'ORDER',
    dosageText: '20 mg once daily',
    frequency: 'OD',
    prescribedBy: actorId,
    authoredAt: T.medicationChange,
  }],
  ['medicationOrders', 'demo-ci-med-metformin', {
    medicationOrderId: 'demo-ci-med-metformin',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-med-metformin',
    provenance: { ...provenance('demo-ci-med-metformin', T.priorEncounter), encounterId: priorEncounterId },
    createdAt: T.priorEncounter,
    updatedAt: T.priorEncounter,
    version: 1,
    medication: { codings: [{ system: 'RXNORM', code: '860975', display: 'Metformin 500 mg oral tablet' }], text: 'Metformin 500 mg' },
    status: 'ACTIVE',
    intent: 'ORDER',
    dosageText: '500 mg twice daily',
    frequency: 'BID',
    prescribedBy: actorId,
    authoredAt: T.priorEncounter,
  }],
  ['clinicalObservations', 'demo-ci-creatinine-old', {
    observationId: 'demo-ci-creatinine-old',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-creatinine-old',
    provenance: { ...provenance('demo-ci-creatinine-old', T.oldLabs, 'LAB_SYSTEM'), encounterId: priorEncounterId },
    createdAt: T.oldLabs,
    updatedAt: T.oldLabs,
    version: 1,
    category: 'LABORATORY',
    code: { codings: [{ system: 'LOINC', code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma' }], text: 'Creatinine' },
    value: { valueType: 'QUANTITY', quantity: { value: 0.9, unit: 'mg/dL', system: 'UCUM', code: 'mg/dL' } },
    effectiveAt: T.oldLabs,
    issuedAt: T.oldLabs,
    status: 'FINAL',
    performerIds: ['demo.lab@example.invalid'],
  }],
  ['clinicalObservations', 'demo-ci-creatinine-new', {
    observationId: 'demo-ci-creatinine-new',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-creatinine-new',
    provenance: provenance('demo-ci-creatinine-new', T.newLabs, 'LAB_SYSTEM'),
    createdAt: T.newLabs,
    updatedAt: T.newLabs,
    version: 1,
    category: 'LABORATORY',
    code: { codings: [{ system: 'LOINC', code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma' }], text: 'Creatinine' },
    value: { valueType: 'QUANTITY', quantity: { value: 1.5, unit: 'mg/dL', system: 'UCUM', code: 'mg/dL' } },
    effectiveAt: T.newLabs,
    issuedAt: T.newLabs,
    interpretation: [{ codings: [{ system: 'LOCAL', code: 'H', display: 'High' }], text: 'High' }],
    status: 'FINAL',
    performerIds: ['demo.lab@example.invalid'],
  }],
  ['clinicalObservations', 'demo-ci-potassium-new', {
    observationId: 'demo-ci-potassium-new',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-potassium-new',
    provenance: provenance('demo-ci-potassium-new', T.newLabs, 'LAB_SYSTEM'),
    createdAt: T.newLabs,
    updatedAt: T.newLabs,
    version: 1,
    category: 'LABORATORY',
    code: { codings: [{ system: 'LOINC', code: '2823-3', display: 'Potassium [Moles/volume] in Serum or Plasma' }], text: 'Potassium' },
    value: { valueType: 'QUANTITY', quantity: { value: 5.6, unit: 'mmol/L', system: 'UCUM', code: 'mmol/L' } },
    effectiveAt: T.newLabs,
    issuedAt: T.newLabs,
    interpretation: [{ codings: [{ system: 'LOCAL', code: 'H', display: 'High' }], text: 'High' }],
    status: 'FINAL',
    performerIds: ['demo.lab@example.invalid'],
  }],
  ['clinicalObservations', 'demo-ci-bp-current', {
    observationId: 'demo-ci-bp-current',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-bp-current',
    provenance: provenance('demo-ci-bp-current', T.currentVitals, 'NURSE'),
    createdAt: T.currentVitals,
    updatedAt: T.currentVitals,
    version: 1,
    category: 'VITAL_SIGNS',
    code: { codings: [{ system: 'LOINC', code: '85354-9', display: 'Blood pressure panel' }], text: 'Blood pressure' },
    value: { valueType: 'COMPONENTS', components: [
      { code: { codings: [{ system: 'LOINC', code: '8480-6', display: 'Systolic blood pressure' }] }, value: { valueType: 'QUANTITY', quantity: { value: 148, unit: 'mmHg', system: 'UCUM', code: 'mm[Hg]' } } },
      { code: { codings: [{ system: 'LOINC', code: '8462-4', display: 'Diastolic blood pressure' }] }, value: { valueType: 'QUANTITY', quantity: { value: 92, unit: 'mmHg', system: 'UCUM', code: 'mm[Hg]' } } },
    ] },
    effectiveAt: T.currentVitals,
    status: 'FINAL',
    performerIds: ['demo.nurse@example.invalid'],
  }],
  ['canonicalDiagnosticOrders', 'demo-ci-order-renal', {
    diagnosticOrderId: 'demo-ci-order-renal',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-order-renal',
    provenance: provenance('demo-ci-order-renal', T.newLabs),
    createdAt: T.newLabs,
    updatedAt: T.newLabs,
    version: 1,
    service: { codings: [{ system: 'LOCAL', code: 'RENAL-PANEL', display: 'Renal function panel' }], text: 'Renal function panel' },
    orderType: 'LAB',
    priority: 'ROUTINE',
    status: 'COMPLETED',
    clinicalIndication: 'Hypertension medication monitoring',
    orderedBy: actorId,
    orderedAt: T.newLabs - 86_400_000,
  }],
  ['diagnosticReports', 'demo-ci-report-renal', {
    diagnosticReportId: 'demo-ci-report-renal',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-report-renal',
    provenance: provenance('demo-ci-report-renal', T.newLabs, 'LAB_SYSTEM'),
    createdAt: T.newLabs,
    updatedAt: T.newLabs,
    version: 1,
    orderId: 'demo-ci-order-renal',
    code: { codings: [{ system: 'LOCAL', code: 'RENAL-PANEL', display: 'Renal function panel' }], text: 'Renal function panel' },
    category: 'LAB',
    status: 'FINAL',
    resultObservationIds: ['demo-ci-creatinine-new', 'demo-ci-potassium-new'],
    conclusion: 'Final synthetic renal monitoring panel.',
    issuedAt: T.newLabs,
    verifiedBy: 'demo.lab@example.invalid',
    verifiedAt: T.newLabs,
  }],
  ['clinicalProcedures', 'demo-ci-procedure-retinal', {
    procedureId: 'demo-ci-procedure-retinal',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-procedure-retinal',
    provenance: { ...provenance('demo-ci-procedure-retinal', T.priorNote), encounterId: priorEncounterId },
    createdAt: T.priorNote,
    updatedAt: T.priorNote,
    version: 1,
    code: { codings: [{ system: 'LOCAL', code: 'DM-RETINAL', display: 'Diabetic retinal screening' }], text: 'Diabetic retinal screening' },
    status: 'COMPLETED',
    performedAt: T.priorNote,
    performerIds: [actorId],
    outcome: { codings: [{ system: 'LOCAL', code: 'NO-ACUTE', display: 'No acute finding documented' }], text: 'No acute finding documented' },
  }],
  ['carePlans', 'demo-ci-careplan', {
    carePlanId: 'demo-ci-careplan',
    tenantId,
    patientId,
    encounterId,
    sourceEvidenceId: 'demo-ci-careplan',
    provenance: provenance('demo-ci-careplan', T.currentEncounter),
    createdAt: T.currentEncounter,
    updatedAt: T.currentEncounter,
    version: 1,
    status: 'ACTIVE',
    intent: 'PLAN',
    title: 'Hypertension and diabetes longitudinal follow-up',
    description: 'Synthetic plan for demonstration of longitudinal review.',
    addressesConditionIds: ['demo-ci-cond-htn', 'demo-ci-cond-dm2'],
    activities: [
      { activityId: 'repeat-renal', description: 'Review renal monitoring results', status: 'SCHEDULED' },
      { activityId: 'bp-followup', description: 'Review blood-pressure control', status: 'SCHEDULED' },
    ],
    authoredBy: actorId,
    authoredAt: T.currentEncounter,
  }],
  ['clinicalDocuments', 'demo-ci-doc-prior', {
    clinicalDocumentId: 'demo-ci-doc-prior',
    tenantId,
    patientId,
    encounterId: priorEncounterId,
    sourceEvidenceId: 'demo-ci-doc-prior',
    provenance: { ...provenance('demo-ci-doc-prior', T.priorNote), encounterId: priorEncounterId },
    createdAt: T.priorNote,
    updatedAt: T.priorNote,
    version: 1,
    documentType: 'SOAP',
    status: 'FINAL',
    title: 'Prior outpatient follow-up',
    content: 'Synthetic prior note: blood pressure remained above target; medication plan was adjusted and renal monitoring was requested.',
    signedBy: actorId,
    signedAt: T.priorNote,
  }],
  ['patientClinicalKnowledgeStatus', `${patientId}__ALLERGIES`, {
    tenantId, patientId, domain: 'ALLERGIES', status: 'KNOWN', reviewedBy: actorId,
    reviewedAt: T.knowledgeReview, encounterId,
  }],
  ['patientClinicalKnowledgeStatus', `${patientId}__MEDICATIONS`, {
    tenantId, patientId, domain: 'MEDICATIONS', status: 'KNOWN', reviewedBy: actorId,
    reviewedAt: T.knowledgeReview, encounterId,
  }],
  ['patientClinicalKnowledgeStatus', `${patientId}__PROBLEM_LIST`, {
    tenantId, patientId, domain: 'PROBLEM_LIST', status: 'KNOWN', reviewedBy: actorId,
    reviewedAt: T.knowledgeReview, encounterId,
  }],
];

const events: Array<Record<string, unknown>> = [
  ['PATIENT_REGISTERED', T.priorEncounter, { patientId }],
  ['ENCOUNTER_CREATED', T.priorEncounter, { patientId, encounterId: priorEncounterId, encounterType: 'OPD' }],
  ['CLINICAL_CONDITION_RECORDED', T.priorEncounter + 1, { patientId, encounterId: priorEncounterId, conditionId: 'demo-ci-cond-htn' }],
  ['CLINICAL_CONDITION_RECORDED', T.priorEncounter + 2, { patientId, encounterId: priorEncounterId, conditionId: 'demo-ci-cond-dm2' }],
  ['CLINICAL_ALLERGY_RECORDED', T.priorEncounter + 3, { patientId, allergyId: 'demo-ci-allergy-pen' }],
  ['CLINICAL_NOTE_SIGNED', T.priorNote, { patientId, encounterId: priorEncounterId, clinicalDocumentId: 'demo-ci-doc-prior' }],
  ['MEDICATION_PRESCRIBED', T.medicationChange, { patientId, encounterId: priorEncounterId, medicationOrderId: 'demo-ci-med-lisinopril', drugName: 'Lisinopril 20 mg' }],
  ['DIAGNOSTIC_RESULT_VERIFIED', T.newLabs, { patientId, encounterId, diagnosticReportId: 'demo-ci-report-renal' }],
  ['ENCOUNTER_CREATED', T.currentEncounter, { patientId, encounterId, encounterType: 'OPD' }],
  ['VITALS_RECORDED', T.currentVitals, { patientId, encounterId, observationId: 'demo-ci-bp-current' }],
].map((row, index) => {
  const [eventType, occurredAt, payload] = row as [string, number, Record<string, unknown>];
  return {
    eventId: `demo-ci-event-${String(index + 1).padStart(2, '0')}`,
    tenantId,
    aggregateType: index === 0 ? 'PATIENT_MPI' : 'CLINICAL_DEMO',
    aggregateId: index === 0 ? patientId : String(payload.encounterId || patientId),
    eventType,
    eventVersion: 1,
    payload,
    actorId: actorId,
    actorRole: 'DOCTOR',
    occurredAt,
    recordedAt: occurredAt,
    correlationId: 'ci-demo-synthetic-scenario',
    commandId: `ci-demo-command-${index + 1}`,
    idempotencyKey: `ci-demo-event-${index + 1}`,
    source: 'system',
    schemaVersion: 1,
    syntheticDemoRecord: true,
  };
});

for (let offset = 0; offset < records.length; offset += 300) {
  const batch = db.batch();
  for (const [collection, id, data] of records.slice(offset, offset + 300)) {
    batch.set(tenantRef.collection(collection).doc(id), data);
  }
  await batch.commit();
}

for (let offset = 0; offset < events.length; offset += 300) {
  const batch = db.batch();
  for (const event of events.slice(offset, offset + 300)) {
    batch.set(
      tenantRef.collection('events').doc(String(event.eventId)),
      event
    );
  }
  await batch.commit();
}

const projection = await Patient360ProjectionService.rebuildPatient(
  tenantId,
  patientId
);

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      syntheticOnly: true,
      tenantId,
      patientId,
      encounterId,
      patient360: {
        projectionVersion: projection.projectionVersion,
        revision: projection.revision,
        sourceCheckpoint: projection.sourceCheckpoint,
        counts: projection.counts,
      },
      demoSequence: [
        'Open Patient 360 for CI-DEMO-001.',
        'Show longitudinal conditions, medications, allergy, renal diagnostic order/results, procedure and active care plan.',
        'Generate Encounter Preparation and inspect evidence provenance.',
        'Generate Trend Intelligence for the renal observations.',
        'Generate Medication Reconciliation and review discrepancies/safety context.',
        'Generate a governed SOAP draft.',
        'Edit the draft as the clinician, approve it explicitly, then sign it.',
        'Return to Patient 360 and show the new authoritative document/event.',
      ],
      clinicalStory:
        'Synthetic longitudinal chart designed to demonstrate evidence-grounded review of changing renal markers after a medication adjustment without allowing the AI layer to become clinical authority.',
    },
    null,
    2
  ) + '\n'
);
