'use client';

import React, { useState, useEffect } from 'react';
import {
  SSOConfiguration,
  SSOProviderType,
  SSOTestResult,
} from '@/lib/auth/sso-types';
import {
  getSSOConfiguration,
  saveSSOConfiguration,
  testSSOConfiguration,
} from '@/lib/auth/sso-service';
import {
  Key,
  ShieldCheck,
  Building2,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ExternalLink,
  Users,
  Sliders,
  FileCode,
  Globe,
  Radio,
} from 'lucide-react';

interface SSOConfigurationSectionProps {
  tenantId: string;
}

const SSO_PROVIDERS: { id: SSOProviderType; name: string; desc: string; protocol: 'SAML' | 'OIDC' }[] = [
  { id: 'OKTA', name: 'Okta SAML 2.0 / OIDC', desc: 'Enterprise Identity Cloud for Healthcare Staff', protocol: 'SAML' },
  { id: 'AZURE_AD', name: 'Microsoft Entra ID (Azure AD)', desc: 'Hospital Active Directory & Office 365 Federation', protocol: 'OIDC' },
  { id: 'SAML_2_0', name: 'Generic SAML 2.0 IdP', desc: 'Shibboleth, PingFederate, or Custom SAML Provider', protocol: 'SAML' },
  { id: 'OIDC', name: 'Standard OpenID Connect (OIDC)', desc: 'OAuth 2.0 / OpenID Connect Enterprise Discovery', protocol: 'OIDC' },
  { id: 'GOOGLE_WORKSPACE', name: 'Google Workspace Enterprise', desc: 'OAuth 2.0 / SAML for Health Systems', protocol: 'OIDC' },
  { id: 'PING_IDENTITY', name: 'Ping Identity (PingOne)', desc: 'FIPS 140-2 Compliant Hospital Federation', protocol: 'SAML' },
];

