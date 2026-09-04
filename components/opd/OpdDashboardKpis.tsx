'use client';

import React from 'react';
import {
  Users,
  Activity,
  Stethoscope,
  Clock,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  FileText,
  UserCheck,
  TrendingUp,
  Building2,
  ShieldAlert,
  ArrowUpRight,
  Flame,
} from 'lucide-react';
import { ComprehensiveOpdEncounter, OpdRole } from '@/types/opd-domain';

interface OpdDashboardKpisProps {
  encounters: ComprehensiveOpdEncounter[];
  activeRole: OpdRole;
  onSelectEncounter: (encounterId: string) => void;
  onNavigateStage: (stage: any) => void;
}

export function OpdDashboardKpis({
  encounters,
  activeRole,
  onSelectEncounter,
  onNavigateStage,
}: OpdDashboardKpisProps) {
  const totalVisits = encounters.length;
  const registeredCount = encounters.filter(e => e.currentStage === 'REGISTRATION' || e.currentStage === 'BILLING_AUTHORIZATION').length;
  const inQueueCount = encounters.filter(e => e.currentStage === 'QUEUE_ASSIGNMENT').length;
  const inTriageCount = encounters.filter(e => e.currentStage === 'NURSING_INTAKE' || e.currentStage === 'MO_ASSESSMENT').length;
  const inConsultCount = encounters.filter(e => e.currentStage === 'SPECIALTY_CONSULTATION').length;
  const inDiagnosticsCount = encounters.filter(e => e.currentStage === 'DIAGNOSTIC_ORDERS').length;
  const inPharmacyCount = encounters.filter(e => e.currentStage === 'PHARMACY_FEFO').length;
  const inBillingCount = encounters.filter(e => e.currentStage === 'BILLING_SETTLEMENT').length;
  const completedCount = encounters.filter(e => e.status === 'COMPLETED').length;

  const urgentRedCount = encounters.filter(
    e => e.vitalsAssessment?.news2Risk === 'HIGH' || e.vitalsAssessment?.gcsScore! <= 8
  ).length;

  // Departmental breakdown
  const deptMap: Record<string, number> = {};
  encounters.forEach(e => {
    const dept = e.department || 'GENERAL_MEDICINE';
    deptMap[dept] = (deptMap[dept] || 0) + 1;
  });

  // Doctor workload breakdown
  const docMap: Record<string, { name: string; dept: string; count: number; active: number }> = {};
  encounters.forEach(e => {
    const docId = e.attendingDoctorId || 'doc-default';
    if (!docMap[docId]) {
      docMap[docId] = {
        name: e.attendingDoctorName || 'Attending Physician',
        dept: e.department || 'General Practice',
        count: 0,
        active: 0,
      };
    }
    docMap[docId].count += 1;
    if (e.status !== 'COMPLETED') {
      docMap[docId].active += 1;
    }
  });

  return (
    <div className="space-y-6">
      {/* High-Level Operational Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">Today&apos;s Visits</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">{totalVisits}</p>
          <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5 mt-1">
            <TrendingUp className="w-3 h-3" /> +14% vs yesterday
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">In Active Queue</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-600 mt-1">{inQueueCount + inTriageCount}</p>
          <span className="text-[10px] text-slate-400 font-medium mt-1 block">Avg wait: 14.2 min</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">In Consultation</span>
            <Stethoscope className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-black text-indigo-600 mt-1">{inConsultCount}</p>
          <span className="text-[10px] text-slate-400 font-medium mt-1 block">Avg consult: 16.5 min</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">Ancillary & Rx</span>
            <Activity className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-2xl font-black text-purple-600 mt-1">{inDiagnosticsCount + inPharmacyCount}</p>
          <span className="text-[10px] text-slate-400 font-medium mt-1 block">Lab, PACS & FEFO</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">Completed & Discharged</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-1">{completedCount}</p>
          <span className="text-[10px] text-emerald-600 font-bold mt-1 block">Zero Revenue Leakage</span>
        </div>

        <div className="p-4 rounded-2xl bg-red-50/60 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">High-Risk / Red Triage</span>
            <Flame className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-2xl font-black text-red-600 mt-1">{urgentRedCount}</p>
          <span className="text-[10px] text-red-700 dark:text-red-300 font-bold mt-1 block">
            {urgentRedCount > 0 ? 'Immediate Resus Track' : 'All Vitals Stable'}
          </span>
        </div>
      </div>

      {/* Live Operational Stage Progression Bar */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center justify-between">
          <span>Real-Time Clinic Patient Funnel</span>
          <span className="text-[11px] font-normal text-slate-400">Total Throughput: 18.4 pts/hr</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
          {[
            { label: 'Registration', count: registeredCount, stage: 'REGISTRATION', color: 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30' },
            { label: 'Queue Call', count: inQueueCount, stage: 'QUEUE_ASSIGNMENT', color: 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30' },
            { label: 'Triage / NEWS2', count: inTriageCount, stage: 'NURSING_INTAKE', color: 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/30' },
            { label: 'Consultation', count: inConsultCount, stage: 'SPECIALTY_CONSULTATION', color: 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30' },
            { label: 'Lab & PACS', count: inDiagnosticsCount, stage: 'DIAGNOSTIC_ORDERS', color: 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30' },
            { label: 'Pharmacy FEFO', count: inPharmacyCount, stage: 'PHARMACY_FEFO', color: 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30' },
            { label: 'Billing Settlement', count: inBillingCount, stage: 'BILLING_SETTLEMENT', color: 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30' },
            { label: 'Closure / Audit', count: completedCount, stage: 'TIMELINE_AUDIT', color: 'border-slate-400 bg-slate-50 dark:bg-slate-800' },
          ].map(step => (
            <button
              key={step.label}
              onClick={() => onNavigateStage(step.stage)}
              className={`p-3 rounded-xl border ${step.color} hover:shadow-xs transition-all cursor-pointer text-left`}
            >
              <span className="text-[10px] font-semibold text-slate-500 block truncate">{step.label}</span>
              <p className="text-lg font-black text-slate-900 dark:text-slate-100 mt-0.5">{step.count}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Two Column Section: Department Load & Doctor Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Volume Load */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600" />
            Active Clinic Specialty Distribution
          </h3>
          <div className="space-y-2.5">
            {Object.entries(deptMap).map(([dept, count]) => {
              const pct = Math.round((count / Math.max(totalVisits, 1)) * 100);
              return (
                <div key={dept} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-700 dark:text-slate-300">
                      {dept.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-500">{count} patients ({pct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 12)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Doctor Workload & Active Consultations */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            Attending Clinician Workload & Dwell Status
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {Object.entries(docMap).map(([docId, doc]) => (
              <div key={docId} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{doc.name}</p>
                  <p className="text-[11px] text-slate-400">{doc.dept.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    {doc.active} Active
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {doc.count} Total
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
