'use client';

import React from 'react';
import { useRBAC } from '@/lib/auth/rbac-context';
import { useHospital } from '@/lib/context/hospital-context';
import { ROLE_DEFINITIONS } from '@/lib/auth/rbac';
import { ShieldAlert, Lock, ArrowLeft, Layers, UserCheck } from 'lucide-react';

interface RbacAccessDeniedProps {
  moduleId: string;
  moduleName?: string;
}

export function RbacAccessDenied({ moduleId, moduleName }: RbacAccessDeniedProps) {
  const { currentRole, setRole, roleDefinition, setIsRbacModalOpen } = useRBAC();
  const { setActiveTab } = useHospital();

  const formattedName = moduleName || moduleId.toUpperCase().replace('-', ' ');

  // Find roles that CAN access this module
  const authorizedRoles = (Object.keys(ROLE_DEFINITIONS) as Array<keyof typeof ROLE_DEFINITIONS>).filter(
    (roleId) => ROLE_DEFINITIONS[roleId].accessibleModules.includes(moduleId)
  );

  return (
    <div className="min-h-[450px] flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-rose-200 dark:border-rose-900/50 p-6 sm:p-8 text-center space-y-5 animate-in fade-in duration-200">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-xs">
          <ShieldAlert className="w-8 h-8" />
        </div>

        {/* Title & Description */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-mono font-bold text-rose-600 dark:text-rose-400 tracking-wider uppercase">
            HTTP 403 • Privilege Access Restricted
          </span>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Access to {formattedName} Denied
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
            Your active role (<strong className="text-slate-900 dark:text-slate-200">{roleDefinition.displayName}</strong>) does not have authorization to view or execute operations in this hospital subsystem.
          </p>
        </div>

        {/* Authorized Roles Pill List */}
        <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs space-y-2">
          <span className="font-bold text-slate-700 dark:text-slate-300 block text-[11px]">
            Roles Authorized for {formattedName}:
          </span>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {authorizedRoles.map((roleId) => {
              const def = ROLE_DEFINITIONS[roleId];
              return (
                <button
                  key={roleId}
                  onClick={() => setRole(roleId)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${def.badgeBg} ${def.badgeColor} ${def.badgeBorder} hover:scale-105 shadow-2xs`}
                  title={`Switch active session to ${def.displayName}`}
                >
                  Switch to {def.displayName} →
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setActiveTab(roleDefinition.accessibleModules[0] || 'command')}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Return to Authorized Workspace
          </button>
          <button
            onClick={() => setIsRbacModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" /> Inspect RBAC Matrix
          </button>
        </div>
      </div>
    </div>
  );
}
