import type { CommandContext } from '@/lib/backend/types';
import { AuthError } from '@/lib/auth/auth-errors';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';

const ADMIN_ROLES = new Set([
  'ADMIN',
  'ADMINISTRATOR',
  'SYSTEM_ADMIN',
]);

const CLINICAL_RESULT_ROLES = new Set([
  'DOCTOR',
  'CONSULTANT',
  'ATTENDING_PHYSICIAN',
  'NURSE',
  'SURGEON',
]);

const LAB_RESULT_ROLES = new Set([
  'LAB_TECH',
  'LAB_TECHNICIAN',
  'PATHOLOGIST',
]);

const RADIOLOGY_RESULT_ROLES = new Set([
  'RADIOLOGY_TECH',
  'RADIOLOGY_TECHNICIAN',
  'RADIOLOGIST',
]);

function deny(context: CommandContext, reason: string): never {
  throw new AuthError({
    code: 'AUTHORIZATION_REQUIRED',
    message: `Actor '${context.actorId}' lacks diagnostic result-read authority: ${reason}`,
    statusCode: 403,
    userMessage: 'You do not have permission to view this diagnostic result.',
  });
}

function actorFacilities(context: CommandContext): Set<string> {
  return new Set(
    (context.facilityIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

/**
 * Enforce minimum-necessary access to a single diagnostic result.
 *
 * Full-chart clinicians remain subject to the Patient 360 patient/care ABAC
 * boundary. Ancillary diagnostic staff receive only the bounded result surface
 * for their modality and must be assigned to the encounter facility.
 */
export function assertDiagnosticResultReadAccess(
  context: CommandContext,
  order: Record<string, unknown>,
  encounter: Record<string, unknown>,
  patient: Record<string, unknown>
): void {
  const roles = new Set(
    context.roles.map((role) => String(role || '').trim().toUpperCase())
  );

  if (
    context.permissions.includes('*') ||
    [...roles].some((role) => ADMIN_ROLES.has(role))
  ) {
    return;
  }

  const patientId = String(order.patientId || '').trim();
  const encounterId = String(order.encounterId || '').trim();

  if (
    !patientId ||
    !encounterId ||
    String(encounter.patientId || '').trim() !== patientId ||
    String(encounter.encounterId || encounter.id || '').trim() !== encounterId ||
    String(patient.id || patient.patientId || '').trim() !== patientId
  ) {
    deny(context, 'diagnostic order, encounter and patient lineage do not agree');
  }

  if (
    context.permissions.includes('PATIENT360:READ') ||
    context.permissions.includes('PATIENT360:READ_ALL') ||
    [...roles].some((role) => CLINICAL_RESULT_ROLES.has(role))
  ) {
    assertPatient360PatientAccess(context, patient, encounter);
    return;
  }

  const orderType = String(order.orderType || '').trim().toUpperCase();
  const modalityRoles =
    orderType === 'LAB'
      ? LAB_RESULT_ROLES
      : orderType === 'RADIOLOGY'
        ? RADIOLOGY_RESULT_ROLES
        : new Set<string>();

  if (![...roles].some((role) => modalityRoles.has(role))) {
    deny(context, `role is not authorized for ${orderType || 'unknown'} results`);
  }

  const facilityId = String(
    order.facilityId || encounter.facilityId || ''
  ).trim();
  const facilities = actorFacilities(context);

  if (!facilityId) {
    deny(context, 'diagnostic result is missing server-verifiable facility scope');
  }
  if (facilities.size === 0 || !facilities.has(facilityId)) {
    deny(context, 'diagnostic facility is outside the actor scope');
  }
}
