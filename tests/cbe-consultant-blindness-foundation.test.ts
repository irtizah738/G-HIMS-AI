import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';
import type { Patient360ProjectionSources } from '@/lib/clinical/patient360/patient360-projector';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function sources(): Patient360ProjectionSources {
  return {
    tenantId: 'tenant-cbe',
    patient: {
      id: 'pat-cbe',
      patientId: 'pat-cbe',
      mrn: 'MRN-CBE',
      fullName: 'Consultant Visibility Patient',
      status: 'ACTIVE',
    },
    encounters: [
      {
        encounterId: 'enc-opd',
        patientId: 'pat-cbe',
        encounterType: 'OPD',
        status: 'ACTIVE',
        departmentId: 'Medicine OPD',
        assignedProviderId: 'doctor-a',
        createdAt: 100,
      },
      {
        encounterId: 'enc-ipd',
        patientId: 'pat-cbe',
        encounterType: 'IPD',
        status: 'ACTIVE',
        departmentId: 'Ward A',
        assignedProviderId: 'consultant-a',
        sourceEncounterId: 'enc-opd',
        createdAt: 200,
      },
      {
        encounterId: 'enc-old-ipd',
        patientId: 'pat-cbe',
        encounterType: 'IPD',
        status: 'DISCHARGED',
        departmentId: 'Ward B',
        createdAt: 50,
        completedAt: 90,
      },
    ],
    conditions: [],
    allergies: [],
    medicationOrders: [],
    observations: [],
    diagnosticReports: [],
    documents: [],
    events: [
      {
        eventId: 'evt-opd',
        eventType: 'VITALS_RECORDED',
        aggregateType: 'ENCOUNTER_EVIDENCE',
        aggregateId: 'vitals-opd',
        payload: {
          patientId: 'pat-cbe',
          encounterId: 'enc-opd',
          encounterType: 'OPD',
        },
        occurredAt: 120,
        recordedAt: 121,
      },
      {
        eventId: 'evt-ipd',
        eventType: 'DIAGNOSTIC_RESULT_VERIFIED',
        aggregateType: 'DIAGNOSTIC_REPORT',
        aggregateId: 'report-ipd',
        payload: {
          patientId: 'pat-cbe',
          encounterId: 'enc-ipd',
          encounterType: 'IPD',
        },
        occurredAt: 220,
        recordedAt: 221,
      },
    ],
  };
}

describe('CBE consultant blindness foundation', () => {
  test('Patient 360 keeps longitudinal truth while exposing concurrent care settings', () => {
    const { projection, timeline } = Patient360Projector.project(sources(), 300);

    expect(projection.projectionVersion).toBe(4);
    expect(projection.careContexts.activeOpdEncounters.map((item) => item.encounterId))
      .toEqual(['enc-opd']);
    expect(projection.careContexts.activeIpdEncounter?.encounterId).toBe('enc-ipd');
    expect(projection.careContexts.latestIpdEncounter?.encounterId).toBe('enc-ipd');
    expect(projection.activeEncounter?.encounterId).toBe('enc-ipd');

    const opdEvent = timeline.find((item) => item.eventId === 'evt-opd');
    const ipdEvent = timeline.find((item) => item.eventId === 'evt-ipd');
    expect(opdEvent?.careSetting).toBe('OPD');
    expect(ipdEvent?.careSetting).toBe('IPD');
    expect(ipdEvent?.recordedAt).toBe(221);
  });

  test('patient aggregate has explicit care-setting pointers and legacy pointer is compatibility only', async () => {
    const mpi = await source('types/mpi.ts');
    const care = await source('lib/clinical/patient360/care-context.ts');
    const encounter = await source('lib/backend/services/encounter-domain-service.ts');
    const transition = await source('lib/backend/services/care-transition-domain-service.ts');

    expect(mpi).toContain('activeCareContexts?: PatientCareContextPointers');
    expect(mpi).toContain('activeOpdEncounterIds: string[]');
    expect(mpi).toContain('activeIpdEncounterId?: string');
    expect(care).toContain('compatibilityEncounterId');
    expect(encounter).toContain('PATIENT_ACTIVE_OPD_ENCOUNTER_CONFLICT');
    expect(encounter).toContain("'CARE_TRANSITION_COMMAND_REQUIRED'");
    expect(encounter).toContain("additionalStateWrites");
    expect(transition).toContain('PATIENT_ACTIVE_IPD_ENCOUNTER_CONFLICT');
    expect(transition).toContain("closeCareContext(");
    expect(transition).toContain("activateCareContext(");
  });

  test('consultant review checkpoint is governed by command bus and stale-review protection', async () => {
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');
    const service = await source('lib/backend/services/consultant-review-domain-service.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(schema).toContain('RecordConsultantPatientReviewCommand');
    expect(bus).toContain("case 'RecordConsultantPatientReviewCommand'");
    expect(service).toContain('CONSULTANT_REVIEW_STALE');
    expect(service).toContain('assertPatient360PatientAccess');
    expect(service).toContain("eventType: 'CONSULTANT_PATIENT_REVIEW_RECORDED'");
    expect(tx).toContain("CONSULTANT_REVIEW_CHECKPOINT: 'consultantReviewCheckpoints'");
  });

  test('consultant visibility is derived from Patient 360 and explicit review checkpoints', async () => {
    const visibility = await source('lib/clinical/intelligence/consultant-visibility-service.ts');
    const route = await source('app/api/clinical/patient360/[patientId]/route.ts');
    const client = await source('lib/clinical/patient360/patient360-client.ts');

    expect(visibility).toContain('Patient360ProjectionService.readClinicalView');
    expect(visibility).toContain("collection('consultantReviewCheckpoints')");
    expect(visibility).toContain('changedAfterCheckpoint');
    expect(visibility).toContain('unreadClinicalChanges');
    expect(visibility).toContain('openItems');
    expect(route).toContain('selectedCareContext');
    expect(route).toContain('consultantVisibility');
    expect(client).toContain('recordConsultantPatientReview');
  });

  test('CI-7 is explicitly inpatient-context bound and CI-8 selects an explicit active care context', async () => {
    const ci7 = await source('lib/clinical/intelligence/discharge-readiness-service.ts');
    const ci8 = await source('lib/clinical/intelligence/clinical-deterioration-service.ts');

    expect(ci7).toContain('careContexts.activeIpdEncounter');
    expect(ci8).toContain('careContexts.activeIpdEncounter');
    expect(ci8).toContain('careContexts.activeEmergencyEncounter');
    expect(ci8).toContain('careContexts.activeOpdEncounters[0]');
  });

  test('Patient 360 exposes consultant change and unresolved-attention surfaces without client-side chart authority', async () => {
    const view = await source('components/patient360/Patient360View.tsx');
    const rules = await source('firestore.rules');

    expect(view).toContain('What changed since your last review');
    expect(view).toContain('Unresolved attention');
    expect(view).toContain('Mark current state reviewed');
    expect(view).toContain('Consultant review deltas require authoritative server connectivity');
    expect(rules).toContain('match /consultantReviewCheckpoints/{checkpointId}');
    expect(rules).toContain('allow read, write: if false');
  });
});
