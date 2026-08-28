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
import { getCachedTenantMemberships } from '@/lib/offline/auth-storage';

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
  accessibleTenants: TenantSelectionItem[];
  signIn: (email: string, pass: string, options?: SignInOptions) => Promise<LoginResponsePayload>;
  signOut: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; message: string }>;
  unlockSession: (password: string) => Promise<boolean>;
  lockSession: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasPrivilege: (privilege: string) => boolean;
  triggerBreakGlass: (reason: string) => Promise<void>;
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
  const [loadingStatus, setLoadingStatus] = useState<AuthStateLoadingStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
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
      lastAuthenticatedAt: new Date().toISOString(),
    };

    const sessionRec: UserSessionRecord = {
      sessionId: payload.session.sessionId,
      userId: payload.user.uid,
      tenantId: payload.tenant.tenantId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      authenticatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      expiresAt: payload.session.expiresAt,
    };

    setUser(authUser);
    setSession(sessionRec);
    setActiveTenant(payload.tenant);
    setRoles(payload.authorization.roles);
    setPermissions(payload.authorization.permissions);
    setClinicalPrivileges(payload.authorization.clinicalPrivileges || []);
    setAccountStatus(payload.authorization.accountStatus);
    setError(null);
    setIsLocked(false);
  }, []);

  // Session Restoration & Initial Auth Lifecycle
  const refreshAuth = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingStatus('RESTORING_SESSION');
      const payload = await AuthClient.validateCurrentSession();

      if (payload && payload.authenticated) {
        applyLoginPayload(payload);
        const tenants = await AuthClient.getAccessibleTenants();
        setAccessibleTenants(tenants);
        setLoadingStatus('READY');
      } else {
        setUser(null);
        setSession(null);
        setActiveTenant(null);
        setRoles([]);
        setPermissions([]);
        setClinicalPrivileges([]);
        setLoadingStatus('IDLE');
      }
    } catch (err: any) {
      console.warn('Session restoration notice:', err);
      setError(err?.userMessage || err?.message || 'Failed to restore session');
      setLoadingStatus('ERROR');
    } finally {
      setLoading(false);
    }
  }, [applyLoginPayload]);

  const userRef = useRef<AuthenticatedUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    refreshAuth();

    // Listen to Firebase ID token updates
    const unsubscribe = AuthClient.subscribeToAuthState((firebaseUser) => {
      if (!firebaseUser && userRef.current) {
        setUser(null);
        setSession(null);
        setActiveTenant(null);
        setRoles([]);
        setPermissions([]);
        setClinicalPrivileges([]);
        setLoadingStatus('IDLE');
      }
    });

    return () => unsubscribe();
  }, [refreshAuth]);

  // Sign In Action
  const signIn = useCallback(
    async (email: string, pass: string, options?: SignInOptions): Promise<LoginResponsePayload> => {
      setLoading(true);
      setLoadingStatus('AUTHENTICATING');
      setError(null);

      try {
        const payload = await AuthClient.signIn(email, pass, options);
        applyLoginPayload(payload);

        // Fetch accessible tenants
        const tenants = await AuthClient.getAccessibleTenants();
        setAccessibleTenants(tenants);

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
      setIsLocked(false);
      setLoading(false);
      setLoadingStatus('IDLE');
    }
  }, [session?.sessionId]);

  // Tenant Switching Action
  const switchTenant = useCallback(
    async (tenantId: string) => {
      setLoading(true);
      setLoadingStatus('RESOLVING_TENANT');
      try {
        const payload = await AuthClient.switchTenant(tenantId);
        applyLoginPayload(payload);
        setLoadingStatus('READY');
      } catch (err: any) {
        setError(err?.userMessage || err?.message || 'Failed to switch tenant');
        setLoadingStatus('ERROR');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyLoginPayload]
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
        await AuthClient.signIn(user.email, password, { tenantId: user.tenantId });
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
    async (reason: string) => {
      if (!user) return;
      const res = await fetch('/api/auth/break-glass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          tenantId: user.tenantId,
          reason,
        }),
      });

      if (res.ok) {
        setUser((prev) => (prev ? { ...prev, isEmergencyOverride: true } : null));
      }
    },
    [user]
  );

  const hasPerm = useCallback(
    (permission: string) => {
      return checkPermission(user, permission);
    },
    [user]
  );

  const hasR = useCallback(
    (role: string) => {
      return checkRole(user, role);
    },
    [user]
  );

  const hasPriv = useCallback(
    (privilege: string) => {
      return checkPrivilege(user, privilege);
    },
    [user]
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
      accessibleTenants,
      signIn,
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
      accessibleTenants,
      signIn,
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
