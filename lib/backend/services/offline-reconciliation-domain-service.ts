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

        const result = await CommandBus.dispatch(context, {
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
