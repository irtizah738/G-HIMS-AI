'use client';

import React from 'react';
import { useRBAC } from '@/lib/auth/rbac-context';
import { useHospital } from '@/lib/context/hospital-context';
import { RoleId } from '@/types/rbac';
import { ROLE_DEFINITIONS, DEMO_PERSONAS } from '@/lib/auth/rbac';
import {
  ShieldCheck,
  Stethoscope,
  HeartPulse,
  ClipboardList,
  DollarSign,
  User,
  CheckCircle2,
  Lock,
  Sparkles,
  X,
  ArrowRight,
} from 'lucide-react';

interface RbacRoleSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RbacRoleSwitcherModal({ isOpen, onClose }: RbacRoleSwitcherModalProps) {
  const { currentRole, setRole, allRoles } = useRBAC();
  const { setActiveTab } = useHospital();

  if (!isOpen) return null;

  const handleSelectRole = (role: RoleId) => {
    setRole(role);
    if (role === 'patient') {
      setActiveTab('patient-portal');
    } else if (role === 'receptionist') {
      setActiveTab('patients');
    } else if (role === 'billing_clerk') {
      setActiveTab('billing');
    } else if (role === 'nurse') {
      setActiveTab('beds');
    } else if (role === 'doctor') {
      setActiveTab('opd');
    } else if (role === 'administrator') {
      setActiveTab('command');
    }
    onClose();
  };

  const getRoleIcon = (roleId: RoleId) => {
    switch (roleId) {
      case 'administrator':
        return ShieldCheck;
      case 'doctor':
        return Stethoscope;
      case 'nurse':
        return HeartPulse;
      case 'receptionist':
        return ClipboardList;
      case 'billing_clerk':
        return DollarSign;
      case 'patient':
        return User;
      default:
        return User;
    }
  };

  return (
    <div
      id="modal-rbac-switcher-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="modal-rbac-switcher-container"
        className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                G-HIMS Security & Governance
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mt-1">
              Active Role & Access Control Switcher
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Select an enterprise persona to evaluate real-time RBAC navigation filtering, command palette scoping, and ABAC privacy policies.
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {allRoles.map((roleId) => {
            const roleDef = ROLE_DEFINITIONS[roleId];
            const persona = DEMO_PERSONAS[roleId];
            const isSelected = currentRole === roleId;
            const Icon = getRoleIcon(roleId);

            return (
              <button
                key={roleId}
                id={`btn-switch-role-${roleId}`}
                onClick={() => handleSelectRole(roleId)}
                className={`w-full text-left p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                  isSelected
                    ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                    : 'bg-slate-50/50 dark:bg-slate-850/50 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-xs shrink-0 ${persona.avatarBg}`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                          {roleDef.displayName}
                        </h4>
                        {isSelected && (
                          <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-blue-600 text-white">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">
                        {persona.name}
                      </span>
                    </div>
                  </div>

                  {isSelected ? (
                    <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                  {roleDef.summary}
                </p>

                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>{roleDef.accessibleModules.length} Modules Allowed</span>
                  <span className="truncate max-w-[140px]">{persona.email}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>
            Every role switch recomputes client-side module trees and applies zero-trust API credential gating to all clinical and ERP workflows.
          </span>
        </div>
      </div>
    </div>
  );
}
