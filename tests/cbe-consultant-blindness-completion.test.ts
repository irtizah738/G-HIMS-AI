import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function command(commandType: string, payload: Record<string, unknown>) {
  return {
    commandId: `cmd-${commandType}`,
    idempotencyKey: `idem-${commandType}`,
    tenantId: 'tenant-cbe',
    commandType,
    schemaVersion: 1,
    payload,
  };
}

describe('CBE consultant blindness completion', () => {
  test('consultation, handoff, attention and escalation commands are registered and routed', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    const commands = [
      'RequestConsultationCommand',
      'AcceptConsultationCommand',
      'CompleteConsultationCommand',
      'CreateClinicalHandoffCommand',
      'AcceptClinicalHandoffCommand',
      'AcknowledgeClinicalOpenItemCommand',
      'ResolveClinicalOpenItemCommand',
      'AcknowledgeClinicalEscalationCommand',
    ];

    for (const type of commands) {
      expect(schema).toContain(type);
      expect(bus).toContain(`case '${type}'`);
    }

    expect(tx).toContain("CLINICAL_CONSULTATION_REQUEST: 'consultationRequests'");
    expect(tx).toContain("CLINICAL_HANDOFF: 'clinicalHandoffs'");
    expect(tx).toContain("CLINICAL_OPEN_ITEM: 'clinicalOpenItems'");
    expect(tx).toContain("CLINICAL_ESCALATION: 'clinicalEscalations'");
  });

  test('coordination command schemas fail malformed payloads closed', () => {
    const request = validateCommandPayload(
      command('RequestConsultationCommand', {
        patientId: 'patient-a',
        encounterId: 'encounter-a',
        requestedSpecialty: '',
        clinicalQuestion: '',
      })
    );
    const handoff = validateCommandPayload(
      command('CreateClinicalHandoffCommand', {
        patientId: 'patient-a',
        encounterId: 'encounter-a',
        currentProblemSummary: '',
      })
    );
    const resolve = validateCommandPayload(
      command('ResolveClinicalOpenItemCommand', {
        patientId: 'patient-a',
        encounterId: 'encounter-a',
        openItemId: 'open-a',
        resolutionReason: '',
      })
    );

    expect(request.success).toBe(false);
    expect(handoff.success).toBe(false);
    expect(resolve.success).toBe(false);
  });

  test('coordination services remain patient-scoped and source-controlled', async () => {
    const service = await source(
      'lib/backend/services/clinical-coordination-domain-service.ts'
    );

    expect(service).toContain('assertPatient360PatientAccess');
    expect(service).toContain("'CLINICAL_OPEN_ITEM_SOURCE_CONTROLLED'");
    expect(service).toContain("resolutionMode || 'SOURCE_STATE'");
    expect(service).toContain("eventType: 'CLINICAL_CONSULTATION_REQUESTED'");
    expect(service).toContain("eventType: 'CLINICAL_CONSULTATION_ACCEPTED'");
    expect(service).toContain("eventType: 'CLINICAL_CONSULTATION_COMPLETED'");
    expect(service).toContain("eventType: 'CLINICAL_HANDOFF_CREATED'");
    expect(service).toContain("eventType: 'CLINICAL_HANDOFF_ACCEPTED'");
    expect(service).toContain("eventType: 'CLINICAL_OPEN_ITEM_ACKNOWLEDGED'");
    expect(service).toContain("eventType: 'CLINICAL_ESCALATION_ACKNOWLEDGED'");
  });

  test('critical diagnostic acknowledgement uses its own credentialed privilege', async () => {
    const resultService = await source(
      'lib/backend/services/diagnostic-result-domain-service.ts'
    );
    const auth = await source('server/auth/authorization-context.ts');
    const hcm = await source('types/hcm-advanced.ts');
    const demo = await source('scripts/demo/provision-demo-identities.ts');
    const staging = await source(
      'scripts/ops/p7-provision-staging-identities.ts'
    );

    expect(resultService).toContain(
      "requiredPrivilege: 'ACKNOWLEDGE_CRITICAL_RESULT'"
    );
    expect(resultService).not.toContain(
      "requiredPrivilege: 'DISCHARGE_INPATIENT',"
    );
    expect(auth).toContain(
      "ACKNOWLEDGE_CRITICAL_RESULT:['ACKNOWLEDGE_CRITICAL_RESULT']"
    );
    expect(hcm).toContain("'ACKNOWLEDGE_CRITICAL_RESULT'");
    expect(demo).toContain("'ACKNOWLEDGE_CRITICAL_RESULT'");
    expect(staging).toContain("'ACKNOWLEDGE_CRITICAL_RESULT'");
  });

  test('consultant attention projection is event-driven and rebuildable', async () => {
    const projection = await source(
      'lib/clinical/intelligence/consultant-attention-projection-service.ts'
    );
    const workers = await source('lib/backend/projections/projection-workers.ts');

    expect(projection).toContain("collection('clinicalOpenItems')");
    expect(projection).toContain("collection('clinicalEscalations')");
    expect(projection).toContain("collection('consultantAttentionCheckpoints')");
    expect(projection).toContain("'CRITICAL_REVIEW_REQUIRED'");
    expect(projection).toContain("'CONSULTATION'");
    expect(projection).toContain("'HANDOFF'");
    expect(projection).toContain('SYSTEM_PROJECTION');
    expect(projection).toContain('getWorklist');

    expect(workers).toContain(
      'ConsultantAttentionProjectionService.refreshFromEvent(event)'
    );
    expect(workers).toContain("'consultantAttentionCheckpoints'");
    expect(workers).toContain("'clinicalOpenItems'");
    expect(workers).toContain("'clinicalEscalations'");
    expect(workers).toContain(
      'ConsultantAttentionProjectionService.rebuildTenantFromEvents'
    );
  });

  test('persistent Patient 360 attention includes acknowledgement state and critical-result count', async () => {
    const visibility = await source(
      'lib/clinical/intelligence/consultant-visibility-service.ts'
    );

    expect(visibility).toContain("collection('clinicalOpenItems')");
    expect(visibility).toContain("item.status !== 'RESOLVED'");
    expect(visibility).toContain('pendingDiagnosticCount');
    expect(visibility).toContain('unacknowledgedResultCount');
    expect(visibility).not.toContain('pendingDiagnosticOrders');
  });

  test('OPD to IPD admission creates a structured continuity handoff atomically', async () => {
    const transition = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(transition).toContain('handoff_admission_');
    expect(transition).toContain('admissionHandoff');
    expect(transition).toContain("entityType: 'CLINICAL_HANDOFF'");
    expect(transition).toContain('sourceEncounterId: sourceEncounter.encounterId');
    expect(transition).toContain(
      "'Review admission context and active Patient 360 evidence.'"
    );
    expect(transition).toContain(
      "'Accept inpatient clinical responsibility.'"
    );
  });

  test('consultant command center consumes server worklist rather than reconstructing chart authority', async () => {
    const view = await source(
      'components/clinical/ConsultantCommandCenter.tsx'
    );
    const client = await source(
      'lib/clinical/intelligence/consultant-worklist-client.ts'
    );
    const route = await source(
      'app/api/clinical/consultant/worklist/route.ts'
    );

    expect(view).toContain('loadConsultantWorklist');
    expect(view).toContain('My authoritative attention queue');
    expect(view).toContain('Source-controlled items close only when the underlying clinical state resolves');
    expect(view).toContain('worklist requires authoritative server connectivity');
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('ConsultantAttentionProjectionService.getWorklist');
    expect(client).toContain("'/api/commands/execute'");
    expect(view).not.toContain('calculateNEWS2');
  });

  test('offline continuity keeps consultant coordination encrypted and care-scoped', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const secure = await source('lib/offline/secure-store.ts');

    for (const collection of [
      'clinicalOpenItems',
      'clinicalEscalations',
      'consultationRequests',
      'clinicalHandoffs',
    ]) {
      expect(bootstrap).toContain(`'${collection}'`);
    }

    expect(bootstrap).toContain('byEncounterOrPatient');
    expect(bootstrap).toContain('scopeOfflineCollections');
    expect(secure).toContain('(entity as any).openItemId');
    expect(secure).toContain('(entity as any).escalationId');
    expect(secure).toContain('(entity as any).consultationId');
    expect(secure).toContain('(entity as any).handoffId');
    expect(secure).toContain('encryptEdgeJson');
  });

  test('new CBE projections and coordination aggregates are client-denied in Firestore', async () => {
    const rules = await source('firestore.rules');

    for (const matcher of [
      'match /consultantAttentionCheckpoints/{eventId}',
      'match /clinicalOpenItems/{openItemId}',
      'match /clinicalEscalations/{escalationId}',
      'match /consultationRequests/{consultationId}',
      'match /clinicalHandoffs/{handoffId}',
    ]) {
      const index = rules.indexOf(matcher);
      expect(index).toBeGreaterThan(-1);
      expect(rules.slice(index, index + 150)).toContain(
        'allow read, write: if false'
      );
    }
  });

  test('consultant blindness metrics make attention coverage measurable', async () => {
    const service = await source(
      'lib/clinical/intelligence/consultant-blindness-metrics-service.ts'
    );
    const route = await source(
      'app/api/clinical/consultant/metrics/route.ts'
    );

    expect(service).toContain('attentionCoveragePct');
    expect(service).toContain('criticalUnacknowledgedItems');
    expect(service).toContain('overdueAttentionItems');
    expect(service).toContain('pendingConsultations');
    expect(service).toContain('pendingHandoffs');
    expect(service).toContain('evidenceLinkedItems');
    expect(route).toContain('ConsultantBlindnessMetricsService.forActor');
    expect(route).toContain('ConsultantBlindnessMetricsService.forTenant');
  });
});
