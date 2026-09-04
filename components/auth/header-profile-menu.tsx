'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import { useAuth as useEnterpriseAuth } from '@/lib/auth/auth-context';
import { useTenant } from '@/lib/tenant/context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { normalizeRole } from '@/lib/auth/rbac';
import {
  ShieldCheck,
  User,
  ChevronDown,
  LogOut,
  Building2,
  Lock,
  LogIn,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface HeaderProfileMenuProps {
  tenantId?: string;
}

export function HeaderProfileMenu({ tenantId }: HeaderProfileMenuProps) {
  const { user: firebaseUser, signOut: firebaseSignOut, signInWithGoogle } = useFirebaseAuth();
  
  let enterpriseAuth: ReturnType<typeof useEnterpriseAuth> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    enterpriseAuth = useEnterpriseAuth();
  } catch {
    enterpriseAuth = null;
  }

  const { tenantId: contextTenantId, currentTenant, role: tenantRole } = useTenant();
  
  // RBAC context (may be available depending on tree location)
  let rbac: ReturnType<typeof useRBAC> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rbac = useRBAC();
  } catch {
    rbac = null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const activeTenantId = tenantId || contextTenantId || 'central-metro-hospital';

  // Active identity resolution
  const activeUser = firebaseUser
    ? {
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Dr. Sarah Jenkins, MD',
        email: firebaseUser.email || 's.jenkins@centralmetro.health',
        photoURL: firebaseUser.photoURL,
        isFirebase: true,
      }
    : enterpriseAuth?.user
    ? {
        displayName: enterpriseAuth.user.displayName || enterpriseAuth.user.email?.split('@')[0] || 'Dr. Sarah Jenkins, MD',
        email: enterpriseAuth.user.email,
        photoURL: null,
        isFirebase: false,
      }
    : rbac?.demoPersona
    ? {
        displayName: rbac.demoPersona.name,
        email: rbac.demoPersona.email,
        photoURL: null,
        isFirebase: false,
      }
    : {
        displayName: 'Dr. Sarah Jenkins, MD',
        email: 's.jenkins@centralmetro.health',
        photoURL: null,
        isFirebase: false,
      };

  // Close dropdown on outside click or ESC key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const getRoleBadgeStyle = (r?: string) => {
    const roleStr = (r || '').toLowerCase();
    if (roleStr.includes('admin')) {
      return 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
    }
    if (roleStr.includes('doc')) {
      return 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    }
    if (roleStr.includes('nurse')) {
      return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (roleStr.includes('bill')) {
      return 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const displayRole = rbac?.roleDefinition?.displayName || rbac?.demoPersona?.title || tenantRole || 'Lead Attending Cardiologist';

  const handleSignOut = async () => {
    setIsOpen(false);
    try {
      await firebaseSignOut();
    } catch (e) {
      console.warn('Firebase signout:', e);
    }
    try {
      if (enterpriseAuth?.signOut) {
        await enterpriseAuth.signOut();
      }
    } catch (e) {
      console.warn('Enterprise signout:', e);
    }
    router.push('/login');
  };

  const handleGoogleSignIn = async () => {
    setIsOpen(false);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      const errorCode = e?.code || '';
      const errorMessage = e?.message || '';
      if (
        errorCode === 'auth/popup-closed-by-user' ||
        errorCode === 'auth/cancelled-popup-request' ||
        errorMessage.includes('popup-closed-by-user')
      ) {
        return;
      }
      console.warn('Google Sign-in status:', e?.message || e);
    }
  };

  const displayName = activeUser.displayName;
  const displayEmail = activeUser.email;

  return (
    <div className="relative" ref={menuRef} id="header-profile-menu-container">
      {/* Trigger Button: Clean, compact avatar + role pill */}
      <button
        id="btn-header-profile-menu"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`h-9 pl-1.5 pr-2.5 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-all cursor-pointer select-none ${
          isOpen
            ? 'bg-slate-100 dark:bg-slate-800 border-blue-400 dark:border-blue-500 ring-2 ring-blue-500/20'
            : 'bg-slate-50/90 dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/90 dark:border-slate-750'
        }`}
        title={`Signed in as ${displayName} (${displayRole})`}
        aria-expanded={isOpen}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          {activeUser.photoURL ? (
            <Image
              src={activeUser.photoURL}
              alt={displayName}
              width={24}
              height={24}
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover border border-slate-300 dark:border-slate-600 shadow-2xs"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Active status indicator dot */}
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1.5 ring-white dark:ring-slate-900" />
        </div>

        {/* User & Role Info (Desktop & Tablet) */}
        <div className="hidden md:flex flex-col text-left leading-none pr-0.5">
          <span className="font-bold text-slate-900 dark:text-slate-100 text-xs truncate max-w-[110px]">
            {displayName}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize mt-0.5 truncate max-w-[110px]">
            {displayRole}
          </span>
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-blue-600 dark:text-blue-400' : ''
          }`}
        />
      </button>

      {/* Profile & Security Popover Menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200/90 dark:border-slate-800 p-3 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3">
            {/* User Identity Header Card */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850/80 border border-slate-100 dark:border-slate-800 flex items-center gap-3">
              {activeUser.photoURL ? (
                <Image
                  src={activeUser.photoURL}
                  alt={displayName}
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shadow-2xs"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center shadow-2xs shrink-0">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {displayName}
                  </h4>
                  <span
                    className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${getRoleBadgeStyle(
                      displayRole
                    )}`}
                  >
                    {displayRole}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
                  {displayEmail}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{currentTenant?.name || activeTenantId}</span>
                </div>
              </div>
            </div>

            {/* Google SSO / Workspace Link */}
            {!firebaseUser && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer text-xs"
              >
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center text-[9px] font-bold text-red-500 shadow-2xs shrink-0">
                    G
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-[11px] block">Connect Google SSO</span>
                    <span className="text-[9px] text-slate-400">Sheets & Drive Sync</span>
                  </div>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-400" />
              </button>
            )}

            {/* Quick Links & Security Hub */}
            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
              <Link
                href={`/${activeTenantId}/admin/audit-logs`}
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-semibold text-xs">HIPAA Audit Trail Ledger</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">§164.312(b)</span>
              </Link>

              <Link
                href={`/${activeTenantId}/admin/users`}
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold text-xs">Staff & Credential Directory</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">IAM</span>
              </Link>
            </div>

            {/* Security Notice & Sign Out Footer */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                <Lock className="w-3 h-3 text-emerald-500" />
                <span>Zero-Trust Session</span>
              </div>

              <button
                id="btn-profile-signout"
                type="button"
                onClick={handleSignOut}
                className="px-3 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
