/**
 * Server-side OPD workflow runtime boundary.
 *
 * The workflow DAG is infrastructure, not a clinician-facing module. All OPD
 * stage mutations are validated here before EncounterDomainService persists
 * the transition/event/outbox transaction.
 */

import { CompiledGeneralOpdWorkflow, WorkflowCompiler } from '@/lib/clinical/workflow/compiler';
import type { ClinicalStageType } from '@/types/clinical-workflow';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

export interface OpdWorkflowTransitionCheck {
  allowed: boolean;
  code?: string;
  message?: string;
  sourceStage?: ClinicalStageType;
  targetStage?: ClinicalStageType;
}

const OPD_DAG_STAGE_ALIASES: Record<string, ClinicalStageType> = {
  REGISTERED: 'REGISTRATION',
  REGISTRATION: 'REGISTRATION',
  SEARCH_MPI: 'REGISTRATION',
  APPOINTMENTS: 'REGISTRATION',
  BILLING_AUTHORIZATION: 'REGISTRATION',
  QUEUE_ASSIGNMENT: 'REGISTRATION',

  TRIAGE: 'TRIAGE',
  NURSING_INTAKE: 'TRIAGE',
  NURSE_TRIAGE: 'TRIAGE',
  VITALS: 'TRIAGE',

  CONSULTATION: 'CONSULTATION',
  IN_CONSULTATION: 'CONSULTATION',
  MO_ASSESSMENT: 'CONSULTATION',
  SPECIALTY_PRE_CONSULT: 'CONSULTATION',
  SPECIALTY_CONSULTATION: 'CONSULTATION',
  CONSULTANT_REVIEW: 'CONSULTATION',

  DIAGNOSTICS: 'DIAGNOSTICS_LAB_RAD',
  DIAGNOSTIC: 'DIAGNOSTICS_LAB_RAD',
  DIAGNOSTIC_ORDERS: 'DIAGNOSTICS_LAB_RAD',
  DIAGNOSTICS_LAB_RAD: 'DIAGNOSTICS_LAB_RAD',
  LAB: 'DIAGNOSTICS_LAB_RAD',
  LABS: 'DIAGNOSTICS_LAB_RAD',
  IMAGING: 'DIAGNOSTICS_LAB_RAD',
  RADIOLOGY: 'DIAGNOSTICS_LAB_RAD',

  TREATMENT: 'PHARMACY_DISPENSARY',
  PHARMACY: 'PHARMACY_DISPENSARY',
  PHARMACY_FEFO: 'PHARMACY_DISPENSARY',
  PHARMACY_DISPENSARY: 'PHARMACY_DISPENSARY',
  MEDICATION: 'PHARMACY_DISPENSARY',

  BILLING_SETTLEMENT: 'BILLING_SETTLEMENT',

  DISPOSITION: 'DISCHARGE_OR_REFERRAL',
  DISPOSITION_CLOSURE: 'DISCHARGE_OR_REFERRAL',
  DISCHARGE_OR_REFERRAL: 'DISCHARGE_OR_REFERRAL',
  FOLLOW_UP: 'DISCHARGE_OR_REFERRAL',
  COMPLETED: 'DISCHARGE_OR_REFERRAL',
  TIMELINE_AUDIT: 'DISCHARGE_OR_REFERRAL',
};

