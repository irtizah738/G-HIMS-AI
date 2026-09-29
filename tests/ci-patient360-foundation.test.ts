import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isClinicalTransitionAllowed, normalizeClinicalEncounterState } from '@/types/clinical-state';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS Clinical Intelligence Patient 360 foundation', () => {
  test('canonical workflow normalizes legacy and UI stages without making UI tabs authoritative', () => {
    expect(normalizeClinicalEncounterState('REGISTRATION')).toBe('REGISTERED');
    expect(normalizeClinicalEncounterState('QUEUE_ASSIGNMENT')).toBe('REGISTERED');
    expect(normalizeClinicalEncounterState('NURSING_INTAKE')).toBe('TRIAGE');
    expect(normalizeClinicalEncounterState('SPECIALTY_CONSULTATION')).toBe('CONSULTATION');
    expect(normalizeClinicalEncounterState('DIAGNOSTIC_ORDERS')).toBe('DIAGNOSTICS');
    expect(normalizeClinicalEncounterState('PHARMACY_FEFO')).toBe('TREATMENT');
    expect(normalizeClinicalEncounterState('DISPOSITION_REFERRAL')).toBe('DISPOSITION');
    expect(normalizeClinicalEncounterState('TIMELINE_AUDIT')).toBe('COMPLETED');
    expect(isClinicalTransitionAllowed('REGISTERED', 'TRIAGE')).toBe(true);
    expect(isClinicalTransitionAllowed('TRIAGE', 'CONSULTATION')).toBe(true);
    expect(isClinicalTransitionAllowed('CONSULTATION', 'DIAGNOSTICS')).toBe(true);
    expect(isClinicalTransitionAllowed('DISPOSITION', 'COMPLETED')).toBe(true);
    expect(isClinicalTransitionAllowed('REGISTERED', 'COMPLETED')).toBe(false);
  });

  test('registration persists canonical encounter dimensions alongside legacy compatibility fields', async () => {
    const registration = await source('server/runtime/registration-orchestrator.ts');
    expect(registration).toContain('encounterId,');
    expect(registration).toContain("currentStage: 'REGISTERED'");
    expect(registration).toContain("clinicalState: 'REGISTERED'");
    expect(registration).toContain("operationalState: 'QUEUED'");
    expect(registration).toContain('financialClearanceState:');
    expect(registration).toContain("resourceAssignmentState: 'NONE'");
  });

  test('OPD workspace quarantines synthetic clinical state to DEMO and does not forge audit hashes', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    expect(opd).toContain("const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO'");
    expect(opd).toContain('IS_DEMO_RUNTIME ? SEED_PATIENTS : []');
    expect(opd).toContain('IS_DEMO_RUNTIME ? SEED_ENCOUNTERS : []');
    expect(opd).not.toContain("tenantId: 'ghims-metropolitan-hospital'");
    expect(opd).not.toContain('Math.random().toString(36).substring(2, 12)');
    expect(opd).toContain("hash: 'DEMO-NON-AUTHORITATIVE'");
  });

  test('OPD clinical mutations use authoritative registration and CommandBus paths', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    for (const command of [
      'CreateOpdEncounterCommand',
      'UpdateOpdQueueStatusCommand',
      'RecordVitalsCommand',
      'AdvanceStageCommand',
      'SignClinicalNoteCommand',
      'PlaceDiagnosticOrderCommand',
      'PrescribeMedicationCommand',
      'DispensePrescriptionCommand',
      'CommitEncounterDispositionCommand',
      'RecordCashReceiptCommand',
    ]) expect(opd).toContain(command);
    expect(opd).toContain('registerActiveTenantPatient');
  });

  test('care transitions treat inpatient hospitalization as encounter lifecycle plus resource assignment', async () => {
    const service = await source('lib/backend/services/care-transition-domain-service.ts');
    expect(service).toContain('AdmitPatientToInpatientCarePayload');
    expect(service).toContain("aggregateType: 'ENCOUNTER'");
    expect(service).toContain("{ entityType: 'HOSPITAL_BED'");
    expect(service).toContain("{ entityType: 'PATIENT_MPI'");
    expect(service).toContain("eventType: 'INPATIENT_ADMISSION_CREATED'");
    expect(service).toContain("status: 'DISCHARGED'");
    expect(service).toContain("resourceAssignmentState: 'RELEASED'");
    expect(service).toContain("eventType: 'INPATIENT_ENCOUNTER_DISCHARGED'");
  });

  test('inpatient discharge requires server evidence, not client booleans', async () => {
    const service = await source('lib/backend/services/care-transition-domain-service.ts');
    expect(service).toContain('DISCHARGE_SUMMARY_REQUIRED');
    expect(service).toContain('UNRESOLVED_STAT_ORDERS');
    expect(service).toContain('MEDICATION_RECONCILIATION_REQUIRED');
    expect(service).toContain('DISCHARGE_NEWS2_UNVERIFIED');
    expect(service).toContain('HIGH_CLINICAL_DETERIORATION_RISK');
  });

  test('medication reconciliation and NEWS2 evidence are server-side clinical documentation', async () => {
    const documentation = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    expect(documentation).toContain('calculateNEWS2');
    expect(documentation).toContain("news2Status: news2 ? 'VERIFIED' : 'INCOMPLETE_INPUT'");
    expect(documentation).toContain('completeMedicationReconciliation');
    expect(documentation).toContain("evidenceType: 'MEDICATION_RECONCILIATION'");
    expect(documentation).toContain("status: 'FINAL'");
  });

  test('master CommandBus exposes Patient 360 foundation commands', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    for (const command of [
      'CreateOpdEncounterCommand',
      'CommitEncounterDispositionCommand',
      'CompleteMedicationReconciliationCommand',
      'AdmitPatientToInpatientCareCommand',
      'DischargeInpatientEncounterCommand',
    ]) expect(bus).toContain(command);
  });
});
