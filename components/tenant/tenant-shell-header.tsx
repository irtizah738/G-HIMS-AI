'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/tenant/context';
import { HeaderProfileMenu } from '@/components/auth/header-profile-menu';
import { 
  Building2, 
  ChevronDown, 
  ArrowLeft, 
  CheckCircle2, 
} from 'lucide-react';

export function TenantShellHeader() {
  const { currentTenant, tenantId, userTenants, switchTenant } = useTenant();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const router = useRouter();

  const handleSelectTenant = async (newTenantId: string) => {
    setDropdownOpen(false);
    await switchTenant(newTenantId);
    router.push(`/${newTenantId}/inpatient/bed-board`);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-xs transition-colors">
      <div className="w-full px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Left: Brand & Hospital Switcher */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/70 dark:hover:bg-slate-750 px-2.5 sm:px-3 h-9 rounded-xl border border-slate-200/80 dark:border-slate-700 transition-all shadow-2xs"
            title="Return to Main Command Hub"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Command Hub</span>
          </Link>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

          {/* Tenant Selector Dropdown */}
          <div className="relative">
            <button
              id="tenant-switcher-dropdown"
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="h-9 flex items-center gap-2 px-2.5 sm:px-3 rounded-xl border border-slate-200/90 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/90 dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-all cursor-pointer shadow-2xs"
            >
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-2xs shrink-0"
                style={{ backgroundColor: currentTenant?.brandColor || '#2563eb' }}
              >
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1 max-w-[140px] sm:max-w-[200px]">
                  {currentTenant?.name || tenantId}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold hidden md:inline">
                  {currentTenant?.facilityCode || 'HOSP'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-0.5" />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1.5 w-80 bg-white dark:bg-slate-850 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span>Hospital Tenants</span>
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

        {/* Right: Unified Profile & Sign In Dropdown Menu */}
        <div className="flex items-center gap-2">
          <HeaderProfileMenu tenantId={tenantId} />
        </div>
      </div>

    </header>
  );
}
