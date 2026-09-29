import type { CommandContext } from '@/lib/backend/types';
import { AuthError } from '@/lib/auth/auth-errors';

const FULL_CHART_ROLES = new Set([
  'ADMIN',
  'ADMINISTRATOR',
  'SYSTEM_ADMIN',
  'DOCTOR',
  'NURSE',
  'PHARMACIST',
  'LAB_TECH',
  'LAB_TECHNICIAN',
  'RADIOLOGIST',
  'SURGEON',
]);

export function assertPatient360ReadAccess(context: CommandContext): void {
  const authorized =
    context.permissions.includes('*') ||
    context.permissions.includes('PATIENT360:READ') ||
    context.roles.some((role) => FULL_CHART_ROLES.has(role.toUpperCase()));

  if (!authorized) {
    throw new AuthError({
      code: 'AUTHORIZATION_REQUIRED',
      message: `Actor '${context.actorId}' lacks Patient 360 chart-read authority.`,
      statusCode: 403,
      userMessage: 'You do not have permission to open the complete patient chart.',
    });
  }
}
