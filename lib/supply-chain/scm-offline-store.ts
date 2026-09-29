// ============================================================================
// G-HIMS SCM: Unified Offline-First Edge Adapter
// Uses the same encrypted IndexedDB + governed outbox as clinical workflows.
// ============================================================================

import type { InventoryBalance } from '@/types/scm-domain';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { syncEngine } from '@/lib/offline/sync-engine';
import {
  getSecurePendingMutations,
  listSecureEdgeEntities,
  putSecureEdgeEntities,
} from '@/lib/offline/secure-store';
import { deleteMutation } from '@/lib/offline/db';

export interface PendingSyncMutation {
  id: string;
  tenantId: string;
  mutationType: 'RECORD_STOCK_TRANSACTION' | 'RECORD_PATIENT_CONSUMPTION' | 'SUBMIT_REQUISITION';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

const COMMAND_BY_MUTATION: Record<PendingSyncMutation['mutationType'], {
  commandType: string;
  collection: string;
}> = {
  RECORD_STOCK_TRANSACTION: {
    commandType: 'RecordStockTransactionCommand',
    collection: 'stockTransactions',
  },
  RECORD_PATIENT_CONSUMPTION: {
    commandType: 'RecordPatientConsumptionCommand',
    collection: 'patientConsumptions',
  },
  SUBMIT_REQUISITION: {
    commandType: 'SubmitPurchaseRequisitionCommand',
    collection: 'purchaseRequisitions',
  },
};

function resourceIdFor(mutation: PendingSyncMutation): string {
  return String(
    mutation.payload.transactionId ||
    mutation.payload.consumptionId ||
    mutation.payload.requisitionId ||
    mutation.id
  );
}

export async function cacheBalancesLocally(balances: InventoryBalance[]): Promise<void> {
  const cached = await getCachedAuthSession();
  if (!cached?.user?.uid || balances.length === 0) return;

  await putSecureEdgeEntities(
    cached.user.tenantId,
    cached.user.uid,
    'inventoryBalances',
    balances as unknown as Array<Record<string, unknown>>
  );
}

export async function getLocalBalances(): Promise<InventoryBalance[]> {
  const cached = await getCachedAuthSession();
  if (!cached?.user?.uid) return [];

  return listSecureEdgeEntities<InventoryBalance & Record<string, unknown>>(
    cached.user.tenantId,
    cached.user.uid,
    'inventoryBalances'
  ) as Promise<InventoryBalance[]>;
}

export async function enqueueOfflineMutation(mutation: PendingSyncMutation): Promise<void> {
  const cached = await getCachedAuthSession();
  if (!cached?.user?.uid) {
    throw new Error('AUTHENTICATION_REQUIRED: SCM offline command requires an active cached session.');
  }
  if (cached.user.tenantId !== mutation.tenantId) {
    throw new Error('TENANT_MISMATCH: SCM mutation tenant differs from active session.');
  }
  if (!syncEngine) throw new Error('OFFLINE_QUEUE_UNAVAILABLE');

  const policy = COMMAND_BY_MUTATION[mutation.mutationType];
  await syncEngine.queueMutation({
    tenantId: mutation.tenantId,
    collection: policy.collection,
    action: 'CREATE',
    resourceId: resourceIdFor(mutation),
    commandType: policy.commandType,
    payload: mutation.payload,
    idempotencyKey: mutation.idempotencyKey,
    schemaVersion: 1,
    optimisticCache: true,
    mutationId: mutation.id,
  });
}

export async function getPendingSyncQueue(): Promise<PendingSyncMutation[]> {
  const cached = await getCachedAuthSession();
  if (!cached) return [];
  const rows = await getSecurePendingMutations(cached.user.tenantId);

  return rows
    .filter((row) =>
      ['RecordStockTransactionCommand','RecordPatientConsumptionCommand','SubmitPurchaseRequisitionCommand']
        .includes(String(row.commandType || ''))
    )
    .map((row) => {
      const mutationType: PendingSyncMutation['mutationType'] =
        row.commandType === 'RecordStockTransactionCommand'
          ? 'RECORD_STOCK_TRANSACTION'
          : row.commandType === 'RecordPatientConsumptionCommand'
            ? 'RECORD_PATIENT_CONSUMPTION'
            : 'SUBMIT_REQUISITION';

      return {
        id: row.id,
        tenantId: row.tenantId,
        mutationType,
        payload: row.payload,
        idempotencyKey: row.idempotencyKey || row.id,
        createdAt: new Date(row.clientTimestamp || row.timestamp).toISOString(),
        retryCount: row.retryCount,
        lastError: row.errorMessage,
      };
    });
}

export async function removePendingSyncMutation(id: string): Promise<void> {
  await deleteMutation(id);
}
