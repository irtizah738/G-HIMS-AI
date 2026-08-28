'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { useTenant } from '@/lib/tenant/context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { RoleId } from '@/types/rbac';
import { ROLE_DEFINITIONS } from '@/lib/auth/rbac';
import {
  ShieldCheck,
  Stethoscope,
  HeartPulse,
  ClipboardList,
  DollarSign,
  User,
  ChevronDown,
  LogOut,
  Layers,
  FileText,
  KeyRound,
  Check,
  Building2,
  Lock,
  Sparkles,
  LogIn,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface HeaderProfileMenuProps {
  tenantId?: string;
}

export function HeaderProfileMenu({ tenantId }: HeaderProfileMenuProps) {
  const { user, signOut, signInWithGoogle } = useAuth();
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

  const getRoleIcon = (roleName?: string, className = 'w-3.5 h-3.5') => {
    const r = (roleName || '').toLowerCase();
    if (r.includes('admin')) return <ShieldCheck className={className} />;
    if (r.includes('doc') || r.includes('physician')) return <Stethoscope className={className} />;
    if (r.includes('nurse')) return <HeartPulse className={className} />;
    if (r.includes('recept') || r.includes('front')) return <ClipboardList className={className} />;
    if (r.includes('bill') || r.includes('finance')) return <DollarSign className={className} />;
    return <User className={className} />;
  };

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

  const displayRole = rbac?.roleDefinition?.displayName || tenantRole || 'Clinician';
  const roleId = rbac?.currentRole;

  const handleRoleSelect = (newRoleId: RoleId) => {
    if (rbac?.setRole) {
      rbac.setRole(newRoleId);
    }
  };

  const handleSignOut = async () => {
    setIsOpen(false);
    await signOut();
    router.push('/login');
  };

  const handleGoogleSignIn = async () => {
    setIsOpen(false);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error('Google Sign-in failed', e);
    }
  };

  // -------------------------------------------------------------
  // SIGNED-OUT STATE: "Sign In" Button with Interactive Dropdown
  // -------------------------------------------------------------
  if (!user) {
    return (
      <div className="relative" ref={menuRef} id="header-signin-dropdown-container">
        <button
          id="btn-header-signin-dropdown"
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`h-9 pl-3 pr-2.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs hover:shadow-xs transition-all cursor-pointer select-none ${
            isOpen
              ? 'bg-blue-700 ring-2 ring-blue-400/40'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
          title="Sign In to Clinical Portal"
          aria-expanded={isOpen}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>Sign In</span>
          <ChevronDown
            className={`w-3.5 h-3.5 opacity-80 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Menu for Sign In */}
        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-transparent"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200/90 dark:border-slate-800 p-3 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3">
              {/* Header Info */}
              <div className="px-2 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                    <LogIn className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      G-HIMS Access Portal
                    </h4>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Secure HIPAA & Zero-Trust Clinical Login
                    </p>
                  </div>
                </div>
              </div>

              {/* Primary Actions */}
              <div className="space-y-1.5">
                {/* Regular Portal Login */}
                <Link
                  href="/login"
                  id="link-signin-full-portal"
                  onClick={() => setIsOpen(false)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200/80 dark:border-blue-800 text-blue-900 dark:text-blue-200 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-xs font-bold">Sign In with Credentials</div>
                      <div className="text-[10px] text-blue-700/80 dark:text-blue-300/80 font-normal">
                        Password + MFA + Tenant Claims
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform" />
                </Link>

                {/* Google SSO */}
                <button
                  type="button"
                  id="btn-signin-google-sso"
                  onClick={handleGoogleSignIn}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center text-[10px] font-bold text-red-500 shadow-2xs shrink-0">
                      G
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold">Continue with Google SSO</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        Enterprise Identity Provider
                      </div>
                    </div>
                  </div>
                  <Check className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>

              {/* Quick Simulation Roles */}
              {rbac && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <span>Demo Role Simulation</span>
                    <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold">Instant</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['doctor', 'nurse', 'administrator', 'billing_clerk'] as RoleId[]).map((rKey) => {
                      const isSelected = roleId === rKey;
                      const rDef = ROLE_DEFINITIONS[rKey];
                      return (
                        <button
                          key={rKey}
                          type="button"
                          onClick={() => {
                            handleRoleSelect(rKey);
                            setIsOpen(false);
                          }}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-between border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-800 shadow-2xs'
                              : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-750'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {getRoleIcon(rKey, 'w-3 h-3 text-slate-500 dark:text-slate-400')}
                            <span className="truncate">{rDef?.displayName || rKey}</span>
                          </span>
                          {isSelected && <Check className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Emergency & Tenant Switcher Footer */}
              <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <Link
                  href="/login?mode=breakglass"
                  onClick={() => setIsOpen(false)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    <span className="font-semibold text-xs">Emergency Break-Glass Access</span>
                  </div>
                  <span className="text-[10px] font-mono">§164.312(a)</span>
                </Link>

                <Link
                  href="/tenant-selection"
                  onClick={() => setIsOpen(false)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium text-xs">Select Hospital Facility</span>
                  </div>
                  <span className="text-[10px] font-mono">Multi-Tenant</span>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SIGNED-IN STATE: Comprehensive Profile, Role Switcher & Security
  // -------------------------------------------------------------
  const displayName = user.displayName || user.email?.split('@')[0] || 'Staff Member';
  const displayEmail = user.email || 'authenticated.session@ghims.internal';

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
          {user.photoURL ? (
            <Image
              src={user.photoURL}
              alt={displayName}
              width={24}
              height={24}
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover border border-slate-300 dark:border-slate-600 shadow-2xs"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Active status indicator dot */}
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1.5 ring-white dark:ring-slate-900" />
        </div>

        {/* User & Role Info (Desktop & Tablet) */}
        <div className="hidden md:flex flex-col text-left leading-none pr-0.5">
          <span className="font-bold text-slate-900 dark:text-slate-100 text-xs truncate max-w-[100px]">
            {displayName}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize mt-0.5">
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
              {user.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt={displayName}
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shadow-2xs"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center shadow-2xs shrink-0">
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

            {/* Quick RBAC Role Switcher (If available) */}
            {rbac && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>Switch Simulation Role</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      rbac?.setIsRbacModalOpen(true);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <Layers className="w-3 h-3" />
                    <span>Matrix</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['doctor', 'nurse', 'administrator', 'billing_clerk'] as RoleId[]).map((rKey) => {
                    const isSelected = roleId === rKey;
                    const rDef = ROLE_DEFINITIONS[rKey];
                    return (
                      <button
                        key={rKey}
                        type="button"
                        onClick={() => handleRoleSelect(rKey)}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-between border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-800 shadow-2xs'
                            : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-750'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {getRoleIcon(rKey, 'w-3 h-3 text-slate-500 dark:text-slate-400')}
                          <span className="truncate">{rDef?.displayName || rKey}</span>
                        </span>
                        {isSelected && <Check className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>
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
