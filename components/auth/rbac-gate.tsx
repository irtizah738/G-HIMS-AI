'use client';

import React from 'react';
import { useRBAC } from '@/lib/auth/rbac-context';
import { useHospital } from '@/lib/context/hospital-context';
import { RoleId } from '@/types/rbac';
import {
  ShieldAlert,
  Lock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ChevronRight,
  UserCheck,
  Users,
} from 'lucide-react';

interface RbacModuleGateProps {
  moduleId: string;
  moduleName?: string;
  requiredRoles?: RoleId[];
  children: React.ReactNode;
}

export function RbacModuleGate({
  moduleId,
  moduleName,
  requiredRoles,
  children,
}: RbacModuleGateProps) {
  const { currentRole, setRole, canAccessModule, roleDefinition, allRoles } = useRBAC();
  const { setActiveTab } = useHospital();

  const isAllowed = canAccessModule(moduleId);

  if (isAllowed) {
    return <>{children}</>;
  }

  // If restricted, display the formal Role & Privilege Security Gate
  const handleReturnToSafeModule = () => {
    switch (currentRole) {
      case 'patient':
        setActiveTab('patient-portal');
        break;
      case 'receptionist':
        setActiveTab('patients');
        break;
      case 'billing_clerk':
        setActiveTab('billing');
        break;
      case 'nurse':
        setActiveTab('beds');
        break;
      case 'doctor':
        setActiveTab('opd');
        break;
      default:
        setActiveTab('directory');
    }
  };

  const getSuggestedRoleForModule = (mod: string): RoleId => {
    if (['command', 'matrix', 'settings', 'audit'].includes(mod)) return 'administrator';
    if (['surgery', 'disease-intake', 'workflow-runtime', 'telehealth', 'ancillary', 'bloodbank', 'interop'].includes(mod)) return 'doctor';
    if (['beds', 'emergency'].includes(mod)) return 'nurse';
    if (['billing', 'claims', 'scm-pos', 'erp-coa'].includes(mod)) return 'billing_clerk';
    if (['patient-portal'].includes(mod)) return 'patient';
    return 'doctor';
  };

  const suggestedRole = getSuggestedRoleForModule(moduleId);

  return (
    <div
      id={`rbac-gate-${moduleId}`}
      className="w-full py-12 px-4 sm:px-6 flex items-center justify-center animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-6 text-center">
        {/* Security Shield Icon */}
        <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/80 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert className="w-8 h-8" />
        </div>

        {/* Title and Subtitle */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[11px] font-bold uppercase tracking-wider">
            <Lock className="w-3.5 h-3.5" />
            Access Restricted by RBAC Policy
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
            Clearance Required for Subsystem Access
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            Your active role <strong className="text-slate-900 dark:text-slate-100">({roleDefinition.displayName})</strong> does not have authorization to view or operate the <strong className="text-blue-600 dark:text-blue-400 font-mono">{moduleName || moduleId}</strong> module.
          </p>
        </div>

        {/* Policy Details Box */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/70 border border-slate-200/80 dark:border-slate-800 text-left text-xs space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-750 pb-2">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Active User Role:</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              {roleDefinition.displayName}
            </span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-750 pb-2">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Governance Policy:</span>
            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">HIPAA Minimum Necessary §164.312(a)(1)</span>
          </div>

          <div>
            <span className="text-slate-500 dark:text-slate-400 font-medium block">Policy Summary:</span>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              {roleDefinition.restrictedMessage || 'This subsystem is restricted to verified healthcare professionals with department-specific clinical credentials or financial posting authority.'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            id="btn-gate-return-safe"
            onClick={handleReturnToSafeModule}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Return to My Authorized Portal</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            id="btn-gate-elevate-role"
            onClick={() => setRole(suggestedRole)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <UserCheck className="w-4 h-4 text-emerald-500" />
            <span>Switch to {suggestedRole.charAt(0).toUpperCase() + suggestedRole.slice(1)} (Demo)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
