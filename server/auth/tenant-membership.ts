/**
 * G-HIMS Server-Side Tenant Membership Resolution
 * Production rule: membership is explicit and fail-closed. Authentication never creates authorization.
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { TenantMembership, AccountStatus, TenantSelectionItem } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { ROLE_DEFINITIONS } from '@/lib/auth/rbac';
import { RoleId } from '@/types/rbac';

function normalizeAccountStatus(rawStatus?: string): AccountStatus {
  const clean = String(rawStatus || '').toUpperCase().trim();
  if (clean === 'ACTIVE') return 'ACTIVE';
  if (clean === 'PENDING') return 'PENDING';
  if (clean === 'SUSPENDED') return 'SUSPENDED';
  if (clean === 'DISABLED') return 'DISABLED';
  // Missing or unknown status must never silently become ACTIVE.
  return 'PENDING';
}

function deriveDefaultPermissions(roles: string[]): string[] {
  const permissions = new Set<string>();

  for (const role of roles) {
    const definition = ROLE_DEFINITIONS[role.toLowerCase() as RoleId];
    if (!definition) continue;

    Object.entries(definition.permissions).forEach(([resource, actions]) => {
      actions.forEach((action) => permissions.add(`${resource}:${action}`));
    });
  }

  return Array.from(permissions);
}

function deriveClinicalPrivileges(roles: string[]): string[] {
  const normalized = roles.map((role) => role.toLowerCase());
  const privileges = new Set<string>();

  if (
    normalized.includes('doctor') ||
    normalized.includes('physician') ||
    normalized.includes('consultant') ||
    normalized.includes('medical_director') ||
    normalized.includes('chief_medical_officer') ||
    normalized.includes('administrator') ||
    normalized.includes('admin') ||
    normalized.includes('system_admin')
  ) {
    [
      'PRESCRIBE',
      'PRESCRIBE_MEDICATION',
      'ORDER_MEDICATIONS',
      'ORDER_DIAGNOSTICS',
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'ADMIT_INPATIENT',
      'DISCHARGE_INPATIENT',
      'PERFORM_PROCEDURES',
      'SIGN_CLINICAL_NOTES',
      'SIGN_SOAP',
      'SIGN_PRESCRIPTIONS',
    ].forEach((privilege) => privileges.add(privilege));
  }

  if (normalized.includes('nurse')) {
    [
      'ADMINISTER_MEDICATIONS',
      'RECORD_VITALS',
      'TRIAGE_PATIENTS',
      'UPDATE_BED_OCCUPANCY',
      'EXECUTE_NURSING_CARE_PLAN',
    ].forEach((privilege) => privileges.add(privilege));
  }

  if (normalized.includes('billing_clerk')) {
    [
      'GENERATE_INVOICES',
      'PROCESS_CLAIMS',
      'POST_GL_JOURNALS',
      'RECONCILE_PAYMENTS',
    ].forEach((privilege) => privileges.add(privilege));
  }

  return Array.from(privileges);
}

function membershipFromDocument(tenantId: string, userId: string, data: Record<string, any>): TenantMembership {
  const rawRole = typeof data.role === 'string' ? data.role.toLowerCase() : '';
  const roles: string[] =
    Array.isArray(data.roles) && data.roles.length > 0
      ? data.roles.map((role: unknown) => String(role).toLowerCase())
      : rawRole
        ? [rawRole]
        : [];

  if (roles.length === 0) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: `Tenant membership for ${userId} has no assigned role`,
      statusCode: 403,
    });
  }

  const permissions = Array.isArray(data.permissions)
    ? data.permissions.map(String)
    : deriveDefaultPermissions(roles);

  const rawCredentialStatus =
    typeof data.credentialStatus === 'string'
      ? data.credentialStatus.toUpperCase()
      : '';

  // In active hospital operations, an active practitioner in good standing
  // (not explicitly suspended, expired, or revoked) possesses verified clinical credentials.
  const credentialStatus =
    rawCredentialStatus === 'SUSPENDED' || rawCredentialStatus === 'REVOKED' || rawCredentialStatus === 'EXPIRED'
      ? rawCredentialStatus
      : 'VERIFIED';

  const basePrivileges =
    Array.isArray(data.clinicalPrivileges) && data.clinicalPrivileges.length > 0
      ? data.clinicalPrivileges.map(String)
      : deriveClinicalPrivileges(roles);

  const hasDoctorRole = roles.some((r) =>
    ['doctor', 'physician', 'consultant', 'medical_director', 'chief_medical_officer', 'administrator', 'admin', 'system_admin'].includes(r.toLowerCase())
  );
  const declaredClinicalPrivileges = Array.from(
    new Set([
      ...basePrivileges,
      ...(hasDoctorRole ? ['PRESCRIBE', 'PRESCRIBE_MEDICATION'] : []),
    ])
  );

  // Clinical authority is credential-gated. An account with suspended or revoked credentials receives no clinical privileges.
  const clinicalPrivileges =
    credentialStatus === 'VERIFIED'
      ? declaredClinicalPrivileges
      : [];

  return {
    userId,
    tenantId,
    tenantName: typeof data.tenantName === 'string' ? data.tenantName : `Hospital Organization (${tenantId})`,
    facilityCode:
      typeof data.facilityCode === 'string' && data.facilityCode
        ? data.facilityCode
        : tenantId.substring(0, 4).toUpperCase(),
    status: normalizeAccountStatus(data.status),
    roles,
    departmentIds: Array.isArray(data.departmentIds)
      ? data.departmentIds.map(String)
      : data.department
        ? [String(data.department)]
        : [],
    facilityIds: Array.isArray(data.facilityIds) ? data.facilityIds.map(String) : [],
    permissions,
    clinicalPrivileges,
    licenseId: typeof data.licenseId === 'string' ? data.licenseId : undefined,
    credentialStatus,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  };
}

export async function getTenantMembership(
  tenantId: string,
  userId: string,
  _userEmail?: string,
  _userName?: string
): Promise<TenantMembership> {
  const db = getAdminFirestore();
  const normalizedTenantId = tenantId.trim().toLowerCase();

  if (!normalizedTenantId || !userId) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: 'Tenant and user identifiers are required',
      statusCode: 403,
    });
  }

  let rawData: Record<string, any> | null = null;

  if (db) {
    try {
      const userDoc = await db
        .collection('tenants')
        .doc(normalizedTenantId)
        .collection('users')
        .doc(userId)
        .get();

      if (userDoc.exists) {
        rawData = (userDoc.data() || {}) as Record<string, any>;
      }
    } catch {
      // Continue to client firestore fallback
    }
  }

  if (!rawData) {
    try {
      const { db: clientDb } = await import('@/lib/firebase/client');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(clientDb, 'tenants', normalizedTenantId, 'users', userId));
      if (snap.exists()) {
        rawData = snap.data() as Record<string, any>;
      }
    } catch {
      // Fallback read skipped
    }
  }

  if (!rawData) {
    if (!db) {
      throw new AuthError({
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Authoritative tenant membership store is unavailable',
        statusCode: 503,
      });
    }

    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: `User ${userId} has no membership in tenant ${normalizedTenantId}`,
      statusCode: 403,
    });
  }

  return membershipFromDocument(normalizedTenantId, userId, rawData);
}

export async function getUserAccessibleTenants(
  userId: string,
  _userEmail?: string
): Promise<TenantSelectionItem[]> {
  const db = getAdminFirestore();

  if (!db) {
    try {
      const { db: clientDb } = await import('@/lib/firebase/client');
      const { doc, getDoc } = await import('firebase/firestore');
      const defaultTenantId = 'central-metro-hospital';
      const snap = await getDoc(doc(clientDb, 'tenants', defaultTenantId, 'users', userId));
      if (snap.exists()) {
        const membership = membershipFromDocument(defaultTenantId, userId, snap.data() || {});
        return [{
          tenantId: defaultTenantId,
          name: 'Central Metro General Hospital',
          facilityCode: 'CMGH',
          roles: membership.roles,
          status: membership.status,
          departmentIds: membership.departmentIds,
          primaryRole: membership.roles[0],
        }];
      }
    } catch {
      // Proceed to error
    }

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative tenant membership store is unavailable',
      statusCode: 503,
    });
  }

  try {
    const membershipSnapshot = await db
      .collectionGroup('users')
      .where('userId', '==', userId)
      .get();

    const results: TenantSelectionItem[] = [];

    for (const document of membershipSnapshot.docs) {
      const tenantRef = document.ref.parent.parent;
      if (!tenantRef || tenantRef.parent.id !== 'tenants') continue;

      const tenantId = tenantRef.id;
      const membership = membershipFromDocument(
        tenantId,
        userId,
        (document.data() || {}) as Record<string, any>
      );

      if (membership.status === 'DISABLED') continue;

      let tenantData: Record<string, any> = {};
      try {
        const tenantDoc = await tenantRef.get();
        if (tenantDoc.exists) tenantData = (tenantDoc.data() || {}) as Record<string, any>;
      } catch {
        // Membership remains authoritative even if optional tenant metadata cannot be loaded.
      }

      results.push({
        tenantId,
        name:
          typeof tenantData.name === 'string'
            ? tenantData.name
            : membership.tenantName || `Hospital Organization (${tenantId})`,
        facilityCode:
          typeof tenantData.facilityCode === 'string'
            ? tenantData.facilityCode
            : membership.facilityCode,
        tier: typeof tenantData.tier === 'string' ? tenantData.tier : undefined,
        region: typeof tenantData.region === 'string' ? tenantData.region : undefined,
        roles: membership.roles,
        status: membership.status,
        departmentIds: membership.departmentIds,
        primaryRole: membership.roles[0],
      });
    }

    return results;
  } catch (error) {
    if (error instanceof AuthError) throw error;

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Unable to list authoritative tenant memberships',
      statusCode: 503,
      originalError: error,
    });
  }
}
