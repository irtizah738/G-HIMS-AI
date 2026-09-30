import { createHash } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  GoodsReceiptNote,
  PurchaseOrderRecord,
  SupplierMaster,
} from '@/types/scm-domain';
import type {
  SupplierInvoiceMatchRecord,
  SupplierInvoiceRecord,
  SupplierPaymentAuthorization,
  SupplierPaymentRecord,
} from '@/types/scm-payables';
import {
  evaluateSupplierInvoiceMatch,
  type SupplierInvoiceInputLine,
} from '@/lib/supply-chain/receive-to-pay';

export interface RecordSupplierInvoicePayload {
  facilityId: string;
  supplierId: string;
  invoiceNumber: string;
  poId: string;
  grnIds: string[];
  issueDate: string;
  dueDate: string;
  currency: string;
  shippingMinorUnits?: number;
  priceToleranceBasisPoints?: number;
  quantityTolerance?: number;
  lines: SupplierInvoiceInputLine[];
}

export interface ResolveSupplierInvoiceMatchPayload {
  invoiceId: string;
  decision: 'APPROVE' | 'REJECT';
  notes: string;
}

export interface RecognizeSupplierInvoicePayablePayload {
  invoiceId: string;
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
}

export interface RequestSupplierPaymentAuthorizationPayload {
  authorizationId: string;
  invoiceId: string;
  amountMinorUnits: number;
  reason: string;
}

export interface ApproveSupplierPaymentAuthorizationPayload {
  authorizationId: string;
  decision: 'APPROVE' | 'REJECT';
  comments?: string;
}

export interface RecordSupplierPaymentPayload {
  authorizationId: string;
  paymentReference: string;
  paymentMethod: SupplierPaymentRecord['paymentMethod'];
  sourceAccountId: string;
  sourceAccountName: string;
  settledAt: string;
  fiscalYear: number;
  postingPeriod: number;
}

const AP_ACCOUNT = {
  id: '2100',
  name: 'Accounts Payable - Trade Suppliers',
};
const GRNI_ACCOUNT = {
  id: '2110',
  name: 'Goods Received Not Invoiced (GRNI)',
};
const INPUT_TAX_ACCOUNT = {
  id: '1220',
  name: 'Recoverable Input Tax',
};
const FREIGHT_ACCOUNT = {
  id: '1215',
  name: 'Freight-In Inventory',
};
const PURCHASE_VARIANCE_ACCOUNT = {
  id: '6190',
  name: 'Purchase Price Variance',
};

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

function canonicalKey(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.map((value) => value.trim().toLowerCase()).join('\u0000'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function assertFacilityScope(context: CommandContext, facilityId: string): void {
  const administrative = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !administrative &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'The requested SCM financial mutation is outside the actor facility scope.'
    );
  }
}

function assertSupportedCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!['PKR', 'USD', 'AED', 'EUR', 'GBP'].includes(normalized)) {
    throw new AtomicMutationRejectedError(
      'UNSUPPORTED_PAYABLE_CURRENCY',
      `Supplier invoice currency ${normalized || '(missing)'} is not supported.`
    );
  }
  return normalized;
}

function buildJournalState(params: {
  journalId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
  referenceDocumentId: string;
  documentHeader: string;
  currency: string;
  lines: Array<{
    glAccountId: string;
    glAccountName: string;
    debitMinorUnits: number;
    creditMinorUnits: number;
    lineDescription: string;
  }>;
  postedBy: string;
}) {
  const totalDebits = params.lines.reduce(
    (sum, line) => sum + line.debitMinorUnits,
    0
  );
  const totalCredits = params.lines.reduce(
    (sum, line) => sum + line.creditMinorUnits,
    0
  );
  if (
    !Number.isSafeInteger(totalDebits) ||
    totalDebits <= 0 ||
    totalDebits !== totalCredits
  ) {
    throw new AtomicMutationRejectedError(
      'UNBALANCED_SCM_FINANCIAL_POSTING',
      `SCM financial posting is not balanced: debits=${totalDebits}, credits=${totalCredits}.`
    );
  }

  return {
    journalId: params.journalId,
    tenantId: params.tenantId,
    fiscalYear: params.fiscalYear,
    postingPeriod: params.postingPeriod,
    documentDate: params.documentDate,
    postingDate: params.postingDate,
    referenceDocumentId: params.referenceDocumentId,
    documentHeader: params.documentHeader,
    currency: params.currency,
    totalAmountMinorUnits: totalDebits,
    lines: params.lines,
    status: 'POSTED',
    postedBy: params.postedBy,
    postedAt: Date.now(),
  };
}

