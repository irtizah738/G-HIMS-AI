/**
 * Offline Reconciliation Domain Service
 * Replays authenticated offline commands through the same authoritative domain services
 * as online traffic. Client-authored identity, roles and state are never trusted.
 */
import {
  OfflineMutationItem,
  OfflineSyncBatch,
  OfflineSyncResponse,
  SyncBatchResultItem,
  CommandContext,
  ConflictCategory,
} from '../types';
import { CommandBus } from '../commands/command-bus';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { EdgeVersionRepository } from '@/server/repositories/edge-version-repository';

function conflictCategory(commandType: string): ConflictCategory {
  if (['PostJournalCommand'].includes(commandType)) return 'FINANCIAL_CONFLICT';
  if (
    [
      'PrescribeMedicationCommand',
      'AdmitPatientToBedCommand',
      'DischargePatientFromBedCommand',
      'MergePatientCommand',
      'AdvanceStageCommand',
    ].includes(commandType)
  ) return 'SAFETY_CRITICAL';
  if (
    [
      'RegisterPatientAndEncounterCommand',
      'RecordVitalsCommand',
      'SignClinicalNoteCommand',
      'PlaceDiagnosticOrderCommand',
      'CreateEncounterCommand',
      'CreateTelehealthSessionCommand',
    ].includes(commandType)
  ) return 'SAFE_APPEND';
  return 'STATE_CONFLICT';
}

function rewriteMappedReferences(
  value: unknown,
  mappings: Map<string, string>
): unknown {
  if (typeof value === 'string') return mappings.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => rewriteMappedReferences(item, mappings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        rewriteMappedReferences(item, mappings),
      ])
    );
  }
  return value;
}

function entityKey(mutation: OfflineMutationItem, payload: Record<string, unknown>): string {
  const entityId = String(
    mutation.entityId ||
    payload.bedId ||
    payload.tokenId ||
    payload.patientId ||
    payload.encounterId ||
    payload.findingId ||
    payload.orderId ||
    mutation.mutationId
  );
  return `${mutation.commandType}:${entityId}`;
}

