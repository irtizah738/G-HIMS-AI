'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Building2,
  ShieldCheck,
  Stethoscope,
  HeartPulse,
  DollarSign,
  ClipboardList,
  User,
  AlertCircle,
  Laptop,
  CheckCircle2,
  HelpCircle,
  ActivitySquare,
  Key,
  Globe,
  Radio,
  ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { mapAuthError } from '@/lib/auth/auth-errors';

interface FacilityDirectoryItem {
  tenantId: string;
  name: string;
  facilityCode?: string;
}

const hospital0TenantId = String(process.env.NEXT_PUBLIC_GHIMS_HOSPITAL0_TENANT_ID || '').trim();
const hospital0Name = String(process.env.NEXT_PUBLIC_GHIMS_HOSPITAL0_NAME || '').trim();
const hospital0FacilityCode = String(process.env.NEXT_PUBLIC_GHIMS_HOSPITAL0_FACILITY_CODE || '').trim();

const HOSPITAL0_FALLBACK_FACILITIES: FacilityDirectoryItem[] = hospital0TenantId
  ? [
      {
        tenantId: hospital0TenantId,
        name: hospital0Name || hospital0TenantId,
        facilityCode: hospital0FacilityCode || undefined,
      },
    ]
  : [];

function resolveFacilityTenantId(
  value: string,
  facilities: FacilityDirectoryItem[]
): string {
  const normalized = value.trim().toLowerCase();
  const match = facilities.find(
    (facility) =>
      facility.tenantId.toLowerCase() === normalized ||
      facility.name.toLowerCase() === normalized ||
      String(facility.facilityCode || '').toLowerCase() === normalized
  );
  return match?.tenantId || '';
}

