import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalLongitudinalSummaryService } from '@/lib/clinical/intelligence/clinical-longitudinal-summary-service';
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
  provenanceStatus: ClinicalEvidenceRef['provenanceStatus'] = 'EVENT_VERIFIED'
): ClinicalEvidenceRef {
  return {
    evidenceId,
    tenantId: 'tenant-ci10b',
    patientId: 'patient-ci10b',
    sourceType,
    sourceEntityId,
    label,
    occurredAt,
    patient360Revision: 12,
    patient360SourceCheckpoint: '2500:evt-latest',
    sourceEventIds:
      provenanceStatus === 'EVENT_VERIFIED' ? [`evt-${sourceEntityId}`] : [],
    sourceEventCount: provenanceStatus === 'EVENT_VERIFIED' ? 1 : 0,
    sourceEventSetHash: `eventhash-${sourceEntityId}`,
    latestSourceEventId:
      provenanceStatus === 'EVENT_VERIFIED'
        ? `evt-${sourceEntityId}`
        : undefined,
    provenanceStatus,
    content,
    contentHash: `contenthash-${sourceEntityId}`,
  };
}

function snapshot(): ClinicalEvidenceSnapshot {
  return {
    snapshotId: 'cisnap-ci10b',
    tenantId: 'tenant-ci10b',
    patientId: 'patient-ci10b',
    purpose: 'LONGITUDINAL_SUMMARY',
    createdAt: 3_000,
    createdBy: 'doctor-ci10b',
    immutable: true,
    schemaVersion: 2,
    patient360ProjectionVersion: 2,
    patient360Revision: 12,
    patient360SourceCheckpoint: '2500:evt-latest',
    patient360ContentHash: 'p360-hash-ci10b',
    evidenceRefs: [
      evidence(
        'ev-knowledge',
        'KNOWLEDGE_STATUS',
        'patient-ci10b:knowledge-status',
        'Patient clinical knowledge status',
        {
          allergyKnowledge: 'KNOWN',
          problemListKnowledge: 'KNOWN',
          medicationKnowledge: 'KNOWN',
          missingCanonicalFacts: [],
        }
      ),
      evidence(
        'ev-active-problem',
        'CONDITION',
        'condition-active',
        'Type 2 diabetes mellitus',
        {
          clinicalStatus: 'ACTIVE',
          verificationStatus: 'CONFIRMED',
          onsetAt: 500,
        },
        500
      ),
      evidence(
        'ev-past-problem',
        'CONDITION',
        'condition-resolved',
        'Community acquired pneumonia',
        {
          clinicalStatus: 'RESOLVED',
          verificationStatus: 'CONFIRMED',
          onsetAt: 400,
        },
        400
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
        450
      ),
      evidence(
        'ev-med-active',
        'MEDICATION_HISTORY',
        'med-metformin',
        'Metformin',
        {
          status: 'ACTIVE',
          dosageText: '500 mg',
          frequency: 'BD',
          authoredAt: 1_100,
        },
        1_100
      ),
      evidence(
        'ev-med-stopped',
        'MEDICATION_HISTORY',
        'med-amoxicillin',
        'Amoxicillin',
        {
          status: 'STOPPED',
          dosageText: '500 mg',
          authoredAt: 900,
        },
        900
      ),
      evidence(
        'ev-a1c-old',
        'OBSERVATION_HISTORY',
        'obs-a1c-old',
        'HbA1c',
        {
          status: 'FINAL',
          effectiveAt: 1_000,
          code: {
            text: 'HbA1c',
            codings: [
              { system: 'LOINC', code: '4548-4', display: 'HbA1c' },
            ],
          },
          value: {
            valueType: 'QUANTITY',
            quantity: {
              value: 7.1,
              unit: '%',
              system: 'UCUM',
              code: '%',
            },
          },
          interpretation: [{ text: 'HIGH' }],
        },
        1_000
      ),
      evidence(
        'ev-a1c-new',
        'OBSERVATION_HISTORY',
        'obs-a1c-new',
        'HbA1c',
        {
          status: 'FINAL',
          effectiveAt: 2_000,
          code: {
            text: 'HbA1c',
            codings: [
              { system: 'LOINC', code: '4548-4', display: 'HbA1c' },
            ],
          },
          value: {
            valueType: 'QUANTITY',
            quantity: {
              value: 8.4,
              unit: '%',
              system: 'UCUM',
              code: '%',
            },
          },
          interpretation: [{ text: 'HIGH' }],
        },
        2_000
      ),
      evidence(
        'ev-report',
        'DIAGNOSTIC_REPORT_HISTORY',
        'report-a1c',
        'HbA1c report',
        {
          status: 'FINAL',
          issuedAt: 2_050,
          conclusion: 'HbA1c 8.4%',
        },
        2_050
      ),
      evidence(
        'ev-order',
        'DIAGNOSTIC_ORDER',
        'order-renal-panel',
        'Renal function panel',
        {
          status: 'ACTIVE',
          priority: 'ROUTINE',
          orderedAt: 2_100,
        },
        2_100
      ),
      evidence(
        'ev-procedure',
        'PROCEDURE',
        'procedure-echo',
        'Echocardiography',
        {
          status: 'COMPLETED',
          performedAt: 1_500,
        },
        1_500
      ),
      evidence(
        'ev-encounter',
        'ENCOUNTER_HISTORY',
        'enc-ipd',
        'IPD',
        {
          careSetting: 'IPD',
          status: 'COMPLETED',
          startedAt: 1_200,
          completedAt: 1_800,
        },
        1_200
      ),
      evidence(
        'ev-careplan',
        'CARE_PLAN',
        'careplan-1',
        'Diabetes follow-up',
        {
          status: 'ACTIVE',
          authoredAt: 2_200,
          activities: [
            {
              activityId: 'activity-1',
              description: 'Repeat HbA1c',
              status: 'SCHEDULED',
              scheduledAt: 4_000,
              responsibleRole: 'DOCTOR',
            },
          ],
        },
        2_200,
        'PROJECTION_ONLY'
      ),
    ],
    evidenceCount: 13,
    sourceEventCount: 12,
    coverage: {
      encounters: { status: 'COMPLETE', recordCount: 1 },
      medicationOrders: { status: 'COMPLETE', recordCount: 2 },
      observations: { status: 'COMPLETE', recordCount: 2 },
      diagnosticReports: { status: 'COMPLETE', recordCount: 1 },
      diagnosticOrders: { status: 'COMPLETE', recordCount: 1 },
      procedures: { status: 'COMPLETE', recordCount: 1 },
      carePlans: { status: 'COMPLETE', recordCount: 1 },
    },
    dateRange: { from: 400, to: 2_200 },
    snapshotHash: 'snapshot-hash-ci10b',
    limitations: [
      'Missing or incomplete source data must not be interpreted as clinical absence.',
    ],
  };
}

