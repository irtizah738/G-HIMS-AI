import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DischargeReadinessEngine } from '@/lib/clinical/intelligence/discharge-readiness-engine';
import type { DischargeReadinessSnapshot } from '@/types/discharge-readiness';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

function readySnapshot(): DischargeReadinessSnapshot {
  const now = 1_800_000_000_000;
  return {
    tenantId: 'tenant-a',
    patientId: 'patient-a',
    encounterId: 'enc-ipd-a',
    patient360: {
      revision: 12,
      sourceCheckpoint: '1800000000000:evt-12',
      lastEventId: 'evt-12',
      activeEncounter: {
        encounterId: 'enc-ipd-a',
        encounterType: 'IPD',
        status: 'ACTIVE',
      },
      currentMedicationCount: 2,
      dataQuality: {
        allergyKnowledge: 'KNOWN',
        medicationKnowledge: 'KNOWN',
        problemListKnowledge: 'KNOWN',
        hasPreliminaryResults: false,
      },
    },
    encounter: {
      encounterId: 'enc-ipd-a',
      patientId: 'patient-a',
      encounterType: 'IPD',
      status: 'ACTIVE',
      updatedAt: now,
    },
    encounterEvidence: [
      {
        evidenceId: 'ev-vitals',
        evidenceType: 'VITALS',
        status: 'FINAL',
        news2Status: 'VERIFIED',
        news2Score: 0,
        measuredAt: now - 60_000,
      },
      {
        evidenceId: 'ev-medrec',
        evidenceType: 'MEDICATION_RECONCILIATION',
        status: 'FINAL',
        discrepancyCount: 0,
        completedAt: now - 30_000,
      },
      {
        evidenceId: 'ev-discharge',
        evidenceType: 'SIGNED_CLINICAL_NOTE',
        category: 'DISCHARGE',
        status: 'FINAL',
        signedBy: 'doctor-a',
        signedAt: now - 20_000,
      },
    ],
    diagnosticOrders: [],
    diagnosticResults: [],
    clinicalObservations: [],
    diagnosticAcknowledgements: [],
    inpatientOrders: [],
  };
}

