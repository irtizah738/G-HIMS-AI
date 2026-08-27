/**
 * G-HIMS Master Auth Client
 * Safe abstraction over Firebase Authentication + Backend Authoritative Session Orchestration
 */

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  onIdTokenChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import {
  AuthenticatedUser,
  LoginResponsePayload,
  TenantSelectionItem,
  UserSessionRecord,
} from './auth-types';
import { AuthError, mapAuthError } from './auth-errors';
import { generateDeviceMetadata } from './auth-session';
import {
  saveCachedAuthSession,
  clearCachedAuthSession,
  getCachedAuthSession,
} from '@/lib/offline/auth-storage';

export interface SignInOptions {
  tenantId?: string;
  rememberDevice?: boolean;
}

export class AuthClient {
  /**
   * Primary Sign In: Authenticates against Firebase Auth, then establishes server-authoritative session
   */
  public static async signIn(
    email: string,
    pass: string,
    options?: SignInOptions
  ): Promise<LoginResponsePayload> {
    try {
      // 1. Firebase Authentication credential verification
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), pass);
      const firebaseUser = userCredential.user;

      // 2. Fetch freshly minted ID token
      const idToken = await firebaseUser.getIdToken(true);

      // 3. Collect device metadata
      const deviceMeta = generateDeviceMetadata();

      // 4. Authoritative backend session establishment
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tenantId: options?.tenantId,
          device: deviceMeta,
          rememberDevice: options?.rememberDevice ?? true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Sign out of Firebase if server-side authorization fails
        await firebaseSignOut(auth).catch(() => {});
        throw new AuthError({
          code: data.code || 'AUTHORIZATION_REQUIRED',
          message: data.error || 'Server authorization failed',
          statusCode: response.status,
          userMessage: data.userMessage || data.error,
        });
      }

      const loginPayload: LoginResponsePayload = data;

      // 5. Build and cache authenticated session locally for offline resilience
      const authUser: AuthenticatedUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || email,
        displayName: firebaseUser.displayName || loginPayload.user.displayName,
        tenantId: loginPayload.tenant.tenantId,
        roles: loginPayload.authorization.roles,
        permissions: loginPayload.authorization.permissions,
        departmentIds: loginPayload.authorization.departmentIds,
        facilityIds: loginPayload.authorization.facilityIds,
        accountStatus: loginPayload.authorization.accountStatus,
        clinicalPrivileges: loginPayload.authorization.clinicalPrivileges,
        sessionId: loginPayload.session.sessionId,
        deviceId: deviceMeta.deviceId,
        lastAuthenticatedAt: new Date().toISOString(),
      };

      const sessionRecord: UserSessionRecord = {
        sessionId: loginPayload.session.sessionId,
        userId: firebaseUser.uid,
        tenantId: loginPayload.tenant.tenantId,
        deviceId: deviceMeta.deviceId,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        authenticatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: loginPayload.session.expiresAt,
      };

      await saveCachedAuthSession(authUser, sessionRecord);

      return loginPayload;
    } catch (err) {
      throw mapAuthError(err);
    }
  }

  /**
   * Validate or Restore current session from server or offline cache
   */
  public static async validateCurrentSession(): Promise<LoginResponsePayload | null> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        // Try reading cached session for offline mode
        const cached = await getCachedAuthSession();
        if (cached) {
          return {
            authenticated: true,
            user: {
              uid: cached.user.uid,
              displayName: cached.user.displayName,
              email: cached.user.email,
            },
            tenant: {
              tenantId: cached.user.tenantId,
              name: 'Hospital Facility (Offline Mode)',
            },
            authorization: {
              roles: cached.user.roles,
              permissions: cached.user.permissions,
              departmentIds: cached.user.departmentIds,
              facilityIds: cached.user.facilityIds,
              clinicalPrivileges: cached.user.clinicalPrivileges || [],
              accountStatus: cached.user.accountStatus,
            },
            session: {
              sessionId: cached.session.sessionId,
              expiresAt: cached.session.expiresAt,
            },
            accessibleTenants: [
              {
                tenantId: cached.user.tenantId,
                name: 'Cached Facility',
                roles: cached.user.roles,
              },
            ],
          };
        }
        return null;
      }

      const idToken = await currentUser.getIdToken(false);
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await this.signOut();
        }
        return null;
      }

      const payload: LoginResponsePayload = await response.json();
      return payload;
    } catch (err) {
      // Fallback to offline cache on network error
      const cached = await getCachedAuthSession();
      if (cached) {
        return {
          authenticated: true,
          user: {
            uid: cached.user.uid,
            displayName: cached.user.displayName,
            email: cached.user.email,
          },
          tenant: {
            tenantId: cached.user.tenantId,
            name: 'Hospital Facility (Offline Mode)',
          },
          authorization: {
            roles: cached.user.roles,
            permissions: cached.user.permissions,
            departmentIds: cached.user.departmentIds,
            facilityIds: cached.user.facilityIds,
            clinicalPrivileges: cached.user.clinicalPrivileges || [],
            accountStatus: cached.user.accountStatus,
          },
          session: {
            sessionId: cached.session.sessionId,
            expiresAt: cached.session.expiresAt,
          },
          accessibleTenants: [
            {
              tenantId: cached.user.tenantId,
              name: 'Cached Facility',
              roles: cached.user.roles,
            },
          ],
        };
      }
      return null;
    }
  }

  /**
   * Terminate Active Session
   */
  public static async signOut(sessionId?: string): Promise<void> {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken().catch(() => null);
        if (idToken) {
          await fetch('/api/auth/session', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ sessionId }),
          }).catch(() => {});
        }
      }
    } finally {
      await clearCachedAuthSession();
      await firebaseSignOut(auth).catch(() => {});
    }
  }

  /**
   * Request Password Reset Instructions
   */
  public static async sendPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    try {
      // Server-side password reset request with audit logging
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();
      return {
        success: true,
        message: data.message || 'If an account exists for this email, password-reset instructions have been sent.',
      };
    } catch {
      // Return identical generic success message to prevent user enumeration
      return {
        success: true,
        message: 'If an account exists for this email, password-reset instructions have been sent.',
      };
    }
  }

  /**
   * Switch Active Tenant Context
   */
  public static async switchTenant(targetTenantId: string): Promise<LoginResponsePayload> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new AuthError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Must be authenticated to switch tenant',
        statusCode: 401,
      });
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await fetch('/api/auth/tenant-selection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ tenantId: targetTenantId }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new AuthError({
        code: data.code || 'TENANT_ACCESS_DENIED',
        message: data.error || 'Failed to switch tenant',
        statusCode: response.status,
      });
    }

    return data;
  }

  /**
   * Fetch list of authorized tenants for the current user
   */
  public static async getAccessibleTenants(): Promise<TenantSelectionItem[]> {
    const currentUser = auth.currentUser;
    if (!currentUser) return [];

    const idToken = await currentUser.getIdToken(false);
    const response = await fetch('/api/auth/tenant-selection', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) return [];
    const data = await response.json();
    return data.tenants || [];
  }

  /**
   * Subscribe to ID token changes & automatic token refresher
   */
  public static subscribeToAuthState(callback: (user: FirebaseUser | null) => void) {
    return onIdTokenChanged(auth, callback);
  }

  /**
   * Force refresh current user ID token
   */
  public static async refreshToken(): Promise<string | null> {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    return currentUser.getIdToken(true);
  }
}
