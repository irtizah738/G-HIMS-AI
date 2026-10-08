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

  if (normalized.includes('doctor') || normalized.includes('physician')) {
    [
      'ORDER_MEDICATIONS',
      'ORDER_DIAGNOSTICS',
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'ADMIT_INPATIENT',
      'DISCHARGE_INPATIENT',
      'PERFORM_PROCEDURES',
      'SIGN_CLINICAL_NOTES',
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


function normalizeFacilityIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

/**
 * Resolve staff facility scope without trusting the client.
 *
 * Authority order:
 * 1. Explicit membership facilityIds (preferred).
 * 2. Explicit single-facility tenant metadata (primary/default/facilityId).
 * 3. Exactly one ACTIVE canonical facility document.
 * 4. Legacy single-facility tenant facilityCode only when no canonical
 *    facility documents exist and the tenant is not declared multi-facility.
 *
 * Ambiguous multi-facility tenants always fail closed with an empty scope.
 */
async function resolveAuthoritativeFacilityIds(params: {
  db: NonNullable<ReturnType<typeof getAdminFirestore>>;
  tenantId: string;
  membershipFacilityIds: string[];
}): Promise<string[]> {
  const explicit = normalizeFacilityIds(params.membershipFacilityIds);
  if (explicit.length > 0) return explicit;

  const tenantRef = params.db.collection('tenants').doc(params.tenantId);
  const tenantDoc = await tenantRef.get();
  if (!tenantDoc.exists) {
    const runtimeMode = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
    if (runtimeMode === 'TEST' || runtimeMode === 'DEMO') {
      // Firestore permits subcollection membership documents without a parent
      // document. Test/demo fixtures use this shape; never extend it to
      // staging/production where tenant metadata must exist.
      return [params.tenantId];
    }

    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: `Tenant ${params.tenantId} does not exist`,
      statusCode: 403,
    });
  }

  const tenantData = (tenantDoc.data() || {}) as Record<string, unknown>;
  const explicitTenantFacilityId = [
    tenantData.primaryFacilityId,
    tenantData.defaultFacilityId,
    tenantData.facilityId,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean);

  if (explicitTenantFacilityId) {
    return [explicitTenantFacilityId];
  }

  const activeFacilities = await tenantRef
    .collection('facilities')
    .where('status', '==', 'ACTIVE')
    .limit(2)
    .get();

  if (activeFacilities.size === 1) {
    return [activeFacilities.docs[0].id];
  }

  if (activeFacilities.size > 1) {
    return [];
  }

  // Compatibility for existing single-facility tenants that pre-date the
  // canonical facilities subcollection. Never apply this to an explicitly
  // multi-facility tenant and never apply it when facility documents exist.
  const facilityProbe = await tenantRef.collection('facilities').limit(2).get();
  const facilityMode = String(tenantData.facilityMode || '').trim().toUpperCase();
  const multiFacility =
    tenantData.multiFacility === true ||
    facilityMode === 'MULTI' ||
    facilityMode === 'MULTI_FACILITY';

  const legacyFacilityCode =
    typeof tenantData.facilityCode === 'string'
      ? tenantData.facilityCode.trim()
      : '';

  if (!multiFacility && facilityProbe.empty) {
    // Legacy G-HIMS deployments modeled one hospital directly as one tenant.
    // Using the tenant id here does not elevate cross-tenant access: membership
    // in this exact tenant has already been verified server-side.
    return [legacyFacilityCode || params.tenantId];
  }

  return [];
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

  const credentialStatus =
    typeof data.credentialStatus === 'string'
      ? data.credentialStatus.toUpperCase()
      : 'UNVERIFIED';

  const declaredClinicalPrivileges = Array.isArray(data.clinicalPrivileges)
    ? data.clinicalPrivileges.map(String)
    : deriveClinicalPrivileges(roles);

  // Clinical authority is credential-gated. An ACTIVE account with an unverified
  // or expired credential may retain non-clinical access but receives no clinical privileges.
  const clinicalPrivileges =
    credentialStatus === 'VERIFIED'
      ? declaredClinicalPrivileges
      : [];

  const rawFinancialAuthority = Number(data.financialAuthorityMinorUnits);
  const financialAuthorityMinorUnits =
    Number.isSafeInteger(rawFinancialAuthority) && rawFinancialAuthority >= 0
      ? rawFinancialAuthority
      : undefined;

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
    facilityIds: normalizeFacilityIds(data.facilityIds),
    permissions,
    financialAuthorityMinorUnits,
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

  if (!db) {
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative tenant membership store is unavailable',
      statusCode: 503,
    });
  }

  let rawData: Record<string, any> | null = null;
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
  } catch (error) {
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Unable to read authoritative tenant membership',
      statusCode: 503,
      originalError: error,
    });
  }

  if (!rawData) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: `User ${userId} has no membership in tenant ${normalizedTenantId}`,
      statusCode: 403,
    });
  }

  const membership = membershipFromDocument(normalizedTenantId, userId, rawData);
  membership.facilityIds = await resolveAuthoritativeFacilityIds({
    db,
    tenantId: normalizedTenantId,
    membershipFacilityIds: membership.facilityIds,
  });

  return membership;
}

export async function getUserAccessibleTenants(
  userId: string,
  _userEmail?: string
): Promise<TenantSelectionItem[]> {
  const db = getAdminFirestore();

  if (!db) {
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
