import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { MedicationReconciliationCopilotEngine } from '@/lib/clinical/intelligence/medication-reconciliation-copilot-engine';
import { MedicationReconciliationCopilotService } from '@/lib/clinical/intelligence/medication-reconciliation-copilot-service';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
  ClinicalEvidenceSourceType,
} from '@/types/clinical-intelligence-evidence';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function evidence(
  evidenceId: string,
  sourceType: ClinicalEvidenceSourceType,
  sourceEntityId: string,
  label: string,
  content: unknown,
  occurredAt?: number
): ClinicalEvidenceRef {
  return {
    evidenceId,
    tenantId: 'tenant-ci10e',
    patientId: 'patient-ci10e',
    sourceType,
    sourceEntityId,
    label,
    occurredAt,
    patient360Revision: 40,
    patient360SourceCheckpoint: '9000:evt-ci10e',
    sourceEventIds: ['evt-' + sourceEntityId],
    sourceEventCount: 1,
    sourceEventSetHash: 'eventhash-' + sourceEntityId,
    latestSourceEventId: 'evt-' + sourceEntityId,
    provenanceStatus: 'EVENT_VERIFIED',
    content,
    contentHash: 'hash-' + sourceEntityId,
  };
}

function medConcept(code: string, name: string) {
  return {
    text: name,
    codings: [{ system: 'LOCAL', code, display: name }],
  };
}

