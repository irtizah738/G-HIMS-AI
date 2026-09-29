/**
 * Server-side OPD workflow runtime boundary.
 *
 * The workflow DAG is infrastructure, not a clinician-facing module. All OPD
 * stage mutations are validated here before EncounterDomainService persists
 * the transition/event/outbox transaction.
 */

import { CompiledGeneralOpdWorkflow, WorkflowCompiler } from '@/lib/clinical/workflow/compiler';
import type { ClinicalStageType } from '@/types/clinical-workflow';

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

    if (requiresClinicalEvidence && !String(input.evidenceId || '').trim()) {
      return {
        allowed: false,
        code: 'OPD_TRANSITION_EVIDENCE_REQUIRED',
        message:
          sourceStage === 'TRIAGE'
            ? 'Triage must produce authoritative clinical evidence before consultation can begin.'
            : 'A signed consultation evidence record is required before advancing the OPD encounter.',
        sourceStage,
        targetStage,
      };
    }

    return { allowed: true, sourceStage, targetStage };
  }
}
