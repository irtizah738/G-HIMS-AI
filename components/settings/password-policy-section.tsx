'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  SecurityPolicyConfig,
  MFAEnforcementLevel,
  MFAMethod,
  getSecurityPolicy,
  saveSecurityPolicy,
  validatePasswordAgainstPolicy,
  DEFAULT_SECURITY_POLICY,
} from '@/lib/auth/security-policy-service';
import {
  ShieldCheck,
  Lock,
  KeyRound,
  Clock,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Sliders,
  Check,
  X,
  Info,
  Laptop,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Radio,
} from 'lucide-react';

interface PasswordPolicySectionProps {
  tenantId: string;
}

const MFA_LEVELS: { id: MFAEnforcementLevel; label: string; desc: string; badge: string }[] = [
  {
    id: 'REQUIRED_ALL_STAFF',
    label: 'Enforced for All Personnel (Recommended)',
    desc: 'Mandatory 2FA for 100% of staff, physicians, nurses, and administrative users upon login.',
    badge: 'HIPAA High Security',
  },
  {
    id: 'REQUIRED_CLINICAL_ROLES',
    label: 'Enforced for Clinical & Prescribing Roles',
    desc: 'Mandatory 2FA for Attending Physicians, Pharmacists, and Triage Nurses with EHR write access.',
    badge: 'Clinical Compliance',
  },
  {
    id: 'REQUIRED_ADMINS_ONLY',
    label: 'Enforced for System Administrators Only',
    desc: 'Mandatory 2FA for Hospital IT, CISO, and tenant configuration roles.',
    badge: 'Admin Only',
  },
  {
    id: 'OPTIONAL',
    label: 'Optional (Advisory Warning)',
    desc: 'Staff can opt-in to 2FA. Generates a security notice upon clinical workstation login.',
    badge: 'Advisory Mode',
  },
];

const MFA_METHODS: { id: MFAMethod; label: string; icon: string; desc: string }[] = [
  {
    id: 'TOTP_AUTHENTICATOR',
    label: 'Authenticator App (TOTP)',
    icon: '📱',
    desc: 'Google Authenticator, Microsoft Authenticator, Duo, or Authy time-based 6-digit codes.',
  },
  {
    id: 'FIDO2_WEBAUTHN',
    label: 'FIDO2 / WebAuthn Hardware Security Key',
    icon: '🔑',
    desc: 'YubiKey, Titan Security Key, or PKI smartcard USB/NFC token.',
  },
  {
    id: 'BIOMETRIC_PASSKEY',
    label: 'Workstation Biometric Passkey',
    icon: '👆',
    desc: 'TouchID, Windows Hello, or mobile device platform biometric authentication.',
  },
  {
    id: 'SMS_EMAIL_OTP',
    label: 'SMS / Secure Email One-Time Code',
    icon: '✉️',
    desc: 'Fallback verification code dispatched via hospital cellular pager bridge or email.',
  },
];

