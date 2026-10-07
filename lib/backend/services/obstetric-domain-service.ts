import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { ObstetricEpisode, ObstetricPartogramEntry } from '@/types/wave2-clinical-domains';
import {
  clinicianAuthorization,
  ensureSameScope,
  loadWave2ScopedEncounter,
  nurseAuthorization,
  uniqueWave2Strings,
  wave2Failure,
} from './wave2-clinical-common';

export interface CreateObstetricEpisodePayload {
  patientId: string;
  encounterId: string;
  gestationalAgeWeeks: number;
  gravida: number;
  para: number;
  riskFactors?: string[];
}

export interface RecordPartogramObservationPayload {
  patientId: string;
  encounterId: string;
  obstetricEpisodeId: string;
  observedAt?: number;
  cervicalDilationCm?: number;
  fetalHeartRateBpm?: number;
  maternalHeartRateBpm?: number;
  systolicBp?: number;
  diastolicBp?: number;
  contractionsPer10Min?: number;
  membranes?: ObstetricPartogramEntry['membranes'];
  liquor?: ObstetricPartogramEntry['liquor'];
  oxytocinMuPerMin?: number;
}

export interface TransitionObstetricEpisodePayload {
  patientId: string;
  encounterId: string;
  obstetricEpisodeId: string;
  targetStage: ObstetricEpisode['stage'];
  reason: string;
}

export interface RecordDeliveryOutcomePayload {
  patientId: string;
  encounterId: string;
  obstetricEpisodeId: string;
  deliveredAt?: number;
  mode: NonNullable<ObstetricEpisode['deliveryOutcome']>['mode'];
  newbornIds?: string[];
  maternalOutcome: string;
  neonatalOutcome: string;
}

function partogramEscalation(
  payload: RecordPartogramObservationPayload
): ObstetricEpisode['escalationState'] {
  const fhr = payload.fetalHeartRateBpm;
  const sbp = payload.systolicBp;
  const dbp = payload.diastolicBp;
  const maternalHr = payload.maternalHeartRateBpm;

  if (
    (typeof fhr === 'number' && (fhr < 100 || fhr > 180)) ||
    (typeof sbp === 'number' && sbp >= 160) ||
    (typeof dbp === 'number' && dbp >= 110)
  ) {
    return 'URGENT_REVIEW';
  }

  if (
    (typeof fhr === 'number' && (fhr < 110 || fhr > 160)) ||
    (typeof maternalHr === 'number' && maternalHr >= 120) ||
    (typeof sbp === 'number' && sbp >= 140) ||
    (typeof dbp === 'number' && dbp >= 90)
  ) {
    return 'REVIEW_REQUIRED';
  }

  return 'NONE';
}

const allowedTransitions: Record<ObstetricEpisode['stage'], ObstetricEpisode['stage'][]> = {
  ADMISSION: ['LABOR', 'THEATRE'],
  LABOR: ['DELIVERY', 'THEATRE'],
  DELIVERY: ['POSTPARTUM', 'THEATRE'],
  THEATRE: ['DELIVERY', 'POSTPARTUM'],
  POSTPARTUM: ['COMPLETED'],
  COMPLETED: [],
};

export class ObstetricDomainService {
  public static async createEpisode(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateObstetricEpisodePayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Obstetric episode authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    if (
      !Number.isFinite(payload.gestationalAgeWeeks) ||
      payload.gestationalAgeWeeks < 20 ||
      payload.gestationalAgeWeeks > 45 ||
      !Number.isInteger(payload.gravida) ||
      payload.gravida < 0 ||
      !Number.isInteger(payload.para) ||
      payload.para < 0 ||
      payload.para > payload.gravida
    ) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_EPISODE_INVALID', 'Gestational age and gravida/para history are invalid.');
    }

