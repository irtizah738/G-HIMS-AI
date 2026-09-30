import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  PurchaseRequisition,
  SupplierMaster,
} from '@/types/scm-domain';
import type {
  ApproveSupplierContractPayload,
  AwardSupplierContractPayload,
  ChangeSupplierContractStatusPayload,
  CreateRfqPayload,
  GovernedRfqRecord,
  GovernedSupplierQuotation,
  RecordSupplierQuotationPayload,
  ReviewSupplierQualificationPayload,
  SupplierContract,
  SupplierQualificationReview,
} from '@/types/scm-sourcing';
import { evaluateSupplierQuotations } from '@/lib/supply-chain/supplier-sourcing';

function rejection(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

function assertFacilityScope(context: CommandContext, facilityId: string): void {
  const admin = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !admin &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Supplier sourcing operation is outside the actor facility scope.'
    );
  }
}

function assertIsoDate(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new AtomicMutationRejectedError(code, 'A valid ISO date is required.');
  }
  return parsed;
}

function assertSupplierCompliance(
  supplier: SupplierMaster,
  effectiveAt?: string
): void {
  if (supplier.status !== 'ACTIVE') {
    throw new AtomicMutationRejectedError(
      'SUPPLIER_NOT_ACTIVE',
      'Supplier must be ACTIVE for governed sourcing.'
    );
  }
  if (supplier.scorecard?.complianceStatus === 'NON_COMPLIANT_BLOCKED') {
    throw new AtomicMutationRejectedError(
      'SUPPLIER_COMPLIANCE_BLOCK',
      'Supplier compliance status blocks sourcing activity.'
    );
  }

  const effectiveMs = effectiveAt ? assertIsoDate(effectiveAt, 'INVALID_EFFECTIVE_DATE') : Date.now();
  const expired = (supplier.certifications || []).filter((certification) => {
    const validUntil = Date.parse(certification.validUntil);
    return certification.isExpired || !Number.isFinite(validUntil) || validUntil < effectiveMs;
  });
  if (expired.length) {
    throw new AtomicMutationRejectedError(
      'SUPPLIER_CERTIFICATION_EXPIRED',
      'Supplier has expired or invalid mandatory certification evidence.',
      { certifications: expired.map((certification) => certification.name) }
    );
  }

  if (supplier.drugLicenseExpiry) {
    const expiry = Date.parse(supplier.drugLicenseExpiry);
    if (!Number.isFinite(expiry) || expiry < effectiveMs) {
      throw new AtomicMutationRejectedError(
        'SUPPLIER_DRUG_LICENSE_EXPIRED',
        'Supplier drug license is expired for the effective sourcing date.'
      );
    }
  }
}

function roundMoneyMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AtomicMutationRejectedError(
      'INVALID_MINOR_CURRENCY_AMOUNT',
      'Currency amounts must be safe non-negative integer minor units.'
    );
  }
  return value;
}

