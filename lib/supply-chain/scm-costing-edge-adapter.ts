'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  ApproveCycleCountPayload,
  FinalizeInventoryPeriodClosePayload,
  GovernedCycleCountRecord,
  InventoryPeriodCloseRecord,
  StartInventoryPeriodClosePayload,
  SubmitCycleCountPayload,
} from '@/types/scm-costing';

export async function submitCycleCountEdge(
  payload: SubmitCycleCountPayload,
  idempotencyKey?: string
): Promise<GovernedCycleCountRecord> {
  const result = await executeActiveTenantCommand<GovernedCycleCountRecord>(
    'SubmitCycleCountCommand',
    payload as unknown as Record<string, unknown>,
    {
      idempotencyKey,
      schemaVersion: 1,
      offlineQueue: {
        enabled: true,
        collection: 'scmCycleCounts',
        resourceId: payload.countId,
        action: 'CREATE',
        optimisticCache: true,
      },
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Cycle count submission failed.');
  }
  return result.data as GovernedCycleCountRecord;
}

async function executeOnlineOnly<T>(
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const result = await executeActiveTenantCommand<T>(
    commandType,
    payload,
    { idempotencyKey, schemaVersion: 1 }
  );
  if (!result.success) {
    throw new Error(result.error?.message || `${commandType} failed.`);
  }
  return result.data as T;
}

export function approveCycleCountEdge(
  payload: ApproveCycleCountPayload,
  idempotencyKey?: string
) {
  return executeOnlineOnly<GovernedCycleCountRecord>(
    'ApproveCycleCountCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function startInventoryPeriodCloseEdge(
  payload: StartInventoryPeriodClosePayload,
  idempotencyKey?: string
) {
  return executeOnlineOnly<InventoryPeriodCloseRecord>(
    'StartInventoryPeriodCloseCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function finalizeInventoryPeriodCloseEdge(
  payload: FinalizeInventoryPeriodClosePayload,
  idempotencyKey?: string
) {
  return executeOnlineOnly<InventoryPeriodCloseRecord>(
    'FinalizeInventoryPeriodCloseCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}
