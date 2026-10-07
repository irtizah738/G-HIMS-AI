import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';
import type { Patient360ProjectionSources } from '@/lib/clinical/patient360/patient360-projector';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

function baseSources(): Patient360ProjectionSources {
  return {
    tenantId: 'tenant-a',
    patient: {
      id: 'patient-a',
      patientId: 'patient-a',
      mrn: 'MRN-A',
      fullName: 'Synthetic Patient',
      dateOfBirth: '1980-01-01',
      gender: 'female',
      status: 'ACTIVE',
      _serverVersion: 4,
      updatedAt: 1700000000200,
    },
    encounters: [
      {
        encounterId: 'enc-a',
        patientId: 'patient-a',
        encounterType: 'OPD_GENERAL',
        status: 'ACTIVE',
        department: 'Medicine',
        chiefComplaint: 'Follow-up',
        createdAt: 1700000000000,
        _serverVersion: 2,
      },
      {
        encounterId: 'enc-other',
        patientId: 'patient-b',
        encounterType: 'OPD_GENERAL',
        status: 'ACTIVE',
        createdAt: 1700000000300,
        _serverVersion: 99,
      },
    ],
    conditions: [
      {
        conditionId: 'cond-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'cond-a',
        provenance: {
          provenanceId: 'prov-cond-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'cond-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000100,
        },
        createdAt: 1700000000100,
        updatedAt: 1700000000100,
        version: 1,
        code: {
          codings: [{ system: 'ICD10', code: 'I10', display: 'Hypertension' }],
          text: 'Hypertension',
        },
        category: 'CHRONIC',
        clinicalStatus: 'ACTIVE',
        verificationStatus: 'CONFIRMED',
        recordedAt: 1700000000100,
        recordedBy: 'doctor-a',
      },
      {
        conditionId: 'cond-error',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        sourceEvidenceId: 'cond-error',
        provenance: {
          provenanceId: 'prov-cond-error',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'cond-error',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000150,
        },
        createdAt: 1700000000150,
        updatedAt: 1700000000150,
        version: 1,
        code: {
          codings: [{ system: 'LOCAL', code: 'WRONG', display: 'Wrong diagnosis' }],
          text: 'Wrong diagnosis',
        },
        category: 'PROBLEM_LIST',
        clinicalStatus: 'ACTIVE',
        verificationStatus: 'ENTERED_IN_ERROR',
        recordedAt: 1700000000150,
        recordedBy: 'doctor-a',
      },
    ],
    allergies: [
      {
        allergyId: 'allergy-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        sourceEvidenceId: 'allergy-a',
        provenance: {
          provenanceId: 'prov-allergy-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'allergy-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000100,
        },
        createdAt: 1700000000100,
        updatedAt: 1700000000100,
        version: 1,
        substance: {
          codings: [{ system: 'LOCAL', code: 'PEN', display: 'Penicillin' }],
          text: 'Penicillin',
        },
        type: 'ALLERGY',
        category: 'MEDICATION',
        clinicalStatus: 'ACTIVE',
        verificationStatus: 'CONFIRMED',
        criticality: 'HIGH',
        reactions: [],
        recordedAt: 1700000000100,
        recorderId: 'doctor-a',
      },
    ],
    medicationOrders: [
      {
        medicationOrderId: 'rx-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'rx-a',
        provenance: {
          provenanceId: 'prov-rx-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'rx-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000120,
        },
        createdAt: 1700000000120,
        updatedAt: 1700000000120,
        version: 1,
        medication: {
          codings: [{ system: 'LOCAL', code: 'AMLO5', display: 'Amlodipine 5 mg' }],
          text: 'Amlodipine 5 mg',
        },
        status: 'ACTIVE',
        intent: 'ORDER',
        dosageText: '5 mg',
        prescribedBy: 'doctor-a',
        authoredAt: 1700000000120,
      },
    ],
    observations: [
      {
        observationId: 'obs-old',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'vitals-old',
        provenance: {
          provenanceId: 'prov-vitals-old',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'vitals-old',
          sourceType: 'NURSE',
          recordedBy: 'nurse-a',
          recordedAt: 1700000000050,
        },
        createdAt: 1700000000050,
        updatedAt: 1700000000050,
        version: 1,
        category: 'VITAL_SIGNS',
        code: {
          codings: [{ system: 'LOINC', code: '8867-4', display: 'Heart rate' }],
          text: 'Heart rate',
        },
        value: {
          valueType: 'QUANTITY',
          quantity: { value: 70, unit: 'per minute', system: 'UCUM', code: '/min' },
        },
        effectiveAt: 1700000000050,
        status: 'FINAL',
        performerIds: ['nurse-a'],
      },
      {
        observationId: 'obs-new',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'vitals-new',
        provenance: {
          provenanceId: 'prov-vitals-new',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'vitals-new',
          sourceType: 'NURSE',
          recordedBy: 'nurse-a',
          recordedAt: 1700000000250,
        },
        createdAt: 1700000000250,
        updatedAt: 1700000000250,
        version: 1,
        category: 'VITAL_SIGNS',
        code: {
          codings: [{ system: 'LOINC', code: '8867-4', display: 'Heart rate' }],
          text: 'Heart rate',
        },
        value: {
          valueType: 'QUANTITY',
          quantity: { value: 88, unit: 'per minute', system: 'UCUM', code: '/min' },
        },
        effectiveAt: 1700000000250,
        status: 'FINAL',
        performerIds: ['nurse-a'],
      },
    ],
    diagnosticOrders: [
      {
        diagnosticOrderId: 'ord-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'ord-a',
        provenance: {
          provenanceId: 'prov-ord-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'ord-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000260,
        },
        createdAt: 1700000000260,
        updatedAt: 1700000000260,
        version: 1,
        service: {
          codings: [{ system: 'LOCAL', code: 'CBC', display: 'Complete blood count' }],
          text: 'Complete blood count',
        },
        orderType: 'LAB',
        priority: 'ROUTINE',
        status: 'COMPLETED',
        orderedBy: 'doctor-a',
        orderedAt: 1700000000260,
      },
    ],
    diagnosticReports: [
      {
        diagnosticReportId: 'report-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'report-a',
        provenance: {
          provenanceId: 'prov-report-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'report-a',
          sourceType: 'LAB_SYSTEM',
          recordedBy: 'lab-a',
          recordedAt: 1700000000270,
        },
        createdAt: 1700000000270,
        updatedAt: 1700000000270,
        version: 1,
        orderId: 'ord-a',
        code: {
          codings: [{ system: 'LOCAL', code: 'CBC', display: 'Complete blood count' }],
          text: 'Complete blood count',
        },
        category: 'LAB',
        status: 'FINAL',
        resultObservationIds: ['labobs-a'],
        issuedAt: 1700000000270,
      },
    ],
    procedures: [
      {
        procedureId: 'proc-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'proc-a',
        provenance: {
          provenanceId: 'prov-proc-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'proc-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000275,
        },
        createdAt: 1700000000275,
        updatedAt: 1700000000275,
        version: 1,
        code: {
          codings: [{ system: 'LOCAL', code: 'ECG', display: 'Electrocardiogram' }],
          text: 'Electrocardiogram',
        },
        status: 'COMPLETED',
        performedAt: 1700000000275,
        performerIds: ['doctor-a'],
      },
    ],
    carePlans: [
      {
        carePlanId: 'plan-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'plan-a',
        provenance: {
          provenanceId: 'prov-plan-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'plan-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000278,
        },
        createdAt: 1700000000278,
        updatedAt: 1700000000278,
        version: 1,
        status: 'ACTIVE',
        intent: 'PLAN',
        title: 'Hypertension follow-up',
        addressesConditionIds: ['cond-a'],
        activities: [
          {
            activityId: 'activity-a',
            description: 'Repeat blood pressure review',
            status: 'SCHEDULED',
          },
        ],
        authoredBy: 'doctor-a',
        authoredAt: 1700000000278,
      },
    ],
    documents: [
      {
        clinicalDocumentId: 'doc-a',
        tenantId: 'tenant-a',
        patientId: 'patient-a',
        encounterId: 'enc-a',
        sourceEvidenceId: 'doc-a',
        provenance: {
          provenanceId: 'prov-doc-a',
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          sourceEvidenceId: 'doc-a',
          sourceType: 'CLINICIAN',
          recordedBy: 'doctor-a',
          recordedAt: 1700000000280,
        },
        createdAt: 1700000000280,
        updatedAt: 1700000000280,
        version: 1,
        documentType: 'SOAP',
        status: 'FINAL',
        content: 'Signed note',
        signedBy: 'doctor-a',
        signedAt: 1700000000280,
      },
    ],
    events: [
      {
        eventId: 'evt-1',
        eventType: 'PatientRegisteredEvent',
        aggregateType: 'PATIENT_MPI',
        aggregateId: 'patient-a',
        payload: { patientId: 'patient-a' },
        occurredAt: 1700000000000,
        recordedAt: 1700000000001,
      },
      {
        eventId: 'evt-2',
        eventType: 'VITALS_RECORDED',
        aggregateType: 'ENCOUNTER_EVIDENCE',
        aggregateId: 'vitals-new',
        payload: { patientId: 'patient-a', encounterId: 'enc-a' },
        occurredAt: 1700000000250,
        recordedAt: 1700000000255,
      },
      {
        eventId: 'evt-other',
        eventType: 'VITALS_RECORDED',
        aggregateType: 'ENCOUNTER_EVIDENCE',
        aggregateId: 'other',
        payload: { patientId: 'patient-b', encounterId: 'enc-other' },
        occurredAt: 1700000000400,
        recordedAt: 1700000000400,
      },
    ],
  };
}

