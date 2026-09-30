'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Filter,
  RefreshCw,
  X,
  Stethoscope,
  Building,
  UserCheck,
  ExternalLink,
  Award,
  Calendar,
  Layers,
  Sparkles,
  Mail,
  Bell,
  Send,
  Inbox,
  Eye,
  Check,
} from 'lucide-react';
import {
  ClinicalCredential,
  StaffMember,
  CredentialVerificationStatus,
  StaffRole,
  CredentialExpiryAlert,
} from '@/types/hcm';
import {
  hydrateCredentialing,
  loadLocalCredentialing,
  submitCredentialEdge,
  verifyCredentialEdge,
} from '@/lib/hcm/hcm-edge-adapter';
import type { ClinicalCredentialType } from '@/types/hcm-advanced';

export default function ClinicalCredentialsPage() {
  const params = useParams();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();

  const [credentials, setCredentials] = useState<ClinicalCredential[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCredential, setSelectedCredential] = useState<ClinicalCredential | null>(null);

  // Add Credential Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [title, setTitle] = useState('State Medical License (MD)');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [issuingBody, setIssuingBody] = useState('State Medical Board');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [expirationDate, setExpirationDate] = useState(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [isMandatory, setIsMandatory] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Verification action
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // 60-Day Automated Credential Expiry Notification System
  const [alerts, setAlerts] = useState<CredentialExpiryAlert[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanReport, setScanReport] = useState<{ count: number; alertIds: string[]; triggeredAt: string } | null>(null);
  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState(false);
  const [selectedAlertForEmail, setSelectedAlertForEmail] = useState<CredentialExpiryAlert | null>(null);
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState<string | null>(null);

  const applyCredentialing = (
    snapshot: Awaited<ReturnType<typeof loadLocalCredentialing>>
  ) => {
    setStaff(snapshot.staff);
    setCredentials(snapshot.credentials);
    setAlerts(snapshot.alerts);
  };

  const refreshCredentialing = async () => {
    setLoading(true);
    try {
      if (!tenantId) {
        setSaveError('TENANT_CONTEXT_REQUIRED: Credentialing requires an explicit tenant route.');
        setStaff([]);
        setCredentials([]);
        setAlerts([]);
        return;
      }
      applyCredentialing(await loadLocalCredentialing(tenantId));
      applyCredentialing(await hydrateCredentialing(tenantId));
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to load governed credentialing records.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshCredentialing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleTrigger60DayScan = async () => {
    setScanning(true);
    try {
      if (!tenantId) throw new Error('TENANT_CONTEXT_REQUIRED');
      const snapshot=await hydrateCredentialing(tenantId);
      applyCredentialing(snapshot);
      setScanReport({
        count: snapshot.alerts.length,
        alertIds: snapshot.alerts.map((alert) => alert.id),
        triggeredAt: new Date().toLocaleTimeString(),
      });
      setShowNotificationsDrawer(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to refresh credential expiry exposure.');
    } finally {
      setScanning(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    setAcknowledgingAlertId(alertId);
    setAlerts((current) =>
      current.map((alert) =>
        alert.id===alertId
          ? {
              ...alert,
              status:'acknowledged',
              acknowledgedAt:new Date().toISOString(),
              acknowledgedBy:'Current credentialing reviewer',
            }
          : alert
      )
    );
    setAcknowledgingAlertId(null);
  };

  useEffect(() => {
    if (staff.length > 0 && !staffId) {
      setStaffId(staff[0].id);
    }
  }, [staff, staffId]);

  // Expiration Status Classification
  const getExpirationState = (cred: ClinicalCredential) => {
    if (cred.verificationStatus === 'expired') {
      return { label: 'Expired (Blocked)', color: 'bg-rose-50 text-rose-700 border-rose-200', type: 'expired' };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (cred.expirationDate && cred.expirationDate <= todayStr) {
      return { label: 'Expired (Blocked)', color: 'bg-rose-50 text-rose-700 border-rose-200', type: 'expired' };
    }

    const expTime = new Date(cred.expirationDate).getTime();
    const nowTime = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    if (expTime - nowTime <= thirtyDaysMs && expTime > nowTime) {
      const daysLeft = Math.ceil((expTime - nowTime) / (24 * 60 * 60 * 1000));
      return {
        label: `Expiring in ${daysLeft}d`,
        color: 'bg-amber-50 text-amber-800 border-amber-200',
        type: 'expiring_soon',
      };
    }

    if (cred.verificationStatus === 'pending') {
      return { label: 'Pending Verification', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', type: 'pending' };
    }

    return { label: 'Active & Verified', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', type: 'active' };
  };

  // KPIs
  const kpis = useMemo(() => {
    const total = credentials.length;
    let active = 0;
    let expiringSoon = 0;
    let expired = 0;
    let pending = 0;

    credentials.forEach((c) => {
      const state = getExpirationState(c);
      if (state.type === 'active') active++;
      else if (state.type === 'expiring_soon') expiringSoon++;
      else if (state.type === 'expired') expired++;
      else if (state.type === 'pending') pending++;
    });

    return { total, active, expiringSoon, expired, pending };
  }, [credentials]);

  // Filtered List
  const filteredCredentials = useMemo(() => {
    return credentials.filter((c) => {
      const state = getExpirationState(c);

      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && state.type === 'active') ||
        (statusFilter === 'expiring' && state.type === 'expiring_soon') ||
        (statusFilter === 'expired' && state.type === 'expired') ||
        (statusFilter === 'pending' && state.type === 'pending');

      const matchRole = roleFilter === 'all' || c.staffRole === roleFilter;

      const matchSearch =
        c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.licenseNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.staffName && c.staffName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        c.issuingBody.toLowerCase().includes(searchTerm.toLowerCase());

      return matchStatus && matchRole && matchSearch;
    });
  }, [credentials, statusFilter, roleFilter, searchTerm]);

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    const selectedStaffMember = staff.find((s) => s.id === staffId);
    if (!selectedStaffMember) {
      setSaveError('Please select a valid staff member.');
      return;
    }

    if (!licenseNumber.trim()) {
      setSaveError('Please enter a license/registration number.');
      return;
    }

    const inferCredentialType=(value:string):ClinicalCredentialType=>{
      const normalized=value.toLowerCase();
      if(normalized.includes('nurs')) return 'NURSING_BOARD';
      if(normalized.includes('pharmac')) return 'PHARMACY_LICENSE';
      if(normalized.includes('dea')) return 'DEA_REGISTRATION';
      if(normalized.includes('acls')||normalized.includes('bls')) return 'BLS_ACLS';
      if(normalized.includes('fellow')) return 'FELLOWSHIP_CERTIFICATE';
      if(normalized.includes('board')) return 'SPECIALTY_BOARD';
      return 'MEDICAL_LICENSE';
    };

    setSaving(true);
    try {
      if(!tenantId) throw new Error('TENANT_CONTEXT_REQUIRED');
      await submitCredentialEdge({
        employeeId:selectedStaffMember.id,
        credentialType:inferCredentialType(title),
        title:title.trim(),
        issuingAuthority:issuingBody.trim(),
        credentialNumber:licenseNumber.trim().toUpperCase(),
        issueDate,
        expiryDate:expirationDate,
        isMandatoryForPractice:isMandatory,
        notes:notes.trim()||undefined,
      });

      setShowAddModal(false);
      setLicenseNumber('');
      setNotes('');
      await refreshCredentialing();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to record credential.');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyCredential = async (credId: string) => {
    setVerifyingId(credId);
    try {
      await verifyCredentialEdge({
        credentialId:credId,
        status:'VERIFIED',
      });
      await refreshCredentialing();
      setSelectedCredential((current)=>
        current?.id===credId
          ? {...current,verificationStatus:'verified'}
          : current
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Credential verification failed.');
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12" id="clinical-credentials-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Clinical Credentialing & License Registry
              </h1>
              <p className="text-sm text-slate-500">
                Medical board licenses, DEA registrations, life-support certifications & roster scheduling locks
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            id="run-60day-scan-btn"
            onClick={handleTrigger60DayScan}
            disabled={scanning}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            title="Scan all clinical credentials expiring in ≤60 days and dispatch automated email notices to the Credentialing Director"
          >
            <RefreshCw className={`h-4 w-4 text-emerald-600 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning Expiries...' : 'Run 60-Day Expiry Scan'}
          </button>

          <button
            id="open-director-alerts-btn"
            onClick={() => setShowNotificationsDrawer(true)}
            className="relative flex items-center gap-2 px-4 py-2 text-sm font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg shadow-xs transition-colors"
          >
            <Bell className="h-4 w-4 text-amber-700" />
            Director Alerts
            {alerts.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-600 text-white font-mono">
                {alerts.length}
              </span>
            )}
          </button>

          <button
            id="open-add-credential-modal-btn"
            onClick={() => {
              setSaveError(null);
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            Register Credential
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Active & Compliant */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Compliant & Active</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 font-mono">
            {kpis.active} <span className="text-xs font-normal text-slate-500">/ {kpis.total}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Verified for clinical rotations</div>
        </div>

        {/* Expiring Soon (<30 Days) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Expiring in &lt;30 Days</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 font-mono">
            {kpis.expiringSoon}{' '}
            <span className="text-xs font-normal text-amber-600">Action Required</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Renewal notices dispatched</div>
        </div>

        {/* Expired / Roster Blocked */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Expired / Scheduling Lock</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 font-mono">
            {kpis.expired}{' '}
            <span className="text-xs font-normal text-rose-600">Blocked</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Automated shift assignment block</div>
        </div>

        {/* Pending Verification */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Verification Queue</span>
            <Clock className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-indigo-700 font-mono">
            {kpis.pending}{' '}
            <span className="text-xs font-normal text-indigo-600">Pending Review</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Supervisor seal required</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'All Licenses' },
            { id: 'active', label: 'Active & Verified' },
            { id: 'expiring', label: 'Expiring Soon' },
            { id: 'expired', label: 'Expired / Blocked' },
            { id: 'pending', label: 'Pending Review' },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`tab-cred-${tab.id}`}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                statusFilter === tab.id
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Role Filter */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            id="filter-cred-role-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="all">All Specialties</option>
            <option value="doctor">Physicians (MD/DO)</option>
            <option value="nurse">Nurses (RN/BSN)</option>
            <option value="pharmacy">Pharmacists (PharmD)</option>
            <option value="lab">Lab Scientists (ASCP)</option>
          </select>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              id="search-credentials-input"
              type="text"
              placeholder="Search license #, title, doctor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>
      </div>

      {/* Credential Registry Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="credentials-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">License / Certification</th>
                <th className="py-3.5 px-4">Clinical Staff Member</th>
                <th className="py-3.5 px-4">License #</th>
                <th className="py-3.5 px-4">Issuing Authority</th>
                <th className="py-3.5 px-4">Expiration Date</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading Credential Registry...
                  </td>
                </tr>
              ) : filteredCredentials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No clinical credentials found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredCredentials.map((cred) => {
                  const state = getExpirationState(cred);

                  return (
                    <tr
                      key={cred.id}
                      id={`cred-row-${cred.id}`}
                      onClick={() => setSelectedCredential(cred)}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors flex items-center gap-2">
                          <Award className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span>{cred.title}</span>
                        </div>
                        <div className="text-xs text-slate-400 ml-6">
                          {cred.isMandatoryForPractice ? 'Mandatory for Clinical Shift' : 'Elective'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800">{cred.staffName || 'Staff Member'}</div>
                        <div className="text-xs text-slate-500 capitalize">{cred.staffRole}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-700">
                        {cred.licenseNumber}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        {cred.issuingBody}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs font-medium text-slate-800">
                        {cred.expirationDate}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${state.color}`}
                        >
                          {state.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {cred.verificationStatus === 'pending' ? (
                          <button
                            id={`verify-btn-${cred.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVerifyCredential(cred.id);
                            }}
                            disabled={verifyingId === cred.id}
                            className="px-3 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
                          >
                            {verifyingId === cred.id ? 'Verifying...' : 'Verify Now'}
                          </button>
                        ) : (
                          <button
                            id={`inspect-cred-${cred.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCredential(cred);
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            Details
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credential Details Drawer */}
      {selectedCredential && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-200"
          id="credential-details-drawer"
          onClick={() => setSelectedCredential(null)}
        >
          <div
            className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-mono text-xs font-bold text-emerald-700">
                    {selectedCredential.licenseNumber}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {selectedCredential.title}
                  </h2>
                </div>
              </div>

              <button
                id="close-cred-drawer-btn"
                onClick={() => setSelectedCredential(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 my-5 flex-1 text-sm">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Practitioner:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedCredential.staffName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Issuing Body:</span>
                  <span className="font-medium text-slate-800">
                    {selectedCredential.issuingBody}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Issue Date:</span>
                  <span className="font-mono text-slate-800">
                    {selectedCredential.issueDate}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Expiration Date:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedCredential.expirationDate}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="text-slate-500">Verification Status:</span>
                  <span className="font-semibold capitalize text-emerald-700">
                    {selectedCredential.verificationStatus}
                  </span>
                </div>
                {selectedCredential.verifiedBy && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Verified By:</span>
                    <span>{selectedCredential.verifiedBy}</span>
                  </div>
                )}
              </div>

              {selectedCredential.notes && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <div className="font-semibold text-slate-700 mb-1">Credentialing Notes:</div>
                  <p className="text-slate-600">{selectedCredential.notes}</p>
                </div>
              )}

              {/* Roster Impact Notice */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1 text-xs">
                <div className="font-bold text-blue-900 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  Roster Scheduling Enforcement
                </div>
                <p className="text-blue-700">
                  {selectedCredential.verificationStatus === 'expired'
                    ? 'This credential is currently EXPIRED. The Clinical Roster Engine is blocking this staff member from being assigned to clinical shifts.'
                    : 'This credential is currently active and compliant with hospital regulatory guidelines.'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              {selectedCredential.verificationStatus === 'pending' && (
                <button
                  id="drawer-verify-btn"
                  onClick={() => handleVerifyCredential(selectedCredential.id)}
                  disabled={verifyingId === selectedCredential.id}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
                >
                  Verify & Approve License
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedCredential(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Credential Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="add-credential-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Register Clinical Credential</h2>
                  <p className="text-xs text-slate-500">
                    Add medical license, DEA number, or specialty certification
                  </p>
                </div>
              </div>
              <button
                id="close-add-cred-modal-btn"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCredential} className="p-5 space-y-4">
              {saveError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Practitioner *
                </label>
                <select
                  id="add-cred-staff-select"
                  required
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                >
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.primaryRole.toUpperCase()} — {s.departmentName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Credential Title *
                  </label>
                  <select
                    id="add-cred-title-select"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="State Medical License (MD)">State Medical License (MD)</option>
                    <option value="DEA Federal Controlled Substance Registration">DEA Registration</option>
                    <option value="Registered Nurse License (RN)">Registered Nurse (RN)</option>
                    <option value="Basic & Advanced Cardiac Life Support (BLS/ACLS)">BLS / ACLS Certification</option>
                    <option value="Advanced Trauma Life Support (ATLS)">ATLS Certification</option>
                    <option value="Board Certification (Specialty)">Board Certification</option>
                    <option value="Registered Pharmacist License (RPh)">Pharmacist License (RPh)</option>
                    <option value="Medical Laboratory Scientist (ASCP)">ASCP Lab Certification</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    License / Reg # *
                  </label>
                  <input
                    id="add-cred-license-num-input"
                    type="text"
                    required
                    placeholder="e.g. MED-891024"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Issuing Authority / Board *
                </label>
                <input
                  id="add-cred-issuing-input"
                  type="text"
                  required
                  value={issuingBody}
                  onChange={(e) => setIssuingBody(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Issue Date *
                  </label>
                  <input
                    id="add-cred-issue-date-input"
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Expiration Date *
                  </label>
                  <input
                    id="add-cred-exp-date-input"
                    type="date"
                    required
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Verification Notes
                </label>
                <input
                  id="add-cred-notes-input"
                  type="text"
                  placeholder="e.g. Verified via State Medical Board Primary Source Database"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-add-credential-btn"
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {saving ? 'Registering...' : 'Register Credential'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 60-Day Credential Expiry Director Notification Center Drawer */}
      {showNotificationsDrawer && (
        <div
          id="director-alerts-drawer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-amber-50/70">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl border border-amber-200">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Credentialing Director Email Dispatcher (60-Day Mandate)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Automated alert pipeline triggering 60 days before clinical credential expiration
                  </p>
                </div>
              </div>
              <button
                id="close-director-alerts-drawer-btn"
                onClick={() => setShowNotificationsDrawer(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-amber-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Recipient & Policy Info Banner */}
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-slate-500 font-medium">Notification Recipient:</span>{' '}
                <strong className="text-slate-800 font-mono">
                  Configured credentialing recipient
                </strong>{' '}
                <span className="text-slate-400">(Director of Credentialing & Medical Staff Office)</span>
              </div>
              <button
                id="rescan-60day-btn"
                onClick={handleTrigger60DayScan}
                disabled={scanning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning...' : 'Scan Now'}
              </button>
            </div>

            {/* Body Alert List */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {alerts.length === 0 ? (
                <div className="text-center py-12 text-slate-500 space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
                  <p className="font-semibold text-slate-800">All Credentials In Compliance</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    No active licenses or board certifications expiring within the next 60 days were found.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Active Alert Records:{' '}
                      <strong className="text-slate-900">{alerts.length} Dispatched</strong>
                    </span>
                    <span className="font-mono text-[11px] text-amber-700">
                      Auto-Triggers @ 60 Days
                    </span>
                  </div>

                  {alerts.map((alert) => {
                    const urgency =
                      alert.urgency ||
                      (alert.daysUntilExpiration <= 0
                        ? 'critical'
                        : alert.daysUntilExpiration <= 30
                        ? 'high'
                        : 'moderate');

                    return (
                      <div
                        key={alert.id}
                        id={`alert-card-${alert.id}`}
                        className={`p-4 rounded-xl border transition-all ${
                          urgency === 'critical'
                            ? 'bg-rose-50/70 border-rose-200'
                            : urgency === 'high'
                            ? 'bg-amber-50/70 border-amber-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-slate-900">
                                {alert.staffName}
                              </h4>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                  urgency === 'critical'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {urgency}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                {alert.staffRole.toUpperCase()} • {alert.departmentName}
                              </span>
                            </div>

                            <div className="text-xs font-semibold text-slate-800 mt-1">
                              {alert.credentialTitle}
                            </div>

                            <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                              License #{alert.licenseNumber} • Expiration Date:{' '}
                              <strong className="text-rose-700">{alert.expirationDate}</strong> (
                              <span className="font-bold">
                                {alert.daysUntilExpiration <= 0
                                  ? 'EXPIRED'
                                  : `${alert.daysUntilExpiration} days remaining`}
                              </span>
                              )
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                String(alert.status).toLowerCase() === 'acknowledged'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {String(alert.status).toUpperCase()}
                            </span>
                            <button
                              id={`preview-email-btn-${alert.id}`}
                              onClick={() => setSelectedAlertForEmail(alert)}
                              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 hover:bg-indigo-50 shadow-2xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Email Body
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs">
                          <div className="text-slate-500 text-[11px]">
                            Triggered on {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : 'Automated Scan'}
                          </div>

                          {String(alert.status).toLowerCase() !== 'acknowledged' ? (
                            <button
                              id={`ack-alert-btn-${alert.id}`}
                              onClick={() => handleAcknowledgeAlert(alert.id)}
                              disabled={acknowledgingAlertId === alert.id}
                              className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {acknowledgingAlertId === alert.id
                                ? 'Acknowledging...'
                                : 'Acknowledge Notice'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" />
                              Acknowledged by {alert.acknowledgedBy || 'Director'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                G-HIMS Master Safety Standard §95 — 60-Day Automated Compliance Watch
              </span>
              <button
                type="button"
                onClick={() => setShowNotificationsDrawer(false)}
                className="px-4 py-1.5 font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg shadow-2xs"
              >
                Close Center
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simulated Email Preview Modal */}
      {selectedAlertForEmail && (
        <div
          id="email-preview-modal"
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in zoom-in-95 duration-150"
        >
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            {/* Email Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-amber-400" />
                <span className="font-bold text-sm">Automated Email Notification Preview</span>
              </div>
              <button
                onClick={() => setSelectedAlertForEmail(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Simulated Email Envelope */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-1.5 text-xs">
              <div className="flex">
                <span className="text-slate-400 w-16 font-medium">To:</span>
                <span className="text-slate-800 font-mono font-semibold">
                  {selectedAlertForEmail.recipientEmail} (Credentialing Director)
                </span>
              </div>
              <div className="flex">
                <span className="text-slate-400 w-16 font-medium">From:</span>
                <span className="text-slate-800 font-mono">
                  compliance-alerts@metrohealth.ghims.org (G-HIMS Safety Bot)
                </span>
              </div>
              <div className="flex">
                <span className="text-slate-400 w-16 font-medium">Subject:</span>
                <span className="text-slate-900 font-bold">
                  {selectedAlertForEmail.emailSubject}
                </span>
              </div>
            </div>

            {/* Simulated Email Content Body */}
            <div className="p-6 text-xs text-slate-800 space-y-4 overflow-y-auto max-h-[50vh]">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900">
                <strong>Attention: Credentialing Director</strong>
                <p className="mt-1">
                  This is an automated 60-day advance compliance notification. A clinical practitioner in your organization has a mandatory credential that will expire in{' '}
                  <span className="font-bold text-rose-700">
                    {selectedAlertForEmail.daysUntilExpiration} days
                  </span>.
                </p>
              </div>

              <div className="space-y-2 border p-3 rounded-lg bg-slate-50">
                <div className="font-bold text-slate-900 text-sm">Practitioner Dossier</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Clinician:</span>{' '}
                    <strong>{selectedAlertForEmail.staffName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Role:</span>{' '}
                    <strong className="capitalize">{selectedAlertForEmail.staffRole}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Department:</span>{' '}
                    <strong>{selectedAlertForEmail.departmentName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Credential:</span>{' '}
                    <strong>{selectedAlertForEmail.credentialTitle}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">License Number:</span>{' '}
                    <strong className="font-mono">{selectedAlertForEmail.licenseNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Expiration Date:</span>{' '}
                    <strong className="text-rose-700">{selectedAlertForEmail.expirationDate}</strong>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  Automated Practice & Roster Lock Warning
                </div>
                <p>
                  Per hospital protocol, if this license is not renewed and verified by{' '}
                  <strong>{selectedAlertForEmail.expirationDate}</strong>, the practitioner will be automatically locked out from clinical shift rostering and electronic prescription authorization.
                </p>
              </div>
            </div>

            {/* Email Footer Action */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Message ID: <code className="font-mono">{selectedAlertForEmail.id}</code>
              </span>
              <div className="flex items-center gap-2">
                {String(selectedAlertForEmail.status).toLowerCase() !== 'acknowledged' && (
                  <button
                    onClick={() => {
                      handleAcknowledgeAlert(selectedAlertForEmail.id);
                      setSelectedAlertForEmail(null);
                    }}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-xs shadow-2xs cursor-pointer"
                  >
                    Acknowledge Notice
                  </button>
                )}
                <button
                  onClick={() => setSelectedAlertForEmail(null)}
                  className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
