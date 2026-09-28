/**
 * G-HIMS Master Authentication & Authorization Types
 * Zero-Trust, Server-Authoritative Identity & Access Control System
 */

export type AccountStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DISABLED';

export type UserRoleType = 
  | 'administrator'
  | 'doctor'
  | 'nurse'
  | 'receptionist'
  | 'billing_clerk'
  | 'patient'
  | 'pharmacist'
  | 'lab_tech'
  | 'radiologist'
  | 'surgeon';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName?: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  departmentIds: string[];
  facilityIds: string[];
  accountStatus: AccountStatus;
  credentialStatus?: string;
  clinicalPrivileges?: string[];
  sessionId: string;
  deviceId?: string;
  lastAuthenticatedAt: string;
  isEmergencyOverride?: boolean;
}

export interface TenantMembership {
  userId: string;
  tenantId: string;
  tenantName?: string;
  facilityCode?: string;
  status: AccountStatus;
  roles: string[];
  departmentIds: string[];
  facilityIds: string[];
  permissions: string[];
  clinicalPrivileges: string[];
  licenseId?: string;
  credentialStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSessionRecord {
  sessionId: string;
  userId: string;
  tenantId: string;
  deviceId?: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  lastSeenAt: string;
  authenticatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  ipHash?: string;
  userAgentHash?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
}

export interface UserDeviceRecord {
  deviceId: string;
  userId: string;
  tenantId: string;
  deviceType: 'DESKTOP' | 'TABLET' | 'MOBILE';
  platform: string;
  appVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSyncAt?: string;
  fingerprintHash?: string;
}

export type AuthAuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'SESSION_CREATED'
  | 'SESSION_VALIDATED'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DISABLED'
  | 'DEVICE_REGISTERED'
  | 'BREAK_GLASS_ELEVATED'
  | 'TENANT_SWITCHED'
  | 'USER_PROVISIONED'
  | 'USER_ACCESS_UPDATED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT';

export interface AuthAuditEvent {
  id: string;
  eventType: AuthAuditEventType;
  userId?: string | null;
  userEmail?: string | null;
  tenantId?: string;
  sessionId?: string | null;
  deviceId?: string | null;
  requestId?: string;
  correlationId?: string;
  timestamp: string;
  ipHash?: string | null;
  userAgentHash?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuthorizationContext {
  uid: string;
  email: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  departmentIds: string[];
  facilityIds: string[];
  clinicalPrivileges: string[];
  accountStatus: AccountStatus;
  sessionId: string;
  deviceId?: string;
  isEmergencyOverride?: boolean;
}

export interface LoginResponsePayload {
  authenticated: boolean;
  customToken?: string;
  user: {
    uid: string;
    displayName?: string;
    email: string;
  };
  tenant: {
    tenantId: string;
    name: string;
    facilityCode?: string;
  };
  authorization: {
    roles: string[];
    permissions: string[];
    departmentIds: string[];
    facilityIds: string[];
    clinicalPrivileges: string[];
    accountStatus: AccountStatus;
  };
  session: {
    sessionId: string;
    expiresAt: string;
  };
  accessibleTenants: Array<{
    tenantId: string;
    name: string;
    facilityCode?: string;
    roles: string[];
  }>;
}

export interface TenantSelectionItem {
  tenantId: string;
  name: string;
  facilityCode?: string;
  tier?: string;
  region?: string;
  roles: string[];
  status?: AccountStatus;
  departmentIds?: string[];
  primaryRole?: string;
}

export type AuthStateLoadingStatus = 
  | 'IDLE'
  | 'AUTHENTICATING'
  | 'RESTORING_SESSION'
  | 'RESOLVING_TENANT'
  | 'LOADING_AUTHORIZATION'
  | 'READY'
  | 'LOCKED'
  | 'ERROR';