describe('G-HIMS CI-4 authoritative Patient 360 projection', () => {
  test('same authoritative evidence produces the same content hash regardless of source ordering', () => {
    const sources = baseSources();
    const first = Patient360Projector.project(sources, 1700000010000);

    const reordered: Patient360ProjectionSources = {
      ...sources,
      encounters: [...sources.encounters].reverse(),
      conditions: [...sources.conditions].reverse(),
      observations: [...sources.observations].reverse(),
      events: [...sources.events].reverse(),
    };
    const second = Patient360Projector.project(reordered, 1700000099999);

    expect(second.projection.contentHash).toBe(first.projection.contentHash);
    expect(second.projection.sourceFingerprint).toBe(first.projection.sourceFingerprint);
    expect(second.projection.sourceCheckpoint).toBe(first.projection.sourceCheckpoint);
    expect(second.projection.revision).toBe(first.projection.revision);
  });

  test('cross-patient records do not alter projection content or fingerprint', () => {
    const sources = baseSources();
    const withOtherPatient = Patient360Projector.project(sources);

    const withoutOtherPatient = Patient360Projector.project({
      ...sources,
      encounters: sources.encounters.filter((item) => item.patientId === 'patient-a'),
      events: sources.events.filter((event) => event.payload.patientId === 'patient-a'),
    });

    expect(withOtherPatient.projection.contentHash).toBe(withoutOtherPatient.projection.contentHash);
    expect(withOtherPatient.projection.sourceFingerprint).toBe(withoutOtherPatient.projection.sourceFingerprint);
    expect(withOtherPatient.projection.counts.encounters).toBe(1);
  });

  test('latest vital is selected per code and invalid clinical facts are excluded from active summaries', () => {
    const { projection } = Patient360Projector.project(baseSources());

    expect(projection.latestVitals).toHaveLength(1);
    expect(projection.latestVitals[0].observationId).toBe('obs-new');
    expect(projection.activeProblems.map((item) => item.conditionId)).toEqual(['cond-a']);
    expect(projection.allergies.map((item) => item.allergyId)).toEqual(['allergy-a']);
    expect(projection.recentDiagnosticOrders.map((item) => item.diagnosticOrderId)).toEqual(['ord-a']);
    expect(projection.recentProcedures.map((item) => item.procedureId)).toEqual(['proc-a']);
    expect(projection.activeCarePlans.map((item) => item.carePlanId)).toEqual(['plan-a']);
    expect(projection.counts.diagnosticOrders).toBe(1);
    expect(projection.counts.procedures).toBe(1);
    expect(projection.counts.carePlans).toBe(1);
    expect(projection.projectionVersion).toBe(4);
  });

  test('event checkpoint uses authoritative recordedAt ordering and revision is patient-event count', () => {
    const { projection, timeline } = Patient360Projector.project(baseSources());

    expect(projection.eventCheckpoint).toEqual({
      eventId: 'evt-2',
      recordedAt: 1700000000255,
    });
    expect(projection.sourceCheckpoint).toBe('1700000000255:evt-2');
    expect(projection.lastEventId).toBe('evt-2');
    expect(projection.lastEventRecordedAt).toBe(1700000000255);
    expect(projection.revision).toBe(2);
    expect(timeline.every((item) => item.patientId === 'patient-a')).toBe(true);
    expect(timeline.every((item) => item.timelineItemId.includes('patient-a'))).toBe(true);
  });

  test('zero canonical facts remain NOT_ASSESSED rather than being inferred as known-none', () => {
    const sources = baseSources();
    const { projection } = Patient360Projector.project({
      ...sources,
      conditions: [],
      allergies: [],
      medicationOrders: [],
    });

    expect(projection.dataQuality.allergyKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.problemListKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.medicationKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.missingCanonicalFacts).toContain('ALLERGY_STATUS_NOT_ASSESSED');
  });

  test('durable Patient 360 service is tenant scoped, checkpointed, sanitized and idempotent', async () => {
    const service = await source('lib/clinical/patient360/patient360-projection-service.ts');

    expect(service).toContain("collection('patient360Projections')");
    expect(service).toContain("collection('patient360ProjectionCheckpoints')");
    expect(service).toContain("collection('patient360Timeline')");
    expect(service).toContain("collection('canonicalDiagnosticOrders')");
    expect(service).toContain("collection('clinicalProcedures')");
    expect(service).toContain("collection('carePlans')");
    expect(service).toContain("where('patientId', '==', patientId)");
    expect(service).toContain("queryEventsByField(eventsRef, 'payload.patientId', patientId)");
    expect(service).toContain("orderBy(FieldPath.documentId())");
    expect(service).toContain('PATIENT360_SOURCE_MAX');
    expect(service).toContain('sanitizeForFirestore');
    expect(service).toContain("status: 'SKIPPED'");
    expect(service).toContain("status: 'IGNORED'");
    expect(service).toContain('contentHash === projection.contentHash');
  });

  test('outbox projection worker blocks publication on Patient 360 projection completion', async () => {
    const worker = await source('lib/backend/projections/projection-workers.ts');
    const dispatcher = await source('lib/backend/outbox/dispatcher.ts');

    expect(worker).toContain('Patient360ProjectionService.refreshFromEvent');
    expect(worker).toContain('skipPatient360');
    expect(worker).toContain('Patient360ProjectionService.rebuildTenantFromEventStream');
    expect(dispatcher).toContain('await ProjectionWorkers.consumeEvent');
    expect(dispatcher.indexOf('await ProjectionWorkers.consumeEvent')).toBeLessThan(
      dispatcher.indexOf("status: 'PUBLISHED'")
    );
  });

  test('isolated recovery includes Patient 360 collections and checkpoint cardinality', async () => {
    const recovery = await source('lib/backend/recovery/projection-recovery-service.ts');
    const worker = await source('lib/backend/projections/projection-workers.ts');

    expect(recovery).toContain("'patient360Projections'");
    expect(recovery).toContain("'patient360Timeline'");
    expect(recovery).toContain("'patient360ProjectionCheckpoints'");
    expect(recovery).toContain('patient360CheckpointCount !== authoritativeEvents.length');
    expect(worker).toContain("'patient360ProjectionCheckpoints'");
    expect(worker).toContain("'patient360Projections'");
    expect(worker).toContain("'patient360Timeline'");
  });
});
