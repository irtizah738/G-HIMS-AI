'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Building2, ShieldCheck, ArrowRight, ActivitySquare, CheckCircle2, Lock } from 'lucide-react';
import Link from 'next/link';

export default function TenantSelectionPage() {
  const router = useRouter();
  const { user, accessibleTenants, activeTenant, switchTenant, loading, signOut } = useAuth();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectTenant = async (tenantId: string) => {
    setSwitchingId(tenantId);
    setError(null);
    try {
      await switchTenant(tenantId);
      router.push('/');
    } catch (err: any) {
      setError(err?.userMessage || err?.message || 'Failed to switch facility');
    } finally {
      setSwitchingId(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <Lock className="w-8 h-8 text-blue-400 mx-auto" />
          <h2 className="text-lg font-bold">Authentication Required</h2>
          <p className="text-xs text-slate-400">Please sign in to view your authorized hospital facilities.</p>
          <Link
            href="/login"
            className="block w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-blue-600 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ActivitySquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
              G-HIMS OS
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Multi-Tenant Gateway
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Select Operating Hospital Organization
            </div>
          </div>
        </div>

        <button
          onClick={() => signOut()}
          className="text-xs text-slate-400 hover:text-slate-200 transition"
        >
          Sign Out
        </button>
      </header>

      {/* Facility Grid */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-12">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Hospital Facility Workspaces
            </h1>
            <p className="text-xs text-slate-400">
              Logged in as <span className="text-blue-400 font-medium">{user.email}</span>. Choose a hospital facility to establish your clinical session.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {accessibleTenants.map((tenant) => {
              const isActive = activeTenant?.tenantId === tenant.tenantId;
              const isSwitching = switchingId === tenant.tenantId;

              return (
                <button
                  key={tenant.tenantId}
                  disabled={isSwitching || loading}
                  onClick={() => handleSelectTenant(tenant.tenantId)}
                  className={`w-full text-left p-5 rounded-2xl border transition flex items-center justify-between group ${
                    isActive
                      ? 'bg-blue-950/30 border-blue-500/60 ring-1 ring-blue-500/30'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                        isActive
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 group-hover:border-slate-600'
                      }`}
                    >
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white truncate">
                          {tenant.name}
                        </span>
                        {isActive && (
                          <span className="flex items-center gap-1 text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Active Context
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                        <span className="font-mono text-[11px] text-slate-300">
                          {tenant.facilityCode}
                        </span>
                        <span>&bull;</span>
                        <span>Role: {tenant.roles?.join(', ') || 'Medical Staff'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 pl-4">
                    {isSwitching ? (
                      <span className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin block" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-800 group-hover:bg-blue-600 group-hover:text-white text-slate-400 flex items-center justify-center transition">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-900/30 px-6 py-3 text-center text-xs text-slate-400">
        G-HIMS Multi-Tenant Isolation &bull; HIPAA Boundary Enforced
      </footer>
    </div>
  );
}