async function processOfflineRegistration(
  context: CommandContext,
  mutation: OfflineMutationItem,
  payload: Record<string, unknown>
): Promise<{
  result: SyncBatchResultItem;
  mappings: Array<{ localId: string; canonicalId: string; entityType: string }>;
}> {
  const auth = AuthorizationPipeline.evaluate(context, {
    requiredRoles: ['RECEPTIONIST', 'REGISTRAR', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
  });
  if (!auth.authorized) {
    return {
      result: {
        mutationId: mutation.mutationId,
        status: 'rejected',
        conflictCategory: 'SAFE_APPEND',
        reason: auth.reason || 'Front-desk registration authority required.',
      },
      mappings: [],
    };
  }

  const genderRaw = String(payload.gender || '').toLowerCase();
  const gender =
    genderRaw === 'male' || genderRaw === 'female' || genderRaw === 'unknown'
      ? genderRaw
      : 'other';

  const registration = await registerPatientAndEncounter({
    tenantId: context.tenantId,
    commandId: mutation.mutationId,
    idempotencyKey: mutation.idempotencyKey,
    fullName: String(payload.fullName || ''),
    gender,
    dateOfBirth: String(payload.dateOfBirth || ''),
    identifiers: Array.isArray(payload.identifiers) ? payload.identifiers as any : [],
    contactPhone: String(payload.contactPhone || ''),
    address: String(payload.address || ''),
    encounterType: (payload.encounterType || 'OPD') as any,
    department: String(payload.department || 'General OPD'),
    priority: (payload.priority || 'ROUTINE') as any,
    chiefComplaint: String(payload.chiefComplaint || ''),
    assignedDoctor: String(payload.assignedDoctor || ''),
    actorId: context.actorId,
    actorRole: context.roles[0] || 'AUTHENTICATED_USER',
    actorName: context.actorId,
    bloodGroup: payload.bloodGroup ? String(payload.bloodGroup) : undefined,
    allergies: Array.isArray(payload.allergies) ? payload.allergies.map(String) : [],
    chronicConditions: Array.isArray(payload.chronicConditions)
      ? payload.chronicConditions.map(String)
      : [],
  });

  const mappings = [
    payload.localPatientId
      ? {
          localId: String(payload.localPatientId),
          canonicalId: registration.patient.id,
          entityType: 'PATIENT_MPI',
        }
      : null,
    payload.localEncounterId
      ? {
          localId: String(payload.localEncounterId),
          canonicalId: registration.encounter.id,
          entityType: 'ENCOUNTER',
        }
      : null,
    payload.localQueueTokenId
      ? {
          localId: String(payload.localQueueTokenId),
          canonicalId: registration.queueToken.id,
          entityType: 'OPD_QUEUE_TOKEN',
        }
      : null,
  ].filter(Boolean) as Array<{ localId: string; canonicalId: string; entityType: string }>;

  return {
    result: {
      mutationId: mutation.mutationId,
      status: 'accepted',
      conflictCategory: 'SAFE_APPEND',
      serverEventId: registration.timelineEvent.id,
      data: registration,
      entityMappings: mappings,
    },
    mappings,
  };
}

export class OfflineReconciliationDomainService {
  public static async processSyncBatch(
    context: CommandContext,
    batch: OfflineSyncBatch
  ): Promise<OfflineSyncResponse> {
    const results: SyncBatchResultItem[] = [];
    let accepted = 0;
    let conflicted = 0;
    let rejected = 0;
    const canonicalMappings = new Map<string, string>();

    // Registration must establish canonical patient/encounter IDs before dependent
    // offline commands are replayed.
    const ordered = [...batch.mutations].sort((a, b) => {
      const ar = a.commandType === 'RegisterPatientAndEncounterCommand' ? 0 : 1;
      const br = b.commandType === 'RegisterPatientAndEncounterCommand' ? 0 : 1;
      return ar - br || a.occurredAt - b.occurredAt;
    });

    for (const mutation of ordered) {
      const category = conflictCategory(mutation.commandType);

      try {
        if (!mutation.commandType || !mutation.idempotencyKey) {
          rejected += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'rejected',
            conflictCategory: category,
            reason: 'OFFLINE_COMMAND_INVALID: commandType and idempotencyKey are required.',
          });
          continue;
        }

        const payload = rewriteMappedReferences(
          mutation.payload,
          canonicalMappings
        ) as Record<string, unknown>;

        if (mutation.commandType === 'RegisterPatientAndEncounterCommand') {
          const registration = await processOfflineRegistration(context, mutation, payload);
          results.push(registration.result);

          if (registration.result.status === 'accepted') {
            accepted += 1;
            for (const mapping of registration.mappings) {
              canonicalMappings.set(mapping.localId, mapping.canonicalId);
            }
            await EdgeVersionRepository.recordAccepted(
              context.tenantId,
              `PATIENT_MPI:${registration.mappings[0]?.canonicalId || mutation.mutationId}`,
              mutation.vectorClock,
              mutation.mutationId
            );
          } else {
            rejected += 1;
          }
          continue;
        }

        const resolvedEntityId = String(
          rewriteMappedReferences(mutation.entityId || '', canonicalMappings)
        );
        const versionKey = entityKey(
          { ...mutation, entityId: resolvedEntityId || mutation.entityId },
          payload
        );
        const currentVersion = await EdgeVersionRepository.get(context.tenantId, versionKey);
        const causalState = EdgeVersionRepository.compare(
          currentVersion,
          mutation.baseEntityVersion,
          mutation.baseVectorClock
        );

        if (category !== 'SAFE_APPEND' && causalState !== 'MATCH') {
          conflicted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'requires_review',
            conflictCategory: category,
            serverVersion: currentVersion?.serverVersion,
            reason:
              causalState === 'CONCURRENT'
                ? 'CAUSAL_CONFLICT: server and offline device changed the same state independently.'
                : 'STALE_BASE_VERSION: authoritative state changed after the offline command was based.',
          });
          continue;
        }

        const result = await CommandBus.dispatch(context, {
          commandId: mutation.mutationId,
          idempotencyKey: mutation.idempotencyKey,
          tenantId: context.tenantId,
          commandType: mutation.commandType,
          payload,
          schemaVersion: mutation.schemaVersion || 1,
          clientTimestamp: mutation.occurredAt,
        });

        if (result.success) {
          const version = await EdgeVersionRepository.recordAccepted(
            context.tenantId,
            `${mutation.commandType}:${result.entityId || resolvedEntityId || mutation.mutationId}`,
            mutation.vectorClock,
            mutation.mutationId
          );
          accepted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'accepted',
            conflictCategory: category,
            serverEventId: result.eventId,
            serverVersion: version?.serverVersion,
            data: result.data,
          });
          continue;
        }

        const code = result.error?.code || 'OFFLINE_COMMAND_REJECTED';
        if (
          code === 'IDEMPOTENCY_IN_PROGRESS' ||
          code.includes('CONFLICT') ||
          code.includes('STATE_') ||
          code.includes('ALREADY_') ||
          code.includes('UNAVAILABLE')
        ) {
          conflicted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'requires_review',
            conflictCategory: category,
            reason: result.error?.message || code,
          });
        } else {
          rejected += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'rejected',
            conflictCategory: category,
            reason: result.error?.message || code,
          });
        }
      } catch (error) {
        rejected += 1;
        results.push({
          mutationId: mutation.mutationId,
          status: 'rejected',
          conflictCategory: category,
          reason: error instanceof Error ? error.message : 'Unknown reconciliation error',
        });
      }
    }

    return {
      batchId: batch.batchId,
      tenantId: context.tenantId,
      processedAt: Date.now(),
      summary: {
        total: batch.mutations.length,
        accepted,
        conflicted,
        rejected,
      },
      results,
    };
  }
}
