'use client';

import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  UserCheck,
  UserX,
  Users,
  CheckCircle2,
  XCircle,
  FileText,
  AlertTriangle,
  Play,
  RefreshCw,
  Search,
  Building,
  Info,
  Layers,
  FileSpreadsheet,
  Check,
  X,
} from 'lucide-react';
import {
  RoleId,
  PatientDataCategory,
  ROLE_DEFINITIONS,
  DEMO_PERSONAS,
  PATIENT_DATA_CATEGORIES,
  PATIENT_DATA_CRUD_MATRIX,
  SYSTEM_MODULES_PERMISSIONS,
  evaluatePermissionSimulation,
  PermissionTestResult,
  getPatientDataPermission,
} from '@/lib/auth/rbac';
import { useRBAC } from '@/lib/auth/rbac-context';

export function RbacManagementView() {
  const { currentRole, switchRole, activeUser } = useRBAC();

  // Selected role to inspect in the matrices
  const [selectedRole, setSelectedRole] = useState<RoleId>(currentRole);
  
  // Matrix view mode: single role or full comparison
  const [matrixViewMode, setMatrixViewMode] = useState<'single_role' | 'full_comparison'>('single_role');

  // Simulator state
  const [simRole, setSimRole] = useState<RoleId>('nurse');
  const [simCategory, setSimCategory] = useState<string>('prescriptions');
  const [simAction, setSimAction] = useState<'view' | 'create' | 'edit' | 'delete' | 'export'>('create');
  const [simResult, setSimResult] = useState<PermissionTestResult | null>(() =>
    evaluatePermissionSimulation('nurse', 'prescriptions', 'create')
  );

  const roleDef = ROLE_DEFINITIONS[selectedRole] || ROLE_DEFINITIONS.administrator;
  const persona = DEMO_PERSONAS[selectedRole] || DEMO_PERSONAS.administrator;

  const handleRunSimulation = () => {
    const res = evaluatePermissionSimulation(simRole, simCategory, simAction);
    setSimResult(res);
  };

  const KEY_ROLES: RoleId[] = ['administrator', 'doctor', 'nurse', 'receptionist', 'billing_staff', 'patient'];

  return (
    <div id="rbac-management-module" className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              <Shield className="w-3.5 h-3.5" />
              Institutional Security & Access Control
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Model: Least-Privilege Role-Based Access Control (RBAC + ABAC)
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Role-Based Access Control (RBAC) System
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Strict segregation of duties, granular patient data permissions, module gating, and real-time policy evaluation.
          </p>
        </div>

        {/* Global Current Role Indicator & Quick Switcher */}
        <div className="flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-right pr-2">
            <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Active Session Role</div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {ROLE_DEFINITIONS[currentRole]?.displayName}
            </div>
          </div>
          <div className="h-7 w-px bg-slate-200 dark:bg-slate-800"></div>
          <select
            id="global-role-switcher"
            value={currentRole}
            onChange={(e) => switchRole(e.target.value as RoleId)}
            className="text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value="administrator">Switch: Administrator</option>
            <option value="doctor">Switch: Doctor</option>
            <option value="nurse">Switch: Nurse</option>
            <option value="receptionist">Switch: Receptionist</option>
            <option value="billing_staff">Switch: Billing Staff</option>
            <option value="patient">Switch: Patient</option>
          </select>
        </div>
      </div>

      {/* Role Selection Tabs */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Inspect Hospital Role Permissions
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {KEY_ROLES.map((rId) => {
            const rInfo = ROLE_DEFINITIONS[rId];
            const pInfo = DEMO_PERSONAS[rId];
            const isSelected = selectedRole === rId;
            const isCurrent = currentRole === rId;

            return (
              <button
                key={rId}
                id={`role-btn-${rId}`}
                onClick={() => setSelectedRole(rId)}
                className={`p-3 rounded-xl border text-left transition-all relative ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 shadow-sm ring-1 ring-blue-500'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {isCurrent && (
                  <span className="absolute top-2 right-2 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${rInfo.badgeBg} ${rInfo.badgeColor} border ${rInfo.badgeBorder}`}
                  >
                    {rInfo.category.toUpperCase()}
                  </span>
                </div>
                <div className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                  {rInfo.displayName}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {pInfo?.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Inspected Role Card Overview */}
      <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {roleDef.displayName} Role Specification
              </h2>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-semibold ${roleDef.badgeBg} ${roleDef.badgeColor} border ${roleDef.badgeBorder}`}
              >
                {roleDef.category.toUpperCase()} SCOPE
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
              {roleDef.summary}
            </p>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Institutional Demo Persona</div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{persona.name}</div>
            <div className="text-[11px] text-slate-500">{persona.email}</div>
          </div>
        </div>

        {/* Least Privilege Statutory Warning */}
        <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <span className="font-bold">Least-Privilege Restriction Notice: </span>
            {roleDef.restrictedMessage}
          </div>
        </div>
      </div>

      {/* SECTION 1: Patient Data CRUD Permissions Matrix */}
      <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              1. Patient Data CRUD Permission Matrix (Least-Privilege Basis)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Defines exact permissions (View, Create, Edit, Delete, Export) for role{' '}
              <strong className="text-slate-800 dark:text-slate-200 font-semibold">{roleDef.displayName}</strong> across all clinical and financial PHI data types.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMatrixViewMode('single_role')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-all ${
                matrixViewMode === 'single_role'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {roleDef.displayName} Detail
            </button>
            <button
              onClick={() => setMatrixViewMode('full_comparison')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-all ${
                matrixViewMode === 'full_comparison'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              All 6 Roles Comparison
            </button>
          </div>
        </div>

        {/* SINGLE ROLE DETAILED VIEW */}
        {matrixViewMode === 'single_role' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40">
                  <th className="py-2.5 px-3 font-semibold w-1/4">Patient Data Category</th>
                  <th className="py-2.5 px-2 font-semibold text-center w-16">View</th>
                  <th className="py-2.5 px-2 font-semibold text-center w-16">Create</th>
                  <th className="py-2.5 px-2 font-semibold text-center w-16">Edit</th>
                  <th className="py-2.5 px-2 font-semibold text-center w-16">Delete</th>
                  <th className="py-2.5 px-2 font-semibold text-center w-16">Export</th>
                  <th className="py-2.5 px-3 font-semibold">Least-Privilege Rationale & Standards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {PATIENT_DATA_CATEGORIES.map((cat) => {
                  const perm = PATIENT_DATA_CRUD_MATRIX[cat.id]?.[selectedRole] || {
                    canView: false,
                    canCreate: false,
                    canEdit: false,
                    canDelete: false,
                    canExport: false,
                    restrictionReason: 'No grant configured.',
                  };

                  return (
                    <tr key={cat.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{cat.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                          {cat.description}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className={`px-1.5 py-0.2 text-[9px] font-bold rounded ${
                              cat.phiSensitivity === 'STRICTLY_CONFIDENTIAL'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                                : cat.phiSensitivity === 'HIGH'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {cat.phiSensitivity}
                          </span>
                        </div>
                      </td>

                      {/* View */}
                      <td className="py-3 px-2 text-center">
                        {perm.canView ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </td>

                      {/* Create */}
                      <td className="py-3 px-2 text-center">
                        {perm.canCreate ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </td>

                      {/* Edit */}
                      <td className="py-3 px-2 text-center">
                        {perm.canEdit ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="py-3 px-2 text-center">
                        {perm.canDelete ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </td>

                      {/* Export */}
                      <td className="py-3 px-2 text-center">
                        {perm.canExport ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </td>

                      {/* Rationale */}
                      <td className="py-3 px-3">
                        <div className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
                          {perm.restrictionReason}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 flex flex-wrap gap-1">
                          {cat.applicableStandards.map((std: string) => (
                            <span key={std} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">
                              {std}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* FULL COMPARISON VIEW ACROSS ALL 6 ROLES */}
        {matrixViewMode === 'full_comparison' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40">
                  <th className="py-2.5 px-3 font-semibold w-1/4">Patient Data Type</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Admin</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Doctor</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Nurse</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Receptionist</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Billing Staff</th>
                  <th className="py-2.5 px-2 font-semibold text-center">Patient</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {PATIENT_DATA_CATEGORIES.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{cat.name}</div>
                    </td>
                    {KEY_ROLES.map((rId) => {
                      const p = PATIENT_DATA_CRUD_MATRIX[cat.id]?.[rId];
                      const actions: string[] = [];
                      if (p?.canView) actions.push('V');
                      if (p?.canCreate) actions.push('C');
                      if (p?.canEdit) actions.push('E');
                      if (p?.canDelete) actions.push('D');
                      if (p?.canExport) actions.push('X');

                      return (
                        <td key={rId} className="py-3 px-2 text-center">
                          {actions.length > 0 ? (
                            <div className="flex flex-col items-center">
                              <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                {actions.join(' ')}
                              </span>
                              <span className="text-[9px] text-slate-400 mt-0.5">
                                {p?.canDelete ? 'Full' : p?.canCreate ? 'Read/Write' : 'Read-Only'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs">— Blocked —</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 flex items-center gap-4">
              <span><strong>V:</strong> View</span>
              <span><strong>C:</strong> Create</span>
              <span><strong>E:</strong> Edit / Amend</span>
              <span><strong>D:</strong> Delete (Archival Only)</span>
              <span><strong>X:</strong> Bulk Export</span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: System Modules Access Matrix */}
      <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            2. System Modules Access Authorization (Segregation of Duties)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Specifies which operational, clinical, and financial modules are reachable by{' '}
            <strong className="text-slate-800 dark:text-slate-200">{roleDef.displayName}</strong> on a least-privilege basis.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40">
                <th className="py-2.5 px-3 font-semibold">Hospital Module</th>
                <th className="py-2.5 px-3 font-semibold">Domain Category</th>
                <th className="py-2.5 px-3 font-semibold text-center">Access Status</th>
                <th className="py-2.5 px-3 font-semibold">Least-Privilege Security Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {SYSTEM_MODULES_PERMISSIONS.map((mod) => {
                const isAllowed = mod.allowedRoles.includes(selectedRole) || selectedRole === 'administrator';

                return (
                  <tr key={mod.moduleId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{mod.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{mod.description}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {mod.category}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {isAllowed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Authorized
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                          <XCircle className="w-3 h-3" />
                          Restricted
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 max-w-md">
                      {mod.leastPrivilegeRationale}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 3: Live Permission Simulator & Policy Tester */}
      <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            3. Real-Time RBAC Policy Evaluation & Security Simulator
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Execute deterministic security checks against hospital security policies, statutory HIPAA mandates, and institutional separation of duties.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {/* Simulator Role */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Target Role
              </label>
              <select
                id="sim-role-select"
                value={simRole}
                onChange={(e) => setSimRole(e.target.value as RoleId)}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200"
              >
                {KEY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_DEFINITIONS[r]?.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Data / Resource */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Patient Data / Resource
              </label>
              <select
                id="sim-category-select"
                value={simCategory}
                onChange={(e) => setSimCategory(e.target.value)}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200"
              >
                <optgroup label="Patient PHI Categories">
                  {PATIENT_DATA_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Enterprise Resources">
                  <option value="reporting_analytics">Advanced Reporting & Analytics</option>
                  <option value="erp_gl">Universal General Ledger (ERP)</option>
                  <option value="audit_logs">HIPAA Audit Ledger</option>
                  <option value="system_settings">System Settings</option>
                </optgroup>
              </select>
            </div>

            {/* Action */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                CRUD Action
              </label>
              <select
                id="sim-action-select"
                value={simAction}
                onChange={(e) =>
                  setSimAction(e.target.value as 'view' | 'create' | 'edit' | 'delete' | 'export')
                }
                className="w-full text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200"
              >
                <option value="view">VIEW (Read Records)</option>
                <option value="create">CREATE (New Entry)</option>
                <option value="edit">EDIT (Amend / Update)</option>
                <option value="delete">DELETE (Expunge / Erase)</option>
                <option value="export">EXPORT (Bulk Disclosure)</option>
              </select>
            </div>

            {/* Run Button */}
            <div className="flex items-end">
              <button
                id="sim-run-btn"
                onClick={handleRunSimulation}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                Simulate Authorization
              </button>
            </div>
          </div>

          {/* Simulation Output Card */}
          {simResult && (
            <div
              id="sim-output-card"
              className={`mt-4 p-4 rounded-xl border transition-all ${
                simResult.allowed
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                  : 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2 mb-3 border-emerald-200/60 dark:border-emerald-800/60">
                <div className="flex items-center gap-2">
                  {simResult.allowed ? (
                    <span className="flex items-center gap-1 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      ACCESS GRANTED (200 OK)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-rose-800 dark:text-rose-300 font-bold text-sm">
                      <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                      ACCESS DENIED (403 FORBIDDEN)
                    </span>
                  )}
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/60 dark:bg-black/30 border border-current">
                    {simResult.policy}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="text-slate-500">Risk Assessment:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      simResult.riskAssessment === 'SAFE'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                        : simResult.riskAssessment === 'CRITICAL_SECURITY_GATE'
                        ? 'bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    }`}
                  >
                    {simResult.riskAssessment}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                    Evaluated Request Context
                  </div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Role: <strong>{simResult.roleDisplayName}</strong> ({simResult.role})
                  </div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Target: <strong>{simResult.resourceOrCategory}</strong>
                  </div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Action: <strong>{simResult.action}</strong>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                    Statutory & Institutional Rationale
                  </div>
                  <div className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                    {simResult.leastPrivilegeRationale}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                    Standard: {simResult.regulatoryStandard}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