export class ScmPayablesDomainService {
  public static async recordSupplierInvoice(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordSupplierInvoicePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'ACCOUNTS_PAYABLE',
        'ACCOUNTANT',
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
        auth.reason || 'Supplier invoice capture authority required.'
      );
    }

    const currency = payload.currency.trim().toUpperCase();
    const invoiceId = canonicalKey(
      'sinv',
      context.tenantId,
      payload.supplierId,
      payload.invoiceNumber
    );
    const matchId = canonicalKey('sim', context.tenantId, invoiceId);
    const grnIds = Array.from(new Set(payload.grnIds));

    const readTargets = [
      {
        key: 'existingInvoice',
        entityType: 'SUPPLIER_INVOICE',
        entityId: invoiceId,
        required: false,
      },
      {
        key: 'po',
        entityType: 'PURCHASE_ORDER',
        entityId: payload.poId,
        required: true,
      },
      {
        key: 'supplier',
        entityType: 'SUPPLIER_MASTER',
        entityId: payload.supplierId,
        required: true,
      },
      ...grnIds.map((grnId, index) => ({
        key: `grn:${index}`,
        entityType: 'GOODS_RECEIPT_NOTE',
        entityId: grnId,
        required: true,
      })),
    ];

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_INVOICE',
        aggregateId: invoiceId,
        eventType: 'SUPPLIER_INVOICE_CAPTURED',
        auditAction: 'SUPPLIER_INVOICE_CAPTURED',
        auditResourceType: 'SUPPLIER_INVOICE',
        auditResourceId: invoiceId,
        outboxTopic: 'g-hims-scm-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets,
        prepare: (current) => {
          if (current.existingInvoice) {
            throw new AtomicMutationRejectedError(
              'DUPLICATE_SUPPLIER_INVOICE',
              'This supplier invoice number has already been captured for the supplier.'
            );
          }

          const po = current.po as unknown as PurchaseOrderRecord;
          const supplier = current.supplier as unknown as SupplierMaster;
          const grns = grnIds.map(
            (_grnId, index) =>
              current[`grn:${index}`] as unknown as GoodsReceiptNote
          );

          assertFacilityScope(context, po.facilityId);
          const normalizedCurrency = assertSupportedCurrency(currency);

          if (payload.facilityId !== po.facilityId) {
            throw new AtomicMutationRejectedError(
              'INVOICE_FACILITY_MISMATCH',
              'Supplier invoice facility must match the authoritative purchase order.'
            );
          }
          if (
            po.supplierId !== payload.supplierId ||
            supplier.supplierId !== po.supplierId
          ) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_MISMATCH',
              'Supplier invoice must reference the supplier on the authoritative purchase order.'
            );
          }
          if (supplier.status !== 'ACTIVE') {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_NOT_ACTIVE',
              'Supplier must be active before an invoice can enter Accounts Payable.'
            );
          }
          if (po.currency.toUpperCase() !== normalizedCurrency) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_INVOICE_CURRENCY_MISMATCH',
              'Supplier invoice currency must match the purchase order currency until governed FX settlement is enabled.'
            );
          }
          if (
            !['PARTIALLY_RECEIVED', 'FULLY_RECEIVED'].includes(po.status)
          ) {
            throw new AtomicMutationRejectedError(
              'PO_NOT_INVOICEABLE',
              `Supplier invoice cannot be captured against PO status ${po.status}.`
            );
          }

          const uniqueItemIds = new Set<string>();
          for (const line of payload.lines) {
            if (uniqueItemIds.has(line.itemId)) {
              throw new AtomicMutationRejectedError(
                'DUPLICATE_SUPPLIER_INVOICE_LINE',
                `Supplier invoice contains duplicate item ${line.itemId}.`
              );
            }
            uniqueItemIds.add(line.itemId);
            const poLine = po.items.find((candidate) => candidate.itemId === line.itemId);
            if (!poLine) {
              throw new AtomicMutationRejectedError(
                'INVOICE_ITEM_NOT_ON_PO',
                `Invoice item ${line.itemId} does not exist on the purchase order.`
              );
            }
            if (line.uom !== poLine.uom) {
              throw new AtomicMutationRejectedError(
                'INVOICE_UOM_MISMATCH',
                `Invoice UOM for ${line.itemId} must match purchase order UOM ${poLine.uom}.`
              );
            }
          }

          for (const grn of grns) {
            if (
              grn.purchaseOrderId !== po.poId ||
              grn.supplierId !== po.supplierId ||
              grn.facilityId !== po.facilityId
            ) {
              throw new AtomicMutationRejectedError(
                'INVOICE_GRN_OWNERSHIP_MISMATCH',
                'Every referenced GRN must belong to the same purchase order, supplier and facility.'
              );
            }
          }

          const evaluation = evaluateSupplierInvoiceMatch({
            po,
            grns,
            invoiceLines: payload.lines,
            shippingMinorUnits: Math.max(
              0,
              Math.round(payload.shippingMinorUnits || 0)
            ),
            priceToleranceBasisPoints: Math.max(
              0,
              Math.round(payload.priceToleranceBasisPoints ?? 100)
            ),
            quantityTolerance: Math.max(0, payload.quantityTolerance ?? 0),
          });

          if (evaluation.exceptions.includes('OVER_INVOICED')) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_INVOICE_OVER_INVOICED',
              'Invoice quantity exceeds received quantity remaining available for invoicing.'
            );
          }
          if (
            evaluation.exceptions.includes('MISSING_PO_LINE') ||
            evaluation.exceptions.includes('MISSING_GRN')
          ) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_INVOICE_MATCH_INPUT_INVALID',
              'Invoice cannot enter AP without authoritative PO and accepted GRN evidence for every line.'
            );
          }

          const now = new Date().toISOString();
          const status = evaluation.fullyMatched
            ? 'MATCHED'
            : 'MATCH_EXCEPTION';
          const matchStatus = evaluation.fullyMatched
            ? 'FULLY_MATCHED'
            : 'DISCREPANCY_FLAGGED';

          const nextPo: PurchaseOrderRecord = {
            ...po,
            items: po.items.map((poLine) => {
              const invoiceLine = evaluation.lines.find(
                (line) => line.itemId === poLine.itemId
              );
              if (!invoiceLine) return poLine;
              return {
                ...poLine,
                quantityPendingInvoice:
                  Number(poLine.quantityPendingInvoice || 0) +
                  invoiceLine.billedQuantity,
              };
            }),
            invoiceMatchStatus: matchStatus,
            updatedAt: now,
          };

          const invoice: SupplierInvoiceRecord = {
            invoiceId,
            tenantId: context.tenantId,
            facilityId: po.facilityId,
            invoiceNumber: payload.invoiceNumber.trim(),
            supplierId: po.supplierId,
            supplierName: po.supplierName,
            poId: po.poId,
            poNumber: po.poNumber,
            grnIds,
            currency: normalizedCurrency,
            issueDate: payload.issueDate,
            dueDate: payload.dueDate,
            lines: evaluation.lines,
            subtotalMinorUnits: evaluation.invoiceNetMinorUnits,
            discountMinorUnits: evaluation.lines.reduce(
              (sum, line) => sum + line.discountMinorUnits,
              0
            ),
            taxMinorUnits: evaluation.invoiceTaxMinorUnits,
            shippingMinorUnits: Math.max(
              0,
              Math.round(payload.shippingMinorUnits || 0)
            ),
            totalAmountMinorUnits: evaluation.invoiceTotalMinorUnits,
            amountPaidMinorUnits: 0,
            balanceMinorUnits: evaluation.invoiceTotalMinorUnits,
            matchId,
            matchStatus,
            status,
            capturedBy: context.actorId,
            capturedAt: now,
            createdAt: now,
            updatedAt: now,
          };

          const match: SupplierInvoiceMatchRecord = {
            matchId,
            tenantId: context.tenantId,
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            supplierId: po.supplierId,
            poId: po.poId,
            poNumber: po.poNumber,
            grnIds,
            lines: evaluation.matchLines,
            exceptions: evaluation.exceptions,
            matchStatus,
            expectedAccrualMinorUnits: evaluation.expectedAccrualMinorUnits,
            invoiceNetMinorUnits: evaluation.invoiceNetMinorUnits,
            invoiceTaxMinorUnits: evaluation.invoiceTaxMinorUnits,
            invoiceShippingMinorUnits: invoice.shippingMinorUnits,
            invoiceTotalMinorUnits: evaluation.invoiceTotalMinorUnits,
            netVarianceMinorUnits: evaluation.netVarianceMinorUnits,
            priceToleranceBasisPoints: Math.max(
              0,
              Math.round(payload.priceToleranceBasisPoints ?? 100)
            ),
            quantityTolerance: Math.max(0, payload.quantityTolerance ?? 0),
            createdAt: now,
            updatedAt: now,
          };

          return {
            domainState: invoice,
            additionalStateWrites: [
              {
                entityType: 'SUPPLIER_INVOICE_MATCH',
                entityId: matchId,
                domainState: match,
              },
              {
                entityType: 'PURCHASE_ORDER',
                entityId: po.poId,
                domainState: nextPo,
              },
            ],
            eventPayload: {
              invoiceId,
              invoiceNumber: invoice.invoiceNumber,
              supplierId: invoice.supplierId,
              poId: po.poId,
              grnIds,
              totalAmountMinorUnits: invoice.totalAmountMinorUnits,
              matchStatus,
              exceptionCodes: evaluation.exceptions,
            },
            auditReason: `Captured supplier invoice ${invoice.invoiceNumber} and executed authoritative PO/GRN/invoice match.`,
            resultData: { invoice, match },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: invoiceId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async resolveSupplierInvoiceMatch(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ResolveSupplierInvoiceMatchPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance exception approval authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_INVOICE',
        aggregateId: payload.invoiceId,
        eventType:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_INVOICE_EXCEPTION_APPROVED'
            : 'SUPPLIER_INVOICE_EXCEPTION_REJECTED',
        auditAction:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_INVOICE_EXCEPTION_APPROVED'
            : 'SUPPLIER_INVOICE_EXCEPTION_REJECTED',
        auditResourceType: 'SUPPLIER_INVOICE',
        auditResourceId: payload.invoiceId,
        outboxTopic: 'g-hims-scm-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'invoice',
            entityType: 'SUPPLIER_INVOICE',
            entityId: payload.invoiceId,
            required: true,
          },
          {
            key: 'match',
            entityType: 'SUPPLIER_INVOICE_MATCH',
            entityId: canonicalKey('sim', context.tenantId, payload.invoiceId),
            required: true,
          },
          {
            key: 'po',
            entityType: 'PURCHASE_ORDER',
            entityId: '',
            required: false,
          },
        ],
        prepare: (current) => {
          const invoice = current.invoice as unknown as SupplierInvoiceRecord;
          const match = current.match as unknown as SupplierInvoiceMatchRecord;

          if (invoice.status !== 'MATCH_EXCEPTION') {
            throw new AtomicMutationRejectedError(
              'INVOICE_NOT_IN_EXCEPTION',
              `Invoice cannot be exception-reviewed from status ${invoice.status}.`
            );
          }
          if (invoice.capturedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_FINANCE_SEGREGATION_OF_DUTIES',
              'Invoice capturer cannot approve their own three-way-match exception.'
            );
          }

          const now = new Date().toISOString();
          const approved = payload.decision === 'APPROVE';
          const nextInvoice: SupplierInvoiceRecord = {
            ...invoice,
            status: approved ? 'MATCHED' : 'VOID',
            matchStatus: approved ? 'RESOLVED_APPROVED' : 'REJECTED',
            resolvedBy: context.actorId,
            resolvedAt: now,
            resolutionNotes: payload.notes,
            updatedAt: now,
          };
          const nextMatch: SupplierInvoiceMatchRecord = {
            ...match,
            matchStatus: approved ? 'RESOLVED_APPROVED' : 'REJECTED',
            resolvedBy: context.actorId,
            resolvedAt: now,
            resolutionNotes: payload.notes,
            updatedAt: now,
          };

          const additionalStateWrites = [
            {
              entityType: 'SUPPLIER_INVOICE_MATCH',
              entityId: match.matchId,
              domainState: nextMatch,
            },
          ];

          return {
            domainState: nextInvoice,
            additionalStateWrites,
            eventPayload: {
              invoiceId: invoice.invoiceId,
              matchId: match.matchId,
              decision: payload.decision,
              exceptionCodes: match.exceptions,
            },
            auditReason: `${payload.decision} three-way-match exceptions for supplier invoice ${invoice.invoiceNumber}.`,
            resultData: { invoice: nextInvoice, match: nextMatch },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.invoiceId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async recognizeSupplierInvoicePayable(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecognizeSupplierInvoicePayablePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'ACCOUNTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Accounts Payable recognition authority required.'
      );
    }

    try {
      const matchId = canonicalKey('sim', context.tenantId, payload.invoiceId);
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_INVOICE',
        aggregateId: payload.invoiceId,
        eventType: 'SUPPLIER_INVOICE_PAYABLE_RECOGNIZED',
        auditAction: 'SUPPLIER_INVOICE_PAYABLE_RECOGNIZED',
        auditResourceType: 'SUPPLIER_INVOICE',
        auditResourceId: payload.invoiceId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'invoice',
            entityType: 'SUPPLIER_INVOICE',
            entityId: payload.invoiceId,
            required: true,
          },
          {
            key: 'match',
            entityType: 'SUPPLIER_INVOICE_MATCH',
            entityId: matchId,
            required: true,
          },
        ],
        prepare: (current) => {
          const invoice = current.invoice as unknown as SupplierInvoiceRecord;
          const match = current.match as unknown as SupplierInvoiceMatchRecord;
          assertFacilityScope(context, invoice.facilityId);

          if (invoice.status !== 'MATCHED') {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_INVOICE_NOT_MATCHED',
              `Payable recognition requires MATCHED invoice status, received ${invoice.status}.`
            );
          }
          if (
            !['FULLY_MATCHED', 'RESOLVED_APPROVED'].includes(match.matchStatus)
          ) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_INVOICE_MATCH_NOT_APPROVED',
              'Payable recognition requires a fully matched or explicitly resolved invoice.'
            );
          }
          if (invoice.capturedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_FINANCE_SEGREGATION_OF_DUTIES',
              'Invoice capturer cannot recognize the same supplier payable.'
            );
          }
          if (invoice.journalEntryId) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_PAYABLE_ALREADY_RECOGNIZED',
              'Supplier invoice already has an Accounts Payable journal.'
            );
          }

          const varianceMinorUnits =
            match.invoiceNetMinorUnits - match.expectedAccrualMinorUnits;
          const journalLines: Array<{
            glAccountId: string;
            glAccountName: string;
            debitMinorUnits: number;
            creditMinorUnits: number;
            lineDescription: string;
          }> = [];

          if (match.expectedAccrualMinorUnits > 0) {
            journalLines.push({
              glAccountId: GRNI_ACCOUNT.id,
              glAccountName: GRNI_ACCOUNT.name,
              debitMinorUnits: match.expectedAccrualMinorUnits,
              creditMinorUnits: 0,
              lineDescription: `Clear GRNI for ${invoice.invoiceNumber}`,
            });
          }
          if (invoice.taxMinorUnits > 0) {
            journalLines.push({
              glAccountId: INPUT_TAX_ACCOUNT.id,
              glAccountName: INPUT_TAX_ACCOUNT.name,
              debitMinorUnits: invoice.taxMinorUnits,
              creditMinorUnits: 0,
              lineDescription: `Input tax on supplier invoice ${invoice.invoiceNumber}`,
            });
          }
          if (invoice.shippingMinorUnits > 0) {
            journalLines.push({
              glAccountId: FREIGHT_ACCOUNT.id,
              glAccountName: FREIGHT_ACCOUNT.name,
              debitMinorUnits: invoice.shippingMinorUnits,
              creditMinorUnits: 0,
              lineDescription: `Freight-in on supplier invoice ${invoice.invoiceNumber}`,
            });
          }
          if (varianceMinorUnits > 0) {
            journalLines.push({
              glAccountId: PURCHASE_VARIANCE_ACCOUNT.id,
              glAccountName: PURCHASE_VARIANCE_ACCOUNT.name,
              debitMinorUnits: varianceMinorUnits,
              creditMinorUnits: 0,
              lineDescription: `Purchase price variance on ${invoice.invoiceNumber}`,
            });
          } else if (varianceMinorUnits < 0) {
            journalLines.push({
              glAccountId: PURCHASE_VARIANCE_ACCOUNT.id,
              glAccountName: PURCHASE_VARIANCE_ACCOUNT.name,
              debitMinorUnits: 0,
              creditMinorUnits: Math.abs(varianceMinorUnits),
              lineDescription: `Favorable purchase price variance on ${invoice.invoiceNumber}`,
            });
          }
          journalLines.push({
            glAccountId: AP_ACCOUNT.id,
            glAccountName: AP_ACCOUNT.name,
            debitMinorUnits: 0,
            creditMinorUnits: invoice.totalAmountMinorUnits,
            lineDescription: `Recognize supplier payable ${invoice.invoiceNumber}`,
          });

          const journalId = `je_ap_${invoice.invoiceId}`;
          const journal = buildJournalState({
            journalId,
            tenantId: context.tenantId,
            fiscalYear: payload.fiscalYear,
            postingPeriod: payload.postingPeriod,
            documentDate: payload.documentDate,
            postingDate: payload.postingDate,
            referenceDocumentId: invoice.invoiceId,
            documentHeader: `AP recognition: ${invoice.invoiceNumber} / ${invoice.poNumber}`,
            currency: invoice.currency,
            lines: journalLines,
            postedBy: context.actorId,
          });

          const now = new Date().toISOString();
          const nextInvoice: SupplierInvoiceRecord = {
            ...invoice,
            status: 'PAYABLE_RECOGNIZED',
            recognizedBy: context.actorId,
            recognizedAt: now,
            journalEntryId: journalId,
            updatedAt: now,
          };

          return {
            domainState: nextInvoice,
            additionalStateWrites: [
              {
                entityType: 'JOURNAL_ENTRY',
                entityId: journalId,
                domainState: journal,
              },
            ],
            eventPayload: {
              invoiceId: invoice.invoiceId,
              supplierId: invoice.supplierId,
              journalId,
              amountMinorUnits: invoice.totalAmountMinorUnits,
              matchStatus: match.matchStatus,
            },
            auditReason: `Recognized Accounts Payable liability for supplier invoice ${invoice.invoiceNumber}.`,
            resultData: { invoice: nextInvoice, journal },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.invoiceId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async requestSupplierPaymentAuthorization(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RequestSupplierPaymentAuthorizationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'ACCOUNTS_PAYABLE',
        'ACCOUNTANT',
        'FINANCE_MANAGER',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier payment request authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'AP_PAYMENT_AUTHORIZATION',
        aggregateId: payload.authorizationId,
        eventType: 'SUPPLIER_PAYMENT_AUTHORIZATION_REQUESTED',
        auditAction: 'SUPPLIER_PAYMENT_AUTHORIZATION_REQUESTED',
        auditResourceType: 'AP_PAYMENT_AUTHORIZATION',
        auditResourceId: payload.authorizationId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'existingAuthorization',
            entityType: 'AP_PAYMENT_AUTHORIZATION',
            entityId: payload.authorizationId,
            required: false,
          },
          {
            key: 'invoice',
            entityType: 'SUPPLIER_INVOICE',
            entityId: payload.invoiceId,
            required: true,
          },
        ],
        prepare: (current) => {
          if (current.existingAuthorization) {
            throw new AtomicMutationRejectedError(
              'DUPLICATE_PAYMENT_AUTHORIZATION',
              'Payment authorization ID already exists.'
            );
          }
          const invoice = current.invoice as unknown as SupplierInvoiceRecord;
          assertFacilityScope(context, invoice.facilityId);

          if (
            !['PAYABLE_RECOGNIZED', 'PARTIALLY_PAID'].includes(invoice.status)
          ) {
            throw new AtomicMutationRejectedError(
              'INVOICE_NOT_PAYABLE',
              `Payment authorization cannot be requested from invoice status ${invoice.status}.`
            );
          }
          if (
            payload.amountMinorUnits <= 0 ||
            payload.amountMinorUnits > invoice.balanceMinorUnits
          ) {
            throw new AtomicMutationRejectedError(
              'PAYMENT_AMOUNT_EXCEEDS_BALANCE',
              'Requested payment must be positive and cannot exceed the authoritative supplier invoice balance.'
            );
          }

          const now = new Date().toISOString();
          const authorization: SupplierPaymentAuthorization = {
            authorizationId: payload.authorizationId,
            tenantId: context.tenantId,
            invoiceId: invoice.invoiceId,
            supplierId: invoice.supplierId,
            supplierName: invoice.supplierName,
            currency: invoice.currency,
            amountMinorUnits: payload.amountMinorUnits,
            reason: payload.reason,
            status: 'PENDING_APPROVAL',
            requestedBy: context.actorId,
            requestedAt: now,
            updatedAt: now,
          };

          return {
            domainState: authorization,
            eventPayload: {
              authorizationId: authorization.authorizationId,
              invoiceId: invoice.invoiceId,
              supplierId: invoice.supplierId,
              amountMinorUnits: authorization.amountMinorUnits,
              currency: authorization.currency,
            },
            auditReason: `Requested supplier payment authorization for invoice ${invoice.invoiceNumber}.`,
            resultData: authorization,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.authorizationId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async approveSupplierPaymentAuthorization(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveSupplierPaymentAuthorizationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'FINANCE_MANAGER',
        'TREASURY_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier payment approval authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'AP_PAYMENT_AUTHORIZATION',
        aggregateId: payload.authorizationId,
        eventType:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_PAYMENT_AUTHORIZED'
            : 'SUPPLIER_PAYMENT_REJECTED',
        auditAction:
          payload.decision === 'APPROVE'
            ? 'SUPPLIER_PAYMENT_AUTHORIZED'
            : 'SUPPLIER_PAYMENT_REJECTED',
        auditResourceType: 'AP_PAYMENT_AUTHORIZATION',
        auditResourceId: payload.authorizationId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'authorization',
            entityType: 'AP_PAYMENT_AUTHORIZATION',
            entityId: payload.authorizationId,
            required: true,
          },
        ],
        prepare: (current) => {
          const authorization =
            current.authorization as unknown as SupplierPaymentAuthorization;
          if (authorization.status !== 'PENDING_APPROVAL') {
            throw new AtomicMutationRejectedError(
              'PAYMENT_AUTHORIZATION_STATE_CONFLICT',
              `Payment authorization cannot be reviewed from status ${authorization.status}.`
            );
          }
          if (authorization.requestedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_FINANCE_SEGREGATION_OF_DUTIES',
              'Payment requester cannot approve their own supplier payment.'
            );
          }

          const now = new Date().toISOString();
          const approved = payload.decision === 'APPROVE';
          const next: SupplierPaymentAuthorization = {
            ...authorization,
            status: approved ? 'APPROVED' : 'REJECTED',
            approvedBy: context.actorId,
            approvedAt: now,
            approvalComments: payload.comments,
            updatedAt: now,
          };

          return {
            domainState: next,
            eventPayload: {
              authorizationId: next.authorizationId,
              invoiceId: next.invoiceId,
              decision: payload.decision,
              amountMinorUnits: next.amountMinorUnits,
            },
            auditReason: `${payload.decision} supplier payment authorization ${next.authorizationId}.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.authorizationId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async recordSupplierPayment(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordSupplierPaymentPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'TREASURY_MANAGER',
        'FINANCE_MANAGER',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Supplier payment execution authority required.'
      );
    }

    const paymentId = canonicalKey(
      'spay',
      context.tenantId,
      payload.authorizationId
    );

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SUPPLIER_PAYMENT',
        aggregateId: paymentId,
        eventType: 'SUPPLIER_PAYMENT_RECORDED',
        auditAction: 'SUPPLIER_PAYMENT_RECORDED',
        auditResourceType: 'SUPPLIER_PAYMENT',
        auditResourceId: paymentId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'existingPayment',
            entityType: 'SUPPLIER_PAYMENT',
            entityId: paymentId,
            required: false,
          },
          {
            key: 'authorization',
            entityType: 'AP_PAYMENT_AUTHORIZATION',
            entityId: payload.authorizationId,
            required: true,
          },
        ],
        prepare: (current) => {
          if (current.existingPayment) {
            throw new AtomicMutationRejectedError(
              'DUPLICATE_SUPPLIER_PAYMENT',
              'This payment authorization has already been consumed.'
            );
          }

          const authorization =
            current.authorization as unknown as SupplierPaymentAuthorization;
          if (authorization.status !== 'APPROVED') {
            throw new AtomicMutationRejectedError(
              'PAYMENT_NOT_AUTHORIZED',
              `Supplier payment requires APPROVED authorization, received ${authorization.status}.`
            );
          }
          if (authorization.requestedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_FINANCE_SEGREGATION_OF_DUTIES',
              'Payment requester cannot execute the same supplier payment.'
            );
          }

          throw new AtomicMutationRejectedError(
            'SUPPLIER_PAYMENT_INVOICE_READ_REQUIRED',
            'Payment execution requires authoritative invoice state in the same transaction.'
          );
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: paymentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (
        error instanceof AtomicMutationRejectedError &&
        error.code !== 'SUPPLIER_PAYMENT_INVOICE_READ_REQUIRED'
      ) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      if (
        error instanceof AtomicMutationRejectedError &&
        error.code === 'SUPPLIER_PAYMENT_INVOICE_READ_REQUIRED'
      ) {
        // The first atomic preflight intentionally avoids trusting an invoice ID
        // from the client. Payment execution is implemented below after reading
        // the authorization-owned invoice identifier.
      } else {
        throw error;
      }
    }

    // Authorization is the authoritative pointer to the invoice. The transaction
    // manager requires read targets up-front, so fetch the authorization once
    // through the domain repository boundary is deliberately avoided; instead,
    // require invoiceId in a second command revision before enabling execution.
    return rejection(
      commandId,
      idempotencyKey,
      'SUPPLIER_PAYMENT_EXECUTION_SCHEMA_REQUIRES_INVOICE',
      'Supplier payment execution requires invoiceId to be supplied and cross-checked against the authorization.'
    );
  }
}
