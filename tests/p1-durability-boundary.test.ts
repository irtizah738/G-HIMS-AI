/**
 * P1 durability and command-boundary source regression guards.
 *
 * These tests protect architectural invariants that complement the Firestore
 * emulator durability suite.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('G-HIMS P1 durability boundary regression guards', () => {
  test('authoritative aggregate snapshots are document replacements, not merge patches', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(tx).toContain('transaction.set(stateRef, toDocumentData(params.domainState, params.aggregateType));');
    expect(tx).toContain('transaction.set(stateRef, toDocumentData(write.domainState, write.entityType));');
    expect(tx).toContain('transaction.set(stateRef, toDocumentData(payload.domainState, payload.entityType));');

    expect(tx).not.toContain(
      'transaction.set(stateRef, toDocumentData(params.domainState, params.aggregateType), { merge: true })'
    );
    expect(tx).not.toContain(
      'transaction.set(stateRef, toDocumentData(payload.domainState, payload.entityType), { merge: true })'
    );
  });

  test('outbox processing has a recoverable lease', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const types = await source('lib/backend/types.ts');

    expect(types).toContain('processingStartedAt?: number');
    expect(types).toContain('leaseExpiresAt?: number');
    expect(tx).toContain('OUTBOX_LEASE_MS');
    expect(tx).toContain("record.status === 'PROCESSING'");
    expect(tx).toContain('record.leaseExpiresAt');
  });

  test('legacy HospitalContext cannot write directly to Firestore authority collections', async () => {
    const context = await source('lib/context/hospital-context.tsx');

    for (const forbidden of [
      'syncPatientToFirestore',
      'syncBedToFirestore',
      'syncMismatchToFirestore',
      'syncOpdTokenToFirestore',
      'syncAuditLogToFirestore',
      'syncHl7ToFirestore',
      'syncTelehealthSessionToFirestore',
    ]) {
      expect(context).not.toContain(forbidden);
    }
  });

  test('offline sync uses server command replay and never fabricates zero-conflict success', async () => {
    const context = await source('lib/context/hospital-context.tsx');
    const engine = await source('lib/offline/sync-engine.ts');

    expect(context).toContain('syncEngine.processSyncQueue()');
    expect(context).not.toContain('Replayed 100% of pending offline mutations');
    expect(engine).toContain("fetch('/api/sync/batch'");
    expect(engine).toContain('LEGACY_RAW_MUTATION_REJECTED');
    expect(engine).not.toContain("from 'firebase/firestore'");
  });

  test('patient merge is a governed backend command', async () => {
    const context = await source('lib/context/hospital-context.tsx');
    const mergeService = await source('lib/backend/services/patient-merge-domain-service.ts');

    expect(context).toContain("'MergePatientCommand'");
    expect(mergeService).toContain('DomainStateRepository.getById<PatientMPI>');
    expect(mergeService).toContain("status: 'MERGED'");
    expect(mergeService).toContain('additionalStateWrites');
  });

  test('patient identity confirmation reads persistent canonical patient state', async () => {
    const identity = await source('lib/backend/services/patient-identity-domain-service.ts');
    const confirmStart = identity.indexOf('public static async confirmPatientIdentity(');
    const validateStart = identity.indexOf('public static validatePatientContext(', confirmStart);

    expect(confirmStart).toBeGreaterThanOrEqual(0);
    const confirmBody = identity.slice(confirmStart, validateStart);

    expect(confirmBody).toContain("DomainStateRepository.getById<PatientMPI>");
    expect(confirmBody).not.toContain('PATIENTS_STORE.get');
  });

  test('reduced-shape RegisterPatientCommand cannot write the patient collection', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');

    const start = bus.indexOf("case 'RegisterPatientCommand':");
    const end = bus.indexOf("case 'MergePatientCommand':", start);
    expect(start).toBeGreaterThanOrEqual(0);

    const registrationCase = bus.slice(start, end);
    expect(registrationCase).toContain('REGISTRATION_ORCHESTRATOR_REQUIRED');
    expect(registrationCase).not.toContain('PatientIdentityDomainService.registerPatient');
  });

  test('canonical patient aggregate includes operational pointers used by inpatient care', async () => {
    const mpi = await source('types/mpi.ts');
    const registration = await source('server/runtime/registration-orchestrator.ts');
    const inpatient = await source('lib/backend/services/inpatient-bed-domain-service.ts');

    expect(mpi).toContain("status?: 'ACTIVE' | 'MERGED' | 'DECEASED' | 'INACTIVE'");
    expect(mpi).toContain('activeEncounterId?: string');
    expect(mpi).toContain('activeBedId?: string');
    expect(registration).toContain("status: 'ACTIVE'");
    expect(registration).toContain('activeEncounterId: encounterId');
    expect(inpatient).toContain("import { PatientMPI } from '@/types/mpi'");
  });

  test('Revenue Integrity findings are server-generated from signed evidence and reviewed through commands', async () => {
    const documentation = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const revenue = await source('lib/backend/services/revenue-integrity-domain-service.ts');
    const context = await source('lib/context/hospital-context.tsx');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(documentation).toContain("entityType: 'REVENUE_INTEGRITY_FINDING'");
    expect(documentation).toContain('revenueIntegrityFindingIds');
    expect(revenue).toContain('ReconcileRevenueIntegrityFindingPayload');
    expect(revenue).toContain("status: 'PENDING_INVOICE'");
    expect(revenue).toContain('estimatedRecoverableAmountMinorUnits');
    expect(context).toContain("'ReconcileRevenueIntegrityFindingCommand'");
    expect(context).toContain("'DismissRevenueIntegrityFindingCommand'");
    expect(tx).toContain("REVENUE_INTEGRITY_FINDING: 'billingMismatches'");
    expect(tx).toContain("ENCOUNTER_CHARGE: 'encounterCharges'");
  });

});
