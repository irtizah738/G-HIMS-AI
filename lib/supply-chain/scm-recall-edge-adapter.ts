'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  CreateInventoryDispositionPayload,
  ExecuteInventoryDispositionPayload,
  ExecuteRecallQuarantinePayload,
  GovernedRecallCase,
  InitiateRecallPayload,
  InventoryDispositionOrder,
  ProjectRecallExposuresPayload,
  RecordRecallNotificationPayload,
  ResolveRecallPayload,
  ReviewInventoryDispositionPayload,
} from '@/types/scm-recall';

async function executeRecallCommand<T>(
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

export const initiateScmRecallEdge = (
  payload: InitiateRecallPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<GovernedRecallCase>(
    'InitiateScmRecallCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const executeRecallQuarantineEdge = (
  payload: ExecuteRecallQuarantinePayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<GovernedRecallCase>(
    'ExecuteRecallQuarantineCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const projectRecallExposuresEdge = (
  payload: ProjectRecallExposuresPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<GovernedRecallCase>(
    'ProjectRecallExposuresCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const recordRecallNotificationEdge = (
  payload: RecordRecallNotificationPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand(
    'RecordRecallNotificationCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const createInventoryDispositionEdge = (
  payload: CreateInventoryDispositionPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<InventoryDispositionOrder>(
    'CreateInventoryDispositionCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const reviewInventoryDispositionEdge = (
  payload: ReviewInventoryDispositionPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<InventoryDispositionOrder>(
    'ReviewInventoryDispositionCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const executeInventoryDispositionEdge = (
  payload: ExecuteInventoryDispositionPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<InventoryDispositionOrder>(
    'ExecuteInventoryDispositionCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );

export const resolveScmRecallEdge = (
  payload: ResolveRecallPayload,
  idempotencyKey?: string
) =>
  executeRecallCommand<GovernedRecallCase>(
    'ResolveScmRecallCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
