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

export const CANONICAL_CLINICAL_STATES: readonly ClinicalEncounterState[] = [
  'REGISTERED',
  'TRIAGE',
  'CONSULTATION',
  'DIAGNOSTICS',
  'TREATMENT',
  'DISPOSITION',
  'COMPLETED',
] as const;

export interface CanonicalEncounterWorkflowState {
  clinicalState: ClinicalEncounterState;
  operationalState: OperationalQueueState;
  financialClearanceState: FinancialClearanceState;
  resourceAssignmentState: ResourceAssignmentState;
}

const CLINICAL_STAGE_ALIASES: Record<string, ClinicalEncounterState> = {
  // Canonical identity
  REGISTERED: 'REGISTERED',
  TRIAGE: 'TRIAGE',
  CONSULTATION: 'CONSULTATION',
  DIAGNOSTICS: 'DIAGNOSTICS',
  TREATMENT: 'TREATMENT',
  DISPOSITION: 'DISPOSITION',
  COMPLETED: 'COMPLETED',

  // Registration & Intake
  REGISTRATION: 'REGISTERED',
  REGISTER: 'REGISTERED',
  SEARCH_MPI: 'REGISTERED',
  APPOINTMENTS: 'REGISTERED',
  APPOINTMENT: 'REGISTERED',
  BILLING_AUTHORIZATION: 'REGISTERED',
  QUEUE_ASSIGNMENT: 'REGISTERED',
  ARRIVAL: 'REGISTERED',
  ADMISSION: 'REGISTERED',
  BED_ALLOCATION: 'REGISTERED',
  CHECK_IN: 'REGISTERED',
  WALK_IN: 'REGISTERED',

  // Triage & Nursing intake
  NURSING_INTAKE: 'TRIAGE',
  NURSE_TRIAGE: 'TRIAGE',
  NURSING: 'TRIAGE',
  ACUITY: 'TRIAGE',
  VITALS: 'TRIAGE',
  PRE_OP: 'TRIAGE',
  INITIAL_ASSESSMENT: 'TRIAGE',
  EMERGENCY_TRIAGE: 'TRIAGE',

  // Consultation & Doctor assessment
  IN_CONSULTATION: 'CONSULTATION',
  MO_ASSESSMENT: 'CONSULTATION',
  SPECIALTY_PRE_CONSULT: 'CONSULTATION',
  SPECIALTY_CONSULTATION: 'CONSULTATION',
  CONSULTANT_REVIEW: 'CONSULTATION',
  PHYSICIAN_ORDERS: 'CONSULTATION',
  DAILY_PROGRESS: 'CONSULTATION',
  CONSULTATIONS: 'CONSULTATION',
  SBAR: 'CONSULTATION',
  REASSESSMENT: 'CONSULTATION',
  ROUNDS: 'CONSULTATION',

  // Diagnostics, Labs & Imaging
  DIAGNOSTICS_LAB_RAD: 'DIAGNOSTICS',
  DIAGNOSTIC: 'DIAGNOSTICS',
  DIAGNOSTIC_ORDERS: 'DIAGNOSTICS',
  INVESTIGATIONS: 'DIAGNOSTICS',
  ORDERS: 'DIAGNOSTICS',
  LABS: 'DIAGNOSTICS',
  LAB: 'DIAGNOSTICS',
  LABORATORY: 'DIAGNOSTICS',
  IMAGING: 'DIAGNOSTICS',
  RADIOLOGY: 'DIAGNOSTICS',
  PATHOLOGY: 'DIAGNOSTICS',

  // Treatment, Medication, Procedures & PACU
  PHARMACY_DISPENSARY: 'TREATMENT',
  PHARMACY_FEFO: 'TREATMENT',
  PHARMACY: 'TREATMENT',
  MEDICATION: 'TREATMENT',
  RESUSCITATION: 'TREATMENT',
  EMERGENCY_TREATMENT: 'TREATMENT',
  PROCEDURE: 'TREATMENT',
  PROCEDURES: 'TREATMENT',
  PACU_RESERVATION: 'TREATMENT',
  PACU_HANDOFF: 'TREATMENT',
  RECOVERY: 'TREATMENT',
  BED_TRANSFER: 'TREATMENT',
  INTERVENTION: 'TREATMENT',
  SURGERY: 'TREATMENT',
  OPERATION: 'TREATMENT',

  // Disposition, Discharge & Settlement
  BILLING_SETTLEMENT: 'DISPOSITION',
  DISCHARGE_OR_REFERRAL: 'DISPOSITION',
  DISPOSITION_REFERRAL: 'DISPOSITION',
  DISPOSITION_CLOSURE: 'DISPOSITION',
  DISCHARGE_SETTLEMENT: 'DISPOSITION',
  DISCHARGE_PLANNING: 'DISPOSITION',
  MEDICATION_RECONCILIATION: 'DISPOSITION',
  FINANCIAL_RECONCILIATION: 'DISPOSITION',
  FOLLOW_UP: 'DISPOSITION',
  LONGITUDINAL_CARE: 'DISPOSITION',
  DISCHARGE: 'DISPOSITION',
  DISCHARGED: 'DISPOSITION',
  TRANSFERRED: 'DISPOSITION',
  TURNAROUND: 'DISPOSITION',

  // Completed & Audit
  TIMELINE_AUDIT: 'COMPLETED',
  CLOSED: 'COMPLETED',
  FINALIZED: 'COMPLETED',
};

const ALLOWED_CLINICAL_TRANSITIONS: Record<ClinicalEncounterState, ClinicalEncounterState[]> = {
  REGISTERED: ['TRIAGE', 'CONSULTATION', 'DIAGNOSTICS', 'TREATMENT', 'DISPOSITION'],
  TRIAGE: ['CONSULTATION', 'DIAGNOSTICS', 'TREATMENT', 'DISPOSITION'],
  CONSULTATION: ['TRIAGE', 'DIAGNOSTICS', 'TREATMENT', 'DISPOSITION'],
  DIAGNOSTICS: ['CONSULTATION', 'TREATMENT', 'DISPOSITION'],
  TREATMENT: ['CONSULTATION', 'DIAGNOSTICS', 'DISPOSITION'],
  DISPOSITION: ['CONSULTATION', 'TREATMENT', 'COMPLETED'],
  COMPLETED: ['DISPOSITION'],
};

export function normalizeClinicalEncounterState(value: unknown): ClinicalEncounterState | null {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (CANONICAL_CLINICAL_STATES.includes(normalized as ClinicalEncounterState)) {
    return normalized as ClinicalEncounterState;
  }
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