function snapshot(): ClinicalEvidenceSnapshot {
  const refs: ClinicalEvidenceRef[] = [
    evidence(
      'ev-context',
      'ENCOUNTER_CONTEXT',
      'enc-current',
      'OPD medication reconciliation context',
      {
        encounter: {
          encounterId: 'enc-current',
          careSetting: 'OPD',
          status: 'ACTIVE',
          startedAt: 2_000,
        },
        authoritativeEncounter: {
          encounterId: 'enc-current',
          patientId: 'patient-ci10e',
        },
        medicationKnowledge: 'KNOWN',
        lastMedicationReconciliationAt: 1_500,
      },
      2_000
    ),
    evidence(
      'ev-knowledge',
      'KNOWLEDGE_STATUS',
      'patient-ci10e:medication-knowledge',
      'Medication knowledge status',
      {
        medicationKnowledge: 'KNOWN',
        lastMedicationReconciliationAt: 1_500,
        missingCanonicalFacts: [],
      },
      1_500
    ),
    evidence(
      'ev-home-metformin',
      'MEDICATION_HISTORY',
      'med-old-metformin',
      'Metformin',
      {
        medicationOrderId: 'med-old-metformin',
        patientId: 'patient-ci10e',
        encounterId: 'enc-old',
        medication: medConcept('MET500', 'Metformin'),
        status: 'ACTIVE',
        dosageText: '500 mg',
        frequency: 'BD',
        route: { text: 'Oral' },
        authoredAt: 1_000,
        quantity: { value: 30, unit: 'tablet' },
      },
      1_000
    ),
    evidence(
      'ev-old-atorva',
      'MEDICATION_HISTORY',
      'med-old-atorva',
      'Atorvastatin',
      {
        medicationOrderId: 'med-old-atorva',
        patientId: 'patient-ci10e',
        encounterId: 'enc-old',
        medication: medConcept('ATOR20', 'Atorvastatin'),
        status: 'STOPPED',
        dosageText: '20 mg',
        frequency: 'HS',
        route: { text: 'Oral' },
        authoredAt: 1_100,
      },
      1_100
    ),
    evidence(
      'ev-current-atorva',
      'MEDICATION_HISTORY',
      'med-current-atorva',
      'Atorvastatin',
      {
        medicationOrderId: 'med-current-atorva',
        patientId: 'patient-ci10e',
        encounterId: 'enc-current',
        medication: medConcept('ATOR20', 'Atorvastatin'),
        status: 'ACTIVE',
        dosageText: '40 mg',
        frequency: 'HS',
        route: { text: 'Oral' },
        authoredAt: 2_100,
        quantity: { value: 30, unit: 'tablet' },
      },
      2_100
    ),
    evidence(
      'ev-dispense-atorva',
      'MEDICATION_DISPENSE',
      'disp-current-atorva',
      'Atorvastatin',
      {
        medicationDispenseId: 'disp-current-atorva',
        medicationOrderId: 'med-current-atorva',
        patientId: 'patient-ci10e',
        encounterId: 'enc-current',
        medication: medConcept('ATOR20', 'Atorvastatin'),
        status: 'COMPLETED',
        quantity: { value: 40, unit: 'tablet' },
        dispensedAt: 2_200,
      },
      2_200
    ),
    evidence(
      'ev-orphan-dispense',
      'MEDICATION_DISPENSE',
      'disp-orphan',
      'Amoxicillin',
      {
        medicationDispenseId: 'disp-orphan',
        medicationOrderId: 'missing-order',
        patientId: 'patient-ci10e',
        encounterId: 'enc-current',
        medication: medConcept('AMOX500', 'Amoxicillin'),
        status: 'COMPLETED',
        quantity: { value: 5, unit: 'capsule' },
        dispensedAt: 2_250,
      },
      2_250
    ),
    evidence(
      'ev-orphan-admin',
      'MEDICATION_ADMINISTRATION',
      'admin-orphan',
      'Ceftriaxone',
      {
        medicationAdministrationId: 'admin-orphan',
        patientId: 'patient-ci10e',
        encounterId: 'enc-current',
        medication: medConcept('CEF1G', 'Ceftriaxone'),
        status: 'COMPLETED',
        administeredAt: 2_300,
      },
      2_300
    ),
    evidence(
      'ev-ci9-rec',
      'MEDICATION_SAFETY_FINDING',
      'ci9-rec',
      'Medication reconciliation required',
      {
        type: 'MEDICATION_RECONCILIATION_REQUIRED',
        severity: 'ACTION_REQUIRED',
        description: 'No medication reconciliation checkpoint exists after encounter start.',
        medicationOrderIds: ['med-current-atorva'],
        allergyIds: [],
      },
      2_350
    ),
  ];

  return {
    snapshotId: 'cisnap-ci10e',
    tenantId: 'tenant-ci10e',
    patientId: 'patient-ci10e',
    purpose: 'MEDICATION_RECONCILIATION',
    createdAt: 3_000,
    createdBy: 'doctor-ci10e',
    immutable: true,
    schemaVersion: 2,
    patient360ProjectionVersion: 2,
    patient360Revision: 40,
    patient360SourceCheckpoint: '9000:evt-ci10e',
    patient360ContentHash: 'p360hash-ci10e',
    evidenceRefs: refs,
    evidenceCount: refs.length,
    sourceEventCount: refs.length,
    coverage: {
      encounterContext: { status: 'COMPLETE', recordCount: 1 },
      medicationOrders: { status: 'COMPLETE', recordCount: 3 },
      medicationDispenses: { status: 'COMPLETE', recordCount: 2 },
      medicationAdministrations: { status: 'COMPLETE', recordCount: 1 },
      medicationReconciliations: { status: 'COMPLETE', recordCount: 0 },
      medicationAllergies: { status: 'COMPLETE', recordCount: 0 },
      medicationSafety: { status: 'COMPLETE', recordCount: 1 },
    },
    dateRange: { from: 1_000, to: 2_350 },
    snapshotHash: 'snapshot-hash-ci10e',
    limitations: [
      'Missing or incomplete source data must not be interpreted as clinical absence.',
    ],
  };
}

