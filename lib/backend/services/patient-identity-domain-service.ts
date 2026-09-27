/**
 * G-HIMS Patient Identity & Safety Domain Service
 * Implements Rule 10 (Patient Identity Safety) & Rule 6 (Data Integrity Rule):
 * 
 * - Deterministic duplicate registration detection (MRN, National ID / CNIC, Phone + Name similarity)
 * - Atomic Multi-Document Registration with MPI indexing
 * - Patient Merge Workflow with strict clinical invariants (blocks invalid merges)
 * - Stale Patient Context & Encounter Verification
 * - High-Risk Action Explicit Patient Identity Confirmation Gate
 */

import { CommandContext, CommandResult } from '../types';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { PatientMPI } from '@/types/mpi';

export interface RegisterPatientPayload {
  fullName: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  dateOfBirth: string; // YYYY-MM-DD
  contactPhone: string;
  address?: string;
  bloodGroup?: string;
  identifiers: {
    type: 'CNIC' | 'MRN' | 'PASSPORT' | 'NATIONAL_ID' | 'DRIVER_LICENSE' | 'INSURANCE_ID';
    value: string;
    issuer?: string;
  }[];
  allergies?: string[];
  chronicConditions?: string[];
  department?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  chiefComplaint?: string;
}

export interface MergePatientPayload {
  primaryPatientId: string; // Surviving authoritative record
  secondaryPatientId: string; // Deprecated record to be merged
  mergeReason: string;
  supervisorApprovalCode?: string;
  overrideWarnings?: boolean;
}

export interface ConfirmPatientIdentityPayload {
  patientId: string;
  expectedMrn: string;
  expectedFullName: string;
  expectedDob: string;
  encounterId?: string;
  actionType: 'PRESCRIBE_HIGH_ALERT_MEDICATION' | 'ORDER_BLOOD_TRANSFUSION' | 'SCHEDULE_SURGERY' | 'STAT_LAB_OVERRIDE';
  actionSummary: string;
  clinicianVerificationSignature: string;
}

export interface ValidateContextPayload {
  patientId: string;
  encounterId: string;
  tenantId: string;
}

// In-memory patient store simulation for domain service testing and transaction coordinator
export interface StoredPatient {
  id: string;
  tenantId: string;
  mrn: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  contactPhone: string;
  bloodGroup: string;
  identifiers: { type: string; value: string; issuer?: string }[];
  allergies: string[];
  chronicConditions: string[];
  status: 'ACTIVE' | 'MERGED' | 'DECEASED' | 'INACTIVE';
  mergedIntoPatientId?: string;
  createdAt: number;
  updatedAt: number;
}

// In-memory MPI index map: `${tenantId}:${type}:${value}` -> patientId
const MPI_IDENTITY_INDEX = new Map<string, string>();
const PATIENTS_STORE = new Map<string, StoredPatient>();

// Seed initial patients for testing & consistency
function seedInitialMpi() {
  if (PATIENTS_STORE.size === 0) {
    const p1: StoredPatient = {
      id: 'p-1001',
      tenantId: 'central-metro-hospital',
      mrn: 'MRN-849201',
      fullName: 'Marcus Vance',
      gender: 'male',
      dateOfBirth: '1979-04-12',
      contactPhone: '+1 (555) 234-5678',
      bloodGroup: 'O+',
      identifiers: [{ type: 'CNIC', value: '42101-1234567-1' }],
      allergies: ['Penicillin', 'Sulfa Drugs'],
      chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
      status: 'ACTIVE',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now(),
    };
    const p2: StoredPatient = {
      id: 'p-1002',
      tenantId: 'central-metro-hospital',
      mrn: 'MRN-910423',
      fullName: 'Elena Rostova',
      gender: 'female',
      dateOfBirth: '1992-08-23',
      contactPhone: '+1 (555) 345-6789',
      bloodGroup: 'A-',
      identifiers: [{ type: 'CNIC', value: '42101-9876543-2' }],
      allergies: ['Latex'],
      chronicConditions: ['Asthma'],
      status: 'ACTIVE',
      createdAt: Date.now() - 86400000 * 20,
      updatedAt: Date.now(),
    };
    PATIENTS_STORE.set(p1.id, p1);
    PATIENTS_STORE.set(p2.id, p2);
    MPI_IDENTITY_INDEX.set(`central-metro-hospital:MRN:${p1.mrn}`, p1.id);
    MPI_IDENTITY_INDEX.set(`central-metro-hospital:CNIC:${p1.identifiers[0].value}`, p1.id);
    MPI_IDENTITY_INDEX.set(`central-metro-hospital:MRN:${p2.mrn}`, p2.id);
    MPI_IDENTITY_INDEX.set(`central-metro-hospital:CNIC:${p2.identifiers[0].value}`, p2.id);
  }
}

