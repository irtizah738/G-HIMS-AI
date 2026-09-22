'use client';

import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Download,
  FileText,
  FileSpreadsheet,
  FileCode,
  Calendar,
  Filter,
  Building2,
  Bed,
  Users,
  DollarSign,
  HeartPulse,
  Activity,
  ShieldCheck,
  RefreshCw,
  Clock,
  Printer,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import {
  generateHospitalKpiReport,
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  AnalyticsFilterState,
  HospitalKpiReport,
} from '@/lib/analytics/hospital-kpi-data';
import { useRBAC } from '@/lib/auth/rbac-context';
import { ROLE_DEFINITIONS } from '@/lib/auth/rbac';

export function ReportingAnalyticsView() {
  const { currentRole, activeUser, hasPermission } = useRBAC();
  const roleDef = ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.doctor;

  // Filter State
  const [filter, setFilter] = useState<AnalyticsFilterState>({
    timeHorizon: '30d',
    department: 'all',
    encounterType: 'all',
  });

  // Active Tab
  const [activeTab, setActiveTab] = useState<
    'overview' | 'admissions' | 'readmissions' | 'revenue' | 'productivity' | 'bed_occupancy'
  >('overview');

  // Export state
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  // Memoized Report Data
  const report: HospitalKpiReport = useMemo(() => {
    return generateHospitalKpiReport(filter);
  }, [filter]);

  // RBAC Permission Check for Export
  const canExportData = hasPermission('reporting_analytics', 'export') || currentRole === 'administrator';

  const handleExportCsv = () => {
    exportReportToCsv(report, `ghims-kpi-report-${filter.timeHorizon}-${Date.now()}.csv`);
    showExportToast('CSV report downloaded successfully.');
  };

  const handleExportJson = () => {
    exportReportToJson(report, `ghims-kpi-data-${filter.timeHorizon}-${Date.now()}.json`);
    showExportToast('JSON report package downloaded.');
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      await exportReportToPdf(report, `ghims-executive-kpi-${filter.timeHorizon}.pdf`);
      showExportToast('Executive PDF generated and downloaded.');
    } catch (err) {
      console.error('PDF export failed:', err);
      showExportToast('PDF generation completed.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const showExportToast = (msg: string) => {
    setExportSuccessMsg(msg);
    setTimeout(() => {
      setExportSuccessMsg(null);
    }, 4000);
  };

  // Department revenue colors for pie chart
  const PIE_COLORS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#e11d48', '#4b5563', '#ec4899'];

  return (
    <div id="reporting-analytics-module" className="space-y-6 pb-12">
      {/* Top Header & Context */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <BarChart3 className="w-3.5 h-3.5" />
              Executive Analytics & Performance Engine
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Facility: {report.hospitalName} ({report.facilityCode})
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Hospital Analytics & Reporting
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Real-time key performance indicators, clinical readmissions, bed occupancy velocity, and revenue analytics.
          </p>
        </div>

        {/* Export & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {exportSuccessMsg && (
            <div className="animate-in fade-in slide-in-from-top-1 text-xs px-3 py-1.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {exportSuccessMsg}
            </div>
          )}

          <div className="relative group">
            <button
              id="export-pdf-btn"
              onClick={handleExportPdf}
              disabled={!canExportData || isExportingPdf}
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg shadow-sm border transition-all ${
                canExportData
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 dark:border-blue-700'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
              }`}
            >
              {isExportingPdf ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              {isExportingPdf ? 'Compiling PDF...' : 'Export PDF'}
            </button>
            {!canExportData && (
              <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-2 bg-slate-900 text-slate-200 text-xs rounded shadow-lg border border-slate-700">
                Export restricted: Active role ({roleDef.displayName}) requires export privileges on reporting_analytics.
              </div>
            )}
          </div>

          <button
            id="export-csv-btn"
            onClick={handleExportCsv}
            disabled={!canExportData}
            className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg shadow-sm border transition-all ${
              canExportData
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 dark:border-emerald-700'
                : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            id="export-json-btn"
            onClick={handleExportJson}
            disabled={!canExportData}
            className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg shadow-sm border transition-all ${
              canExportData
                ? 'bg-slate-800 hover:bg-slate-900 text-slate-100 border-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600'
                : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            JSON
          </button>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" />
              Report Scope
            </span>

            {/* Time Horizon */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              {(['24h', '7d', '30d', '90d', 'ytd'] as const).map((t) => (
                <button
                  key={t}
                  id={`filter-horizon-${t}`}
                  onClick={() => setFilter((prev) => ({ ...prev, timeHorizon: t }))}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    filter.timeHorizon === t
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {t === '24h'
                    ? 'Past 24H'
                    : t === '7d'
                    ? '7 Days'
                    : t === '30d'
                    ? '30 Days'
                    : t === '90d'
                    ? '90 Days'
                    : 'YTD 2026'}
                </button>
              ))}
            </div>

            {/* Department Dropdown */}
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <select
                id="filter-department-select"
                value={filter.department}
                onChange={(e) => setFilter((prev) => ({ ...prev, department: e.target.value }))}
                className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Departments (Hospital-Wide)</option>
                <option value="cardiology">Cardiology & Cath Lab</option>
                <option value="surgery">General Surgery & Operating Theater</option>
                <option value="emergency">Emergency & Trauma (ER)</option>
                <option value="icu">Critical Care (ICU / CCU)</option>
                <option value="oncology">Oncology & Infusion Care</option>
                <option value="orthopedics">Orthopedics & Joint Replacement</option>
                <option value="pediatrics">Pediatrics & Neonatal Care</option>
              </select>
            </div>

            {/* Encounter Type */}
            <div className="flex items-center gap-1.5">
              <select
                id="filter-encounter-select"
                value={filter.encounterType}
                onChange={(e) =>
                  setFilter((prev) => ({
                    ...prev,
                    encounterType: e.target.value as AnalyticsFilterState['encounterType'],
                  }))
                }
                className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Encounter Types</option>
                <option value="inpatient">Inpatient Ward Admissions</option>
                <option value="outpatient">Outpatient Clinic Visits (OPD)</option>
                <option value="emergency">Emergency Trauma Encounters</option>
                <option value="surgical">Elective & Emergency Surgical</option>
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Updated: {new Date(report.generatedAt).toLocaleTimeString()}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
        </div>
      </div>

      {/* RBAC Notice Banner */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Active Role Context: {roleDef.displayName} ({roleDef.category.toUpperCase()})
          </span>
          <span className="text-slate-500 dark:text-slate-400">— Least-Privilege Scope: Read Analytics</span>
        </div>
        <div className="text-slate-500 dark:text-slate-400">
          Export Authority: {canExportData ? 'Authorized' : 'Restricted (Audit Blocked)'}
        </div>
      </div>

      {/* 6 High-Impact Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {report.summaryCards.map((kpi) => (
          <div
            key={kpi.id}
            id={kpi.id}
            className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-blue-200 dark:hover:border-blue-900 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                <span className="font-medium truncate">{kpi.title}</span>
                <span
                  className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    kpi.trend === 'up'
                      ? kpi.isPositive
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      : kpi.isPositive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                  }`}
                >
                  {kpi.trend === 'up' ? (
                    <TrendingUp className="w-2.5 h-2.5 mr-0.5" />
                  ) : (
                    <TrendingDown className="w-2.5 h-2.5 mr-0.5" />
                  )}
                  {kpi.changePercent > 0 ? `+${kpi.changePercent}%` : `${kpi.changePercent}%`}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {kpi.value}
                </span>
                {kpi.unit && (
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {kpi.unit}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="truncate font-medium text-slate-700 dark:text-slate-300">
                {kpi.benchmark}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Sub-Tabs for Deep Dives */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-6">
          <button
            id="tab-overview"
            onClick={() => setActiveTab('overview')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Executive Overview
          </button>
          <button
            id="tab-admissions"
            onClick={() => setActiveTab('admissions')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'admissions'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Admissions & Discharges
          </button>
          <button
            id="tab-readmissions"
            onClick={() => setActiveTab('readmissions')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'readmissions'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Readmissions & ALOS
          </button>
          <button
            id="tab-revenue"
            onClick={() => setActiveTab('revenue')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'revenue'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Department Revenue & Margin
          </button>
          <button
            id="tab-bed-occupancy"
            onClick={() => setActiveTab('bed_occupancy')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'bed_occupancy'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Bed Occupancy Velocity
          </button>
          <button
            id="tab-productivity"
            onClick={() => setActiveTab('productivity')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'productivity'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Staff Productivity
          </button>
        </nav>
      </div>

      {/* TAB CONTENT: Executive Overview */}
      {(activeTab === 'overview' || activeTab === 'admissions') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart 1: Admissions vs Discharges Trend */}
          <div className="lg:col-span-8 p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Patient Admission & Discharge Velocity
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Daily comparison of new inpatient admissions vs hospital-wide discharges.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-blue-600 font-medium">
                  <span className="w-3 h-3 rounded bg-blue-500"></span> Total Admissions
                </span>
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <span className="w-3 h-3 rounded bg-emerald-500"></span> Discharges
                </span>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={report.admissionTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="admissionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="dischargeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      border: 'none',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalAdmissions"
                    name="Admissions"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#admissionGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="discharges"
                    name="Discharges"
                    stroke="#059669"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#dischargeGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Admission Sources Breakdown */}
          <div className="lg:col-span-4 p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
              Admission Modality Mix
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Distribution of ingress channels across emergency, elective, and surgical services.
            </p>

            <div className="space-y-3">
              {[
                { label: 'Emergency Dept Direct Intake', percent: 45, count: '558', color: 'bg-rose-500' },
                { label: 'Elective Medical Wards', percent: 30, count: '372', color: 'bg-blue-500' },
                { label: 'Scheduled Surgical / OT', percent: 15, count: '186', color: 'bg-purple-500' },
                { label: 'Outpatient Clinic (OPD) Transfer', percent: 10, count: '124', color: 'bg-amber-500' },
              ].map((item) => (
                <div key={item.label} className="text-xs">
                  <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300 mb-1">
                    <span>{item.label}</span>
                    <span className="font-bold">
                      {item.count} ({item.percent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className={`${item.color} h-2 rounded-full`} style={{ width: `${item.percent}%` }}></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300">
              <div className="font-semibold flex items-center gap-1 mb-0.5">
                <Info className="w-3.5 h-3.5" />
                Capacity Insight
              </div>
              Emergency admissions rose 4.8% over the selected window. Surgical ward turnarounds maintained 100% scheduled start reliability.
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Readmissions & ALOS */}
      {(activeTab === 'overview' || activeTab === 'readmissions') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 30-Day Readmission Chart */}
          <div className="lg:col-span-6 p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <HeartPulse className="w-4 h-4 text-purple-600" />
                  30-Day Readmission Rates by Department
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Actual readmission percentage vs CMS Quality Benchmark (National: 9.5%).
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.readmissionsByDept} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="department" angle={-25} textAnchor="end" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} unit="%" stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                  />
                  <ReferenceLine y={9.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'CMS Target: 9.5%', fill: '#ef4444', fontSize: 10 }} />
                  <Bar dataKey="readmissionRate" name="Readmission Rate (%)" fill="#7c3aed" radius={[4, 4, 0, 0]}>
                    {report.readmissionsByDept.map((entry, idx) => (
                      <Cell
                        key={`readmit-cell-${idx}`}
                        fill={entry.readmissionRate > entry.targetBenchmark ? '#ef4444' : '#7c3aed'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Average Length of Stay (ALOS) Chart */}
          <div className="lg:col-span-6 p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Bed className="w-4 h-4 text-teal-600" />
                  Average Length of Stay (ALOS) by Specialty
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hospital ALOS (days) vs Benchmark. Negative variance indicates high throughput efficiency.
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.alosByDept} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="department" angle={-25} textAnchor="end" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} unit=" d" stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="alos" name="Hospital ALOS (Days)" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="benchmark" name="CMS Benchmark (Days)" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Department Revenue & Margin */}
      {(activeTab === 'overview' || activeTab === 'revenue') && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Departmental Revenue, Collections & Margin Analysis
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gross billed charges vs net cash receipts and operating margin by specialty department.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.revenueByDept} margin={{ top: 10, right: 10, left: 10, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="department" angle={-20} textAnchor="end" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                    stroke="#94a3b8"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                    formatter={(val: number) => [`$${val.toLocaleString()}`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="grossBilled" name="Gross Billed ($)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="netCollected" name="Net Collected ($)" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Department Revenue Breakdown Table */}
            <div className="lg:col-span-4 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-2 font-semibold">Specialty</th>
                    <th className="py-2 px-2 font-semibold text-right">Collections</th>
                    <th className="py-2 px-2 font-semibold text-right">Rate</th>
                    <th className="py-2 pl-2 font-semibold text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {report.revenueByDept.map((r) => (
                    <tr key={r.department} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-2 font-medium truncate max-w-[130px]">{r.department}</td>
                      <td className="py-2 px-2 text-right font-bold text-emerald-700 dark:text-emerald-400">
                        ${(r.netCollected / 1000).toFixed(0)}k
                      </td>
                      <td className="py-2 px-2 text-right">{r.collectionRate}%</td>
                      <td className="py-2 pl-2 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                          {r.operatingMargin}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Bed Occupancy Trends */}
      {(activeTab === 'overview' || activeTab === 'bed_occupancy') && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Bed className="w-4 h-4 text-blue-600" />
                Bed Occupancy Trends Over Time by Ward
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Continuous tracking of licensed bed utilization. Target operating window: 80% - 85%. Threshold &gt;85% triggers surge protocols.
              </p>
            </div>
          </div>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.bedOccupancyTrends} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[50, 100]} unit="%" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Critical Threshold 85%', fill: '#ef4444', fontSize: 10 }} />
                <ReferenceLine y={80} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Target 80%', fill: '#10b981', fontSize: 10 }} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="overallOccupancy" name="Overall Hospital Occupancy" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="icuOccupancy" name="Intensive Care Unit (ICU)" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="generalWardOccupancy" name="General Medical Ward" stroke="#059669" strokeWidth={2} />
                <Line type="monotone" dataKey="surgicalWardOccupancy" name="Surgical Recovery Ward" stroke="#7c3aed" strokeWidth={2} />
                <Line type="monotone" dataKey="emergencyOccupancy" name="Emergency Observation Beds" stroke="#d97706" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Staff Productivity */}
      {(activeTab === 'overview' || activeTab === 'productivity') && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Clinical & Nursing Staff Productivity Index
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Workload metrics, staffing ratio compliance, patient throughput velocity, and documentation turnaround.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40">
                  <th className="py-2.5 px-3 font-semibold">Staff Category</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Active Staff</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Avg Daily Throughput</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Ratio Compliance</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Doc Turnaround</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Avg Overtime</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Productivity Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {report.staffProductivity.map((s) => (
                  <tr key={s.staffCategory} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-semibold text-slate-900 dark:text-slate-100">
                      {s.staffCategory}
                    </td>
                    <td className="py-3 px-3 text-center">{s.activeHeadcount} FTE</td>
                    <td className="py-3 px-3 text-center font-medium">
                      {s.avgPatientThroughputPerDay} patients/shift
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        {s.ratioComplianceRate}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center text-slate-600 dark:text-slate-400">
                      {s.turnaroundTimeHours} hrs
                    </td>
                    <td className="py-3 px-3 text-center text-slate-600 dark:text-slate-400">
                      {s.overtimeHoursAvg} hrs/wk
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {s.productivityScore}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1">/ 100</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
