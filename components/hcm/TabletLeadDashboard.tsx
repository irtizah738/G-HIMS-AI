'use client';

import React, { useState, useMemo } from 'react';
import {
  Tablet,
  Smartphone,
  Monitor,
  Users,
  Building2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Activity,
  PhoneCall,
  ChevronRight,
  Filter,
  Layers,
  Sparkles,
  TrendingUp,
  Award,
  Zap,
  CheckSquare,
  X,
  FileCheck,
  Stethoscope,
} from 'lucide-react';
import { EmployeeMaster, EmployeeCredential, HospitalDepartment } from '@/types/hcm-advanced';
import { OvertimeBudgetVarianceChart } from './OvertimeBudgetVarianceChart';

interface TabletLeadDashboardProps {
  departments: HospitalDepartment[];
  employees: EmployeeMaster[];
  credentials: EmployeeCredential[];
  onSelectEmployee?: (emp: EmployeeMaster) => void;
  onVerifyCredential?: (cred: EmployeeCredential) => void;
  onTriggerNotification?: (msg: string) => void;
}

export function TabletLeadDashboard({
  departments,
  employees,
  credentials,
  onSelectEmployee,
  onVerifyCredential,
  onTriggerNotification,
}: TabletLeadDashboardProps) {
  // Department Lead Selection
  const [selectedDeptCode, setSelectedDeptCode] = useState<string>('dept_emergency');
  // Tablet View Mode: Touch Cards vs Adaptive Matrix
  const [tabletViewMode, setTabletViewMode] = useState<'cards' | 'matrix'>('cards');
  // Quick Search
  const [searchQuery, setSearchQuery] = useState('');
  // Quick Action Modal / Drawer
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Active Department
  const currentDept = useMemo(() => {
    if (selectedDeptCode === 'ALL') return null;
    return departments.find((d) => d.departmentId === selectedDeptCode) || departments[0];
  }, [selectedDeptCode, departments]);

  // Filtered Department Staff
  const deptStaff = useMemo(() => {
    return employees.filter((emp) => {
      const matchDept =
        selectedDeptCode === 'ALL' ||
        emp.primaryDepartmentId === selectedDeptCode ||
        emp.departmentIds?.includes(selectedDeptCode);

      const matchQuery =
        !searchQuery ||
        emp.personalInfo.legalFirstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.personalInfo.legalLastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.positionTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.employeeNumber.toLowerCase().includes(searchQuery.toLowerCase());

      return matchDept && matchQuery;
    });
  }, [employees, selectedDeptCode, searchQuery]);

  // Department Lead Operational Vitals
  const leadVitals = useMemo(() => {
    const totalStaff = deptStaff.length;
    const activeStaff = deptStaff.filter((e) => e.employmentStatus === 'ACTIVE').length;

    // Credentials status for these staff
    const staffIds = new Set(deptStaff.map((e) => e.employeeId));
    const deptCreds = credentials.filter((c) => staffIds.has(c.employeeId));
    const unverifiedCreds = deptCreds.filter((c) => c.verificationStatus !== 'VERIFIED').length;

    // Expiring credentials (<60 days)
    const now = new Date();
    const sixtyDaysLater = new Date();
    sixtyDaysLater.setDate(now.getDate() + 60);
    const expiringSoon = deptCreds.filter((c) => {
      const exp = new Date(c.expirationDate);
      return exp > now && exp <= sixtyDaysLater;
    }).length;

    return {
      totalStaff,
      activeStaff,
      unverifiedCreds,
      expiringSoon,
      criticalGaps: selectedDeptCode === 'dept_emergency' ? 2 : selectedDeptCode === 'dept_surgery' ? 1 : 0,
      fatigueAlerts: selectedDeptCode === 'dept_emergency' ? 3 : selectedDeptCode === 'dept_surgery' ? 2 : 1,
    };
  }, [deptStaff, credentials, selectedDeptCode]);

  const handleQuickAction = (message: string) => {
    setActionNotice(message);
    if (onTriggerNotification) onTriggerNotification(message);
    setTimeout(() => setActionNotice(null), 5000);
  };

  return (
    <div id="tablet-lead-dashboard-root" className="space-y-6">
      {/* Top Tablet Lead Command Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shrink-0">
              <Tablet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  Medical Department Lead Tablet Terminal
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Touch Rounds Optimized
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Specialized ergonomic cockpit for Clinical Chairs, Chiefs of Service & Charge Nurses on clinical rounds.
              </p>
            </div>
          </div>

          {/* Tablet View Switching Controls */}
          <div className="flex items-center gap-2 self-start md:self-auto">
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                id="tablet-view-cards-btn"
                onClick={() => setTabletViewMode('cards')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer min-h-[38px] ${
                  tabletViewMode === 'cards'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Touch Cards</span>
              </button>
              <button
                id="tablet-view-matrix-btn"
                onClick={() => setTabletViewMode('matrix')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer min-h-[38px] ${
                  tabletViewMode === 'matrix'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Swipeable Matrix</span>
              </button>
            </div>
          </div>
        </div>

        {/* 1-Tap Department Switcher Ribbon - Sized for finger taps (min 44px) */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1 mr-1">
              <Building2 className="w-3.5 h-3.5" /> Unit:
            </span>
            <button
              onClick={() => setSelectedDeptCode('ALL')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer min-h-[42px] flex items-center gap-2 ${
                selectedDeptCode === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <span>All Clinical Units</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 text-white font-mono">
                {employees.length}
              </span>
            </button>

            {departments.map((dept) => {
              const isSelected = selectedDeptCode === dept.departmentId;
              const staffInDept = employees.filter(
                (e) => e.primaryDepartmentId === dept.departmentId || e.departmentIds?.includes(dept.departmentId)
              ).length;

              return (
                <button
                  key={dept.departmentId}
                  onClick={() => setSelectedDeptCode(dept.departmentId)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer min-h-[42px] flex items-center gap-2 ${
                    isSelected
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  <span>{dept.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {staffInDept}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operational Feedback Toast */}
      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 text-xs font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-indigo-500 hover:text-indigo-700 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Department Lead Vital Signs HUD - High contrast for quick rounds */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Active On Duty</span>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600">
            {leadVitals.activeStaff}
            <span className="text-xs text-slate-400 font-normal ml-1">/ {leadVitals.totalStaff}</span>
          </div>
          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
            Clinical Floor Ready
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Shift Gaps Today</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-600">
            {leadVitals.criticalGaps} Gaps
          </div>
          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
            {leadVitals.criticalGaps > 0 ? 'Needs PRN / Locum' : 'Fully Roster Covered'}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Fatigue Alerts</span>
            <Clock className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black font-mono text-rose-600">
            {leadVitals.fatigueAlerts} Staff
          </div>
          <span className="text-[10px] text-rose-700 dark:text-rose-400 font-medium">
            &gt;50h or &lt;10h Rest
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">License Expirations</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-600">
            {leadVitals.expiringSoon}
          </div>
          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
            &lt; 60 Days Threshold
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Credential Audits</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black font-mono text-indigo-600">
            {leadVitals.unverifiedCreds === 0 ? '100%' : `${leadVitals.unverifiedCreds} Pending`}
          </div>
          <span className="text-[10px] text-indigo-700 dark:text-indigo-400 font-medium">
            Privileges Gated
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">OT Budget Drift</span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
            {selectedDeptCode === 'dept_emergency'
              ? '+36.9%'
              : selectedDeptCode === 'dept_surgery'
              ? '+29.0%'
              : '+4.3%'}
          </div>
          <span className="text-[10px] text-rose-600 font-bold">
            {selectedDeptCode === 'dept_emergency' || selectedDeptCode === 'dept_surgery'
              ? 'Recurring Variance'
              : 'Within Tolerance'}
          </span>
        </div>
      </div>

      {/* Embedded Overtime & Budget Trends Chart - specifically adapted for tablet */}
      <OvertimeBudgetVarianceChart onNotifyLead={handleQuickAction} />

      {/* DEPARTMENT CLINICAL WORKFORCE VIEW SECTION */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-indigo-600" />
              <span>
                {currentDept ? currentDept.name : 'All Hospital Staff'} — Clinical Roster & Credentials
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing {deptStaff.length} clinicians. Tap any card for credential inspection or emergency contact.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search clinician, specialty..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 min-h-[40px] w-full sm:w-60"
            />
          </div>
        </div>

        {/* MODE A: TOUCH CARDS (Clinical Deck - Optimized for 768px-1024px Tablet interaction) */}
        {tabletViewMode === 'cards' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deptStaff.map((emp) => {
              const empCreds = credentials.filter((c) => c.employeeId === emp.employeeId);
              const allVerified = empCreds.length > 0 && empCreds.every((c) => c.verificationStatus === 'VERIFIED');
              const hasExpiring = empCreds.some((c) => {
                const exp = new Date(c.expirationDate);
                const limit = new Date();
                limit.setDate(limit.getDate() + 60);
                return exp <= limit;
              });

              return (
                <div
                  key={emp.employeeId}
                  onClick={() => onSelectEmployee && onSelectEmployee(emp)}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs hover:border-indigo-400 dark:hover:border-indigo-600 transition-all cursor-pointer flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold flex items-center justify-center text-sm shrink-0 border border-indigo-100 dark:border-indigo-900">
                        {emp.personalInfo.legalFirstName[0]}
                        {emp.personalInfo.legalLastName[0]}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-tight">
                          {emp.personalInfo.legalFirstName} {emp.personalInfo.legalLastName}
                        </h4>
                        <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                          {emp.positionTitle}
                        </span>
                        <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                          {emp.employeeNumber}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                        emp.employmentStatus === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {emp.employmentStatus}
                    </span>
                  </div>

                  {/* Specialty & Badges */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Clinical Specialty:</span>
                      <strong className="text-slate-800 dark:text-slate-200 font-medium">
                        {emp.specialty || 'General Clinical'}
                      </strong>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Verified Privileges:</span>
                      <span className="flex items-center gap-1 font-semibold">
                        {allVerified ? (
                          <span className="text-emerald-600 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" /> Full Gated
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" /> Pending Audit
                          </span>
                        )}
                      </span>
                    </div>
                    {hasExpiring && (
                      <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[10px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>License renewal due within 60 days</span>
                      </div>
                    )}
                  </div>

                  {/* 1-Tap Tablet Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickAction(
                          `Emergency Pager dispatched to ${emp.personalInfo.legalFirstName} ${emp.personalInfo.legalLastName} (${emp.personalInfo.contactPhone || 'ext. 4410'})`
                        );
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer min-h-[44px]"
                    >
                      <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Page / Call</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectEmployee) onSelectEmployee(emp);
                      }}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs cursor-pointer min-h-[44px]"
                    >
                      <span>Credentials</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MODE B: SWIPEABLE ADAPTIVE MATRIX (Horizontal swipe enabled with sticky column) */}
        {tabletViewMode === 'matrix' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            {/* Visual swipe hint for tablet users */}
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
              <span>← Swipe table horizontally for full credential & privilege parameters →</span>
              <span className="font-mono text-[10px] text-indigo-600 font-bold">Sticky Clinician Column</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4 sticky left-0 bg-slate-50 dark:bg-slate-800 z-10 min-w-[200px]">
                      Clinician
                    </th>
                    <th className="py-3 px-4 min-w-[150px]">Position</th>
                    <th className="py-3 px-4 min-w-[140px]">Specialty</th>
                    <th className="py-3 px-4 min-w-[120px]">Status</th>
                    <th className="py-3 px-4 min-w-[150px]">Credential Audit</th>
                    <th className="py-3 px-4 min-w-[120px]">Contact</th>
                    <th className="py-3 px-4 text-center min-w-[120px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-800 dark:text-slate-200">
                  {deptStaff.map((emp) => {
                    const empCreds = credentials.filter((c) => c.employeeId === emp.employeeId);
                    const allVerified = empCreds.length > 0 && empCreds.every((c) => c.verificationStatus === 'VERIFIED');

                    return (
                      <tr
                        key={emp.employeeId}
                        onClick={() => onSelectEmployee && onSelectEmployee(emp)}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer min-h-[54px]"
                      >
                        <td className="py-3.5 px-4 sticky left-0 bg-white dark:bg-slate-900 z-10 font-bold text-slate-900 dark:text-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <div>
                            <div>
                              {emp.personalInfo.legalFirstName} {emp.personalInfo.legalLastName}
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 font-normal">
                              {emp.employeeNumber}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                          {emp.positionTitle}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                          {emp.specialty || 'Clinical'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              emp.employmentStatus === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {emp.employmentStatus}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {allVerified ? (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-[11px] font-semibold">
                              <ShieldCheck className="w-3.5 h-3.5" /> Full Gated
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-[11px] font-semibold">
                              <AlertCircle className="w-3.5 h-3.5" /> Audit Pending
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                          {emp.personalInfo.contactPhone || 'ext. 4410'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSelectEmployee) onSelectEmployee(emp);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-semibold text-xs cursor-pointer min-h-[36px]"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