function normalizeAlias(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export class OpdWorkflowRuntimeService {
  public static resolveStage(value: unknown): ClinicalStageType | null {
    const normalized = normalizeAlias(value);
    if (!normalized) return null;

    if (CompiledGeneralOpdWorkflow.stageNodes[normalized as ClinicalStageType]) {
      return normalized as ClinicalStageType;
    }

    return OPD_DAG_STAGE_ALIASES[normalized] || null;
  }

  /**
   * Validate the OPD DAG edge using server-owned workflow definition.
   *
   * Evidence-sensitive edges fail closed. The evidence itself is written by a
   * governed domain command before this transition is attempted.
   */
  public static validateTransition(input: {
    currentStage: unknown;
    targetStage: unknown;
    evidenceId?: string;
  }): OpdWorkflowTransitionCheck {
    const sourceStage = this.resolveStage(input.currentStage);
    const targetStage = this.resolveStage(input.targetStage);

    if (!sourceStage || !targetStage) {
      return {
        allowed: false,
        code: 'OPD_DAG_STAGE_UNKNOWN',
        message: 'OPD encounter stage does not map to the compiled v1.2 workflow DAG.',
        sourceStage: sourceStage || undefined,
        targetStage: targetStage || undefined,
      };
    }

    if (sourceStage === targetStage) {
      return { allowed: true, sourceStage, targetStage };
    }

    if (
      !WorkflowCompiler.isDirectTransitionAllowed(
        CompiledGeneralOpdWorkflow,
        sourceStage,
        targetStage
      )
    ) {
      return {
        allowed: false,
        code: 'OPD_DAG_TRANSITION_BLOCKED',
        message: `Compiled OPD workflow does not allow ${sourceStage} -> ${targetStage}.`,
        sourceStage,
        targetStage,
      };
    }

    const requiresClinicalEvidence =
      sourceStage === 'TRIAGE' ||
      (sourceStage === 'CONSULTATION' && targetStage !== 'TRIAGE');
    const requiresBillingReconciliation =
      sourceStage === 'BILLING_SETTLEMENT' &&
      targetStage === 'DISCHARGE_OR_REFERRAL';

    if (
      (requiresClinicalEvidence || requiresBillingReconciliation) &&
      !String(input.evidenceId || '').trim()
    ) {
      return {
        allowed: false,
        code: 'OPD_TRANSITION_EVIDENCE_REQUIRED',
        message:
          sourceStage === 'TRIAGE'
            ? 'Triage must produce authoritative clinical evidence before consultation can begin.'
            : requiresBillingReconciliation
              ? 'A cleared authoritative OPD billing reconciliation is required before disposition.'
              : 'A signed consultation evidence record is required before advancing the OPD encounter.',
        sourceStage,
        targetStage,
      };
    }

    return { allowed: true, sourceStage, targetStage };
  }

  /**
   * Evidence-sensitive transitions validate the authoritative evidence record,
   * not a caller-provided identifier. This closes the gap where an incomplete
   * NEWS2 record (or unrelated evidence) could previously unlock progression.
   */
  public static async validateAuthoritativeEvidence(input: {
    tenantId: string;
    encounterId: string;
    patientId: string;
    currentStage: unknown;
    targetStage: unknown;
    evidenceId?: string;
  }): Promise<OpdWorkflowTransitionCheck> {
    const structural = this.validateTransition(input);
    if (!structural.allowed) return structural;

    const sourceStage = structural.sourceStage;
    const targetStage = structural.targetStage;
    const evidenceId = String(input.evidenceId || '').trim();

    const requiresBillingReconciliation =
      sourceStage === 'BILLING_SETTLEMENT' &&
      targetStage === 'DISCHARGE_OR_REFERRAL';
    const requiresEvidence =
      sourceStage === 'TRIAGE' ||
      (sourceStage === 'CONSULTATION' && targetStage !== 'TRIAGE') ||
      requiresBillingReconciliation;

    if (!requiresEvidence) return structural;

    if (requiresBillingReconciliation) {
      const reconciliation =
        await DomainStateRepository.getById<Record<string, unknown>>(
          input.tenantId,
          'opdBillingReconciliations',
          evidenceId
        );
      if (!reconciliation) {
        return {
          allowed: false,
          code: 'OPD_BILLING_RECONCILIATION_NOT_FOUND',
          message:
            'The supplied final billing reconciliation does not exist in authoritative state.',
          sourceStage,
          targetStage,
        };
      }
      if (
        String(reconciliation.encounterId || '') !== input.encounterId ||
        String(reconciliation.patientId || '') !== input.patientId ||
        String(reconciliation.status || '').toUpperCase() !== 'CLEARED'
      ) {
        return {
          allowed: false,
          code: 'OPD_BILLING_RECONCILIATION_INVALID',
          message:
            'Disposition requires a CLEARED billing reconciliation for this exact patient encounter.',
          sourceStage,
          targetStage,
        };
      }
      return structural;
    }

    const evidence = await DomainStateRepository.getById<Record<string, unknown>>(
      input.tenantId,
      'encounterEvidence',
      evidenceId
    );

    if (!evidence) {
      return {
        allowed: false,
        code: 'OPD_AUTHORITATIVE_EVIDENCE_NOT_FOUND',
        message: 'The supplied OPD transition evidence does not exist in authoritative state.',
        sourceStage,
        targetStage,
      };
    }

    if (
      String(evidence.encounterId || '') !== input.encounterId ||
      String(evidence.patientId || '') !== input.patientId
    ) {
      return {
        allowed: false,
        code: 'OPD_EVIDENCE_LINEAGE_MISMATCH',
        message: 'Transition evidence does not belong to this patient encounter.',
        sourceStage,
        targetStage,
      };
    }

    if (String(evidence.status || '').toUpperCase() !== 'FINAL') {
      return {
        allowed: false,
        code: 'OPD_EVIDENCE_NOT_FINAL',
        message: 'Only final authoritative clinical evidence may unlock an OPD transition.',
        sourceStage,
        targetStage,
      };
    }

    if (sourceStage === 'TRIAGE') {
      if (String(evidence.evidenceType || '').toUpperCase() !== 'VITALS') {
        return {
          allowed: false,
          code: 'OPD_TRIAGE_VITALS_EVIDENCE_REQUIRED',
          message: 'TRIAGE to CONSULTATION requires authoritative final vitals evidence.',
          sourceStage,
          targetStage,
        };
      }

      if (
        String(evidence.news2Status || '').toUpperCase() !== 'VERIFIED' ||
        !Number.isFinite(Number(evidence.news2Score))
      ) {
        return {
          allowed: false,
          code: 'NEWS2_INCOMPLETE',
          message:
            'NEWS2 inputs are incomplete or unverified. Consultation cannot begin until NEWS2 is calculated from complete authoritative vitals.',
          sourceStage,
          targetStage,
        };
      }
    }

    if (sourceStage === 'CONSULTATION' && targetStage !== 'TRIAGE') {
      if (
        String(evidence.evidenceType || '').toUpperCase() !== 'SIGNED_CLINICAL_NOTE' ||
        !String(evidence.signedBy || '').trim() ||
        !Number.isFinite(Number(evidence.signedAt))
      ) {
        return {
          allowed: false,
          code: 'SIGNED_CONSULTATION_EVIDENCE_REQUIRED',
          message:
            'Advancing beyond consultation requires a final signed clinical note linked to this encounter.',
          sourceStage,
          targetStage,
        };
      }
    }

    return structural;
  }

}
