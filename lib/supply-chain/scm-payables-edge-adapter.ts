'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  ApproveSupplierPaymentAuthorizationPayload,
  RecognizeSupplierInvoicePayablePayload,
  RecordSupplierInvoicePayload,
  RecordSupplierPaymentPayload,
  RequestSupplierPaymentAuthorizationPayload,
  ResolveSupplierInvoiceMatchPayload,
  SupplierInvoiceRecord,
  SupplierPaymentAuthorization,
  SupplierPaymentRecord,
} from '@/types/scm-payables';

async function executeFinancialCommand<T>(
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const result = await executeActiveTenantCommand<T>(
    commandType,
    payload,
    {
      idempotencyKey,
      schemaVersion: 1,
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || `${commandType} failed.`);
  }
  return result.data as T;
}

export function recordSupplierInvoiceEdge(
  payload: RecordSupplierInvoicePayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand<{
    invoice: SupplierInvoiceRecord;
    match: unknown;
  }>(
    'RecordSupplierInvoiceCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function resolveSupplierInvoiceMatchEdge(
  payload: ResolveSupplierInvoiceMatchPayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand(
    'ResolveSupplierInvoiceMatchCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function recognizeSupplierInvoicePayableEdge(
  payload: RecognizeSupplierInvoicePayablePayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand(
    'RecognizeSupplierInvoicePayableCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function requestSupplierPaymentAuthorizationEdge(
  payload: RequestSupplierPaymentAuthorizationPayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand<SupplierPaymentAuthorization>(
    'RequestSupplierPaymentAuthorizationCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function approveSupplierPaymentAuthorizationEdge(
  payload: ApproveSupplierPaymentAuthorizationPayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand<SupplierPaymentAuthorization>(
    'ApproveSupplierPaymentAuthorizationCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}

export function recordSupplierPaymentEdge(
  payload: RecordSupplierPaymentPayload,
  idempotencyKey?: string
) {
  return executeFinancialCommand<{
    payment: SupplierPaymentRecord;
    invoice: SupplierInvoiceRecord;
  }>(
    'RecordSupplierPaymentCommand',
    payload as unknown as Record<string, unknown>,
    idempotencyKey
  );
}
