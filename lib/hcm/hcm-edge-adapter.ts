'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';
import type {
  EmployeeAssignmentHistory,
  EmployeeMaster,
} from '@/types/hcm-advanced';

export type CreateEmployeeEdgePayload = Omit<
  EmployeeMaster,
  | 'employeeId'
  | 'employeeNumber'
  | 'userId'
  | 'tenantId'
  | 'employmentStatus'
  | 'terminationDate'
  | 'onboardingStage'
  | 'offboardingStage'
  | 'compensation'
  | 'currentAssignmentId'
  | 'createdAt'
  | 'updatedAt'
  | 'schemaVersion'
>;

async function run<T>(
  commandType:string,
  payload:Record<string,unknown>,
  idempotencyKey?:string
):Promise<T>{
  const result=await executeActiveTenantCommand<T>(
    commandType,
    payload,
    {idempotencyKey,schemaVersion:1}
  );
  if(!result.success){
    throw new Error(result.error?.message||`${commandType} failed.`);
  }
  return result.data as T;
}

export const createEmployeeEdge=(
  payload:CreateEmployeeEdgePayload,
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'CreateEmployeeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const updateEmployeeStatusEdge=(
  payload:{
    employeeId:string;
    newStatus:EmployeeMaster['employmentStatus'];
    reason:string;
  },
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'UpdateEmployeeStatusCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const transferEmployeeEdge=(
  payload:{
    employeeId:string;
    toFacilityId?:string;
    toDepartmentId:string;
    toDepartmentName:string;
    toPositionId:string;
    toPositionTitle:string;
    reason:string;
    effectiveDate:string;
  },
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'TransferEmployeeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

function mapWorkforceSnapshot(
  snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
){
  const employees=(snapshot.collections.employees||[])
    .map(row=>row as unknown as EmployeeMaster)
    .sort((a,b)=>a.employeeNumber.localeCompare(b.employeeNumber));
  const assignments=(snapshot.collections.employeeAssignments||[])
    .map(row=>row as unknown as EmployeeAssignmentHistory)
    .sort((a,b)=>b.startDate.localeCompare(a.startDate));
  return {
    employees,
    assignments,
    source:snapshot.source,
    generatedAt:snapshot.generatedAt,
  };
}

export async function loadLocalWorkforceMaster(tenantId:string){
  return mapWorkforceSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateWorkforceMaster(tenantId:string){
  return mapWorkforceSnapshot(await hydrateEdgeSnapshot(tenantId));
}
