'use client';

import React from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Clock,
  Flame,
  Stethoscope,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  ComprehensiveOpdEncounter,
  OpdRole,
  OpdWorkflowStage,
  QueueEntry,
} from '@/types/opd-domain';

interface OpdDashboardKpisProps {
  encounters: ComprehensiveOpdEncounter[];
  queue: QueueEntry[];
  activeRole: OpdRole;
  snapshotSource: 'SERVER' | 'LOCAL' | 'DEMO';
  snapshotGeneratedAt: number;
  snapshotVersion: string;
  pendingSyncCount: number;
  isOnline: boolean;
  onSelectEncounter: (encounterId: string) => void;
  onNavigateStage: (stage: OpdWorkflowStage) => void;
}

type CanonicalDashboardStage =
  | 'REGISTRATION'
  | 'QUEUE'
  | 'TRIAGE'
  | 'CONSULTATION'
  | 'DIAGNOSTICS'
  | 'PHARMACY'
  | 'BILLING'
  | 'DISPOSITION'
  | 'UNKNOWN';

function normalizeDashboardStage(value: unknown): CanonicalDashboardStage {
  const stage = String(value || '').trim().toUpperCase();
  if (
    ['REGISTRATION', 'BILLING_AUTHORIZATION'].includes(stage)
  ) {
    return 'REGISTRATION';
  }
  if (['QUEUE', 'QUEUE_ASSIGNMENT'].includes(stage)) return 'QUEUE';
  if (['TRIAGE', 'NURSING_INTAKE', 'MO_ASSESSMENT'].includes(stage)) {
    return 'TRIAGE';
  }
  if (['CONSULTATION', 'SPECIALTY_CONSULTATION'].includes(stage)) {
    return 'CONSULTATION';
  }
  if (['DIAGNOSTICS_LAB_RAD', 'DIAGNOSTICS', 'DIAGNOSTIC_ORDERS'].includes(stage)) {
    return 'DIAGNOSTICS';
  }
  if (['PHARMACY_DISPENSARY', 'PHARMACY', 'PHARMACY_FEFO'].includes(stage)) {
    return 'PHARMACY';
  }
  if (['BILLING_SETTLEMENT', 'BILLING'].includes(stage)) return 'BILLING';
  if (
    [
      'DISPOSITION',
      'DISCHARGE_OR_REFERRAL',
      'DISPOSITION_CLOSURE',
      'TIMELINE_AUDIT',
    ].includes(stage)
  ) {
    return 'DISPOSITION';
  }
  return 'UNKNOWN';
}

function averageMinutes(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return (
    samples.reduce((sum, value) => sum + value, 0) /
    samples.length /
    60_000
  );
}

