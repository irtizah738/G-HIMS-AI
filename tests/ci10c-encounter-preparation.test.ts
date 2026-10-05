import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalEncounterPreparationService } from '@/lib/clinical/intelligence/clinical-encounter-preparation-service';
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
  occurredAt?: number,
  status?: string
): ClinicalEvidenceRef {
  return {
    evidenceId,
    tenantId: 'tenant-ci10c',
    patientId: 'patient-ci10c',
    sourceType,
    sourceEntityId,
    label,
    status,
    occurredAt,
    patient360Revision: 20,
    patient360SourceCheckpoint: '3000:evt-latest',
    sourceEventIds: [`evt-${sourceEntityId}`],
    sourceEventCount: 1,
    sourceEventSetHash: `event-hash-${sourceEntityId}`,
    latestSourceEventId: `evt-${sourceEntityId}`,
    provenanceStatus: 'EVENT_VERIFIED',
    content,
    contentHash: `content-hash-${sourceEntityId}`,
  };
}

function snapshot(): ClinicalEvidenceSnapshot {
  return {
    snapshotId: 'cisnap-ci10c',
    tenantId: 'tenant-ci10c',
    patientId: 'patient-ci10c',
    purpose: 'ENCOUNTER_PREP',
    createdAt: 3_100,
    createdBy: 'doctor-ci10c',
    immutable: true,
    schemaVersion: 2,
    patient360ProjectionVersion: 2,
    patient360Revision: 20,
    patient360SourceCheckpoint: '3000:evt-latest',
    patient360ContentHash: 'p360-hash-ci10c',
    scope: {
      encounterId: 'enc-current',
      careSetting: 'OPD',
      actorId: 'doctor-ci10c',
      lastReviewedAt: 2_300,
      lastReviewedRevision: 18,
    },
    evidenceRefs: [
      evidence(
        'ev-current-encounter',
        'ENCOUNTER_CONTEXT',
        'enc-current',
        'OPD encounter preparation context',
        {
          encounter: {
            encounterId: 'enc-current',
            careSetting: 'OPD',
            encounterType: 'OPD',
            status: 'ACTIVE',
            department: 'General Medicine',
            chiefComplaint: 'Fatigue and poor glycaemic control',
            startedAt: 2_500,
          },
          relationship: 'PRIMARY_CONSULTANT',
          lastReviewedAt: 2_300,
          lastReviewedRevision: 18,
        },
        2_500
      ),
      evidence(
        'ev-prior-encounter',
        'ENCOUNTER_HISTORY',
        'enc-prior',
        'IPD',
        {
          encounterId: 'enc-prior',
          careSetting: 'IPD',
          encounterType: 'IPD',
          status: 'COMPLETED',
          startedAt: 1_000,
          completedAt: 1_500,
        },
        1_000
      ),
      evidence(
        'ev-active-condition',
        'CONDITION',
        'cond-active',
        'Type 2 diabetes mellitus',
        {
          display: 'Type 2 diabetes mellitus',
          code: '44054006',
          clinicalStatus: 'ACTIVE',
          verificationStatus: 'CONFIRMED',
        },
        1_700
      ),
      evidence(
        'ev-resolved-condition',
        'CONDITION',
        'cond-resolved',
        'Type 2 diabetes mellitus',
        {
          display: 'Type 2 diabetes mellitus',
          code: '44054006',
          clinicalStatus: 'RESOLVED',
          verificationStatus: 'CONFIRMED',
        },
        1_200
      ),
      evidence(
        'ev-allergy',
        'ALLERGY',
        'allergy-penicillin',
        'Penicillin',
        {
          criticality: 'HIGH',
          verificationStatus: 'CONFIRMED',
        },
        900
      ),
      evidence(
        'ev-knowledge',
        'KNOWLEDGE_STATUS',
        'patient-ci10c:knowledge-status',
        'Patient clinical knowledge status',
        {
          allergyKnowledge: 'KNOWN_NONE',
          problemListKnowledge: 'KNOWN',
          medicationKnowledge: 'NOT_ASSESSED',
          missingCanonicalFacts: ['HOME_MEDICATION_HISTORY'],
        },
        2_000
      ),
      evidence(
        'ev-med-active',
        'MEDICATION_HISTORY',
        'med-metformin',
        'Metformin',
        {
          status: 'ACTIVE',
          dosageText: '500 mg twice daily',
          authoredAt: 1_800,
        },
        1_800
      ),
      evidence(
        'ev-med-change',
        'MEDICATION_HISTORY',
        'med-gliclazide',
        'Gliclazide',
        {
          status: 'STOPPED',
          dosageText: '80 mg daily',
          authoredAt: 2_100,
        },
        2_100
      ),
      evidence(
        'ev-a1c',
        'OBSERVATION_HISTORY',
        'obs-a1c',
        'HbA1c',
        {
          status: 'FINAL',
          effectiveAt: 2_200,
          value: {
            valueType: 'QUANTITY',
            quantity: { value: 9.2, unit: '%' },
          },
          interpretation: [{ text: 'HIGH' }],
        },
        2_200
      ),
      evidence(
        'ev-report',
        'DIAGNOSTIC_REPORT_HISTORY',
        'report-a1c',
        'HbA1c report',
        {
          status: 'FINAL',
          issuedAt: 2_200,
          conclusion: 'HbA1c 9.2%',
        },
        2_200
      ),
      evidence(
        'ev-change',
        'CONSULTANT_CHANGE',
        'change-1',
        'New diagnostic result available',
        {
          eventId: 'evt-result',
          eventType: 'DIAGNOSTIC_RESULT_VERIFIED',
          category: 'DIAGNOSTICS',
          severity: 'ACTION_REQUIRED',
          statement: 'New HbA1c result verified.',
          occurredAt: 2_200,
        },
        2_200,
        'ACTION_REQUIRED'
      ),
      evidence(
        'ev-open-diagnostic',
        'CLINICAL_OPEN_ITEM',
        'open-diagnostic',
        'Pending renal function panel',
        {
          category: 'DIAGNOSTIC',
          description: 'Pending diagnostic order: Renal function panel',
          clinicalPriority: 'REVIEW_REQUIRED',
          status: 'OPEN',
          sourceRefs: ['order-rft'],
        },
        2_250,
        'REVIEW_REQUIRED/OPEN'
      ),
      evidence(
        'ev-open-data-quality',
        'CLINICAL_OPEN_ITEM',
        'open-data-quality',
        'Medication history incomplete',
        {
          category: 'DATA_QUALITY',
          description: 'Clinical knowledge incomplete: medication history',
          clinicalPriority: 'ACTION_REQUIRED',
          status: 'OPEN',
          sourceRefs: ['MEDICATION_HISTORY'],
        },
        2_260,
        'ACTION_REQUIRED/OPEN'
      ),
      evidence(
        'ev-med-safety',
        'MEDICATION_SAFETY_FINDING',
        'medsafe-1',
        'Medication reconciliation required for this care context',
        {
          type: 'MEDICATION_RECONCILIATION_REQUIRED',
          severity: 'ACTION_REQUIRED',
          title: 'Medication reconciliation required for this care context',
          description:
            'No medication reconciliation checkpoint exists after the current encounter began.',
        },
        2_550,
        'ACTION_REQUIRED'
      ),
      evidence(
        'ev-med-conflict',
        'MEDICATION_SAFETY_FINDING',
        'medsafe-2',
        'Active medication matches a documented medication allergy',
        {
          type: 'MEDICATION_ALLERGY_CONFLICT',
          severity: 'CRITICAL_REVIEW_REQUIRED',
          title: 'Active medication matches a documented medication allergy',
          description:
            'Exact coded/name evidence requires immediate clinician review.',
        },
        2_560,
        'CRITICAL_REVIEW_REQUIRED'
      ),
    ],
    evidenceCount: 15,
    sourceEventCount: 15,
    coverage: {
      encounters: { status: 'COMPLETE', recordCount: 2 },
      medicationOrders: { status: 'COMPLETE', recordCount: 2 },
      observations: { status: 'COMPLETE', recordCount: 1 },
      diagnosticReports: { status: 'COMPLETE', recordCount: 1 },
      diagnosticOrders: { status: 'COMPLETE', recordCount: 1 },
      procedures: { status: 'COMPLETE', recordCount: 0 },
      carePlans: { status: 'COMPLETE', recordCount: 0 },
      consultantChanges: { status: 'COMPLETE', recordCount: 1 },
      clinicalOpenItems: { status: 'COMPLETE', recordCount: 2 },
      medicationSafetyFindings: { status: 'COMPLETE', recordCount: 2 },
    },
    dateRange: { from: 900, to: 2_560 },
    snapshotHash: 'snapshot-hash-ci10c',
    limitations: [
      'Missing or incomplete source data must not be interpreted as clinical absence.',
    ],
  };
}

