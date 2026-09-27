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
   * Primary Sign In: Authenticates against Authoritative Backend, establishes session, and signs into Firebase Client SDK
   */
  public static async signIn(
    email: string,
    pass: string,
    options?: SignInOptions
  ): Promise<LoginResponsePayload> {
    try {
      const cleanEmail = email.trim();
      const requestedTenantId = options?.tenantId || 'central-metro-hospital';
      const deviceMeta = generateDeviceMetadata();

      // Firebase Authentication is the only password authority. The G-HIMS backend
      // never receives, stores, resets, or synchronizes the submitted password.
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      const idToken = await credential.user.getIdToken(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      let response: Response;
      try {
        response = await fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            tenantId: requestedTenantId,
            device: deviceMeta,
            rememberDevice: options?.rememberDevice ?? true,
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await response.json();

      if (!response.ok) {
        await firebaseSignOut(auth).catch(() => {});
        throw new AuthError({
          code: data.code || 'AUTHORIZATION_REQUIRED',
          message: data.error || 'Hospital authorization failed',
          statusCode: response.status,
          userMessage: data.userMessage || data.error,
        });
      }

      const loginPayload: LoginResponsePayload = data;

      // Refresh the token after the backend has synchronized tenant read claims.
      await credential.user.getIdToken(true);

      const authUser: AuthenticatedUser = {
        uid: loginPayload.user.uid,
        email: loginPayload.user.email,
        displayName: loginPayload.user.displayName,
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
        userId: loginPayload.user.uid,
        tenantId: loginPayload.tenant.tenantId,
        deviceId: deviceMeta.deviceId,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        authenticatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: loginPayload.session.expiresAt,
      };

      try {
        await saveCachedAuthSession(authUser, sessionRecord);
      } catch (cacheErr) {
        console.warn('Notice: Local session caching warning:', cacheErr);
      }

      return loginPayload;
    } catch (err) {
      throw mapAuthError(err);
    }
  }

  /**
   * Enterprise Single Sign-On (SSO / SAML / OIDC) Sign In
   */
  public static async signInSSO(
    email: string,
    tenantId: string = 'central-metro-hospital'
  ): Promise<LoginResponsePayload> {
    try {
      const cleanEmail = email.trim();
      const response = await fetch('/api/auth/sso/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, tenantId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new AuthError({
          code: 'SSO_AUTH_FAILED',
          message: data.error || 'Enterprise SSO authentication failed',
          statusCode: response.status,
          userMessage: data.error || 'Failed to authenticate via hospital Identity Provider',
        });
      }

      const loginPayload: LoginResponsePayload = data;
      const deviceMeta = generateDeviceMetadata();

      const authUser: AuthenticatedUser = {
        uid: loginPayload.user.uid,
        email: loginPayload.user.email,
        displayName: loginPayload.user.displayName,
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
        userId: loginPayload.user.uid,
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
      const cached = await getCachedAuthSession();
      const currentUser = auth.currentUser;

      // Offline cache is a continuity aid only; it is never used to mint new authority.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!cached) return null;
        return {
          authenticated: true,
          user: {
            uid: cached.user.uid,
            displayName: cached.user.displayName,
            email: cached.user.email,
          },
          tenant: {
            tenantId: cached.user.tenantId,
            name: 'Offline cached facility',
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
          accessibleTenants: [{
            tenantId: cached.user.tenantId,
            name: 'Offline cached facility',
            roles: cached.user.roles,
          }],
        };
      }

      if (!currentUser || !cached) return null;

      const idToken = await currentUser.getIdToken(false);
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'x-ghims-tenant-id': cached.user.tenantId,
          'x-ghims-session-id': cached.session.sessionId,
        },
      });

      if (!response.ok) {
        await clearCachedAuthSession();
        return null;
      }

      return await response.json() as LoginResponsePayload;
    } catch {
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
            body: JSON.stringify({
              sessionId: sessionId || (await getCachedAuthSession())?.session.sessionId,
              tenantId: (await getCachedAuthSession())?.user.tenantId,
            }),
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
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return [];

      const idToken = await Promise.race([
        currentUser.getIdToken(false),
        new Promise<null>((res) => setTimeout(() => res(null), 1000)),
      ]);
      if (!idToken) return [];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      try {
        const response = await fetch('/api/auth/tenant-selection', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) return [];
        const data = await response.json();
        return data.tenants || [];
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return [];
    }
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
