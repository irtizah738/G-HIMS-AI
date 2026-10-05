import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type { Patient360Projection } from '@/types/patient360-projection';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function projection(): Patient360Projection {
  return {
    tenantId: 'tenant-ci10',
    patientId: 'patient-ci10',
    identity: {
      patientId: 'patient-ci10',
      mrn: 'MRN-CI10',
      fullName: 'CI10 Patient',
    },
    activeEncounter: {
      encounterId: 'enc-ci10',
      encounterType: 'OPD',
      careSetting: 'OPD',
      status: 'ACTIVE',
      startedAt: 1000,
    },
    careContexts: {
      activeOpdEncounters: [{
        encounterId: 'enc-ci10',
        encounterType: 'OPD',
        careSetting: 'OPD',
        status: 'ACTIVE',
        startedAt: 1000,
      }],
      activeTelehealthEncounters: [],
      latestOpdEncounter: {
        encounterId: 'enc-ci10',
        encounterType: 'OPD',
        careSetting: 'OPD',
        status: 'ACTIVE',
        startedAt: 1000,
      },
    },
    recentEncounters: [{
      encounterId: 'enc-ci10',
      encounterType: 'OPD',
      careSetting: 'OPD',
      status: 'ACTIVE',
      startedAt: 1000,
    }],
    activeProblems: [{
      conditionId: 'cond-dm',
      display: 'Type 2 diabetes mellitus',
      code: '44054006',
      system: 'SNOMED_CT',
      category: 'CHRONIC',
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      onsetAt: 800,
    }],
    resolvedProblems: [],
    allergies: [{
      allergyId: 'allergy-penicillin',
      substance: 'Penicillin',
      code: '7980',
      system: 'RXNORM',
      category: 'MEDICATION',
      criticality: 'HIGH',
      verificationStatus: 'CONFIRMED',
    }],
    currentMedications: [{
      medicationOrderId: 'med-metformin',
      medication: 'Metformin',
      code: '860975',
      system: 'RXNORM',
      status: 'ACTIVE',
      dosageText: '500 mg twice daily',
      prescribedBy: 'doctor-ci10',
      authoredAt: 1100,
    }],
    latestVitals: [{
      observationId: 'obs-bp',
      display: 'Blood pressure',
      code: '85354-9',
      system: 'LOINC',
      category: 'VITAL_SIGN',
      value: { text: '150/90 mmHg' },
      effectiveAt: 1200,
      status: 'FINAL',
    }],
    recentResults: [{
      diagnosticReportId: 'report-a1c',
      display: 'HbA1c',
      category: 'LAB',
      status: 'FINAL',
      issuedAt: 1300,
      conclusion: '8.4%',
      observationIds: ['obs-a1c'],
    }],
    recentDocuments: [],
    dataQuality: {
      allergyKnowledge: 'KNOWN',
      problemListKnowledge: 'KNOWN',
      medicationKnowledge: 'KNOWN',
      lastAllergyReviewAt: 1050,
      lastProblemListReviewAt: 1060,
      lastMedicationReconciliationAt: 1070,
      hasUnverifiedAllergies: false,
      hasUnverifiedProblems: false,
      hasPreliminaryResults: false,
      missingCanonicalFacts: [],
    },
    counts: {
      encounters: 1,
      conditions: 1,
      allergies: 1,
      medicationOrders: 1,
      observations: 1,
      diagnosticReports: 1,
      documents: 0,
    },
    projectionVersion: 2,
    revision: 9,
    sourceFingerprint: 'fp-ci10',
    sourceCheckpoint: '1400:evt-result',
    contentHash: 'hash-ci10',
    projectedAt: 1400,
    lastEventId: 'evt-result',
    lastEventRecordedAt: 1400,
  };
}

const events = [
  {
    eventId: 'evt-patient',
    eventType: 'PATIENT_REGISTERED',
    aggregateType: 'PATIENT_MPI',
    aggregateId: 'patient-ci10',
    payload: { patientId: 'patient-ci10' },
    occurredAt: 700,
    recordedAt: 700,
  },
  {
    eventId: 'evt-condition',
    eventType: 'CLINICAL_CONDITION_RECORDED',
    aggregateType: 'CLINICAL_CONDITION',
    aggregateId: 'cond-dm',
    payload: { patientId: 'patient-ci10', conditionId: 'cond-dm' },
    occurredAt: 800,
    recordedAt: 810,
  },
  {
    eventId: 'evt-allergy',
    eventType: 'CLINICAL_ALLERGY_RECORDED',
    aggregateType: 'CLINICAL_ALLERGY',
    aggregateId: 'allergy-penicillin',
    payload: { patientId: 'patient-ci10', allergyId: 'allergy-penicillin' },
    occurredAt: 900,
    recordedAt: 910,
  },
  {
    eventId: 'evt-med',
    eventType: 'MEDICATION_ORDERED',
    aggregateType: 'MEDICATION_ORDER',
    aggregateId: 'med-metformin',
    payload: { patientId: 'patient-ci10', medicationOrderId: 'med-metformin' },
    occurredAt: 1100,
    recordedAt: 1110,
  },
  {
    eventId: 'evt-result',
    eventType: 'DIAGNOSTIC_RESULT_VERIFIED',
    aggregateType: 'DIAGNOSTIC_RESULT',
    aggregateId: 'report-a1c',
    payload: { patientId: 'patient-ci10', reportId: 'report-a1c' },
    occurredAt: 1300,
    recordedAt: 1400,
  },
];

