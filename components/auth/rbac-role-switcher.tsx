'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRBAC } from '@/lib/auth/rbac-context';
import { RoleId } from '@/types/rbac';
import { ROLE_DEFINITIONS, DEMO_PERSONAS } from '@/lib/auth/rbac';
import { 
  ShieldCheck, 
  Stethoscope, 
  HeartPulse, 
  ClipboardList, 
  DollarSign, 
  User, 
  ChevronDown, 
  Sparkles, 
  Check, 
  ShieldAlert, 
  Layers
} from 'lucide-react';

export function RbacRoleSwitcher() {
  const { currentRole, setRole, setIsRbacModalOpen, demoPersona, roleDefinition } = useRBAC();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getRoleIcon = (roleId: RoleId, className = 'w-3.5 h-3.5') => {
    switch (roleId) {
      case 'administrator': return <ShieldCheck className={className} />;
      case 'doctor': return <Stethoscope className={className} />;
      case 'nurse': return <HeartPulse className={className} />;
      case 'receptionist': return <ClipboardList className={className} />;
      case 'billing_clerk': return <DollarSign className={className} />;
      case 'patient': return <User className={className} />;
      default: return <User className={className} />;
    }
  };

  const handleRoleSelect = (roleId: RoleId) => {
    setRole(roleId);
    setDropdownOpen(false);
  };

  const rolesList: RoleId[] = [
    'administrator',
    'doctor',
    'nurse',
    'receptionist',
    'billing_clerk',
    'patient',
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-1">
        {/* Active Role Selector Pill */}
        <button
          id="btn-rbac-role-selector"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={`h-9 px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 sm:gap-2 text-xs font-semibold transition-all cursor-pointer select-none ${roleDefinition.badgeBg} ${roleDefinition.badgeBorder} ${roleDefinition.badgeColor} hover:brightness-95`}
          title={`Active RBAC Role: ${roleDefinition.displayName} (${demoPersona.name})`}
        >
          <div className="shrink-0">
            {getRoleIcon(currentRole, 'w-3.5 h-3.5')}
          </div>
          <div className="flex flex-col text-left leading-tight hidden xs:block sm:block">
            <span className="font-bold tracking-tight">{roleDefinition.displayName}</span>
            <span className="text-[10px] opacity-75 font-normal truncate max-w-[110px] hidden md:inline">
              {demoPersona.name.split(' ')[0]}
            </span>
          </div>
          <ChevronDown className={`w-3 h-3 transition-transform opacity-70 ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Inspect Permissions Matrix Button */}
        <button
          id="btn-open-rbac-matrix-modal"
          onClick={() => setIsRbacModalOpen(true)}
          className="h-9 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
          title="View Hospital RBAC Permissions Matrix"
        >
          <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden xl:inline text-[11px] font-semibold">RBAC Matrix</span>
        </button>
      </div>

      {/* Role Dropdown Menu */}
      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-blue-600" /> Role-Based Access Control
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Switch persona to test permissions live</p>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold">
              6 Roles
            </span>
          </div>

          <div className="p-1.5 space-y-1 max-h-[380px] overflow-y-auto">
            {rolesList.map((roleId) => {
              const def = ROLE_DEFINITIONS[roleId];
              const persona = DEMO_PERSONAS[roleId];
              const isSelected = currentRole === roleId;

              return (
                <button
                  key={roleId}
                  id={`btn-select-role-${roleId}`}
                  onClick={() => handleRoleSelect(roleId)}
                  className={`w-full text-left p-2.5 rounded-xl flex items-start gap-3 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/90 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg ${def.badgeBg} ${def.badgeColor} flex items-center justify-center shrink-0 mt-0.5 border ${def.badgeBorder}`}>
                    {getRoleIcon(roleId, 'w-4 h-4')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {def.displayName}
                      </span>
                      {isSelected && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100/60 dark:bg-blue-900/50 px-1.5 py-0.2 rounded">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                      {persona.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                      {def.summary}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <button
              onClick={() => {
                setDropdownOpen(false);
                setIsRbacModalOpen(true);
              }}
              className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <Layers className="w-3 h-3" /> View Comprehensive RBAC Matrix
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