    const obstetricEpisodeId = `ob_ep_${payload.encounterId}`;
    const existing = await DomainStateRepository.getById<ObstetricEpisode>(
      context.tenantId,
      'obstetricEpisodes',
      obstetricEpisodeId
    );
    if (existing) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_EPISODE_ALREADY_EXISTS', 'This encounter already has an obstetric episode and cannot be reinitialized.');
    }

    const now = Date.now();
    const episode: ObstetricEpisode = {
      obstetricEpisodeId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      gestationalAgeWeeks: payload.gestationalAgeWeeks,
      gravida: payload.gravida,
      para: payload.para,
      stage: 'ADMISSION',
      riskFactors: uniqueWave2Strings(payload.riskFactors, 100),
      escalationState: 'NONE',
      createdBy: context.actorId,
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'OBSTETRIC_EPISODE',
      aggregateId: obstetricEpisodeId,
      eventType: 'OBSTETRIC_EPISODE_CREATED',
      eventPayload: {
        obstetricEpisodeId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        gestationalAgeWeeks: payload.gestationalAgeWeeks,
        gravida: payload.gravida,
        para: payload.para,
      },
      auditAction: 'CREATE_OBSTETRIC_EPISODE',
      auditResourceType: 'OBSTETRIC_EPISODE',
      auditResourceId: obstetricEpisodeId,
      auditReason: 'Created governed obstetric episode.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: episode,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: obstetricEpisodeId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: episode };
  }

  public static async recordPartogram(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordPartogramObservationPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Partogram recording authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const episode = await DomainStateRepository.getById<ObstetricEpisode>(
      context.tenantId,
      'obstetricEpisodes',
      payload.obstetricEpisodeId
    );
    if (!ensureSameScope(episode as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !episode || ['COMPLETED', 'POSTPARTUM'].includes(episode.stage)) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_EPISODE_NOT_MONITORABLE', 'Partogram observations require an active antepartum/labor obstetric episode.');
    }

    if (
      payload.cervicalDilationCm !== undefined &&
      (payload.cervicalDilationCm < 0 || payload.cervicalDilationCm > 10)
    ) {
      return wave2Failure(commandId, idempotencyKey, 'PARTOGRAM_DILATION_INVALID', 'Cervical dilation must be between 0 and 10 cm.');
    }

    const observedAt = payload.observedAt || Date.now();
    if (observedAt > Date.now() + 5 * 60_000) {
      return wave2Failure(commandId, idempotencyKey, 'PARTOGRAM_FUTURE_OBSERVATION', 'Partogram observation time cannot be materially in the future.');
    }

    const escalationState = partogramEscalation(payload);
    const partogramEntryId = `part_${payload.obstetricEpisodeId}_${observedAt}_${crypto.randomUUID().slice(0, 8)}`;
    const entry: ObstetricPartogramEntry = {
      partogramEntryId,
      obstetricEpisodeId: episode.obstetricEpisodeId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      observedAt,
      cervicalDilationCm: payload.cervicalDilationCm,
      fetalHeartRateBpm: payload.fetalHeartRateBpm,
      maternalHeartRateBpm: payload.maternalHeartRateBpm,
      systolicBp: payload.systolicBp,
      diastolicBp: payload.diastolicBp,
      contractionsPer10Min: payload.contractionsPer10Min,
      membranes: payload.membranes,
      liquor: payload.liquor,
      oxytocinMuPerMin: payload.oxytocinMuPerMin,
      escalationState,
      recordedBy: context.actorId,
    };

    const nextEpisode: ObstetricEpisode = {
      ...episode,
      escalationState:
        escalationState === 'URGENT_REVIEW'
          ? 'URGENT_REVIEW'
          : episode.escalationState === 'URGENT_REVIEW'
            ? episode.escalationState
            : escalationState,
      updatedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'OBSTETRIC_PARTOGRAM_ENTRY',
      aggregateId: partogramEntryId,
      eventType:
        escalationState === 'NONE'
          ? 'OBSTETRIC_PARTOGRAM_RECORDED'
          : 'OBSTETRIC_PARTOGRAM_ESCALATION_RECORDED',
      eventPayload: {
        partogramEntryId,
        obstetricEpisodeId: episode.obstetricEpisodeId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        observedAt,
        escalationState,
        fetalHeartRateBpm: payload.fetalHeartRateBpm,
        cervicalDilationCm: payload.cervicalDilationCm,
      },
      auditAction: 'RECORD_OBSTETRIC_PARTOGRAM',
      auditResourceType: 'OBSTETRIC_EPISODE',
      auditResourceId: episode.obstetricEpisodeId,
      auditReason: `Partogram observation recorded with ${escalationState} escalation state.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: entry,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites: [{
        entityType: 'OBSTETRIC_EPISODE',
        entityId: episode.obstetricEpisodeId,
        domainState: nextEpisode,
        expectedServerVersion: Number((episode as unknown as Record<string, unknown>)._serverVersion || 0),
      }],
    });

    return { success: true, commandId, idempotencyKey, entityId: partogramEntryId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: entry };
  }

  public static async transitionEpisode(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransitionObstetricEpisodePayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Obstetric transition authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const episode = await DomainStateRepository.getById<ObstetricEpisode>(
      context.tenantId,
      'obstetricEpisodes',
      payload.obstetricEpisodeId
    );
    if (!ensureSameScope(episode as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !episode) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_EPISODE_SCOPE_MISMATCH', 'Obstetric episode does not match this patient encounter.');
    }
    if (!allowedTransitions[episode.stage].includes(payload.targetStage)) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_TRANSITION_INVALID', `Cannot transition obstetric episode from ${episode.stage} to ${payload.targetStage}.`);
    }
    const reason = String(payload.reason || '').trim();
    if (reason.length < 5) return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_TRANSITION_REASON_REQUIRED', 'A clinical transition reason is required.');

    const now = Date.now();
    const next: ObstetricEpisode = {
      ...episode,
      stage: payload.targetStage,
      escalationState:
        payload.targetStage === 'THEATRE'
          ? 'THEATRE_ACTIVATED'
          : episode.escalationState,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'OBSTETRIC_EPISODE',
      aggregateId: episode.obstetricEpisodeId,
      eventType: payload.targetStage === 'THEATRE' ? 'OBSTETRIC_THEATRE_TRANSITIONED' : 'OBSTETRIC_STAGE_TRANSITIONED',
      eventPayload: {
        obstetricEpisodeId: episode.obstetricEpisodeId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        fromStage: episode.stage,
        toStage: payload.targetStage,
        reason,
      },
      auditAction: 'TRANSITION_OBSTETRIC_EPISODE',
      auditResourceType: 'OBSTETRIC_EPISODE',
      auditResourceId: episode.obstetricEpisodeId,
      auditReason: reason,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
      expectedPrimaryServerVersion: Number((episode as unknown as Record<string, unknown>)._serverVersion || 0),
    });

    return { success: true, commandId, idempotencyKey, entityId: episode.obstetricEpisodeId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: next };
  }

  public static async recordDeliveryOutcome(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordDeliveryOutcomePayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Delivery outcome authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const episode = await DomainStateRepository.getById<ObstetricEpisode>(
      context.tenantId,
      'obstetricEpisodes',
      payload.obstetricEpisodeId
    );
    if (!ensureSameScope(episode as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !episode || !['DELIVERY', 'THEATRE'].includes(episode.stage)) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_DELIVERY_STAGE_REQUIRED', 'Delivery outcome can only be recorded during delivery or theatre stage.');
    }

    const deliveredAt = payload.deliveredAt || Date.now();
    const next: ObstetricEpisode = {
      ...episode,
      stage: 'POSTPARTUM',
      deliveryOutcome: {
        deliveredAt,
        mode: payload.mode,
        newbornIds: uniqueWave2Strings(payload.newbornIds, 10),
        maternalOutcome: String(payload.maternalOutcome || '').trim(),
        neonatalOutcome: String(payload.neonatalOutcome || '').trim(),
      },
      updatedAt: Date.now(),
    };
    if (!next.deliveryOutcome.maternalOutcome || !next.deliveryOutcome.neonatalOutcome) {
      return wave2Failure(commandId, idempotencyKey, 'OBSTETRIC_OUTCOME_INCOMPLETE', 'Maternal and neonatal outcomes are required.');
    }

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'OBSTETRIC_EPISODE',
      aggregateId: episode.obstetricEpisodeId,
      eventType: 'OBSTETRIC_DELIVERY_RECORDED',
      eventPayload: {
        obstetricEpisodeId: episode.obstetricEpisodeId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        deliveredAt,
        mode: payload.mode,
        newbornIds: next.deliveryOutcome.newbornIds,
      },
      auditAction: 'RECORD_OBSTETRIC_DELIVERY',
      auditResourceType: 'OBSTETRIC_EPISODE',
      auditResourceId: episode.obstetricEpisodeId,
      auditReason: `Recorded ${payload.mode} delivery outcome.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
      expectedPrimaryServerVersion: Number((episode as unknown as Record<string, unknown>)._serverVersion || 0),
    });

    return { success: true, commandId, idempotencyKey, entityId: episode.obstetricEpisodeId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: next };
  }
}