describe('CI-10A evidence and provenance fabric', () => {
  test('builds deterministic immutable snapshots from the same Patient 360 revision', () => {
    const first = ClinicalEvidenceService.buildSnapshot(
      projection(),
      events,
      'LONGITUDINAL_SUMMARY',
      'doctor-a',
      2000
    );
    const second = ClinicalEvidenceService.buildSnapshot(
      projection(),
      events,
      'LONGITUDINAL_SUMMARY',
      'doctor-b',
      9000
    );

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.immutable).toBe(true);
    expect(first.patient360Revision).toBe(9);
    expect(first.patient360SourceCheckpoint).toBe('1400:evt-result');
    expect(first.evidenceCount).toBeGreaterThan(0);
  });

  test('ties clinical evidence references back to immutable source events', () => {
    const snapshot = ClinicalEvidenceService.buildSnapshot(
      projection(),
      events,
      'ENCOUNTER_PREP',
      'doctor-a',
      2000
    );

    const condition = snapshot.evidenceRefs.find(
      (item) => item.sourceEntityId === 'cond-dm'
    );
    const medication = snapshot.evidenceRefs.find(
      (item) => item.sourceEntityId === 'med-metformin'
    );
    const result = snapshot.evidenceRefs.find(
      (item) => item.sourceEntityId === 'report-a1c'
    );

    expect(condition?.sourceEventIds).toContain('evt-condition');
    expect(medication?.sourceEventIds).toContain('evt-med');
    expect(result?.sourceEventIds).toContain('evt-result');
    expect(result?.latestSourceEventId).toBe('evt-result');
  });

  test('rejects factual claims with missing or foreign evidence', () => {
    const snapshot = ClinicalEvidenceService.buildSnapshot(
      projection(),
      events,
      'LONGITUDINAL_SUMMARY',
      'doctor-a',
      2000
    );

    const unsupported = ClinicalEvidenceService.validateClaims(snapshot, [{
      claimId: 'claim-1',
      text: 'Patient has chronic kidney disease.',
      classification: 'DIRECT_FACT',
      evidenceRefs: [],
      confidence: 0.9,
    }]);
    const foreign = ClinicalEvidenceService.validateClaims(snapshot, [{
      claimId: 'claim-2',
      text: 'A foreign chart says something else.',
      classification: 'DIRECT_FACT',
      evidenceRefs: ['evidence-from-another-patient'],
      confidence: 0.9,
    }]);

    expect(unsupported.valid).toBe(false);
    expect(unsupported.errors).toContain('CLAIM_EVIDENCE_REQUIRED:claim-1');
    expect(foreign.valid).toBe(false);
    expect(foreign.errors.join(' ')).toContain('CLAIM_EVIDENCE_OUTSIDE_SNAPSHOT');
  });

  test('blocks generated autonomous clinical actions even when claims are grounded', () => {
    const snapshot = ClinicalEvidenceService.buildSnapshot(
      projection(),
      events,
      'MEDICATION_RECONCILIATION',
      'doctor-a',
      2000
    );
    const medicationEvidence = snapshot.evidenceRefs.find(
      (item) => item.sourceEntityId === 'med-metformin'
    )!;

    const validation = ClinicalEvidenceService.validateGeneratedResult(snapshot, {
      requestId: 'req-1',
      provider: 'test-provider',
      model: 'test-model',
      promptPolicyVersion: 'ci10-policy-v1',
      generatedAt: 2100,
      claims: [{
        claimId: 'claim-med',
        text: 'Metformin is recorded as active.',
        classification: 'DIRECT_FACT',
        evidenceRefs: [medicationEvidence.evidenceId],
        confidence: 1,
      }],
      warnings: [],
      proposedClinicalActions: [{
        type: 'STOP_MEDICATION',
        description: 'Stop metformin',
      }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('AUTONOMOUS_CLINICAL_ACTIONS_NOT_ALLOWED');
  });

  test('provider gateway and API are evidence scoped and provider neutral', async () => {
    const gateway = await source(
      'lib/clinical/intelligence/clinical-intelligence-gateway.ts'
    );
    const route = await source(
      'app/api/clinical/intelligence/evidence-snapshots/route.ts'
    );

    expect(gateway).toContain('ClinicalIntelligenceProvider');
    expect(gateway).toContain('CI10_EVIDENCE_SNAPSHOT_MISMATCH');
    expect(gateway).toContain('validateGeneratedResult');
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('assertPatient360PatientAccess');
    expect(route).toContain('createAuthoritativeSnapshot');
  });

  test('evidence snapshots are server-only and persistence is append-only', async () => {
    const rules = await source('firestore.rules');
    const service = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    const index = rules.indexOf(
      'match /clinicalIntelligenceEvidenceSnapshots/{snapshotId}'
    );
    expect(index).toBeGreaterThan(-1);
    expect(rules.slice(index, index + 180)).toContain(
      'allow read, write: if false'
    );
    expect(service).toContain('transaction.create(snapshotRef');
    expect(service).toContain('CI10_EVIDENCE_IMMUTABILITY_VIOLATION');
    expect(service).toContain(
      "eventType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED'"
    );
    expect(service).toContain(
      "topic: 'g-hims-clinical-intelligence-events'"
    );
  });

  test('clinical record content is treated as evidence data, not provider instruction', async () => {
    const gateway = await source(
      'lib/clinical/intelligence/clinical-intelligence-gateway.ts'
    );
    expect(gateway).not.toContain('@google/genai');
    expect(gateway).not.toContain('openai');
    expect(gateway).not.toContain('anthropic');
    expect(gateway).not.toContain('systemInstruction');
  });
});
