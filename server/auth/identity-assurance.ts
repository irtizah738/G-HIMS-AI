import type { DecodedIdToken } from 'firebase-admin/auth';
import type { GhimsRuntimeMode } from '@/lib/runtime/runtime-mode';
import { AuthError } from '@/lib/auth/auth-errors';

const PRIVILEGED_ROLES = new Set([
  'DOCTOR', 'PHYSICIAN', 'SURGEON', 'CONSULTANT', 'NURSE',
  'PHARMACIST', 'RADIOLOGIST', 'LAB_TECH', 'LABTECHNICIAN',
  'ATTENDING_PHYSICIAN', 'MEDICAL_OFFICER', 'MEDICAL_DIRECTOR',
  'ANESTHESIOLOGIST', 'ADMINISTRATOR', 'SYSTEM_ADMIN',
  'FINANCE_MANAGER', 'HR_ADMIN', 'SECURITY_ADMIN',
]);

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
  if (runtime !== 'PRODUCTION') return;
  if (!claims.email || claims.email_verified !== true) {
    throw new AuthError({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'Production identity has no verified email claim.',
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
  if (runtime !== 'PRODUCTION') return;
  if (!roles.some((role) => PRIVILEGED_ROLES.has(String(role).trim().toUpperCase()))) return;
  const firebaseClaims = claims.firebase as { sign_in_second_factor?: unknown } | undefined;
  if (typeof firebaseClaims?.sign_in_second_factor !== 'string' ||
      !firebaseClaims.sign_in_second_factor.trim()) {
    throw new AuthError({
      code: 'MFA_REQUIRED',
      message: 'Privileged clinical/administrative production session requires verified MFA.',
      statusCode: 403,
      userMessage: 'Complete multifactor authentication through your hospital identity provider.',
    });
  }
}
