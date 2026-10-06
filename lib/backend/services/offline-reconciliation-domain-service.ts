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
import {
  compareAuthoritativeEntityVersion,
  getAuthoritativeEntityVersion,
} from '@/server/repositories/edge-version-repository';
import { compareClocks } from '@/lib/offline/vector-clock';

function conflictCategory(commandType: string): ConflictCategory {
  if (['PostJournalCommand', 'RecordCashReceiptCommand'].includes(commandType)) return 'FINANCIAL_CONFLICT';
  if (
    [
      'PrescribeMedicationCommand',
      'DispensePrescriptionCommand',
      'AdmitPatientToBedCommand',
      'DischargePatientFromBedCommand',
      'MergePatientCommand',
      'AdvanceStageCommand',
      'AdvanceDiagnosticWorklistCommand',
    ].includes(commandType)
  ) return 'SAFETY_CRITICAL';
  if (
    [
      'RegisterPatientAndEncounterCommand',
      'RecordVitalsCommand',
      'SignClinicalNoteCommand',
      'PlaceDiagnosticOrderCommand',
      'CreateOpdConsultationInvoiceCommand',
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

function entityTypeForCommand(commandType: string): string {
  const map: Record<string, string> = {
    PlaceDiagnosticOrderCommand: 'DIAGNOSTIC_ORDER',
    CreateOpdConsultationInvoiceCommand: 'INVOICE',
    PrescribeMedicationCommand: 'PRESCRIPTION',
    RecordVitalsCommand: 'ENCOUNTER_EVIDENCE',
    SignClinicalNoteCommand: 'ENCOUNTER_EVIDENCE',
    RecordCashReceiptCommand: 'CASH_RECEIPT',
    RecordStockTransactionCommand: 'STOCK_TRANSACTION',
    RecordPatientConsumptionCommand: 'PATIENT_CONSUMPTION',
    SubmitPurchaseRequisitionCommand: 'PURCHASE_REQUISITION',
  };
  return map[commandType] || 'ENTITY';
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
    source: 'offline',
    bloodGroup: payload.bloodGroup ? String(payload.bloodGroup) : undefined,
    allergies: Array.isArray(payload.allergies) ? payload.allergies.map(String) : [],
    chronicConditions: Array.isArray(payload.chronicConditions)
      ? payload.chronicConditions.map(String)
      : [],
    tariffPlan: payload.tariffPlan
      ? String(payload.tariffPlan) as any
      : undefined,
    insuranceDetails:
      payload.insuranceDetails && typeof payload.insuranceDetails === 'object'
        ? payload.insuranceDetails as any
        : undefined,
    consentDecisions: Array.isArray(payload.consentDecisions)
      ? payload.consentDecisions as any
      : undefined,
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

function orderMutationsByDependencies(
  mutations: OfflineMutationItem[]
): {
  ordered: OfflineMutationItem[];
  cyclicMutationIds: string[];
} {
  const byId = new Map(
    mutations.map((mutation) => [mutation.mutationId, mutation])
  );
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const mutation of mutations) {
    indegree.set(mutation.mutationId, 0);
    children.set(mutation.mutationId, []);
  }

  for (const mutation of mutations) {
    for (const dependencyId of mutation.dependsOnMutationIds || []) {
      if (!byId.has(dependencyId)) continue;
      indegree.set(
        mutation.mutationId,
        (indegree.get(mutation.mutationId) || 0) + 1
      );
      children.get(dependencyId)!.push(mutation.mutationId);
    }
  }

  const priority = (mutation: OfflineMutationItem) =>
    mutation.commandType === 'RegisterPatientAndEncounterCommand' ? 0 : 1;
  const ready = mutations
    .filter((mutation) => (indegree.get(mutation.mutationId) || 0) === 0)
    .sort(
      (left, right) =>
        priority(left) - priority(right) ||
        left.occurredAt - right.occurredAt ||
        left.mutationId.localeCompare(right.mutationId)
    );

  const ordered: OfflineMutationItem[] = [];
  while (ready.length > 0) {
    const mutation = ready.shift()!;
    ordered.push(mutation);

    for (const childId of children.get(mutation.mutationId) || []) {
      const next = (indegree.get(childId) || 0) - 1;
      indegree.set(childId, next);
      if (next === 0) {
        ready.push(byId.get(childId)!);
        ready.sort(
          (left, right) =>
            priority(left) - priority(right) ||
            left.occurredAt - right.occurredAt ||
            left.mutationId.localeCompare(right.mutationId)
        );
      }
    }
  }

  const acceptedOrder = new Set(ordered.map((mutation) => mutation.mutationId));
  return {
    ordered,
    cyclicMutationIds: mutations
      .filter((mutation) => !acceptedOrder.has(mutation.mutationId))
      .map((mutation) => mutation.mutationId),
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
    // Tracks only mutations accepted earlier in this same authenticated batch.
    // This lets an offline device replay a causal sequence of safety-critical
    // commands against one entity without falsely conflicting with the version
    // increment produced by its own immediately preceding command.
    const acceptedEntityClocks = new Map<string, Record<string, number>>();
    const acceptedMutationIds = new Set<string>();
    const batchMutationIds = new Set(
      batch.mutations.map((mutation) => mutation.mutationId)
    );

    // Dependencies are authoritative replay order. Timestamp is only a stable
    // tie-breaker among independent mutations; it never overrides causality.
    const { ordered, cyclicMutationIds } =
      orderMutationsByDependencies(batch.mutations);

    for (const mutationId of cyclicMutationIds) {
      const mutation = batch.mutations.find(
        (candidate) => candidate.mutationId === mutationId
      )!;
      conflicted += 1;
      results.push({
        mutationId,
        status: 'requires_review',
        conflictCategory: conflictCategory(mutation.commandType),
        reason:
          'OFFLINE_DEPENDENCY_CYCLE: queued commands contain a causal dependency cycle and require server review.',
      });
    }

    for (const mutation of ordered) {
      const category = conflictCategory(mutation.commandType);

      try {
        const unresolvedDependencies = (mutation.dependsOnMutationIds || [])
          .filter(
            (dependencyId) =>
              batchMutationIds.has(dependencyId) &&
              !acceptedMutationIds.has(dependencyId)
          );
        if (unresolvedDependencies.length > 0) {
          conflicted += 1;
          results.push({
            mutationId: mutation.mutationId,
            status: 'requires_review',
            conflictCategory: category,
            reason:
              `OFFLINE_DEPENDENCY_NOT_ACCEPTED: prerequisite mutation(s) ${unresolvedDependencies.join(', ')} did not complete before this command.`,
          });
          continue;
        }
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
            acceptedMutationIds.add(mutation.mutationId);
            for (const mapping of registration.mappings) {
              canonicalMappings.set(mapping.localId, mapping.canonicalId);
            }
            // The registration orchestrator commits versioned authoritative
            // patient/encounter/queue documents; no replay-only version counter is used.
          } else {
            rejected += 1;
          }
          continue;
        }

        const resolvedEntityId = String(
          rewriteMappedReferences(mutation.entityId || '', canonicalMappings)
        );
        const authoritativeEntityId =
          resolvedEntityId ||
          String(
            payload.bedId ||
            payload.tokenId ||
            payload.patientId ||
            payload.encounterId ||
            payload.findingId ||
            payload.orderId ||
            ''
          );
        const currentVersion = authoritativeEntityId
          ? await getAuthoritativeEntityVersion(
              context.tenantId,
              mutation.collection,
              authoritativeEntityId
            )
          : null;
        const causalState = compareAuthoritativeEntityVersion(
          currentVersion,
          mutation.baseEntityVersion,
          mutation.baseVectorClock
        );
        const entityChainKey = authoritativeEntityId
          ? `${mutation.collection}:${authoritativeEntityId}`
          : '';
        const priorAcceptedClock = entityChainKey
          ? acceptedEntityClocks.get(entityChainKey)
          : undefined;
        const chainRelation =
          priorAcceptedClock &&
          mutation.vectorClock &&
          Object.keys(priorAcceptedClock).length > 0 &&
          Object.keys(mutation.vectorClock).length > 0
            ? compareClocks(priorAcceptedClock, mutation.vectorClock)
            : null;
        const isCausalContinuation =
          chainRelation === 'LESS' || chainRelation === 'EQUAL';

        if (
          category !== 'SAFE_APPEND' &&
          causalState !== 'MATCH' &&
          !isCausalContinuation
        ) {
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
          const canonicalEntityId = result.entityId || resolvedEntityId || mutation.mutationId;
          const version = canonicalEntityId
            ? await getAuthoritativeEntityVersion(
                context.tenantId,
                mutation.collection,
                canonicalEntityId
              )
            : null;

          const entityMappings =
            mutation.entityId &&
            result.entityId &&
            mutation.entityId !== result.entityId
              ? [{
                  localId: mutation.entityId,
                  canonicalId: result.entityId,
                  entityType: entityTypeForCommand(mutation.commandType),
                }]
              : [];

          for (const mapping of entityMappings) {
            canonicalMappings.set(mapping.localId, mapping.canonicalId);
          }

          if (
            entityChainKey &&
            mutation.vectorClock &&
            Object.keys(mutation.vectorClock).length > 0
          ) {
            acceptedEntityClocks.set(entityChainKey, mutation.vectorClock);
          }

          accepted += 1;
          acceptedMutationIds.add(mutation.mutationId);
          results.push({
            mutationId: mutation.mutationId,
            status: 'accepted',
            conflictCategory: category,
            serverEventId: result.eventId,
            serverVersion: version?.serverVersion,
            vectorClock: version?.vectorClock,
            data: result.data,
            ...(entityMappings.length > 0 ? { entityMappings } : {}),
          });
          continue;
        }

        const code = result.error?.code || 'OFFLINE_COMMAND_REJECTED';
        if (
          category === 'FINANCIAL_CONFLICT' ||
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
