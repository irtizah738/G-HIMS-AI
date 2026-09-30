import { z } from 'zod';
import type { BaseCommand } from '@/lib/backend/types';

const nonEmpty = z.string().trim().min(1);

const schemas: Record<string, Record<number, z.ZodType<Record<string, unknown>>>> = {
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
  RecordStockTransactionCommand: {
    1: z.object({
      transactionId: nonEmpty,
      facilityId: nonEmpty,
      itemId: nonEmpty,
      itemCode: nonEmpty,
      itemName: nonEmpty,
      batchId: nonEmpty,
      batchNumber: nonEmpty,
      fromLocationId: z.string().trim().min(1).optional(),
      fromLocationName: z.string().trim().min(1).optional(),
      toLocationId: z.string().trim().min(1).optional(),
      toLocationName: z.string().trim().min(1).optional(),
      quantity: z.number().finite().positive(),
      normalizedQuantity: z.number().finite().positive(),
      uom: nonEmpty,
      unitCost: z.number().finite().nonnegative(),
      totalCost: z.number().finite().nonnegative(),
      currency: z.string().trim().length(3),
      transactionType: nonEmpty,
      referenceType: nonEmpty,
      referenceId: nonEmpty,
      performedBy: z.object({
        userId: z.string().optional(),
        userName: z.string().optional(),
        role: z.string().optional(),
      }).passthrough().optional(),
      occurredAt: nonEmpty,
      recordedAt: z.string().optional(),
      idempotencyKey: z.string().optional(),
      source: z.string().optional(),
      manufactureDate: z.string().optional(),
      expirationDate: z.string().optional(),
      serialId: z.string().optional(),
      patientId: z.string().optional(),
      encounterId: z.string().optional(),
      procedureId: z.string().optional(),
      reasonCode: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
  },
  ReviewPurchaseRequisitionCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      decision: z.enum(['APPROVED', 'REJECTED']),
      comments: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  ConvertPurchaseRequisitionToOrderCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      supplierId: nonEmpty,
      paymentTerms: nonEmpty,
      expectedDeliveryDate: nonEmpty,
      notes: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  ReceivePurchaseOrderCommand: {
    1: z.object({
      purchaseOrderId: nonEmpty,
      deliveryNoteNumber: nonEmpty,
      supplierInvoiceReference: z.string().trim().max(200).optional(),
      items: z.array(z.object({
        itemId: nonEmpty,
        itemCode: nonEmpty,
        itemName: nonEmpty,
        quantityOrdered: z.number().finite().nonnegative(),
        quantityReceived: z.number().finite().nonnegative(),
        quantityAccepted: z.number().finite().nonnegative(),
        quantityRejected: z.number().finite().nonnegative(),
        quantityDamaged: z.number().finite().nonnegative(),
        rejectionReason: z.string().optional(),
        uom: nonEmpty,
        batchNumber: nonEmpty,
        lotNumber: z.string().optional(),
        expiryDate: nonEmpty,
        manufactureDate: nonEmpty,
        manufacturer: nonEmpty,
        serialNumbers: z.array(z.string()).optional(),
        recordedTemperatureCelsius: z.number().finite().optional(),
        temperatureExcursion: z.boolean(),
        inspectionPassed: z.boolean(),
        inspectionNotes: z.string().optional(),
        putawayLocationId: z.string().optional(),
        unitCost: z.number().finite().nonnegative(),
      }).strict()).min(1).max(500),
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