describe('CI-10B longitudinal clinical summary', () => {
  test('builds all required source-linked clinical snapshot sections', () => {
    const input = snapshot();
    const summary = ClinicalLongitudinalSummaryService.build(
      input,
      'doctor-ci10b',
      5_000
    );

    const sectionIds = new Set(summary.sections.map((item) => item.sectionId));
    expect(sectionIds).toEqual(
      new Set([
        'ACTIVE_PROBLEMS',
        'PAST_PROBLEMS',
        'ALLERGIES',
        'CURRENT_MEDICATIONS',
        'MEDICATION_CHANGES',
        'PROCEDURES',
        'DIAGNOSTICS',
        'ABNORMAL_TRENDS',
        'ENCOUNTERS_ADMISSIONS',
        'OUTSTANDING_INVESTIGATIONS',
        'FOLLOW_UP',
        'DATA_QUALITY',
      ])
    );

    expect(
      summary.sections
        .find((item) => item.sectionId === 'ACTIVE_PROBLEMS')
        ?.claims[0]?.text
    ).toContain('Type 2 diabetes mellitus');
    expect(
      summary.sections
        .find((item) => item.sectionId === 'OUTSTANDING_INVESTIGATIONS')
        ?.claims[0]?.text
    ).toContain('Renal function panel');
    expect(
      summary.sections
        .find((item) => item.sectionId === 'FOLLOW_UP')
        ?.claims[0]?.text
    ).toContain('Repeat HbA1c');
  });

  test('all emitted clinical claims pass the CI-10A evidence grounding validator', () => {
    const input = snapshot();
    const summary = ClinicalLongitudinalSummaryService.build(
      input,
      'doctor-ci10b',
      5_000
    );
    const claims = summary.sections.flatMap((item) => item.claims);

    const grounding = ClinicalEvidenceService.validateClaims(input, claims);
    expect(grounding.valid).toBe(true);
    expect(
      claims.every((item) => item.evidenceRefs.length > 0)
    ).toBe(true);
  });

  test('numeric trend statements remain descriptive and evidence-linked', () => {
    const summary = ClinicalLongitudinalSummaryService.build(
      snapshot(),
      'doctor-ci10b',
      5_000
    );
    const trend = summary.sections
      .find((item) => item.sectionId === 'ABNORMAL_TRENDS')
      ?.claims.find((item) => item.classification === 'TREND');

    expect(trend?.text).toContain('changed from 7.1 % to 8.4 %');
    expect(trend?.evidenceRefs.sort()).toEqual(
      ['ev-a1c-new', 'ev-a1c-old'].sort()
    );
    expect(trend?.caveat).toContain('clinical significance is not inferred');
  });

  test('missing procedure evidence is described as coverage, never as a negative clinical fact', () => {
    const input = snapshot();
    input.evidenceRefs = input.evidenceRefs.filter(
      (item) => item.sourceType !== 'PROCEDURE'
    );
    input.coverage = {
      ...(input.coverage || {}),
      procedures: { status: 'COMPLETE', recordCount: 0 },
    };

    const summary = ClinicalLongitudinalSummaryService.build(
      input,
      'doctor-ci10b',
      5_000
    );
    const procedures = summary.sections.find(
      (item) => item.sectionId === 'PROCEDURES'
    )!;

    expect(procedures.state).toBe('NO_REPRESENTED_DATA');
    expect(procedures.claims).toHaveLength(0);
    expect(procedures.caveats.join(' ')).toContain(
      'not proof that no procedure occurred'
    );
    expect(
      summary.sections
        .flatMap((item) => item.claims)
        .some((item) => /no procedure/i.test(item.text))
    ).toBe(false);
  });

  test('explicit known-none status can support a negative-history statement safely', () => {
    const input = snapshot();
    input.evidenceRefs = input.evidenceRefs.filter(
      (item) => item.sourceType !== 'ALLERGY'
    );
    const knowledge = input.evidenceRefs.find(
      (item) => item.sourceType === 'KNOWLEDGE_STATUS'
    )!;
    knowledge.content = {
      ...(knowledge.content as Record<string, unknown>),
      allergyKnowledge: 'KNOWN_NONE',
    };

    const summary = ClinicalLongitudinalSummaryService.build(
      input,
      'doctor-ci10b',
      5_000
    );
    const allergyClaim = summary.sections
      .find((item) => item.sectionId === 'ALLERGIES')
      ?.claims[0];

    expect(allergyClaim?.text).toContain('reviewed with none known');
    expect(allergyClaim?.evidenceRefs).toEqual(['ev-knowledge']);
  });

  test('summary safety contract forbids autonomous diagnosis, treatment, orders and direct mutation', () => {
    const summary = ClinicalLongitudinalSummaryService.build(
      snapshot(),
      'doctor-ci10b',
      5_000
    );

    expect(summary.safety).toEqual({
      sourceLinked: true,
      clinicianReviewRequired: true,
      autonomousDiagnosisAllowed: false,
      autonomousTreatmentAllowed: false,
      autonomousOrdersAllowed: false,
      directClinicalMutationAllowed: false,
    });
    expect(summary.generationMode).toBe(
      'DETERMINISTIC_EVIDENCE_SYNTHESIS'
    );
  });

  test('wrong-purpose evidence snapshots fail closed', () => {
    const input = snapshot();
    input.purpose = 'ENCOUNTER_PREP';

    expect(() =>
      ClinicalLongitudinalSummaryService.build(
        input,
        'doctor-ci10b',
        5_000
      )
    ).toThrow('CI10B_EVIDENCE_PURPOSE_MISMATCH');
  });

  test('longitudinal evidence loader covers the missing canonical Patient 360 domains', async () => {
    const loader = await source(
      'lib/clinical/intelligence/longitudinal-evidence-loader.ts'
    );
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    for (const collection of [
      "'encounters'",
      "'medicationOrders'",
      "'clinicalObservations'",
      "'diagnosticReports'",
      "'canonicalDiagnosticOrders'",
      "'clinicalProcedures'",
      "'carePlans'",
    ]) {
      expect(loader).toContain(collection);
    }
    expect(loader).toContain('queryAllEqual');
    expect(evidenceService).toContain(
      "purpose === 'LONGITUDINAL_SUMMARY'"
    );
    expect(evidenceService).toContain('LongitudinalEvidenceLoader.load');
    expect(evidenceService).toContain('schemaVersion: supplemental ? 2 : 1');
  });

  test('summary persistence is immutable, audited and server-only', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-longitudinal-summary-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(service).toContain(
      "collection('clinicalLongitudinalSummaries')"
    );
    expect(service).toContain('transaction.create(summaryRef');
    expect(service).toContain(
      "eventType: 'CLINICAL_LONGITUDINAL_SUMMARY_GENERATED'"
    );
    expect(service).toContain(
      "action: 'GENERATE_CLINICAL_LONGITUDINAL_SUMMARY'"
    );
    expect(service).toContain(
      "topic: 'g-hims-clinical-intelligence-events'"
    );

    const ruleIndex = rules.indexOf(
      'match /clinicalLongitudinalSummaries/{summaryId}'
    );
    expect(ruleIndex).toBeGreaterThan(-1);
    expect(rules.slice(ruleIndex, ruleIndex + 180)).toContain(
      'allow read, write: if false'
    );
  });

  test('API and canonical Patient 360 workspace enforce authenticated evidence inspection rather than direct Firestore access', async () => {
    const route = await source(
      'app/api/clinical/intelligence/longitudinal-summary/route.ts'
    );
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );
    const evidence = await source(
      'components/patient360/ClinicalCopilotEvidencePanel.tsx'
    );
    const view = await source(
      'components/patient360/Patient360View.tsx'
    );

    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('assertPatient360PatientAccess');
    expect(route).toContain('ClinicalLongitudinalSummaryService');
    expect(route).toContain('ClinicalEvidenceService.getSnapshot');
    expect(workspace).toContain('generateLongitudinalClinicalSummary');
    expect(workspace).toContain(
      'CI-10G will not generate new summaries, trends'
    );
    expect(evidence).toContain('sourceEventIds');
    expect(evidence).toContain('contentHash');
    expect(evidence).toContain('JSON.stringify(item.content');
    expect(view).toContain('ClinicalCopilotWorkspace');
  });

  test('CI-10B remains provider-neutral and does not add a model side door', async () => {
    const summaryService = await source(
      'lib/clinical/intelligence/clinical-longitudinal-summary-service.ts'
    );
    const route = await source(
      'app/api/clinical/intelligence/longitudinal-summary/route.ts'
    );

    for (const forbidden of [
      '@google/genai',
      'openai',
      'anthropic',
      'generateContent',
      'chat.completions',
    ]) {
      expect(summaryService.toLowerCase()).not.toContain(
        forbidden.toLowerCase()
      );
      expect(route.toLowerCase()).not.toContain(
        forbidden.toLowerCase()
      );
    }
  });
});