export function OpdDashboardKpis({
  encounters,
  queue,
  activeRole,
  snapshotSource,
  snapshotGeneratedAt,
  snapshotVersion,
  pendingSyncCount,
  isOnline,
  onSelectEncounter,
  onNavigateStage,
}: OpdDashboardKpisProps) {
  const stageCounts: Record<CanonicalDashboardStage, number> = {
    REGISTRATION: 0,
    QUEUE: 0,
    TRIAGE: 0,
    CONSULTATION: 0,
    DIAGNOSTICS: 0,
    PHARMACY: 0,
    BILLING: 0,
    DISPOSITION: 0,
    UNKNOWN: 0,
  };

  for (const encounter of encounters) {
    stageCounts[normalizeDashboardStage(encounter.currentStage)] += 1;
  }

  const completedCount = encounters.filter(
    (encounter) =>
      String(encounter.status || '').toUpperCase() === 'COMPLETED'
  ).length;

  const activeQueue = queue.filter((token) =>
    ['WAITING', 'CALLED', 'IN_SERVICE'].includes(
      String(token.status || '').toUpperCase()
    )
  );

  const completedWaitSamples = queue
    .map((token) => {
      const issuedAt = Number(token.issuedAt || token.createdAt || 0);
      const serviceStartedAt = Number(token.serviceStartedAt || 0);
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(serviceStartedAt) ||
        issuedAt <= 0 ||
        serviceStartedAt < issuedAt
      ) {
        return null;
      }
      return serviceStartedAt - issuedAt;
    })
    .filter((value): value is number => value !== null);

  const avgWaitMinutes = averageMinutes(completedWaitSamples);

  const highRiskEncounterIds = new Set<string>();
  for (const token of queue) {
    const priority = String(token.triagePriority || '').toUpperCase();
    if (
      priority === 'RED_IMMEDIATE' ||
      priority === 'ORANGE_VERY_URGENT'
    ) {
      highRiskEncounterIds.add(token.encounterId);
    }
  }
  for (const encounter of encounters) {
    const news2Risk = String(
      encounter.vitalsAssessment?.news2Risk || ''
    ).toUpperCase();
    const gcs = Number(encounter.vitalsAssessment?.gcsScore);
    if (
      news2Risk === 'HIGH' ||
      (Number.isFinite(gcs) && gcs > 0 && gcs <= 8)
    ) {
      highRiskEncounterIds.add(encounter.id);
    }
  }

  const deptMap = new Map<string, number>();
  for (const encounter of encounters) {
    const department = String(encounter.department || '').trim() || 'UNASSIGNED';
    deptMap.set(department, (deptMap.get(department) || 0) + 1);
  }

  const clinicianMap = new Map<
    string,
    { name: string; department: string; total: number; active: number }
  >();
  for (const encounter of encounters) {
    const clinicianId = String(encounter.attendingDoctorId || '').trim();
    const clinicianName = String(encounter.attendingDoctorName || '').trim();
    const key = clinicianId || clinicianName || 'UNASSIGNED';
    const current = clinicianMap.get(key) || {
      name: clinicianName || 'Unassigned clinician',
      department: String(encounter.department || '').trim() || 'Unassigned',
      total: 0,
      active: 0,
    };
    current.total += 1;
    if (String(encounter.status || '').toUpperCase() !== 'COMPLETED') {
      current.active += 1;
    }
    clinicianMap.set(key, current);
  }

  const scopeLabel =
    activeRole === 'ADMINISTRATOR'
      ? 'Authorized administrative OPD snapshot'
      : `Authorized ${activeRole.replace(/_/g, ' ').toLowerCase()} OPD snapshot`;

  const snapshotTimestamp =
    snapshotGeneratedAt > 0
      ? new Date(snapshotGeneratedAt).toLocaleString()
      : 'Not yet hydrated';
  const snapshotProvenanceLabel =
    snapshotSource === 'SERVER'
      ? 'Server snapshot'
      : snapshotSource === 'LOCAL'
        ? 'Cached local snapshot'
        : 'Demo snapshot';
  const hasFreshnessWarning =
    snapshotSource === 'LOCAL' || !isOnline || pendingSyncCount > 0;

  const funnel: Array<{
    label: string;
    count: number;
    stage: OpdWorkflowStage;
    color: string;
  }> = [
    {
      label: 'Registration',
      count: stageCounts.REGISTRATION,
      stage: 'REGISTRATION',
      color: 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30',
    },
    {
      label: 'Queue',
      count: stageCounts.QUEUE,
      stage: 'QUEUE',
      color: 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30',
    },
    {
      label: 'Triage / NEWS2',
      count: stageCounts.TRIAGE,
      stage: 'TRIAGE',
      color: 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/30',
    },
    {
      label: 'Consultation',
      count: stageCounts.CONSULTATION,
      stage: 'CONSULTATION',
      color: 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30',
    },
    {
      label: 'Lab & PACS',
      count: stageCounts.DIAGNOSTICS,
      stage: 'DIAGNOSTICS',
      color: 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30',
    },
    {
      label: 'Pharmacy',
      count: stageCounts.PHARMACY,
      stage: 'PHARMACY',
      color: 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30',
    },
    {
      label: 'Billing',
      count: stageCounts.BILLING,
      stage: 'BILLING',
      color: 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30',
    },
    {
      label: 'Disposition',
      count: stageCounts.DISPOSITION,
      stage: 'DISPOSITION',
      color: 'border-slate-400 bg-slate-50 dark:bg-slate-800',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{scopeLabel}</p>
          <span className="rounded-full border border-blue-200 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
            {snapshotProvenanceLabel}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] opacity-80">
          Counts are derived only from the authorized OPD read model visible to
          this session. No tenant-wide or historical trend is inferred from
          hidden data.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] opacity-80">
          <span>Generated: {snapshotTimestamp}</span>
          <span>Version: {snapshotVersion || 'unknown'}</span>
          <span>Pending sync: {pendingSyncCount}</span>
        </div>
        {hasFreshnessWarning && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {!isOnline
              ? 'Offline: dashboard values come from the last authorized local snapshot.'
              : snapshotSource === 'LOCAL'
                ? 'Server refresh was unavailable; dashboard values come from the last authorized local snapshot.'
                : 'Pending offline mutations are not yet authoritative and may not be reflected in these KPIs.'}
          </div>
        )}
        {stageCounts.UNKNOWN > 0 && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-[10px] font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            Data-quality warning: {stageCounts.UNKNOWN} visible encounter
            {stageCounts.UNKNOWN === 1 ? '' : 's'} has an unrecognized workflow
            stage and is excluded from the workflow distribution.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              Visible OPD Encounters
            </span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">
            {encounters.length}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-slate-400">
            Current authorized snapshot
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              Active Queue
            </span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-1 text-2xl font-black text-amber-600">
            {activeQueue.length}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-slate-400">
            {avgWaitMinutes === null
              ? 'No completed wait samples'
              : `Observed token→service: ${avgWaitMinutes.toFixed(1)} min (${completedWaitSamples.length} sample${completedWaitSamples.length === 1 ? '' : 's'})`}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              In Consultation
            </span>
            <Stethoscope className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-indigo-600">
            {stageCounts.CONSULTATION}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-slate-400">
            Canonical workflow stage
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              Ancillary & Pharmacy
            </span>
            <Activity className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-purple-600">
            {stageCounts.DIAGNOSTICS + stageCounts.PHARMACY}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-slate-400">
            Diagnostics + pharmacy stages
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              Completed
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-emerald-600">
            {completedCount}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-slate-400">
            Authoritative encounter status
          </span>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 shadow-xs dark:border-red-800/80 dark:bg-red-950/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
              High-Risk Signal
            </span>
            <Flame className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-1 text-2xl font-black text-red-600">
            {highRiskEncounterIds.size}
          </p>
          <span className="mt-1 block text-[10px] font-medium text-red-700 dark:text-red-300">
            {highRiskEncounterIds.size > 0
              ? 'RED/ORANGE queue or high NEWS2/GCS signal'
              : 'No high-risk signal in visible snapshot'}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
          <span>Authoritative Workflow Distribution</span>
          <span className="text-[11px] font-normal text-slate-400">
            {encounters.length} visible encounter{encounters.length === 1 ? '' : 's'}
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4 lg:grid-cols-8">
          {funnel.map((step) => (
            <button
              key={step.label}
              type="button"
              onClick={() => onNavigateStage(step.stage)}
              className={`cursor-pointer rounded-xl border p-3 text-left transition-all hover:shadow-xs ${step.color}`}
            >
              <span className="block truncate text-[10px] font-semibold text-slate-500">
                {step.label}
              </span>
              <p className="mt-0.5 text-lg font-black text-slate-900 dark:text-slate-100">
                {step.count}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Building2 className="h-4 w-4 text-blue-600" />
            Visible Department Distribution
          </h3>
          {deptMap.size === 0 ? (
            <p className="text-xs text-slate-400">
              No department-scoped encounters are visible.
            </p>
          ) : (
            <div className="space-y-2.5">
              {[...deptMap.entries()]
                .sort((left, right) => right[1] - left[1])
                .map(([department, count]) => {
                  const percentage = Math.round(
                    (count / Math.max(encounters.length, 1)) * 100
                  );
                  return (
                    <div key={department} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-700 dark:text-slate-300">
                          {department.replace(/_/g, ' ')}
                        </span>
                        <span className="text-slate-500">
                          {count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <UserCheck className="h-4 w-4 text-indigo-600" />
            Visible Clinician Workload
          </h3>
          {clinicianMap.size === 0 ? (
            <p className="text-xs text-slate-400">
              No clinician assignment is visible in this snapshot.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {[...clinicianMap.entries()]
                .sort((left, right) => right[1].active - left[1].active)
                .map(([key, clinician]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={key === 'UNASSIGNED'}
                    onClick={() => {
                      if (key === 'UNASSIGNED') return;
                      const encounter = encounters.find(
                        (item) =>
                          item.attendingDoctorId === key ||
                          item.attendingDoctorName === key
                      );
                      if (encounter) onSelectEncounter(encounter.id);
                    }}
                    className="flex w-full items-center justify-between py-2.5 text-left disabled:cursor-default"
                  >
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        {clinician.name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {clinician.department.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-extrabold text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        {clinician.active} active
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {clinician.total} total
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
