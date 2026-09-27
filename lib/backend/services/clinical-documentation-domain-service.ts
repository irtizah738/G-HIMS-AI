/**
 * G-HIMS Clinical Documentation Domain Service
 * Server-authoritative encounter evidence for vitals and signed clinical notes.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { RevenueIntegrityFinding } from './revenue-integrity-domain-service';

export interface RecordVitalsPayload {
  encounterId: string;
  patientId: string;
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  measuredAt?: number;
}

export interface SignClinicalNotePayload {
  encounterId: string;
  patientId: string;
  category: 'SOAP' | 'PROGRESS' | 'CONSULTATION' | 'DISCHARGE' | 'NURSING';
  content: string;
  sourceDraftId?: string;
  acceptedStructuredData?: Record<string, unknown>;
}

export class ClinicalDocumentationDomainService {
  public static async recordVitals(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordVitalsPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Not authorized to record vitals.',
        },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_NOT_FOUND',
          message: `Encounter ${payload.encounterId} was not found.`,
        },
      };
    }

    const evidenceId = `ev_vitals_${crypto.randomUUID()}`;
    const measuredAt = payload.measuredAt || Date.now();
    const domainState = {
      evidenceId,
      evidenceType: 'VITALS',
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      heartRate: payload.heartRate,
      bloodPressure: payload.bloodPressure,
      temperature: payload.temperature,
      respiratoryRate: payload.respiratoryRate,
      oxygenSaturation: payload.oxygenSaturation,
      measuredAt,
      recordedBy: context.actorId,
      createdAt: Date.now(),
      status: 'FINAL',
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER_EVIDENCE',
        entityId: evidenceId,
        eventType: 'VITALS_RECORDED',
        domainState,
        eventPayload: {
          evidenceId,
          patientId: payload.patientId,
          encounterId: payload.encounterId,
          measuredAt,
        },
        auditReason: `Recorded vitals for encounter ${payload.encounterId}`,
        outboxTopic: 'g-hims-clinical-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: evidenceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }

  public static async signClinicalNote(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: SignClinicalNotePayload
  ): Promise<CommandResult> {
    const auth = payload.category === 'NURSING'
      ? AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
        })
      : AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
          requiredPrivilege: 'SIGN_CLINICAL_NOTES',
        });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Active clinical-note signing privilege required.',
        },
      };
    }

    if (!payload.content || payload.content.trim().length < 3) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CLINICAL_NOTE',
          message: 'Signed clinical note content is required.',
        },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_NOT_FOUND',
          message: `Encounter ${payload.encounterId} was not found.`,
        },
      };
    }

    const evidenceId = `ev_note_${crypto.randomUUID()}`;
    const signedAt = Date.now();
    const domainState = {
      evidenceId,
      evidenceType: 'SIGNED_CLINICAL_NOTE',
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      category: payload.category,
      content: payload.content,
      sourceDraftId: payload.sourceDraftId,
      acceptedStructuredData: payload.acceptedStructuredData,
      signedBy: context.actorId,
      signedAt,
      createdAt: signedAt,
      status: 'FINAL',
    };

    // A signed note may create Revenue Integrity *candidates*, never automatic charges.
    // Only explicitly clinician-accepted structured billing codes are considered.
    const structured = payload.acceptedStructuredData || {};
    const billingCodes = Array.isArray(structured.billingCodes) ? structured.billingCodes : [];
    const revenueIntegrityFindings: RevenueIntegrityFinding[] = billingCodes.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const candidate = raw as Record<string, unknown>;
      const code = String(candidate.code || '').trim();
      const description = String(candidate.description || '').trim();
      const fee = Number(candidate.fee);

      if (!code || !description || !Number.isFinite(fee) || fee <= 0) return [];

      const findingId = `ri_${evidenceId}_${index}`;
      return [{
        id: findingId,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        sourceEvidenceId: evidenceId,
        sourceNoteId: evidenceId,
        documentedItem: description,
        category: 'Procedure' as const,
        suggestedCode: code,
        estimatedRecoverableAmountMinorUnits: Math.round(fee * 100),
        currency: 'USD',
        status: 'PENDING_REVIEW' as const,
        evidenceSnippet: payload.content.slice(0, 240),
        createdAt: signedAt,
        createdBy: context.actorId,
      }];
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER_EVIDENCE',
      aggregateId: evidenceId,
      eventType: 'CLINICAL_NOTE_SIGNED',
      eventPayload: {
        evidenceId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        category: payload.category,
        sourceDraftId: payload.sourceDraftId,
        revenueIntegrityFindingIds: revenueIntegrityFindings.map((finding) => finding.id),
      },
      auditAction: 'SIGN_CLINICAL_NOTE',
      auditResourceType: 'ENCOUNTER_EVIDENCE',
      auditResourceId: evidenceId,
      auditReason: `Signed ${payload.category} note for encounter ${payload.encounterId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: revenueIntegrityFindings.map((finding) => ({
        entityType: 'REVENUE_INTEGRITY_FINDING',
        entityId: finding.id,
        domainState: finding,
      })),
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: evidenceId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        ...domainState,
        revenueIntegrityFindings,
      },
    };
  }
}
