import type { CommandContext } from '@/lib/backend/types';
import { AuthError } from '@/lib/auth/auth-errors';

const FULL_CHART_ROLES = new Set([
  'ADMIN',
  'ADMINISTRATOR',
  'SYSTEM_ADMIN',
  'DOCTOR',
  'CONSULTANT',
  'ATTENDING_PHYSICIAN',
  'NURSE',
  'SURGEON',
]);

const ADMIN_ROLES = new Set(['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN']);

function deny(context: CommandContext, reason: string): never {
  throw new AuthError({
    code: 'AUTHORIZATION_REQUIRED',
    message: `Actor '${context.actorId}' lacks Patient 360 chart-read authority: ${reason}`,
    statusCode: 403,
    userMessage: 'You do not have permission to open the complete patient chart.',
  });
}

export function assertPatient360ReadAccess(context: CommandContext): void {
  const authorized =
    context.permissions.includes('*') ||
    context.permissions.includes('PATIENT360:READ') ||
    context.permissions.includes('PATIENT360:READ_ALL') ||
    context.roles.some((role) => FULL_CHART_ROLES.has(role.toUpperCase()));

  if (!authorized) deny(context, 'full-chart role or permission is required');
}

/**
 * Enforce the minimum-necessary ABAC boundary for a specific patient.
 *
 * Ancillary roles (lab/pharmacy/radiology) no longer receive a complete
 * longitudinal chart merely by role. They must use bounded domain surfaces or
 * an explicitly granted Patient 360 permission.
 */
export function assertPatient360PatientAccess(
  context: CommandContext,
  patient: Record<string, unknown>,
  encounter?: Record<string, unknown> | null
): void {
  assertPatient360ReadAccess(context);

  const normalizedRoles = context.roles.map((role) => role.toUpperCase());
  if (
    context.permissions.includes('*') ||
    context.permissions.includes('PATIENT360:READ_ALL') ||
    normalizedRoles.some((role) => ADMIN_ROLES.has(role))
  ) {
    return;
  }

  const patientId = String(
    patient.id || patient.patientId || patient.mpiId || ''
  ).trim();

  if (
    context.isEmergencyOverride &&
    context.breakGlassPatientId &&
    context.breakGlassPatientId === patientId
  ) {
    return;
  }

  const careTeamActorIds = [
    encounter?.assignedDoctorId,
    encounter?.attendingDoctorId,
    encounter?.assignedNurseId,
    encounter?.clinicianId,
    encounter?.providerId,
    encounter?.assignedProviderId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (
    careTeamActorIds.length > 0 &&
    careTeamActorIds.includes(context.actorId)
  ) {
    return;
  }

  const requiredFacility = String(
    encounter?.facilityId || patient.facilityId || ''
  ).trim();
  const requiredDepartment = String(
    encounter?.departmentId ||
      encounter?.department ||
      patient.departmentId ||
      ''
  ).trim();

  const facilities = new Set(
    (context.facilityIds || [])
      .map((value) => String(value).trim())
      .filter(Boolean)
  );
  const departments = new Set(
    (context.departmentIds || (context.departmentId ? [context.departmentId] : []))
      .map((value) => String(value).trim())
      .filter(Boolean)
  );

  if (!requiredFacility || !requiredDepartment) {
    deny(
      context,
      'patient encounter is missing server-verifiable facility/department scope'
    );
  }

  if (facilities.size === 0 || !facilities.has(requiredFacility)) {
    deny(context, 'patient facility is outside the actor scope');
  }

  if (departments.size === 0 || !departments.has(requiredDepartment)) {
    deny(context, 'patient department is outside the actor scope');
  }
}
