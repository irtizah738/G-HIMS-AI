/**
 * G-HIMS Clinical Documentation Domain Service
 * Server-authoritative encounter evidence for vitals and signed clinical notes.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { RevenueIntegrityFinding } from './revenue-integrity-domain-service';
import { AIDraftRepository, type AIDraftRecord } from '@/server/ai/ai-draft-repository';
import { calculateNEWS2 } from '@/lib/clinical/news2';

export interface RecordVitalsPayload {
  encounterId: string;
  patientId: string;
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  spO2Scale?: 1 | 2;
  onSupplementalOxygen?: boolean;
  consciousness?: 'Alert' | 'Voice' | 'Pain' | 'Unresponsive' | 'NewConfusion' | 'A' | 'V' | 'P' | 'U' | 'C';
  gcsScore?: number;
  measuredAt?: number;
}

export interface CompleteMedicationReconciliationPayload {
  encounterId: string;
  patientId: string;
  reconciledMedicationIds: string[];
  discrepancyCount: number;
  unresolvedDiscrepancies?: string[];
  notes?: string;
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
    const systolicBloodPressure = Number(String(payload.bloodPressure || '').split('/')[0]);
    const canCalculateNews2 =
      Number.isFinite(systolicBloodPressure) &&
      (payload.spO2Scale === 1 || payload.spO2Scale === 2) &&
      typeof payload.onSupplementalOxygen === 'boolean' &&
      (!!payload.consciousness || Number.isFinite(payload.gcsScore));

    const news2 = canCalculateNews2
      ? calculateNEWS2({
          respirationRate: payload.respiratoryRate,
          spO2: payload.oxygenSaturation,
          spO2Scale: payload.spO2Scale!,
          onSupplementalOxygen: payload.onSupplementalOxygen!,
          systolicBP: systolicBloodPressure,
          heartRate: payload.heartRate,
          consciousness: payload.consciousness || 'Alert',
          gcsScore: payload.gcsScore,
          temperature: payload.temperature,
        })
      : null;

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
      spO2Scale: payload.spO2Scale,
      onSupplementalOxygen: payload.onSupplementalOxygen,
      consciousness: payload.consciousness,
      gcsScore: payload.gcsScore,
      news2Score: news2?.score,
      news2Risk: news2?.riskLevel,
      news2RedTriggerParameters: news2?.redTriggerParameters,
      news2Status: news2 ? 'VERIFIED' : 'INCOMPLETE_INPUT',
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


  public static async completeMedicationReconciliation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteMedicationReconciliationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['PHARMACIST', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Medication reconciliation authority required.',
        },
      };
    }

    if (
      !payload.encounterId ||
      !payload.patientId ||
      !Array.isArray(payload.reconciledMedicationIds) ||
      !Number.isInteger(payload.discrepancyCount) ||
      payload.discrepancyCount < 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_MEDICATION_RECONCILIATION',
          message: 'Encounter, patient, reconciled medication list and non-negative discrepancy count are required.',
        },
      };
    }

    const unresolved = (payload.unresolvedDiscrepancies || []).filter(Boolean);
    if (unresolved.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_RECONCILIATION_INCOMPLETE',
          message: 'Unresolved medication discrepancies must be resolved before reconciliation can be finalized.',
          details: unresolved,
        },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter || encounter.patientId !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Encounter was not found or belongs to a different patient.',
        },
      };
    }

    const evidenceId = `ev_medrec_${crypto.randomUUID()}`;
    const completedAt = Date.now();
    const domainState = {
      evidenceId,
      evidenceType: 'MEDICATION_RECONCILIATION',
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      reconciledMedicationIds: payload.reconciledMedicationIds,
      discrepancyCount: payload.discrepancyCount,
      unresolvedDiscrepancies: [],
      notes: payload.notes,
      completedBy: context.actorId,
      completedAt,
      createdAt: completedAt,
      status: 'FINAL',
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER_EVIDENCE',
        entityId: evidenceId,
        eventType: 'MEDICATION_RECONCILIATION_COMPLETED',
        domainState,
        eventPayload: {
          evidenceId,
          encounterId: payload.encounterId,
          patientId: payload.patientId,
          discrepancyCount: payload.discrepancyCount,
          reconciledMedicationCount: payload.reconciledMedicationIds.length,
        },
        auditReason: `Completed medication reconciliation for encounter ${payload.encounterId}`,
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

    let sourceDraft: AIDraftRecord | null = null;
    if (payload.sourceDraftId) {
      sourceDraft = await AIDraftRepository.get(context.tenantId, payload.sourceDraftId);
      if (!sourceDraft) {
        return {
          success: false, commandId, idempotencyKey,
          error: { code: 'AI_DRAFT_NOT_FOUND', message: 'Referenced AI draft was not found.' },
        };
      }
      if (sourceDraft.status !== 'DRAFT_REQUIRES_CLINICIAN_REVIEW') {
        return {
          success: false, commandId, idempotencyKey,
          error: { code: 'AI_DRAFT_NOT_REVIEWABLE', message: 'Referenced AI draft is not in reviewable state.' },
        };
      }
      if (sourceDraft.patientId && sourceDraft.patientId !== payload.patientId) {
        return {
          success: false, commandId, idempotencyKey,
          error: { code: 'AI_DRAFT_PATIENT_MISMATCH', message: 'AI draft belongs to a different patient.' },
        };
      }
      if (sourceDraft.encounterId && sourceDraft.encounterId !== payload.encounterId) {
        return {
          success: false, commandId, idempotencyKey,
          error: { code: 'AI_DRAFT_ENCOUNTER_MISMATCH', message: 'AI draft belongs to a different encounter.' },
        };
      }
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
      additionalStateWrites: [
        ...revenueIntegrityFindings.map((finding) => ({
          entityType: 'REVENUE_INTEGRITY_FINDING',
          entityId: finding.id,
          domainState: finding,
        })),
        ...(sourceDraft
          ? [{
              entityType: 'AI_DRAFT',
              entityId: sourceDraft.draftId,
              domainState: AIDraftRepository.buildAcceptedState(sourceDraft, {
                actorId: context.actorId,
                evidenceId,
                signedContent: payload.content,
                acceptedStructuredData: payload.acceptedStructuredData,
                acceptedAt: signedAt,
              }),
            }]
          : []),
      ],
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
