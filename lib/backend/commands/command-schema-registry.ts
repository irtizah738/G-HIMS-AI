import { z } from 'zod';
import type { BaseCommand } from '@/lib/backend/types';

const nonEmpty = z.string().trim().min(1);

const schemas: Record<string, Record<number, z.ZodType<Record<string, unknown>>>> = {
  RecordStockTransactionCommand: {
    1: z.object({
      transactionId: nonEmpty,
      facilityId: nonEmpty,
      itemId: nonEmpty,
      transactionType: z.enum([
        'RECEIPT',
        'ISSUE',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'RETURN',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT',
        'DAMAGE',
        'EXPIRY',
        'QUARANTINE',
        'RELEASE',
        'RESERVATION',
        'UNRESERVATION',
        'CONSUMPTION',
        'DISPENSE',
        'RECALL',
        'WRITE_OFF',
      ]),
      quantity: z.number().finite().positive(),
      uom: nonEmpty,
      itemCode: z.string().optional(),
      itemName: z.string().optional(),
      batchId: z.string().trim().min(1).optional(),
      batchNumber: z.string().optional(),
      fromLocationId: z.string().trim().min(1).optional(),
      fromLocationName: z.string().optional(),
      toLocationId: z.string().trim().min(1).optional(),
      toLocationName: z.string().optional(),
      normalizedQuantity: z.number().finite().positive().optional(),
      unitCost: z.number().finite().nonnegative().optional(),
      totalCost: z.number().finite().nonnegative().optional(),
      currency: z.string().trim().length(3).optional(),
      referenceType: nonEmpty,
      referenceId: nonEmpty,
      patientId: z.string().optional(),
      encounterId: z.string().optional(),
      procedureId: z.string().optional(),
      occurredAt: z.string().optional(),
      source: z.enum(['ONLINE', 'OFFLINE_SYNC', 'SYSTEM']).optional(),
      performedBy: z.record(z.string(), z.unknown()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().superRefine((value, ctx) => {
      if (
        (value.transactionType === 'TRANSFER_OUT' ||
          value.transactionType === 'TRANSFER_IN') &&
        (!value.fromLocationId ||
          !value.toLocationId ||
          value.fromLocationId === value.toLocationId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Stock transfers require distinct source and destination locations.',
          path: ['toLocationId'],
        });
      }
    }),
  },
  RecordPatientConsumptionCommand: {
    1: z.object({
      consumptionId: nonEmpty,
      patientId: nonEmpty,
      encounterId: nonEmpty,
      facilityId: nonEmpty.optional(),
      sourceLocationId: nonEmpty,
      sourceLocationName: z.string().optional(),
      stockTransactionId: z.string().optional(),
      procedureId: z.string().optional(),
      procedureName: z.string().optional(),
      departmentId: nonEmpty,
      departmentName: nonEmpty,
      surgeonOrDoctorName: z.string().optional(),
      itemId: nonEmpty,
      itemCode: z.string().optional(),
      itemName: z.string().optional(),
      itemType: z.string().optional(),
      batchId: nonEmpty,
      batchNumber: z.string().optional(),
      serialNumber: z.string().optional(),
      lotNumber: z.string().optional(),
      udi: z.string().optional(),
      quantity: z.number().finite().positive(),
      uom: nonEmpty,
      consumedAt: z.string().optional(),
      documentedBy: z.string().optional(),
      witnessedBy: z.string().optional(),
      supplierId: z.string().optional(),
      supplierName: z.string().optional(),
      purchaseOrderId: z.string().optional(),
      grnId: z.string().optional(),
      isImplant: z.boolean(),
      implantDetails: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
  },
  SubmitPurchaseRequisitionCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      requisitionNumber: nonEmpty,
      facilityId: nonEmpty,
      requestingDepartment: nonEmpty,
      requestingLocationId: nonEmpty,
      priority: z.enum(['EMERGENCY', 'URGENT', 'NORMAL', 'PLANNED']),
      items: z.array(z.object({
        itemId: nonEmpty,
        itemCode: nonEmpty,
        itemName: nonEmpty,
        requestedQuantity: z.number().finite().positive(),
        uom: nonEmpty,
        currentStock: z.number().finite().nonnegative(),
        reorderPoint: z.number().finite().nonnegative(),
        suggestedQuantity: z.number().finite().nonnegative(),
        estimatedUnitCost: z.number().finite().nonnegative(),
        estimatedTotal: z.number().finite().nonnegative(),
        approvedQuantity: z.number().finite().nonnegative().optional(),
        justification: z.string().optional(),
      }).passthrough()).min(1).max(500),
      justification: nonEmpty,
      requiredByDate: nonEmpty,
      estimatedTotalCost: z.number().finite().nonnegative(),
      currency: z.string().trim().length(3),
      clinicalCriticality: z.enum(['VITAL', 'ESSENTIAL', 'DESIRABLE']),
      status: z.string().optional(),
      requestedBy: z.record(z.string(), z.unknown()).optional(),
      approvalHistory: z.array(z.unknown()).optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    }).passthrough(),
  },
  ApprovePurchaseRequisitionCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      decision: z.enum(['APPROVED', 'REJECTED']),
      comments: z.string().trim().max(1000).optional(),
      approvedLines: z.array(z.object({
        itemId: nonEmpty,
        approvedQuantity: z.number().finite().nonnegative(),
      }).strict()).max(500).optional(),
    }).strict(),
  },
  CreatePurchaseOrderCommand: {
    1: z.object({
      poId: nonEmpty,
      poNumber: nonEmpty,
      requisitionId: nonEmpty,
      supplierId: nonEmpty,
      currency: z.string().trim().length(3),
      paymentTerms: nonEmpty,
      expectedDeliveryDate: nonEmpty,
      destinationLocationId: nonEmpty,
      destinationLocationName: z.string().trim().max(250).optional(),
      items: z.array(z.object({
        lineId: nonEmpty,
        itemId: nonEmpty,
        quantityOrdered: z.number().finite().positive(),
        uom: nonEmpty,
        unitPrice: z.number().finite().nonnegative(),
        discount: z.number().finite().nonnegative().optional(),
        taxPercent: z.number().finite().nonnegative().max(100).optional(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  ApprovePurchaseOrderCommand: {
    1: z.object({
      poId: nonEmpty,
      decision: z.enum(['APPROVED', 'REJECTED']),
      comments: z.string().trim().max(1000).optional(),
    }).strict(),
  },
  RecordGoodsReceiptCommand: {
    1: z.object({
      grnId: nonEmpty,
      grnNumber: nonEmpty,
      purchaseOrderId: nonEmpty,
      facilityId: nonEmpty,
      deliveryNoteNumber: nonEmpty,
      supplierInvoiceReference: z.string().trim().max(200).optional(),
      receivedAt: nonEmpty,
      inspectionStatus: z.enum(['PASSED', 'FAILED', 'PARTIAL', 'QUARANTINED']),
      destinationLocationId: nonEmpty,
      destinationLocationName: z.string().trim().max(250).optional(),
      notes: z.string().trim().max(2000).optional(),
      items: z.array(z.object({
        itemId: nonEmpty,
        batchId: z.string().trim().min(1).optional(),
        batchNumber: z.string().trim().min(1).optional(),
        lotNumber: z.string().trim().min(1).optional(),
        quantityReceived: z.number().finite().positive(),
        quantityAccepted: z.number().finite().nonnegative(),
        quantityRejected: z.number().finite().nonnegative(),
        quantityDamaged: z.number().finite().nonnegative(),
        uom: nonEmpty,
        expiryDate: z.string().trim().min(1).optional(),
        manufactureDate: z.string().trim().min(1).optional(),
        manufacturer: z.string().trim().max(250).optional(),
        recordedTemperatureCelsius: z.number().finite().optional(),
        temperatureExcursion: z.boolean().optional(),
        inspectionPassed: z.boolean(),
        inspectionNotes: z.string().trim().max(1000).optional(),
        unitCost: z.number().finite().nonnegative(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  RecordSupplierInvoiceCommand: {
    1: z.object({
      facilityId: nonEmpty,
      supplierId: nonEmpty,
      invoiceNumber: nonEmpty.max(200),
      poId: nonEmpty,
      grnIds: z.array(nonEmpty).min(1).max(100),
      issueDate: nonEmpty,
      dueDate: nonEmpty,
      currency: z.string().trim().length(3),
      shippingMinorUnits: z.number().int().safe().nonnegative().optional(),
      priceToleranceBasisPoints: z.number().int().min(0).max(500).optional(),
      quantityTolerance: z.number().finite().nonnegative().max(1000000).optional(),
      lines: z.array(z.object({
        lineId: nonEmpty,
        itemId: nonEmpty,
        billedQuantity: z.number().finite().positive(),
        uom: nonEmpty,
        unitPriceMinorUnits: z.number().int().safe().nonnegative(),
        discountMinorUnits: z.number().int().safe().nonnegative().optional(),
        taxMinorUnits: z.number().int().safe().nonnegative().optional(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  ResolveSupplierInvoiceMatchCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      poId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      notes: nonEmpty.max(2000),
    }).strict(),
  },
  RecognizeSupplierInvoicePayableCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      poId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      documentDate: z.number().finite().positive(),
      postingDate: z.number().finite().positive(),
    }).strict(),
  },
  RequestSupplierPaymentAuthorizationCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      reason: nonEmpty.max(1000),
    }).strict(),
  },
  ApproveSupplierPaymentAuthorizationCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      comments: z.string().trim().max(1000).optional(),
    }).strict(),
  },
  RecordSupplierPaymentCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      paymentReference: nonEmpty.max(200),
      paymentMethod: z.enum(['BANK_TRANSFER', 'CHECK', 'ACH', 'CASH']),
      sourceAccountId: nonEmpty.max(100),
      settledAt: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
    }).strict(),
  },
  RecordCashReceiptCommand: {
    1: z.object({
      receiptId: nonEmpty,
      invoiceId: nonEmpty,
      encounterId: nonEmpty,
      patientId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      currency: z.string().trim().length(3).optional(),
      referenceNumber: nonEmpty,
      collectedAt: z.number().finite().positive(),
      cashierName: z.string().trim().max(200).optional(),
    }).strict(),
  },
  PostJournalCommand: {
    1: z.object({
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      documentDate: z.number().finite().positive(),
      postingDate: z.number().finite().positive(),
      referenceDocumentId: z.string().trim().max(200).optional(),
      documentHeader: nonEmpty.max(500),
      currency: z.string().trim().length(3),
      lines: z.array(z.object({
        glAccountId: nonEmpty.max(100),
        glAccountName: nonEmpty.max(250),
        costCenterId: z.string().trim().max(100).optional(),
        profitCenterId: z.string().trim().max(100).optional(),
        debitMinorUnits: z.number().int().safe().nonnegative(),
        creditMinorUnits: z.number().int().safe().nonnegative(),
        lineDescription: nonEmpty.max(500),
      }).strict()).min(2).max(500),
    }).strict(),
  },
  RecordVitalsCommand: {
    1: z.object({
      patientId: nonEmpty,
      encounterId: nonEmpty,
    }).passthrough(),
  },
  PrescribeMedicationCommand: {
    1: z.object({
      patientId: nonEmpty,
      encounterId: nonEmpty,
    }).passthrough(),
  },
  AdvanceStageCommand: {
    1: z.object({
      encounterId: nonEmpty,
    }).passthrough(),
  },
  DischargeInpatientEncounterCommand: {
    1: z.object({
      encounterId: nonEmpty,
      bedId: nonEmpty,
      disposition: nonEmpty,
      followUpInstructions: nonEmpty,
      notes: z.string().optional(),
      dischargeSummaryEvidenceId: z.string().trim().min(1).optional(),
    }).strict(),
  },
};

export interface CommandSchemaValidationResult {
  success: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: 'COMMAND_SCHEMA_VERSION_UNSUPPORTED' | 'COMMAND_PAYLOAD_INVALID';
    message: string;
    details?: unknown;
  };
}

export function validateCommandPayload(
  command: BaseCommand
): CommandSchemaValidationResult {
  const versions = schemas[command.commandType];
  if (!versions) {
    return { success: true, payload: command.payload };
  }

  const schema = versions[command.schemaVersion];
  if (!schema) {
    return {
      success: false,
      error: {
        code: 'COMMAND_SCHEMA_VERSION_UNSUPPORTED',
        message: `Unsupported schemaVersion ${command.schemaVersion} for ${command.commandType}.`,
      },
    };
  }

  const parsed = schema.safeParse(command.payload);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: 'COMMAND_PAYLOAD_INVALID',
        message: `Payload validation failed for ${command.commandType}.`,
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
    };
  }

  return { success: true, payload: parsed.data };
}
