export type ClinicalContextStatus = 'VERIFIED' | 'UNRESOLVED' | 'MISMATCH';

export interface EncounterIdentity {
  id: string;
  tenantId?: string;
  patientId: string;
  mrn: string;
  patientName?: string;
}

export interface PatientIdentity {
  id: string;
  mrn: string;
  fullName?: string;
}

export interface BoundClinicalIdentity {
  tenantId: string;
  encounterId: string;
  patientId: string;
  patientMrn: string;
  patientName?: string;
  status: ClinicalContextStatus;
}

export type PatientContextFailureCode =
  | 'CLINICAL_CONTEXT_REQUIRED'
  | 'CLINICAL_CONTEXT_RESOLVING'
  | 'PATIENT_CONTEXT_UNRESOLVED'
  | 'PATIENT_CONTEXT_MISMATCH'
  | 'TENANT_CONTEXT_MISMATCH';

export type PatientContextVerification =
  | { ok: true }
  | {
      ok: false;
      code: PatientContextFailureCode;
      detail: string;
    };

function normalized(value: unknown): string {
  return String(value || '').trim();
}

function normalizedTenant(value: unknown): string {
  return normalized(value).toLowerCase();
}

/**
 * Pure client/read-model patient context verifier.
 *
 * This function does not grant mutation authority. It exists to guarantee that
 * every patient-bound clinical surface is rendered only when the selected
 * encounter, canonical patient projection and shared clinical context all
 * identify the same patient and MRN. Server domain services independently
 * enforce the same lineage before authoritative writes.
 */
export function verifyPatientContextIdentity(input: {
  tenantId: string;
  encounter?: EncounterIdentity | null;
  patient?: PatientIdentity | null;
  context?: BoundClinicalIdentity | null;
}): PatientContextVerification {
  const tenantId = normalizedTenant(input.tenantId);
  const encounter = input.encounter;
  const patient = input.patient;
  const context = input.context;

  if (!encounter) {
    return {
      ok: false,
      code: 'CLINICAL_CONTEXT_REQUIRED',
      detail: 'No active encounter has been selected.',
    };
  }

  if (!patient) {
    return {
      ok: false,
      code: 'PATIENT_CONTEXT_UNRESOLVED',
      detail: 'The patient bound to the encounter is not available in the canonical patient projection.',
    };
  }

  const encounterTenant = normalizedTenant(encounter.tenantId || tenantId);
  if (!tenantId || encounterTenant !== tenantId) {
    return {
      ok: false,
      code: 'TENANT_CONTEXT_MISMATCH',
      detail: 'The encounter does not belong to the active tenant.',
    };
  }

  if (
    normalized(encounter.patientId) !== normalized(patient.id) ||
    normalized(encounter.mrn) !== normalized(patient.mrn) ||
    (
      normalized(encounter.patientName) &&
      normalized(patient.fullName) &&
      normalized(encounter.patientName) !== normalized(patient.fullName)
    )
  ) {
    return {
      ok: false,
      code: 'PATIENT_CONTEXT_MISMATCH',
      detail: 'The encounter patient identity or MRN does not match the canonical patient projection.',
    };
  }

  if (!context) {
    return {
      ok: false,
      code: 'CLINICAL_CONTEXT_RESOLVING',
      detail: 'The shared clinical context has not yet been bound to the encounter.',
    };
  }

  if (context.status === 'UNRESOLVED') {
    return {
      ok: false,
      code: 'PATIENT_CONTEXT_UNRESOLVED',
      detail: 'The shared shell patient projection cannot resolve the encounter patient.',
    };
  }

  if (context.status === 'MISMATCH') {
    return {
      ok: false,
      code: 'PATIENT_CONTEXT_MISMATCH',
      detail: 'The shared shell patient projection disagrees with the encounter MRN.',
    };
  }

  if (normalizedTenant(context.tenantId) !== tenantId) {
    return {
      ok: false,
      code: 'TENANT_CONTEXT_MISMATCH',
      detail: 'The shared clinical context belongs to a different tenant.',
    };
  }

  if (
    normalized(context.encounterId) !== normalized(encounter.id) ||
    normalized(context.patientId) !== normalized(encounter.patientId) ||
    normalized(context.patientMrn) !== normalized(encounter.mrn) ||
    (
      normalized(encounter.patientName) &&
      normalized(context.patientName) &&
      normalized(context.patientName) !== normalized(encounter.patientName)
    )
  ) {
    return {
      ok: false,
      code: 'PATIENT_CONTEXT_MISMATCH',
      detail: 'The shared clinical context does not identify the same encounter, patient and MRN.',
    };
  }

  return { ok: true };
}

export const OPD_PATIENT_BOUND_TABS = new Set([
  'TRIAGE',
  'CONSULTATION',
  'DIAGNOSTICS',
  'PHARMACY',
  'BILLING',
  'DISPOSITION',
  'AUDIT',
]);
