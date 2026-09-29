import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import type { CommandContext, CommandResult } from '../types';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';

export interface RecordDischargeReadinessReviewPayload {
  patientId: string;
  encounterId: string;
  evaluationId: string;
  outcome: 'ACKNOWLEDGED' | 'ESCALATE' | 'PROCEED_WITH_WARNINGS';
  reviewedFindingIds?: string[];
  reason?: string;
}

export class DischargeReadinessReviewDomainService {
  public static async record(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordDischargeReadinessReviewPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinician review authority required.',
        },
      };
    }

    if (
      !payload.patientId ||
      !payload.encounterId ||
      !payload.evaluationId ||
      !['ACKNOWLEDGED', 'ESCALATE', 'PROCEED_WITH_WARNINGS'].includes(
        payload.outcome
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_DISCHARGE_READINESS_REVIEW',
          message:
            'Patient, encounter, evaluation and a supported review outcome are required.',
        },
      };
    }

    const [patient360, readiness] = await Promise.all([
      Patient360ProjectionService.getProjection(context.tenantId, payload.patientId),
      DischargeReadinessService.getProjection(
        context.tenantId,
        payload.encounterId
      ),
    ]);

    if (
      !patient360 ||
      patient360.activeEncounter?.encounterId !== payload.encounterId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_ENCOUNTER_MISMATCH',
          message:
            'The reviewed encounter is not the current authoritative inpatient encounter.',
        },
      };
    }

    if (
      !readiness ||
      readiness.patientId !== payload.patientId ||
      readiness.evaluationId !== payload.evaluationId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_EVALUATION_STALE',
          message:
            'The selected discharge-readiness evaluation is no longer the latest authoritative assessment.',
        },
      };
    }

    if (
      payload.outcome === 'PROCEED_WITH_WARNINGS' &&
      readiness.blockers.length > 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_BLOCKERS_PRESENT',
          message:
            'A clinician review cannot convert CI-7 safety blockers into a discharge authorization. Resolve the blocker or use the separately governed emergency pathway.',
          details: readiness.blockers.map((item) => item.findingId),
        },
      };
    }

    const knownFindingIds = new Set(
      [
        ...readiness.blockers,
        ...readiness.warnings,
        ...readiness.information,
      ].map((item) => item.findingId)
    );
    const reviewedFindingIds = Array.from(
      new Set((payload.reviewedFindingIds || []).map(String).filter(Boolean))
    );

    if (reviewedFindingIds.some((id) => !knownFindingIds.has(id))) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_FINDING_MISMATCH',
          message:
            'One or more reviewed finding IDs do not belong to the selected evaluation.',
        },
      };
    }

    if (
      payload.outcome === 'ESCALATE' &&
      !String(payload.reason || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_REVIEW_REASON_REQUIRED',
          message: 'Escalation requires a documented clinical reason.',
        },
      };
    }

    const reviewedAt = Date.now();
    const reviewId = `drreview_${crypto.randomUUID()}`;
    const domainState = {
      reviewId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      evaluationId: payload.evaluationId,
      readinessState: readiness.state,
      outcome: payload.outcome,
      reviewedFindingIds,
      reason: String(payload.reason || '').trim() || undefined,
      reviewedBy: context.actorId,
      reviewedAt,
      patient360Revision: readiness.patient360Revision,
      rulesetVersion: readiness.rulesetVersion,
      immutable: true,
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'DISCHARGE_READINESS_REVIEW',
        entityId: reviewId,
        eventType: 'DISCHARGE_READINESS_REVIEW_RECORDED',
        domainState,
        eventPayload: {
          reviewId,
          patientId: payload.patientId,
          encounterId: payload.encounterId,
          evaluationId: payload.evaluationId,
          readinessState: readiness.state,
          outcome: payload.outcome,
          reviewedFindingIds,
        },
        auditReason: `Clinician ${payload.outcome.toLowerCase().replace(/_/g, ' ')} CI-7 evaluation ${payload.evaluationId}`,
        outboxTopic: 'g-hims-clinical-intelligence-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: reviewId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }
}