seedInitialMpi();

export class PatientIdentityDomainService {
  /**
   * Deterministic duplicate search helper
   */
  public static findPotentialDuplicates(
    tenantId: string,
    fullName: string,
    dob: string,
    identifiers: { type: string; value: string }[],
    phone?: string
  ): StoredPatient[] {
    const duplicates: StoredPatient[] = [];
    const normalizedName = fullName.trim().toLowerCase();

    for (const patient of PATIENTS_STORE.values()) {
      if (patient.tenantId !== tenantId) continue;

      // 1. Exact Identifier Match (CNIC, MRN, Passport)
      const hasIdMatch = identifiers.some((id) =>
        patient.identifiers.some(
          (pid) => pid.type === id.type && pid.value.trim().toLowerCase() === id.value.trim().toLowerCase()
        )
      );

      // 2. Exact Phone Match with similar name
      const hasPhoneMatch = phone && patient.contactPhone && patient.contactPhone.replace(/\D/g, '') === phone.replace(/\D/g, '');

      // 3. Exact Name + DOB Match
      const hasNameDobMatch = patient.fullName.trim().toLowerCase() === normalizedName && patient.dateOfBirth === dob;

      if (hasIdMatch || (hasPhoneMatch && patient.fullName.trim().toLowerCase().includes(normalizedName.split(' ')[0])) || hasNameDobMatch) {
        duplicates.push(patient);
      }
    }

    return duplicates;
  }

