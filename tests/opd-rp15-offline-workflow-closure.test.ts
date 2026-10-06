import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OfflineReconciliationDomainService } from '@/lib/backend/services/offline-reconciliation-domain-service';
import type { CommandContext, OfflineSyncBatch } from '@/lib/backend/types';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const context: CommandContext = {
  actorId: 'actor-rp15',
  tenantId: 'tenant-rp15',
  roles: ['RECEPTIONIST'],
  permissions: [],
  correlationId: 'corr-rp15',
  requestId: 'req-rp15',
};

describe('OPD-RP15 offline workflow closure', () => {
  test('offline registration remains billing-first and preserves payer and consent replay', async () => {
    const client = await source('lib/api/command-client.ts');
    const reconcile = await source(
      'lib/backend/services/offline-reconciliation-domain-service.ts'
    );

    expect(client).toContain("status: 'payment_pending'");
    expect(client).toContain("'CreateOpdConsultationInvoiceCommand'");
    expect(client).toContain('dependsOnMutationIds: [commandId]');
    expect(client).toContain('consultationInvoicePendingSync');
    expect(client).toContain("financialClearanceState:");
    expect(client).toContain("'CONSULTATION_PAYMENT_PENDING'");

    expect(reconcile).toContain('tariffPlan: payload.tariffPlan');
    expect(reconcile).toContain('insuranceDetails:');
    expect(reconcile).toContain('consentDecisions:');
    expect(reconcile).toContain("source: 'offline'");
  });

  test('outbox dependencies are encrypted, transmitted and enforced server-side', async () => {
    const offlineTypes = await source('types/offline.ts');
    const secure = await source('lib/offline/secure-store.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const reconcile = await source(
      'lib/backend/services/offline-reconciliation-domain-service.ts'
    );

    expect(offlineTypes).toContain('dependsOnMutationIds?: string[]');
    expect(secure).toContain('dependsOnMutationIds: input.dependsOnMutationIds');
    expect(engine).toContain('dependsOnMutationIds: mutation.dependsOnMutationIds');
    expect(reconcile).toContain('orderMutationsByDependencies');
    expect(reconcile).toContain("'OFFLINE_DEPENDENCY_CYCLE");
    expect(reconcile).toContain('OFFLINE_DEPENDENCY_NOT_ACCEPTED');
  });

  test('dependency cycle is quarantined before any command can replay', async () => {
    const batch: OfflineSyncBatch = {
      deviceId: 'device-rp15',
      tenantId: context.tenantId,
      actorId: context.actorId,
      batchId: 'batch-cycle-rp15',
      submittedAt: Date.now(),
      mutations: [
        {
          mutationId: 'mut-a',
          occurredAt: 1,
          commandType: 'RecordVitalsCommand',
          collection: 'encounterEvidence',
          payload: {},
          idempotencyKey: 'idem-a',
          entityId: 'ev-a',
          schemaVersion: 1,
          dependsOnMutationIds: ['mut-b'],
        },
        {
          mutationId: 'mut-b',
          occurredAt: 2,
          commandType: 'SignClinicalNoteCommand',
          collection: 'encounterEvidence',
          payload: {},
          idempotencyKey: 'idem-b',
          entityId: 'ev-b',
          schemaVersion: 1,
          dependsOnMutationIds: ['mut-a'],
        },
      ],
    };

    const result =
      await OfflineReconciliationDomainService.processSyncBatch(
        context,
        batch
      );

    expect(result.summary.accepted).toBe(0);
    expect(result.summary.rejected).toBe(0);
    expect(result.summary.conflicted).toBe(2);
    expect(result.results.every((item) =>
      item.status === 'requires_review' &&
      item.reason?.includes('OFFLINE_DEPENDENCY_CYCLE')
    )).toBe(true);
  });

  test('triage SOAP and diagnostics are captured as one causal offline chain', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain('offlineWorkflowTail');
    expect(workspace).toContain('dependsOnMutationIds: vitalsResult.queuedOffline');
    expect(workspace).toContain('dependsOnMutationIds: noteResult.queuedOffline');
    expect(workspace).toContain("'PENDING_SERVER_REPLAY'");
    expect(workspace).toContain("'OFFLINE_PENDING_SYNC'");
    expect(workspace).toContain(
      "'STAT_DIAGNOSTIC_REQUIRES_ONLINE_AUTHORITY"
    );
  });

  test('offline cash capture never grants local financial or operational clearance', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const billing = await source('components/opd/OpdBillingLedger.tsx');
    const readModel = await source('lib/opd/workspace-read-model.ts');
    const reconcile = await source(
      'lib/backend/services/offline-reconciliation-domain-service.ts'
    );

    expect(workspace).toContain("status: 'PENDING'");
    expect(workspace).toContain("collection: 'cashReceipts'");
    expect(workspace).toContain('if (result.queuedOffline)');
    expect(billing).toContain('CASH CAPTURED — POSTING PENDING');
    expect(billing).toContain('pendingOfflineReceipt');
    expect(readModel).toContain('rawCashReceipts');
    expect(readModel).toContain("status =");
    expect(reconcile).toContain("category === 'FINANCIAL_CONFLICT'");
  });

  test('OPD uses real encrypted sync telemetry instead of a fake local sync switch', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const manager = await source('components/opd/OpdOfflineSyncManager.tsx');

    expect(workspace).toContain('useOfflineStatus');
    expect(workspace).toContain('triggerSync');
    expect(workspace).toContain('ghims:edge-sync-complete');
    expect(workspace).not.toContain(
      "alert('Offline IndexedDB outbox batch synced to Firestore with zero conflict exceptions.')"
    );
    expect(manager).toContain('conflictsCount');
    expect(manager).toContain('Last sync failed');
    expect(manager).toContain('Connectivity is derived from verified application reachability');
  });

  test('shared safety authorities remain reconnect-required', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const pharmacy = await source(
      'components/opd/OpdPharmacyPrescriptions.tsx'
    );

    for (const operation of [
      'appointment booking',
      'appointment check-in',
      'shared OPD queue call',
      'OPD queue service start',
      'medication prescribing safety evaluation',
      'physical FEFO pharmacy dispensing',
      'final billing reconciliation',
      'final disposition and care transition',
    ]) {
      expect(workspace).toContain(
        `requireOnlineOpdAuthority('${operation}')`
      );
    }

    expect(pharmacy).toContain('onlineAuthorityAvailable');
    expect(pharmacy).toContain(
      'Medication prescribing requires live server authority'
    );
    expect(pharmacy).toContain(
      'Cached medication and prescription history remain readable offline'
    );
  });
});