export class ScmSourcingDomainService {
  public static async reviewSupplierQualification(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReviewSupplierQualificationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'QUALITY_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier qualification authority required.'
      );
    }

    try {
      const reviewMs = assertIsoDate(
        payload.reviewedAt,
        'INVALID_SUPPLIER_REVIEW_DATE'
      );
      const reviewId = `sqrev_${payload.supplierId}_${reviewMs}`;

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_MASTER',
        aggregateId: payload.supplierId,
        eventType: 'SUPPLIER_QUALIFICATION_REVIEWED',
        auditAction: 'SUPPLIER_QUALIFICATION_REVIEWED',
        auditResourceType: 'SUPPLIER_MASTER',
        auditResourceId: payload.supplierId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'supplier',
            entityType: 'SUPPLIER_MASTER',
            entityId: payload.supplierId,
            required: true,
          },
        ],
        prepare: (current) => {
          const supplier = current.supplier as unknown as SupplierMaster;
          const now = new Date().toISOString();
          const review: SupplierQualificationReview = {
            reviewId,
            tenantId: context.tenantId,
            supplierId: supplier.supplierId,
            decision: payload.decision,
            riskLevel: payload.riskLevel,
            complianceStatus: payload.complianceStatus,
            notes: payload.notes,
            reviewedAt: payload.reviewedAt,
            reviewedBy: context.actorId,
          };
          const nextSupplier: SupplierMaster = {
            ...supplier,
            status: payload.decision,
            riskLevel: payload.riskLevel,
            scorecard: {
              ...supplier.scorecard,
              complianceStatus: payload.complianceStatus,
            },
            updatedAt: now,
          };

          return {
            domainState: nextSupplier,
            additionalStateWrites: [
              {
                entityType: 'SUPPLIER_QUALIFICATION_REVIEW',
                entityId: reviewId,
                domainState: review,
              },
            ],
            eventPayload: {
              supplierId: supplier.supplierId,
              reviewId,
              decision: payload.decision,
              complianceStatus: payload.complianceStatus,
              riskLevel: payload.riskLevel,
            },
            auditReason: `Reviewed supplier ${supplier.displayName || supplier.legalName}: ${payload.decision}.`,
            resultData: { supplier: nextSupplier, review },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.supplierId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async createRfq(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateRfqPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT',
        'PROCUREMENT_OFFICER',
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'RFQ creation authority required.'
      );
    }

    try {
      const deadlineMs = assertIsoDate(
        payload.submissionDeadline,
        'INVALID_RFQ_DEADLINE'
      );
      const deliveryMs = assertIsoDate(
        payload.requiredDeliveryDate,
        'INVALID_RFQ_DELIVERY_DATE'
      );
      if (payload.invitedSupplierIds.length < 2) {
        throw new AtomicMutationRejectedError(
          'RFQ_MINIMUM_COMPETITION_REQUIRED',
          'Routine RFQ requires at least two invited suppliers.'
        );
      }
      if (new Set(payload.invitedSupplierIds).size !== payload.invitedSupplierIds.length) {
        throw new AtomicMutationRejectedError(
          'RFQ_DUPLICATE_SUPPLIER',
          'RFQ invited supplier list contains duplicates.'
        );
      }
      if (deadlineMs >= deliveryMs) {
        throw new AtomicMutationRejectedError(
          'RFQ_DEADLINE_AFTER_DELIVERY',
          'RFQ submission deadline must precede required delivery date.'
        );
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SCM_RFQ',
        aggregateId: payload.rfqId,
        eventType: 'SCM_RFQ_CREATED',
        auditAction: 'SCM_RFQ_CREATED',
        auditResourceType: 'SCM_RFQ',
        auditResourceId: payload.rfqId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'requisition',
            entityType: 'PURCHASE_REQUISITION',
            entityId: payload.requisitionId,
            required: true,
          },
          ...payload.invitedSupplierIds.map((supplierId, index) => ({
            key: `supplier:${index}`,
            entityType: 'SUPPLIER_MASTER',
            entityId: supplierId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const requisition =
            current.requisition as unknown as PurchaseRequisition;
          assertFacilityScope(context, requisition.facilityId);
          if (requisition.status !== 'APPROVED') {
            throw new AtomicMutationRejectedError(
              'RFQ_REQUISITION_NOT_APPROVED',
              'RFQ may only originate from an approved purchase requisition.'
            );
          }

          payload.invitedSupplierIds.forEach((supplierId, index) => {
            const supplier =
              current[`supplier:${index}`] as unknown as SupplierMaster;
            if (supplier.supplierId !== supplierId) {
              throw new AtomicMutationRejectedError(
                'RFQ_SUPPLIER_IDENTITY_MISMATCH',
                'Invited supplier identity does not match authoritative state.'
              );
            }
            assertSupplierCompliance(supplier);
          });

          const now = new Date().toISOString();
          const rfq: GovernedRfqRecord = {
            rfqId: payload.rfqId,
            tenantId: context.tenantId,
            rfqNumber: payload.rfqNumber,
            requisitionId: requisition.requisitionId,
            facilityId: requisition.facilityId,
            currency: requisition.currency.toUpperCase(),
            items: requisition.items
              .filter((line) => Number(line.approvedQuantity ?? line.requestedQuantity) > 0)
              .map((line) => ({
                itemId: line.itemId,
                itemCode: line.itemCode,
                itemName: line.itemName,
                quantity: Number(line.approvedQuantity ?? line.requestedQuantity),
                uom: line.uom,
                specifications: line.justification || line.itemName,
              })),
            requiredDeliveryDate: payload.requiredDeliveryDate,
            submissionDeadline: payload.submissionDeadline,
            invitedSupplierIds: [...payload.invitedSupplierIds],
            terms: payload.terms,
            status: 'OPEN',
            createdBy: context.actorId,
            createdAt: now,
            updatedAt: now,
          };

          return {
            domainState: rfq,
            eventPayload: {
              rfqId: rfq.rfqId,
              requisitionId: rfq.requisitionId,
              invitedSupplierIds: rfq.invitedSupplierIds,
              lineCount: rfq.items.length,
            },
            auditReason: `Created governed RFQ ${rfq.rfqNumber} from requisition ${requisition.requisitionNumber}.`,
            resultData: rfq,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.rfqId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async recordSupplierQuotation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordSupplierQuotationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT',
        'PROCUREMENT_OFFICER',
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier quotation capture authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_QUOTATION',
        aggregateId: payload.quotationId,
        eventType: 'SUPPLIER_QUOTATION_CAPTURED',
        auditAction: 'SUPPLIER_QUOTATION_CAPTURED',
        auditResourceType: 'SUPPLIER_QUOTATION',
        auditResourceId: payload.quotationId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'rfq',
            entityType: 'SCM_RFQ',
            entityId: payload.rfqId,
            required: true,
          },
          {
            key: 'supplier',
            entityType: 'SUPPLIER_MASTER',
            entityId: payload.supplierId,
            required: true,
          },
        ],
        prepare: (current) => {
          const rfq = current.rfq as unknown as GovernedRfqRecord;
          const supplier = current.supplier as unknown as SupplierMaster;
          assertFacilityScope(context, rfq.facilityId);
          assertSupplierCompliance(supplier);

          if (!['OPEN', 'SUBMISSIONS_RECEIVED'].includes(rfq.status)) {
            throw new AtomicMutationRejectedError(
              'RFQ_NOT_ACCEPTING_QUOTES',
              `RFQ status ${rfq.status} does not accept quotations.`
            );
          }
          if (!rfq.invitedSupplierIds.includes(supplier.supplierId)) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_NOT_INVITED_TO_RFQ',
              'Supplier is not on the RFQ invitation list.'
            );
          }
          if (Date.now() > Date.parse(rfq.submissionDeadline)) {
            throw new AtomicMutationRejectedError(
              'RFQ_SUBMISSION_DEADLINE_PASSED',
              'Quotation capture is closed because the RFQ deadline has passed.'
            );
          }
          if (payload.currency.toUpperCase() !== rfq.currency) {
            throw new AtomicMutationRejectedError(
              'RFQ_QUOTATION_CURRENCY_MISMATCH',
              'Quotation currency must match the RFQ currency.'
            );
          }

          const rfqByItem = new Map(rfq.items.map((line) => [line.itemId, line]));
          const seen = new Set<string>();
          const lines = payload.items.map((line) => {
            if (seen.has(line.itemId)) {
              throw new AtomicMutationRejectedError(
                'DUPLICATE_QUOTATION_ITEM',
                'Quotation cannot contain duplicate item lines.'
              );
            }
            seen.add(line.itemId);
            const rfqLine = rfqByItem.get(line.itemId);
            if (!rfqLine) {
              throw new AtomicMutationRejectedError(
                'QUOTATION_ITEM_NOT_ON_RFQ',
                `Item ${line.itemId} is not on the authoritative RFQ.`
              );
            }
            if (line.uom !== rfqLine.uom) {
              throw new AtomicMutationRejectedError(
                'QUOTATION_UOM_MISMATCH',
                `Quotation UOM for ${line.itemId} differs from RFQ UOM.`
              );
            }
            if (
              !Number.isSafeInteger(line.unitPriceMinorUnits) ||
              line.unitPriceMinorUnits < 0 ||
              !Number.isInteger(line.leadTimeDays) ||
              line.leadTimeDays < 0 ||
              !Number.isInteger(line.expiryMonthsAtDelivery) ||
              line.expiryMonthsAtDelivery < 0
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_QUOTATION_LINE',
                'Quotation price, lead time, and expiry shelf life must be valid.'
              );
            }
            return {
              ...line,
              quantity: rfqLine.quantity,
              lineTotalMinorUnits: Math.round(
                rfqLine.quantity * line.unitPriceMinorUnits
              ),
            };
          });
          if (lines.length !== rfq.items.length) {
            throw new AtomicMutationRejectedError(
              'INCOMPLETE_QUOTATION',
              'Quotation must cover every authoritative RFQ item.'
            );
          }

          const subtotalMinorUnits = lines.reduce(
            (sum, line) => sum + line.lineTotalMinorUnits,
            0
          );
          const taxMinorUnits = roundMoneyMinor(payload.taxMinorUnits || 0);
          const shippingMinorUnits = roundMoneyMinor(
            payload.shippingMinorUnits || 0
          );
          const totalMinorUnits =
            subtotalMinorUnits + taxMinorUnits + shippingMinorUnits;
          if (!Number.isSafeInteger(totalMinorUnits) || totalMinorUnits <= 0) {
            throw new AtomicMutationRejectedError(
              'INVALID_QUOTATION_TOTAL',
              'Quotation total must be a positive safe integer in minor units.'
            );
          }

          const now = new Date().toISOString();
          const quotation: GovernedSupplierQuotation = {
            quotationId: payload.quotationId,
            tenantId: context.tenantId,
            rfqId: rfq.rfqId,
            supplierId: supplier.supplierId,
            supplierName: supplier.displayName || supplier.legalName,
            quotationNumber: payload.quotationNumber,
            currency: rfq.currency,
            paymentTerms: payload.paymentTerms,
            items: lines,
            subtotalMinorUnits,
            taxMinorUnits,
            shippingMinorUnits,
            totalMinorUnits,
            warrantyPeriodMonths: payload.warrantyPeriodMonths,
            capturedAt: now,
            capturedBy: context.actorId,
            status: 'SUBMITTED',
          };
          const nextRfq: GovernedRfqRecord = {
            ...rfq,
            status: 'SUBMISSIONS_RECEIVED',
            updatedAt: now,
          };

          return {
            domainState: quotation,
            additionalStateWrites: [
              {
                entityType: 'SCM_RFQ',
                entityId: rfq.rfqId,
                domainState: nextRfq,
              },
            ],
            eventPayload: {
              quotationId: quotation.quotationId,
              rfqId: quotation.rfqId,
              supplierId: quotation.supplierId,
              totalMinorUnits,
              currency: quotation.currency,
            },
            auditReason: `Captured supplier quotation ${quotation.quotationNumber} for RFQ ${rfq.rfqNumber}.`,
            resultData: quotation,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.quotationId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async awardSupplierContract(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AwardSupplierContractPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier award authority required.'
      );
    }

    try {
      if (
        payload.candidateQuotationIds.length < 2 ||
        new Set(payload.candidateQuotationIds).size !==
          payload.candidateQuotationIds.length ||
        !payload.candidateQuotationIds.includes(payload.selectedQuotationId)
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_CONTRACT_CANDIDATE_SET',
          'Contract award requires at least two unique candidate quotations including the selected quotation.'
        );
      }

      const preflightQuotes = await Promise.all(
        payload.candidateQuotationIds.map((quotationId) =>
          DomainStateRepository.getById<GovernedSupplierQuotation>(
            context.tenantId,
            'scmSupplierQuotations',
            quotationId
          )
        )
      );
      if (preflightQuotes.some((quotation) => !quotation)) {
        throw new AtomicMutationRejectedError(
          'CONTRACT_CANDIDATE_QUOTATION_MISSING',
          'One or more candidate quotations do not exist.'
        );
      }
      const supplierIds = [
        ...new Set(
          preflightQuotes.map(
            (quotation) => (quotation as GovernedSupplierQuotation).supplierId
          )
        ),
      ];

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_CONTRACT',
        aggregateId: payload.contractId,
        eventType: 'SUPPLIER_CONTRACT_AWARDED_PENDING_APPROVAL',
        auditAction: 'SUPPLIER_CONTRACT_AWARDED_PENDING_APPROVAL',
        auditResourceType: 'SUPPLIER_CONTRACT',
        auditResourceId: payload.contractId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'rfq',
            entityType: 'SCM_RFQ',
            entityId: payload.rfqId,
            required: true,
          },
          ...payload.candidateQuotationIds.map((quotationId, index) => ({
            key: `quote:${index}`,
            entityType: 'SUPPLIER_QUOTATION',
            entityId: quotationId,
            required: true,
          })),
          ...supplierIds.map((supplierId, index) => ({
            key: `supplier:${index}`,
            entityType: 'SUPPLIER_MASTER',
            entityId: supplierId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const rfq = current.rfq as unknown as GovernedRfqRecord;
          assertFacilityScope(context, rfq.facilityId);
          if (!['SUBMISSIONS_RECEIVED', 'EVALUATED'].includes(rfq.status)) {
            throw new AtomicMutationRejectedError(
              'RFQ_NOT_AWARDABLE',
              `RFQ status ${rfq.status} cannot be awarded.`
            );
          }

          const quotations = payload.candidateQuotationIds.map(
            (_, index) =>
              current[`quote:${index}`] as unknown as GovernedSupplierQuotation
          );
          if (
            quotations.some(
              (quotation) =>
                quotation.rfqId !== rfq.rfqId ||
                quotation.status !== 'SUBMITTED'
            )
          ) {
            throw new AtomicMutationRejectedError(
              'CONTRACT_QUOTATION_STATE_INVALID',
              'All candidate quotations must be submitted against the same RFQ.'
            );
          }
          const suppliers = supplierIds.map(
            (_, index) =>
              current[`supplier:${index}`] as unknown as SupplierMaster
          );
          suppliers.forEach((supplier) => assertSupplierCompliance(supplier));

          const scores = evaluateSupplierQuotations({ quotations, suppliers });
          const selected = quotations.find(
            (quotation) =>
              quotation.quotationId === payload.selectedQuotationId
          );
          const selectedScore = scores.find(
            (score) => score.quotationId === payload.selectedQuotationId
          );
          if (!selected || !selectedScore) {
            throw new AtomicMutationRejectedError(
              'SELECTED_QUOTATION_NOT_FOUND',
              'Selected quotation is not present in the authoritative candidate set.'
            );
          }

          const effectiveMs = assertIsoDate(
            payload.effectiveAt,
            'INVALID_CONTRACT_EFFECTIVE_DATE'
          );
          const expiresMs = assertIsoDate(
            payload.expiresAt,
            'INVALID_CONTRACT_EXPIRY_DATE'
          );
          if (expiresMs <= effectiveMs) {
            throw new AtomicMutationRejectedError(
              'INVALID_CONTRACT_TERM',
              'Supplier contract expiry must be after its effective date.'
            );
          }
          const selectedOutOfPolicy =
            scores[0]?.quotationId !== selected.quotationId;
          if (
            selectedOutOfPolicy &&
            payload.selectionJustification.trim().length < 20
          ) {
            throw new AtomicMutationRejectedError(
              'NON_TOP_AWARD_JUSTIFICATION_REQUIRED',
              'Selecting a quotation below the deterministic evaluation leader requires a substantive justification.'
            );
          }

          const rfqByItem = new Map(rfq.items.map((line) => [line.itemId, line]));
          const contract: SupplierContract = {
            contractId: payload.contractId,
            tenantId: context.tenantId,
            contractNumber: payload.contractNumber,
            rfqId: rfq.rfqId,
            quotationId: selected.quotationId,
            supplierId: selected.supplierId,
            supplierName: selected.supplierName,
            currency: selected.currency,
            effectiveAt: payload.effectiveAt,
            expiresAt: payload.expiresAt,
            paymentTerms: selected.paymentTerms,
            warrantyPeriodMonths: selected.warrantyPeriodMonths,
            maxSpendMinorUnits: payload.maxSpendMinorUnits,
            committedSpendMinorUnits: 0,
            reservedSpendMinorUnits: 0,
            committedQuantityByItem: {},
            reservedQuantityByItem: {},
            lines: selected.items.map((line) => {
              const rfqLine = rfqByItem.get(line.itemId);
              if (!rfqLine) {
                throw new AtomicMutationRejectedError(
                  'CONTRACT_ITEM_NOT_ON_RFQ',
                  'Selected quotation contains an item missing from the RFQ.'
                );
              }
              return {
                itemId: line.itemId,
                uom: line.uom,
                maxUnitPriceMinorUnits: line.unitPriceMinorUnits,
                contractedQuantity: rfqLine.quantity,
                manufacturer: line.manufacturer,
                brand: line.brand,
                minimumExpiryMonthsAtDelivery:
                  line.expiryMonthsAtDelivery,
              };
            }),
            evaluation: selectedScore,
            selectionJustification: payload.selectionJustification,
            selectedOutOfPolicy,
            status: 'PENDING_APPROVAL',
            awardedBy: context.actorId,
            awardedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const nextRfq: GovernedRfqRecord = {
            ...rfq,
            status: 'EVALUATED',
            updatedAt: new Date().toISOString(),
          };

          return {
            domainState: contract,
            additionalStateWrites: [
              {
                entityType: 'SCM_RFQ',
                entityId: rfq.rfqId,
                domainState: nextRfq,
              },
            ],
            eventPayload: {
              contractId: contract.contractId,
              rfqId: rfq.rfqId,
              selectedQuotationId: selected.quotationId,
              supplierId: selected.supplierId,
              weightedTotal: selectedScore.weightedTotal,
              selectedOutOfPolicy,
            },
            auditReason: `Awarded supplier contract ${contract.contractNumber} pending independent approval.`,
            resultData: { contract, scores },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.contractId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async approveSupplierContract(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveSupplierContractPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'FINANCE_MANAGER',
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier contract approval authority required.'
      );
    }

    try {
      const preflight = await DomainStateRepository.getById<SupplierContract>(
        context.tenantId,
        'scmSupplierContracts',
        payload.contractId
      );
      if (!preflight) {
        throw new AtomicMutationRejectedError(
          'SUPPLIER_CONTRACT_NOT_FOUND',
          'Supplier contract does not exist.'
        );
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_CONTRACT',
        aggregateId: payload.contractId,
        eventType:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_CONTRACT_ACTIVATED'
            : 'SUPPLIER_CONTRACT_REJECTED',
        auditAction:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_CONTRACT_ACTIVATED'
            : 'SUPPLIER_CONTRACT_REJECTED',
        auditResourceType: 'SUPPLIER_CONTRACT',
        auditResourceId: payload.contractId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'contract',
            entityType: 'SUPPLIER_CONTRACT',
            entityId: payload.contractId,
            required: true,
          },
          {
            key: 'supplier',
            entityType: 'SUPPLIER_MASTER',
            entityId: preflight.supplierId,
            required: true,
          },
          {
            key: 'rfq',
            entityType: 'SCM_RFQ',
            entityId: preflight.rfqId,
            required: true,
          },
          {
            key: 'quotation',
            entityType: 'SUPPLIER_QUOTATION',
            entityId: preflight.quotationId,
            required: true,
          },
        ],
        prepare: (current) => {
          const contract = current.contract as unknown as SupplierContract;
          const supplier = current.supplier as unknown as SupplierMaster;
          const rfq = current.rfq as unknown as GovernedRfqRecord;
          const quotation =
            current.quotation as unknown as GovernedSupplierQuotation;
          assertFacilityScope(context, rfq.facilityId);

          if (contract.status !== 'PENDING_APPROVAL') {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_CONTRACT_NOT_PENDING',
              `Contract status ${contract.status} cannot be reviewed.`
            );
          }
          if (contract.awardedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_SEGREGATION_OF_DUTIES',
              'Contract awarder cannot approve the same supplier contract.'
            );
          }

          const now = new Date().toISOString();
          if (payload.decision === 'REJECT') {
            const rejected: SupplierContract = {
              ...contract,
              status: 'TERMINATED',
              rejectedBy: context.actorId,
              rejectedAt: now,
              statusReason: payload.comments,
              updatedAt: now,
            };
            return {
              domainState: rejected,
              eventPayload: {
                contractId: contract.contractId,
                decision: 'REJECT',
                comments: payload.comments,
              },
              auditReason: `Rejected supplier contract ${contract.contractNumber}.`,
              resultData: rejected,
            };
          }

          assertSupplierCompliance(supplier, contract.effectiveAt);
          if (Date.parse(contract.expiresAt) <= Date.parse(contract.effectiveAt)) {
            throw new AtomicMutationRejectedError(
              'INVALID_CONTRACT_TERM',
              'Supplier contract term is invalid.'
            );
          }

          const active: SupplierContract = {
            ...contract,
            status: 'ACTIVE',
            approvedBy: context.actorId,
            approvedAt: now,
            statusReason: payload.comments,
            updatedAt: now,
          };
          const nextSupplier: SupplierMaster = {
            ...supplier,
            activeContractsCount:
              Math.max(0, Number(supplier.activeContractsCount || 0)) + 1,
            updatedAt: now,
          };
          const nextRfq: GovernedRfqRecord = {
            ...rfq,
            status: 'AWARDED',
            awardedContractId: contract.contractId,
            updatedAt: now,
          };
          const acceptedQuote: GovernedSupplierQuotation = {
            ...quotation,
            status: 'ACCEPTED',
          };

          return {
            domainState: active,
            additionalStateWrites: [
              {
                entityType: 'SUPPLIER_MASTER',
                entityId: supplier.supplierId,
                domainState: nextSupplier,
              },
              {
                entityType: 'SCM_RFQ',
                entityId: rfq.rfqId,
                domainState: nextRfq,
              },
              {
                entityType: 'SUPPLIER_QUOTATION',
                entityId: quotation.quotationId,
                domainState: acceptedQuote,
              },
            ],
            eventPayload: {
              contractId: contract.contractId,
              supplierId: supplier.supplierId,
              rfqId: rfq.rfqId,
              decision: 'APPROVE',
            },
            auditReason: `Activated supplier contract ${contract.contractNumber} after independent approval.`,
            resultData: active,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.contractId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async changeSupplierContractStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ChangeSupplierContractStatusPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'FINANCE_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier contract status authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_CONTRACT',
        aggregateId: payload.contractId,
        eventType:
          payload.status === 'SUSPENDED'
            ? 'SUPPLIER_CONTRACT_SUSPENDED'
            : 'SUPPLIER_CONTRACT_TERMINATED',
        auditAction:
          payload.status === 'SUSPENDED'
            ? 'SUPPLIER_CONTRACT_SUSPENDED'
            : 'SUPPLIER_CONTRACT_TERMINATED',
        auditResourceType: 'SUPPLIER_CONTRACT',
        auditResourceId: payload.contractId,
        outboxTopic: 'g-hims-scm-sourcing-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'contract',
            entityType: 'SUPPLIER_CONTRACT',
            entityId: payload.contractId,
            required: true,
          },
        ],
        prepare: (current) => {
          const contract = current.contract as unknown as SupplierContract;
          if (contract.status !== 'ACTIVE') {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_CONTRACT_NOT_ACTIVE',
              'Only an active contract may be suspended or terminated.'
            );
          }
          if (
            Number(contract.reservedSpendMinorUnits || 0) > 0 ||
            Object.values(contract.reservedQuantityByItem || {}).some(
              (quantity) => Number(quantity) > 0
            )
          ) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_CONTRACT_HAS_OPEN_PO_RESERVATIONS',
              'Contract cannot be suspended or terminated while purchase orders are pending approval.'
            );
          }
          const next: SupplierContract = {
            ...contract,
            status: payload.status,
            statusReason: payload.reason,
            updatedAt: new Date().toISOString(),
          };
          return {
            domainState: next,
            eventPayload: {
              contractId: contract.contractId,
              supplierId: contract.supplierId,
              status: payload.status,
              reason: payload.reason,
            },
            auditReason: `${payload.status} supplier contract ${contract.contractNumber}: ${payload.reason}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.contractId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }
}
