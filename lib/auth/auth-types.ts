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
  financialAuthorityMinorUnits?: number;
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
  financialAuthorityMinorUnits?: number;
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
  | 'BREAK_GLASS_REVIEWED'
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
  financialAuthorityMinorUnits?: number;
  departmentIds: string[];
  facilityIds: string[];
  clinicalPrivileges: string[];
  accountStatus: AccountStatus;
  sessionId: string;
  deviceId?: string;
  isEmergencyOverride?: boolean;
}

export interface OfflineCaptureCapabilityLease {
  leaseId: string;
  tenantId: string;
  actorId: string;
  deviceId: string;
  allowedCommandTypes: string[];
  facilityIds: string[];
  departmentIds: string[];
  clinicalPrivileges: string[];
  issuedAt: string;
  expiresAt: string;
  policyVersion: 1;
  captureOnly: true;
  replayRequiresOnlineReauthorization: true;
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
    financialAuthorityMinorUnits?: number;
    departmentIds: string[];
    facilityIds: string[];
    clinicalPrivileges: string[];
    accountStatus: AccountStatus;
  };
  session: {
    sessionId: string;
    expiresAt: string;
    deviceId?: string;
  };
  offlineCapability?: OfflineCaptureCapabilityLease;
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
  /**
   * ORC-1A: Active tenant switch in progress. All new tenant-scoped commands
   * must be suspended until the state advances to VERIFYING or ERROR.
   * The prior tenant's subscriptions are invalidated at this point.
   */
  | 'SWITCHING'
  /**
   * ORC-1A: New authenticated tenant context received; verifying server-side
   * authorization before publishing the new active tenant to child views.
   */
  | 'VERIFYING'
  | 'LOADING_AUTHORIZATION'
  | 'READY'
  | 'LOCKED'
  | 'ERROR';
