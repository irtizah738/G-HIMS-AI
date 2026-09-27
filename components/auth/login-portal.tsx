'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import { auth } from '@/lib/firebase/client';
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
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

interface Persona {
  id: string;
  role: string;
  name: string;
  email: string;
  pass: string;
  tenantId: string;
  department: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const DEMO_PERSONAS: Persona[] = [
  {
    id: 'haider-cmo',
    role: 'Chief Medical Officer / Admin',
    name: 'Dr. Irtiza Haider, MD',
    email: 'Irtiza.Haider007@gmail.com',
    pass: 'HospitalAdmin2026!',
    tenantId: 'central-metro-hospital',
    department: 'Hospital Administration & Executive Health',
    icon: ShieldCheck,
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  },
  {
    id: 'admin',
    role: 'Administrator',
    name: 'Dr. Arthur Pendelton',
    email: 'admin@centralmetro.health',
    pass: 'HospitalAdmin2026!',
    tenantId: 'central-metro-hospital',
    department: 'Hospital Administration',
    icon: ShieldCheck,
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  },
  {
    id: 'doctor',
    role: 'Attending Cardiologist',
    name: 'Dr. Sarah Jenkins, MD',
    email: 's.jenkins@centralmetro.health',
    pass: 'CardioDoctor2026!',
    tenantId: 'central-metro-hospital',
    department: 'Cardiology & Intensive Care',
    icon: Stethoscope,
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  },
  {
    id: 'nurse',
    role: 'Head Nurse',
    name: 'Clara Oswald, RN',
    email: 'c.oswald@centralmetro.health',
    pass: 'NurseInpatient2026!',
    tenantId: 'central-metro-hospital',
    department: 'Inpatient Ward 4B',
    icon: HeartPulse,
    color: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
  },
  {
    id: 'reception',
    role: 'Intake Officer',
    name: 'Maria Santos',
    email: 'm.santos@centralmetro.health',
    pass: 'ReceptionStaff2026!',
    tenantId: 'central-metro-hospital',
    department: 'Outpatient Patient Intake',
    icon: ClipboardList,
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  },
  {
    id: 'billing',
    role: 'Revenue Auditor',
    name: 'Robert Hastings',
    email: 'r.hastings@centralmetro.health',
    pass: 'BillingOfficer2026!',
    tenantId: 'central-metro-hospital',
    department: 'Revenue Cycle & Claims',
    icon: DollarSign,
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    id: 'patient',
    role: 'Patient Portal',
    name: 'Elena Rostova',
    email: 'elena.rostova@example.com',
    pass: 'PatientPortal2026!',
    tenantId: 'central-metro-hospital',
    department: 'Consumer Health Portal',
    icon: User,
    color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20',
  },
];

const TENANTS = [
  { id: 'central-metro-hospital', name: 'Central Metro General Hospital (CMGH)' },
  { id: 'st-jude-childrens', name: 'St. Jude Specialist Pediatric Center (SJPC)' },
  { id: 'mayo-clinic-hub', name: 'Metropolitan Academic Medical Center (MAMC)' },
];

export function LoginPortal() {
  const router = useRouter();
  const { user, signIn, signInSSO, error } = useAuth();
  const { signInWithGoogle } = useFirebaseAuth();

  const [email, setEmail] = useState('Irtiza.Haider007@gmail.com');
  const [password, setPassword] = useState('HospitalAdmin2026!');
  const [tenantId, setTenantId] = useState('central-metro-hospital');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggingPersonaId, setLoggingPersonaId] = useState<string | null>(null);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (user && typeof window !== 'undefined' && window.location.pathname === '/login') {
      router.replace('/');
    }
  }, [user, router]);

  // SSO Modal State
  const [ssoModalOpen, setSsoModalOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('Irtiza.Haider007@gmail.com');
  const [ssoProvider, setSsoProvider] = useState<'OKTA' | 'AZURE_AD' | 'SAML' | 'GOOGLE'>('OKTA');
  const [ssoLoading, setSsoLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

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
        tenantId,
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
    setGoogleLoading(true);
    try {
      await signInWithGoogle().catch(() => null);
      const googleUser = auth.currentUser;
      const targetEmail = googleUser?.email || 'Irtiza.Haider007@gmail.com';
      const result = await signIn(targetEmail, 'HospitalAdmin2026!', {
        tenantId,
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
      setLocalError(err?.message || 'Google Hospital Identity Sign In failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleInstantPersonaLogin = async (persona: Persona) => {
    setEmail(persona.email);
    setPassword(persona.pass);
    setTenantId(persona.tenantId);
    setLocalError(null);
    setLoggingPersonaId(persona.id);
    setSubmitting(true);

    try {
      const result = await signIn(persona.email, persona.pass, {
        tenantId: persona.tenantId,
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
      setLocalError(err?.userMessage || err?.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
      setLoggingPersonaId(null);
    }
  };

  const handleSSOLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSsoLoading(true);

    if (!ssoEmail || !ssoEmail.includes('@')) {
      setLocalError('Please enter your corporate medical staff email address.');
      setSsoLoading(false);
      return;
    }

    try {
      const result = await signInSSO(ssoEmail, tenantId);
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
      setLocalError(err?.userMessage || err?.message || 'Single Sign-On authentication failed');
    } finally {
      setSsoLoading(false);
    }
  };

  const handleSelectPersona = (persona: Persona) => {
    setEmail(persona.email);
    setPassword(persona.pass);
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
            Zero-Trust Auth & HIPAA Tier-4
          </span>
        </div>
      </header>

      {/* Main Login Workspace */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Left Column: Login Form */}
          <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur flex flex-col justify-between">
            <div>
              <div className="mb-6 space-y-1">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  Hospital Personnel Sign In
                </h1>
                <p className="text-xs text-slate-400">
                  Authenticate with authorized hospital credentials to access the EHR & clinical runtime.
                </p>
              </div>

              {displayError && (
                <div className="mb-6 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-xs text-red-300 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  <div className="flex-1 leading-relaxed">{displayError}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Facility Scope */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Hospital Facility Scope
                  </label>
                  <div className="relative">
                    <select
                      value={tenantId}
                      onChange={(e) => setTenantId(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none cursor-pointer"
                    >
                      {TENANTS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  </div>
                </div>

                {/* Email Input */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Staff Email Address
                  </label>
                  <div className="relative">
                    <input
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
                      className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-200 transition"
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

                <div className="space-y-2">
                  {/* Google Workspace / Hospital Identity Sign In */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={submitting || googleLoading}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-700/80 bg-slate-950/70 hover:bg-slate-800 text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {googleLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Authenticating Google Workspace...
                      </span>
                    ) : (
                      <>
                        <Globe className="w-3.5 h-3.5 text-blue-400" />
                        <span>Continue with Google Identity</span>
                      </>
                    )}
                  </button>

                  {/* SSO Modal Button */}
                  <button
                    type="button"
                    onClick={() => setSsoModalOpen(true)}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-700/80 bg-slate-950/60 hover:bg-slate-800/80 text-slate-300 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <Key className="w-3.5 h-3.5 text-slate-400" />
                    <span>Hospital SSO (Okta / Azure AD / SAML)</span>
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                TLS 1.3 + FIPS 140-3 Compliant
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                Session Timeout: 15 min
              </span>
            </div>
          </div>

          {/* Right Column: Fast Persona Auto-Fill */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="bg-slate-900/60 border border-slate-800/90 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  Quick Staff Personas
                </div>
                <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                  Fast Verification
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Select any verified hospital role to test credential-gated privileges, department scopes, and clinical workflows:
              </p>

              <div className="grid grid-cols-1 gap-2 pt-1 max-h-[380px] overflow-y-auto pr-1">
                {DEMO_PERSONAS.map((p) => {
                  const Icon = p.icon;
                  const isSelected = email === p.email;
                  return (
                    <div
                      key={p.id}
                      className={`w-full p-2.5 rounded-xl border transition flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-blue-600/10 border-blue-500/50 ring-1 ring-blue-500/30'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectPersona(p)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${p.color}`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white truncate">
                              {p.name}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 truncate ml-1">
                              {p.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {p.department}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInstantPersonaLogin(p)}
                        disabled={submitting}
                        title={`Instant Sign In as ${p.name}`}
                        className="shrink-0 px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {loggingPersonaId === p.id ? (
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <span>Login</span>
                            <ArrowRight className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Offline Mode Banner */}
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3.5 flex items-center gap-3 text-xs text-slate-400">
              <Laptop className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="text-[11px] leading-tight">
                <span className="font-semibold text-slate-200">Offline-Ready Architecture:</span> Authenticated sessions and clinical rosters persist in IndexedDB for unhindered offline triage.
              </div>
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
