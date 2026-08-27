'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  TrendingUp,
  ShieldAlert,
  Zap,
  DollarSign,
  Building2,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Sparkles,
  AlertTriangle,
  Server,
  Layers,
  Cpu,
  FileText,
  Activity,
  ChevronRight,
  Stethoscope,
  BedDouble,
  Scissors,
  FlaskConical,
  Droplet,
  Video,
  FileCheck,
  Users,
  LayoutGrid,
  HeartPulse,
  GitFork,
  Boxes,
  BookOpen,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function CommandHubView() {
  const { stats, mismatches, setActiveTab, reconcileMismatch, beds, opdQueue, patients } = useHospital();

  const pendingMismatches = mismatches.filter((m) => m.status === 'pending_review');
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length;
  const waitingPatients = opdQueue.filter((q) => q.status === 'waiting').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Welcome & System Status Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Hospital Operations Command
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Metropolitan Memorial Health System • Live Clinical & Financial Telemetry
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('opd')}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Stethoscope className="w-3.5 h-3.5" /> OPD Consultations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('beds')}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            <BedDouble className="w-3.5 h-3.5" /> Inpatient Census
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('directory')}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> All Subsystems
          </button>
        </div>
      </div>

      {/* 4 Core Primary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Bed Occupancy */}
        <div 
          onClick={() => setActiveTab('beds')}
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-blue-400 dark:hover:border-blue-600 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Bed Occupancy</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <BedDouble className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{stats.occupancyRate}%</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">({occupiedBeds}/{stats.totalBeds} Active)</span>
          </div>
          <div className="mt-2 w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div 
              className="bg-blue-600 h-full rounded-full transition-all duration-500" 
              style={{ width: `${stats.occupancyRate}%` }} 
            />
          </div>
        </div>

        {/* Emergency Triage */}
        <div 
          onClick={() => setActiveTab('emergency')}
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-rose-400 dark:hover:border-rose-600 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Emergency & Trauma</span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{stats.emergencyPatients}</span>
            <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold">Critical Triage (ESI 1-3)</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
            4 Resuscitation Bays Operational
          </p>
        </div>

        {/* OPD Clinic Queue */}
        <div 
          onClick={() => setActiveTab('opd')}
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-indigo-400 dark:hover:border-indigo-600 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Outpatient Clinic</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Stethoscope className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{waitingPatients}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">In Active Queue</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
            Average Wait: 14 mins • 6 Consult Rooms
          </p>
        </div>

        {/* Revenue Leakage Safeguard */}
        <div 
          onClick={() => setActiveTab('billing')}
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-emerald-400 dark:hover:border-emerald-600 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Revenue Catchment</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(stats.revenueLeakageRecoveredToday)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
            {pendingMismatches.length} Unbilled alerts pending review
          </p>
        </div>
      </div>

      {/* Main Operations Grid: Left Clinical & Revenue Alerts, Right Department Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Point of Care Alerts & Quick Audits (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Revenue Leakage Catchment Section */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Clinical Documentation Audits
                  </h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Procedures documented in doctor notes with pending billing reconciliation
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('billing')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                View Ledger <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {pendingMismatches.length === 0 ? (
              <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-xs">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                All documented clinical procedures are fully reconciled with billing.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {pendingMismatches.slice(0, 3).map((mm) => (
                  <div key={mm.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{mm.patientName}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                          CPT {mm.suggestedCptCode}
                        </span>
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          +{formatCurrency(mm.estimatedRecoverableRevenue)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{mm.documentedItem}</p>
                      <p className="text-[11px] text-slate-400 italic">&ldquo;{mm.evidenceSnippet}&rdquo;</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => reconcileMismatch(mm.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1 shadow-xs transition-colors shrink-0 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Reconcile
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clinical Protocol Workflows & DAG Runtime */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Active Clinical Protocols
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Guideline-driven intake, risk scoring & specialist briefings
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('disease-intake')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                Launch Protocol <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div 
                onClick={() => setActiveTab('disease-intake')}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Acute Coronary Syndrome</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-semibold">
                    AHA / ESC
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  HEART Score, Serial Troponin & ECG timing
                </p>
              </div>

              <div 
                onClick={() => setActiveTab('disease-intake')}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Sepsis Screening (qSOFA)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-semibold">
                    Surviving Sepsis
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  1-Hour bundle: Lactate, Blood cultures, Broad-spectrum Rx
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Department Health & Quick Navigation (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Department Operations
              </h2>
            </div>

            <div className="space-y-2">
              {[
                {
                  id: 'opd',
                  name: 'Outpatient Clinic (OPD)',
                  status: `${waitingPatients} Waiting`,
                  icon: Stethoscope,
                },
                {
                  id: 'emergency',
                  name: 'Emergency & Trauma (ER)',
                  status: `${stats.emergencyPatients} Critical Bays`,
                  icon: ShieldAlert,
                },
                {
                  id: 'surgery',
                  name: 'Operating Theaters (OT)',
                  status: '4 Active Suites',
                  icon: Scissors,
                },
                {
                  id: 'beds',
                  name: 'Inpatient Wards & ICU',
                  status: `${occupiedBeds}/${stats.totalBeds} Beds`,
                  icon: BedDouble,
                },
                {
                  id: 'ancillary',
                  name: 'LIS Lab & Radiology Diagnostics',
                  status: 'Roche Auto-Flag On',
                  icon: FlaskConical,
                },
                {
                  id: 'bloodbank',
                  name: 'Blood Bank Inventory',
                  status: '116 Cold Units',
                  icon: Droplet,
                },
                {
                  id: 'interop',
                  name: 'HL7 / FHIR R4 Interop Hub',
                  status: 'Socket Connected',
                  icon: Cpu,
                },
                {
                  id: 'audit',
                  name: 'Offline Vector Sync Engine',
                  status: 'HIPAA Compliant',
                  icon: Server,
                },
              ].map((dept) => {
                const Icon = dept.icon;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setActiveTab(dept.id)}
                    className="w-full p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 flex items-center justify-between text-left transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {dept.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {dept.status}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

