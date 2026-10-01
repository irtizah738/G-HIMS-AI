'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  RefreshCw,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  hydrateWorkforceMaster,
  loadLocalWorkforceMaster,
} from '@/lib/hcm/hcm-edge-adapter';
import type { EmployeeMaster } from '@/types/hcm-advanced';

export function HrManagementView() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [source, setSource] = useState<'LOCAL' | 'SERVER'>('LOCAL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const local = await loadLocalWorkforceMaster(tenantId);
      setEmployees(local.employees);
      try {
        const server = await hydrateWorkforceMaster(tenantId);
        setEmployees(server.employees);
        setSource('SERVER');
      } catch (serverError) {
        setSource('LOCAL');
        setError(
          serverError instanceof Error
            ? serverError.message
            : 'Authoritative workforce hydration is unavailable.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const summary = useMemo(() => {
    const active = employees.filter(
      (employee) => employee.employmentStatus === 'ACTIVE'
    ).length;
    const onboarding = employees.filter(
      (employee) => employee.employmentStatus === 'ONBOARDING'
    ).length;
    const facilities = new Set(
      employees.flatMap((employee) => employee.facilityIds || [])
    ).size;
    const departments = new Set(
      employees.flatMap((employee) => employee.departmentIds || [])
    ).size;
    return { active, onboarding, facilities, departments };
  }, [employees]);

  const links = [
    {
      href: `/${tenantId}/hcm/workforce`,
      title: 'Workforce Master',
      description: 'Create and manage tenant-authoritative employee records and assignments.',
      icon: Users,
    },
    {
      href: `/${tenantId}/hcm/credentials`,
      title: 'Credentials & Privileges',
      description: 'Verify credentials and govern clinical privilege state.',
      icon: BadgeCheck,
    },
    {
      href: `/${tenantId}/hcm/roster`,
      title: 'Roster & Fatigue',
      description: 'Govern staffing assignments, rest constraints and coverage.',
      icon: CalendarClock,
    },
    {
      href: `/${tenantId}/hcm/payroll`,
      title: 'Payroll',
      description: 'Run governed payroll with attendance locks and Finance handoff.',
      icon: WalletCards,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">G-HIMS HCM</p>
            <h2 className="mt-1 text-xl font-black">Authoritative Workforce Control Center</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Workforce state is loaded from governed projections. Demo departments, headcounts, salaries and named staff are never initialized in STAGING or PILOT.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Projection source: {source}{loading ? ' • hydrating…' : ''}
        </div>
        {error ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Server hydration unavailable; showing encrypted local projection. {error}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Active employees', summary.active],
          ['Onboarding', summary.onboarding],
          ['Facilities represented', summary.facilities],
          ['Departments represented', summary.departments],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{Number(value).toLocaleString()}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {links.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-blue-400">
            <Icon className="h-5 w-5 text-blue-600" />
            <h3 className="mt-3 font-black">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <h3 className="font-black">Current workforce projection</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {employees.slice(0, 20).map((employee) => (
            <div key={employee.employeeId} className="grid gap-1 px-5 py-3 sm:grid-cols-4 sm:items-center">
              <span className="font-semibold">
                {employee.personalInfo.legalFirstName} {employee.personalInfo.legalLastName}
              </span>
              <span className="text-sm text-slate-500">{employee.employeeNumber}</span>
              <span className="text-sm text-slate-500">{employee.positionTitle}</span>
              <span className="text-sm font-semibold">{employee.employmentStatus}</span>
            </div>
          ))}
          {!loading && employees.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No workforce records are available in the current authorized projection.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
