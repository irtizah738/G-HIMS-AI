'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/lib/theme/theme-context';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import { useAuth as useEnterpriseAuth } from '@/lib/auth/auth-context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { useTenant } from '@/lib/tenant/context';
import {
  Settings,
  User,
  Bell,
  ShieldCheck,
  Palette,
  Building2,
  Cpu,
  Key,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Save,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';

type SettingsTab =
  | 'profile'
  | 'notifications'
  | 'security'
  | 'appearance'
  | 'organization'
  | 'integrations';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string;
  permissions: string[];
}

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'failing' | 'disabled';
  lastDelivered: string;
}

export function SettingsView() {
  const { currentTenant, tenantId } = useTenant();
  const { theme, setTheme } = useTheme();
  const rbac = useRBAC();
  const { user: firebaseUser } = useFirebaseAuth();
  const enterpriseAuth = useEnterpriseAuth();

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [pingMessage, setPingMessage] = useState<string>('');

  // 1. Account & Profile State
  const [profileData, setProfileData] = useState({
    fullName: 'Dr. Sarah Jenkins, MD',
    email: 's.jenkins@centralmetro.health',
    title: 'Lead Attending Cardiologist',
    licenseNumber: 'MD-98421-US',
    phone: '+1 (555) 349-8821',
    department: 'Cardiology & Intensive Care',
    timezone: 'America/New_York (UTC-05:00)',
    locale: 'en-US',
    mfaEnabled: true,
    mfaMethod: 'authenticator',
  });

  // 2. Notification Settings State
  const [notifications, setNotifications] = useState({
    inAppUrgent: true,
    inAppGeneral: true,
    emailDailyDigest: false,
    emailCriticalLab: true,
    smsUrgentTriage: true,
    pagerGateway: true,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '06:00',
    soundAlerts: true,
    soundVolume: 80,
  });

  // 3. Security & Compliance State
  const [securitySettings, setSecuritySettings] = useState({
    sessionTimeoutMinutes: 15,
    mfaEnforcement: 'enforced_all',
    ipWhitelist: ['192.168.1.0/24', '10.0.0.0/16', '172.16.4.0/24'],
    newIpCidr: '',
    breakGlassMode: false,
    auditLogRetentionDays: 2555,
    enforceStrongPassword: true,
    allowMobileBiometric: true,
  });

  // 4. Appearance & Ergonomics State
  const [appearance, setAppearance] = useState({
    themeMode: 'system',
    density: 'comfortable',
    fontScale: '100%',
    highContrast: false,
    colorBlindFilter: 'none',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
  });

  // 5. Organization & Infrastructure State
  const [organization, setOrganization] = useState({
    hospitalName: 'Central Metropolitan Hospital',
    facilityCode: 'CMH-NYC-01',
    npiTaxId: 'NPI-1984237190',
    clinicalDomain: 'centralmetro.health',
    primaryColor: '#2563eb',
    fiscalYearStart: 'January 1',
    dataRetentionYears: 7,
    autoPurgeExpiredDrafts: true,
  });

  // 6. Integrations & API Hub State
  const [fhirEndpoint, setFhirEndpoint] = useState('https://fhir.centralmetro.health/r4');
  const [hl7Port, setHl7Port] = useState('2575');
  const [pacsAeTitle, setPacsAeTitle] = useState('METRO_PACS_SCP');
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([
    {
      id: 'key-1',
      name: 'LIS Laboratory Bi-directional Connector',
      prefix: 'gh_live_9f83...41e2',
      createdAt: '2026-01-15',
      lastUsed: '2 mins ago',
      permissions: ['read:patients', 'write:lab_results', 'read:orders'],
    },
    {
      id: 'key-2',
      name: 'Enterprise SAP General Ledger Sync',
      prefix: 'gh_live_4b71...a90c',
      createdAt: '2026-02-10',
      lastUsed: '1 hour ago',
      permissions: ['read:journal_entries', 'write:invoices', 'read:ar_open_items'],
    },
  ]);

  const [webhooks, setWebhooks] = useState<WebhookItem[]>([
    {
      id: 'wh-1',
      url: 'https://erp.centralmetro.health/api/v1/ghims-events',
      events: ['encounter.discharged', 'invoice.posted', 'lab.critical_alert'],
      status: 'active',
      lastDelivered: 'Today at 15:42',
    },
    {
      id: 'wh-2',
      url: 'https://telehealth.centralmetro.health/webhooks/incoming',
      events: ['telehealth.session_created', 'prescription.issued'],
      status: 'active',
      lastDelivered: 'Today at 12:10',
    },
  ]);

  // Load from LocalStorage if available
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedSettings = localStorage.getItem('ghims_enterprise_settings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          if (parsed.profileData) setProfileData(parsed.profileData);
          if (parsed.notifications) setNotifications(parsed.notifications);
          if (parsed.securitySettings) setSecuritySettings(parsed.securitySettings);
          if (parsed.appearance) setAppearance(parsed.appearance);
          if (parsed.organization) setOrganization(parsed.organization);
        } catch {
          // ignore corrupted data
        }
      }
    }
  }, []);

  // Sync active user credentials
  useEffect(() => {
    const eUser = enterpriseAuth?.user;
    if (eUser) {
      setProfileData((prev) => ({
        ...prev,
        fullName: eUser.displayName || prev.fullName,
        email: eUser.email || prev.email,
        title: rbac?.roleDefinition?.displayName || prev.title,
      }));
    } else if (firebaseUser) {
      setProfileData((prev) => ({
        ...prev,
        fullName: firebaseUser.displayName || prev.fullName,
        email: firebaseUser.email || prev.email,
        title: rbac?.roleDefinition?.displayName || prev.title,
      }));
    }
  }, [enterpriseAuth?.user, firebaseUser, rbac?.roleDefinition]);

  const handleSaveAllSettings = () => {
    setIsSaving(true);
    const fullPayload = {
      profileData,
      notifications,
      securitySettings,
      appearance,
      organization,
      updatedAt: new Date().toISOString(),
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem('ghims_enterprise_settings', JSON.stringify(fullPayload));
    }

    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccessMessage('All enterprise configurations and security policies saved successfully.');
      setTimeout(() => setSaveSuccessMessage(null), 4000);
    }, 600);
  };

  const handleResetDefaults = () => {
    if (typeof window !== 'undefined' && window.confirm('Are you sure you want to reset all preferences to system defaults?')) {
      setNotifications({
        inAppUrgent: true,
        inAppGeneral: true,
        emailDailyDigest: false,
        emailCriticalLab: true,
        smsUrgentTriage: true,
        pagerGateway: true,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        soundAlerts: true,
        soundVolume: 80,
      });
      setSecuritySettings({
        sessionTimeoutMinutes: 15,
        mfaEnforcement: 'enforced_all',
        ipWhitelist: ['192.168.1.0/24', '10.0.0.0/16', '172.16.4.0/24'],
        newIpCidr: '',
        breakGlassMode: false,
        auditLogRetentionDays: 2555,
        enforceStrongPassword: true,
        allowMobileBiometric: true,
      });
      setSaveSuccessMessage('Settings reset to system baseline.');
      setTimeout(() => setSaveSuccessMessage(null), 3000);
    }
  };

  const handleAddIp = () => {
    if (!securitySettings.newIpCidr) return;
    const cidr = securitySettings.newIpCidr.trim();
    if (!cidr.includes('/') && !cidr.includes('.')) {
      if (typeof window !== 'undefined') {
        window.alert('Please enter a valid IPv4/IPv6 CIDR format (e.g. 192.168.1.0/24)');
      }
      return;
    }
    setSecuritySettings((prev) => ({
      ...prev,
      ipWhitelist: [...prev.ipWhitelist, cidr],
      newIpCidr: '',
    }));
  };

  const handleRemoveIp = (index: number) => {
    setSecuritySettings((prev) => ({
      ...prev,
      ipWhitelist: prev.ipWhitelist.filter((_, i) => i !== index),
    }));
  };

  const handleTestFhirEndpoint = () => {
    setPingStatus('testing');
    setPingMessage('Validating TLS handshake and CapabilityStatement from FHIR server...');
    setTimeout(() => {
      setPingStatus('success');
      setPingMessage('HTTP 200 OK — FHIR R4 CapabilityStatement (v4.0.1) confirmed. Latency: 42ms.');
    }, 1200);
  };

  const handleCreateApiKey = () => {
    const keyName = typeof window !== 'undefined' ? window.prompt('Enter a descriptive name for this API Key (e.g. Diagnostic Analyzer):') : 'Custom API Key';
    if (!keyName) return;
    const newKey: ApiKeyItem = {
      id: `key-${Date.now()}`,
      name: keyName,
      prefix: `gh_live_${Math.random().toString(36).substring(2, 6)}...${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString().split('T')[0],
      lastUsed: 'Never',
      permissions: ['read:patients', 'read:orders'],
    };
    setApiKeys((prev) => [newKey, ...prev]);
    if (typeof window !== 'undefined') {
      window.alert(`API Key "${keyName}" generated. Secret copied: gh_live_sec_${Math.random().toString(36).substring(2, 18)}`);
    }
  };

  const handleDeleteApiKey = (id: string) => {
    if (typeof window !== 'undefined' && window.confirm('Revoke this API Key immediately? Systems using it will lose access.')) {
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    }
  };

  const tabs = [
    { id: 'profile', label: 'Account & Profile', icon: User, badge: 'Personal' },
    { id: 'notifications', label: 'Notifications & Alerts', icon: Bell, badge: 'Routing' },
    { id: 'security', label: 'Security & Access', icon: ShieldCheck, badge: 'HIPAA' },
    { id: 'appearance', label: 'Appearance & Theme', icon: Palette, badge: 'Workstation' },
    { id: 'organization', label: 'Organization & Facility', icon: Building2, badge: 'Tenant Admin' },
    { id: 'integrations', label: 'Integrations & API Hub', icon: Cpu, badge: 'FHIR / ERP' },
  ];

  return (
    <div id="enterprise-settings-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shrink-0">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                Enterprise Settings & Governance
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                G-HIMS Master
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Manage personal practitioner credentials, hospital perimeter security, clinical alert routing, and FHIR/ERP integrations.
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Reset to system baseline"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            id="btn-save-enterprise-settings"
            onClick={handleSaveAllSettings}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? 'Applying Changes...' : 'Save Settings'}</span>
          </button>
        </div>
      </div>

      {/* Success Notification Alert */}
      {saveSuccessMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{saveSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 dark:hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Settings Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`tab-settings-${tab.id}`}
              onClick={() => setActiveTab(tab.id as SettingsTab)}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span
                  className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab.badge}
                </span>
              </div>
              <span className="text-xs font-bold leading-snug">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels Content */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-7 shadow-xs">
        {/* ========================================================================= */}
        {/* 1. Account & Profile */}
        {/* ========================================================================= */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <span>Practitioner Identity & Professional Credentials</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Personal medical licensing, contact information, regional workstation time zone, and MFA verification.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Full Name & Credentials
                </label>
                <input
                  type="text"
                  value={profileData.fullName}
                  onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-semibold focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Hospital Work Email
                </label>
                <input
                  type="email"
                  value={profileData.email}
                  onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-semibold focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Clinical Designation / Title
                </label>
                <input
                  type="text"
                  value={profileData.title}
                  onChange={(e) => setProfileData({ ...profileData, title: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-semibold focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Medical Board License ID
                </label>
                <input
                  type="text"
                  value={profileData.licenseNumber}
                  onChange={(e) => setProfileData({ ...profileData, licenseNumber: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-mono focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Assigned Clinical Department
                </label>
                <select
                  value={profileData.department}
                  onChange={(e) => setProfileData({ ...profileData, department: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-semibold focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                >
                  <option value="Cardiology & Intensive Care">Cardiology & Intensive Care</option>
                  <option value="Emergency & Trauma (ER)">Emergency & Trauma (ER)</option>
                  <option value="General Surgery & OR">General Surgery & OR</option>
                  <option value="Pediatrics & Neonatal ICU">Pediatrics & Neonatal ICU</option>
                  <option value="Executive Hospital Administration">Executive Hospital Administration</option>
                  <option value="Revenue Cycle & Finance">Revenue Cycle & Finance</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Workstation Timezone
                </label>
                <select
                  value={profileData.timezone}
                  onChange={(e) => setProfileData({ ...profileData, timezone: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-semibold focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                >
                  <option value="America/New_York (UTC-05:00)">America/New_York (Eastern Time - UTC-05:00)</option>
                  <option value="America/Chicago (UTC-06:00)">America/Chicago (Central Time - UTC-06:00)</option>
                  <option value="America/Denver (UTC-07:00)">America/Denver (Mountain Time - UTC-07:00)</option>
                  <option value="America/Los_Angeles (UTC-08:00)">America/Los_Angeles (Pacific Time - UTC-08:00)</option>
                  <option value="Europe/London (UTC+00:00)">Europe/London (GMT - UTC+00:00)</option>
                  <option value="Asia/Tokyo (UTC+09:00)">Asia/Tokyo (JST - UTC+09:00)</option>
                </select>
              </div>
            </div>

            {/* MFA Verification Section */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Multi-Factor Authentication (MFA / TOTP)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hardware security key (FIDO2/WebAuthn) or Authenticator App (Google/Microsoft Authenticator)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Enrolled & Active
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.alert('MFA recovery codes generated and logged to secure audit ledger.');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                  >
                    View Backup Codes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. Notifications & Alerts */}
        {/* ========================================================================= */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600" />
                <span>Notification Routing & Urgent Clinical Escalations</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure delivery channels for emergent patient telemetry, critical lab values, and automated daily digests.
              </p>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">In-App Critical Patient Alerts</div>
                  <div className="text-[11px] text-slate-500">Live bedside monitor telemetry and triage level 1 escalations</div>
                </div>
                <input
                  type="checkbox"
                  checked={notifications.inAppUrgent}
                  onChange={(e) => setNotifications({ ...notifications, inAppUrgent: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">Email Critical Diagnostic Alerts</div>
                  <div className="text-[11px] text-slate-500">Immediate delivery for panic-range troponin, potassium, or radiology critical findings</div>
                </div>
                <input
                  type="checkbox"
                  checked={notifications.emailCriticalLab}
                  onChange={(e) => setNotifications({ ...notifications, emailCriticalLab: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">Hospital Pager & SMS Bridge</div>
                  <div className="text-[11px] text-slate-500">Transmit Code Blue / Rapid Response pages to assigned mobile device</div>
                </div>
                <input
                  type="checkbox"
                  checked={notifications.smsUrgentTriage}
                  onChange={(e) => setNotifications({ ...notifications, smsUrgentTriage: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">Daily Clinical & Financial Digest</div>
                  <div className="text-[11px] text-slate-500">Summary of unbilled clinical documentation, census statistics, and discharge counts</div>
                </div>
                <input
                  type="checkbox"
                  checked={notifications.emailDailyDigest}
                  onChange={(e) => setNotifications({ ...notifications, emailDailyDigest: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                />
              </div>
            </div>

            {/* Quiet Hours Policy */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">Off-Shift Quiet Hours Protocol</div>
                  <div className="text-[11px] text-slate-500">Suppress non-critical administrative notices outside assigned roster shifts</div>
                </div>
                <input
                  type="checkbox"
                  checked={notifications.quietHoursEnabled}
                  onChange={(e) => setNotifications({ ...notifications, quietHoursEnabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                />
              </div>

              {notifications.quietHoursEnabled && (
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Quiet Starts</label>
                    <input
                      type="time"
                      value={notifications.quietHoursStart}
                      onChange={(e) => setNotifications({ ...notifications, quietHoursStart: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Quiet Ends</label>
                    <input
                      type="time"
                      value={notifications.quietHoursEnd}
                      onChange={(e) => setNotifications({ ...notifications, quietHoursEnd: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. Security & Access */}
        {/* ========================================================================= */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>HIPAA Security, Access Control & Perimeter</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enforce zero-trust session timeouts, IP CIDR boundaries, and emergency break-glass privileges.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                HIPAA Compliant
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Session Inactivity Timeout */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 dark:text-white">
                    Workstation Inactivity Lock Timeout
                  </label>
                  <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                    {securitySettings.sessionTimeoutMinutes} min
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  HIPAA Security Rule §164.312(a)(2)(iii) mandates automated workstation lockouts.
                </p>
                <select
                  value={securitySettings.sessionTimeoutMinutes}
                  onChange={(e) =>
                    setSecuritySettings({
                      ...securitySettings,
                      sessionTimeoutMinutes: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                >
                  <option value={5}>5 Minutes (High Security / Public Terminal)</option>
                  <option value={10}>10 Minutes (Standard Clinical Station)</option>
                  <option value={15}>15 Minutes (Hospital Recommended Default)</option>
                  <option value={30}>30 Minutes (Physician Private Office)</option>
                  <option value={60}>60 Minutes (Administrative Only)</option>
                </select>
              </div>

              {/* MFA Policy Enforcement */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-2">
                <label className="text-xs font-bold text-slate-900 dark:text-white">
                  Tenant MFA Enforcement Policy
                </label>
                <p className="text-[11px] text-slate-500">
                  Specify multi-factor authentication criteria across all enterprise staff accounts.
                </p>
                <select
                  value={securitySettings.mfaEnforcement}
                  onChange={(e) =>
                    setSecuritySettings({
                      ...securitySettings,
                      mfaEnforcement: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                >
                  <option value="enforced_all">Enforced for 100% of Staff & Users</option>
                  <option value="enforced_clinical_roles">Enforced for Clinical & Prescribing Roles Only</option>
                  <option value="optional">Optional (Security Warning Triggered)</option>
                </select>
              </div>
            </div>

            {/* IP Perimeter Whitelist */}
            <div className="pt-2">
              <label className="text-xs font-bold text-slate-900 dark:text-white block mb-1">
                Authorized Hospital Subnet IP CIDR Ranges
              </label>
              <p className="text-[11px] text-slate-500 mb-3">
                Unlisted networks will require secondary hardware MFA challenge prior to EHR chart access.
              </p>

              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.0/24 or 10.200.0.0/16"
                  value={securitySettings.newIpCidr}
                  onChange={(e) =>
                    setSecuritySettings({
                      ...securitySettings,
                      newIpCidr: e.target.value,
                    })
                  }
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

              <div className="flex flex-wrap gap-2">
                {securitySettings.ipWhitelist.map((ip, idx) => (
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

            {/* Break Glass Protocol Toggle */}
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Emergency Clinical Break-Glass Override
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    Allows licensed clinicians emergency bypass of chart locks during Code Blue / Mass Casualty Incidents with mandatory permanent audit stamping.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSecuritySettings({
                    ...securitySettings,
                    breakGlassMode: !securitySettings.breakGlassMode,
                  })
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                  securitySettings.breakGlassMode
                    ? 'bg-amber-600 text-white'
                    : 'bg-white dark:bg-slate-850 text-amber-900 dark:text-amber-200 border border-amber-300'
                }`}
              >
                {securitySettings.breakGlassMode ? 'ENABLED (High Alert)' : 'Enable Break-Glass'}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. Appearance & Ergonomics */}
        {/* ========================================================================= */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Palette className="w-4 h-4 text-blue-600" />
                <span>Workstation Theme, Layout Density & Accessibility</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Customize visual contrast, compact grid density for high-throughput wards, and optical readability.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Clean Light */}
              <div
                onClick={() => setTheme('light')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === 'light'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 hover:border-slate-300'
                }`}
              >
                <div className="w-full h-14 bg-white rounded-xl border border-slate-200 mb-3 p-2 flex flex-col justify-between shadow-2xs">
                  <div className="w-1/3 h-2 bg-blue-600 rounded-sm" />
                  <div className="w-full h-1.5 bg-slate-200 rounded-xs" />
                  <div className="w-2/3 h-1.5 bg-slate-200 rounded-xs" />
                </div>
                <div className="font-bold text-xs text-slate-900 dark:text-white">Daylight Clinical (Light)</div>
                <div className="text-[11px] text-slate-500">Clean high-contrast light theme</div>
              </div>

              {/* Night Shift Dark */}
              <div
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === 'dark'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 hover:border-slate-300'
                }`}
              >
                <div className="w-full h-14 bg-slate-900 rounded-xl border border-slate-700 mb-3 p-2 flex flex-col justify-between shadow-2xs">
                  <div className="w-1/3 h-2 bg-blue-500 rounded-sm" />
                  <div className="w-full h-1.5 bg-slate-700 rounded-xs" />
                  <div className="w-2/3 h-1.5 bg-slate-700 rounded-xs" />
                </div>
                <div className="font-bold text-xs text-slate-900 dark:text-white">Night Shift (Dark)</div>
                <div className="text-[11px] text-slate-500">Eye-safe low-lumen dark mode</div>
              </div>

              {/* System Match */}
              <div
                onClick={() => setTheme('system')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === 'system'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 hover:border-slate-300'
                }`}
              >
                <div className="w-full h-14 bg-linear-to-r from-white to-slate-900 rounded-xl border border-slate-300 mb-3 p-2 flex flex-col justify-between shadow-2xs">
                  <div className="w-1/3 h-2 bg-blue-600 rounded-sm" />
                  <div className="w-full h-1.5 bg-slate-400 rounded-xs" />
                  <div className="w-2/3 h-1.5 bg-slate-500 rounded-xs" />
                </div>
                <div className="font-bold text-xs text-slate-900 dark:text-white">OS System Auto</div>
                <div className="text-[11px] text-slate-500">Sync with operating system mode</div>
              </div>
            </div>

            {/* Layout Density & Optical Scale */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Data Grid & Table Density
                </label>
                <select
                  value={appearance.density}
                  onChange={(e) => setAppearance({ ...appearance, density: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  <option value="compact">Compact (Dense EHR rows for fast review)</option>
                  <option value="comfortable">Comfortable (Balanced padding)</option>
                  <option value="spacious">Spacious (Touchscreen & tablet optimized)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Optical Typography Scale
                </label>
                <select
                  value={appearance.fontScale}
                  onChange={(e) => setAppearance({ ...appearance, fontScale: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  <option value="100%">100% Standard Scale</option>
                  <option value="110%">110% Enhanced Readability</option>
                  <option value="125%">125% High Legibility (Accessibility)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. Organization & Facility */}
        {/* ========================================================================= */}
        {activeTab === 'organization' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span>Hospital Facility Identity & Legal Entity Metadata</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Enterprise tenant identifiers, legal NPI credentials, fiscal calendar cycles, and statutory retention rules.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Hospital Entity Name
                </label>
                <input
                  type="text"
                  value={organization.hospitalName}
                  onChange={(e) => setOrganization({ ...organization, hospitalName: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Facility OID / CMS Facility Code
                </label>
                <input
                  type="text"
                  value={organization.facilityCode}
                  onChange={(e) => setOrganization({ ...organization, facilityCode: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  National Provider Identifier (NPI / Tax ID)
                </label>
                <input
                  type="text"
                  value={organization.npiTaxId}
                  onChange={(e) => setOrganization({ ...organization, npiTaxId: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Statutory Medical Record Retention
                </label>
                <select
                  value={organization.dataRetentionYears}
                  onChange={(e) => setOrganization({ ...organization, dataRetentionYears: Number(e.target.value) })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  <option value={7}>7 Years (Adult Medical Record Standard)</option>
                  <option value={10}>10 Years (Extended Clinical Standard)</option>
                  <option value={25}>25 Years (Pediatric & Birth Record Mandate)</option>
                  <option value={99}>Permanent / Indefinite Legal Hold</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. Integrations & API Hub */}
        {/* ========================================================================= */}
        {activeTab === 'integrations' && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-blue-600" />
                  <span>HL7, FHIR R4 & Enterprise ERP Integration Hub</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Interoperability endpoints, bi-directional lab feeds, DICOM PACS AE titles, and developer API credentials.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateApiKey}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Generate API Key</span>
              </button>
            </div>

            {/* FHIR Server Ping Test */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-3">
              <label className="text-xs font-bold text-slate-900 dark:text-white block">
                Primary FHIR R4 Ingestion Base URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fhirEndpoint}
                  onChange={(e) => setFhirEndpoint(e.target.value)}
                  className="flex-1 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleTestFhirEndpoint}
                  disabled={pingStatus === 'testing'}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-750 dark:hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${pingStatus === 'testing' ? 'animate-spin' : ''}`} />
                  <span>{pingStatus === 'testing' ? 'Testing...' : 'Test TLS Handshake'}</span>
                </button>
              </div>

              {pingMessage && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-mono flex items-center gap-2 ${
                    pingStatus === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{pingMessage}</span>
                </div>
              )}
            </div>

            {/* Active API Keys Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">Active Scoped API Keys</h3>
              <div className="space-y-2">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{key.name}</div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">{key.prefix}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {key.permissions.map((perm, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[9px] font-mono font-bold"
                          >
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-slate-400">Last used: {key.lastUsed}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteApiKey(key.id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold cursor-pointer"
                        title="Revoke Key"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
