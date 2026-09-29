'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { getEdgeSyncMetadata } from '@/lib/offline/db';
import {
  listSecureEdgeEntities,
  replaceSecureTenantEdgeSnapshot,
} from '@/lib/offline/secure-store';
import { enforceEdgeStorageBudget } from '@/lib/offline/storage-manager';

export interface EdgeSnapshot {
  tenantId: string;
  generatedAt: number;
  snapshotVersion: string;
  collections: Record<string, Array<Record<string, unknown>>>;
  source: 'LOCAL' | 'SERVER';
}

export async function loadLocalEdgeSnapshot(tenantId: string): Promise<EdgeSnapshot> {
  const cached = await getCachedAuthSession();
  const actorId = cached?.user?.uid || '';
  if (!actorId) {
    return {
      tenantId,
      generatedAt: 0,
      snapshotVersion: 'local-locked',
      collections: {},
      source: 'LOCAL',
    };
  }

  const collectionsToLoad = [
    'patients',
    'encounters',
    'encounterEvidence',
    'orders',
    'prescriptions',
    'opd_queue',
    'beds',
    'billingMismatches',
    'encounterCharges',
    'journalEntries',
    'telehealthSessions',
    'employees',
    'items',
    'inventoryBalances',
    'batches',
    'stockTransactions',
    'patientConsumptions',
    'purchaseRequisitions',
    'inventoryLocations',
    'scmPurchaseOrders',
    'goodsReceiptNotes',
    'stockTransfers',
    'recallCases',
    'suppliers',
    'threeWayMatches',
  ];

  const entries = await Promise.all(
    collectionsToLoad.map(async (collection) => [
      collection,
      await listSecureEdgeEntities(tenantId, actorId, collection),
    ] as const)
  );
  const metadata = await getEdgeSyncMetadata(tenantId);

  return {
    tenantId,
    generatedAt: metadata?.serverGeneratedAt || metadata?.lastHydratedAt || 0,
    snapshotVersion: metadata?.snapshotVersion || 'local-unhydrated',
    collections: Object.fromEntries(entries),
    source: 'LOCAL',
  };
}

export async function hydrateEdgeSnapshot(tenantId: string): Promise<EdgeSnapshot> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!normalizedTenantId || !currentUser || !cached) {
    return loadLocalEdgeSnapshot(normalizedTenantId);
  }

  if (cached.user.tenantId.trim().toLowerCase() !== normalizedTenantId) {
    throw new Error('EDGE_HYDRATION_TENANT_MISMATCH');
  }

  try {
    const idToken = await currentUser.getIdToken(false);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    let response: Response;

    try {
      response = await fetch(
        `/api/offline/bootstrap?tenantId=${encodeURIComponent(normalizedTenantId)}`,
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${idToken}`,
            'x-ghims-tenant-id': normalizedTenantId,
            'x-ghims-session-id': cached.session.sessionId,
            ...(cached.session.deviceId
              ? { 'x-ghims-device-id': cached.session.deviceId }
              : {}),
          },
        }
      );
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        throw new Error('EDGE_HYDRATION_AUTHORIZATION_FAILED');
      }
      return loadLocalEdgeSnapshot(normalizedTenantId);
    }

    const payload = await response.json();
    if (!payload?.success || payload.tenantId !== normalizedTenantId) {
      throw new Error('EDGE_HYDRATION_INVALID_SNAPSHOT');
    }

    await replaceSecureTenantEdgeSnapshot(
      normalizedTenantId,
      cached.user.uid,
      payload.collections || {},
      {
        snapshotVersion: String(payload.snapshotVersion || `${normalizedTenantId}:${Date.now()}`),
        lastHydratedAt: Date.now(),
        serverGeneratedAt: Number(payload.generatedAt || Date.now()),
      }
    );
    await enforceEdgeStorageBudget(normalizedTenantId).catch(() => {});

    return {
      tenantId: normalizedTenantId,
      generatedAt: Number(payload.generatedAt || Date.now()),
      snapshotVersion: String(payload.snapshotVersion),
      collections: payload.collections || {},
      source: 'SERVER',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('AUTHORIZATION') || message.includes('TENANT_MISMATCH')) throw error;
    return loadLocalEdgeSnapshot(normalizedTenantId);
  }
}
