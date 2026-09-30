'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  ApproveSupplierContractPayload,
  AwardSupplierContractPayload,
  ChangeSupplierContractStatusPayload,
  CreateRfqPayload,
  GovernedRfqRecord,
  GovernedSupplierQuotation,
  RecordSupplierQuotationPayload,
  ReviewSupplierQualificationPayload,
  SupplierContract,
} from '@/types/scm-sourcing';

async function executeSourcingCommand<T>(
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

export function reviewSupplierQualificationEdge(
  payload: ReviewSupplierQualificationPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand(
    'ReviewSupplierQualificationCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function createScmRfqEdge(
  payload: CreateRfqPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand<GovernedRfqRecord>(
    'CreateScmRfqCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function recordSupplierQuotationEdge(
  payload: RecordSupplierQuotationPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand<GovernedSupplierQuotation>(
    'RecordSupplierQuotationCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function awardSupplierContractEdge(
  payload: AwardSupplierContractPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand<{ contract: SupplierContract; scores: unknown[] }>(
    'AwardSupplierContractCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function approveSupplierContractEdge(
  payload: ApproveSupplierContractPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand<SupplierContract>(
    'ApproveSupplierContractCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function changeSupplierContractStatusEdge(
  payload: ChangeSupplierContractStatusPayload,
  idempotencyKey?: string
) {
  return executeSourcingCommand<SupplierContract>(
    'ChangeSupplierContractStatusCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}
