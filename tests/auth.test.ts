/**
 * G-HIMS Master Authentication & Authorization Test Suite
 * Comprehensive Zero-Trust Security & Multi-Tenant Access Verification
 */

import {
  hasPermission,
  hasRole,
  hasClinicalPrivilege,
  isAccountActive,
} from '../lib/auth/auth-guards';
import {
  mapAuthError,
  getDefaultUserMessage,
  AuthError,
} from '../lib/auth/auth-errors';
import {
  AuthenticatedUser,
  AuthorizationContext,
} from '../lib/auth/auth-types';

describe('G-HIMS Production Authentication & Authorization Engine', () => {
  const activeDoctorUser: AuthenticatedUser = {
    uid: 'doc_123',
    email: 's.jenkins@centralmetro.health',
    displayName: 'Dr. Sarah Jenkins',
    tenantId: 'central-metro-hospital',
    roles: ['doctor'],
    permissions: [
      'patient_records:view',
      'patient_records:create',
      'patient_records:update',
      'clinical_notes:view',
      'clinical_notes:create',
      'clinical_notes:update',
      'prescriptions:create',
    ],
    departmentIds: ['cardiology', 'general_medicine'],
    facilityIds: ['main_campus'],
    accountStatus: 'ACTIVE',
    clinicalPrivileges: [
      'ORDER_MEDICATIONS',
      'ORDER_DIAGNOSTICS',
      'SIGN_CLINICAL_NOTES',
      'SIGN_PRESCRIPTIONS',
    ],
    sessionId: 'sess_test_1',
    lastAuthenticatedAt: new Date().toISOString(),
  };

  const adminUser: AuthenticatedUser = {
    uid: 'admin_001',
    email: 'admin@centralmetro.health',
    displayName: 'Hospital Admin',
    tenantId: 'central-metro-hospital',
    roles: ['administrator'],
    permissions: ['*'],
    departmentIds: ['*'],
    facilityIds: ['*'],
    accountStatus: 'ACTIVE',
    clinicalPrivileges: ['*'],
    sessionId: 'sess_test_admin',
    lastAuthenticatedAt: new Date().toISOString(),
  };

  const disabledUser: AuthenticatedUser = {
    ...activeDoctorUser,
    uid: 'disabled_user_99',
    accountStatus: 'DISABLED',
  };

  const suspendedUser: AuthenticatedUser = {
    ...activeDoctorUser,
    uid: 'suspended_user_99',
    accountStatus: 'SUSPENDED',
  };

  const pendingUser: AuthenticatedUser = {
    ...activeDoctorUser,
    uid: 'pending_user_99',
    accountStatus: 'PENDING',
  };

  describe('1. Account Status Enforcement (Zero-Trust Guard)', () => {
    test('isAccountActive returns true only for ACTIVE accounts', () => {
      expect(isAccountActive('ACTIVE')).toBe(true);
      expect(isAccountActive('PENDING')).toBe(false);
      expect(isAccountActive('SUSPENDED')).toBe(false);
      expect(isAccountActive('DISABLED')).toBe(false);
      expect(isAccountActive(undefined)).toBe(false);
    });

    test('Disabled accounts are strictly blocked from all permissions & roles', () => {
      expect(hasPermission(disabledUser, 'patient_records:view')).toBe(false);
      expect(hasRole(disabledUser, 'doctor')).toBe(false);
      expect(hasClinicalPrivilege(disabledUser, 'ORDER_MEDICATIONS')).toBe(false);
    });

    test('Suspended accounts are blocked from clinical privileges', () => {
      expect(hasPermission(suspendedUser, 'patient_records:view')).toBe(false);
      expect(hasClinicalPrivilege(suspendedUser, 'ORDER_MEDICATIONS')).toBe(false);
    });

    test('Pending accounts cannot execute medical operations', () => {
      expect(hasPermission(pendingUser, 'clinical_notes:create')).toBe(false);
      expect(hasClinicalPrivilege(pendingUser, 'SIGN_PRESCRIPTIONS')).toBe(false);
    });
  });

  describe('2. Role-Based Access Control (RBAC)', () => {
    test('Administrator role possesses universal wildcards', () => {
      expect(hasRole(adminUser, 'doctor')).toBe(true);
      expect(hasRole(adminUser, 'administrator')).toBe(true);
      expect(hasPermission(adminUser, 'erp_gl:admin')).toBe(true);
      expect(hasClinicalPrivilege(adminUser, 'PERFORM_SURGERY')).toBe(true);
    });

    test('Doctor role has diagnostic and prescribing permissions', () => {
      expect(hasRole(activeDoctorUser, 'doctor')).toBe(true);
      expect(hasRole(activeDoctorUser, 'billing_clerk')).toBe(false);
      expect(hasPermission(activeDoctorUser, 'clinical_notes:create')).toBe(true);
      expect(hasPermission(activeDoctorUser, 'erp_gl:admin')).toBe(false);
    });
  });

  describe('3. Clinical Privilege Gating', () => {
    test('Doctor has authorized medication & prescription signing privileges', () => {
      expect(hasClinicalPrivilege(activeDoctorUser, 'ORDER_MEDICATIONS')).toBe(true);
      expect(hasClinicalPrivilege(activeDoctorUser, 'SIGN_PRESCRIPTIONS')).toBe(true);
      expect(hasClinicalPrivilege(activeDoctorUser, 'POST_GL_JOURNAL')).toBe(false);
    });

    test('Emergency override grants clinical privilege bypass', () => {
      const emergencyContext: AuthorizationContext = {
        ...activeDoctorUser,
        isEmergencyOverride: true,
      };
      expect(hasClinicalPrivilege(emergencyContext, 'PERFORM_UNLISTED_EMERGENCY_PROCEDURE')).toBe(true);
    });
  });

  describe('4. Error Mapping & Anti-Enumeration Protection', () => {
    test('Firebase wrong password maps to sanitised INVALID_CREDENTIALS', () => {
      const mapped = mapAuthError({ code: 'auth/wrong-password', message: 'Wrong password' });
      expect(mapped.code).toBe('INVALID_CREDENTIALS');
      expect(mapped.statusCode).toBe(401);
      expect(mapped.userMessage).toContain('email or password entered is incorrect');
    });

    test('Firebase user not found maps to generic INVALID_CREDENTIALS to prevent email enumeration', () => {
      const mapped = mapAuthError({ code: 'auth/user-not-found', message: 'User not found' });
      expect(mapped.code).toBe('INVALID_CREDENTIALS');
      expect(mapped.userMessage).toContain('email or password entered is incorrect');
    });

    test('User disabled maps to ACCOUNT_DISABLED with IT contact guidance', () => {
      const mapped = mapAuthError({ code: 'auth/user-disabled', message: 'User is disabled' });
      expect(mapped.code).toBe('ACCOUNT_DISABLED');
      expect(mapped.statusCode).toBe(403);
      expect(mapped.userMessage).toContain('Hospital IT Security Officer');
    });

    test('Rate limit maps to RATE_LIMITED', () => {
      const mapped = mapAuthError({ code: 'auth/too-many-requests', message: 'Too many attempts' });
      expect(mapped.code).toBe('RATE_LIMITED');
      expect(mapped.statusCode).toBe(429);
    });

    test('Network error maps to NETWORK_UNAVAILABLE for offline fallback', () => {
      const mapped = mapAuthError(new Error('Failed to fetch'));
      expect(mapped.code).toBe('NETWORK_UNAVAILABLE');
      expect(mapped.statusCode).toBe(503);
    });
  });
});