describe('CI-10E medication reconciliation copilot', () => {
  test('surfaces continuation gap, restarted therapy, dose change and CI-9 reconciliation requirement', () => {
    const findings = MedicationReconciliationCopilotEngine.compute(
      snapshot(),
      'enc-current'
    );
    const types = new Set(findings.map((item) => item.type));

    expect(types.has('PRE_ENCOUNTER_ACTIVE_NOT_REPRESENTED_CURRENT')).toBe(true);
    expect(types.has('CURRENT_ORDER_REAPPEARS_AFTER_STOP')).toBe(true);
    expect(types.has('CURRENT_ORDER_DOSE_CHANGED')).toBe(true);
    expect(types.has('RECONCILIATION_REQUIRED')).toBe(true);
  });

  test('detects canonical dispense/admin traceability conflicts and quantity excess', () => {
    const findings = MedicationReconciliationCopilotEngine.compute(
      snapshot(),
      'enc-current'
    );
    const types = new Set(findings.map((item) => item.type));

    expect(types.has('DISPENSE_WITHOUT_MATCHING_ORDER')).toBe(true);
    expect(types.has('DISPENSE_QUANTITY_EXCEEDS_ORDER')).toBe(true);
    expect(types.has('ADMINISTRATION_WITHOUT_MATCHING_ORDER')).toBe(true);
  });

  test('pre-encounter active evidence is explicitly not promoted to verified home medication', () => {
    const finding = MedicationReconciliationCopilotEngine.compute(
      snapshot(),
      'enc-current'
    ).find(
      (item) =>
        item.type === 'PRE_ENCOUNTER_ACTIVE_NOT_REPRESENTED_CURRENT'
    );

    expect(finding?.caveat).toContain(
      'not automatically a verified home medication'
    );
    expect(finding?.classification).toBe('POSSIBLE_DISCREPANCY');
  });

  test('missing dispense/admin evidence becomes coverage information, never proof of non-administration', () => {
    const input = snapshot();
    input.evidenceRefs = input.evidenceRefs.filter(
      (item) =>
        item.sourceType !== 'MEDICATION_DISPENSE' &&
        item.sourceType !== 'MEDICATION_ADMINISTRATION'
    );
    input.coverage = {
      ...(input.coverage || {}),
      medicationDispenses: { status: 'COMPLETE', recordCount: 0 },
      medicationAdministrations: { status: 'COMPLETE', recordCount: 0 },
    };

    const findings = MedicationReconciliationCopilotEngine.compute(
      input,
      'enc-current'
    );
    const dispenseCoverage = findings.find(
      (item) => item.type === 'DISPENSE_EVIDENCE_NOT_REPRESENTED'
    );

    expect(dispenseCoverage?.severity).toBe('INFORMATION');
    expect(dispenseCoverage?.caveat).toContain(
      'not proof that medication was not dispensed'
    );
    expect(
      findings.some((item) =>
        /was not dispensed|was not administered/i.test(item.description)
      )
    ).toBe(false);
  });

  test('incomplete medication knowledge is explicit and never invents missing medications', () => {
    const input = snapshot();
    const knowledge = input.evidenceRefs.find(
      (item) => item.sourceType === 'KNOWLEDGE_STATUS'
    )!;
    knowledge.content = {
      medicationKnowledge: 'UNKNOWN',
      lastMedicationReconciliationAt: null,
      missingCanonicalFacts: ['MEDICATION_HISTORY_UNKNOWN'],
    };

    const finding = MedicationReconciliationCopilotEngine.compute(
      input,
      'enc-current'
    ).find((item) => item.type === 'MEDICATION_HISTORY_INCOMPLETE');

    expect(finding?.severity).toBe('ACTION_REQUIRED');
    expect(finding?.caveat).toContain(
      'does not infer which medications are missing'
    );
  });

  test('all findings are grounded within the frozen CI-10A evidence packet', () => {
    const input = snapshot();
    const findings = MedicationReconciliationCopilotEngine.compute(
      input,
      'enc-current'
    );
    const claims = findings.map((item) => ({
      claimId: item.findingId,
      text: item.description,
      classification: item.classification,
      evidenceRefs: item.evidenceRefs,
      confidence: 1,
    }));

    expect(
      ClinicalEvidenceService.validateClaims(input, claims).valid
    ).toBe(true);
    expect(findings.every((item) => item.evidenceRefs.length > 0)).toBe(true);
  });

  test('purpose and patient scope mismatches fail closed', () => {
    const wrongPurpose = snapshot();
    wrongPurpose.purpose = 'ENCOUNTER_PREP';
    expect(() =>
      MedicationReconciliationCopilotEngine.compute(
        wrongPurpose,
        'enc-current'
      )
    ).toThrow('CI10E_EVIDENCE_PURPOSE_MISMATCH');

    const wrongPatient = snapshot();
    wrongPatient.evidenceRefs[0] = {
      ...wrongPatient.evidenceRefs[0],
      patientId: 'patient-other',
    };
    expect(() =>
      MedicationReconciliationCopilotEngine.compute(
        wrongPatient,
        'enc-current'
      )
    ).toThrow('CI10E_EVIDENCE_SCOPE_MISMATCH');
  });

  test('artifact safety forbids every autonomous medication action', () => {
    const artifact = MedicationReconciliationCopilotService.build(
      snapshot(),
      'enc-current',
      'OPD',
      'doctor-ci10e',
      4_000
    );

    expect(artifact.safety).toEqual({
      sourceLinked: true,
      clinicianReviewRequired: true,
      canStartMedication: false,
      canStopMedication: false,
      canResumeMedication: false,
      canChangeDose: false,
      canCompleteReconciliation: false,
      canSignMedicationOrder: false,
      directClinicalMutationAllowed: false,
    });
  });

  test('evidence loader freezes orders, dispenses, administrations, reconciliation records, allergies and current CI-9 findings', async () => {
    const loader = await source(
      'lib/clinical/intelligence/medication-reconciliation-evidence-loader.ts'
    );
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    expect(loader).toContain("'medicationOrders'");
    expect(loader).toContain("'medicationDispenses'");
    expect(loader).toContain("'canonicalMedicationAdministrations'");
    expect(loader).toContain("'encounterEvidence'");
    expect(loader).toContain("'clinicalAllergies'");
    expect(loader).toContain('MedicationSafetyService.getProjection');
    expect(evidenceService).toContain(
      "purpose === 'MEDICATION_RECONCILIATION'"
    );
    expect(evidenceService).toContain(
      'MedicationReconciliationEvidenceLoader.load'
    );
  });

  test('artifact persistence is immutable, audited, outbox-evented and server-only', async () => {
    const service = await source(
      'lib/clinical/intelligence/medication-reconciliation-copilot-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(service).toContain(
      "collection('medicationReconciliationCopilotArtifacts')"
    );
    expect(service).toContain(
      "eventType: 'MEDICATION_RECONCILIATION_COPILOT_GENERATED'"
    );
    expect(service).toContain(
      "action: 'GENERATE_MEDICATION_RECONCILIATION_COPILOT'"
    );
    expect(service).toContain(
      "topic: 'g-hims-clinical-intelligence-events'"
    );

    const index = rules.indexOf(
      'match /medicationReconciliationCopilotArtifacts/{artifactId}'
    );
    expect(index).toBeGreaterThan(-1);
    expect(rules.slice(index, index + 190)).toContain(
      'allow read, write: if false'
    );
  });

  test('Patient 360 exposes CI-10E through the canonical copilot workspace and preserves human-authoritative completion', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );
    const view = await source(
      'components/patient360/Patient360View.tsx'
    );
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );
    const documentation = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(view).toContain('ClinicalCopilotWorkspace');
    expect(workspace).toContain('generateMedicationReconciliationCopilot');
    expect(workspace).toContain("'MEDICATIONS'");
    expect(workspace).toContain(
      'does not prove medication reconciliation is clinically'
    );
    expect(client).toContain(
      '/api/clinical/intelligence/medication-reconciliation'
    );
    expect(documentation).toContain(
      "eventType: 'MEDICATION_RECONCILIATION_COMPLETED'"
    );
    expect(documentation).toContain("requiredPrivilege: 'PRESCRIBE'");
    expect(documentation).toContain(
      "requiredPrivilege: 'DISPENSE_MEDICATION'"
    );
  });

  test('production pharmacy workflow does not seed demo dose, instructions or pharmacist identity', async () => {
    const pharmacy = await source(
      'components/opd/OpdPharmacyPrescriptions.tsx'
    );

    expect(pharmacy).toContain(
      "useState<string>(IS_DEMO_RUNTIME ? '40 mg' : '')"
    );
    expect(pharmacy).toContain(
      "IS_DEMO_RUNTIME ? 'Take with a full glass of water in the morning.' : ''"
    );
    expect(pharmacy).not.toContain('pharmacistName');
    expect(pharmacy).toContain(
      'Billing is posted from authoritative Item Master pricing at dispense.'
    );
    expect(pharmacy).toContain('setDosage(mapped[0].strength)');
  });

  test('CI-10E introduces no model-provider or medication mutation side door', async () => {
    const engine = await source(
      'lib/clinical/intelligence/medication-reconciliation-copilot-engine.ts'
    );
    const service = await source(
      'lib/clinical/intelligence/medication-reconciliation-copilot-service.ts'
    );
    const route = await source(
      'app/api/clinical/intelligence/medication-reconciliation/route.ts'
    );

    for (const forbidden of [
      '@google/genai',
      'openai',
      'anthropic',
      'generateContent',
      'chat.completions',
      'prescribeMedication(',
      'dispenseMedication(',
      'completeMedicationReconciliation(',
    ]) {
      expect(engine.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(service.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(route.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
