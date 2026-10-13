import type { DecodedIdToken } from 'firebase-admin/auth';
import type { GhimsRuntimeMode } from '@/lib/runtime/runtime-mode';
import { AuthError } from '@/lib/auth/auth-errors';

// Every staff role, including unrecognized legacy role aliases, requires MFA.
// A patient-only identity is governed by separate patient-access policy.
// Avoid a deny-list of role names: "admin", "SuperAdmin", receptionist and
// billing aliases otherwise bypass privileged identity assurance.
function requiresStaffSecondFactor(roles: string[]): boolean {
  return roles.length > 0 &&
    roles.some((role) => String(role || '').trim().toUpperCase() !== 'PATIENT');
}

/**
 * Enforce explicit assurance at the server boundary. Valid Firebase signatures,
 * tenant membership and clinical credentials do not prove a second factor.
 * Firebase MFA claims are issued only for a Firebase-verified second factor.
 * A federated IdP's MFA may be accepted only after implementing independent,
 * audited assurance validation; mere SSO provider membership is not proof.
 */
export function assertVerifiedIdentityAssurance(
  claims: Pick<DecodedIdToken, 'email' | 'email_verified'>,
  runtime: GhimsRuntimeMode
): void {
  if (runtime !== 'STAGING' && runtime !== 'PRODUCTION') return;
  if (!claims.email || claims.email_verified !== true) {
    throw new AuthError({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'Production-like staff identity has no verified email claim.',
      statusCode: 403,
      userMessage: 'Verify your clinical account email with your identity provider before signing in.',
    });
  }
}

export function assertPrivilegedSecondFactor(
  claims: DecodedIdToken,
  roles: string[],
  runtime: GhimsRuntimeMode
): void {
  if (runtime !== 'STAGING' && runtime !== 'PRODUCTION') return;
  if (!requiresStaffSecondFactor(roles)) return;
  const firebaseClaims = claims.firebase as { sign_in_second_factor?: unknown } | undefined;
  if (typeof firebaseClaims?.sign_in_second_factor !== 'string' ||
      !firebaseClaims.sign_in_second_factor.trim()) {
    throw new AuthError({
      code: 'MFA_REQUIRED',
      message: 'Hospital staff session requires verified MFA.',
      statusCode: 403,
      userMessage: 'Complete multifactor authentication through your hospital identity provider.',
    });
  }
}
