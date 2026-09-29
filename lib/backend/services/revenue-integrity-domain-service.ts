/**
 * G-HIMS Revenue Integrity Domain Service
 *
 * Revenue Integrity findings are candidate financial discrepancies backed by signed
 * clinical evidence. They never become billable charges until an authorized revenue
 * cycle user explicitly reconciles them.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

export type RevenueIntegrityFindingStatus = 'PENDING_REVIEW' | 'RECONCILED' | 'DISMISSED';

export interface RevenueIntegrityFinding {
  id: string;
  tenantId: string;
  patientId: string;
  patientName?: string;
  encounterId: string;
  sourceEvidenceId: string;
  sourceNoteId?: string;
  documentedItem: string;
  category: 'Procedure' | 'Medication' | 'Lab' | 'Supply / Consumable' | 'Bed Tier';
  suggestedCode: string;
  estimatedRecoverableAmountMinorUnits: number;
  currency: string;
  status: RevenueIntegrityFindingStatus;
  evidenceSnippet: string;
  confidenceScore?: number;
  createdAt: number;
  createdBy: string;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewReason?: string;
  chargeId?: string;
}

export interface EncounterCharge {
  id: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  sourceFindingId: string;
  sourceEvidenceId: string;
  code: string;
  description: string;
  category: RevenueIntegrityFinding['category'];
  quantity: number;
  unitAmountMinorUnits: number;
  netAmountMinorUnits: number;
  currency: string;
  status: 'PENDING_INVOICE';
  createdAt: number;
  createdBy: string;
}

export interface ReconcileRevenueIntegrityFindingPayload {
  findingId: string;
}

export interface DismissRevenueIntegrityFindingPayload {
  findingId: string;
  reason: string;
}

function revenueAuthorization(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'BILLING_CLERK',
      'BILLING_STAFF',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'ADMINISTRATOR',
      'SYSTEM_ADMIN',
    ],
  });
}

export class RevenueIntegrityDomainService {
  public static async reconcile(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReconcileRevenueIntegrityFindingPayload
  ): Promise<CommandResult<{ finding: RevenueIntegrityFinding; charge: EncounterCharge }>> {
    const auth = revenueAuthorization(context);
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Revenue-cycle authorization required.',
        },
      };
    }

    const finding = await DomainStateRepository.getById<RevenueIntegrityFinding>(
      context.tenantId,
      'billingMismatches',
      payload.findingId
    );

    if (!finding) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'REVENUE_FINDING_NOT_FOUND', message: 'Revenue Integrity finding was not found.' },
      };
    }

    if (finding.status === 'RECONCILED' && finding.chargeId) {
      const existingCharge = await DomainStateRepository.getById<EncounterCharge>(
        context.tenantId,
        'encounterCharges',
        finding.chargeId
      );

      if (existingCharge) {
        return {
          success: true,
          commandId,
          idempotencyKey,
          entityId: finding.id,
          data: { finding, charge: existingCharge },
        };
      }
    }

    if (finding.status !== 'PENDING_REVIEW') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_FINDING_ALREADY_REVIEWED',
          message: `Finding ${finding.id} is already ${finding.status}.`,
        },
      };
    }

    if (!Number.isInteger(finding.estimatedRecoverableAmountMinorUnits) || finding.estimatedRecoverableAmountMinorUnits <= 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_RECOVERABLE_AMOUNT',
          message: 'Revenue Integrity finding does not contain a valid positive minor-unit amount.',
        },
      };
    }

    const now = Date.now();
    const chargeId = `chg_ri_${crypto.randomUUID()}`;

    const charge: EncounterCharge = {
      id: chargeId,
      tenantId: context.tenantId,
      patientId: finding.patientId,
      encounterId: finding.encounterId,
      sourceFindingId: finding.id,
      sourceEvidenceId: finding.sourceEvidenceId,
      code: finding.suggestedCode,
      description: finding.documentedItem,
      category: finding.category,
      quantity: 1,
      unitAmountMinorUnits: finding.estimatedRecoverableAmountMinorUnits,
      netAmountMinorUnits: finding.estimatedRecoverableAmountMinorUnits,
      currency: finding.currency || 'USD',
      status: 'PENDING_INVOICE',
      createdAt: now,
      createdBy: context.actorId,
    };

    const reconciledFinding: RevenueIntegrityFinding = {
      ...finding,
      status: 'RECONCILED',
      reviewedAt: now,
      reviewedBy: context.actorId,
      reviewReason: 'Accepted by authorized revenue-cycle reviewer.',
      chargeId,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'BILLING_STAFF',
      aggregateType: 'REVENUE_INTEGRITY_FINDING',
      aggregateId: finding.id,
      eventType: 'REVENUE_INTEGRITY_FINDING_RECONCILED',
      eventPayload: {
        findingId: finding.id,
        patientId: finding.patientId,
        encounterId: finding.encounterId,
        chargeId,
        amountMinorUnits: charge.netAmountMinorUnits,
        currency: charge.currency,
        sourceEvidenceId: finding.sourceEvidenceId,
      },
      auditAction: 'RECONCILE_REVENUE_INTEGRITY_FINDING',
      auditResourceType: 'REVENUE_INTEGRITY_FINDING',
      auditResourceId: finding.id,
      auditReason: `Accepted candidate charge ${finding.suggestedCode} for encounter ${finding.encounterId}.`,
      outboxTopic: 'g-hims-revenue-integrity-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      causalVectorClock: context.offlineVectorClock,
      causalBaseEntityVersion: context.offlineBaseEntityVersion,
      domainState: reconciledFinding,
      additionalStateWrites: [
        {
          entityType: 'ENCOUNTER_CHARGE',
          entityId: chargeId,
          domainState: charge,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: finding.id,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { finding: reconciledFinding, charge },
    };
  }

  public static async dismiss(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DismissRevenueIntegrityFindingPayload
  ): Promise<CommandResult<{ finding: RevenueIntegrityFinding }>> {
    const auth = revenueAuthorization(context);
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Revenue-cycle authorization required.',
        },
      };
    }

    const reason = String(payload.reason || '').trim();
    if (reason.length < 3) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'DISMISSAL_REASON_REQUIRED', message: 'A dismissal reason is required.' },
      };
    }

    const finding = await DomainStateRepository.getById<RevenueIntegrityFinding>(
      context.tenantId,
      'billingMismatches',
      payload.findingId
    );

    if (!finding) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'REVENUE_FINDING_NOT_FOUND', message: 'Revenue Integrity finding was not found.' },
      };
    }

    if (finding.status !== 'PENDING_REVIEW') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_FINDING_ALREADY_REVIEWED',
          message: `Finding ${finding.id} is already ${finding.status}.`,
        },
      };
    }

    const dismissedFinding: RevenueIntegrityFinding = {
      ...finding,
      status: 'DISMISSED',
      reviewedAt: Date.now(),
      reviewedBy: context.actorId,
      reviewReason: reason,
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'REVENUE_INTEGRITY_FINDING',
        entityId: finding.id,
        eventType: 'REVENUE_INTEGRITY_FINDING_DISMISSED',
        domainState: dismissedFinding,
        eventPayload: {
          findingId: finding.id,
          patientId: finding.patientId,
          encounterId: finding.encounterId,
          reason,
          sourceEvidenceId: finding.sourceEvidenceId,
        },
        auditReason: reason,
        outboxTopic: 'g-hims-revenue-integrity-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: finding.id,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: { finding: dismissedFinding },
    };
  }
}
