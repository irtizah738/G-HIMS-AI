'use client';

import React, { useState } from 'react';
import { useRBAC } from '@/lib/auth/rbac-context';
import { RoleId, ResourceId, ActionId } from '@/types/rbac';
import { ROLE_DEFINITIONS, DEMO_PERSONAS, formatResourceName } from '@/lib/auth/rbac';
import {
  X,
  ShieldCheck,
  Stethoscope,
  HeartPulse,
  ClipboardList,
  DollarSign,
  User,
  Check,
  AlertTriangle,
  Lock,
  Eye,
  PlusCircle,
  Edit,
  Trash2,
  Download,
  Sliders,
  CheckCircle2,
  ShieldAlert,
  Info
} from 'lucide-react';

export function RbacMatrixModal() {
  const { isRbacModalOpen, setIsRbacModalOpen, currentRole, setRole } = useRBAC();
  const [selectedRoleTab, setSelectedRoleTab] = useState<RoleId>(currentRole);
  const [activeViewMode, setActiveViewMode] = useState<'matrix' | 'role_details' | 'audit_simulation'>('matrix');

  if (!isRbacModalOpen) return null;

  const rolesList: RoleId[] = [
    'administrator',
    'doctor',
    'nurse',
    'receptionist',
    'billing_clerk',
    'patient',
  ];

  const primaryResources: { id: ResourceId; title: string; category: string }[] = [
    { id: 'patient_records', title: 'Patient Records & EHR', category: 'Patient Data' },
    { id: 'clinical_notes', title: 'Clinical SOAP Notes', category: 'Patient Data' },
    { id: 'prescriptions', title: 'Prescriptions & Pharmacy', category: 'Patient Data' },
    { id: 'lab_orders', title: 'Lab & Diagnostic Orders', category: 'Diagnostics' },
    { id: 'staff_info', title: 'Staff Credentials & Profiles', category: 'Staff Data' },
    { id: 'schedules', title: 'OPD & Clinic Schedules', category: 'Scheduling' },
    { id: 'bed_census', title: 'Inpatient Bed Census & Wards', category: 'Scheduling' },
    { id: 'ot_schedules', title: 'Operating Theater Cases', category: 'Scheduling' },
    { id: 'billing_data', title: 'Patient Invoices & Tariffs', category: 'Billing & ERP' },
    { id: 'erp_gl', title: 'Enterprise General Ledger', category: 'Billing & ERP' },
    { id: 'audit_logs', title: 'HIPAA & Compliance Audit Logs', category: 'Governance' },
    { id: 'system_settings', title: 'Tenant & Security Settings', category: 'Governance' },
  ];

  const getRoleIcon = (roleId: RoleId, className = 'w-4 h-4') => {
    switch (roleId) {
      case 'administrator': return <ShieldCheck className={className} />;
      case 'doctor': return <Stethoscope className={className} />;
      case 'nurse': return <HeartPulse className={className} />;
      case 'receptionist': return <ClipboardList className={className} />;
      case 'billing_clerk': return <DollarSign className={className} />;
      case 'patient': return <User className={className} />;
    }
  };

  const renderActionBadges = (actions: ActionId[]) => {
    if (!actions || actions.length === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          <Lock className="w-2.5 h-2.5" /> No Access
        </span>
      );
    }

    const hasView = actions.includes('view');
    const hasCreate = actions.includes('create');
    const hasUpdate = actions.includes('update');
    const hasDelete = actions.includes('delete');
    const hasAdmin = actions.includes('admin') || actions.includes('export');

    return (
      <div className="flex flex-wrap items-center gap-1">
        {hasView && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" title="View (Read)">
            V
          </span>
        )}
        {hasCreate && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800" title="Create (Write)">
            C
          </span>
        )}
        {hasUpdate && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title="Update (Modify)">
            U
          </span>
        )}
        {hasDelete && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800" title="Delete">
            D
          </span>
        )}
        {hasAdmin && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-200 dark:border-purple-800" title="Admin / Export">
            ADM
          </span>
        )}
      </div>
    );
  };

  const selectedRoleDef = ROLE_DEFINITIONS[selectedRoleTab];
  const selectedPersona = DEMO_PERSONAS[selectedRoleTab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="fixed inset-0"
        onClick={() => setIsRbacModalOpen(false)}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-5xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden z-10">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-850/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                G-HIMS Role-Based Access Control (RBAC) Architecture
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Formal privilege matrix, module gating, and CRUD authority across 6 organizational tiers
              </p>
            </div>
          </div>

          <button
            id="btn-close-rbac-matrix-modal"
            onClick={() => setIsRbacModalOpen(false)}
            className="min-w-[36px] min-h-[36px] p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
            aria-label="Close RBAC Matrix Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Mode Nav */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeViewMode === 'matrix'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Master Comparison Matrix
            </button>
            <button
              onClick={() => setActiveViewMode('role_details')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeViewMode === 'role_details'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Role Deep Dive & Gated Modules
            </button>
            <button
              onClick={() => setActiveViewMode('audit_simulation')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeViewMode === 'audit_simulation'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Live Permission Simulator
            </button>
          </div>

          {/* Quick Active Role Indicator */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Current Session:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${ROLE_DEFINITIONS[currentRole].badgeBg} ${ROLE_DEFINITIONS[currentRole].badgeColor} border ${ROLE_DEFINITIONS[currentRole].badgeBorder}`}>
              {ROLE_DEFINITIONS[currentRole].displayName}
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
          {/* TAB 1: MASTER COMPARISON MATRIX */}
          {activeViewMode === 'matrix' && (
            <div className="space-y-4">
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-blue-600" /> Legend:
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                  <span className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-[10px]">V</span> View (Read)
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-blue-700 dark:text-blue-300">
                  <span className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-[10px]">C</span> Create (Insert)
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                  <span className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-[10px]">U</span> Update (Edit)
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-rose-700 dark:text-rose-300">
                  <span className="w-4 h-4 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold flex items-center justify-center text-[10px]">D</span> Delete
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-purple-700 dark:text-purple-300">
                  <span className="px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold flex items-center justify-center text-[10px]">ADM</span> Admin/Export
                </span>
              </div>

              {/* Responsive Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                      <th className="p-3 font-bold sticky left-0 bg-slate-100 dark:bg-slate-800 z-10 min-w-[200px]">
                        Domain Resource
                      </th>
                      {rolesList.map((roleId) => {
                        const def = ROLE_DEFINITIONS[roleId];
                        return (
                          <th key={roleId} className="p-3 font-bold text-center min-w-[120px]">
                            <div className="flex flex-col items-center gap-1">
                              <div className={`w-6 h-6 rounded-lg ${def.badgeBg} ${def.badgeColor} flex items-center justify-center`}>
                                {getRoleIcon(roleId, 'w-3.5 h-3.5')}
                              </div>
                              <span>{def.displayName}</span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {primaryResources.map((res) => (
                      <tr key={res.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-3 font-semibold sticky left-0 bg-white dark:bg-slate-900 z-10 border-r border-slate-100 dark:border-slate-800">
                          <div>
                            <div className="text-slate-900 dark:text-slate-100">{res.title}</div>
                            <span className="text-[10px] text-slate-400 font-normal">{res.category}</span>
                          </div>
                        </td>
                        {rolesList.map((roleId) => {
                          const actions = ROLE_DEFINITIONS[roleId].permissions[res.id] || [];
                          return (
                            <td key={roleId} className="p-3 text-center align-middle">
                              <div className="flex justify-center">
                                {renderActionBadges(actions)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: ROLE DEEP DIVE & GATED MODULES */}
          {activeViewMode === 'role_details' && (
            <div className="space-y-5">
              {/* Role Selection Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {rolesList.map((roleId) => {
                  const def = ROLE_DEFINITIONS[roleId];
                  const isSelected = selectedRoleTab === roleId;
                  return (
                    <button
                      key={roleId}
                      onClick={() => setSelectedRoleTab(roleId)}
                      className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1.5 transition-all cursor-pointer ${
                        isSelected
                          ? `${def.badgeBg} ${def.badgeBorder} ring-2 ring-blue-500 shadow-xs`
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg ${def.badgeBg} ${def.badgeColor} flex items-center justify-center`}>
                        {getRoleIcon(roleId, 'w-4 h-4')}
                      </div>
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {def.displayName}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected Role Profile Box */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-750 pb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${selectedRoleDef.badgeBg} ${selectedRoleDef.badgeColor} flex items-center justify-center font-bold text-lg border ${selectedRoleDef.badgeBorder}`}>
                      {getRoleIcon(selectedRoleTab, 'w-5 h-5')}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        {selectedRoleDef.displayName} Role Profile
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Demo Persona: <strong className="text-slate-800 dark:text-slate-200">{selectedPersona.name}</strong> ({selectedPersona.title})
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setRole(selectedRoleTab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs ${
                      currentRole === selectedRoleTab
                        ? 'bg-emerald-600 text-white cursor-default'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {currentRole === selectedRoleTab ? '✓ Currently Active Role' : `Switch Session to ${selectedRoleDef.displayName}`}
                  </button>
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {selectedRoleDef.summary}
                </p>

                {/* Subsystem Access List */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Authorized Navigation Subsystems ({selectedRoleDef.accessibleModules.length} Modules):
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRoleDef.accessibleModules.map((mod) => (
                      <span
                        key={mod}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 shadow-2xs"
                      >
                        {mod.toUpperCase().replace('-', ' ')}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Restrictions Notice */}
                {selectedRoleDef.restrictedMessage && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold">Role Restrictions & Governance:</strong>
                      <span>{selectedRoleDef.restrictedMessage}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT & SIMULATION TEST CONSOLE */}
          {activeViewMode === 'audit_simulation' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2 text-xs">
                <h4 className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-blue-600" /> Real-Time Zero-Trust Authorization Evaluation
                </h4>
                <p className="text-blue-800/90 dark:text-blue-300">
                  Select a hospital operation below to verify how the G-HIMS authorization engine evaluates privileges for your current role (<strong className="underline">{ROLE_DEFINITIONS[currentRole].displayName}</strong>).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    title: 'Create Master Patient Index (MPI) Record',
                    resource: 'patient_records' as ResourceId,
                    action: 'create' as ActionId,
                    desc: 'New patient intake, biometric verification, and MPI identity generation.',
                  },
                  {
                    title: 'Author Clinical SOAP Progress Note',
                    resource: 'clinical_notes' as ResourceId,
                    action: 'create' as ActionId,
                    desc: 'Writing structured physician assessments and diagnostic notes.',
                  },
                  {
                    title: 'Prescribe Schedule II Controlled Substances',
                    resource: 'prescriptions' as ResourceId,
                    action: 'create' as ActionId,
                    desc: 'Electronic prescribing with DEA & state medical license validation.',
                  },
                  {
                    title: 'Modify Inpatient Bed Allocation',
                    resource: 'bed_census' as ResourceId,
                    action: 'update' as ActionId,
                    desc: 'Transfer patient, update ward status (cleaning, maintenance, occupied).',
                  },
                  {
                    title: 'Post Universal General Ledger Journal Entry',
                    resource: 'erp_gl' as ResourceId,
                    action: 'create' as ActionId,
                    desc: 'Double-entry debit/credit ledger posting in SAP-style ERP system.',
                  },
                  {
                    title: 'Manage Staff Credentials & Privileges',
                    resource: 'staff_info' as ResourceId,
                    action: 'update' as ActionId,
                    desc: 'HCM credential verification, privilege granting, and roster management.',
                  },
                  {
                    title: 'Generate EDI 837 Insurance Claim',
                    resource: 'billing_data' as ResourceId,
                    action: 'create' as ActionId,
                    desc: 'Scrub clinical codes and dispatch claim to commercial insurance payer.',
                  },
                  {
                    title: 'Delete Master Medical Record',
                    resource: 'patient_records' as ResourceId,
                    action: 'delete' as ActionId,
                    desc: 'Hard delete patient record (prohibited by default event store policy).',
                  },
                ].map((testItem, idx) => {
                  const allowed = ROLE_DEFINITIONS[currentRole].permissions[testItem.resource]?.includes(testItem.action);
                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                        allowed
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
                          : 'bg-rose-50/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/70'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                            {testItem.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {testItem.desc}
                        </p>
                        <span className="inline-block text-[10px] font-mono text-slate-400">
                          Target: {testItem.resource}:{testItem.action}
                        </span>
                      </div>

                      <div className="shrink-0">
                        {allowed ? (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white flex items-center gap-1 shadow-2xs">
                            <Check className="w-3.5 h-3.5" /> AUTHORIZED
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-600 text-white flex items-center gap-1 shadow-2xs">
                            <Lock className="w-3.5 h-3.5" /> DENIED (403)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Enforcing zero-trust tenant isolation, verified credentials, and HIPAA compliance policies.
          </span>
          <button
            onClick={() => setIsRbacModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
