'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  AuthenticatedUser,
  AccountStatus,
  AuthStateLoadingStatus,
  LoginResponsePayload,
  TenantSelectionItem,
  UserSessionRecord,
} from './auth-types';
import { AuthClient, SignInOptions } from './auth-client';
import {
  hasPermission as checkPermission,
  hasRole as checkRole,
  hasClinicalPrivilege as checkPrivilege,
} from './auth-guards';
import { InactivityMonitor } from './auth-session';
import { getCachedTenantMemberships, getCachedAuthSession } from '@/lib/offline/auth-storage';

interface AuthContextType {
  user: AuthenticatedUser | null;
  session: UserSessionRecord | null;
  activeTenant: { tenantId: string; name: string; facilityCode?: string } | null;
  roles: string[];
  permissions: string[];
  clinicalPrivileges: string[];
  accountStatus: AccountStatus;
  isLocked: boolean;
  loading: boolean;
  loadingStatus: AuthStateLoadingStatus;
  error: string | null;
  isOffline: boolean;
  isOfflineContinuity: boolean;
  accessibleTenants: TenantSelectionItem[];
  signIn: (email: string, pass: string, options?: SignInOptions) => Promise<LoginResponsePayload>;
  signInFederated: (options?: SignInOptions) => Promise<LoginResponsePayload>;
  signInSSO: (email: string, tenantId: string, provider: 'OKTA' | 'AZURE_AD') => Promise<LoginResponsePayload>;
  signOut: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; message: string }>;
  unlockSession: (password: string) => Promise<boolean>;
  lockSession: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasPrivilege: (privilege: string) => boolean;
  triggerBreakGlass: (reason: string, patientId: string, encounterId: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [session, setSession] = useState<UserSessionRecord | null>(null);
  const [activeTenant, setActiveTenant] = useState<{ tenantId: string; name: string; facilityCode?: string } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [clinicalPrivileges, setClinicalPrivileges] = useState<string[]>([]);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('ACTIVE');
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStatus, setLoadingStatus] = useState<AuthStateLoadingStatus>('RESTORING_SESSION');
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [isOfflineContinuity, setIsOfflineContinuity] = useState<boolean>(false);
  const [accessibleTenants, setAccessibleTenants] = useState<TenantSelectionItem[]>([]);

  const inactivityMonitorRef = useRef<InactivityMonitor | null>(null);

  // Online / Offline Detection
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Workstation Lock Screen on Inactivity
  const lockSession = useCallback(() => {
    if (user) {
      setIsLocked(true);
      setLoadingStatus('LOCKED');
    }
  }, [user]);

  // Start Inactivity Monitor
  useEffect(() => {
    if (user && !isLocked) {
      inactivityMonitorRef.current = new InactivityMonitor(
        () => {
          lockSession();
        },
        () => {
          // Warning before timeout
        }
      );
      inactivityMonitorRef.current.start(15 * 60 * 1000); // 15 min
    } else {
      inactivityMonitorRef.current?.stop();
    }

    return () => {
      inactivityMonitorRef.current?.stop();
    };
  }, [user, isLocked, lockSession]);

  const applyLoginPayload = useCallback((payload: LoginResponsePayload) => {
    // Never claim a new authentication timestamp when restoring local-only state.
    const authenticatedAt = payload.offlineContinuity
      ? (payload.offlineContinuityAuthenticatedAt || new Date(0).toISOString())
      : new Date().toISOString();
    const authUser: AuthenticatedUser = {
      uid: payload.user.uid,
      email: payload.user.email,
      displayName: payload.user.displayName,
      tenantId: payload.tenant.tenantId,
      roles: payload.authorization.roles,
      permissions: payload.authorization.permissions,
      departmentIds: payload.authorization.departmentIds,
      facilityIds: payload.authorization.facilityIds,
      accountStatus: payload.authorization.accountStatus,
      clinicalPrivileges: payload.authorization.clinicalPrivileges,
      sessionId: payload.session.sessionId,
      deviceId: payload.session.deviceId,
      lastAuthenticatedAt: authenticatedAt,
    };

    const sessionRec: UserSessionRecord = {
      sessionId: payload.session.sessionId,
      userId: payload.user.uid,
      tenantId: payload.tenant.tenantId,
      deviceId: payload.session.deviceId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      authenticatedAt,
      lastActivityAt: new Date().toISOString(),
      expiresAt: payload.session.expiresAt,
    };

    setUser(authUser);
    setSession(sessionRec);
    setIsOfflineContinuity(payload.offlineContinuity === true);
    setActiveTenant(payload.tenant);
    setRoles(payload.authorization.roles);
    setPermissions(payload.authorization.permissions);
    setClinicalPrivileges(payload.authorization.clinicalPrivileges || []);
    setAccountStatus(payload.authorization.accountStatus);
    setError(null);
    setIsLocked(false);

    if (typeof window !== 'undefined' && payload.authorization.roles?.[0]) {
      const cleanRole = payload.authorization.roles[0].toLowerCase().trim().replace(/\s+/g, '_');
      localStorage.setItem('ghims_active_rbac_role', cleanRole);
    }
  }, []);

  // Session Restoration & Initial Auth Lifecycle
  const refreshAuth = useCallback(async () => {
    try {
      const payload = await AuthClient.validateCurrentSession();

      if (payload && (payload.authenticated || payload.offlineContinuity === true)) {
        applyLoginPayload(payload);
        setIsOffline(payload.offlineContinuity === true);
        if (payload.accessibleTenants && payload.accessibleTenants.length > 0) {
          setAccessibleTenants(payload.accessibleTenants);
        }
        setLoadingStatus('READY');
      } else {
        setUser(null);
        setSession(null);
        setActiveTenant(null);
        setRoles([]);
        setPermissions([]);
        setClinicalPrivileges([]);
        setIsOfflineContinuity(false);
        setLoadingStatus('IDLE');
      }
    } catch (err: any) {
      // An unsuccessful authoritative refresh must never leave a previously
      // privileged identity active. Offline continuity is established only
      // through the explicit bounded cached-identity path above.
      console.warn('Session restoration notice:', err);
      setUser(null);
      setSession(null);
      setActiveTenant(null);
      setRoles([]);
      setPermissions([]);
      setClinicalPrivileges([]);
      setIsOfflineContinuity(false);
      setLoadingStatus('IDLE');
    } finally {
      setLoading(false);
    }
  }, [applyLoginPayload]);

  const userRef = useRef<AuthenticatedUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    refreshAuth();

    // Listen to Firebase ID token updates
    const unsubscribe = AuthClient.subscribeToAuthState(async (firebaseUser) => {
      if (firebaseUser) {
        // Firebase client user available
      }
    });

    const handleConnectivityRestored = () => { void refreshAuth(); };
    window.addEventListener('online', handleConnectivityRestored);
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleConnectivityRestored);
    };
  }, [refreshAuth]);

  // Sign In Action
  const signIn = useCallback(
    async (email: string, pass: string, options?: SignInOptions): Promise<LoginResponsePayload> => {
      setLoading(true);
      setLoadingStatus('AUTHENTICATING');
      setError(null);

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Sign in timed out. Please check network connection.')), 15000)
        );

        const payload = await Promise.race([
          AuthClient.signIn(email, pass, options),
          timeoutPromise,
        ]);

        applyLoginPayload(payload);

        if (payload.accessibleTenants && payload.accessibleTenants.length > 0) {
          setAccessibleTenants(payload.accessibleTenants);
        }

        setLoadingStatus('READY');
        return payload;
      } catch (err: any) {
        const userMsg = err?.userMessage || err?.message || 'Sign in failed';
        setError(userMsg);
        setLoadingStatus('ERROR');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyLoginPayload]
  );

  // Federated Firebase identity exchange (Google/OIDC/SAML provider already authenticated)
  const signInFederated = useCallback(
    async (options?: SignInOptions): Promise<LoginResponsePayload> => {
      setLoading(true);
      setLoadingStatus('AUTHENTICATING');
      setError(null);

      try {
        const payload = await AuthClient.signInWithCurrentFirebaseIdentity(options);
        applyLoginPayload(payload);

        if (payload.accessibleTenants && payload.accessibleTenants.length > 0) {
          setAccessibleTenants(payload.accessibleTenants);
        }

        setLoadingStatus('READY');
        return payload;
      } catch (err: any) {
        const userMsg = err?.userMessage || err?.message || 'Federated sign in failed';
        setError(userMsg);
        setLoadingStatus('ERROR');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyLoginPayload]
  );

  // Enterprise Single Sign-On (SSO) Action
  const signInSSO = useCallback(
    async (
      email: string,
      tenantId: string,
      provider: 'OKTA' | 'AZURE_AD'
    ): Promise<LoginResponsePayload> => {
      setLoading(true);
      setLoadingStatus('AUTHENTICATING');
      setError(null);

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Enterprise SSO timed out.')), 15000)
        );

        const payload = await Promise.race([
          AuthClient.signInSSO(email, tenantId, provider),
          timeoutPromise,
        ]);

        applyLoginPayload(payload);

        if (payload.accessibleTenants && payload.accessibleTenants.length > 0) {
          setAccessibleTenants(payload.accessibleTenants);
        }

        setLoadingStatus('READY');
        return payload;
      } catch (err: any) {
        const userMsg = err?.userMessage || err?.message || 'Enterprise SSO failed';
        setError(userMsg);
        setLoadingStatus('ERROR');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyLoginPayload]
  );

  // Sign Out Action
  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await AuthClient.signOut(session?.sessionId);
    } finally {
      setUser(null);
      setSession(null);
      setActiveTenant(null);
      setRoles([]);
      setPermissions([]);
      setClinicalPrivileges([]);
      setIsOfflineContinuity(false);
      setIsLocked(false);
      setLoading(false);
      setLoadingStatus('IDLE');
    }
  }, [session?.sessionId]);

  // Tenant Switching Action — ORC-1A: explicit suspension state machine
  // READY → SWITCHING (invalidate prior) → VERIFYING (new token received) → READY
  // On failure: restore prior verified tenant context instead of leaving it empty.
  const switchTenant = useCallback(
    async (tenantId: string) => {
      setLoading(true);
      // ORC-1A: Enter SWITCHING to signal guards to block child mounts
      setLoadingStatus('SWITCHING');
      // Capture prior verified tenant so we can restore it on failure
      const priorTenant = activeTenant;
      const priorRoles = roles;
      const priorPermissions = permissions;
      const priorPrivileges = clinicalPrivileges;
      try {
        const payload = await AuthClient.switchTenant(tenantId);
        // ORC-1A: Invalidate prior tenant subscriptions BEFORE publishing the new context.
        // This prevents child components from reading patient/financial data from the old tenant
        // while the new context is being applied.
        setActiveTenant(null);
        setRoles([]);
        setPermissions([]);
        setClinicalPrivileges([]);
        setLoadingStatus('VERIFYING');
        applyLoginPayload(payload);
        setLoadingStatus('READY');
      } catch (err: any) {
        // ORC-1A: Restore the prior verified state rather than leaving context empty.
        // An empty context would cause every tenant-scoped query to fail with no
        // indication of what went wrong, and could expose an unauthenticated UI.
        if (priorTenant) {
          setActiveTenant(priorTenant);
          setRoles(priorRoles);
          setPermissions(priorPermissions);
          setClinicalPrivileges(priorPrivileges);
        }
        setError(err?.userMessage || err?.message || 'Failed to switch tenant');
        setLoadingStatus('ERROR');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyLoginPayload, activeTenant, roles, permissions, clinicalPrivileges]
  );

  // Password Reset Action
  const sendPasswordReset = useCallback(async (email: string) => {
    return AuthClient.sendPasswordReset(email);
  }, []);

  // Unlock Session Action (Re-authenticating with password)
  const unlockSession = useCallback(
    async (password: string): Promise<boolean> => {
      if (!user) return false;
      try {
        const reauthenticated = await AuthClient.reauthenticateCurrentSession(password);
        if (!reauthenticated) return false;
        setIsLocked(false);
        setLoadingStatus('READY');
        return true;
      } catch {
        return false;
      }
    },
    [user]
  );

  // Break-Glass Emergency Access Elevation Action
  const triggerBreakGlass = useCallback(
    async (reason: string, patientId: string, encounterId: string) => {
      if (!user || !patientId || !encounterId) {
        throw new Error('Patient and encounter context are required for emergency access.');
      }

      const res = await AuthClient.authorizedFetch(
        '/api/auth/break-glass',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: user.tenantId,
            patientId,
            encounterId,
            reason,
          }),
        },
        user.tenantId
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Emergency access request failed');
      }

      setUser((prev) => (prev ? { ...prev, isEmergencyOverride: true } : null));
    },
    [user]
  );

  const hasPerm = useCallback(
    (permission: string) => {
      return !isOfflineContinuity && checkPermission(user, permission);
    },
    [user, isOfflineContinuity]
  );

  const hasR = useCallback(
    (role: string) => {
      return checkRole(user, role);
    },
    [user]
  );

  const hasPriv = useCallback(
    (privilege: string) => {
      return !isOfflineContinuity && checkPrivilege(user, privilege);
    },
    [user, isOfflineContinuity]
  );

  const value = useMemo(
    () => ({
      user,
      session,
      activeTenant,
      roles,
      permissions,
      clinicalPrivileges,
      accountStatus,
      isLocked,
      loading,
      loadingStatus,
      error,
      isOffline,
      isOfflineContinuity,
      accessibleTenants,
      signIn,
      signInFederated,
      signInSSO,
      signOut,
      switchTenant,
      sendPasswordReset,
      unlockSession,
      lockSession,
      hasPermission: hasPerm,
      hasRole: hasR,
      hasPrivilege: hasPriv,
      triggerBreakGlass,
      refreshAuth,
    }),
    [
      user,
      session,
      activeTenant,
      roles,
      permissions,
      clinicalPrivileges,
      accountStatus,
      isLocked,
      loading,
      loadingStatus,
      error,
      isOffline,
      isOfflineContinuity,
      accessibleTenants,
      signIn,
      signInFederated,
      signInSSO,
      signOut,
      switchTenant,
      sendPasswordReset,
      unlockSession,
      lockSession,
      hasPerm,
      hasR,
      hasPriv,
      triggerBreakGlass,
      refreshAuth,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
