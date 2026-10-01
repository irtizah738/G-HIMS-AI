'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';
import type {
  CalibrationRecord,
  HospitalRoom,
  MaintenanceWorkOrder,
  ResourceMaster,
  ResourceReservation,
} from '@/types/resource-management';

export interface FacilitiesEdgeProjection {
  resources: ResourceMaster[];
  rooms: HospitalRoom[];
  reservations: ResourceReservation[];
  workOrders: MaintenanceWorkOrder[];
  calibrations: CalibrationRecord[];
}

function mapProjection(
  snapshot: Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
): FacilitiesEdgeProjection {
  return {
    resources: (snapshot.collections.resources || []) as unknown as ResourceMaster[],
    rooms: (snapshot.collections.rooms || []) as unknown as HospitalRoom[],
    reservations: (snapshot.collections.resourceReservations || []) as unknown as ResourceReservation[],
    workOrders: (snapshot.collections.maintenanceWorkOrders || []) as unknown as MaintenanceWorkOrder[],
    calibrations: (snapshot.collections.calibrationRecords || []) as unknown as CalibrationRecord[],
  };
}

export async function loadLocalFacilitiesProjection(
  tenantId: string
): Promise<FacilitiesEdgeProjection> {
  return mapProjection(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateFacilitiesProjection(
  tenantId: string
): Promise<FacilitiesEdgeProjection> {
  return mapProjection(await hydrateEdgeSnapshot(tenantId));
}

async function run<T>(
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

export const recordCalibrationEdge = (
  payload: Record<string, unknown>,
  idempotencyKey?: string
) => run<CalibrationRecord>('RecordCalibrationCommand', payload, idempotencyKey);
