'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { CommandResult } from '@/lib/backend/types';
import { syncEngine } from '@/lib/offline/sync-engine';
import type { MutationAction } from '@/types/offline';
import {
  putLocalEntityMappings,
  putSecureEdgeEntities,
} from '@/lib/offline/secure-store';

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

function isNetworkLikeError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return (
    code === 'auth/network-request-failed' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('aborted')
  );
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

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken(false);
  } catch (error) {
    if (input.offlineQueue?.enabled && isNetworkLikeError(error)) {
      return queueGovernedOfflineCommand<TData>(input, commandId, idempotencyKey);
    }
    throw error;
  }

  let response: Response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);

  try {
    response = await fetch('/api/commands/execute', {
      method: 'POST',
      signal: controller.signal,
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
    if (input.offlineQueue?.enabled && isNetworkLikeError(error)) {
      return queueGovernedOfflineCommand<TData>(input, commandId, idempotencyKey);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
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
  tariffPlan?: 'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE';
  insuranceDetails?: {
    payerName?: string;
    policyNumber?: string;
    memberId?: string;
  };
  consentDecisions?: Array<{
    consentType: 'GENERAL_OUTPATIENT' | 'DATA_SHARING_HIE';
    status: 'GRANTED' | 'WITHHELD';
    method: 'DIGITAL_ATTESTATION';
  }>;
  encounterType?: string;
  department?: string;
  priority?: string;
  chiefComplaint?: string;
  assignedDoctor?: string;
  commandId?: string;
  idempotencyKey?: string;
}

async function queueOfflineRegistration<TData>(
  request: RegistrationRequest,
  cached: NonNullable<Awaited<ReturnType<typeof getCachedAuthSession>>>
): Promise<TData> {
  if (!syncEngine) {
    throw new Error('OFFLINE_QUEUE_UNAVAILABLE: registration requires the edge sync engine.');
  }

  const commandId = request.commandId || `cmd_${crypto.randomUUID()}`;
  const idempotencyKey = request.idempotencyKey || `idem_${crypto.randomUUID()}`;
  const localPatientId = `local-patient-${crypto.randomUUID()}`;
  const localEncounterId = `local-encounter-${crypto.randomUUID()}`;
  const localQueueTokenId = `local-opd-${crypto.randomUUID()}`;
  const localMrn = `LOCAL-${(cached.session.deviceId || cached.user.uid).slice(-6).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const now = Date.now();

  const registrationPayload = {
    ...request,
    localPatientId,
    localEncounterId,
    localQueueTokenId,
  };

  await syncEngine.queueMutation({
    tenantId: cached.user.tenantId,
    collection: 'patients',
    action: 'CREATE',
    resourceId: localPatientId,
    commandType: 'RegisterPatientAndEncounterCommand',
    payload: registrationPayload,
    idempotencyKey,
    schemaVersion: 1,
    optimisticCache: false,
    mutationId: commandId,
  });

  await putLocalEntityMappings(cached.user.tenantId, [
    { localId: localPatientId, entityType: 'PATIENT_MPI', sourceMutationId: commandId },
    { localId: localEncounterId, entityType: 'ENCOUNTER', sourceMutationId: commandId },
    { localId: localQueueTokenId, entityType: 'OPD_QUEUE_TOKEN', sourceMutationId: commandId },
  ]);

  const patient = {
    id: localPatientId,
    tenantId: cached.user.tenantId,
    mrn: localMrn,
    fullName: request.fullName,
    gender: String(request.gender || 'other').toLowerCase(),
    dateOfBirth: request.dateOfBirth,
    identifiers: request.identifiers || [],
    contactPhone: request.contactPhone,
    address: request.address,
    bloodGroup: request.bloodGroup || 'Unknown',
    allergies: request.allergies || [],
    chronicConditions: request.chronicConditions || [],
    createdAt: now,
    updatedAt: now,
    createdById: cached.user.uid,
    version: 0,
    status: 'LOCAL_PENDING_SYNC',
    activeEncounterId: localEncounterId,
  };

  const encounter = {
    id: localEncounterId,
    tenantId: cached.user.tenantId,
    patientId: localPatientId,
    type: request.encounterType || 'OPD',
    status: 'IN_PROGRESS',
    currentStageId: 'REGISTRATION',
    workflowSnapshotId: `local-workflow-${localEncounterId}`,
    startedAt: now,
    department: request.department || 'General OPD',
    priority: request.priority || 'ROUTINE',
    chiefComplaint: request.chiefComplaint || '',
    assignedDoctor: request.assignedDoctor || '',
    tokenNumber: `LOCAL-${String(now).slice(-4)}`,
  };

  const queueToken = {
    id: localQueueTokenId,
    encounterId: localEncounterId,
    patientId: localPatientId,
    patientName: request.fullName,
    mrn: localMrn,
    tokenNumber: encounter.tokenNumber,
    department: encounter.department,
    priority: String(encounter.priority).toLowerCase(),
    status: 'waiting',
    arrivalTime: new Date(now).toISOString(),
    createdAt: now,
  };

  await Promise.all([
    putSecureEdgeEntities(cached.user.tenantId, cached.user.uid, 'patients', [patient]),
    putSecureEdgeEntities(cached.user.tenantId, cached.user.uid, 'encounters', [encounter]),
    putSecureEdgeEntities(cached.user.tenantId, cached.user.uid, 'opd_queue', [queueToken]),
  ]);

  return {
    success: true,
    patient,
    encounter,
    queueToken,
    initialStage: {
      id: 'REGISTRATION',
      stageType: 'REGISTRATION',
      status: 'ACTIVE',
    },
    queuedOffline: true,
  } as TData;
}

export async function registerActiveTenantPatient<TData = unknown>(
  request: RegistrationRequest
): Promise<TData> {
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();

  if (!currentUser || !cached) {
    throw new Error('AUTHENTICATION_REQUIRED: active G-HIMS session is required.');
  }

  if (!syncEngine.getState().isOnline || syncEngine.getState().offlineSimulationActive) {
    return queueOfflineRegistration<TData>(request, cached);
  }

  const commandId = request.commandId || `cmd_${crypto.randomUUID()}`;
  const idempotencyKey = request.idempotencyKey || `idem_${crypto.randomUUID()}`;

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken(false);
  } catch (error) {
    if (isNetworkLikeError(error)) {
      return queueOfflineRegistration<TData>(
        { ...request, commandId, idempotencyKey },
        cached
      );
    }
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  let response: Response;

  try {
    response = await fetch('/api/clinical/encounter/create', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-ghims-tenant-id': cached.user.tenantId,
        'x-ghims-session-id': cached.session.sessionId,
        'idempotency-key': idempotencyKey,
        ...(cached.session.deviceId ? { 'x-ghims-device-id': cached.session.deviceId } : {}),
      },
      body: JSON.stringify({
        ...request,
        tenantId: cached.user.tenantId,
        commandId,
        idempotencyKey,
      }),
    });
  } catch (error) {
    if (isNetworkLikeError(error)) {
      return queueOfflineRegistration<TData>(
        { ...request, commandId, idempotencyKey },
        cached
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (isTransientServerStatus(response.status)) {
    return queueOfflineRegistration<TData>(
      { ...request, commandId, idempotencyKey },
      cached
    );
  }

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Patient registration failed.');
  }

  return payload.data as TData;
}
