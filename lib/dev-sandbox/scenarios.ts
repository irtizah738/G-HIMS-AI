export type SandboxScenarioId =
  | 'mpi-identity'
  | 'opd-registration'
  | 'opd-consultation'
  | 'telehealth-unused'
  | 'telehealth-completed'
  | 'emergency-intake'
  | 'inpatient-care'
  | 'billing-clearance';

export interface SandboxScenario {
  id: SandboxScenarioId;
  patientId: string;
  mrn: string;
  fullName: string;
  encounterId?: string;
  encounterType?: 'OPD' | 'TELEHEALTH' | 'EMERGENCY' | 'IPD';
  encounterStatus?: string;
  /** Fixture starting condition, NOT proof a clinical command has executed. */
  expectedNextAction: string;
  primaryPersona: 'admin' | 'doctor' | 'nurse' | 'reception' | 'billing';
}

export const SANDBOX_SCENARIOS: readonly SandboxScenario[] = [
  { id: 'mpi-identity', patientId: 'ds_patient_mpi', mrn: 'DS-MRN-0001',
    fullName: 'Sandbox Identity Alpha', expectedNextAction: 'MPI exact MRN/CNIC lookup',
    primaryPersona: 'reception' },
  { id: 'opd-registration', patientId: 'ds_patient_opd_register', mrn: 'DS-MRN-0002',
    fullName: 'Sandbox Registration Beta', expectedNextAction: 'Register consent then open OPD encounter',
    primaryPersona: 'reception' },
  { id: 'opd-consultation', patientId: 'ds_patient_opd_consult', mrn: 'DS-MRN-0003',
    fullName: 'Sandbox Consultation Gamma', encounterId: 'ds_enc_opd_consult',
    encounterType: 'OPD', encounterStatus: 'ACTIVE',
    expectedNextAction: 'Complete real test billing gate, clinician notes and disposition commands',
    primaryPersona: 'doctor' },
  { id: 'telehealth-unused', patientId: 'ds_patient_th_unused', mrn: 'DS-MRN-0004',
    fullName: 'Sandbox Telehealth Delta', encounterId: 'ds_enc_th_unused',
    encounterType: 'TELEHEALTH', encounterStatus: 'ACTIVE',
    expectedNextAction: 'Run authorized unused encounter cancellation; no note must be fabricated',
    primaryPersona: 'admin' },
  { id: 'telehealth-completed', patientId: 'ds_patient_th_done', mrn: 'DS-MRN-0005',
    fullName: 'Sandbox Telehealth Epsilon', encounterId: 'ds_enc_th_done',
    encounterType: 'TELEHEALTH', encounterStatus: 'COMPLETED',
    expectedNextAction: 'Verify completed encounter and no active care pointer in MPI',
    primaryPersona: 'doctor' },
  { id: 'emergency-intake', patientId: 'ds_patient_er', mrn: 'DS-MRN-0006',
    fullName: 'Sandbox Emergency Zeta', encounterId: 'ds_enc_er',
    encounterType: 'EMERGENCY', encounterStatus: 'ACTIVE',
    expectedNextAction: 'ER triage, vitals, handoff, and disposition through commands',
    primaryPersona: 'nurse' },
  { id: 'inpatient-care', patientId: 'ds_patient_ipd', mrn: 'DS-MRN-0007',
    fullName: 'Sandbox Inpatient Eta', encounterId: 'ds_enc_ipd',
    encounterType: 'IPD', encounterStatus: 'ACTIVE',
    expectedNextAction: 'Run nurse observations, bed authority and eventual signed discharge',
    primaryPersona: 'doctor' },
  { id: 'billing-clearance', patientId: 'ds_patient_billing', mrn: 'DS-MRN-0008',
    fullName: 'Sandbox Billing Theta', encounterId: 'ds_enc_billing',
    encounterType: 'OPD', encounterStatus: 'ACTIVE',
    expectedNextAction: 'Create authoritative invoice, settle mock cash, reconcile GL',
    primaryPersona: 'billing' },
];

export const SANDBOX_PERSONAS = [
  { key: 'admin', role: 'ADMINISTRATOR', department: 'HOSPITAL_ADMIN' },
  { key: 'reception', role: 'RECEPTIONIST', department: 'GENERAL_MEDICINE' },
  { key: 'doctor', role: 'DOCTOR', department: 'GENERAL_MEDICINE' },
  { key: 'nurse', role: 'NURSE', department: 'GENERAL_MEDICINE' },
  { key: 'billing', role: 'BILLING_CLERK', department: 'REVENUE_CYCLE' },
  { key: 'pharmacy', role: 'PHARMACIST', department: 'PHARMACY' },
  { key: 'lab', role: 'LAB_TECH', department: 'LABORATORY' },
] as const;
export const SANDBOX_FACILITY_ID = 'DS_FACILITY_01';
export const SANDBOX_FIXTURE_VERSION = 1;

export function scenarioCarePointers(scenario: SandboxScenario): Record<string, unknown> {
  const base = {
    activeOpdEncounterIds: [] as string[],
    activeTelehealthEncounterIds: [] as string[],
    activeIpdEncounterId: '',
    activeEmergencyEncounterId: '',
  };
  if (!scenario.encounterId || scenario.encounterStatus === 'COMPLETED') return base;
  switch (scenario.encounterType) {
    case 'OPD': base.activeOpdEncounterIds = [scenario.encounterId]; break;
    case 'TELEHEALTH': base.activeTelehealthEncounterIds = [scenario.encounterId]; break;
    case 'IPD': base.activeIpdEncounterId = scenario.encounterId; break;
    case 'EMERGENCY': base.activeEmergencyEncounterId = scenario.encounterId; break;
  }
  return base;
}
