import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('DRP-10 authenticated hospital E2E staging qualification', () => {
  test('staging rehearsal is authenticated, session-bound and command-driven', async () => {
    const s = await source('scripts/ops/drp10-staging-cross-domain-rehearsal.ts');

    expect(s).toContain("runtime !== 'STAGING'");
    expect(s).toContain("'/api/auth/session'");
    expect(s).toContain("'/api/commands/execute'");
    expect(s).toContain("'x-ghims-session-id'");
    expect(s).toContain("'x-ghims-device-id'");
    expect(s).toContain("'/api/outbox/relay'");
    expect(s).toContain("'x-ghims-worker-key'");
    expect(s).not.toContain('.set({');
    expect(s).not.toContain('.update({');
    expect(s).not.toContain('.delete(');
  });

  test('rehearsal covers the pilot cross-domain journeys rather than isolated smoke checks', async () => {
    const s = await source('scripts/ops/drp10-staging-cross-domain-rehearsal.ts');

    for (const command of [
      'CreateFinanceAccountCommand',
      'CreateFinancePeriodCommand',
      'PostJournalCommand',
      'SubmitPurchaseRequisitionCommand',
      'ApprovePurchaseRequisitionCommand',
      'CreatePurchaseOrderCommand',
      'ApprovePurchaseOrderCommand',
      'RecordGoodsReceiptCommand',
      'RecordSupplierInvoiceCommand',
      'RecognizeSupplierInvoicePayableCommand',
      'CreateEmployeeCommand',
      'UpdateEmployeeStatusCommand',
      'SubmitCredentialCommand',
      'VerifyCredentialCommand',
      'AssignShiftCommand',
      'RecordClockInCommand',
      'RecordClockOutCommand',
      'SetCompensationCommand',
      'ReviewCompensationCommand',
      'CreatePayrollPeriodCommand',
      'EnrollPayrollEmployeeCommand',
      'CalculatePayrollEmployeeCommand',
      'FinalizePayrollPeriodCommand',
      'ApprovePayrollPeriodCommand',
      'PostPayrollPeriodCommand',
      'RegisterRoomCommand',
      'RegisterBedCommand',
      'AdmitPatientToInpatientCareCommand',
      'ReviewPatientClinicalKnowledgeCommand',
      'CompleteMedicationReconciliationCommand',
      'SignClinicalNoteCommand',
      'RecordDischargeReadinessReviewCommand',
      'DischargeInpatientEncounterCommand',
    ]) {
      expect(s).toContain(`'${command}'`);
    }
  });

  test('offline reconnect replay is proven through the authenticated sync boundary', async () => {
    const s = await source('scripts/ops/drp10-staging-cross-domain-rehearsal.ts');

    expect(s).toContain("'/api/sync/batch'");
    expect(s).toContain("'RecordVitalsCommand'");
    expect(s).toContain('forged-client-device-will-be-replaced');
    expect(s).toContain('forged-client-actor-will-be-replaced');
    expect(s).toContain("'idempotencyKey', '=='");
    expect(s).toContain('replayEvents.size === 1');
  });

  test('IPD discharge consumes Patient 360/CI-7 evidence rather than bypassing intelligence gates', async () => {
    const s = await source('scripts/ops/drp10-staging-cross-domain-rehearsal.ts');

    expect(s).toContain("'dischargeReadinessProjections'");
    expect(s).toContain('readiness.blockers.length === 0');
    expect(s).toContain("'RecordDischargeReadinessReviewCommand'");
    expect(s).toContain("'DischargeInpatientEncounterCommand'");
    expect(s).not.toContain("collection('dischargeReadinessProjections').doc");
    expect(s).not.toContain("collection('patient360Projections').doc");
  });

  test('staging fixture provisioning is isolated and refuses production projects', async () => {
    const s = await source('scripts/ops/drp10-provision-staging-fixtures.ts');

    expect(s).toContain('DRP10_FIXTURE_PROVISION_STAGING_ONLY');
    expect(s).toContain('DRP10_STAGING_PROVISION_NOT_CONFIRMED');
    expect(s).toContain('DRP10_PROJECT_CONFIRMATION_MISMATCH');
    expect(s).toContain('DRP10_REFUSES_PRODUCTION_PROJECT');
    expect(s).toContain('syntheticQualificationRecord');
    expect(s).not.toContain("collection('encounters')");
    expect(s).not.toContain("collection('journalEntries')");
    expect(s).not.toContain("collection('payrollPeriods')");
  });

  test('staging clinicians are resolved through HCM credential authority', async () => {
    const auth = await source('server/auth/authorization-context.ts');
    const provision = await source('scripts/ops/p7-provision-staging-identities.ts');

    expect(auth).toContain("PRESCRIBE_MEDICATION:['PRESCRIBE_MEDICATION','PRESCRIBE'");
    expect(auth).not.toContain('credentialGatedRoleBaseline');
    expect(auth).toContain("ADMIT_INPATIENT:['ADMIT_INPATIENT']");
    expect(auth).toContain("DISCHARGE_INPATIENT:['DISCHARGE_INPATIENT']");
    expect(provision).toContain("collection('clinicalCredentials')");
    expect(provision).toContain("collection('clinicalPrivileges')");
    expect(provision).toContain("collection('employees')");
    expect(provision).toContain('syntheticQualificationRecord');
  });
});
