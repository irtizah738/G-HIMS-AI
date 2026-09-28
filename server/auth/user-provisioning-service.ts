import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import { ROLE_DEFINITIONS } from '@/lib/auth/rbac';
import type { RoleId } from '@/types/rbac';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';

export type ProvisionableUiRole =
  | 'admin'
  | 'doctor'
  | 'nurse'
  | 'reception'
  | 'billing'
  | 'pharmacy'
  | 'lab';

export interface ProvisionUserInput {
  tenantId: string;
  email: string;
  displayName: string;
  role: ProvisionableUiRole;
  department?: string;
  licenseId?: string;
  assignedWards?: string[];
}

export interface UpdateTenantUserInput {
  tenantId: string;
  userId: string;
  status?: 'active' | 'disabled';
  role?: ProvisionableUiRole;
  department?: string;
  licenseId?: string;
  assignedWards?: string[];
}

const UI_TO_CANONICAL_ROLE: Record<ProvisionableUiRole, string> = {
  admin: 'administrator',
  doctor: 'doctor',
  nurse: 'nurse',
  reception: 'receptionist',
  billing: 'billing_clerk',
  pharmacy: 'pharmacist',
  lab: 'lab_tech',
};

const CANONICAL_TO_UI_ROLE: Record<string, ProvisionableUiRole> = {
  administrator: 'admin',
  admin: 'admin',
  doctor: 'doctor',
  nurse: 'nurse',
  receptionist: 'reception',
  reception: 'reception',
  billing_clerk: 'billing',
  billing_staff: 'billing',
  pharmacist: 'pharmacy',
  pharmacy: 'pharmacy',
  lab_tech: 'lab',
  lab: 'lab',
};

