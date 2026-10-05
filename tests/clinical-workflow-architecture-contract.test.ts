import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS clinical workflow architecture contract', () => {
  test('legacy direct clinical workflow mutation routes remain retired', async () => {
    const stage = await source('app/api/clinical/stage/transition/route.ts');
    const workflow = await source(
      'app/api/clinical/workflow/transition/route.ts'
    );

    expect(stage).toContain('LEGACY_MUTATION_ROUTE_RETIRED');
    expect(stage).toContain('AdvanceStageCommand');
    expect(workflow).toContain('LEGACY_MUTATION_ROUTE_RETIRED');
    expect(workflow).toContain('AdvanceStageCommand');
  });

  test('governed clinical commands persist state with event, audit and outbox atomically', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(tx).toContain("collection('events')");
    expect(tx).toContain("collection('audit_logs')");
    expect(tx).toContain("collection('outbox')");
    expect(tx).toContain('transaction.create(eventRef');
    expect(tx).toContain('transaction.create(auditRef');
    expect(tx).toContain('transaction.create(outboxRef');
    expect(tx).toContain('_serverVersion');
  });

  test('Patient 360 is the longitudinal projection before Clinical Intelligence executes', async () => {
    const workers = await source(
      'lib/backend/projections/projection-workers.ts'
    );

    const p360 = workers.indexOf(
      'Patient360ProjectionService.refreshFromEvent'
    );
    const ci7 = workers.indexOf(
      'DischargeReadinessService.refreshFromEvent'
    );
    const ci8 = workers.indexOf(
      'ClinicalDeteriorationService.refreshFromEvent'
    );

    expect(p360).toBeGreaterThan(-1);
    expect(ci7).toBeGreaterThan(p360);
    expect(ci8).toBeGreaterThan(p360);
  });

  test('Patient 360 API composes longitudinal state with CI-7 and CI-8 outputs', async () => {
    const route = await source(
      'app/api/clinical/patient360/[patientId]/route.ts'
    );

    expect(route).toContain('Patient360ProjectionService.readClinicalView');
    expect(route).toContain('selectedCareContext');
    expect(route).toContain('DischargeReadinessService.getProjection');
    expect(route).toContain('ClinicalDeteriorationService.getProjection');
    expect(route).toContain('dischargeReadiness,');
    expect(route).toContain('deterioration,');
    expect(route).toContain('consultantVisibility,');
  });

  test('STAGING/PILOT Bed Board consumes CI-8 and never derives escalation locally', async () => {
    const board = await source(
      'components/inpatient/governed-bed-board.tsx'
    );

    expect(board).toContain('loadActiveDeteriorationCensus');
    expect(board).toContain('deteriorationByEncounter');
    expect(board).toContain("projection?.state === 'ESCALATION_REQUIRED'");
    expect(board).toContain("projection?.state === 'CRITICAL_REVIEW_REQUIRED'");
    expect(board).toContain(
      'The Bed Board will not infer escalation from raw bed or NEWS2 metadata.'
    );
    expect(board).not.toContain('calculateNEWS2');
    expect(board).not.toContain('acuityScore');
    expect(board).not.toContain('bed.vitalAlert');
  });

  test('active CI-8 census is server-authorized and has encrypted-edge continuity', async () => {
    const api = await source(
      'app/api/clinical/deterioration/active/route.ts'
    );
    const service = await source(
      'lib/clinical/intelligence/clinical-deterioration-service.ts'
    );
    const client = await source(
      'lib/clinical/intelligence/clinical-deterioration-client.ts'
    );

    expect(api).toContain('deriveAuthoritativeContext');
    expect(api).toContain('assertPatient360ReadAccess');
    expect(service).toContain('listActiveForTenant');
    expect(service).toContain(
      "DomainStateRepository.queryAllEqual<Record<string, unknown>>"
    );
    expect(client).toContain("'deteriorationProjections'");
    expect(client).toContain('listSecureEdgeEntities');
    expect(client).toContain("source: 'LOCAL_EDGE'");
  });

  test('inpatient discharge requires current Patient 360, current CI-7 and explicit clinician review', async () => {
    const discharge = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(discharge).toContain('Patient360ProjectionService.getProjection');
    expect(discharge).toContain('DischargeReadinessService.getProjection');
    expect(discharge).toContain("'dischargeReadinessReviews'");
    expect(discharge).toContain("'PATIENT360_DECISION_CONTEXT_REQUIRED'");
    expect(discharge).toContain("'DISCHARGE_READINESS_EVALUATION_STALE'");
    expect(discharge).toContain("'DISCHARGE_READINESS_BLOCKERS_PRESENT'");
    expect(discharge).toContain("'DISCHARGE_READINESS_REVIEW_REQUIRED'");
    expect(discharge).toContain(
      'readiness.patient360Revision !== patient360.revision'
    );
    expect(discharge).toContain(
      'readiness.patient360SourceCheckpoint !== patient360.sourceCheckpoint'
    );
  });

  test('Bed Board routes clinical occupancy decisions to Patient 360/care-transition authority', async () => {
    const [board, page, patient360, client, bus, discharge] = await Promise.all([
      source('components/inpatient/governed-bed-board.tsx'),
      source('app/[tenantId]/inpatient/bed-board/page.tsx'),
      source('components/patient360/Patient360View.tsx'),
      source('lib/clinical/patient360/patient360-client.ts'),
      source('lib/backend/commands/command-bus.ts'),
      source('lib/backend/services/care-transition-domain-service.ts'),
    ]);

    expect(page).toContain('isDemoRuntime ? <BedOccupancyView /> : <GovernedBedBoard />');
    expect(board).toContain('Open Patient 360 / CI review');
    expect(board).toContain('/360');
    expect(board).not.toContain("'DischargeInpatientEncounterCommand'");
    expect(board).not.toContain('dischargePatientFromBed');
    expect(board).not.toContain('admitPatientToBed');

    expect(patient360).toContain('recordDischargeReadinessReview');
    expect(client).toContain("'RecordDischargeReadinessReviewCommand'");
    expect(bus).toContain("'DischargeInpatientEncounterCommand'");
    expect(discharge).toContain('Patient360ProjectionService.getProjection');
    expect(discharge).toContain('DischargeReadinessService.getProjection');
    expect(discharge).toContain("'DISCHARGE_READINESS_REVIEW_REQUIRED'");
  });

  test('AI remains draft-only and cannot directly mutate authoritative clinical state', async () => {
    const drawer = await source('components/ai/ClinicalCopilotDrawer.tsx');
    const intake = await source('app/api/clinical/intake-optimize/route.ts');

    expect(drawer).toContain('Governed Draft');
    expect(drawer).not.toContain('executeActiveTenantCommand');
    expect(intake).toContain('DRAFT_REQUIRES_CLINICIAN_REVIEW');
    expect(intake).toContain(
      'Do not act as an autonomous diagnostic or treatment authority.'
    );
    expect(intake).not.toContain('TransactionManager');
  });

  test('clinical intelligence stores remain browser-write denied', async () => {
    const rules = await source('firestore.rules');

    expect(rules).toContain('match /patient360Projections/{patientId}');
    expect(rules).toContain(
      'match /dischargeReadinessProjections/{encounterId}'
    );
    expect(rules).toContain('match /deteriorationProjections/{encounterId}');
    expect(rules).toContain('allow read, write: if false;');
  });
});
