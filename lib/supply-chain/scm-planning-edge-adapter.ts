'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  CompleteInternalReplenishmentOrderPayload,
  ExecuteReplenishmentPlanPayload,
  GenerateReplenishmentPlanPayload,
  ReplenishmentPlan,
  ReplenishmentPolicy,
  ReviewReplenishmentPlanPayload,
  UpsertReplenishmentPolicyPayload,
} from '@/types/scm-planning';

async function executePlanningCommand<T>(
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

export function upsertReplenishmentPolicyEdge(
  payload: UpsertReplenishmentPolicyPayload,
  idempotencyKey?: string
) {
  return executePlanningCommand<ReplenishmentPolicy>(
    'UpsertReplenishmentPolicyCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function generateReplenishmentPlanEdge(
  payload: GenerateReplenishmentPlanPayload,
  idempotencyKey?: string
) {
  return executePlanningCommand<ReplenishmentPlan>(
    'GenerateReplenishmentPlanCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function reviewReplenishmentPlanEdge(
  payload: ReviewReplenishmentPlanPayload,
  idempotencyKey?: string
) {
  return executePlanningCommand<ReplenishmentPlan>(
    'ReviewReplenishmentPlanCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function executeReplenishmentPlanEdge(
  payload: ExecuteReplenishmentPlanPayload,
  idempotencyKey?: string
) {
  return executePlanningCommand(
    'ExecuteReplenishmentPlanCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function completeInternalReplenishmentOrderEdge(
  payload: CompleteInternalReplenishmentOrderPayload,
  idempotencyKey?: string
) {
  return executePlanningCommand(
    'CompleteInternalReplenishmentOrderCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}
