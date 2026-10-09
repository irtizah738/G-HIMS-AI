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
import {
  requireEdgeHydrationSurface,
  type EdgeHydrationSurface,
} from '@/lib/offline/hydration-policy';

export interface EdgeSnapshot {
  tenantId: string;
  generatedAt: number;
  snapshotVersion: string;
  collections: Record<string, Array<Record<string, unknown>>>;
  source: 'LOCAL' | 'SERVER';
  freshness?: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNHYDRATED' | 'DENIED' | 'FAILED' | 'NOT_APPLICABLE';
  errorCode?: string;
}

async function secureAuthorityEpoch(
  actorId: string,
  sessionId: string,
  authorizationRevision: string
): Promise<string> {
  const value = new TextEncoder().encode(
    JSON.stringify({ actorId, sessionId, authorizationRevision })
  );
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadLocalEdgeSnapshot(
  tenantId: string,
  requestedSurface: EdgeHydrationSurface
): Promise<EdgeSnapshot> {
  const surface = requireEdgeHydrationSurface(requestedSurface);
  const cached = await getCachedAuthSession();
  const actorId = cached?.user?.uid || '';
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (cached && (
    cached.user.tenantId.trim().toLowerCase() !== normalizedTenantId ||
    cached.session.tenantId.trim().toLowerCase() !== normalizedTenantId ||
    cached.session.userId !== cached.user.uid
  )) {
    throw new Error('EDGE_HYDRATION_TENANT_MISMATCH');
  }
  const authority = await getEdgeSyncMetadata(normalizedTenantId, 'edge-authority');
  if (
    !actorId ||
    !cached ||
    !authority ||
    authority.actorId !== actorId ||
    authority.sessionId !== cached.session.sessionId ||
    !authority.authorityEpoch
  ) {
    // Never expose legacy cache from a previous session or privilege scope.
    return {
      tenantId: normalizedTenantId,
      generatedAt: 0,
      snapshotVersion: 'local-locked',
      collections: {},
      source: 'LOCAL',
      freshness: 'UNHYDRATED',
    };
  }

  const surfaceCollections: Record<Exclude<EdgeHydrationSurface, 'OPD'>, string[]> = {
    HOSPITAL_SHELL: [
      'patients',
      'encounters',
      'opd_queue',
      'beds',
      'billingMismatches',
      'telehealthSessions',
    ],
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
      'compensationProfiles', 'payrollPeriods', 'payrollEmployeeSlots',
      'payrollPayslips', 'payrollStatutoryLiabilities',
      'payrollComplianceSnapshots', 'hcmIntelligenceSnapshots',
    ],
    SCM: [
      'items', 'inventoryBalances', 'batches', 'stockTransactions', 'patientConsumptions',
      'purchaseRequisitions', 'inventoryLocations', 'scmPurchaseOrders', 'goodsReceiptNotes',
      'stockTransfers', 'recallCases', 'suppliers', 'threeWayMatches',
      'scmCycleCounts', 'scmReplenishmentPolicies', 'scmReplenishmentPlans',
      'scmReplenishmentOrders', 'scmSupplierContracts', 'scmOperationalSnapshots',
    ],
    FACILITIES: [
      'beds', 'resources', 'rooms', 'resourceReservations',
      'maintenanceWorkOrders', 'calibrationRecords',
    ],
  };

  const collectionsToLoad =
    surface === 'OPD'
      ? [...OPD_EDGE_COLLECTIONS]
      : surfaceCollections[surface];

  const entries = await Promise.all(
    collectionsToLoad.map(async (collection) => [
      collection,
      await listSecureEdgeEntities(tenantId, actorId, collection),
    ] as const)
  );
  const metadata = await getEdgeSyncMetadata(normalizedTenantId, surface);

  return {
    tenantId,
    generatedAt: metadata?.serverGeneratedAt || metadata?.lastHydratedAt || 0,
    snapshotVersion: metadata?.snapshotVersion || 'local-unhydrated',
    collections: Object.fromEntries(entries),
    source: 'LOCAL',
    freshness: metadata?.snapshotVersion ? 'STALE' : 'UNHYDRATED',
  };
}

