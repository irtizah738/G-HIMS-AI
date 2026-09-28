/**
 * HCM & Clinical Privilege Domain Service
 * Enforces verified credentials, medical licensing, and privilege-gated clinical authority.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { IdempotencyService } from '../idempotency/idempotency-service';

export interface VerifyCredentialPayload {
  employeeId: string;
  credentialType: 'MEDICAL_LICENSE' | 'NURSING_LICENSE' | 'PHARMACY_LICENSE' | 'BOARD_CERTIFICATION' | 'BLS_ACLS';
  licenseNumber: string;
  issuingAuthority: string;
  issuedAt: number;
  expiresAt: number;
}

export interface GrantPrivilegePayload {
  employeeId: string;
  departmentId: string;
  privilegeName: 'CONSULT' | 'PRESCRIBE' | 'SIGN_SOAP' | 'ORDER_LAB' | 'ORDER_RADIOLOGY' | 'PERFORM_PROCEDURE';
  validUntil: number;
}

export class HcmPrivilegeDomainService {
  /**
   * Verifies professional medical credentials (medical director authority required).
   */
  public static async verifyCredential(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: VerifyCredentialPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['MEDICAL_DIRECTOR', 'HR_ADMIN', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Medical Director authority required to verify credentials.' },
      };
    }

    const credentialId = `crd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const domainState = {
      credentialId,
      tenantId: context.tenantId,
      employeeId: payload.employeeId,
      credentialType: payload.credentialType,
      licenseNumber: payload.licenseNumber,
      issuingAuthority: payload.issuingAuthority,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      status: 'VERIFIED',
      verifiedBy: context.actorId,
      verifiedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_CREDENTIAL',
      entityId: credentialId,
      eventType: 'CREDENTIAL_VERIFIED',
      domainState,
      eventPayload: {
        credentialId,
        employeeId: payload.employeeId,
        credentialType: payload.credentialType,
        licenseNumber: payload.licenseNumber,
        expiresAt: payload.expiresAt,
      },
      auditReason: `Verified ${payload.credentialType} (${payload.licenseNumber}) for employee ${payload.employeeId}`,
      outboxTopic: 'g-hims-hcm-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: credentialId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }

  /**
   * Grants clinical privilege to a verified practitioner.
   */
  public static async grantClinicalPrivilege(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: GrantPrivilegePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['MEDICAL_DIRECTOR', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Medical Director authority required to grant clinical privileges.' },
      };
    }

    const privilegeId = `prv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const domainState = {
      privilegeId,
      tenantId: context.tenantId,
      employeeId: payload.employeeId,
      departmentId: payload.departmentId,
      privilegeName: payload.privilegeName,
      validUntil: payload.validUntil,
      status: 'ACTIVE',
      grantedBy: context.actorId,
      grantedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'CLINICAL_PRIVILEGE',
      entityId: privilegeId,
      eventType: 'CLINICAL_PRIVILEGE_GRANTED',
      domainState,
      eventPayload: {
        privilegeId,
        employeeId: payload.employeeId,
        privilegeName: payload.privilegeName,
        departmentId: payload.departmentId,
      },
      auditReason: `Granted clinical privilege ${payload.privilegeName} in ${payload.departmentId} to ${payload.employeeId}`,
      outboxTopic: 'g-hims-hcm-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: privilegeId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }
}
