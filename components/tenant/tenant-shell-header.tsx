'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/tenant/context';
import { useAuth } from '@/lib/firebase/auth-context';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { 
  Building2, 
  ChevronDown, 
  ShieldCheck, 
  ArrowLeft, 
  UserCircle2, 
  CheckCircle2, 
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import { ClinicalCopilotDrawer } from '@/components/ai/ClinicalCopilotDrawer';

export function TenantShellHeader() {
  const { currentTenant, tenantId, role, userTenants, switchTenant } = useTenant();
  const { user, signInWithGoogle, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const router = useRouter();

  const handleSelectTenant = async (newTenantId: string) => {
    setDropdownOpen(false);
    await switchTenant(newTenantId);
    router.push(`/${newTenantId}/inpatient/bed-board`);
  };

  const getRoleBadgeStyle = (userRole: string) => {
    switch (userRole) {
      case 'admin':
        return 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'doctor':
        return 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'nurse':
        return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'billing':
        return 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-2xs transition-colors">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand & Hospital Switcher */}
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Main Command Hub</span>
          </Link>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

          {/* Tenant Selector Dropdown */}
          <div className="relative">
            <button
              id="tenant-switcher-dropdown"
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-750 text-left transition-all cursor-pointer"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-2xs shrink-0"
                style={{ backgroundColor: currentTenant?.brandColor || '#2563eb' }}
              >
                <Building2 className="w-4 h-4" />
              </div>
              <div className="hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                    {currentTenant?.name || tenantId}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold">
                    {currentTenant?.facilityCode || 'HOSP'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Isolated Tenant: {tenantId}</span>
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1.5 w-80 bg-white dark:bg-slate-850 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-50 space-y-1">
                  <div className="px-3 py-2 text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span>Available Hospital Tenants</span>
                    <span className="text-blue-600 dark:text-blue-400 font-bold">Multi-Tenant</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-1 py-1">
                    {userTenants.map((t) => {
                      const isSelected = t.id === tenantId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTenant(t.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-800'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                              style={{ backgroundColor: t.brandColor || '#2563eb' }}
                            >
                              {t.facilityCode.substring(0, 2)}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">{t.name}</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                Code: {t.facilityCode} • {t.region}
                              </p>
                            </div>
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Security Badge, Theme Toggle, Role & User Avatar */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Clinical AI Copilot Drawer Trigger */}
          <button
            id="btn-open-clinical-copilot"
            type="button"
            onClick={() => setCopilotOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs hover:shadow-sm transition-all cursor-pointer"
            title="Open Gemini Clinical AI Copilot & Decision Support"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden md:inline">AI Copilot</span>
          </button>

          {/* Theme Toggle Button */}
          <ThemeToggle variant="button" />

          {/* Security Boundary Indicator & HIPAA Audit Link */}
          <Link
            href={`/${tenantId}/admin/audit-logs`}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 border border-slate-200 dark:border-slate-700 hover:border-purple-200 dark:hover:border-purple-800 text-slate-600 dark:text-slate-300 hover:text-purple-700 dark:hover:text-purple-400 text-xs transition-colors"
            title="Inspect HIPAA §164.312(b) Cryptographic Audit Trail"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px] font-medium">HIPAA Audit Ledger</span>
          </Link>

          {/* User Role Badge */}
          <span
            className={`px-2.5 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wide border ${getRoleBadgeStyle(
              role
            )}`}
          >
            Role: {role}
          </span>

          {/* User Authentication Status */}
          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              {user.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  width={28}
                  height={28}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover border border-slate-300 dark:border-slate-600"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                  {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:block text-left">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1 max-w-[120px]">
                  {user.displayName || user.email?.split('@')[0]}
                </p>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-[10px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-medium block"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <button
              id="btn-tenant-google-login"
              type="button"
              onClick={() => signInWithGoogle()}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <UserCircle2 className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>

      {/* Slide-out Clinical AI Copilot Drawer */}
      <ClinicalCopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        tenantId={tenantId}
      />
    </header>
  );
}
