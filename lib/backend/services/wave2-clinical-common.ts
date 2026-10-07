import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';

export interface Wave2ScopedEncounter {
  patient: Record<string, unknown>;
  encounter: Record<string, unknown>;
}

export function wave2Failure(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string
): CommandResult {
  return { success: false, commandId, idempotencyKey, error: { code, message } };
}

export function clinicianAuthorization(
  context: CommandContext,
  options: { privilege?: string; allowBreakGlass?: boolean } = {}
) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN', 'SYSTEM_ADMIN'],
    ...(options.privilege ? { requiredPrivilege: options.privilege } : {}),
    allowBreakGlass: options.allowBreakGlass ?? false,
  });
}

export function nurseAuthorization(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'NURSE',
      'HEAD_NURSE',
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
    ],
    allowBreakGlass: true,
  });
}

export function rehabilitationAuthorization(context: CommandContext) {
  const roles = context.roles.map((role) => String(role || '').trim().toUpperCase());
  if (
    roles.some((role) =>
      ['PHYSIOTHERAPIST', 'PHYSICAL_THERAPIST', 'OCCUPATIONAL_THERAPIST', 'SPEECH_THERAPIST', 'REHABILITATION_THERAPIST'].includes(role)
    )
  ) {
    return { authorized: true as const };
  }
  return nurseAuthorization(context);
}

export async function loadWave2ScopedEncounter(
  context: CommandContext,
  patientId: string,
  encounterId: string,
  options: { requireInpatient?: boolean } = {}
): Promise<
  | Wave2ScopedEncounter
  | { error: { code: string; message: string } }
> {
  const [patient, encounter] = await Promise.all([
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      patientId
    ),
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      encounterId
    ),
  ]);

  if (!patient) {
    return { error: { code: 'PATIENT_NOT_FOUND', message: 'Patient does not exist.' } };
  }
  if (!encounter || String(encounter.patientId || '') !== patientId) {
    return {
      error: {
        code: 'ENCOUNTER_PATIENT_MISMATCH',
        message: 'Encounter does not belong to the supplied patient.',
      },
    };
  }

  const status = String(encounter.status || '').trim().toUpperCase();
  if (['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED', 'CLOSED'].includes(status)) {
    return {
      error: {
        code: 'WAVE2_ENCOUNTER_CLOSED',
        message: 'Wave 2 clinical execution requires an active encounter.',
      },
    };
  }

  if (options.requireInpatient) {
    const encounterType = String(
      encounter.encounterType || encounter.type || ''
    ).trim().toUpperCase();
    if (encounterType !== 'IPD') {
      return {
        error: {
          code: 'WAVE2_INPATIENT_ENCOUNTER_REQUIRED',
          message: 'This workflow requires an active inpatient encounter.',
        },
      };
    }
  }

  assertPatient360PatientAccess(context, patient, encounter);
  return { patient, encounter };
}

export function uniqueWave2Strings(values: unknown[] | undefined, max = 100): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

export function normalizedText(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function ensureSameScope(
  record: Record<string, unknown> | null,
  patientId: string,
  encounterId: string
): boolean {
  return Boolean(
    record &&
    String(record.patientId || '') === patientId &&
    String(record.encounterId || '') === encounterId
  );
}
