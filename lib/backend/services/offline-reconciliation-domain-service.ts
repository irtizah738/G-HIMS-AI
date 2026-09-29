/**
 * Offline Reconciliation Domain Service
 * Replays authenticated offline commands through the same CommandBus as online traffic.
 * Unknown commands are rejected; no client-authored state merge is accepted implicitly.
 */
import {
  OfflineSyncBatch,
  OfflineSyncResponse,
  SyncBatchResultItem,
  CommandContext,
  ConflictCategory,
} from '../types';
import { CommandBus } from '../commands/command-bus';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { compareClocks, incrementClock, mergeClocks } from '@/lib/offline/vector-clock';

function stateCollectionForCommand(commandType: string): string | null {
  const map: Record<string, string> = {
    UpdateOpdQueueStatusCommand: 'opd_queue',
    AdmitPatientToBedCommand: 'beds',
    UpdateBedStatusCommand: 'beds',
    DischargePatientFromBedCommand: 'beds',
    DismissRevenueIntegrityFindingCommand: 'billingMismatches',
    ReconcileRevenueIntegrityFindingCommand: 'billingMismatches',
    AdvanceStageCommand: 'encounters',
  };
  return map[commandType] || null;
}

function serverCausalMetadata(state: Record<string, unknown> | null): {
  version: number;
  vectorClock: Record<string, number>;
} {
  if (!state) return { version: 0, vectorClock: {} };
  return {
    version: Number(state._serverVersion || 0),
    vectorClock:
      state._vectorClock && typeof state._vectorClock === 'object'
        ? state._vectorClock as Record<string, number>
        : {},
  };
}

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
      'RecordVitalsCommand',
      'SignClinicalNoteCommand',
      'PlaceDiagnosticOrderCommand',
      'CreateEncounterCommand',
      'CreateTelehealthSessionCommand',
    ].includes(commandType)
  ) return 'SAFE_APPEND';
  return 'STATE_CONFLICT';
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

    for (const mutation of batch.mutations) {
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

        const stateCollection = stateCollectionForCommand(mutation.commandType);
        let causalServerVersion = 0;
        let causalServerClock: Record<string, number> = {};

        if (
          stateCollection &&
          mutation.entityId &&
          category !== 'SAFE_APPEND'
        ) {
          const serverState = await DomainStateRepository.getById<Record<string, unknown>>(
            context.tenantId,
            stateCollection,
            mutation.entityId
          );
          const causal = serverCausalMetadata(serverState);
          causalServerVersion = causal.version;
          causalServerClock = causal.vectorClock;

          if (serverState && mutation.baseEntityVersion == null) {
            conflicted += 1;
            results.push({
              mutationId: mutation.mutationId,
              status: 'requires_review',
              conflictCategory: category,
              serverVersion: causal.version,
              reason: 'BASE_ENTITY_VERSION_REQUIRED: stateful offline mutation has no authoritative base version.',
              data: {
                serverState,
                serverVectorClock: causal.vectorClock,
              },
            });
            continue;
          }

          if (
            serverState &&
            mutation.baseEntityVersion != null &&
            mutation.baseEntityVersion !== causal.version
          ) {
            conflicted += 1;
            results.push({
              mutationId: mutation.mutationId,
              status: 'requires_review',
              conflictCategory: category,
              serverVersion: causal.version,
              reason:
                `STALE_BASE_VERSION: client based on version ${mutation.baseEntityVersion}; server is version ${causal.version}.`,
              data: {
                serverState,
                serverVectorClock: causal.vectorClock,
              },
            });
            continue;
          }

          if (
            serverState &&
            mutation.vectorClock &&
            Object.keys(causal.vectorClock).length > 0
          ) {
            const comparison = compareClocks(mutation.vectorClock, causal.vectorClock);
            if (comparison === 'LESS' || comparison === 'CONCURRENT') {
              conflicted += 1;
              results.push({
                mutationId: mutation.mutationId,
                status: 'requires_review',
                conflictCategory: category,
                serverVersion: causal.version,
                reason:
                  comparison === 'CONCURRENT'
                    ? 'CAUSAL_CONFLICT: offline and server state advanced concurrently.'
                    : 'STALE_VECTOR_CLOCK: server state causally dominates the offline mutation.',
                data: {
                  serverState,
                  serverVectorClock: causal.vectorClock,
                  clockComparison: comparison,
                },
              });
              continue;
            }
          }
        }

        if (mutation.commandType === 'RegisterPatientAndEncounterCommand') {
          const authorization = AuthorizationPipeline.evaluate(context, {
            requiredRoles: ['RECEPTIONIST', 'REGISTRAR', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
          });

          if (!authorization.authorized) {
            rejected += 1;
            results.push({
              mutationId: mutation.mutationId,
              status: 'rejected',
              conflictCategory: 'SAFETY_CRITICAL',
              reason: authorization.reason || 'Front-desk registration authority required.',
            });
            continue;
          }

          const payload = mutation.payload as Record<string, any>;
          const registration = await registerPatientAndEncounter({
            tenantId: context.tenantId,
            commandId: mutation.mutationId,
            idempotencyKey: mutation.idempotencyKey,
            fullName: String(payload.fullName || ''),
            gender:
              payload.gender === 'male' || payload.gender === 'female' || payload.gender === 'unknown'
                ? payload.gender
                : 'other',
            dateOfBirth: String(payload.dateOfBirth || ''),
            identifiers: Array.isArray(payload.identifiers) ? payload.identifiers : [],
            contactPhone: String(payload.contactPhone || ''),
            address: String(payload.address || ''),
            encounterType: payload.encounterType || 'OPD',
            department: payload.department || 'General Medicine',
            priority: payload.priority || 'ROUTINE',
            chiefComplaint: payload.chiefComplaint || '',
            assignedDoctor: payload.assignedDoctor || '',
            actorId: context.actorId,
            actorRole: context.roles[0] || 'AUTHENTICATED_USER',
            actorName: context.actorId,
            bloodGroup: payload.bloodGroup,
            allergies: Array.isArray(payload.allergies) ? payload.allergies : [],
            chronicConditions: Array.isArray(payload.chronicConditions) ? payload.chronicConditions : [],
          });

          accepted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'accepted',
            conflictCategory: 'SAFETY_CRITICAL',
            data: {
              ...registration,
              idMappings: [
                {
                  entityType: 'PATIENT',
                  collection: 'patients',
                  localId: String(payload.clientLocalPatientId || ''),
                  canonicalId: registration.patient.id,
                },
                {
                  entityType: 'ENCOUNTER',
                  collection: 'encounters',
                  localId: String(payload.clientLocalEncounterId || ''),
                  canonicalId: registration.encounter.id,
                },
                {
                  entityType: 'OPD_QUEUE_TOKEN',
                  collection: 'opd_queue',
                  localId: String(payload.clientLocalQueueTokenId || ''),
                  canonicalId: registration.queueToken.id,
                },
              ].filter((mapping) => mapping.localId),
            },
          });
          continue;
        }

        const replayContext: CommandContext = {
          ...context,
          offlineVectorClock: mutation.vectorClock,
          offlineBaseEntityVersion: mutation.baseEntityVersion,
          offlineMutationId: mutation.mutationId,
        };

        const result = await CommandBus.dispatch(replayContext, {
          commandId: mutation.mutationId,
          idempotencyKey: mutation.idempotencyKey,
          tenantId: context.tenantId,
          commandType: mutation.commandType,
          payload: mutation.payload,
          schemaVersion: mutation.schemaVersion || 1,
          clientTimestamp: mutation.occurredAt,
        });

        if (result.success) {
          accepted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'accepted',
            conflictCategory: category,
            serverEventId: result.eventId,
            serverVersion: stateCollection ? causalServerVersion + 1 : 1,
            serverVectorClock: stateCollection
              ? incrementClock(mergeClocks(causalServerClock, mutation.vectorClock), 'server')
              : undefined,
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