export async function hydrateEdgeSnapshot(
  tenantId: string,
  options: { surface: EdgeHydrationSurface }
): Promise<EdgeSnapshot> {
  const surface = requireEdgeHydrationSurface(options.surface);
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!normalizedTenantId) {
    throw new Error('EDGE_HYDRATION_TENANT_REQUIRED');
  }
  if (!currentUser || !cached) {
    return loadLocalEdgeSnapshot(normalizedTenantId, surface);
  }
  if (
    cached.user.tenantId.trim().toLowerCase() !== normalizedTenantId ||
    cached.session.tenantId.trim().toLowerCase() !== normalizedTenantId ||
    cached.user.uid !== currentUser.uid ||
    cached.session.userId !== currentUser.uid
  ) {
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
      if (response.status >= 400 && response.status < 500) {
        throw new Error('EDGE_HYDRATION_BAD_REQUEST');
      }
      // An HTTP 5xx is a failed server refresh, not evidence of a current,
      // verified empty clinical/financial read model.
      const local = await loadLocalEdgeSnapshot(normalizedTenantId, surface);
      return { ...local, freshness: 'FAILED', errorCode: `EDGE_BOOTSTRAP_HTTP_${response.status}` };
    }

    const payload = await response.json();
    if (
      !payload?.success ||
      payload.tenantId !== normalizedTenantId ||
      payload.surface !== surface ||
      !payload.snapshotVersion ||
      !/^[a-f0-9]{64}$/.test(String(payload.authorizationRevision || '')) ||
      !payload.collections ||
      typeof payload.collections !== 'object' ||
      Array.isArray(payload.collections)
    ) {
      throw new Error('EDGE_HYDRATION_INVALID_SNAPSHOT');
    }

    if (payload.hydrationStatus === 'NOT_APPLICABLE') {
      return {
        tenantId: normalizedTenantId,
        generatedAt: Number(payload.generatedAt || Date.now()),
        snapshotVersion: String(payload.snapshotVersion),
        collections: {},
        source: 'SERVER',
        freshness: 'NOT_APPLICABLE',
      };
    }
    if (payload.hydrationStatus && payload.hydrationStatus !== 'CURRENT') {
      throw new Error('EDGE_HYDRATION_INVALID_SNAPSHOT');
    }

    // In-flight bootstrap requests must not write to another user's or
    // tenant's cache after a switch, logout or session replacement.
    const latest = await getCachedAuthSession();
    if (
      !latest ||
      auth.currentUser?.uid !== currentUser.uid ||
      latest.user.uid !== currentUser.uid ||
      latest.user.tenantId.trim().toLowerCase() !== normalizedTenantId ||
      latest.session.tenantId.trim().toLowerCase() !== normalizedTenantId ||
      latest.session.sessionId !== cached.session.sessionId
    ) {
      throw new Error('EDGE_HYDRATION_SESSION_CHANGED');
    }

    const authorityEpoch = await secureAuthorityEpoch(
      latest.user.uid,
      latest.session.sessionId,
      payload.authorizationRevision
    );
    await replaceSecureTenantEdgeSnapshot(
      normalizedTenantId,
      cached.user.uid,
      payload.collections || {},
      {
        scope: surface,
        actorId: latest.user.uid,
        sessionId: latest.session.sessionId,
        authorizationRevision: payload.authorizationRevision,
        authorityEpoch,
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
      freshness: 'CURRENT',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (
      message.includes('AUTHORIZATION') ||
      message.includes('TENANT_MISMATCH') ||
      message.includes('SESSION_CHANGED') ||
      message.includes('INVALID_SNAPSHOT') ||
      message.includes('BAD_REQUEST')
    ) throw error;
    return loadLocalEdgeSnapshot(normalizedTenantId, surface);
  }
}
