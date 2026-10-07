import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 2 clinical domain completion', () => {
  test('all Wave 2 mutations route through strict command schemas and server services', async () => {
    const [bus, schemas] = await Promise.all([
      source('lib/backend/commands/command-bus.ts'),
      source('lib/backend/commands/command-schema-registry.ts'),
    ]);

    const commands = [
      'ScheduleMedicationAdministrationCommand',
      'AdministerScheduledMedicationCommand',
      'CreateNursingCarePlanCommand',
      'UpdateNursingCarePlanInterventionCommand',
      'CreateDialysisOrderCommand',
      'StartDialysisSessionCommand',
      'CompleteDialysisSessionCommand',
      'CreateObstetricEpisodeCommand',
      'RecordPartogramObservationCommand',
      'TransitionObstetricEpisodeCommand',
      'RecordDeliveryOutcomeCommand',
      'OpenOncologyCaseCommand',
      'RecordTumorBoardRecommendationCommand',
      'ApproveOncologyRegimenCommand',
      'LinkChemotherapyAdministrationCommand',
      'RecordOncologyToxicityCommand',
      'CreateRehabilitationPlanCommand',
      'RecordRehabilitationSessionCommand',
      'UpdateRehabilitationGoalCommand',
      'CompleteRehabilitationPlanCommand',
    ];

    for (const command of commands) {
      expect(bus).toContain(`case '${command}'`);
      expect(schemas).toContain(`${command}: {`);
    }

    expect(schemas).toContain('.strict()');
  });

  test('eMAR is order-bound and retires client-authored medication administration', async () => {
    const [service, bus, client] = await Promise.all([
      source('lib/backend/services/nursing-emar-domain-service.ts'),
      source('lib/backend/commands/command-bus.ts'),
      source('lib/clinical/wave2-client.ts'),
    ]);

    expect(service).toContain('EMAR_ACTIVE_MEDICATION_ORDER_REQUIRED');
    expect(service).toContain('EMAR_ORDER_VERSION_CONFLICT');
    expect(service).toContain('EMAR_RIGHT_TIME_FAILED');
    expect(service).toContain('EMAR_DUPLICATE_ADMINISTRATION');
    expect(service).toContain("order.status !== 'ACTIVE'");
    expect(service).toContain('medicationName = medicationLabel(order)');
    expect(service).toContain('dose: order.dosageText');
    expect(service).toContain('route');
    expect(service).toContain("generatedBy: 'WAVE2_EMAR'");
    expect(service).toContain("'CLINICAL_OPEN_ITEM'");
    expect(service).toContain('EMAR_SCHEDULED_COMMAND_REQUIRED');
    expect(bus).toContain('NursingEmarDomainService.rejectLegacyAdministration');

    expect(client).toContain("'AdministerScheduledMedicationCommand'");
    expect(client).not.toContain("medicationName: payload.");
    expect(client).not.toContain("dose: payload.");
    expect(client).not.toContain("route: payload.");
    expect(client).toContain("offlineCollection: 'medicationAdministrations'");
    expect(client).toContain('optimisticCache: false');
  });

  test('renal workflow enforces order → active session → terminal session lifecycle', async () => {
    const service = await source(
      'lib/backend/services/renal-dialysis-domain-service.ts'
    );
    expect(service).toContain("'DIALYSIS_ORDER_NOT_ACTIVE'");
    expect(service).toContain("'DIALYSIS_SESSION_ALREADY_EXISTS'");
    expect(service).toContain("'DIALYSIS_SESSION_NOT_IN_PROGRESS'");
    expect(service).toContain("'DIALYSIS_ABORT_REASON_REQUIRED'");
    expect(service).toContain("status: 'IN_PROGRESS'");
    expect(service).toContain("status: payload.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED'");
  });

  test('obstetric workflow is stage-gated and derives escalation on the server', async () => {
    const service = await source(
      'lib/backend/services/obstetric-domain-service.ts'
    );
    expect(service).toContain('function partogramEscalation');
    expect(service).toContain('fhr < 100 || fhr > 180');
    expect(service).toContain("'OBSTETRIC_TRANSITION_INVALID'");
    expect(service).toContain("'OBSTETRIC_DELIVERY_STAGE_REQUIRED'");
    expect(service).toContain("'THEATRE_ACTIVATED'");
    expect(service).toContain('allowedTransitions');
  });

  test('oncology requires evidence, tumor board review and approved medication orders', async () => {
    const service = await source(
      'lib/backend/services/oncology-domain-service.ts'
    );
    expect(service).toContain("'ONCOLOGY_CASE_EVIDENCE_REQUIRED'");
    expect(service).toContain("'TUMOR_BOARD_RECOMMENDATION_INCOMPLETE'");
    expect(service).toContain("'ONCOLOGY_BOARD_REVIEW_REQUIRED'");
    expect(service).toContain("'ONCOLOGY_MEDICATION_ORDER_INVALID'");
    expect(service).toContain("'CHEMOTHERAPY_ORDER_NOT_IN_REGIMEN'");
    expect(service).toContain("'ONCOLOGY_HIGH_GRADE_TOXICITY_REVIEW_REQUIRED'");
  });

  test('rehabilitation plan completion requires goal disposition and accepted handoff', async () => {
    const service = await source(
      'lib/backend/services/rehabilitation-domain-service.ts'
    );
    expect(service).toContain("'REHABILITATION_PLAN_NOT_ACTIVE'");
    expect(service).toContain("'REHABILITATION_GOAL_SCOPE_MISMATCH'");
    expect(service).toContain("'REHABILITATION_DISCHARGE_HANDOFF_REQUIRED'");
    expect(service).toContain("'REHABILITATION_GOALS_UNRESOLVED'");
    expect(service).toContain("handoff.status !== 'ACCEPTED'");
  });

  test('Wave 2 aggregates remain server-only in Firestore', async () => {
    const rules = await source('firestore.rules');
    const collections = [
      'emarScheduleSlots',
      'nursingCarePlans',
      'renalDialysisOrders',
      'renalDialysisSessions',
      'obstetricEpisodes',
      'obstetricPartogramEntries',
      'oncologyCases',
      'oncologyTumorBoardRecommendations',
      'oncologyRegimens',
      'oncologyChemotherapyLinks',
      'oncologyToxicityAssessments',
      'rehabilitationPlans',
      'rehabilitationSessions',
    ];

    for (const collection of collections) {
      expect(rules).toContain(`match /${collection}/{id} { allow read, write: if false; }`);
    }
  });

  test('Patient 360 carries Wave 2 medication and specialty event provenance', () => {
    const events = [
      {
        eventId: 'evt-med',
        eventType: 'MEDICATION_ADMINISTERED',
        aggregateType: 'MEDICATION_ADMINISTRATION',
        aggregateId: 'medadm-1',
        occurredAt: 100,
        recordedAt: 100,
        payload: {
          patientId: 'pat-1',
          encounterId: 'enc-1',
          administrationId: 'medadm-1',
          medicationOrderId: 'medord-1',
          medicationName: 'Medication A',
          dose: '10 mg',
          route: 'PO',
          outcome: 'GIVEN',
          administeredAt: 100,
        },
      },
      {
        eventId: 'evt-renal',
        eventType: 'RENAL_DIALYSIS_SESSION_COMPLETED',
        aggregateType: 'RENAL_DIALYSIS_SESSION',
        aggregateId: 'dial-1',
        occurredAt: 200,
        recordedAt: 200,
        payload: { patientId: 'pat-1', encounterId: 'enc-1', dialysisSessionId: 'dial-1' },
      },
      {
        eventId: 'evt-ob',
        eventType: 'OBSTETRIC_PARTOGRAM_ESCALATION_RECORDED',
        aggregateType: 'OBSTETRIC_PARTOGRAM_ENTRY',
        aggregateId: 'part-1',
        occurredAt: 300,
        recordedAt: 300,
        payload: {
          patientId: 'pat-1',
          encounterId: 'enc-1',
          partogramEntryId: 'part-1',
          escalationState: 'URGENT_REVIEW',
        },
      },
      {
        eventId: 'evt-onc',
        eventType: 'ONCOLOGY_REGIMEN_APPROVED',
        aggregateType: 'ONCOLOGY_REGIMEN',
        aggregateId: 'reg-1',
        occurredAt: 400,
        recordedAt: 400,
        payload: { patientId: 'pat-1', encounterId: 'enc-1', regimenId: 'reg-1' },
      },
      {
        eventId: 'evt-rehab',
        eventType: 'REHABILITATION_SESSION_COMPLETED',
        aggregateType: 'REHABILITATION_SESSION',
        aggregateId: 'rehab-1',
        occurredAt: 500,
        recordedAt: 500,
        payload: {
          patientId: 'pat-1',
          encounterId: 'enc-1',
          rehabilitationSessionId: 'rehab-1',
        },
      },
    ];

    const { projection, timeline } = Patient360Projector.project({
      tenantId: 'tenant-1',
      patient: { id: 'pat-1', mrn: 'MRN-1', fullName: 'Wave 2 Patient' },
      encounters: [{
        id: 'enc-1',
        patientId: 'pat-1',
        encounterType: 'IPD',
        status: 'IN_PROGRESS',
        startedAt: 1,
      }],
      conditions: [],
      allergies: [],
      medicationOrders: [],
      observations: [],
      diagnosticOrders: [],
      diagnosticReports: [],
      procedures: [],
      carePlans: [],
      documents: [],
      diseaseIntakeArtifacts: [],
      events,
    }, 600);

    expect(projection.projectionVersion).toBe(5);
    expect(projection.recentMedicationAdministrations).toHaveLength(1);
    expect(projection.recentMedicationAdministrations[0]?.sourceEventId).toBe('evt-med');
    expect(projection.recentSpecialtyActivities.map((item) => item.domain)).toEqual([
      'REHABILITATION',
      'ONCOLOGY',
      'OBSTETRICS',
      'RENAL',
      'NURSING',
    ]);
    expect(projection.counts.medicationAdministrations).toBe(1);
    expect(projection.counts.specialtyActivities).toBe(5);
    expect(timeline.some((item) => item.summary.includes('Dialysis session completed'))).toBe(true);
    expect(timeline.some((item) => item.summary.includes('Partogram escalation'))).toBe(true);
  });

  test('production directory and dashboard expose the real Wave 2 workspaces', async () => {
    const [directory, dashboard, sidebar, rbac] = await Promise.all([
      source('components/views/all-modules-directory.tsx'),
      source('components/tenant-dashboard.tsx'),
      source('components/navigation/collapsible-sidebar.tsx'),
      source('lib/auth/rbac.ts'),
    ]);

    for (const moduleId of [
      'nursing-emar',
      'dialysis-nephrology',
      'maternity-labor-delivery',
      'oncology-tumor-board',
      'rehab-physical-therapy',
    ]) {
      expect(directory).toContain(`id: '${moduleId}'`);
      expect(directory).toContain(`targetTab: '${moduleId}'`);
      expect(sidebar).toContain(`id: '${moduleId}'`);
      expect(dashboard).toContain(`activeTab === '${moduleId}'`);
      expect(rbac).toContain(`'${moduleId}'`);
    }

    expect(directory).not.toContain("primaryMetric: '100% eMAR Match'");
    expect(directory).not.toContain("primaryMetric: 'KDOQI Compliant'");
    expect(directory).not.toContain("primaryMetric: 'NCCN Compliant'");
    expect(directory).not.toContain("primaryMetric: 'FIM Certified'");
  });
});