export function SSOConfigurationSection({ tenantId }: SSOConfigurationSectionProps) {
  const [config, setConfig] = useState<SSOConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [copiedAcs, setCopiedAcs] = useState(false);
  const [copiedEntityId, setCopiedEntityId] = useState(false);

  // Test Connection State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SSOTestResult | null>(null);

  // Domains input
  const [domainInput, setDomainInput] = useState('');

  const loadConfig = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSSOConfiguration(tenantId);
      setConfig(data);
      setDomainInput(data.allowedEmailDomains.join(', '));
    } catch (err) {
      console.error('Failed to load SSO configuration:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleCopyAcs = () => {
    if (!config) return;
    navigator.clipboard.writeText(config.acsUrl);
    setCopiedAcs(true);
    setTimeout(() => setCopiedAcs(false), 2000);
  };

  const handleCopyEntityId = () => {
    if (!config) return;
    navigator.clipboard.writeText(config.entityId);
    setCopiedEntityId(true);
    setTimeout(() => setCopiedEntityId(false), 2000);
  };

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!config) return;

    setIsSaving(true);
    setSaveMessage(null);

    const domains = domainInput
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    const updatedConfig: SSOConfiguration = {
      ...config,
      allowedEmailDomains: domains.length > 0 ? domains : ['centralmetro.health'],
      updatedAt: new Date().toISOString(),
    };

    try {
      const saved = await saveSSOConfiguration(tenantId, updatedConfig);
      setConfig(saved);
      setSaveMessage('SSO Identity Provider configuration saved and published across hospital nodes.');
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err: any) {
      setSaveMessage(`Error saving SSO settings: ${err?.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestHandshake = async () => {
    if (!config) return;
    setTesting(true);
    setTestResult(null);

    try {
      const res = await testSSOConfiguration(config);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        providerType: config.providerType,
        entityId: config.entityId,
        statusMessage: err?.message || 'Handshake failed',
        certificateValid: false,
        endpointsReachable: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
        <span>Loading Enterprise Single Sign-On (SSO) federation policies...</span>
      </div>
    );
  }

  const isSaml = config.providerType === 'SAML_2_0' || config.providerType === 'OKTA' || config.providerType === 'PING_IDENTITY';

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Enterprise Single Sign-On (SSO / SAML / OIDC)
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              Identity Federation
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Federate hospital clinical staff authentication via Okta, Microsoft Entra ID (Azure AD), SAML 2.0, or OpenID Connect with Just-In-Time (JIT) role provisioning and strict AuthGuard enforcement.
          </p>
        </div>

        {/* Global Save Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleTestHandshake}
            disabled={testing}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span>{testing ? 'Verifying TLS...' : 'Test IdP Handshake'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSaveConfig()}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSaving ? 'Publishing...' : 'Save SSO Settings'}</span>
          </button>
        </div>
      </div>

      {/* Success Alert */}
      {saveMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{saveMessage}</span>
          </div>
          <button type="button" onClick={() => setSaveMessage(null)} className="cursor-pointer">✕</button>
        </div>
      )}

      {/* Test Diagnostic Result Banner */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border space-y-2 animate-in fade-in duration-150 ${
            testResult.success
              ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
              : 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs">
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              )}
              <span>IdP Handshake Diagnostic Result ({testResult.providerType})</span>
            </div>
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              Roundtrip: {testResult.latencyMs}ms
            </span>
          </div>

          <p className="text-xs leading-relaxed">{testResult.statusMessage}</p>

          {testResult.simulatedAttributes && (
            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                Simulated Inbound SAML/OIDC Claims:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-[10px]">
                {Object.entries(testResult.simulatedAttributes).map(([k, v]) => (
                  <div key={k} className="p-1 rounded bg-white/60 dark:bg-slate-900/60 flex items-center justify-between gap-2 truncate">
                    <span className="text-slate-500 truncate">{k.split('/').pop()}:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Master SSO Switch & Status */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Enable SSO for Hospital Staff</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${config.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-600'}`}>
                {config.enabled ? 'ACTIVE FEDERATION' : 'DISABLED'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              When enabled, hospital staff can sign in using their corporate Identity Provider credentials.
            </div>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Provider Selector Cards */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-900 dark:text-white block">
          Select Identity Provider (IdP) Platform
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SSO_PROVIDERS.map((provider) => {
            const isSelected = config.providerType === provider.id;
            return (
              <div
                key={provider.id}
                onClick={() => setConfig({ ...config, providerType: provider.id })}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-slate-900 dark:text-white">
                    {provider.name}
                  </span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {provider.protocol}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                  {provider.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Service Provider (SP) Metadata Exchange */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-900 dark:text-white">
            G-HIMS Service Provider (SP) Metadata & Endpoints
          </h3>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Provide these endpoints to your hospital Identity Provider (Okta / Azure AD / Ping) administrator to configure the SAML 2.0 / OIDC client application.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* ACS Callback URL */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-slate-400">
              Assertion Consumer Service (ACS / Callback URL)
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                readOnly
                value={config.acsUrl}
                className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={handleCopyAcs}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                title="Copy URL"
              >
                {copiedAcs ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAcs ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* SP Entity ID / Audience URI */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-slate-400">
              Audience URI / SP Entity ID
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                readOnly
                value={`https://${config.tenantId || 'centralmetro'}.ghims.health/saml/sp`}
                className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={handleCopyEntityId}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                title="Copy Entity ID"
              >
                {copiedEntityId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedEntityId ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Identity Provider Configuration Form */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-900 dark:text-white">
            Identity Provider (IdP) Connection Parameters
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Provider Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Display Provider Name
            </label>
            <input
              type="text"
              value={config.providerName}
              onChange={(e) => setConfig({ ...config, providerName: e.target.value })}
              placeholder="e.g. Hospital Okta SAML 2.0"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            />
          </div>

          {/* Entity ID / Issuer URI */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              IdP Issuer / Entity ID URL
            </label>
            <input
              type="text"
              value={config.entityId}
              onChange={(e) => setConfig({ ...config, entityId: e.target.value })}
              placeholder="https://idp.hospital.org/saml2/metadata"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
            />
          </div>

          {/* SSO Sign-On URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              IdP Single Sign-On (SSO) URL
            </label>
            <input
              type="text"
              value={config.ssoSignOnUrl}
              onChange={(e) => setConfig({ ...config, ssoSignOnUrl: e.target.value })}
              placeholder="https://idp.hospital.org/app/sso/saml"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
            />
          </div>

          {/* Authorized Domains */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Authorized Email Domains
            </label>
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="centralmetro.health, hospital.org"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
            />
            <div className="text-[10px] text-slate-400">
              Staff entering matching emails are routed to this SSO provider.
            </div>
          </div>
        </div>

        {/* Certificate / Secret Section */}
        {isSaml ? (
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                X.509 Public Signing Certificate (PEM)
              </label>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                TLS 1.3 Signature Key
              </span>
            </div>
            <textarea
              rows={4}
              value={config.certificate || ''}
              onChange={(e) => setConfig({ ...config, certificate: e.target.value })}
              placeholder="-----BEGIN CERTIFICATE-----&#10;MIICljCCAX4CCQDzW...&#10;-----END CERTIFICATE-----"
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono leading-relaxed"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                OIDC Client ID
              </label>
              <input
                type="text"
                value={config.clientId || ''}
                onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
                placeholder="0oa4819z1x88BqPl7697"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                OIDC Discovery Endpoint
              </label>
              <input
                type="text"
                value={config.oidcDiscoveryUrl || ''}
                onChange={(e) => setConfig({ ...config, oidcDiscoveryUrl: e.target.value })}
                placeholder="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {/* Role & Department Mapping + JIT Provisioning */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-900 dark:text-white">
            Staff Role Mapping & Just-In-Time (JIT) Auto-Provisioning
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Default Clinical Role
            </label>
            <select
              value={config.defaultRole}
              onChange={(e) => setConfig({ ...config, defaultRole: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value="physician">Attending Physician / Doctor</option>
              <option value="nurse">Registered Nurse (RN / Head Nurse)</option>
              <option value="pharmacist">Clinical Pharmacist</option>
              <option value="triage_specialist">Emergency Triage Specialist</option>
              <option value="billing_officer">Revenue Auditor / Billing Officer</option>
              <option value="admin">Hospital Administrator</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Default Clinical Department
            </label>
            <select
              value={config.defaultDepartment}
              onChange={(e) => setConfig({ ...config, defaultDepartment: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <option value="Cardiology & Intensive Care">Cardiology & Intensive Care</option>
              <option value="Emergency & Trauma (ER)">Emergency & Trauma (ER)</option>
              <option value="General Surgery & OR">General Surgery & OR</option>
              <option value="Pediatrics & Neonatal ICU">Pediatrics & Neonatal ICU</option>
              <option value="Revenue Cycle & Claims">Revenue Cycle & Claims</option>
              <option value="Executive Administration">Executive Administration</option>
            </select>
          </div>

          <div className="space-y-1.5 flex flex-col justify-end">
            <label className="flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-750 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoProvisionUsers}
                onChange={(e) => setConfig({ ...config, autoProvisionUsers: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Just-In-Time (JIT) Account Creation
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Security Enforcement Policy */}
      <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                Enforce SSO for All Hospital Staff
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                When enforced, staff with matching hospital email domains cannot sign in using standard local passwords; they must authenticate through SAML/OIDC.
              </div>
            </div>
          </div>

          <input
            type="checkbox"
            checked={config.enforceSSO}
            onChange={(e) => setConfig({ ...config, enforceSSO: e.target.checked })}
            className="w-5 h-5 text-amber-600 rounded cursor-pointer mt-1"
          />
        </div>
      </div>
    </div>
  );
}
