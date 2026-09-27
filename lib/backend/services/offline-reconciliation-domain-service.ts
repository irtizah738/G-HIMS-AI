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
