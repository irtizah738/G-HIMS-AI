import type { BaseCommand, CommandContext } from '../types';
import { getAdminFirestore } from '@/server/firebase/admin';
import { isProductionLikeRuntime } from '@/lib/runtime/runtime-mode';

export type PatientContextIntegrityDecision =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'PATIENT_CONTEXT_AUTHORITY_UNAVAILABLE'
        | 'ENCOUNTER_NOT_FOUND'
        | 'PATIENT_NOT_FOUND'
        | 'TENANT_CONTEXT_MISMATCH'
        | 'PATIENT_CONTEXT_MISMATCH'
        | 'PATIENT_REMOVED_FROM_ACTIVE_MPI';
      message: string;
    };

const ENCOUNTER_CREATION_COMMANDS = new Set([
  'CreateEncounterCommand',
  'CreateOpdEncounterCommand',
  'RegisterPatientAndEncounterCommand',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalize(value: unknown): string {
  return String(value || '').trim();
}

/**
 * Cross-domain patient safety guard.
 *
 * Any command that carries both a patient identifier and an existing encounter
 * identifier must prove that the authoritative encounter belongs to that
 * patient before idempotency reservation or domain dispatch. Domain services
 * still repeat their own transactional lineage checks; this is a central
 * defense-in-depth boundary so a newly added service cannot accidentally omit
 * wrong-patient protection.
 */
export class PatientContextIntegrityGuard {
  public static async verify(
    context: CommandContext,
    command: BaseCommand
  ): Promise<PatientContextIntegrityDecision> {
    // The removal service enforces patient status transactionally. Allow the
    // command bus to replay its completed idempotency reservation on retry.
    if (command.commandType === 'RemovePatientRecordCommand') {
      return { ok: true };
    }

    const payload = asRecord(command.payload);
    const patientId = normalize(payload.patientId);
    const encounterId = normalize(
      payload.encounterId || payload.sourceEncounterId
    );

    // Prevent stale clients from using a removed identity even when the command
    // has not yet been tied to an encounter. Other domain-level validations
    // remain mandatory.
    if (!patientId) {
      return { ok: true };
    }

    // TEST/DEMO domain services already perform their own lineage checks and
    // may intentionally use ephemeral repositories. The central Firestore
    // preflight is a staging/production defense-in-depth boundary.
    if (!isProductionLikeRuntime()) {
      return { ok: true };
    }

    const db = getAdminFirestore();
    if (!db) {
      return {
        ok: false,
        code: 'PATIENT_CONTEXT_AUTHORITY_UNAVAILABLE',
        message:
          'Authoritative patient/encounter lineage cannot be verified because the durable clinical store is unavailable.',
      };
    }

    const tenantDocumentId = normalize(context.tenantId);
    const tenantId = tenantDocumentId.toLowerCase();
    if (!tenantDocumentId) {
      return {
        ok: false,
        code: 'TENANT_CONTEXT_MISMATCH',
        message: 'Authenticated tenant context is required.',
      };
    }

    const tenantRef = db.collection('tenants').doc(tenantDocumentId);
    const patientSnapshot = await tenantRef.collection('patients').doc(patientId).get();
    const patient = patientSnapshot.data() || {};
    if (normalize(patient.status).toUpperCase() === 'REMOVED') {
      return {
        ok: false,
        code: 'PATIENT_REMOVED_FROM_ACTIVE_MPI',
        message: 'Patient record is removed from active care. Do not create new clinical activity against this identity.',
      };
    }

    // Creation and patient-only commands do not yet have an encounter to bind.
    // They are still checked for removed patient status above.
    if (!encounterId || ENCOUNTER_CREATION_COMMANDS.has(command.commandType)) {
      return { ok: true };
    }

    const encounterSnapshot = await tenantRef.collection('encounters').doc(encounterId).get();

    if (!encounterSnapshot.exists) {
      return {
        ok: false,
        code: 'ENCOUNTER_NOT_FOUND',
        message: 'The supplied encounter does not exist in the authenticated tenant.',
      };
    }

    if (!patientSnapshot.exists) {
      return {
        ok: false,
        code: 'PATIENT_NOT_FOUND',
        message: 'The supplied patient does not exist in the authenticated tenant.',
      };
    }

    const encounter = encounterSnapshot.data() || {};
    const encounterTenantId = normalize(encounter.tenantId).toLowerCase();
    if (encounterTenantId && encounterTenantId !== tenantId) {
      return {
        ok: false,
        code: 'TENANT_CONTEXT_MISMATCH',
        message: 'Encounter tenant metadata does not match the authenticated tenant.',
      };
    }

    if (normalize(encounter.patientId) !== patientId) {
      return {
        ok: false,
        code: 'PATIENT_CONTEXT_MISMATCH',
        message:
          'The supplied patient does not match the authoritative patient bound to the encounter.',
      };
    }

    const patientTenantId = normalize(patient.tenantId).toLowerCase();
    if (patientTenantId && patientTenantId !== tenantId) {
      return {
        ok: false,
        code: 'TENANT_CONTEXT_MISMATCH',
        message: 'Patient tenant metadata does not match the authenticated tenant.',
      };
    }

    return { ok: true };
  }
}
