/**
 * Canonical server-authoritative clinical workflow state.
 *
 * UI tabs/steps are deliberately not domain states. OPD/IPD/ED surfaces may
 * expose richer workflow steps, but every persisted encounter must normalize
 * to these independent dimensions.
 */

export type ClinicalEncounterState =
  | 'REGISTERED'
  | 'TRIAGE'
  | 'CONSULTATION'
  | 'DIAGNOSTICS'
  | 'TREATMENT'
  | 'DISPOSITION'
  | 'COMPLETED';

export type EncounterLifecycleStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'DISCHARGED'
  | 'TRANSFERRED'
  | 'CANCELLED';

export type OperationalQueueState =
  | 'NOT_QUEUED'
  | 'QUEUED'
  | 'CALLED'
  | 'IN_SERVICE'
  | 'WAITING_DIAGNOSTICS'
  | 'WAITING_PHARMACY'
  | 'COMPLETED';

export type FinancialClearanceState =
  | 'NOT_REQUIRED'
  | 'CONSULTATION_PAYMENT_PENDING'
  | 'CONSULTATION_CLEARED'
  | 'DIAGNOSTIC_PAYMENT_PENDING'
  | 'DIAGNOSTIC_CLEARED'
  | 'PHARMACY_PAYMENT_PENDING'
  | 'PHARMACY_CLEARED'
  | 'FINAL_SETTLEMENT_PENDING'
  | 'SETTLED';

export type ResourceAssignmentState =
  | 'NONE'
  | 'BED_REQUESTED'
  | 'BED_RESERVED'
  | 'BED_ASSIGNED'
  | 'TRANSFER_PENDING'
  | 'RELEASED';

export interface CanonicalEncounterWorkflowState {
  clinicalState: ClinicalEncounterState;
  operationalState: OperationalQueueState;
  financialClearanceState: FinancialClearanceState;
  resourceAssignmentState: ResourceAssignmentState;
}

const CLINICAL_STAGE_ALIASES: Record<string, ClinicalEncounterState> = {
  REGISTRATION: 'REGISTERED',
  SEARCH_MPI: 'REGISTERED',
  APPOINTMENTS: 'REGISTERED',
  BILLING_AUTHORIZATION: 'REGISTERED',
  QUEUE_ASSIGNMENT: 'REGISTERED',

  TRIAGE: 'TRIAGE',
  NURSING_INTAKE: 'TRIAGE',

  CONSULTATION: 'CONSULTATION',
  MO_ASSESSMENT: 'CONSULTATION',
  SPECIALTY_PRE_CONSULT: 'CONSULTATION',
  SPECIALTY_CONSULTATION: 'CONSULTATION',
  CONSULTANT_REVIEW: 'CONSULTATION',

  DIAGNOSTICS_LAB_RAD: 'DIAGNOSTICS',
  DIAGNOSTICS: 'DIAGNOSTICS',
  DIAGNOSTIC_ORDERS: 'DIAGNOSTICS',
  INVESTIGATIONS: 'DIAGNOSTICS',

  PHARMACY_DISPENSARY: 'TREATMENT',
  PHARMACY_FEFO: 'TREATMENT',
  TREATMENT: 'TREATMENT',
  RESUSCITATION: 'TREATMENT',
  EMERGENCY_TREATMENT: 'TREATMENT',

  BILLING_SETTLEMENT: 'DISPOSITION',
  DISCHARGE_OR_REFERRAL: 'DISPOSITION',
  DISPOSITION: 'DISPOSITION',
  DISPOSITION_REFERRAL: 'DISPOSITION',
  DISPOSITION_CLOSURE: 'DISPOSITION',
  DISCHARGE_SETTLEMENT: 'DISPOSITION',
  FOLLOW_UP: 'DISPOSITION',
  LONGITUDINAL_CARE: 'DISPOSITION',

  TIMELINE_AUDIT: 'COMPLETED',
  COMPLETED: 'COMPLETED',
};

const ALLOWED_CLINICAL_TRANSITIONS: Record<ClinicalEncounterState, ClinicalEncounterState[]> = {
  REGISTERED: ['TRIAGE', 'CONSULTATION', 'DISPOSITION'],
  TRIAGE: ['CONSULTATION', 'DIAGNOSTICS', 'TREATMENT', 'DISPOSITION'],
  CONSULTATION: ['DIAGNOSTICS', 'TREATMENT', 'DISPOSITION'],
  DIAGNOSTICS: ['CONSULTATION', 'TREATMENT', 'DISPOSITION'],
  TREATMENT: ['DIAGNOSTICS', 'DISPOSITION'],
  DISPOSITION: ['COMPLETED'],
  COMPLETED: [],
};

export function normalizeClinicalEncounterState(value: string): ClinicalEncounterState | null {
  const normalized = String(value || '').trim().toUpperCase();
  return CLINICAL_STAGE_ALIASES[normalized] || null;
}

export function isClinicalTransitionAllowed(
  current: ClinicalEncounterState,
  target: ClinicalEncounterState
): boolean {
  if (current === target) return true;
  return ALLOWED_CLINICAL_TRANSITIONS[current]?.includes(target) ?? false;
}

export function initialCanonicalWorkflowState(): CanonicalEncounterWorkflowState {
  return {
    clinicalState: 'REGISTERED',
    operationalState: 'NOT_QUEUED',
    financialClearanceState: 'CONSULTATION_PAYMENT_PENDING',
    resourceAssignmentState: 'NONE',
  };
}
