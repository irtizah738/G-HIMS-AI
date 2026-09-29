'use client';

import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { CommandResult } from '@/lib/backend/types';
import { syncEngine } from '@/lib/offline/sync-engine';
import type { MutationAction } from '@/types/offline';
import { getEdgeEntityRecord, putEdgeEntity, putEntityMapping } from '@/lib/offline/db';

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

  const edgeRecord = await getEdgeEntityRecord(
    input.tenantId,
    input.offlineQueue.collection,
    input.offlineQueue.resourceId
  );

  await syncEngine.queueMutation({
    tenantId: input.tenantId,
    collection: input.offlineQueue.collection,
    action: input.offlineQueue.action,
    resourceId: input.offlineQueue.resourceId,
    commandType: input.commandType,
    payload: input.payload,
    idempotencyKey,
    schemaVersion: input.schemaVersion || 1,
    baseEntityVersion:
      input.offlineQueue.baseEntityVersion ?? edgeRecord?.serverVersion,
    baseVectorClock:
      edgeRecord?.data?._vectorClock && typeof edgeRecord.data._vectorClock === 'object'
        ? edgeRecord.data._vectorClock as Record<string, number>
        : undefined,
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

  const tenantId = cached.user.tenantId.trim().toLowerCase();
  const commandId = request.commandId || `cmd_${crypto.randomUUID()}`;
  const idempotencyKey = request.idempotencyKey || `idem_${crypto.randomUUID()}`;

  const queueOfflineRegistration = async (): Promise<TData> => {
    if (!syncEngine) {
      throw new Error('OFFLINE_QUEUE_UNAVAILABLE: registration outbox is unavailable.');
    }

    const deviceSeed = String(cached.session.deviceId || cached.user.uid)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-10) || 'device';
    const localPatientId = `local_pat_${deviceSeed}_${crypto.randomUUID()}`;
    const localEncounterId = `local_enc_${deviceSeed}_${crypto.randomUUID()}`;
    const localQueueTokenId = `local_opd_${deviceSeed}_${crypto.randomUUID()}`;
    const localMrn = `LOCAL-${deviceSeed.toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const now = Date.now();
    const normalizedGender =
      request.gender.toLowerCase() === 'male'
        ? 'male'
        : request.gender.toLowerCase() === 'female'
          ? 'female'
          : request.gender.toLowerCase() === 'unknown'
            ? 'unknown'
            : 'other';

    const patient = {
      id: localPatientId,
      tenantId,
      mrn: localMrn,
      fullName: request.fullName,
      gender: normalizedGender,
      dateOfBirth: request.dateOfBirth,
      contactPhone: request.contactPhone,
      address: request.address,
      bloodGroup: request.bloodGroup || 'O+',
      identifiers: request.identifiers || [],
      allergies: request.allergies || [],
      chronicConditions: request.chronicConditions || [],
      createdAt: now,
      updatedAt: now,
      status: 'LOCAL_PENDING_REGISTRATION',
      activeEncounterId: localEncounterId,
      provisional: true,
    };

    const encounter = {
      id: localEncounterId,
      tenantId,
      patientId: localPatientId,
      type: request.encounterType || 'OPD',
      status: 'LOCAL_PENDING_REGISTRATION',
      currentStageId: 'REGISTRATION',
      startedAt: now,
      department: request.department || 'General Medicine',
      priority: request.priority || 'ROUTINE',
      chiefComplaint: request.chiefComplaint || '',
      assignedDoctor: request.assignedDoctor || '',
      tokenNumber: `LOCAL-${Date.now().toString().slice(-4)}`,
      provisional: true,
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
      status: 'waiting' as const,
      arrivalTime: new Date(now).toISOString(),
      createdAt: now,
      provisional: true,
    };

    await Promise.all([
      putEntityMapping(tenantId, 'PATIENT', localPatientId),
      putEntityMapping(tenantId, 'ENCOUNTER', localEncounterId),
      putEntityMapping(tenantId, 'OPD_QUEUE_TOKEN', localQueueTokenId),
      putEdgeEntity(tenantId, 'patients', localPatientId, patient),
      putEdgeEntity(tenantId, 'encounters', localEncounterId, encounter),
      putEdgeEntity(tenantId, 'opd_queue', localQueueTokenId, queueToken),
    ]);

    await syncEngine.queueMutation({
      tenantId,
      collection: 'patients',
      action: 'CREATE',
      resourceId: localPatientId,
      commandType: 'RegisterPatientAndEncounterCommand',
      payload: {
        clientLocalPatientId: localPatientId,
        clientLocalEncounterId: localEncounterId,
        clientLocalQueueTokenId: localQueueTokenId,
        fullName: request.fullName,
        gender: normalizedGender,
        dateOfBirth: request.dateOfBirth,
        identifiers: request.identifiers || [],
        contactPhone: request.contactPhone,
        address: request.address,
        bloodGroup: request.bloodGroup,
        allergies: request.allergies || [],
        chronicConditions: request.chronicConditions || [],
        encounterType: request.encounterType || 'OPD',
        department: request.department || 'General Medicine',
        priority: request.priority || 'ROUTINE',
        chiefComplaint: request.chiefComplaint || '',
        assignedDoctor: request.assignedDoctor || '',
      },
      idempotencyKey,
      schemaVersion: 1,
      optimisticCache: false,
      mutationId: commandId,
    });

    return {
      patient,
      encounter,
      queueToken,
      queuedOffline: true,
      localMappings: [
        { entityType: 'PATIENT', localId: localPatientId },
        { entityType: 'ENCOUNTER', localId: localEncounterId },
        { entityType: 'OPD_QUEUE_TOKEN', localId: localQueueTokenId },
      ],
    } as TData;
  };

  if (
    syncEngine &&
    (!syncEngine.getState().isOnline || syncEngine.getState().offlineSimulationActive)
  ) {
    return queueOfflineRegistration();
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken(false);
  } catch (error) {
    if (isNetworkLikeError(error)) return queueOfflineRegistration();
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
        'x-ghims-tenant-id': tenantId,
        'x-ghims-session-id': cached.session.sessionId,
        ...(cached.session.deviceId ? { 'x-ghims-device-id': cached.session.deviceId } : {}),
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        ...request,
        tenantId,
        commandId,
        idempotencyKey,
      }),
    });
  } catch (error) {
    if (isNetworkLikeError(error)) return queueOfflineRegistration();
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (isTransientServerStatus(response.status)) {
    return queueOfflineRegistration();
  }

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Patient registration failed.');
  }

  return payload.data as TData;
}