function cleanTenantId(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function cleanEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function cleanRole(value: unknown): ProvisionableUiRole {
  const role = String(value || '').trim().toLowerCase() as ProvisionableUiRole;
  if (!Object.prototype.hasOwnProperty.call(UI_TO_CANONICAL_ROLE, role)) {
    throw new Error('IAM_ROLE_INVALID: unsupported staff role.');
  }
  return role;
}

function derivePermissions(canonicalRole: string): string[] {
  const definition = ROLE_DEFINITIONS[canonicalRole as RoleId];
  if (!definition) return [];

  const permissions = new Set<string>();
  for (const [resource, actions] of Object.entries(definition.permissions)) {
    for (const action of actions) {
      permissions.add(`${resource}:${action}`);
    }
  }
  return Array.from(permissions);
}

function deriveClinicalPrivileges(canonicalRole: string): string[] {
  if (canonicalRole === 'doctor') {
    return [
      'ORDER_MEDICATIONS',
      'ORDER_DIAGNOSTICS',
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'ADMIT_INPATIENT',
      'DISCHARGE_INPATIENT',
      'PERFORM_PROCEDURES',
      'SIGN_CLINICAL_NOTES',
      'SIGN_PRESCRIPTIONS',
    ];
  }

  if (canonicalRole === 'nurse') {
    return [
      'ADMINISTER_MEDICATIONS',
      'RECORD_VITALS',
      'TRIAGE_PATIENTS',
      'UPDATE_BED_OCCUPANCY',
      'EXECUTE_NURSING_CARE_PLAN',
    ];
  }

  if (canonicalRole === 'billing_clerk') {
    return [
      'GENERATE_INVOICES',
      'PROCESS_CLAIMS',
      'POST_GL_JOURNALS',
      'RECONCILE_PAYMENTS',
    ];
  }

  return [];
}

function toUiUser(tenantId: string, userId: string, data: Record<string, any>) {
  const canonicalRole =
    Array.isArray(data.roles) && data.roles.length > 0
      ? String(data.roles[0]).toLowerCase()
      : String(data.role || '').toLowerCase();

  return {
    userId,
    tenantId,
    email: String(data.email || ''),
    displayName: String(data.displayName || data.name || data.email || userId),
    role: CANONICAL_TO_UI_ROLE[canonicalRole] || 'doctor',
    department: typeof data.department === 'string'
      ? data.department
      : Array.isArray(data.departmentIds)
        ? String(data.departmentIds[0] || '')
        : '',
    licenseId: typeof data.licenseId === 'string' ? data.licenseId : undefined,
    assignedWards: Array.isArray(data.assignedWards) ? data.assignedWards.map(String) : [],
    status: String(data.status || '').toUpperCase() === 'DISABLED' ? 'disabled' : 'active',
    lastLoginAt: typeof data.lastLoginAt === 'string' ? data.lastLoginAt : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    credentialStatus: typeof data.credentialStatus === 'string' ? data.credentialStatus : 'UNVERIFIED',
  };
}

export class UserProvisioningService {
  public static async listTenantUsers(tenantIdInput: string) {
    const tenantId = cleanTenantId(tenantIdInput);
    const db = getAdminFirestore();
    if (!db) throw new Error('IAM_STORE_UNAVAILABLE');

    const snapshot = await db.collection('tenants').doc(tenantId).collection('users').get();
    return snapshot.docs
      .map((document) => toUiUser(tenantId, document.id, document.data()))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  public static async provision(input: ProvisionUserInput) {
    const tenantId = cleanTenantId(input.tenantId);
    const email = cleanEmail(input.email);
    const displayName = String(input.displayName || '').trim();
    const uiRole = cleanRole(input.role);

    if (!tenantId || !email.includes('@') || !displayName) {
      throw new Error('IAM_PROVISION_INPUT_INVALID');
    }

    const auth = getAdminAuth();
    const db = getAdminFirestore();
    if (!auth || !db) throw new Error('IAM_ADMIN_UNAVAILABLE');

    let identity;
    let identityCreated = false;
    try {
      identity = await auth.getUserByEmail(email);
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
      identity = await auth.createUser({
        email,
        displayName,
        emailVerified: false,
        disabled: false,
      });
      identityCreated = true;
    }

    const membershipRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(identity.uid);

    const existing = await membershipRef.get();
    if (existing.exists) {
      throw new Error('IAM_MEMBERSHIP_EXISTS');
    }

    const canonicalRole = UI_TO_CANONICAL_ROLE[uiRole];
    const now = new Date().toISOString();
    const department = String(input.department || '').trim();
    const assignedWards = Array.isArray(input.assignedWards)
      ? input.assignedWards.map(String).map((value) => value.trim()).filter(Boolean)
      : [];

    const membership = {
      userId: identity.uid,
      tenantId,
      email,
      displayName,
      role: canonicalRole,
      roles: [canonicalRole],
      status: 'ACTIVE',
      department,
      departmentIds: department ? [department] : [],
      facilityIds: [],
      licenseId: String(input.licenseId || '').trim() || undefined,
      assignedWards,
      permissions: derivePermissions(canonicalRole),
      clinicalPrivileges: deriveClinicalPrivileges(canonicalRole),
      // Clinical privileges are removed at authorization time until credentials
      // are explicitly verified by the hospital credentialing workflow.
      credentialStatus:
        canonicalRole === 'doctor' || canonicalRole === 'nurse'
          ? 'UNVERIFIED'
          : 'VERIFIED',
      createdAt: now,
      updatedAt: now,
    };

    await membershipRef.create(sanitizeForFirestore(membership));

    return {
      user: toUiUser(tenantId, identity.uid, membership),
      identityCreated,
      passwordSetupRequired: identityCreated,
    };
  }

  public static async update(input: UpdateTenantUserInput) {
    const tenantId = cleanTenantId(input.tenantId);
    const userId = String(input.userId || '').trim();
    if (!tenantId || !userId) throw new Error('IAM_UPDATE_INPUT_INVALID');

    const db = getAdminFirestore();
    if (!db) throw new Error('IAM_STORE_UNAVAILABLE');

    const membershipRef = db.collection('tenants').doc(tenantId).collection('users').doc(userId);
    const existing = await membershipRef.get();
    if (!existing.exists) throw new Error('IAM_MEMBERSHIP_NOT_FOUND');

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (input.status) {
      patch.status = input.status === 'disabled' ? 'DISABLED' : 'ACTIVE';
    }

    if (input.role) {
      const uiRole = cleanRole(input.role);
      const canonicalRole = UI_TO_CANONICAL_ROLE[uiRole];
      patch.role = canonicalRole;
      patch.roles = [canonicalRole];
      patch.permissions = derivePermissions(canonicalRole);
      patch.clinicalPrivileges = deriveClinicalPrivileges(canonicalRole);
      patch.credentialStatus =
        canonicalRole === 'doctor' || canonicalRole === 'nurse'
          ? 'UNVERIFIED'
          : 'VERIFIED';
    }

    if (input.department !== undefined) {
      const department = String(input.department || '').trim();
      patch.department = department;
      patch.departmentIds = department ? [department] : [];
    }
    if (input.licenseId !== undefined) {
      patch.licenseId = String(input.licenseId || '').trim();
    }
    if (input.assignedWards !== undefined) {
      patch.assignedWards = input.assignedWards.map(String).map((value) => value.trim()).filter(Boolean);
    }

    await membershipRef.set(sanitizeForFirestore(patch), { merge: true });
    const updated = await membershipRef.get();
    return toUiUser(tenantId, userId, updated.data() || {});
  }
}
