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
    expect(route).toContain('DischargeReadinessService.getForPatient');
    expect(route).toContain('ClinicalDeteriorationService.getForPatient');
    expect(route).toContain('dischargeReadiness,');
    expect(route).toContain('deterioration,');
  });

  test('Bed Board escalation consumes CI-8 and never derives escalation from NEWS2 locally', async () => {
    const board = await source(
      'app/[tenantId]/inpatient/bed-board/page.tsx'
    );

    expect(board).toContain('loadActiveDeteriorationCensus');
    expect(board).toContain('deteriorationByEncounter');
    expect(board).toContain("state === 'ESCALATION_REQUIRED'");
    expect(board).toContain("state === 'CRITICAL_REVIEW_REQUIRED'");
    expect(board).toContain(
      'The Bed Board will not infer escalation from raw bed or NEWS2 metadata.'
    );

    const escalationStart = board.indexOf(
      'const hasCi8Escalation = (bed: Bed)'
    );
    const escalationEnd = board.indexOf(
      'const escalationBeds',
      escalationStart
    );
    const escalationResolver = board.slice(
      escalationStart,
      escalationEnd
    );

    expect(escalationResolver).not.toContain('acuityScore');
    expect(escalationResolver).not.toContain('score >=');
    expect(escalationResolver).not.toContain('calculateNEWS2');
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

  test('Bed Board discharge is two-phase: immutable summary then Patient 360 review then command', async () => {
    const board = await source(
      'app/[tenantId]/inpatient/bed-board/page.tsx'
    );
    const modal = await source(
      'components/inpatient/DischargeConfirmationModal.tsx'
    );

    expect(board).toContain('loadPatient360ClinicalView');
    expect(board).toContain("'SignClinicalNoteCommand'");
    expect(board).toContain("'DISCHARGE_SUMMARY_REQUIRED'");
    expect(board).toContain('/360');
    expect(board).toContain("'DischargeInpatientEncounterCommand'");
    expect(board.indexOf("'SignClinicalNoteCommand'")).toBeLessThan(
      board.indexOf("'DischargeInpatientEncounterCommand'")
    );
    expect(modal).toContain(
      'Patient 360 / CI-7 assessment to be reviewed and acknowledged'
    );
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