describe('CI-10C encounter preparation intelligence', () => {
  test('builds the complete encounter-preparation brief from frozen encounter evidence', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );

    expect(brief.encounterId).toBe('enc-current');
    expect(brief.previousEncounterId).toBe('enc-prior');
    expect(brief.previousEncounterAt).toBe(1_500);
    expect(brief.attentionLevel).toBe('CRITICAL_REVIEW_REQUIRED');

    expect(new Set(brief.sections.map((item) => item.sectionId))).toEqual(
      new Set([
        'REASON_FOR_VISIT',
        'ACTIVE_PROBLEMS',
        'CHANGES_SINCE_LAST_ENCOUNTER',
        'NEW_ABNORMAL_INVESTIGATIONS',
        'MEDICATION_CHANGES',
        'OUTSTANDING_WORK',
        'RECENT_ADMISSION_DISCHARGE',
        'CONTRADICTIONS',
        'MEDICATION_DISCREPANCIES',
        'MISSING_INFORMATION',
      ])
    );
  });

  test('surfaces the recorded reason for visit without fabricating a chief complaint', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );
    const section = brief.sections.find(
      (item) => item.sectionId === 'REASON_FOR_VISIT'
    )!;

    expect(section.state).toBe('SUPPORTED');
    expect(section.claims.some((item) =>
      item.text.includes('Fatigue and poor glycaemic control')
    )).toBe(true);

    const withoutReason = snapshot();
    const encounter = withoutReason.evidenceRefs.find(
      (item) => item.sourceType === 'ENCOUNTER_CONTEXT'
    )!;
    encounter.content = {
      ...(encounter.content as Record<string, unknown>),
      encounter: {
        encounterId: 'enc-current',
        careSetting: 'OPD',
        status: 'ACTIVE',
        startedAt: 2_500,
      },
    };

    const noReasonBrief = ClinicalEncounterPreparationService.build(
      withoutReason,
      'doctor-ci10c',
      4_000
    );
    const noReasonSection = noReasonBrief.sections.find(
      (item) => item.sectionId === 'REASON_FOR_VISIT'
    )!;
    expect(noReasonSection.state).toBe('REVIEW_REQUIRED');
    expect(noReasonSection.caveats.join(' ')).toContain(
      'No chief complaint or reason-for-visit text'
    );
  });

  test('uses the previous encounter as the change baseline and does not label older records as new', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );
    const changes = brief.sections.find(
      (item) => item.sectionId === 'CHANGES_SINCE_LAST_ENCOUNTER'
    )!;

    expect(changes.claims.some((item) => item.text.includes('Gliclazide'))).toBe(true);
    expect(
      changes.claims.some((item) =>
        item.evidenceRefs.includes('ev-resolved-condition')
      )
    ).toBe(false);
  });

  test('reports source-marked abnormal investigations without inferring diagnosis or treatment', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );
    const abnormal = brief.sections.find(
      (item) => item.sectionId === 'NEW_ABNORMAL_INVESTIGATIONS'
    )!;

    const a1c = abnormal.claims.find((item) =>
      item.evidenceRefs.includes('ev-a1c')
    );
    expect(a1c?.text).toContain('source-marked HIGH');
    expect(a1c?.caveat).toContain(
      'clinical significance is not independently inferred'
    );
    expect(
      abnormal.claims.some((item) => /diagnosis|start medication|treat with/i.test(item.text))
    ).toBe(false);
  });

  test('surfaces deterministic contradictions and medication-safety discrepancies', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );
    const contradictions = brief.sections.find(
      (item) => item.sectionId === 'CONTRADICTIONS'
    )!;
    const medication = brief.sections.find(
      (item) => item.sectionId === 'MEDICATION_DISCREPANCIES'
    )!;

    expect(
      contradictions.claims.some((item) =>
        item.text.includes('both ACTIVE and RESOLVED')
      )
    ).toBe(true);
    expect(
      contradictions.claims.some((item) =>
        item.text.includes('allergy knowledge contradiction')
      )
    ).toBe(true);
    expect(
      medication.claims.some((item) =>
        item.text.includes('Medication reconciliation required')
      )
    ).toBe(true);
    expect(
      medication.claims.some(
        (item) => item.attention === 'CRITICAL_REVIEW_REQUIRED'
      )
    ).toBe(true);
  });

  test('makes explicit missing knowledge visible without converting it into a clinical negative', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );
    const missing = brief.sections.find(
      (item) => item.sectionId === 'MISSING_INFORMATION'
    )!;

    expect(
      missing.claims.some((item) =>
        item.text.includes('Medication knowledge is NOT_ASSESSED')
      )
    ).toBe(true);
    expect(
      missing.claims.some((item) =>
        item.text.includes('home medication history')
      )
    ).toBe(true);
  });

  test('every emitted claim is accepted by the CI-10A grounding validator', () => {
    const input = snapshot();
    const brief = ClinicalEncounterPreparationService.build(
      input,
      'doctor-ci10c',
      4_000
    );
    const claims = brief.sections.flatMap((item) => item.claims);
    const grounding = ClinicalEvidenceService.validateClaims(input, claims);

    expect(grounding.valid).toBe(true);
    expect(claims.every((item) => item.evidenceRefs.length > 0)).toBe(true);
  });

  test('encounter preparation is actor scoped and cannot be replayed as another clinician', () => {
    expect(() =>
      ClinicalEncounterPreparationService.build(
        snapshot(),
        'doctor-other',
        4_000
      )
    ).toThrow('CI10C_ACTOR_SCOPE_MISMATCH');
  });

  test('safety contract forbids autonomous care and note prefilling', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'doctor-ci10c',
      4_000
    );

    expect(brief.safety).toEqual({
      sourceLinked: true,
      clinicianReviewRequired: true,
      autonomousDiagnosisAllowed: false,
      autonomousTreatmentAllowed: false,
      autonomousOrdersAllowed: false,
      directClinicalMutationAllowed: false,
      notePrefillAllowed: false,
    });
  });

  test('wrong-purpose snapshots fail closed', () => {
    const input = snapshot();
    input.purpose = 'LONGITUDINAL_SUMMARY';

    expect(() =>
      ClinicalEncounterPreparationService.build(
        input,
        'doctor-ci10c',
        4_000
      )
    ).toThrow('CI10C_EVIDENCE_PURPOSE_MISMATCH');
  });

  test('encounter evidence loader freezes consultant deltas, unresolved work and CI-9 findings', async () => {
    const loader = await source(
      'lib/clinical/intelligence/encounter-preparation-evidence-loader.ts'
    );
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    expect(loader).toContain('ConsultantVisibilityService.buildForActor');
    expect(loader).toContain('MedicationSafetyService.evaluateProjection');
    expect(loader).toContain('CI10C_CONTEXT_REVISION_RACE');
    expect(loader).toContain("sourceType: 'CONSULTANT_CHANGE'");
    expect(loader).toContain("sourceType: 'CLINICAL_OPEN_ITEM'");
    expect(loader).toContain("sourceType: 'MEDICATION_SAFETY_FINDING'");
    expect(evidenceService).toContain(
      "purpose === 'ENCOUNTER_PREP'"
    );
    expect(evidenceService).toContain('EncounterPreparationEvidenceLoader.load');
    expect(evidenceService).toContain('scope: supplemental?.scope');
    expect(evidenceService).toContain('scope: snapshot.scope');
  });

  test('consultation no longer contains fabricated patient facts or simulated AI chart insertion', async () => {
    const consultation = await source(
      'components/opd/OpdConsultationSpecialties.tsx'
    );

    for (const forbidden of [
      'Patient reports 3-week history',
      'Decompensated Heart Failure',
      'Initiate Oral Loop Diuretic',
      'Known Allergy Alert: Penicillin',
      'ACC/AHA Heart Failure 2026',
      'handleSimulateAiCopilot',
      'AI Differential Proposals',
      '[Clinician-Reviewed AI Suggestion]',
      'Synthesize Clinical Differential',
    ]) {
      expect(consultation).not.toContain(forbidden);
    }

    expect(consultation).toContain('EncounterPreparationPanel');
    expect(consultation).toContain("encounter.soap?.subjective || ''");
    expect(consultation).toContain("encounter.soap?.assessment || ''");
    expect(consultation).toContain("encounter.soap?.plan || ''");
  });

  test('clinical note signing rejects empty SOAP shells and encounter-patient mismatch server-side', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain(
      'section labels alone cannot be signed'
    );
    expect(service).toContain(
      "code: 'ENCOUNTER_PATIENT_MISMATCH'"
    );
    expect(service).toContain(
      "String(encounter.patientId || '') !== payload.patientId"
    );
  });

  test('API and persistence preserve patient/encounter ABAC, immutability, audit and server-only storage', async () => {
    const route = await source(
      'app/api/clinical/intelligence/encounter-preparation/route.ts'
    );
    const service = await source(
      'lib/clinical/intelligence/clinical-encounter-preparation-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('assertPatient360PatientAccess');
    expect(route).toContain('ENCOUNTER_PATIENT_MISMATCH');
    expect(service).toContain(
      "collection('clinicalEncounterPreparationBriefs')"
    );
    expect(service).toContain('transaction.create(briefRef');
    expect(service).toContain(
      "eventType: 'CLINICAL_ENCOUNTER_PREPARATION_GENERATED'"
    );
    expect(service).toContain(
      "action: 'GENERATE_CLINICAL_ENCOUNTER_PREPARATION'"
    );
    expect(service).toContain(
      "topic: 'g-hims-clinical-intelligence-events'"
    );

    const ruleIndex = rules.indexOf(
      'match /clinicalEncounterPreparationBriefs/{briefId}'
    );
    expect(ruleIndex).toBeGreaterThan(-1);
    expect(rules.slice(ruleIndex, ruleIndex + 190)).toContain(
      'allow read, write: if false'
    );
  });

  test('CI-10C stays deterministic and provider neutral', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-encounter-preparation-service.ts'
    );
    const route = await source(
      'app/api/clinical/intelligence/encounter-preparation/route.ts'
    );

    for (const forbidden of [
      '@google/genai',
      'openai',
      'anthropic',
      'generateContent',
      'chat.completions',
    ]) {
      expect(service.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(route.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
