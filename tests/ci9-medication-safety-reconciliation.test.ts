import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import type { Patient360Projection } from '@/types/patient360-projection';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function projection(overrides: Partial<Patient360Projection> = {}): Patient360Projection {
  return {
    tenantId: 'tenant-ci9',
    patientId: 'patient-ci9',
    identity: {
      patientId: 'patient-ci9',
      mrn: 'MRN-CI9',
      fullName: 'CI9 Patient',
    },
    activeEncounter: {
      encounterId: 'enc-ci9',
      patientId: 'patient-ci9',
      careSetting: 'OPD',
      status: 'ACTIVE',
      departmentId: 'Medicine OPD',
      startedAt: 1_000,
    },
    careContexts: {
      activeOpdEncounters: [{
        encounterId: 'enc-ci9',
        patientId: 'patient-ci9',
        careSetting: 'OPD',
        status: 'ACTIVE',
        departmentId: 'Medicine OPD',
        startedAt: 1_000,
      }],
      latestOpdEncounter: {
        encounterId: 'enc-ci9',
        patientId: 'patient-ci9',
        careSetting: 'OPD',
        status: 'ACTIVE',
        departmentId: 'Medicine OPD',
        startedAt: 1_000,
      },
    },
    recentEncounters: [{
      encounterId: 'enc-ci9',
      patientId: 'patient-ci9',
      careSetting: 'OPD',
      status: 'ACTIVE',
      departmentId: 'Medicine OPD',
      startedAt: 1_000,
    }],
    activeProblems: [],
    resolvedProblems: [],
    allergies: [],
    currentMedications: [],
    latestVitals: [],
    recentResults: [],
    recentDocuments: [],
    dataQuality: {
      allergyKnowledge: 'KNOWN_NONE',
      problemListKnowledge: 'KNOWN_NONE',
      medicationKnowledge: 'KNOWN_NONE',
      lastMedicationReconciliationAt: 1_100,
      hasUnverifiedAllergies: false,
      hasUnverifiedProblems: false,
      hasPreliminaryResults: false,
      missingCanonicalFacts: [],
    },
    counts: {
      encounters: 1,
      conditions: 0,
      allergies: 0,
      medicationOrders: 0,
      observations: 0,
      diagnosticReports: 0,
      documents: 0,
    },
    projectionVersion: 2,
    revision: 5,
    sourceFingerprint: 'fp-ci9',
    sourceCheckpoint: '1200:evt-ci9',
    contentHash: 'hash-ci9',
    projectedAt: 1_200,
    ...overrides,
  } as Patient360Projection;
}

