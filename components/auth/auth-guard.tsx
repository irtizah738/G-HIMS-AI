'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-context';
import { getSSOConfiguration } from '@/lib/auth/sso-service';
import { SSOConfiguration } from '@/lib/auth/sso-types';
import { ShieldAlert, Lock, AlertCircle, RefreshCw, LogOut, Key, ArrowRight, ShieldCheck } from 'lucide-react';
import { SessionLockModal } from './session-lock-modal';
import { LoginPortal } from './login-portal';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole?: string;
  requiredRoles?: string[];
  requiredPermission?: string;
  requiredPermissions?: string[];
  requiredPrivilege?: string;
  requiredTenantId?: string;
  fallback?: React.ReactNode;
}

export function AuthGuard({
  children,
  requiredRole,
  requiredRoles,
  requiredPermission,
  requiredPermissions,
  requiredPrivilege,
  requiredTenantId,
  fallback,
}: AuthGuardProps) {
  const {
    user,
    activeTenant,
    loading,
    loadingStatus,
    accountStatus,
    hasRole,
    hasPermission,
    hasPrivilege,
    switchTenant,
    signOut,
    refreshAuth,
    signInSSO,
  } = useAuth();

  const [ssoConfig, setSsoConfig] = useState<SSOConfiguration | null>(null);
  const [ssoAuthenticating, setSsoAuthenticating] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check for active SSO config on tenant
  useEffect(() => {
    let isMounted = true;
    if (!user) {
      getSSOConfiguration(activeTenant?.tenantId || 'central-metro-hospital')
        .then((cfg) => {
          if (isMounted && cfg && cfg.enabled) {
            setSsoConfig(cfg);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [user, activeTenant]);

  const handleQuickSSOBypass = async (email?: string) => {
    setSsoAuthenticating(true);
    setSsoError(null);
    try {
      const targetEmail = email || 'doctor.sarah@centralmetro.health';
      await signInSSO(targetEmail, activeTenant?.tenantId || 'central-metro-hospital');
    } catch (err: any) {
      setSsoError(err?.message || 'SSO Identity Provider authentication failed');
    } finally {
      setSsoAuthenticating(false);
    }
  };

  if (!mounted || (loading && loadingStatus === 'RESTORING_SESSION' && !user)) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center animate-pulse">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <div className="font-semibold text-sm tracking-wide text-slate-200">
            Validating Clinical Security Context
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Zero-Trust Hospital Token & Session Verification...
          </div>
        </div>
      </div>
    );
  }

  // Not Authenticated State with Login Portal
  if (!user) {
    if (fallback) return <>{fallback}</>;
    return <LoginPortal />;
  }

  // Account Status Checks
  if (accountStatus === 'DISABLED') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mx-auto border border-red-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-red-400">Account Disabled</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your clinical access has been revoked by hospital administration. If you believe this is an error, contact IT Security Governance.
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 border border-slate-700 cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (accountStatus === 'SUSPENDED') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md bg-slate-900 border border-amber-500/30 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/20">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-amber-400">Account Suspended</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your medical credentials require annual re-verification before clinical privileges can be reinstated.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => refreshAuth()}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Check Status
            </button>
            <button
              onClick={() => signOut()}
              className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 border border-slate-700 cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (accountStatus === 'PENDING') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md bg-slate-900 border border-blue-500/30 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/20">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-blue-400">Registration Pending Approval</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your clinical identity registration is awaiting departmental head sign-off and role assignment.
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 border border-slate-700 cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Return to Login
          </button>
        </div>
      </div>
    );
  }

  // Role Checks
  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <div className="p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          Unauthorized Role
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This module requires the <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-400">{requiredRole}</code> role.
        </p>
      </div>
    );
  }

  if (requiredRoles && !requiredRoles.some((r) => hasRole(r))) {
    return (
      <div className="p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          Unauthorized Role
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This module requires one of: {requiredRoles.join(', ')}.
        </p>
      </div>
    );
  }

  // Permission Checks
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          Permission Denied
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Required permission: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-red-500">{requiredPermission}</code>.
        </p>
      </div>
    );
  }

  // Clinical Privilege Checks
  if (requiredPrivilege && !hasPrivilege(requiredPrivilege)) {
    return (
      <div className="p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          Clinical Privilege Restricted
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Action requires verified credential privilege: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-red-500">{requiredPrivilege}</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <SessionLockModal />
      {children}
    </>
  );
}
