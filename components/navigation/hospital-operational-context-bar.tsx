/**
 * G-HIMS Master Operational Context Bar
 * Implements Rule 8 (Hospital Context Must Always Be Obvious):
 * 
 * Guarantees that at any point in time:
 * - A clinician never wonders: "Which patient am I editing?"
 * - A nurse never wonders: "Which encounter does this belong to?"
 * - A cashier never wonders: "Which facility or account am I operating against?"
 * 
 * Displays:
 * 1. Facility / Hospital & Tenant Code
 * 2. Department & Clinical Unit
 * 3. Current Authenticated User & Authoritative Role
 * 4. Active Patient Name, MRN & Vitals/Allergy Warning
 * 5. Active Encounter & Workflow Stage
 */

'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useTenant } from '@/lib/tenant/context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { useAuth } from '@/lib/firebase/auth-context';
import {
  Building2,
  Stethoscope,
  UserCheck,
  User,
  Activity,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Workflow,
  Search,
  CheckCircle2,
  FileText,
  BadgeAlert,
} from 'lucide-react';

interface OperationalContextBarProps {
  onOpenPatientSearch?: () => void;
}

export function HospitalOperationalContextBar({ onOpenPatientSearch }: OperationalContextBarProps) {
  const { currentTenant, userTenants, switchTenant } = useTenant();
  const availableTenants = userTenants || [];
  const {
    patients,
    selectedPatientId,
    clinicalContext,
    activeTab,
    setActiveTab,
  } = useHospital();
  const { currentRole, roleDefinition } = useRBAC();
  const { user } = useAuth();
  const [facilityDropdownOpen, setFacilityDropdownOpen] = useState(false);

  // Clinical views resolve identity from the encounter-bound context first.
  // selectedPatientId remains available for non-clinical MPI browsing only.
  const clinicalTabs = new Set([
    'opd',
    'workflow-runtime',
    'emergency',
    'beds',
    'surgery',
    'disease-intake',
  ]);
  const clinicalContextActive = clinicalTabs.has(activeTab);
  const effectivePatientId = clinicalContextActive
    ? clinicalContext?.status === 'VERIFIED'
      ? clinicalContext.patientId
      : null
    : selectedPatientId;
  const activePatient = effectivePatientId
    ? patients.find((patient) => patient.id === effectivePatientId) || null
    : null;
  const unresolvedClinicalContext =
    clinicalContextActive &&
    Boolean(clinicalContext) &&
    (clinicalContext?.status !== 'VERIFIED' || !activePatient);

  // Resolve departmental and workflow context based on active tab
  const getDepartmentAndWorkflow = () => {
    switch (activeTab) {
      case 'emergency':
        return {
          department: 'Emergency & Trauma (ER)',
          unit: 'Resuscitation Bay & Triage Zone 1',
          workflow: 'Manchester / NEWS2 Triage Protocol (Stage 1/3)',
          isClinical: true,
        };
      case 'opd':
        return {
          department: 'Outpatient Department (OPD)',
          unit: 'Ambulatory Consultation Suite 4',
          workflow: 'Standard Ambulatory Encounter Protocol (Stage 2/4)',
          isClinical: true,
        };
      case 'beds':
        return {
          department: 'Inpatient Department (IPD)',
          unit: 'Ward 3B - Intensive Medical Unit',
          workflow: 'Continuous Patient Census & Rounding',
          isClinical: true,
        };
      case 'surgery':
        return {
          department: 'Surgical Services',
          unit: 'OR Suite 2 - Laminar Flow Theater',
          workflow: 'WHO Surgical Safety Checklist Protocol',
          isClinical: true,
        };
      case 'billing':
      case 'erp-coa':
        return {
          department: 'Revenue Cycle & General Ledger',
          unit: 'Central Accounts & Cashier Desk 01',
          workflow: 'Double-Entry Universal Journal & AR Open Items',
          isClinical: false,
        };
      case 'disease-intake':
        return {
          department: 'Specialty Clinics',
          unit: 'Intake & Clinical Evidence Protocol Room',
          workflow: 'Disease-Centric Guided Pathway',
          isClinical: true,
        };
      case 'claims':
        return {
          department: 'Insurance & Claims Management',
          unit: 'Adjudication & Pre-Auth Desk',
          workflow: 'Payor Pre-Authorization & Audit Validation',
          isClinical: false,
        };
      case 'hr-management':
        return {
          department: 'Human Capital Management (HCM)',
          unit: 'Staff Credentialing & Roster Control',
          workflow: 'Privilege Verification & Fatigue Compliance',
          isClinical: false,
        };
      default:
        return {
          department: 'Enterprise Command & Operations',
          unit: 'Main Hospital Pavilion',
          workflow: 'Clinical & Operational Governance',
          isClinical: false,
        };
    }
  };

  const { department, unit, workflow, isClinical } = getDepartmentAndWorkflow();

  return (
    <div
      id="hospital-operational-context-bar"
      className="w-full bg-slate-900 text-slate-100 border-b border-slate-800 shadow-md transition-all select-none"
    >
      <div className="w-full px-3 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        {/* SECTION 1: HOSPITAL / FACILITY & DEPARTMENT */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Facility with dropdown */}
          <div className="relative">
            <button
              id="btn-facility-selector"
              onClick={() => setFacilityDropdownOpen(!facilityDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 text-slate-200 transition-colors font-medium cursor-pointer"
              title="Change Hospital Facility"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-white tracking-tight max-w-[130px] sm:max-w-[200px] truncate">
                {currentTenant?.name || 'Central Metro General'}
              </span>
              <span className="text-[10px] font-mono text-blue-300 bg-blue-950/80 px-1 py-0.2 rounded border border-blue-800/60 hidden sm:inline">
                {currentTenant?.id?.substring(0, 8).toUpperCase() || 'CMGH'}
              </span>
            </button>

            {facilityDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setFacilityDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 text-slate-200">
                  <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    Switch Hospital Facility
                  </div>
                  {availableTenants.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        switchTenant(t.id);
                        setFacilityDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-800 transition-colors ${
                        t.id === currentTenant?.id ? 'text-blue-400 font-bold bg-blue-950/40' : 'text-slate-300'
                      }`}
                    >
                      <div className="truncate">
                        <div className="font-semibold text-slate-200 truncate">{t.name}</div>
                        <div className="text-[10px] text-slate-400">{t.id}</div>
                      </div>
                      {t.id === currentTenant?.id && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Department & Unit */}
          <div className="hidden md:flex items-center gap-1.5 text-slate-400">
            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            <span className="font-medium text-slate-300 max-w-[150px] lg:max-w-[200px] truncate">{department}</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400 text-[11px] truncate hidden xl:inline">{unit}</span>
          </div>
        </div>

        {/* SECTION 2: ACTIVE PATIENT CONTEXT (Crucial for Patient Safety) */}
        {isClinical && (
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400">Active Patient:</span>
              {activePatient ? (
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white tracking-tight">{activePatient.fullName || (activePatient as any).name}</span>
                  <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.2 rounded font-semibold">
                    {activePatient.mrn}
                  </span>
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    {activePatient.age}y / {activePatient.gender?.charAt(0).toUpperCase()}
                  </span>
                  {activePatient.allergies && activePatient.allergies.length > 0 && (
                    <span
                      title={`ALLERGIES: ${activePatient.allergies.join(', ')}`}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-red-950/90 border border-red-700 text-red-300 text-[10px] font-bold"
                    >
                      <BadgeAlert className="w-3 h-3 text-red-400" />
                      <span>{activePatient.allergies[0]}</span>
                    </span>
                  )}
                </div>
              ) : unresolvedClinicalContext ? (
                <span
                  className="text-rose-300 font-bold"
                  data-testid="shell-patient-context-unresolved"
                >
                  {clinicalContext?.status === 'MISMATCH'
                    ? 'PATIENT_CONTEXT_MISMATCH'
                    : 'PATIENT_CONTEXT_UNRESOLVED'}
                </span>
              ) : (
                <span className="text-amber-400 font-medium italic">No Patient Selected</span>
              )}
            </div>

            {/* Quick Switch Patient button */}
            <button
              id="btn-context-switch-patient"
              onClick={() => {
                if (onOpenPatientSearch) onOpenPatientSearch();
                else setActiveTab('patients');
              }}
              className="ml-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium underline flex items-center gap-0.5 cursor-pointer"
            >
              {activePatient ? 'Switch encounter' : 'Select encounter'}
            </button>
          </div>
        )}

        {/* SECTION 3: CURRENT USER, ROLE & WORKFLOW */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Active Workflow Badge */}
          <div className="hidden lg:flex items-center gap-1 text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700/60 px-2 py-0.5 rounded-md">
            <Workflow className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="max-w-[180px] truncate text-slate-300" title={workflow}>
              {workflow}
            </span>
          </div>

          {/* User & Role Badge */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-200 truncate max-w-[120px]">
                {user?.displayName || 'Dr. Sarah Chen, MD'}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 bg-blue-950/80 border border-blue-800/60 px-1.5 py-0.2 rounded">
                {roleDefinition.displayName || (roleDefinition as any).label}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
