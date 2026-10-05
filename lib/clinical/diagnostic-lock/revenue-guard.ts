/**
 * Diagnostic Revenue Locking & Execution Guard Engine
 * Enforces revenue gate: Orders are locked from LIS/RIS worklist execution until invoice settlement or pre-authorization
 */

import { DiagnosticOrderItem } from '@/types/clinical-workflow-comprehensive';

export interface DiagnosticLockStatus {
  orderId: string;
  isLocked: boolean;
  lockReason?: string;
  paymentStatus: DiagnosticOrderItem['paymentStatus'];
  worklistStatus: DiagnosticOrderItem['worklistStatus'];
  canExecute: boolean;
}

export class DiagnosticRevenueGuard {
  /**
   * Evaluates if a diagnostic order can be processed by laboratory/radiology technicians
   */
  public static evaluateOrderExecutionGate(order: DiagnosticOrderItem): DiagnosticLockStatus {
    // Orders settled by cash or covered by verified insurance are UNLOCKED
    if (order.paymentStatus === 'PAID_SETTLED' || order.paymentStatus === 'INSURANCE_PREAUTH') {
      return {
        orderId: order.id,
        isLocked: false,
        paymentStatus: order.paymentStatus,
        worklistStatus: 'READY_FOR_COLLECTION',
        canExecute: true,
      };
    }

    // Otherwise order is locked by revenue gate
    return {
      orderId: order.id,
      isLocked: true,
      lockReason: 'Diagnostic Worklist Locked: Pending payment settlement or insurance pre-authorization at cashier counter',
      paymentStatus: order.paymentStatus,
      worklistStatus: 'BLOCKED_BY_REVENUE_GATE',
      canExecute: false,
    };
  }

  /**
   * Legacy callers must not manufacture diagnostic financial clearance in the
   * browser. Only RecordCashReceiptCommand may release the authoritative gate.
   */
  public static unlockOrderAfterPayment(): never {
    throw new Error(
      'SERVER_PAYMENT_AUTHORITY_REQUIRED: diagnostic payment clearance is server-owned.'
    );
  }

}
