'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { getEdgeSyncMetadata } from '@/lib/offline/db';
import {
  listSecureEdgeEntities,
  replaceSecureTenantEdgeSnapshot,
} from '@/lib/offline/secure-store';
import { enforceEdgeStorageBudget } from '@/lib/offline/storage-manager';
import { OPD_EDGE_COLLECTIONS } from '@/lib/opd/edge-surface';

export type EdgeHydrationSurface = 'OPD' | 'CLINICAL' | 'BILLING' | 'FINANCE' | 'HCM' | 'SCM' | 'FACILITIES' | 'GENERIC';

export interface EdgeSnapshot {
  tenantId: string;
  generatedAt: number;
  snapshotVersion: string;
  collections: Record<string, Array<Record<string, unknown>>>;
  source: 'LOCAL' | 'SERVER';
}

export async function loadLocalEdgeSnapshot(
  tenantId: string,
  surface: EdgeHydrationSurface = 'GENERIC'
): Promise<EdgeSnapshot> {
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

  const surfaceCollections: Record<Exclude<EdgeHydrationSurface, 'OPD'>, string[]> = {
    CLINICAL: [
      'patients', 'encounters', 'encounterEvidence', 'orders', 'prescriptions',
      'opd_queue', 'opdAppointments', 'opdWaitlist', 'beds', 'surgicalCases',
      'orRoomSchedules', 'patient360Projections', 'dischargeReadinessProjections',
      'deteriorationProjections', 'medicationSafetyProjections', 'clinicalOpenItems',
      'clinicalEscalations', 'consultationRequests', 'clinicalHandoffs',
    ],
    BILLING: [
      'patients', 'encounters', 'billingMismatches', 'encounterCharges',
      'invoices', 'invoiceSettlements', 'arOpenItems', 'journalEntries', 'cashReceipts',
    ],
    FINANCE: [
      'accounts', 'accountingPeriods', 'journalEntries', 'cashReceipts', 'arOpenItems',
      'financeArReceipts', 'financeArAdjustments', 'financeArAgingSnapshots',
      'treasuryAccounts', 'cashRegisterShifts', 'financeBankReconciliations',
      'financeApAgingSnapshots', 'financeCostCenters', 'financeBudgets',
      'financeBudgetCommitments', 'financeFixedAssets', 'financeDepreciationRuns',
      'financeStatementSnapshots', 'financeTaxSummarySnapshots', 'financeIntelligenceSnapshots',
    ],
    HCM: [
      'employees', 'employeeAssignments', 'clinicalCredentials', 'clinicalPrivileges',
      'rosterAssignments', 'attendanceRecords', 'leaveRequests', 'leaveBalances',
    ],
    SCM: [
      'items', 'inventoryBalances', 'batches', 'stockTransactions', 'patientConsumptions',
      'purchaseRequisitions', 'inventoryLocations', 'scmPurchaseOrders', 'goodsReceiptNotes',
      'stockTransfers', 'recallCases', 'suppliers', 'threeWayMatches',
    ],
    FACILITIES: [
      'beds', 'resources', 'rooms', 'resourceReservations',
      'maintenanceWorkOrders', 'calibrationRecords',
    ],
    // GENERIC is a compatibility surface. It is role-scoped by the server, but
    // administrators never use it because tenant-wide offline caching is forbidden.
    GENERIC: [],
  };

  const normalizedRoles = new Set(
    (cached?.user?.roles || []).map((role) => String(role).trim().toUpperCase())
  );
  const isAdmin = ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN'].some((role) =>
    normalizedRoles.has(role)
  );

  const collectionsToLoad =
    surface === 'OPD'
      ? [...OPD_EDGE_COLLECTIONS]
      : surface === 'GENERIC' && !isAdmin
        ? [...new Set(Object.values(surfaceCollections).flat())]
        : surfaceCollections[surface];

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

export async function hydrateEdgeSnapshot(
  tenantId: string,
  options: { surface?: EdgeHydrationSurface } = {}
): Promise<EdgeSnapshot> {
  const surface = options.surface || 'GENERIC';
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!normalizedTenantId || !currentUser || !cached) {
    return loadLocalEdgeSnapshot(normalizedTenantId, surface);
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
        `/api/offline/bootstrap?tenantId=${encodeURIComponent(
          normalizedTenantId
        )}&surface=${encodeURIComponent(surface)}`,
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
      return loadLocalEdgeSnapshot(normalizedTenantId, surface);
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
    return loadLocalEdgeSnapshot(normalizedTenantId, surface);
  }
}