describe('CI-9 medication safety and reconciliation intelligence', () => {
  test('exact coded medication allergy conflict becomes critical and requires override', () => {
    const p = projection({
      allergies: [{
        allergyId: 'allergy-amox',
        substance: 'Amoxicillin',
        code: '723',
        system: 'RXNORM',
        category: 'MEDICATION',
        criticality: 'HIGH',
        verificationStatus: 'CONFIRMED',
      }],
      currentMedications: [{
        medicationOrderId: 'med-amox',
        medication: 'Amoxicillin',
        code: '723',
        system: 'RXNORM',
        status: 'ACTIVE',
        dosageText: '500 mg',
        prescribedBy: 'doctor-a',
        authoredAt: 1_050,
      }],
      dataQuality: {
        allergyKnowledge: 'KNOWN',
        problemListKnowledge: 'KNOWN_NONE',
        medicationKnowledge: 'KNOWN',
        lastMedicationReconciliationAt: 1_100,
        hasUnverifiedAllergies: false,
        hasUnverifiedProblems: false,
        hasPreliminaryResults: false,
        missingCanonicalFacts: [],
      },
    });

    const result = MedicationSafetyService.evaluateProjection(p, 2_000);
    const finding = result.findings.find(
      (item) => item.type === 'MEDICATION_ALLERGY_CONFLICT'
    );

    expect(result.state).toBe('CRITICAL_REVIEW_REQUIRED');
    expect(finding?.severity).toBe('CRITICAL_REVIEW_REQUIRED');
    expect(finding?.requiresAcknowledgement).toBe(true);
    expect(finding?.requiresOverride).toBe(true);
    expect(finding?.evidence.map((item) => item.entityId))
      .toEqual(['med-amox', 'allergy-amox']);
  });

  test('exact-name fallback still detects allergy when medication codes differ', () => {
    const p = projection({
      allergies: [{
        allergyId: 'allergy-name',
        substance: 'Amoxicillin',
        code: 'legacy-code',
        system: 'LOCAL',
        category: 'MEDICATION',
        criticality: 'HIGH',
        verificationStatus: 'CONFIRMED',
      }],
      currentMedications: [{
        medicationOrderId: 'med-name',
        medication: 'Amoxicillin',
        code: 'rxnorm-code',
        system: 'RXNORM',
        status: 'ACTIVE',
        dosageText: '500 mg',
        prescribedBy: 'doctor-a',
        authoredAt: 1_050,
      }],
      dataQuality: {
        allergyKnowledge: 'KNOWN',
        problemListKnowledge: 'KNOWN_NONE',
        medicationKnowledge: 'KNOWN',
        lastMedicationReconciliationAt: 1_100,
        hasUnverifiedAllergies: false,
        hasUnverifiedProblems: false,
        hasPreliminaryResults: false,
        missingCanonicalFacts: [],
      },
    });

    const result = MedicationSafetyService.evaluateProjection(p, 2_000);
    expect(
      result.findings.some(
        (item) => item.type === 'MEDICATION_ALLERGY_CONFLICT'
      )
    ).toBe(true);
  });

  test('duplicate exact active medication orders are action-required', () => {
    const medication = {
      medication: 'Metformin',
      code: '860975',
      system: 'RXNORM',
      status: 'ACTIVE' as const,
      dosageText: '500 mg',
      prescribedBy: 'doctor-a',
      authoredAt: 1_050,
    };
    const result = MedicationSafetyService.evaluateProjection(
      projection({
        currentMedications: [
          { medicationOrderId: 'med-1', ...medication },
          { medicationOrderId: 'med-2', ...medication },
        ],
        dataQuality: {
          allergyKnowledge: 'KNOWN_NONE',
          problemListKnowledge: 'KNOWN_NONE',
          medicationKnowledge: 'KNOWN',
          lastMedicationReconciliationAt: 1_100,
          hasUnverifiedAllergies: false,
          hasUnverifiedProblems: false,
          hasPreliminaryResults: false,
          missingCanonicalFacts: [],
        },
      }),
      2_000
    );

    const duplicate = result.findings.find(
      (item) => item.type === 'DUPLICATE_ACTIVE_MEDICATION'
    );
    expect(duplicate?.severity).toBe('ACTION_REQUIRED');
    expect(duplicate?.medicationOrderIds.sort()).toEqual(['med-1', 'med-2']);
  });

  test('incomplete knowledge and stale reconciliation are explicit safety findings', () => {
    const result = MedicationSafetyService.evaluateProjection(
      projection({
        dataQuality: {
          allergyKnowledge: 'NOT_ASSESSED',
          problemListKnowledge: 'KNOWN_NONE',
          medicationKnowledge: 'UNKNOWN',
          hasUnverifiedAllergies: false,
          hasUnverifiedProblems: false,
          hasPreliminaryResults: false,
          missingCanonicalFacts: [
            'ALLERGY_STATUS_NOT_ASSESSED',
            'MEDICATION_HISTORY_UNKNOWN',
          ],
        },
      }),
      2_000
    );

    const types = new Set(result.findings.map((item) => item.type));
    expect(types.has('ALLERGY_STATUS_INCOMPLETE')).toBe(true);
    expect(types.has('MEDICATION_HISTORY_INCOMPLETE')).toBe(true);
    expect(types.has('MEDICATION_RECONCILIATION_REQUIRED')).toBe(true);
  });

  test('candidate precheck reports exact allergy conflict and duplicate therapy', () => {
    const p = projection({
      allergies: [{
        allergyId: 'allergy-1',
        substance: 'Metformin',
        code: '860975',
        system: 'RXNORM',
        category: 'MEDICATION',
        criticality: 'HIGH',
        verificationStatus: 'CONFIRMED',
      }],
      currentMedications: [{
        medicationOrderId: 'med-existing',
        medication: 'Metformin',
        code: '860975',
        system: 'RXNORM',
        status: 'ACTIVE',
        dosageText: '500 mg',
        prescribedBy: 'doctor-a',
        authoredAt: 1_050,
      }],
      dataQuality: {
        allergyKnowledge: 'KNOWN',
        problemListKnowledge: 'KNOWN_NONE',
        medicationKnowledge: 'KNOWN',
        lastMedicationReconciliationAt: 1_100,
        hasUnverifiedAllergies: false,
        hasUnverifiedProblems: false,
        hasPreliminaryResults: false,
        missingCanonicalFacts: [],
      },
    });

    const evaluation = MedicationSafetyService.evaluateCandidate(
      p,
      'enc-ci9',
      {
        drugCode: '860975',
        drugName: 'Metformin',
        system: 'RXNORM',
      },
      2_000
    );

    expect(evaluation.blockingFindingIds.length).toBe(1);
    expect(
      evaluation.findings.some(
        (item) => item.type === 'DUPLICATE_ACTIVE_MEDICATION'
      )
    ).toBe(true);
  });

  test('CI-9 declares its current clinical knowledge limitations explicitly', () => {
    const result = MedicationSafetyService.evaluateProjection(
      projection(),
      2_000
    );
    expect(result.limitations.join(' ')).toContain('drug-drug interactions');
    expect(result.limitations.join(' ')).toContain('renal dose adjustments');
    expect(result.limitations.join(' ')).toContain(
      'Absence of a CI-9 finding is not proof'
    );
  });

  test('prescribing command independently enforces acknowledgement and override', async () => {
    const orders = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );
    const schema = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );
    const precheck = await source(
      'app/api/clinical/medication-safety/precheck/route.ts'
    );

    expect(orders).toContain(
      'MedicationSafetyService.evaluateCandidateAuthoritatively'
    );
    expect(orders).toContain("'MEDICATION_SAFETY_ACKNOWLEDGEMENT_REQUIRED'");
    expect(orders).toContain("'MEDICATION_SAFETY_OVERRIDE_REQUIRED'");
    expect(orders).toContain('medicationSafetyOverrideReason');
    expect(schema).toContain('safetyAcknowledgementFindingIds');
    expect(schema).toContain('safetyOverrideReason');
    expect(precheck).toContain('deriveAuthoritativeContext');
    expect(precheck).toContain("requiredPrivilege: 'PRESCRIBE'");
    expect(precheck).toContain('assertPatient360PatientAccess');
  });

  test('old client-side penicillin heuristic is retired', async () => {
    const pharmacy = await source(
      'components/opd/OpdPharmacyPrescriptions.tsx'
    );

    expect(pharmacy).not.toContain('isPenicillin');
    expect(pharmacy).not.toContain('hasAllergyConflict');
    expect(pharmacy).not.toContain('hypersensitivity to Penicillin');
    expect(pharmacy).toContain(
      '/api/clinical/medication-safety/precheck'
    );
    expect(pharmacy).toContain('CI-9 medication safety review required');
  });

  test('medication reconciliation is governed and credential gated', async () => {
    const documentation = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );
    const patient360 = await source(
      'components/patient360/Patient360View.tsx'
    );
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );

    expect(documentation).toContain("requiredPrivilege: 'DISPENSE_MEDICATION'");
    expect(documentation).toContain("requiredPrivilege: 'PRESCRIBE'");
    expect(documentation).toContain(
      "eventType: 'MEDICATION_RECONCILIATION_COMPLETED'"
    );
    expect(patient360).toContain('Complete medication reconciliation');
    expect(patient360).toContain(
      'I confirm that the medication list has been reviewed'
    );
    expect(client).toContain('CompleteMedicationReconciliationCommand');
  });

  test('CI-9 is event-driven, rebuildable, and feeds consultant attention', async () => {
    const workers = await source(
      'lib/backend/projections/projection-workers.ts'
    );
    const attention = await source(
      'lib/clinical/intelligence/consultant-attention-projection-service.ts'
    );

    expect(
      workers.indexOf('MedicationSafetyService.refreshFromEvent(event)')
    ).toBeGreaterThan(-1);
    expect(
      workers.indexOf('MedicationSafetyService.refreshFromEvent(event)')
    ).toBeLessThan(
      workers.indexOf(
        'ConsultantAttentionProjectionService.refreshFromEvent(event)'
      )
    );
    expect(workers).toContain("'medicationSafetyCheckpoints'");
    expect(workers).toContain("'medicationSafetyProjections'");
    expect(workers).toContain(
      'MedicationSafetyService.rebuildTenantFromEvents'
    );
    expect(attention).toContain("collection('medicationSafetyProjections')");
    expect(attention).toContain("category: 'MEDICATION'");
  });

  test('Patient 360 and encrypted offline continuity expose medication safety safely', async () => {
    const route = await source(
      'app/api/clinical/patient360/[patientId]/route.ts'
    );
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const rules = await source('firestore.rules');
    const view = await source('components/patient360/Patient360View.tsx');

    expect(route).toContain('MedicationSafetyService.getProjection');
    expect(route).toContain('medicationSafety');
    expect(client).toContain("'medicationSafetyProjections'");
    expect(client).toContain('medicationSafety: MedicationSafetyProjection');
    expect(bootstrap).toContain("'medicationSafetyProjections'");
    expect(view).toContain(
      'Medication Safety & Reconciliation Intelligence'
    );
    expect(view.toLowerCase()).toContain(
      'absence of a finding is not proof a medication is safe'
    );

    const projectionRule = rules.indexOf(
      'match /medicationSafetyProjections/{patientId}'
    );
    const checkpointRule = rules.indexOf(
      'match /medicationSafetyCheckpoints/{eventId}'
    );
    expect(projectionRule).toBeGreaterThan(-1);
    expect(checkpointRule).toBeGreaterThan(-1);
    expect(rules.slice(projectionRule, projectionRule + 140)).toContain(
      'allow read, write: if false'
    );
    expect(rules.slice(checkpointRule, checkpointRule + 140)).toContain(
      'allow read, write: if false'
    );
  });
});
