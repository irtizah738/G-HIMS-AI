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
        | 'PATIENT_CONTEXT_MISMATCH';
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
    if (ENCOUNTER_CREATION_COMMANDS.has(command.commandType)) {
      return { ok: true };
    }

    const payload = asRecord(command.payload);
    const patientId = normalize(payload.patientId);
    const encounterId = normalize(
      payload.encounterId || payload.sourceEncounterId
    );

    // Commands without both identifiers remain the responsibility of their
    // domain service. This guard never invents patient identity from UI state.
    if (!patientId || !encounterId) {
      return { ok: true };
    }

    const db = getAdminFirestore();
    if (!db) {
      if (isProductionLikeRuntime()) {
        return {
          ok: false,
          code: 'PATIENT_CONTEXT_AUTHORITY_UNAVAILABLE',
          message:
            'Authoritative patient/encounter lineage cannot be verified because the durable clinical store is unavailable.',
        };
      }
      // TEST/DEMO may intentionally use ephemeral repositories. Domain service
      // lineage checks remain active there.
      return { ok: true };
    }

    const tenantId = normalize(context.tenantId).toLowerCase();
    if (!tenantId) {
      return {
        ok: false,
        code: 'TENANT_CONTEXT_MISMATCH',
        message: 'Authenticated tenant context is required.',
      };
    }

    const tenantRef = db.collection('tenants').doc(tenantId);
    const [encounterSnapshot, patientSnapshot] = await Promise.all([
      tenantRef.collection('encounters').doc(encounterId).get(),
      tenantRef.collection('patients').doc(patientId).get(),
    ]);

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

    const patient = patientSnapshot.data() || {};
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
