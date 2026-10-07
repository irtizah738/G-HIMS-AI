import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { RehabilitationPlan, RehabilitationSession } from '@/types/wave2-clinical-domains';
import type { ClinicalHandoff } from '@/types/clinical-coordination';
import {
  ensureSameScope,
  loadWave2ScopedEncounter,
  rehabilitationAuthorization,
  uniqueWave2Strings,
  wave2Failure,
} from './wave2-clinical-common';

export interface CreateRehabilitationPlanPayload {
  patientId: string;
  encounterId: string;
  disciplines: RehabilitationPlan['disciplines'];
  goals: Array<{ description: string; targetDate?: number }>;
  baselineScores?: Record<string, number>;
}

export interface RecordRehabilitationSessionPayload {
  patientId: string;
  encounterId: string;
  rehabilitationPlanId: string;
  discipline: RehabilitationSession['discipline'];
  goalIds: string[];
  performedInterventions?: string[];
  functionalScores?: Record<string, number>;
  outcome: string;
  status?: 'COMPLETED' | 'NOT_DONE';
  notDoneReason?: string;
  occurredAt?: number;
}

export interface UpdateRehabilitationGoalPayload {
  patientId: string;
  encounterId: string;
  rehabilitationPlanId: string;
  goalId: string;
  status: 'ACTIVE' | 'ACHIEVED' | 'NOT_ACHIEVED' | 'CANCELLED';
}

export interface CompleteRehabilitationPlanPayload {
  patientId: string;
  encounterId: string;
  rehabilitationPlanId: string;
  dischargeHandoffId: string;
}

function safeScores(input: Record<string, number> | undefined): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(input || {}).slice(0, 50)) {
    const name = String(key || '').trim();
    if (!name || !Number.isFinite(value) || value < -100000 || value > 100000) continue;
    output[name] = value;
  }
  return output;
}