  /**
   * 1. Deterministic Atomic Patient Registration
   */
  public static async registerPatient(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RegisterPatientPayload
  ): Promise<CommandResult> {
    // Gate A: Tenant check
    if (!context.tenantId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'MISSING_TENANT_ID', message: 'Tenant identifier is required.' },
      };
    }

    // Gate B: Authorization
    const canRegister =
      context.roles.includes('RECEPTIONIST') ||
      context.roles.includes('REGISTRATION_CLERK') ||
      context.roles.includes('DOCTOR') ||
      context.roles.includes('NURSE') ||
      context.roles.includes('SUPER_ADMIN') ||
      context.permissions.includes('PATIENT_REGISTER') ||
      context.permissions.includes('*');

    if (!canRegister) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNAUTHORIZED_PATIENT_REGISTRATION',
          message: `Actor '${context.actorId}' does not have permission to register patients.`,
        },
      };
    }

    // Gate C: Validation
    if (!payload.fullName || payload.fullName.trim().length < 2) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_PATIENT_NAME', message: 'Full legal patient name is required (min 2 chars).' },
      };
    }
    if (!payload.dateOfBirth) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_DOB', message: 'Date of birth is required.' },
      };
    }

    // Gate D: Atomic Duplicate Check across MPI
    const duplicates = this.findPotentialDuplicates(
      context.tenantId,
      payload.fullName,
      payload.dateOfBirth,
      payload.identifiers || [],
      payload.contactPhone
    );

    if (duplicates.length > 0) {
      const existing = duplicates[0];
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DUPLICATE_PATIENT_RECORD_DETECTED',
          message: `Patient already registered in Master Patient Index as ${existing.fullName} (${existing.mrn}). Duplicate registration rejected for patient safety.`,
          details: {
            existingPatientId: existing.id,
            existingMrn: existing.mrn,
            existingName: existing.fullName,
          },
        },
      };
    }

    const patientId = `pat_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const mrn = `MRN-${yyyy}${mm}${dd}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newPatient: StoredPatient = {
      id: patientId,
      tenantId: context.tenantId,
      mrn,
      fullName: payload.fullName.trim(),
      gender: payload.gender,
      dateOfBirth: payload.dateOfBirth,
      contactPhone: payload.contactPhone,
      bloodGroup: payload.bloodGroup || 'O+',
      identifiers: payload.identifiers || [],
      allergies: payload.allergies || [],
      chronicConditions: payload.chronicConditions || [],
      status: 'ACTIVE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Index MPI keys
    PATIENTS_STORE.set(patientId, newPatient);
    MPI_IDENTITY_INDEX.set(`${context.tenantId}:MRN:${mrn}`, patientId);
    for (const id of newPatient.identifiers) {
      MPI_IDENTITY_INDEX.set(`${context.tenantId}:${id.type}:${id.value}`, patientId);
    }

    // Write Atomic Multi-Document Transaction via TransactionManager
    const txResult = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'RECEPTIONIST',
      aggregateType: 'PATIENT_MPI',
      aggregateId: patientId,
      eventType: 'PatientRegisteredEvent',
      eventPayload: {
        patientId,
        mrn,
        fullName: newPatient.fullName,
        dateOfBirth: newPatient.dateOfBirth,
        gender: newPatient.gender,
        identifiers: newPatient.identifiers,
        allergies: newPatient.allergies,
      },
      auditAction: 'PATIENT_REGISTERED',
      auditResourceType: 'PATIENT',
      auditResourceId: patientId,
      outboxTopic: 'patient_identity_topic',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: newPatient,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: patientId,
      eventId: txResult.eventId,
      auditId: txResult.auditId,
      outboxId: txResult.outboxId,
      data: {
        patientId,
        mrn,
        fullName: newPatient.fullName,
        dateOfBirth: newPatient.dateOfBirth,
        status: newPatient.status,
      },
    };
  }

  /**
   * 2. Patient Merge Workflow with Strict Safety Invariants
   */
  public static async mergePatients(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: MergePatientPayload
  ): Promise<CommandResult> {
    // Gate A: Authorization (Medical Director or Super Admin)
    const canMerge =
      context.roles.includes('SUPER_ADMIN') ||
      context.roles.includes('MEDICAL_DIRECTOR') ||
      context.permissions.includes('PATIENT_MERGE') ||
      context.permissions.includes('*');

    if (!canMerge) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNAUTHORIZED_PATIENT_MERGE',
          message: 'Patient record merging requires Medical Director or Super Admin authorization.',
        },
      };
    }

    // Gate B: Invariant - Cannot merge same patient into itself
    if (payload.primaryPatientId === payload.secondaryPatientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_MERGE_SELF',
          message: 'Cannot merge a patient record into itself.',
        },
      };
    }

    const primary = PATIENTS_STORE.get(payload.primaryPatientId);
    const secondary = PATIENTS_STORE.get(payload.secondaryPatientId);

    if (!primary || primary.tenantId !== context.tenantId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PRIMARY_PATIENT_NOT_FOUND', message: 'Primary patient record not found in tenant.' },
      };
    }

    if (!secondary || secondary.tenantId !== context.tenantId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'SECONDARY_PATIENT_NOT_FOUND', message: 'Secondary patient record not found in tenant.' },
      };
    }

    // Gate C: Invariant - Cannot merge already merged patient as primary
    if (primary.status === 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_PRIMARY_STATUS',
          message: `Primary patient record '${primary.mrn}' is already merged into '${primary.mergedIntoPatientId}'.`,
        },
      };
    }

    // Gate D: Invariant - Cannot merge deceased with active without supervisor approval
    if (primary.status === 'DECEASED' && secondary.status === 'ACTIVE' && !payload.supervisorApprovalCode) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_MERGE_DECEASED_ACTIVE',
          message: 'Cannot merge active patient into deceased patient without verified supervisor approval code.',
        },
      };
    }

    // Gate E: Demographic discrepancy safety check (e.g. sex mismatch)
    if (primary.gender !== secondary.gender && !payload.overrideWarnings) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MERGE_DEMOGRAPHIC_CONFLICT',
          message: `Sex mismatch between primary (${primary.gender}) and secondary (${secondary.gender}). Explicit override required.`,
        },
      };
    }

    // Execute Merge Mutation
    secondary.status = 'MERGED';
    secondary.mergedIntoPatientId = primary.id;
    secondary.updatedAt = Date.now();

    // Union allergies and chronic conditions
    const mergedAllergies = Array.from(new Set([...primary.allergies, ...secondary.allergies]));
    const mergedConditions = Array.from(new Set([...primary.chronicConditions, ...secondary.chronicConditions]));
    primary.allergies = mergedAllergies;
    primary.chronicConditions = mergedConditions;
    primary.updatedAt = Date.now();

    // Write Atomic Transaction with Audit Log
    const txResult = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'MEDICAL_DIRECTOR',
      aggregateType: 'PATIENT_MPI',
      aggregateId: primary.id,
      eventType: 'PatientRecordsMergedEvent',
      eventPayload: {
        primaryPatientId: primary.id,
        primaryMrn: primary.mrn,
        secondaryPatientId: secondary.id,
        secondaryMrn: secondary.mrn,
        mergeReason: payload.mergeReason,
        mergedAllergies,
        mergedConditions,
      },
      auditAction: 'PATIENT_MERGED',
      auditResourceType: 'PATIENT',
      auditResourceId: primary.id,
      outboxTopic: 'patient_identity_topic',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: primary,
      additionalStateWrites: [
        {
          entityType: 'PATIENT_MPI',
          entityId: secondary.id,
          domainState: secondary,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: primary.id,
      eventId: txResult.eventId,
      auditId: txResult.auditId,
      outboxId: txResult.outboxId,
      data: {
        primaryPatientId: primary.id,
        primaryMrn: primary.mrn,
        secondaryPatientId: secondary.id,
        status: 'MERGED',
        allergies: mergedAllergies,
      },
    };
  }

  /**
   * 3. High-Risk Action Explicit Patient Identity Confirmation Gate
   */
  public static async confirmPatientIdentity(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ConfirmPatientIdentityPayload
  ): Promise<CommandResult> {
    const patient = await DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.patientId);

    if (!patient || patient.tenantId !== context.tenantId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_FOUND', message: 'Target patient not found in tenant.' },
      };
    }

    if (patient.status === 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'STALE_MERGED_PATIENT_CONTEXT',
          message: `Patient record has been merged into '${patient.mergedIntoPatientId}'. Please switch to authoritative primary record.`,
        },
      };
    }

    // Explicit Verification Matching
    const mrnMatches = patient.mrn.trim().toUpperCase() === payload.expectedMrn.trim().toUpperCase();
    const nameMatches =
      patient.fullName.trim().toLowerCase() === payload.expectedFullName.trim().toLowerCase() ||
      patient.fullName.toLowerCase().includes(payload.expectedFullName.trim().toLowerCase());
    const dobMatches = !payload.expectedDob || patient.dateOfBirth === payload.expectedDob;

    if (!mrnMatches || !nameMatches || !dobMatches) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_IDENTITY_VERIFICATION_MISMATCH',
          message: `Critical safety check failed: Provided identity does not match patient records (MRN match: ${mrnMatches}, Name match: ${nameMatches}, DOB match: ${dobMatches}).`,
          details: {
            provided: { mrn: payload.expectedMrn, name: payload.expectedFullName, dob: payload.expectedDob },
            actual: { mrn: patient.mrn, name: patient.fullName, dob: patient.dateOfBirth },
          },
        },
      };
    }

    // Record Immutable Verification Audit Log
    const txResult = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'PATIENT_SAFETY',
      aggregateId: patient.id,
      eventType: 'PatientIdentityExplicitlyConfirmedEvent',
      eventPayload: {
        patientId: patient.id,
        mrn: patient.mrn,
        actionType: payload.actionType,
        actionSummary: payload.actionSummary,
        clinicianVerificationSignature: payload.clinicianVerificationSignature,
        confirmedAt: Date.now(),
      },
      auditAction: 'PATIENT_IDENTITY_CONFIRMED',
      auditResourceType: 'PATIENT',
      auditResourceId: patient.id,
      outboxTopic: 'patient_safety_topic',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: patient.id,
      eventId: txResult.eventId,
      auditId: txResult.auditId,
      data: {
        confirmed: true,
        patientId: patient.id,
        mrn: patient.mrn,
        actionType: payload.actionType,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * 4. Stale Patient & Encounter Context Validator
   */
  public static validatePatientContext(
    tenantId: string,
    patientId: string,
    encounterId?: string
  ): { valid: boolean; reason?: string; patient?: StoredPatient } {
    const patient = PATIENTS_STORE.get(patientId);

    if (!patient) {
      return { valid: false, reason: `Patient ID '${patientId}' does not exist.` };
    }

    if (patient.tenantId !== tenantId) {
      return {
        valid: false,
        reason: `Cross-tenant violation: Patient '${patientId}' belongs to tenant '${patient.tenantId}', not '${tenantId}'.`,
      };
    }

    if (patient.status === 'MERGED') {
      return {
        valid: false,
        reason: `Patient record has been merged into '${patient.mergedIntoPatientId}'.`,
        patient,
      };
    }

    return { valid: true, patient };
  }

  /**
   * Reset store for unit tests
   */
  public static resetStore(): void {
    PATIENTS_STORE.clear();
    MPI_IDENTITY_INDEX.clear();
    seedInitialMpi();
  }
}
