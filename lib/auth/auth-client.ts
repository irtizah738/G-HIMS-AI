/**
 * G-HIMS Master Auth Client
 * Safe abstraction over Firebase Authentication + Backend Authoritative Session Orchestration
 */

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  onIdTokenChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
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
   * Exchange the currently authenticated Firebase identity for a server-authoritative
   * G-HIMS tenant session. Firebase Auth remains the only identity/password authority.
   */
  private static async establishServerSession(
    options?: SignInOptions
  ): Promise<LoginResponsePayload> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new AuthError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A Firebase identity is required before establishing a G-HIMS session.',
        statusCode: 401,
      });
    }

    const requestedTenantId = options?.tenantId || 'central-metro-hospital';
    const deviceMeta = generateDeviceMetadata();
    const rememberDevice = options?.rememberDevice ?? true;
    const idToken = await currentUser.getIdToken(true);

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
          rememberDevice,
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
    await currentUser.getIdToken(true);

    const effectiveDeviceId = rememberDevice ? deviceMeta.deviceId : undefined;

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
      deviceId: effectiveDeviceId,
      lastAuthenticatedAt: new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const sessionRecord: UserSessionRecord = {
      sessionId: loginPayload.session.sessionId,
      userId: loginPayload.user.uid,
      tenantId: loginPayload.tenant.tenantId,
      deviceId: effectiveDeviceId,
      status: 'ACTIVE',
      createdAt: now,
      lastSeenAt: now,
      authenticatedAt: now,
      lastActivityAt: now,
      expiresAt: loginPayload.session.expiresAt,
    };

    try {
      await saveCachedAuthSession(authUser, sessionRecord);
    } catch (cacheErr) {
      console.warn('Notice: Local session caching warning:', cacheErr);
    }

    return loginPayload;
  }

  /**
   * Email/password sign in. Firebase Authentication validates the credential;
   * the backend only exchanges the verified identity for tenant/session authority.
   */
  public static async signIn(
    email: string,
    pass: string,
    options?: SignInOptions
  ): Promise<LoginResponsePayload> {
    try {
      const cleanEmail = email.trim();
      await signInWithEmailAndPassword(auth, cleanEmail, pass);
      return await this.establishServerSession(options);
    } catch (err) {
      throw mapAuthError(err);
    }
  }

  /**
   * Complete Google/OIDC/Firebase-provider login without re-entering a password.
   */
  public static async signInWithCurrentFirebaseIdentity(
    options?: SignInOptions
  ): Promise<LoginResponsePayload> {
    try {
      return await this.establishServerSession(options);
    } catch (err) {
      throw mapAuthError(err);
    }
  }

  /**
   * Reauthenticate the current password-based Firebase identity without creating
   * a second G-HIMS session. The existing server session is revalidated afterward.
   */
  public static async reauthenticateCurrentSession(password: string): Promise<boolean> {
    const currentUser = auth.currentUser;
    const cached = await getCachedAuthSession();

    if (!currentUser?.email || !cached) return false;

    const providerIds = currentUser.providerData.map((provider) => provider.providerId);
    if (!providerIds.includes('password')) {
      throw new AuthError({
        code: 'REAUTH_PROVIDER_REQUIRED',
        message: 'This account uses a federated identity provider.',
        statusCode: 400,
        userMessage: 'Unlock this workstation using your configured identity provider.',
      });
    }

    try {
      const credential = EmailAuthProvider.credential(currentUser.email, password);
      await reauthenticateWithCredential(currentUser, credential);
      const payload = await this.validateCurrentSession();
      return Boolean(payload?.authenticated);
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
   * Request password reset through Firebase Client Auth, which actually sends the
   * configured Firebase reset email. The server endpoint is audit-only.
   */
  public static async sendPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const genericMessage =
      'If an account exists for this email, password-reset instructions have been sent.';

    try {
      await sendPasswordResetEmail(auth, cleanEmail);
    } catch {
      // Preserve a non-enumerating response for unknown users/provider differences.
    }

    await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail }),
    }).catch(() => {});

    return { success: true, message: genericMessage };
  }

  /**
   * Returns the currently cached authoritative tenant identifier.
   */
  public static async getActiveTenantId(): Promise<string> {
    const cached = await getCachedAuthSession();
    if (!cached?.user?.tenantId) {
      throw new AuthError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'No active G-HIMS tenant session is available',
        statusCode: 401,
      });
    }
    return cached.user.tenantId;
  }

  /**
   * Authenticated fetch for protected G-HIMS API routes.
   * Injects Firebase identity plus the active tenant/session/device scope.
   */
  public static async authorizedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
    tenantId?: string
  ): Promise<Response> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new AuthError({
        code: 'NETWORK_UNAVAILABLE',
        message: 'Protected server actions require an online authoritative session',
        statusCode: 503,
      });
    }

    const currentUser = auth.currentUser;
    const cached = await getCachedAuthSession();

    if (!currentUser || !cached) {
      throw new AuthError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'An active authenticated G-HIMS session is required',
        statusCode: 401,
      });
    }

    if (cached.session.status !== 'ACTIVE' || Date.now() >= new Date(cached.session.expiresAt).getTime()) {
      await clearCachedAuthSession();
      throw new AuthError({
        code: 'SESSION_EXPIRED',
        message: 'The cached clinical session is no longer active',
        statusCode: 401,
      });
    }

    const requestedTenantId = (tenantId || cached.user.tenantId).trim().toLowerCase();
    const cachedTenantId = cached.user.tenantId.trim().toLowerCase();

    if (!requestedTenantId || requestedTenantId !== cachedTenantId) {
      throw new AuthError({
        code: 'TENANT_ACCESS_DENIED',
        message: 'Requested tenant does not match the active clinical session. Switch tenant first.',
        statusCode: 403,
      });
    }

    const idToken = await currentUser.getIdToken(false);
    const headers = new Headers(init.headers || {});

    headers.set('Authorization', `Bearer ${idToken}`);
    headers.set('x-ghims-tenant-id', requestedTenantId);
    headers.set('x-ghims-session-id', cached.session.sessionId);

    if (cached.session.deviceId || cached.user.deviceId) {
      headers.set('x-ghims-device-id', cached.session.deviceId || cached.user.deviceId || '');
    }

    const response = await fetch(input, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      await clearCachedAuthSession();
    }

    return response;
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

    const data: LoginResponsePayload = await response.json();
    if (!response.ok) {
      throw new AuthError({
        code: (data as any).code || 'TENANT_ACCESS_DENIED',
        message: (data as any).error || 'Failed to switch tenant',
        statusCode: response.status,
      });
    }

    // The server may have refreshed tenant-scoped Firebase claims.
    await currentUser.getIdToken(true);

    const authUser: AuthenticatedUser = {
      uid: data.user.uid,
      email: data.user.email,
      displayName: data.user.displayName,
      tenantId: data.tenant.tenantId,
      roles: data.authorization.roles,
      permissions: data.authorization.permissions,
      departmentIds: data.authorization.departmentIds,
      facilityIds: data.authorization.facilityIds,
      accountStatus: data.authorization.accountStatus,
      clinicalPrivileges: data.authorization.clinicalPrivileges,
      sessionId: data.session.sessionId,
      lastAuthenticatedAt: new Date().toISOString(),
    };

    const sessionRecord: UserSessionRecord = {
      sessionId: data.session.sessionId,
      userId: data.user.uid,
      tenantId: data.tenant.tenantId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      authenticatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      expiresAt: data.session.expiresAt,
    };

    await saveCachedAuthSession(authUser, sessionRecord);
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
