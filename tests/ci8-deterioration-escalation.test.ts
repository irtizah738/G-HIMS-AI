import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalDeteriorationEngine } from '@/lib/clinical/intelligence/clinical-deterioration-engine';
import type { DeteriorationSnapshot } from '@/types/clinical-deterioration';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

function baseSnapshot(): DeteriorationSnapshot {
  const now = 1_800_000_000_000;
  return {
    tenantId: 'tenant-ci8',
    patientId: 'patient-ci8',
    encounterId: 'enc-ci8',
    patient360: {
      revision: 10,
      sourceCheckpoint: '1799999999000:evt-vitals',
      lastEventId: 'evt-vitals',
      lastEventRecordedAt: 1_799_999_999_000,
      activeEncounter: {
        encounterId: 'enc-ci8',
        encounterType: 'IPD',
        status: 'ACTIVE',
      },
      dataQuality: {
        allergyKnowledge: 'KNOWN_NONE',
        problemListKnowledge: 'KNOWN',
        medicationKnowledge: 'KNOWN',
        hasUnverifiedAllergies: false,
        hasUnverifiedProblems: false,
        hasPreliminaryResults: false,
        missingCanonicalFacts: [],
      },
    },
    encounter: {
      encounterId: 'enc-ci8',
      encounterType: 'IPD',
      status: 'ACTIVE',
    },
    encounterEvidence: [
      {
        evidenceId: 'vitals-latest',
        evidenceType: 'VITALS',
        status: 'FINAL',
        news2Status: 'VERIFIED',
        news2Score: 1,
        measuredAt: now - 15 * 60 * 1000,
      },
    ],
    diagnosticResults: [],
    clinicalObservations: [],
    diagnosticAcknowledgements: [],
  };
}

