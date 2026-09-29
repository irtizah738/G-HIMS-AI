// ============================================================================
// G-HIMS SCM: Unified Edge Cache & Governed Transactional Sync Queue
// ============================================================================

import type { InventoryBalance } from '@/types/scm-domain';
import {
  deleteMutation,
  getLocalMutations,
  listEdgeEntities,
  putEdgeEntity,
} from '@/lib/offline/db';
import { syncEngine } from '@/lib/offline/sync-engine';

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

const SCM_COLLECTION = 'scm_commands';

function commandTypeForMutation(type: PendingSyncMutation['mutationType']): string {
  switch (type) {
    case 'RECORD_STOCK_TRANSACTION':
      return 'RecordStockTransactionCommand';
    case 'RECORD_PATIENT_CONSUMPTION':
      return 'RecordPatientConsumptionCommand';
    case 'SUBMIT_REQUISITION':
      return 'SubmitInventoryRequisitionCommand';
    default:
      throw new Error('SCM_OFFLINE_COMMAND_UNSUPPORTED');
  }
}

function resourceIdForMutation(mutation: PendingSyncMutation): string {
  const payload = mutation.payload as Record<string, any>;
  return String(
    payload.balanceId ||
    payload.transactionId ||
    payload.consumptionId ||
    payload.requisitionId ||
    mutation.id
  );
}

export async function cacheBalancesLocally(balances: InventoryBalance[]): Promise<void> {
  await Promise.all(
    balances.map((balance) =>
      putEdgeEntity(
        balance.tenantId,
        'inventoryBalances',
        balance.balanceId,
        balance as unknown as Record<string, unknown>,
        balance.version
      )
    )
  );
}

export async function getLocalBalances(tenantId?: string): Promise<InventoryBalance[]> {
  if (tenantId) {
    return listEdgeEntities<InventoryBalance & Record<string, unknown>>(
      tenantId,
      'inventoryBalances'
    ) as Promise<InventoryBalance[]>;
  }

  // A cross-tenant browser inventory listing is deliberately unsupported.
  // Callers must bind SCM reads to the active authenticated tenant.
  return [];
}

export async function enqueueOfflineMutation(mutation: PendingSyncMutation): Promise<void> {
  if (!syncEngine) {
    throw new Error('SCM_EDGE_QUEUE_UNAVAILABLE');
  }

  await syncEngine.queueMutation({
    tenantId: mutation.tenantId,
    collection: SCM_COLLECTION,
    action: 'CREATE',
    resourceId: resourceIdForMutation(mutation),
    commandType: commandTypeForMutation(mutation.mutationType),
    payload: {
      ...mutation.payload,
      scmMutationType: mutation.mutationType,
      scmCreatedAt: mutation.createdAt,
    },
    idempotencyKey: mutation.idempotencyKey,
    schemaVersion: 1,
    mutationId: mutation.id,
  });
}

export async function getPendingSyncQueue(tenantId?: string): Promise<PendingSyncMutation[]> {
  const rows = await getLocalMutations(tenantId);
  return rows
    .filter((mutation) => mutation.collection === SCM_COLLECTION)
    .map((mutation) => ({
      id: mutation.id,
      tenantId: mutation.tenantId,
      mutationType: String(
        (mutation.payload as any).scmMutationType || ''
      ) as PendingSyncMutation['mutationType'],
      payload: mutation.payload,
      idempotencyKey: mutation.idempotencyKey || '',
      createdAt: String(
        (mutation.payload as any).scmCreatedAt ||
        new Date(mutation.clientTimestamp || mutation.timestamp).toISOString()
      ),
      retryCount: mutation.retryCount || 0,
      lastError: mutation.errorMessage,
    }));
}

export async function removePendingSyncMutation(id: string): Promise<void> {
  await deleteMutation(id);
}
