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
} from 'lucide-react';
import {
  ClinicalCredential,
  StaffMember,
  CredentialVerificationStatus,
  StaffRole,
} from '@/types/hcm';
import {
  subscribeToStaffCredentials,
  subscribeToStaffMembers,
  addStaffCredential,
  updateStaffCredentials,
  verifyCredential,
  seedInitialCredentials,
} from '@/lib/firebase/services/hcm';

export default function ClinicalCredentialsPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

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

  useEffect(() => {
    setLoading(true);
    const unsubStaff = subscribeToStaffMembers(tenantId, setStaff);
    const unsubCreds = subscribeToStaffCredentials(tenantId, (data) => {
      setCredentials(data);
      setLoading(false);
    });

    return () => {
      unsubStaff();
      unsubCreds();
    };
  }, [tenantId]);

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

    setSaving(true);
    try {
      await addStaffCredential(tenantId, {
        staffId: selectedStaffMember.id,
        staffName: selectedStaffMember.fullName,
        staffRole: selectedStaffMember.primaryRole,
        title: title.trim(),
        licenseNumber: licenseNumber.trim().toUpperCase(),
        issuingBody: issuingBody.trim(),
        issueDate,
        expirationDate,
        verificationStatus: 'verified',
        verifiedBy: 'Clinical Credentialing Director',
        verifiedAt: new Date().toISOString(),
        isMandatoryForPractice: isMandatory,
        notes: notes.trim() || undefined,
      });

      setShowAddModal(false);
      setLicenseNumber('');
      setNotes('');
    } catch (err: any) {
      setSaveError(err.message || 'Failed to record credential.');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyCredential = async (credId: string) => {
    setVerifyingId(credId);
    try {
      await verifyCredential(tenantId, credId, 'Chief Medical Officer / Credentialing Committee');
      if (selectedCredential?.id === credId) {
        setSelectedCredential((prev) =>
          prev
            ? {
                ...prev,
                verificationStatus: 'verified',
                verifiedBy: 'Chief Medical Officer / Credentialing Committee',
                verifiedAt: new Date().toISOString(),
              }
            : null
        );
      }
    } catch (err) {
      console.error('Verification error:', err);
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

        <div className="flex items-center gap-3">
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
    </div>
  );
}