describe('G-HIMS CI-8 Clinical Deterioration & Escalation Intelligence', () => {
  test('low verified NEWS2 remains stable without fabricating deterioration', () => {
    const snapshot = baseSnapshot();
    const result = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('STABLE');
    expect(result.critical).toHaveLength(0);
    expect(result.escalations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.information.map((item) => item.code)).toContain(
      'CLINICIAN_DECISION_REQUIRED'
    );
    expect(result.rulesetVersion).toBe('CI8-DE-1.0.0');
  });

  test('NEWS2 watch, escalation and critical thresholds are deterministic', () => {
    const watch = baseSnapshot();
    watch.encounterEvidence[0].news2Score = 3;
    expect(
      ClinicalDeteriorationEngine.evaluate(watch, 1_800_000_000_000).state
    ).toBe('WATCH');

    const escalation = baseSnapshot();
    escalation.encounterEvidence[0].news2Score = 5;
    expect(
      ClinicalDeteriorationEngine.evaluate(
        escalation,
        1_800_000_000_000
      ).state
    ).toBe('ESCALATION_REQUIRED');

    const critical = baseSnapshot();
    critical.encounterEvidence[0].news2Score = 7;
    expect(
      ClinicalDeteriorationEngine.evaluate(
        critical,
        1_800_000_000_000
      ).state
    ).toBe('CRITICAL_REVIEW_REQUIRED');
  });

  test('rapid verified NEWS2 rise is source-linked escalation evidence', () => {
    const snapshot = baseSnapshot();
    snapshot.encounterEvidence = [
      {
        evidenceId: 'vitals-new',
        evidenceType: 'VITALS',
        status: 'FINAL',
        news2Status: 'VERIFIED',
        news2Score: 5,
        measuredAt: 1_799_999_900_000,
      },
      {
        evidenceId: 'vitals-old',
        evidenceType: 'VITALS',
        status: 'FINAL',
        news2Status: 'VERIFIED',
        news2Score: 2,
        measuredAt: 1_799_990_000_000,
      },
    ];

    const result = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );
    const finding = result.escalations.find(
      (item) => item.code === 'NEWS2_RAPID_RISE'
    );

    expect(result.state).toBe('ESCALATION_REQUIRED');
    expect(finding?.evidence.map((item) => item.entityId)).toEqual([
      'vitals-new',
      'vitals-old',
    ]);
  });

  test('unverified or absent vitals never produce false stable state', () => {
    const unverified = baseSnapshot();
    unverified.encounterEvidence[0].news2Status = 'CALCULATED';
    expect(
      ClinicalDeteriorationEngine.evaluate(
        unverified,
        1_800_000_000_000
      ).state
    ).toBe('WATCH');

    const absent = baseSnapshot();
    absent.encounterEvidence = [];
    const result = ClinicalDeteriorationEngine.evaluate(
      absent,
      1_800_000_000_000
    );
    expect(result.state).toBe('WATCH');
    expect(result.warnings.map((item) => item.code)).toContain(
      'NO_CURRENT_VITALS'
    );
  });

  test('stale vitals are a watch condition rather than an inferred stable state', () => {
    const snapshot = baseSnapshot();
    snapshot.encounterEvidence[0].measuredAt =
      1_800_000_000_000 - 5 * 60 * 60 * 1000;

    const result = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('WATCH');
    expect(result.warnings.map((item) => item.code)).toContain('VITALS_STALE');
  });

  test('single-parameter red trigger is critical regardless of low aggregate NEWS2', () => {
    const snapshot = baseSnapshot();
    snapshot.encounterEvidence[0].news2Score = 2;
    snapshot.encounterEvidence[0].news2RedTrigger = true;

    const result = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('CRITICAL_REVIEW_REQUIRED');
    expect(result.critical.map((item) => item.code)).toContain(
      'NEWS2_SINGLE_PARAMETER_RED_TRIGGER'
    );
  });

  test('unacknowledged critical diagnostic result is critical and exact acknowledgement clears it', () => {
    const snapshot = baseSnapshot();
    snapshot.clinicalObservations = [
      {
        observationId: 'obs-critical-k',
        status: 'FINAL',
        interpretation: [
          {
            codings: [
              {
                system: 'LOCAL',
                code: 'INTERP_HH',
                display: 'Critical high',
              },
            ],
          },
        ],
      },
    ];
    snapshot.diagnosticResults = [
      {
        diagnosticResultId: 'report-critical-k',
        reportId: 'report-critical-k',
        status: 'FINAL',
        reportDisplay: 'Potassium',
        resultObservationIds: ['obs-critical-k'],
      },
    ];

    const blocked = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );
    expect(blocked.state).toBe('CRITICAL_REVIEW_REQUIRED');
    expect(blocked.critical.map((item) => item.code)).toContain(
      'CRITICAL_RESULT_UNACKNOWLEDGED'
    );

    snapshot.diagnosticAcknowledgements = [
      {
        acknowledgementId: 'ack-critical-k',
        reportId: 'report-critical-k',
        acknowledgedBy: 'doctor-a',
        acknowledgedAt: 1_799_999_950_000,
        immutable: true,
      },
    ];

    const acknowledged = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );
    expect(
      acknowledged.critical.map((item) => item.code)
    ).not.toContain('CRITICAL_RESULT_UNACKNOWLEDGED');
    expect(acknowledged.state).toBe('STABLE');
  });

  test('closed encounters are not active deterioration-intelligence targets', () => {
    const snapshot = baseSnapshot();
    snapshot.encounter.status = 'DISCHARGED';
    snapshot.patient360.activeEncounter!.status = 'DISCHARGED';

    const result = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('NOT_APPLICABLE');
    expect(result.critical).toHaveLength(0);
    expect(result.escalations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('service is event-driven, immutable, monotonic and Patient 360-derived', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-deterioration-service.ts'
    );
    const workers = await source(
      'lib/backend/projections/projection-workers.ts'
    );

    expect(service).toContain("collection('clinicalDeteriorationEvaluations')");
    expect(service).toContain("collection('deteriorationProjections')");
    expect(service).toContain("collection('deteriorationCheckpoints')");
    expect(service).toContain('stableEvaluationId');
    expect(service).toContain('transaction.create');
    expect(service).toContain('ClinicalDeteriorationEngine.evaluate');
    expect(service).toContain('compareCursor');
    expect(service).toContain('if (comparison < 0) return');

    expect(workers).toContain('ClinicalDeteriorationService.refreshFromEvent');
    expect(
      workers.indexOf('Patient360ProjectionService.refreshFromEvent')
    ).toBeLessThan(
      workers.indexOf('ClinicalDeteriorationService.refreshFromEvent')
    );
    expect(workers).toContain(
      'ClinicalDeteriorationService.rebuildTenantFromEvents'
    );
  });

  test('Patient 360 API, client and encrypted offline bootstrap expose CI-8 projection', async () => {
    const api = await source(
      'app/api/clinical/patient360/[patientId]/route.ts'
    );
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(api).toContain('ClinicalDeteriorationService.getForPatient');
    expect(api).toContain('deterioration,');
    expect(client).toContain("'deteriorationProjections'");
    expect(client).toContain('deterioration: DeteriorationProjection | null');
    expect(bootstrap).toContain("'deteriorationProjections'");
  });

  test('CI-8 intelligence stores remain server-only and immutable history survives rebuild', async () => {
    const rules = await source('firestore.rules');
    const workers = await source(
      'lib/backend/projections/projection-workers.ts'
    );
    const recovery = await source(
      'lib/backend/recovery/projection-recovery-service.ts'
    );

    expect(rules).toContain('match /deteriorationProjections/{encounterId}');
    expect(rules).toContain('match /deteriorationCheckpoints/{eventId}');
    expect(rules).toContain(
      'match /clinicalDeteriorationEvaluations/{evaluationId}'
    );

    const clearListStart = workers.indexOf("for (const collectionName of [");
    const clearListEnd = workers.indexOf("]) {", clearListStart);
    const clearList = workers.slice(clearListStart, clearListEnd);
    expect(clearList).toContain("'deteriorationProjections'");
    expect(clearList).toContain("'deteriorationCheckpoints'");
    expect(clearList).not.toContain("'clinicalDeteriorationEvaluations'");

    expect(recovery).toContain("'deteriorationProjections'");
    expect(recovery).toContain('deteriorationProjectionCount');
    expect(recovery).toContain('deteriorationCheckpointCount');
    expect(recovery).not.toContain(
      "'clinicalDeteriorationEvaluations',"
    );
  });

  test('Patient 360 UI is explainable, offline-aware and never claims autonomous escalation', async () => {
    const view = await source('components/patient360/Patient360View.tsx');

    expect(view).toContain(
      'Clinical Deterioration & Escalation Intelligence'
    );
    expect(view).toContain('Evidence & provenance');
    expect(view).toContain(
      'does not diagnose disease, prescribe treatment, or autonomously escalate care'
    );
    expect(view).toContain(
      'last synchronized deterioration assessment'
    );
    expect(view).toContain('view.deterioration.critical');
    expect(view).toContain('view.deterioration.escalations');
  });
});
