'use client';

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