export class RehabilitationDomainService {
  public static async createPlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateRehabilitationPlanPayload
  ): Promise<CommandResult> {
    const auth = rehabilitationAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, 'UNAUTHORIZED', 'Rehabilitation plan authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const disciplines = Array.from(new Set(payload.disciplines || [])).slice(0, 10);
    const goals = (payload.goals || [])
      .map((goal) => ({
        description: String(goal.description || '').trim(),
        targetDate: goal.targetDate,
      }))
      .filter((goal) => goal.description)
      .slice(0, 50);
    if (disciplines.length === 0 || goals.length === 0) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_PLAN_INVALID', 'At least one rehabilitation discipline and goal are required.');
    }

    const rehabilitationPlanId = `rehab_plan_${crypto.randomUUID()}`;
    const now = Date.now();
    const plan: RehabilitationPlan = {
      rehabilitationPlanId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      disciplines,
      goals: goals.map((goal, index) => ({
        goalId: `${rehabilitationPlanId}_goal_${index + 1}`,
        description: goal.description,
        status: 'ACTIVE',
        targetDate: goal.targetDate,
      })),
      baselineScores: safeScores(payload.baselineScores),
      status: 'ACTIVE',
      authoredBy: context.actorId,
      authoredAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'THERAPIST',
      aggregateType: 'REHABILITATION_PLAN',
      aggregateId: rehabilitationPlanId,
      eventType: 'REHABILITATION_PLAN_CREATED',
      eventPayload: {
        rehabilitationPlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        disciplines,
        goalIds: plan.goals.map((goal) => goal.goalId),
      },
      auditAction: 'CREATE_REHABILITATION_PLAN',
      auditResourceType: 'REHABILITATION_PLAN',
      auditResourceId: rehabilitationPlanId,
      auditReason: 'Created governed rehabilitation plan.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: plan,
      expectedPrimaryServerVersion: 0,
    });
    return { success: true, commandId, idempotencyKey, entityId: rehabilitationPlanId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: plan };
  }

  public static async recordSession(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordRehabilitationSessionPayload
  ): Promise<CommandResult> {
    const auth = rehabilitationAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, 'UNAUTHORIZED', 'Rehabilitation session authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const plan = await DomainStateRepository.getById<RehabilitationPlan>(
      context.tenantId,
      'rehabilitationPlans',
      payload.rehabilitationPlanId
    );
    if (!ensureSameScope(plan as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !plan || plan.status !== 'ACTIVE') {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_PLAN_NOT_ACTIVE', 'An active rehabilitation plan for this patient encounter is required.');
    }
    if (!plan.disciplines.includes(payload.discipline)) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_DISCIPLINE_NOT_AUTHORIZED', 'Session discipline is not included in the active rehabilitation plan.');
    }

    const goalIds = uniqueWave2Strings(payload.goalIds, 50);
    if (goalIds.some((goalId) => !plan.goals.some((goal) => goal.goalId === goalId))) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_GOAL_SCOPE_MISMATCH', 'Session references a goal outside the active rehabilitation plan.');
    }
    const status = payload.status || 'COMPLETED';
    if (status === 'NOT_DONE' && String(payload.notDoneReason || '').trim().length < 5) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_NOT_DONE_REASON_REQUIRED', 'A not-done session requires an explicit reason.');
    }

    const rehabilitationSessionId = `rehab_session_${crypto.randomUUID()}`;
    const occurredAt = payload.occurredAt || Date.now();
    const session: RehabilitationSession = {
      rehabilitationSessionId,
      rehabilitationPlanId: plan.rehabilitationPlanId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      discipline: payload.discipline,
      goalIds,
      performedInterventions: uniqueWave2Strings(payload.performedInterventions, 100),
      functionalScores: safeScores(payload.functionalScores),
      outcome: String(payload.outcome || '').trim(),
      status,
      notDoneReason: status === 'NOT_DONE' ? String(payload.notDoneReason || '').trim() : undefined,
      therapistId: context.actorId,
      occurredAt,
    };
    if (!session.outcome) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_OUTCOME_REQUIRED', 'Session outcome is required.');
    }

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'THERAPIST',
      aggregateType: 'REHABILITATION_SESSION',
      aggregateId: rehabilitationSessionId,
      eventType: status === 'COMPLETED' ? 'REHABILITATION_SESSION_COMPLETED' : 'REHABILITATION_SESSION_NOT_DONE',
      eventPayload: {
        rehabilitationSessionId,
        rehabilitationPlanId: plan.rehabilitationPlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        discipline: payload.discipline,
        goalIds,
        functionalScores: session.functionalScores,
        status,
      },
      auditAction: 'RECORD_REHABILITATION_SESSION',
      auditResourceType: 'REHABILITATION_PLAN',
      auditResourceId: plan.rehabilitationPlanId,
      auditReason: `Recorded ${payload.discipline} rehabilitation session.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: session,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: rehabilitationSessionId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: session };
  }

  public static async updateGoal(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpdateRehabilitationGoalPayload
  ): Promise<CommandResult> {
    const auth = rehabilitationAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, 'UNAUTHORIZED', 'Rehabilitation goal authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const plan = await DomainStateRepository.getById<RehabilitationPlan>(
      context.tenantId,
      'rehabilitationPlans',
      payload.rehabilitationPlanId
    );
    if (!ensureSameScope(plan as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !plan || plan.status !== 'ACTIVE') {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_PLAN_NOT_ACTIVE', 'Active rehabilitation plan is required.');
    }
    const goal = plan.goals.find((item) => item.goalId === payload.goalId);
    if (!goal) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_GOAL_NOT_FOUND', 'Goal is not part of the rehabilitation plan.');
    }

    const next: RehabilitationPlan = {
      ...plan,
      goals: plan.goals.map((item) =>
        item.goalId === payload.goalId ? { ...item, status: payload.status } : item
      ),
      updatedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'THERAPIST',
      aggregateType: 'REHABILITATION_PLAN',
      aggregateId: plan.rehabilitationPlanId,
      eventType: 'REHABILITATION_GOAL_UPDATED',
      eventPayload: {
        rehabilitationPlanId: plan.rehabilitationPlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        goalId: payload.goalId,
        previousStatus: goal.status,
        status: payload.status,
      },
      auditAction: 'UPDATE_REHABILITATION_GOAL',
      auditResourceType: 'REHABILITATION_PLAN',
      auditResourceId: plan.rehabilitationPlanId,
      auditReason: `Updated rehabilitation goal ${payload.goalId} to ${payload.status}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
      expectedPrimaryServerVersion: Number((plan as unknown as Record<string, unknown>)._serverVersion || 0),
    });

    return { success: true, commandId, idempotencyKey, entityId: plan.rehabilitationPlanId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: next };
  }

  public static async completePlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteRehabilitationPlanPayload
  ): Promise<CommandResult> {
    const auth = rehabilitationAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, 'UNAUTHORIZED', 'Rehabilitation completion authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const [plan, handoff] = await Promise.all([
      DomainStateRepository.getById<RehabilitationPlan>(context.tenantId, 'rehabilitationPlans', payload.rehabilitationPlanId),
      DomainStateRepository.getById<ClinicalHandoff>(context.tenantId, 'clinicalHandoffs', payload.dischargeHandoffId),
    ]);
    if (!ensureSameScope(plan as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !plan || plan.status !== 'ACTIVE') {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_PLAN_NOT_ACTIVE', 'Active rehabilitation plan is required.');
    }
    if (
      !handoff ||
      handoff.patientId !== payload.patientId ||
      handoff.encounterId !== payload.encounterId ||
      handoff.status !== 'ACCEPTED'
    ) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_DISCHARGE_HANDOFF_REQUIRED', 'Plan completion requires an accepted clinical handoff for this patient encounter.');
    }

    const unresolvedGoals = plan.goals.filter((goal) => goal.status === 'ACTIVE');
    if (unresolvedGoals.length > 0) {
      return wave2Failure(commandId, idempotencyKey, 'REHABILITATION_GOALS_UNRESOLVED', 'All rehabilitation goals must be dispositioned before plan completion.');
    }

    const next: RehabilitationPlan = {
      ...plan,
      status: 'COMPLETED',
      dischargeHandoffId: handoff.handoffId,
      updatedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'THERAPIST',
      aggregateType: 'REHABILITATION_PLAN',
      aggregateId: plan.rehabilitationPlanId,
      eventType: 'REHABILITATION_PLAN_COMPLETED',
      eventPayload: {
        rehabilitationPlanId: plan.rehabilitationPlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        dischargeHandoffId: handoff.handoffId,
      },
      auditAction: 'COMPLETE_REHABILITATION_PLAN',
      auditResourceType: 'REHABILITATION_PLAN',
      auditResourceId: plan.rehabilitationPlanId,
      auditReason: 'Completed rehabilitation plan with accepted discharge handoff.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
      expectedPrimaryServerVersion: Number((plan as unknown as Record<string, unknown>)._serverVersion || 0),
    });

    return { success: true, commandId, idempotencyKey, entityId: plan.rehabilitationPlanId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: next };
  }
}
