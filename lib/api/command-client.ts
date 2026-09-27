'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { CommandResult } from '@/lib/backend/types';

export interface ExecuteCommandInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  tenantId: string;
  commandType: string;
  payload: TPayload;
  commandId?: string;
  idempotencyKey?: string;
  schemaVersion?: number;
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

  const idToken = await currentUser.getIdToken(false);
  const commandId = input.commandId || `cmd_${crypto.randomUUID()}`;
  const idempotencyKey = input.idempotencyKey || `idem_${crypto.randomUUID()}`;

  const response = await fetch('/api/commands/execute', {
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
      },
    }),
  });

  const result = await response.json() as CommandResult<TData>;

  if (!response.ok) {
    throw new Error(result.error?.message || 'Command request failed.');
  }

  return result;
}


export async function executeActiveTenantCommand<TData = unknown>(
  commandType: string,
  payload: Record<string, unknown>,
  options?: { commandId?: string; idempotencyKey?: string; schemaVersion?: number }
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
