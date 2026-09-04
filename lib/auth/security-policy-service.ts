import { db, auth } from '@/lib/firebase/client';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit/logger';

export type MFAEnforcementLevel =
  | 'OPTIONAL'
  | 'REQUIRED_ALL_STAFF'
  | 'REQUIRED_CLINICAL_ROLES'
  | 'REQUIRED_ADMINS_ONLY';

export type MFAMethod =
  | 'TOTP_AUTHENTICATOR'
  | 'SMS_EMAIL_OTP'
  | 'FIDO2_WEBAUTHN'
  | 'BIOMETRIC_PASSKEY';

export interface SecurityPolicyConfig {
  id: string;
  tenantId: string;
  // Password Complexity Requirements
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSymbols: boolean;
  maxPasswordAgeDays: number;
  preventReuseCount: number;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;

  // Session Timeout Durations & Inactivity Locks
  idleTimeoutMinutes: number;
  absoluteSessionTimeoutHours: number;
  maxConcurrentSessions: number;
  rememberDeviceDays: number;

  // Multi-Factor Authentication (MFA) Enforcement
  mfaEnforcementLevel: MFAEnforcementLevel;
  allowedMfaMethods: MFAMethod[];
  mfaGracePeriodDays: number;
  allowRememberMfaDevice: boolean;
  rememberMfaDays: number;

  // Network & Emergency Override
  enforceIpWhitelist: boolean;
  ipWhitelist: string[];
  breakGlassMode: boolean;

  // Metadata
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicyConfig = {
  id: 'security_policy',
  tenantId: 'central-metro-hospital',
  // Complexity Requirements
  minPasswordLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  maxPasswordAgeDays: 90,
  preventReuseCount: 5,
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 30,

  // Session Timeouts
  idleTimeoutMinutes: 15,
  absoluteSessionTimeoutHours: 12,
  maxConcurrentSessions: 3,
  rememberDeviceDays: 14,

  // MFA Enforcement
  mfaEnforcementLevel: 'REQUIRED_ALL_STAFF',
  allowedMfaMethods: ['TOTP_AUTHENTICATOR', 'FIDO2_WEBAUTHN', 'BIOMETRIC_PASSKEY'],
  mfaGracePeriodDays: 7,
  allowRememberMfaDevice: true,
  rememberMfaDays: 14,

  // Network & Emergency
  enforceIpWhitelist: false,
  ipWhitelist: ['192.168.1.0/24', '10.0.0.0/16', '172.16.4.0/24'],
  breakGlassMode: false,

  updatedAt: '2026-02-15T08:00:00.000Z',
  updatedBy: 'Chief Information Security Officer (CISO)',
};

const SECURITY_POLICY_STORAGE_KEY_PREFIX = 'ghims_security_policy_';

/**
 * Retrieves the active security policy for a tenant (Firestore with LocalStorage fallback)
 */
export async function getSecurityPolicy(tenantId: string): Promise<SecurityPolicyConfig> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  // 1. Try Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const docRef = doc(db, 'tenants', cleanTenant, 'config', 'security_policy');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as SecurityPolicyConfig;
        savePolicyToLocalStorage(cleanTenant, data);
        return data;
      }
    }
  } catch (err) {
    console.warn('Could not load security policy from Firestore, falling back to cache:', err);
  }

  // 2. Try LocalStorage
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${SECURITY_POLICY_STORAGE_KEY_PREFIX}${cleanTenant}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_SECURITY_POLICY, ...parsed, tenantId: cleanTenant };
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Return defaults
  const seed = { ...DEFAULT_SECURITY_POLICY, tenantId: cleanTenant };
  savePolicyToLocalStorage(cleanTenant, seed);
  return seed;
}

/**
 * Persists the updated security policy to Firestore and LocalStorage
 */
export async function saveSecurityPolicy(
  tenantId: string,
  policy: Partial<SecurityPolicyConfig>
): Promise<SecurityPolicyConfig> {
  const cleanTenant = tenantId || 'central-metro-hospital';
  const currentUser = auth.currentUser;

  const currentPolicy = await getSecurityPolicy(cleanTenant);
  const updatedPolicy: SecurityPolicyConfig = {
    ...currentPolicy,
    ...policy,
    id: 'security_policy',
    tenantId: cleanTenant,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser?.displayName || currentUser?.email || 'Hospital CISO / Admin',
  };

  // 1. Save to LocalStorage immediately
  savePolicyToLocalStorage(cleanTenant, updatedPolicy);

  // 2. Persist to Firestore
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const docRef = doc(db, 'tenants', cleanTenant, 'config', 'security_policy');
      await setDoc(docRef, updatedPolicy, { merge: true });
    }
  } catch (err) {
    console.warn('Notice: Failed to sync security policy to Firestore:', err);
  }

  // 3. Immutable audit log entry
  logAuditEvent({
    tenantId: cleanTenant,
    action: 'UPDATE',
    resource: `config/security_policy`,
    details: `Updated password complexity & session timeout policies (Min Length: ${updatedPolicy.minPasswordLength}, Idle Lock: ${updatedPolicy.idleTimeoutMinutes}m, MFA: ${updatedPolicy.mfaEnforcementLevel})`,
    severity: 'WARNING',
  }).catch(() => {});

  return updatedPolicy;
}

function savePolicyToLocalStorage(tenantId: string, policy: SecurityPolicyConfig) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${SECURITY_POLICY_STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(policy));
    } catch {
      // ignore
    }
  }
}

/**
 * Validates a candidate password against the tenant security policy
 */
export function validatePasswordAgainstPolicy(
  password: string,
  policy: SecurityPolicyConfig
): {
  valid: boolean;
  errors: string[];
  score: number;
  checks: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    numbers: boolean;
    symbols: boolean;
  };
} {
  const errors: string[] = [];
  const checks = {
    length: (password?.length || 0) >= (policy.minPasswordLength || 8),
    uppercase: !policy.requireUppercase || /[A-Z]/.test(password || ''),
    lowercase: !policy.requireLowercase || /[a-z]/.test(password || ''),
    numbers: !policy.requireNumbers || /[0-9]/.test(password || ''),
    symbols: !policy.requireSymbols || /[^A-Za-z0-9]/.test(password || ''),
  };

  if (!checks.length) {
    errors.push(`Must be at least ${policy.minPasswordLength} characters long`);
  }
  if (!checks.uppercase) {
    errors.push('Must contain at least 1 uppercase letter');
  }
  if (!checks.lowercase) {
    errors.push('Must contain at least 1 lowercase letter');
  }
  if (!checks.numbers) {
    errors.push('Must contain at least 1 numeric digit');
  }
  if (!checks.symbols) {
    errors.push('Must contain at least 1 special character (!@#$%^&*...)');
  }

  let passedCount = 0;
  if (checks.length) passedCount++;
  if (checks.uppercase) passedCount++;
  if (checks.lowercase) passedCount++;
  if (checks.numbers) passedCount++;
  if (checks.symbols) passedCount++;

  const score = Math.round((passedCount / 5) * 100);

  return {
    valid: errors.length === 0,
    errors,
    score,
    checks,
  };
}