interface Persona {
  id: string;
  role: string;
  name: string;
  email: string;
  tenantId: string;
  department: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const DEMO_PERSONAS: Persona[] = [
  {
    id: 'admin',
    role: 'Administrator',
    name: 'Demo Administrator',
    email: 'demo.admin@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Hospital Administration',
    icon: ShieldCheck,
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  },
  {
    id: 'doctor',
    role: 'Attending Cardiologist',
    name: 'Demo Physician',
    email: 'demo.doctor@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Cardiology & Intensive Care',
    icon: Stethoscope,
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  },
  {
    id: 'nurse',
    role: 'Head Nurse',
    name: 'Demo Nurse',
    email: 'demo.nurse@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Inpatient Ward 4B',
    icon: HeartPulse,
    color: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
  },
  {
    id: 'reception',
    role: 'Intake Officer',
    name: 'Demo Receptionist',
    email: 'demo.reception@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Outpatient Patient Intake',
    icon: ClipboardList,
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  },
  {
    id: 'billing',
    role: 'Revenue Auditor',
    name: 'Demo Billing Officer',
    email: 'demo.billing@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Revenue Cycle & Claims',
    icon: DollarSign,
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    id: 'patient',
    role: 'Patient Portal',
    name: 'Demo Patient',
    email: 'demo.patient@example.invalid',
    tenantId: 'central-metro-hospital',
    department: 'Consumer Health Portal',
    icon: User,
    color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20',
  },
];

export function LoginPortal() {
  const router = useRouter();
  const { user, signIn, signInFederated, signInSSO, error } = useAuth();
  const { signInWithGoogle } = useFirebaseAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [facilities, setFacilities] = useState<FacilityDirectoryItem[]>(
    HOSPITAL0_FALLBACK_FACILITIES
  );
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilityLoadError, setFacilityLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFacilities = async () => {
      setFacilitiesLoading(true);
      setFacilityLoadError(null);

      try {
        const response = await fetch('/api/auth/facilities', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load hospital facilities.');
        }

        const nextFacilities = Array.isArray(payload.facilities)
          ? payload.facilities
              .map((facility: any) => ({
                tenantId: String(facility?.tenantId || '').trim().toLowerCase(),
                name: String(facility?.name || facility?.tenantId || '').trim(),
                facilityCode: facility?.facilityCode
                  ? String(facility.facilityCode).trim()
                  : undefined,
              }))
              .filter(
                (facility: FacilityDirectoryItem) =>
                  Boolean(facility.tenantId) && Boolean(facility.name)
              )
          : [];

        if (!cancelled) {
          setFacilities(
            nextFacilities.length > 0
              ? nextFacilities
              : HOSPITAL0_FALLBACK_FACILITIES
          );
          if (nextFacilities.length === 0) {
            setFacilityLoadError('No hospital facilities were returned by Firestore.');
          }
        }
      } catch (facilityError) {
        if (!cancelled) {
          setFacilities(HOSPITAL0_FALLBACK_FACILITIES);
          setFacilityLoadError(
            facilityError instanceof Error
              ? facilityError.message
              : 'Unable to load hospital facilities.'
          );
        }
      } finally {
        if (!cancelled) setFacilitiesLoading(false);
      }
    };

    void loadFacilities();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (user && typeof window !== 'undefined' && window.location.pathname === '/login') {
      router.replace('/');
    }
  }, [user, router]);

  // SSO Modal State
  const [ssoModalOpen, setSsoModalOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('');
  const [ssoProvider, setSsoProvider] = useState<'OKTA' | 'AZURE_AD'>('OKTA');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const showDemoPersonas = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const selectedTenantId = resolveFacilityTenantId(tenantId, facilities);
    if (!selectedTenantId) {
      setLocalError('Select an authorized hospital facility before signing in.');
      return;
    }

    if (!email || !email.includes('@')) {
      setLocalError('Please enter a valid medical staff email address.');
      return;
    }

    if (!password || password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(email, password, {
        tenantId: selectedTenantId,
        rememberDevice,
      });

      if (result?.authenticated) {
        if (typeof window !== 'undefined') {
          if (window.location.pathname === '/login') {
            router.replace('/');
          } else {
            router.refresh();
          }
        }
      }
    } catch (err: any) {
      setLocalError(err?.userMessage || err?.message || 'Authentication failed. Please check credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    const selectedTenantId = resolveFacilityTenantId(tenantId, facilities);
    if (!selectedTenantId) {
      setLocalError('Select an authorized hospital facility before signing in.');
      return;
    }
    setGoogleLoading(true);
    try {
      const googleToken = await signInWithGoogle();
      if (!googleToken) {
        setLocalError('Google Identity sign-in was cancelled before authentication completed.');
        return;
      }

      const result = await signInFederated({
        tenantId: selectedTenantId,
        rememberDevice,
      });

      if (result?.authenticated && typeof window !== 'undefined') {
        if (window.location.pathname === '/login') {
          router.replace('/');
        } else {
          router.refresh();
        }
      }
    } catch (err: any) {
      const mapped = mapAuthError(err);
      setLocalError(mapped.userMessage || 'Google Identity sign in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSSOLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSsoError(null);
    setSsoLoading(true);

    if (!ssoEmail || !ssoEmail.includes('@')) {
      setSsoError('Please enter your corporate medical staff email address.');
      setSsoLoading(false);
      return;
    }

    const selectedTenantId = resolveFacilityTenantId(tenantId, facilities);
    if (!selectedTenantId) {
      setSsoError('Select an authorized hospital facility before enterprise SSO.');
      setSsoLoading(false);
      return;
    }

    try {
      const result = await signInSSO(
        ssoEmail,
        selectedTenantId,
        ssoProvider
      );
      if (result?.authenticated) {
        setSsoModalOpen(false);
        if (typeof window !== 'undefined') {
          if (window.location.pathname === '/login') {
            router.replace('/');
          } else {
            router.refresh();
          }
        }
      }
    } catch (err: any) {
      setSsoError(err?.userMessage || err?.message || 'Single Sign-On authentication failed');
    } finally {
      setSsoLoading(false);
    }
  };

  const handleSelectPersona = (persona: Persona) => {
    setEmail(persona.email);
    setPassword('');
    setTenantId(persona.tenantId);
    setLocalError(null);
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-blue-600 selection:text-white">
      {/* Header Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ActivitySquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
              G-HIMS OS
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                v2026.1 Enterprise
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Generative Hospital Information Management System
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Server-Authoritative Identity
          </span>
        </div>
      </header>

      {/* Main Login Workspace */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-12 relative">
        <div className="w-full max-w-xl space-y-4">
          {/* Main Card: Login Form */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            <div className="mb-6 space-y-1.5 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-semibold text-blue-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Clinical & Operational Authentication</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Hospital Personnel Sign In
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Authenticate with authorized institutional credentials to access the EHR & clinical runtime.
              </p>
            </div>

            {displayError && (
              <div className="mb-6 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-xs text-red-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <div className="flex-1 leading-relaxed">{displayError}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Required Facility Scope */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Hospital Facility <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <select
                    data-testid="login-tenant-id"
                    required
                    value={tenantId}
                    onChange={(e) => {
                      setTenantId(e.target.value);
                      setLocalError(null);
                    }}
                    className="w-full appearance-none pl-10 pr-10 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition cursor-pointer"
                  >
                    <option value="" disabled>
                      {facilitiesLoading
                        ? 'Loading hospital facilities...'
                        : 'Select hospital facility'}
                    </option>
                    {facilities.map((facility) => (
                      <option key={facility.tenantId} value={facility.tenantId}>
                        {facility.name}
                        {facility.facilityCode
                          ? ` · ${facility.facilityCode}`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-3 pointer-events-none" />
                </div>
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Facility selection is required. Facilities are loaded from the configured Firestore tenant directory; access is still verified against your active server-authoritative hospital membership.
                </p>
                {facilityLoadError && (
                  <p
                    data-testid="login-facility-directory-error"
                    className="text-[10px] leading-relaxed text-amber-400"
                  >
                    {facilityLoadError}
                  </p>
                )}
              </div>

              {/* Email Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Staff Email Address
                </label>
                <div className="relative">
                  <input
                    data-testid="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="physician@centralmetro.health"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-600"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-300">
                    Security Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-[11px] text-blue-400 hover:text-blue-300 transition"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    data-testid="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-600 font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Remember Workstation Checkbox */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <Laptop className="w-3.5 h-3.5 text-slate-400" />
                    Register this workstation terminal
                  </span>
                </label>
              </div>

              {/* Submit Action */}
              <button
                data-testid="login-submit"
                type="submit"
                disabled={submitting || ssoLoading}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow-lg shadow-blue-600/25 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2 cursor-pointer"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Verifying Credentials & Establishing Session...</span>
                  </span>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Sign In to G-HIMS</span>
                  </>
                )}
              </button>

              {/* SSO & Federated Identity Divider */}
              <div className="relative my-3 flex items-center justify-center">
                <div className="border-t border-slate-800 w-full" />
                <span className="bg-slate-900/90 px-2 text-[10px] uppercase font-mono font-bold text-slate-500 shrink-0">
                  or Federated Identity
                </span>
                <div className="border-t border-slate-800 w-full" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Google Workspace / Hospital Identity Sign In */}
                <button
                  type="button"
                  data-testid="login-google-identity"
                  onClick={handleGoogleSignIn}
                  disabled={submitting || googleLoading}
                  className="w-full py-2.5 px-3 rounded-xl border border-slate-700/80 bg-slate-950/70 hover:bg-slate-800 text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {googleLoading ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Authenticating...
                    </span>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5 text-blue-400" />
                      <span>Google Identity</span>
                    </>
                  )}
                </button>

                {/* SSO Modal Button */}
                <button
                  type="button"
                  data-testid="login-hospital-sso"
                  onClick={() => {
                    setSsoError(null);
                    setSsoModalOpen(true);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border border-slate-700/80 bg-slate-950/60 hover:bg-slate-800/80 text-slate-300 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Key className="w-3.5 h-3.5 text-slate-400" />
                  <span>Hospital SSO</span>
                </button>
              </div>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Firebase identity + server session
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                Session Timeout: 15 min
              </span>
            </div>
          </div>

          {/* Offline & Architecture Assurance Banner */}
          <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3.5 flex items-center gap-3 text-xs text-slate-400">
            <Laptop className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-semibold text-slate-200">Offline-Ready Architecture:</span> Offline continuity is bounded by cached authenticated sessions; protected mutations synchronize automatically upon reconnection.
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/30 px-6 py-3 text-center text-xs text-slate-400">
        G-HIMS Production Identity & Access Governance System &bull; Strictly Confidential Clinical Data
      </footer>

      {/* Enterprise Single Sign-On (SSO) Modal */}
      {ssoModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Enterprise Single Sign-On
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    SAML 2.0 / OpenID Connect Federated Auth
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSsoModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Provider Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 block">
                Select Identity Provider:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSsoProvider('OKTA')}
                  className={`p-2.5 rounded-xl border text-xs font-bold text-left transition-all ${
                    ssoProvider === 'OKTA'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>Okta SAML 2.0</span>
                    <Radio className="w-3 h-3 text-blue-400" />
                  </div>
                  <div className="text-[10px] font-normal text-slate-400">Hospital IdP</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSsoProvider('AZURE_AD')}
                  className={`p-2.5 rounded-xl border text-xs font-bold text-left transition-all ${
                    ssoProvider === 'AZURE_AD'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>Microsoft Entra ID</span>
                    <Radio className="w-3 h-3 text-blue-400" />
                  </div>
                  <div className="text-[10px] font-normal text-slate-400">Azure Active Directory</div>
                </button>
              </div>
            </div>

            {ssoError && (
              <div
                data-testid="login-sso-error"
                className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{ssoError}</span>
              </div>
            )}

            <form onSubmit={handleSSOLogin} className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Staff Corporate Email Address:
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={ssoEmail}
                    onChange={(e) => setSsoEmail(e.target.value)}
                    placeholder="physician@centralmetro.health"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                </div>
                <div className="text-[11px] text-slate-400 leading-tight">
                  You will be redirected through the hospital federated identity gateway for mutual TLS & FIDO2 authentication.
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSsoModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  data-testid="login-sso-submit"
                  type="submit"
                  disabled={ssoLoading}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {ssoLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Authenticating IdP...</span>
                    </>
                  ) : (
                    <>
                      <Key className="w-3.5 h-3.5" />
                      <span>Authenticate via SSO</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
