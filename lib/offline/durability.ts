'use client';

import { localDb } from '@/lib/offline/db';

export interface EdgeStorageHealth {
  persistenceSupported: boolean;
  persistent: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
  usageRatio: number | null;
  prunedRecords: number;
}

const HIGH_WATERMARK = 0.85;
const READ_MODEL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function pruneDisposableEdgeReadModels(
  now = Date.now()
): Promise<number> {
  const staleEdgeCutoff = now - READ_MODEL_RETENTION_MS;
  const staleCacheCutoff = now - CACHE_RETENTION_MS;

  // Never prune mutations, entity mappings or sync metadata here. Pending
  // commands are durable obligations; only reconstructable read projections
  // and transient cache/conflict records are eligible.
  const [edgeRows, cacheRows] = await Promise.all([
    localDb.edge_entities
      .filter((row) => row.updatedAt < staleEdgeCutoff)
      .toArray(),
    localDb.offline_cache
      .filter((row) => row.updatedAt < staleCacheCutoff && row.collection !== 'conflicts')
      .toArray(),
  ]);

  const protectedCollections = new Set([
    'patients',
    'encounters',
    'beds',
    'opd_queue',
  ]);
  const edgeKeys = edgeRows
    .filter((row) => !protectedCollections.has(row.collection))
    .map((row) => row.key);
  const cacheKeys = cacheRows.map((row) => row.key);

  if (edgeKeys.length > 0) await localDb.edge_entities.bulkDelete(edgeKeys);
  if (cacheKeys.length > 0) await localDb.offline_cache.bulkDelete(cacheKeys);

  return edgeKeys.length + cacheKeys.length;
}

export async function initializeEdgeDurability(): Promise<EdgeStorageHealth> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return {
      persistenceSupported: false,
      persistent: null,
      quotaBytes: null,
      usageBytes: null,
      usageRatio: null,
      prunedRecords: 0,
    };
  }

  let persistent: boolean | null = null;
  try {
    if (typeof navigator.storage.persist === 'function') {
      persistent = await navigator.storage.persist();
    } else if (typeof navigator.storage.persisted === 'function') {
      persistent = await navigator.storage.persisted();
    }
  } catch {
    persistent = null;
  }

  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  let usageRatio: number | null = null;

  try {
    const estimate = await navigator.storage.estimate();
    quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
    usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    usageRatio =
      quotaBytes && usageBytes != null && quotaBytes > 0
        ? usageBytes / quotaBytes
        : null;
  } catch {
    // Browser quota telemetry is advisory; IndexedDB remains usable.
  }

  let prunedRecords = 0;
  if (usageRatio != null && usageRatio >= HIGH_WATERMARK) {
    prunedRecords = await pruneDisposableEdgeReadModels();
  }

  return {
    persistenceSupported: true,
    persistent,
    quotaBytes,
    usageBytes,
    usageRatio,
    prunedRecords,
  };
}

export async function assertEdgeStorageWritable(): Promise<void> {
  const probeKey = `durability-probe:${crypto.randomUUID()}`;
  await localDb.sync_metadata.put({
    key: probeKey,
    tenantId: '__system__',
    scope: 'durability-probe',
    snapshotVersion: 'probe',
    lastHydratedAt: Date.now(),
  });
  await localDb.sync_metadata.delete(probeKey);
}
