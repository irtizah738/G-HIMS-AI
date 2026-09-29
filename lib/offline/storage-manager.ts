'use client';

import { localDb } from '@/lib/offline/db';

export interface EdgeStorageStatus {
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  utilization: number | null;
}

export async function ensurePersistentEdgeStorage(): Promise<EdgeStorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { persisted: false, usageBytes: null, quotaBytes: null, utilization: null };
  }

  let persisted = false;
  try {
    persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch {
    persisted = false;
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    const estimate = await navigator.storage.estimate();
    usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
  } catch {
    // Ignore quota lookup failures.
  }

  return {
    persisted,
    usageBytes,
    quotaBytes,
    utilization:
      usageBytes !== null && quotaBytes && quotaBytes > 0
        ? usageBytes / quotaBytes
        : null,
  };
}

export function edgeStoragePressure(status: EdgeStorageStatus): 'NORMAL' | 'HIGH' | 'CRITICAL' {
  const utilization = status.utilization ?? 0;
  if (utilization >= 0.9) return 'CRITICAL';
  if (utilization >= 0.75) return 'HIGH';
  return 'NORMAL';
}


const PRUNABLE_COLLECTIONS = new Set([
  'stockTransactions',
  'patientConsumptions',
  'telehealthSessions',
  'employees',
]);

export async function pruneNonCriticalEdgeHistory(
  tenantId: string,
  maxAgeMs = 30 * 24 * 60 * 60 * 1000
): Promise<number> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId) return 0;

  const cutoff = Date.now() - maxAgeMs;
  const stale = await localDb.edge_entities
    .where('tenantId')
    .equals(normalizedTenantId)
    .filter(
      (row) =>
        PRUNABLE_COLLECTIONS.has(row.collection) &&
        row.updatedAt < cutoff
    )
    .toArray();

  if (stale.length === 0) return 0;
  await localDb.edge_entities.bulkDelete(stale.map((row) => row.key));
  return stale.length;
}

export async function enforceEdgeStorageBudget(
  tenantId: string
): Promise<EdgeStorageStatus & { prunedRecords: number }> {
  let status = await ensurePersistentEdgeStorage();
  let prunedRecords = 0;

  if (edgeStoragePressure(status) === 'CRITICAL') {
    prunedRecords = await pruneNonCriticalEdgeHistory(tenantId);
    status = await ensurePersistentEdgeStorage();
  }

  return { ...status, prunedRecords };
}