describe('G-HIMS CI-7 Discharge Readiness Intelligence', () => {
  test('ready patient becomes READY_FOR_CLINICIAN_REVIEW, never an autonomous discharge decision', () => {
    const snapshot = readySnapshot();
    const result = DischargeReadinessEngine.evaluate(snapshot, 1_800_000_000_000);

    expect(result.state).toBe('READY_FOR_CLINICIAN_REVIEW');
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.information.some((item) => item.code === 'CLINICIAN_AUTHORIZATION_REQUIRED')).toBe(true);
    expect(result.rulesetVersion).toBe('CI7-DR-1.2.0');
  });

  test('missing stability, medication reconciliation, discharge summary and knowledge are explicit blockers', () => {
    const snapshot = readySnapshot();
    snapshot.encounterEvidence = [];
    snapshot.patient360.dataQuality.medicationKnowledge = 'NOT_ASSESSED';
    snapshot.patient360.dataQuality.allergyKnowledge = 'UNKNOWN';

    const result = DischargeReadinessEngine.evaluate(snapshot, 1_800_000_000_000);
    const codes = new Set(result.blockers.map((item) => item.code));

    expect(result.state).toBe('BLOCKED');
    expect(codes.has('NEWS2_NOT_VERIFIED')).toBe(true);
    expect(codes.has('MEDICATION_RECONCILIATION_REQUIRED')).toBe(true);
    expect(codes.has('DISCHARGE_SUMMARY_REQUIRED')).toBe(true);
    expect(codes.has('MEDICATION_HISTORY_UNRESOLVED')).toBe(true);
    expect(codes.has('ALLERGY_HISTORY_UNRESOLVED')).toBe(true);
  });

  test('verified NEWS2 without a finite score is a blocker rather than false readiness', () => {
    const snapshot = readySnapshot();
    const vitals = snapshot.encounterEvidence.find(
      (item) => item.evidenceType === 'VITALS'
    )!;
    delete vitals.news2Score;

    const result = DischargeReadinessEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('BLOCKED');
    expect(result.blockers.map((item) => item.code)).toContain(
      'NEWS2_SCORE_MISSING'
    );
  });

  test('high NEWS2 and unresolved STAT work remain hard blockers with source evidence', () => {
    const snapshot = readySnapshot();
    const vitals = snapshot.encounterEvidence.find((item) => item.evidenceType === 'VITALS')!;
    vitals.news2Score = 6;
    snapshot.diagnosticOrders = [
      {
        orderId: 'ord-stat',
        orderName: 'Troponin',
        priority: 'STAT',
        status: 'PROCESSING',
      },
    ];

    const result = DischargeReadinessEngine.evaluate(snapshot, 1_800_000_000_000);
    const highRisk = result.blockers.find((item) => item.code === 'NEWS2_HIGH_RISK');
    const stat = result.blockers.find((item) => item.code === 'STAT_ORDER_UNRESOLVED');

    expect(result.state).toBe('BLOCKED');
    expect(highRisk?.evidence[0].entityId).toBe('ev-vitals');
    expect(stat?.evidence[0].entityId).toBe('ord-stat');
  });

  test('unacknowledged final critical diagnostic result is a blocker and exact-report acknowledgement clears it', () => {
    const snapshot = readySnapshot();
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
        diagnosticResultId: 'diagrep-critical-k',
        reportId: 'diagrep-critical-k',
        patientId: snapshot.patientId,
        encounterId: snapshot.encounterId,
        status: 'FINAL',
        reportDisplay: 'Potassium',
        resultObservationIds: ['obs-critical-k'],
      },
    ];

    const blocked = DischargeReadinessEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );
    expect(blocked.state).toBe('BLOCKED');
    const critical = blocked.blockers.find(
      (item) => item.code === 'CRITICAL_RESULT_UNACKNOWLEDGED'
    );
    expect(critical?.evidence[0].entityId).toBe('diagrep-critical-k');

    snapshot.diagnosticAcknowledgements = [
      {
        acknowledgementId: 'diagack_diagrep-critical-k',
        reportId: 'diagrep-critical-k',
        patientId: snapshot.patientId,
        encounterId: snapshot.encounterId,
        acknowledgedBy: 'doctor-a',
        acknowledgedAt: 1_799_999_990_000,
        immutable: true,
      },
    ];

    const acknowledged = DischargeReadinessEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );
    expect(
      acknowledged.blockers.map((item) => item.code)
    ).not.toContain('CRITICAL_RESULT_UNACKNOWLEDGED');
  });

  test('non-blocking uncertainty produces REQUIRES_REVIEW rather than false readiness', () => {
    const snapshot = readySnapshot();
    const vitals = snapshot.encounterEvidence.find((item) => item.evidenceType === 'VITALS')!;
    vitals.news2Score = 3;
    snapshot.patient360.dataQuality.problemListKnowledge = 'UNKNOWN';
    snapshot.diagnosticOrders = [
      {
        orderId: 'ord-routine',
        orderName: 'Routine chemistry',
        priority: 'ROUTINE',
        status: 'PROCESSING',
      },
    ];

    const result = DischargeReadinessEngine.evaluate(snapshot, 1_800_000_000_000);

    expect(result.state).toBe('REQUIRES_REVIEW');
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.map((item) => item.code)).toContain('NEWS2_REVIEW');
    expect(result.warnings.map((item) => item.code)).toContain('DIAGNOSTICS_PENDING');
    expect(result.warnings.map((item) => item.code)).toContain('PROBLEM_LIST_UNRESOLVED');
  });

  test('closed or non-IPD encounters are not discharge-intelligence targets', () => {
    const snapshot = readySnapshot();
    snapshot.encounter.status = 'DISCHARGED';

    const result = DischargeReadinessEngine.evaluate(snapshot, 1_800_000_000_000);

    expect(result.state).toBe('NOT_APPLICABLE');
    expect(result.blockers).toHaveLength(0);
  });

  test('event-driven service persists immutable evaluations, latest projection and checkpoints', async () => {
    const service = await source(
      'lib/clinical/intelligence/discharge-readiness-service.ts'
    );
    const workers = await source('lib/backend/projections/projection-workers.ts');

    expect(service).toContain("collection('clinicalIntelligenceEvaluations')");
    expect(service).toContain("collection('dischargeReadinessProjections')");
    expect(service).toContain("collection('dischargeReadinessCheckpoints')");
    expect(service).toContain('stableEvaluationId');
    expect(service).toContain('transaction.create');
    expect(service).toContain('DischargeReadinessEngine.evaluate');
    expect(workers).toContain('DischargeReadinessService.refreshFromEvent');
    expect(workers.indexOf('Patient360ProjectionService.refreshFromEvent')).toBeLessThan(
      workers.indexOf('DischargeReadinessService.refreshFromEvent')
    );
    expect(workers).toContain('DischargeReadinessService.rebuildTenantFromEvents');
  });

  test('Patient 360 API/UI exposes explainable readiness and offline stale-state warning', async () => {
    const api = await source('app/api/clinical/patient360/[patientId]/route.ts');
    const client = await source('lib/clinical/patient360/patient360-client.ts');
    const view = await source('components/patient360/Patient360View.tsx');
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(api).toContain('DischargeReadinessService.getForPatient');
    expect(api).toContain('dischargeReadiness,');
    expect(client).toContain("'dischargeReadinessProjections'");
    expect(client).toContain('recordDischargeReadinessReview');
    expect(bootstrap).toContain("'dischargeReadinessProjections'");
    expect(view).toContain('Discharge Readiness Intelligence');
    expect(view).toContain('Evidence & provenance');
    expect(view).toContain('last synchronized discharge-readiness assessment');
    expect(view).toContain('does not authorize discharge');
  });

  test('clinician review is governed, immutable and cannot clear blockers', async () => {
    const service = await source(
      'lib/backend/services/discharge-readiness-review-domain-service.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(service).toContain("requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN']");
    expect(service).toContain("requiredPrivilege: 'DISCHARGE_INPATIENT'");
    expect(service).toContain("'DISCHARGE_READINESS_EVALUATION_STALE'");
    expect(service).toContain("'DISCHARGE_READINESS_BLOCKERS_PRESENT'");
    expect(service).toContain("eventType: 'DISCHARGE_READINESS_REVIEW_RECORDED'");
    expect(service).toContain('immutable: true');
    expect(bus).toContain("'RecordDischargeReadinessReviewCommand'");
    expect(tx).toContain("DISCHARGE_READINESS_REVIEW: 'dischargeReadinessReviews'");
  });

  test('critical diagnostic acknowledgement is governed, immutable, event-driven and enforced at discharge', async () => {
    const diagnostic = await source(
      'lib/backend/services/diagnostic-result-domain-service.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const readiness = await source(
      'lib/clinical/intelligence/discharge-readiness-service.ts'
    );
    const discharge = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(diagnostic).toContain('AcknowledgeCriticalDiagnosticResultPayload');
    expect(diagnostic).toContain('public static async acknowledgeCriticalResult');
    expect(diagnostic).toContain(
      "eventType: 'CRITICAL_DIAGNOSTIC_RESULT_ACKNOWLEDGED'"
    );
    expect(diagnostic).toContain('immutable: true');
    expect(bus).toContain("'AcknowledgeCriticalDiagnosticResultCommand'");
    expect(tx).toContain(
      "DIAGNOSTIC_RESULT_ACKNOWLEDGEMENT: 'diagnosticResultAcknowledgements'"
    );
    expect(readiness).toContain(
      "'CRITICAL_DIAGNOSTIC_RESULT_ACKNOWLEDGED'"
    );
    expect(discharge).toContain(
      "'UNACKNOWLEDGED_CRITICAL_DIAGNOSTIC_RESULT'"
    );
  });

  test('Clinical Intelligence Firestore stores remain client-denied', async () => {
    const rules = await source('firestore.rules');

    expect(rules).toContain('match /dischargeReadinessProjections/{encounterId}');
    expect(rules).toContain('match /dischargeReadinessCheckpoints/{eventId}');
    expect(rules).toContain('match /clinicalIntelligenceEvaluations/{evaluationId}');
    expect(rules).toContain(
      'match /diagnosticResultAcknowledgements/{acknowledgementId}'
    );
    expect(rules).toContain('allow read, write: if false;');
  });

  test('inpatient orders have an authoritative resolution path so readiness findings are actionable', async () => {
    const inpatient = await source(
      'lib/backend/services/inpatient-clinical-domain-service.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');
    const readiness = await source(
      'lib/clinical/intelligence/discharge-readiness-service.ts'
    );
    const workspace = await source('components/clinical/ipd-pathway-modal.tsx');

    expect(inpatient).toContain('ResolveInpatientOrderPayload');
    expect(inpatient).toContain('public static async resolveOrder');
    expect(inpatient).toContain("eventType: 'INPATIENT_ORDER_RESOLVED'");
    expect(inpatient).toContain('expectedPrimaryServerVersion');
    expect(bus).toContain("'ResolveInpatientOrderCommand'");
    expect(readiness).toContain("'INPATIENT_ORDER_RESOLVED'");
    expect(workspace).toContain("'ResolveInpatientOrderCommand'");
    expect(workspace).toContain("handleResolveOrder(ord.id, 'COMPLETED')");
    expect(workspace).toContain("handleResolveOrder(ord.id, 'DISCONTINUED')");
  });

  test('immutable Clinical Intelligence evaluation history is preserved across destructive projection rebuilds', async () => {
    const workers = await source('lib/backend/projections/projection-workers.ts');
    const recovery = await source(
      'lib/backend/recovery/projection-recovery-service.ts'
    );

    const clearListStart = workers.indexOf("for (const collectionName of [");
    const clearListEnd = workers.indexOf("]) {", clearListStart);
    const clearList = workers.slice(clearListStart, clearListEnd);

    expect(clearList).toContain("'dischargeReadinessProjections'");
    expect(clearList).toContain("'dischargeReadinessCheckpoints'");
    expect(clearList).not.toContain("'clinicalIntelligenceEvaluations'");
    expect(recovery).toContain("'dischargeReadinessProjections'");
    expect(recovery).not.toContain("'clinicalIntelligenceEvaluations'");
  });

  test('safety-critical discharge scans are paged to completion and fail closed on pathological volume', async () => {
    const repository = await source(
      'server/repositories/domain-state-repository.ts'
    );
    const readiness = await source(
      'lib/clinical/intelligence/discharge-readiness-service.ts'
    );
    const discharge = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(repository).toContain('queryAllEqual<T>');
    expect(repository).toContain('orderBy(FieldPath.documentId())');
    expect(repository).toContain('DOMAIN_QUERY_LIMIT_EXCEEDED');
    expect(readiness).toContain(
      'DomainStateRepository.queryAllEqual<Record<string, unknown>>'
    );
    expect(discharge).toContain(
      'DomainStateRepository.queryAllEqual<Record<string, unknown>>'
    );
  });

  test('projection writes are monotonic under concurrent outbox workers', async () => {
    const patient360 = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );
    const readiness = await source(
      'lib/clinical/intelligence/discharge-readiness-service.ts'
    );

    expect(patient360).toContain('comparePatient360Cursor');
    expect(patient360).toContain('PATIENT360_CURSOR_CONTENT_CONFLICT');
    expect(patient360).toContain('if (cursorComparison < 0)');
    expect(readiness).toContain('compareReadinessCursor');
    expect(readiness).toContain(
      'Concurrent workers may finish out of order'
    );
    expect(readiness).toContain('if (cursorComparison < 0)');
  });

  test('authoritative discharge enforces every CI-7 hard safety blocker', async () => {
    const discharge = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(discharge).toContain(
      "dischargeEvidence.evidenceType !== 'SIGNED_CLINICAL_NOTE'"
    );
    expect(discharge).toContain("'UNRESOLVED_STAT_INPATIENT_ORDERS'");
    expect(discharge).toContain("'ALLERGY_HISTORY_UNRESOLVED'");
    expect(discharge).toContain("'MEDICATION_HISTORY_UNRESOLVED'");
    expect(discharge).toContain(
      "String(latestVitals.news2Status || '').toUpperCase() !== 'VERIFIED'"
    );
  });

  test('CI-7 only accepts genuinely signed discharge-summary evidence', () => {
    const snapshot = readySnapshot();
    const summary = snapshot.encounterEvidence.find(
      (item) => item.category === 'DISCHARGE'
    )!;
    delete summary.signedBy;

    const result = DischargeReadinessEngine.evaluate(
      snapshot,
      1_800_000_000_000
    );

    expect(result.state).toBe('BLOCKED');
    expect(result.blockers.map((item) => item.code)).toContain(
      'DISCHARGE_SUMMARY_REQUIRED'
    );
  });

  test('legacy Bed Board census bypasses are retired outside DEMO', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const board = await source(
      'app/[tenantId]/inpatient/bed-board/page.tsx'
    );
    const legacyClient = await source(
      'lib/firebase/services/inpatient-or.ts'
    );

    expect(bus).toContain("'TransferInpatientBedCommand'");
    expect(bus).toContain("'CARE_TRANSITION_COMMAND_REQUIRED'");
    expect(bus).toContain(
      'Inpatient admission must use AdmitPatientToInpatientCareCommand'
    );
    expect(bus).toContain(
      'Inpatient discharge must use DischargeInpatientEncounterCommand'
    );

    expect(board).toContain("'AdmitPatientToInpatientCareCommand'");
    expect(board).toContain("'TransferInpatientBedCommand'");
    expect(board).toContain("'DischargeInpatientEncounterCommand'");
    expect(board).toContain("'UpdateBedStatusCommand'");
    expect(board).not.toContain('saveClinicalDataOptimistic');
    expect(board).not.toContain('assignBedToPatient(');
    expect(board).not.toContain('transferPatientBed(');
    expect(board).not.toContain('dischargePatientBed(');
    expect(board).not.toContain('markBedCleaned(');
    expect(board).not.toContain('updateBedStatus(');

    expect(legacyClient).toContain(
      "assertDemoOnlyMutation('assignBedToPatient')"
    );
    expect(legacyClient).toContain(
      "assertDemoOnlyMutation('transferPatientBed')"
    );
    expect(legacyClient).toContain(
      "assertDemoOnlyMutation('dischargePatientBed')"
    );
    expect(legacyClient).toContain(
      "assertDemoOnlyMutation('updateBedStatus')"
    );
    expect(legacyClient).toContain(
      "assertDemoOnlyMutation('seedInitialInpatientORData')"
    );
  });

  test('Bed Board never fabricates NEWS2 from bed class or isolation metadata', async () => {
    const board = await source(
      'app/[tenantId]/inpatient/bed-board/page.tsx'
    );

    expect(board).toContain('NEWS2: Not recorded');
    expect(board).toContain(
      'Never infer NEWS2 from bed class, isolation status'
    );
    const resolverStart = board.indexOf(
      'const getBedNEWS2 = (bed: Bed) =>'
    );
    const resolverEnd = board.indexOf(
      'const hasHighRecordedNEWS2',
      resolverStart
    );
    const resolver = board.slice(resolverStart, resolverEnd);

    expect(resolver).not.toContain("bed.class === 'icu'");
    expect(resolver).not.toContain('bed.isolationType');
    expect(resolver).not.toContain('vitalAlert');
    expect(resolver).toContain("return { score: null, riskLevel: null }");
  });

  test('governed inpatient discharge requires explicit disposition and follow-up', async () => {
    const discharge = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );
    const modal = await source(
      'components/inpatient/DischargeConfirmationModal.tsx'
    );

    expect(discharge).toContain("'INVALID_INPATIENT_DISCHARGE_INPUT'");
    expect(discharge).toContain(
      "!String(payload.followUpInstructions || '').trim()"
    );
    expect(modal).toContain('Discharge Disposition *');
    expect(modal).toContain('Follow-Up Instructions *');
    expect(modal).toContain('review prompts only');
    expect(modal).toContain(
      'Financial status is tracked separately from clinical discharge safety'
    );
  });

  test('inpatient census transitions reject stale bed and patient versions', async () => {
    const care = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );
    const bedService = await source(
      'lib/backend/services/inpatient-bed-domain-service.ts'
    );
    const tx = await source(
      'lib/backend/transactions/transaction-manager.ts'
    );

    expect(care).toContain('expectedPrimaryServerVersion');
    expect(care).toContain('expectedServerVersion');
    expect(care).toContain("entityType: 'BED_TRANSFER'");
    expect(bedService).toContain('expectedPrimaryServerVersion');
    expect(bedService).toContain(
      "bed.status === 'occupied' || bed.patientId || bed.currentPatientId"
    );
    expect(tx).toContain("BED_TRANSFER: 'bedTransfers'");
  });

  test('Hobby deployment path disables automatic previews and avoids Pro-only staging target', async () => {
    const vercel = JSON.parse(await source('vercel.json'));
    const workflow = await source('.github/workflows/staging-deploy.yml');

    expect(vercel.git?.deploymentEnabled).toBe(false);
    expect(workflow).toContain(
      'vercel pull --yes --environment=preview'
    );
    expect(workflow).toContain(
      'vercel deploy --prebuilt --yes --token="$VERCEL_TOKEN"'
    );
    expect(workflow).not.toContain('--target=staging');
    expect(workflow).toContain('G-HIMS runtime: STAGING');
  });
});
