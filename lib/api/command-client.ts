'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { CommandResult } from '@/lib/backend/types';
import { syncEngine } from '@/lib/offline/sync-engine';
import type { MutationAction } from '@/types/offline';

export interface OfflineQueuePolicy {
  enabled: boolean;
  collection: string;
  resourceId: string;
  action: MutationAction;
  optimisticCache?: boolean;
  baseEntityVersion?: number;
}

export interface ExecuteCommandInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  tenantId: string;
  commandType: string;
  payload: TPayload;
  commandId?: string;
  idempotencyKey?: string;
  schemaVersion?: number;
  offlineQueue?: OfflineQueuePolicy;
}

async function queueGovernedOfflineCommand<TData>(
  input: ExecuteCommandInput,
  commandId: string,
  idempotencyKey: string
): Promise<CommandResult<TData>> {
  if (!input.offlineQueue?.enabled || !syncEngine) {
    throw new Error('OFFLINE_QUEUE_UNAVAILABLE: command is not enabled for governed offline replay.');
  }

  await syncEngine.queueMutation({
    tenantId: input.tenantId,
    collection: input.offlineQueue.collection,
    action: input.offlineQueue.action,
    resourceId: input.offlineQueue.resourceId,
    commandType: input.commandType,
    payload: input.payload,
    idempotencyKey,
    schemaVersion: input.schemaVersion || 1,
    baseEntityVersion: input.offlineQueue.baseEntityVersion,
    optimisticCache: input.offlineQueue.optimisticCache,
    mutationId: commandId,
  });

  return {
    success: true,
    commandId,
    idempotencyKey,
    queuedOffline: true,
  };
}

function isTransientServerStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export async function executeCommand<TData = unknown>(
  input: ExecuteCommandInput
): Promise<CommandResult<TData>> {
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!currentUser || !cached) {
    throw new Error('AUTHENTICATION_REQUIRED: active G-HIMS session is required.');
  }

  if (cached.user.tenantId !== input.tenantId) {
    throw new Error('TENANT_MISMATCH: active session does not match requested tenant.');
  }

  const commandId = input.commandId || `cmd_${crypto.randomUUID()}`;
  const idempotencyKey = input.idempotencyKey || `idem_${crypto.randomUUID()}`;

  if (
    input.offlineQueue?.enabled &&
    syncEngine &&
    (!syncEngine.getState().isOnline || syncEngine.getState().offlineSimulationActive)
  ) {
    return queueGovernedOfflineCommand<TData>(input, commandId, idempotencyKey);
  }

  const idToken = await currentUser.getIdToken(false);
  let response: Response;

  try {
    response = await fetch('/api/commands/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-ghims-tenant-id': input.tenantId,
        'x-ghims-session-id': cached.session.sessionId,
        ...(cached.session.deviceId ? { 'x-ghims-device-id': cached.session.deviceId } : {}),
      },
      body: JSON.stringify({
        command: {
          commandId,
          idempotencyKey,
          tenantId: input.tenantId,
          commandType: input.commandType,
          payload: input.payload,
          schemaVersion: input.schemaVersion || 1,
          clientTimestamp: Date.now(),
        },
      }),
    });
  } catch (error) {
    if (input.offlineQueue?.enabled) {
      return queueGovernedOfflineCommand<TData>(input, commandId, idempotencyKey);
    }
    throw error;
  }

  if (input.offlineQueue?.enabled && isTransientServerStatus(response.status)) {
    return queueGovernedOfflineCommand<TData>(input, commandId, idempotencyKey);
  }

  const result = await response.json() as CommandResult<TData>;

  if (!response.ok) {
    throw new Error(result.error?.message || 'Command request failed.');
  }

  return result;
}


export async function executeActiveTenantCommand<TData = unknown>(
  commandType: string,
  payload: Record<string, unknown>,
  options?: {
    commandId?: string;
    idempotencyKey?: string;
    schemaVersion?: number;
    offlineQueue?: OfflineQueuePolicy;
  }
): Promise<CommandResult<TData>> {
  const cached = await getCachedAuthSession();
  if (!cached) {
    throw new Error('AUTHENTICATION_REQUIRED: active G-HIMS session is required.');
  }

  return executeCommand<TData>({
    tenantId: cached.user.tenantId,
    commandType,
    payload,
    commandId: options?.commandId,
    idempotencyKey: options?.idempotencyKey,
    schemaVersion: options?.schemaVersion,
    offlineQueue: options?.offlineQueue,
  });
}


export interface RegistrationRequest {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  contactPhone: string;
  address: string;
  bloodGroup?: string;
  identifiers?: Array<{ type: string; value: string; issuer?: string }>;
  allergies?: string[];
  chronicConditions?: string[];
  encounterType?: string;
  department?: string;
  priority?: string;
  chiefComplaint?: string;
  assignedDoctor?: string;
  commandId?: string;
  idempotencyKey?: string;
}

export async function registerActiveTenantPatient<TData = unknown>(
  request: RegistrationRequest
): Promise<TData> {
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!currentUser || !cached) {
    throw new Error('AUTHENTICATION_REQUIRED: active G-HIMS session is required.');
  }

  const idToken = await currentUser.getIdToken(false);
  const response = await fetch('/api/clinical/encounter/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'x-ghims-tenant-id': cached.user.tenantId,
      'x-ghims-session-id': cached.session.sessionId,
      ...(cached.session.deviceId ? { 'x-ghims-device-id': cached.session.deviceId } : {}),
    },
    body: JSON.stringify({
      ...request,
      tenantId: cached.user.tenantId,
      commandId: request.commandId || `cmd_${crypto.randomUUID()}`,
      idempotencyKey: request.idempotencyKey || `idem_${crypto.randomUUID()}`,
    }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Patient registration failed.');
  }

  return payload.data as TData;
}