export function PasswordPolicySection({ tenantId }: PasswordPolicySectionProps) {
  const [policy, setPolicy] = useState<SecurityPolicyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Interactive Test Password Sandbox
  const [testPassword, setTestPassword] = useState('HospitalAdmin2026!');
  const [showTestPassword, setShowTestPassword] = useState(false);
  const [newIpInput, setNewIpInput] = useState('');

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSecurityPolicy(tenantId);
      setPolicy(data);
    } catch (err) {
      console.error('Failed to load security policy from Firestore:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const handleSave = async () => {
    if (!policy) return;
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const updated = await saveSecurityPolicy(tenantId, policy);
      setPolicy(updated);
      setSaveMessage('Password complexity & session security policies saved to Firestore and synchronized across hospital nodes.');
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err: any) {
      setSaveMessage(`Error saving policy: ${err?.message || 'Firestore write error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetBaseline = () => {
    if (typeof window !== 'undefined' && window.confirm('Reset all password complexity and session timeout rules to HIPAA recommended defaults?')) {
      const seed: SecurityPolicyConfig = {
        ...DEFAULT_SECURITY_POLICY,
        tenantId,
        updatedAt: new Date().toISOString(),
      };
      setPolicy(seed);
      setSaveMessage('Policy reset to HIPAA Security Rule baseline. Click "Save Policy" to publish.');
    }
  };

  const handleAddIp = () => {
    if (!newIpInput || !policy) return;
    const cidr = newIpInput.trim();
    if (!cidr.includes('/') && !cidr.includes('.')) {
      if (typeof window !== 'undefined') {
        window.alert('Please enter a valid CIDR range (e.g. 192.168.1.0/24)');
      }
      return;
    }
    setPolicy({
      ...policy,
      ipWhitelist: [...policy.ipWhitelist, cidr],
    });
    setNewIpInput('');
  };

  const handleRemoveIp = (index: number) => {
    if (!policy) return;
    setPolicy({
      ...policy,
      ipWhitelist: policy.ipWhitelist.filter((_, i) => i !== index),
    });
  };

  const toggleMfaMethod = (method: MFAMethod) => {
    if (!policy) return;
    const current = policy.allowedMfaMethods || [];
    if (current.includes(method)) {
      if (current.length === 1) {
        if (typeof window !== 'undefined') {
          window.alert('At least one MFA method must remain active.');
        }
        return;
      }
      setPolicy({
        ...policy,
        allowedMfaMethods: current.filter((m) => m !== method),
      });
    } else {
      setPolicy({
        ...policy,
        allowedMfaMethods: [...current, method],
      });
    }
  };

  if (loading || !policy) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
        <span>Loading Password Policy & Session Security policies from Firestore...</span>
      </div>
    );
  }

  // Calculate live test password score
  const validation = validatePasswordAgainstPolicy(testPassword, policy);

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Password Policy & Session Security
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              HIPAA §164.312(a)(2)
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure minimum password complexity, workstation inactivity lockout thresholds, concurrent session quotas, and multi-factor authentication (MFA) enforcement.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleResetBaseline}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset Baseline</span>
          </button>

          <button
            type="button"
            id="btn-save-security-policy"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? 'Saving to Firestore...' : 'Save Policy'}</span>
          </button>
        </div>
      </div>

      {/* Save Success Alert */}
      {saveMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{saveMessage}</span>
          </div>
          <button type="button" onClick={() => setSaveMessage(null)} className="cursor-pointer">✕</button>
        </div>
      )}

      {/* 1. PASSWORD COMPLEXITY & EXPIRATION CARD */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-200 dark:border-blue-800">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Password Complexity & Entropy Requirements
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                NIST SP 800-63B guidelines and HIPAA administrative safeguards for credential entropy.
              </p>
            </div>
          </div>
        </div>

        {/* Minimum Length Slider */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                Minimum Password Length
              </label>
              <p className="text-[11px] text-slate-500">
                Minimum required character count for medical and administrative staff credentials.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-lg bg-blue-600 text-white font-mono font-bold text-xs">
                {policy.minPasswordLength} chars
              </span>
            </div>
          </div>

          <input
            type="range"
            min={8}
            max={32}
            step={1}
            value={policy.minPasswordLength}
            onChange={(e) =>
              setPolicy({ ...policy, minPasswordLength: Number(e.target.value) })
            }
            className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />

          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>8 chars (Basic)</span>
            <span className="font-bold text-blue-600 dark:text-blue-400">12 chars (HIPAA Standard)</span>
            <span>16 chars (High Entropy)</span>
            <span>32 chars (Maximum)</span>
          </div>
        </div>

        {/* Character Composition Requirements */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Uppercase Letters</div>
              <div className="text-[11px] text-slate-500">Require at least one [A-Z]</div>
            </div>
            <input
              type="checkbox"
              checked={policy.requireUppercase}
              onChange={(e) => setPolicy({ ...policy, requireUppercase: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
          </label>

          <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Lowercase Letters</div>
              <div className="text-[11px] text-slate-500">Require at least one [a-z]</div>
            </div>
            <input
              type="checkbox"
              checked={policy.requireLowercase}
              onChange={(e) => setPolicy({ ...policy, requireLowercase: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
          </label>

          <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Numeric Digits</div>
              <div className="text-[11px] text-slate-500">Require at least one [0-9]</div>
            </div>
            <input
              type="checkbox"
              checked={policy.requireNumbers}
              onChange={(e) => setPolicy({ ...policy, requireNumbers: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
          </label>

          <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Special Symbols</div>
              <div className="text-[11px] text-slate-500">Require [!@#$%^&*...]</div>
            </div>
            <input
              type="checkbox"
              checked={policy.requireSymbols}
              onChange={(e) => setPolicy({ ...policy, requireSymbols: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
          </label>
        </div>

        {/* Expiration, History & Lockout Thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 dark:text-white">
              Password Expiration Cycle
            </label>
            <select
              value={policy.maxPasswordAgeDays}
              onChange={(e) => setPolicy({ ...policy, maxPasswordAgeDays: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={30}>Every 30 Days (Strict High-Risk)</option>
              <option value={60}>Every 60 Days</option>
              <option value={90}>Every 90 Days (Hospital Recommended)</option>
              <option value={180}>Every 180 Days (Semi-Annual)</option>
              <option value={365}>Every 365 Days (Annual)</option>
              <option value={0}>Never Expire (NIST SP 800-63B Modern)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 dark:text-white">
              Prevent Password Reuse History
            </label>
            <select
              value={policy.preventReuseCount}
              onChange={(e) => setPolicy({ ...policy, preventReuseCount: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={3}>Last 3 Passwords</option>
              <option value={5}>Last 5 Passwords (Recommended)</option>
              <option value={10}>Last 10 Passwords</option>
              <option value={24}>Last 24 Passwords (Strict DoD Level)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 dark:text-white">
              Failed Attempts Account Lockout
            </label>
            <select
              value={policy.maxFailedAttempts}
              onChange={(e) => setPolicy({ ...policy, maxFailedAttempts: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={3}>Lock after 3 failed attempts (Strict)</option>
              <option value={5}>Lock after 5 failed attempts (Standard)</option>
              <option value={10}>Lock after 10 failed attempts</option>
            </select>
          </div>
        </div>

        {/* Live Test Password Validator Sandbox */}
        <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Interactive Policy Verification Sandbox
              </span>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
              validation.valid
                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
            }`}>
              Entropy Score: {validation.score}% {validation.valid ? '• COMPLIANT' : '• NON-COMPLIANT'}
            </span>
          </div>

          <div className="relative">
            <input
              type={showTestPassword ? 'text' : 'password'}
              value={testPassword}
              onChange={(e) => setTestPassword(e.target.value)}
              placeholder="Test a sample password against active rules..."
              className="w-full px-3.5 py-2 pr-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setShowTestPassword(!showTestPassword)}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {showTestPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
            <div className={`flex items-center gap-1.5 font-medium ${validation.checks.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {validation.checks.length ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>{policy.minPasswordLength}+ Chars</span>
            </div>
            <div className={`flex items-center gap-1.5 font-medium ${validation.checks.uppercase ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {validation.checks.uppercase ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>Uppercase</span>
            </div>
            <div className={`flex items-center gap-1.5 font-medium ${validation.checks.lowercase ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {validation.checks.lowercase ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>Lowercase</span>
            </div>
            <div className={`flex items-center gap-1.5 font-medium ${validation.checks.numbers ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {validation.checks.numbers ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>Number</span>
            </div>
            <div className={`flex items-center gap-1.5 font-medium ${validation.checks.symbols ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {validation.checks.symbols ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>Special Symbol</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. WORKSTATION SESSION TIMEOUT & INACTIVITY DURATIONS */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-800">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Workstation Session Timeout & Inactivity Durations
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              HIPAA §164.312(a)(2)(iii) automated lockout policies to prevent unattended terminal data leakage.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Idle Timeout */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                Inactivity Lock Screen Timeout
              </label>
              <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                {policy.idleTimeoutMinutes} Minutes
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Locks the EHR screen if no mouse/keyboard activity is detected on the workstation.
            </p>
            <select
              value={policy.idleTimeoutMinutes}
              onChange={(e) => setPolicy({ ...policy, idleTimeoutMinutes: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={5}>5 Minutes (Public Triage / Crash Carts)</option>
              <option value={10}>10 Minutes (Standard Clinical Station)</option>
              <option value={15}>15 Minutes (Hospital Recommended Standard)</option>
              <option value={30}>30 Minutes (Physician Private Office)</option>
              <option value={60}>60 Minutes (Backoffice Finance Only)</option>
            </select>
          </div>

          {/* Absolute Max Session Lifetime */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                Absolute Session Lifetime (Re-Auth)
              </label>
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                {policy.absoluteSessionTimeoutHours} Hours
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Forces full re-authentication regardless of active usage to refresh encryption tokens.
            </p>
            <select
              value={policy.absoluteSessionTimeoutHours}
              onChange={(e) => setPolicy({ ...policy, absoluteSessionTimeoutHours: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={4}>4 Hours (High Security Critical Care)</option>
              <option value={8}>8 Hours (Single Shift Standard)</option>
              <option value={12}>12 Hours (12-Hour Nursing Rotation)</option>
              <option value={24}>24 Hours (Daily Token Expiration)</option>
              <option value={72}>72 Hours (Extended Mobile Clinician)</option>
            </select>
          </div>

          {/* Max Concurrent Sessions */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                Max Concurrent Workstation Logins
              </label>
              <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                {policy.maxConcurrentSessions === 0 ? 'Unlimited' : `${policy.maxConcurrentSessions} Stations`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Limits the number of simultaneous active logins per clinical account.
            </p>
            <select
              value={policy.maxConcurrentSessions}
              onChange={(e) => setPolicy({ ...policy, maxConcurrentSessions: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={1}>1 Station (Strict Single Active Workstation)</option>
              <option value={2}>2 Stations (Workstation + Mobile Tablet)</option>
              <option value={3}>3 Stations (Recommended for Mobile MDs)</option>
              <option value={5}>5 Stations</option>
              <option value={0}>Unlimited Concurrent Logins</option>
            </select>
          </div>

          {/* Remember Trusted Device */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                Trusted Workstation Token Validity
              </label>
              <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                {policy.rememberDeviceDays} Days
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Duration a verified hospital workstation device certificate remains remembered.
            </p>
            <select
              value={policy.rememberDeviceDays}
              onChange={(e) => setPolicy({ ...policy, rememberDeviceDays: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={1}>1 Day (Daily Device Verification)</option>
              <option value={7}>7 Days (Weekly)</option>
              <option value={14}>14 Days (Bi-Weekly Hospital Standard)</option>
              <option value={30}>30 Days (Monthly)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. MULTI-FACTOR AUTHENTICATION (MFA) ENFORCEMENT */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Multi-Factor Authentication (MFA) Policies
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Specify 2FA enforcement scope, accepted verification methods, and grace period settings.
            </p>
          </div>
        </div>

        {/* Enforcement Level Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MFA_LEVELS.map((level) => {
            const isSelected = policy.mfaEnforcementLevel === level.id;
            return (
              <div
                key={level.id}
                onClick={() => setPolicy({ ...policy, mfaEnforcementLevel: level.id })}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => setPolicy({ ...policy, mfaEnforcementLevel: level.id })}
                      className="text-blue-600"
                    />
                    <span>{level.label}</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {level.badge}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 ml-5">
                  {level.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* Accepted MFA Methods */}
        <div className="space-y-3 pt-2">
          <label className="text-xs font-bold text-slate-900 dark:text-white block">
            Allowed & Supported 2FA Hardware / Software Factors
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MFA_METHODS.map((m) => {
              const isChecked = (policy.allowedMfaMethods || []).includes(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggleMfaMethod(m.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer flex items-start gap-3 transition-colors ${
                    isChecked
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-850/30 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleMfaMethod(m.id)}
                    className="mt-0.5 text-emerald-600 rounded cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug">
                      {m.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MFA Grace Period & Remember Device */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 dark:text-white">
              Onboarding 2FA Registration Grace Period
            </label>
            <select
              value={policy.mfaGracePeriodDays}
              onChange={(e) => setPolicy({ ...policy, mfaGracePeriodDays: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value={0}>0 Days (Immediate Enforcement on Day 1)</option>
              <option value={3}>3 Days Grace Period</option>
              <option value={7}>7 Days (Recommended for Resident Staff)</option>
              <option value={14}>14 Days Grace Period</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 dark:text-white">
              Allow &quot;Remember 2FA on Trusted Workstation&quot;
            </label>
            <div className="flex items-center gap-3 mt-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={policy.allowRememberMfaDevice}
                  onChange={(e) => setPolicy({ ...policy, allowRememberMfaDevice: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span>Enable Workstation 2FA Caching</span>
              </label>
              {policy.allowRememberMfaDevice && (
                <span className="text-xs font-mono font-bold text-blue-600">
                  for {policy.rememberMfaDays} Days
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. HOSPITAL SUBNET IP CIDR & EMERGENCY OVERRIDE */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-200 dark:border-purple-800">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Hospital Network Perimeter & Break-Glass Overrides
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Restricted IP CIDR network perimeter and emergency clinical chart access elevation.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Enforce IP Whitelist</span>
            <input
              type="checkbox"
              checked={policy.enforceIpWhitelist}
              onChange={(e) => setPolicy({ ...policy, enforceIpWhitelist: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded"
            />
          </label>
        </div>

        {/* IP CIDR Manager */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. 192.168.1.0/24 or 10.200.0.0/16"
              value={newIpInput}
              onChange={(e) => setNewIpInput(e.target.value)}
              className="flex-1 px-3.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
            />
            <button
              type="button"
              onClick={handleAddIp}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-750 dark:hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Subnet</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {(policy.ipWhitelist || []).map((ip, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 flex items-center gap-2"
              >
                <span>{ip}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveIp(idx)}
                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Break-Glass Mode Stamping */}
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                Tenant-Wide Emergency Break-Glass Override
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                Allows attending medical staff emergency override of chart access locks during Code Blue incidents with automatic audit trail recording.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPolicy({ ...policy, breakGlassMode: !policy.breakGlassMode })}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              policy.breakGlassMode
                ? 'bg-amber-600 text-white'
                : 'bg-white dark:bg-slate-850 text-amber-900 dark:text-amber-200 border border-amber-300'
            }`}
          >
            {policy.breakGlassMode ? 'ENABLED (High Alert)' : 'Enable Break-Glass'}
          </button>
        </div>
      </div>
    </div>
  );
}
