'use client';

import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Clock,
  Building2,
  Filter,
  BarChart3,
  Calendar,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  FileSpreadsheet,
  Info,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

export interface ClinicalUnitVariance {
  unitId: string;
  unitName: string;
  departmentCode: string;
  leadPhysician: string;
  budgetAllocated: number;
  actualOvertimeSpend: number;
  varianceAmount: number;
  variancePercentage: number;
  consecutiveCyclesOverBudget: number;
  recurringStatus: 'CRITICAL' | 'ELEVATED' | 'WATCH' | 'ON_BUDGET';
  rootCauseCategory: string;
  primaryDrivers: string[];
  historicalCycles: {
    cycleName: string;
    budget: number;
    actual: number;
    variancePct: number;
  }[];
  mitigationRecommendation: string;
}

const CLINICAL_UNITS_DATA: ClinicalUnitVariance[] = [
  {
    unitId: 'unit_er_trauma',
    unitName: 'Emergency & Trauma Center',
    departmentCode: 'ER-TRAUMA',
    leadPhysician: 'Dr. Michael Chang, MD',
    budgetAllocated: 14500,
    actualOvertimeSpend: 19850,
    varianceAmount: 5350,
    variancePercentage: 36.9,
    consecutiveCyclesOverBudget: 4,
    recurringStatus: 'CRITICAL',
    rootCauseCategory: 'Level 1 Trauma Surges & Minimum Triage Staffing Ratios',
    primaryDrivers: [
      'Unplanned mass-casualty and cardiac arrest resuscitations after 20:00',
      'Mandated 1:1 resuscitation nursing coverage during severe bed boarding',
      'Weekend overnight shift differential + 1.5x FLSA overtime multiplier',
    ],
    historicalCycles: [
      { cycleName: 'Cycle 1 (Jan-A)', budget: 14000, actual: 16800, variancePct: 20.0 },
      { cycleName: 'Cycle 2 (Jan-B)', budget: 14000, actual: 17500, variancePct: 25.0 },
      { cycleName: 'Cycle 3 (Feb-A)', budget: 14500, actual: 18900, variancePct: 30.3 },
      { cycleName: 'Cycle 4 (Feb-B)', budget: 14500, actual: 19200, variancePct: 32.4 },
      { cycleName: 'Cycle 5 (Mar-A)', budget: 14500, actual: 19600, variancePct: 35.2 },
      { cycleName: 'Cycle 6 (Current)', budget: 14500, actual: 19850, variancePct: 36.9 },
    ],
    mitigationRecommendation:
      'Authorize dedicated PRN float pool trauma nurses for 19:00–03:00 surge windows to avoid 1.5x FLSA overtime tiering on core nursing staff.',
  },
  {
    unitId: 'unit_surgery_ot',
    unitName: 'Surgical Theaters & Perioperative',
    departmentCode: 'OT-SURG',
    leadPhysician: 'Dr. Elena Rostova, MD',
    budgetAllocated: 12000,
    actualOvertimeSpend: 15480,
    varianceAmount: 3480,
    variancePercentage: 29.0,
    consecutiveCyclesOverBudget: 3,
    recurringStatus: 'CRITICAL',
    rootCauseCategory: 'Emergency Add-On Procedures & Case Turnover Delays',
    primaryDrivers: [
      'Emergency exploratory laparotomies and neurotrauma cases extended past 17:00',
      'Certified Registered Nurse Anesthetist (CRNA) & scrub tech on-call callbacks',
      'PACU post-anesthesia recovery delays due to ICU inpatient bed hold times',
    ],
    historicalCycles: [
      { cycleName: 'Cycle 1 (Jan-A)', budget: 11500, actual: 11200, variancePct: -2.6 },
      { cycleName: 'Cycle 2 (Jan-B)', budget: 11500, actual: 12100, variancePct: 5.2 },
      { cycleName: 'Cycle 3 (Feb-A)', budget: 12000, actual: 12400, variancePct: 3.3 },
      { cycleName: 'Cycle 4 (Feb-B)', budget: 12000, actual: 14600, variancePct: 21.7 },
      { cycleName: 'Cycle 5 (Mar-A)', budget: 12000, actual: 15100, variancePct: 25.8 },
      { cycleName: 'Cycle 6 (Current)', budget: 12000, actual: 15480, variancePct: 29.0 },
    ],
    mitigationRecommendation:
      'Stagger OR block schedules: implement dedicated second-shift on-call team (14:00–22:00) rather than extending day-shift surgical teams into overtime.',
  },
  {
    unitId: 'unit_icu_critical',
    unitName: 'Critical Care ICU & Step-Down',
    departmentCode: 'ICU-CRIT',
    leadPhysician: 'Dr. Marcus Vance, MD',
    budgetAllocated: 9500,
    actualOvertimeSpend: 11620,
    varianceAmount: 2120,
    variancePercentage: 22.3,
    consecutiveCyclesOverBudget: 2,
    recurringStatus: 'ELEVATED',
    rootCauseCategory: '1:1 ECMO / CRRT Specialized Nursing Acuity',
    primaryDrivers: [
      'Two long-stay ECMO patients requiring mandatory 1:1 dedicated credentialed nurse coverage',
      'Sudden clinical leave of 2 senior critical care RNs requiring voluntary overtime pickups',
    ],
    historicalCycles: [
      { cycleName: 'Cycle 1 (Jan-A)', budget: 9000, actual: 8900, variancePct: -1.1 },
      { cycleName: 'Cycle 2 (Jan-B)', budget: 9000, actual: 9200, variancePct: 2.2 },
      { cycleName: 'Cycle 3 (Feb-A)', budget: 9500, actual: 9400, variancePct: -1.0 },
      { cycleName: 'Cycle 4 (Feb-B)', budget: 9500, actual: 9700, variancePct: 2.1 },
      { cycleName: 'Cycle 5 (Mar-A)', budget: 9500, actual: 11100, variancePct: 16.8 },
      { cycleName: 'Cycle 6 (Current)', budget: 9500, actual: 11620, variancePct: 22.3 },
    ],
    mitigationRecommendation:
      'Fast-track cross-training of Step-Down telemetry RNs in CRRT/ECMO monitoring to build an internal float buffer before peak respiratory season.',
  },
  {
    unitId: 'unit_cardiology_cath',
    unitName: 'Cardiology & Catheterization Lab',
    departmentCode: 'CARD-01',
    leadPhysician: 'Dr. Sarah Jenkins, MD',
    budgetAllocated: 7500,
    actualOvertimeSpend: 7820,
    varianceAmount: 320,
    variancePercentage: 4.3,
    consecutiveCyclesOverBudget: 1,
    recurringStatus: 'WATCH',
    rootCauseCategory: 'STEMI Code On-Call Activations',
    primaryDrivers: [
      'Two weekend emergency angioplasty activations within 30-minute door-to-balloon protocol',
      'Routine diagnostic catheterization cases finished within normal operating parameters',
    ],
    historicalCycles: [
      { cycleName: 'Cycle 1 (Jan-A)', budget: 7000, actual: 6800, variancePct: -2.8 },
      { cycleName: 'Cycle 2 (Jan-B)', budget: 7000, actual: 7200, variancePct: 2.8 },
      { cycleName: 'Cycle 3 (Feb-A)', budget: 7500, actual: 7100, variancePct: -5.3 },
      { cycleName: 'Cycle 4 (Feb-B)', budget: 7500, actual: 7450, variancePct: -0.7 },
      { cycleName: 'Cycle 5 (Mar-A)', budget: 7500, actual: 7300, variancePct: -2.7 },
      { cycleName: 'Cycle 6 (Current)', budget: 7500, actual: 7820, variancePct: 4.3 },
    ],
    mitigationRecommendation:
      'Maintain current on-call rotation. Overtime spend is within acceptable clinical margin of error (+4.3%) and driven purely by emergent acute coronary syndromes.',
  },
  {
    unitId: 'unit_pathology_lab',
    unitName: 'Pathology & Diagnostic Laboratory',
    departmentCode: 'LAB-PATH',
    leadPhysician: 'Dr. Alan Bradley, PhD',
    budgetAllocated: 5000,
    actualOvertimeSpend: 4650,
    varianceAmount: -350,
    variancePercentage: -7.0,
    consecutiveCyclesOverBudget: 0,
    recurringStatus: 'ON_BUDGET',
    rootCauseCategory: 'Automated High-Throughput Chemistry Analyzer Stability',
    primaryDrivers: [
      'Batch testing schedules maintained within standard 8-hour shift windows',
      'No major instrument breakdowns or manual stat reflex testing overages',
    ],
    historicalCycles: [
      { cycleName: 'Cycle 1 (Jan-A)', budget: 5000, actual: 4800, variancePct: -4.0 },
      { cycleName: 'Cycle 2 (Jan-B)', budget: 5000, actual: 4950, variancePct: -1.0 },
      { cycleName: 'Cycle 3 (Feb-A)', budget: 5000, actual: 4700, variancePct: -6.0 },
      { cycleName: 'Cycle 4 (Feb-B)', budget: 5000, actual: 4900, variancePct: -2.0 },
      { cycleName: 'Cycle 5 (Mar-A)', budget: 5000, actual: 4850, variancePct: -3.0 },
      { cycleName: 'Cycle 6 (Current)', budget: 5000, actual: 4650, variancePct: -7.0 },
    ],
    mitigationRecommendation:
      'Unit demonstrates ideal labor cost discipline. Preserve current shift handoff protocols.',
  },
];

// Multi-cycle hospital-wide overtime aggregate trend
const OVERTIME_TREND_CHART_DATA = [
  {
    period: 'Jan Cycle A',
    totalBudget: 46500,
    actualOT: 46500,
    erVariance: 2800,
    surgeryVariance: -300,
    icuVariance: -100,
    variancePct: 0.0,
  },
  {
    period: 'Jan Cycle B',
    totalBudget: 46500,
    actualOT: 50950,
    erVariance: 3500,
    surgeryVariance: 600,
    icuVariance: 200,
    variancePct: 9.6,
  },
  {
    period: 'Feb Cycle A',
    totalBudget: 48500,
    actualOT: 52500,
    erVariance: 4400,
    surgeryVariance: 400,
    icuVariance: -100,
    variancePct: 8.2,
  },
  {
    period: 'Feb Cycle B',
    totalBudget: 48500,
    actualOT: 55850,
    erVariance: 4700,
    surgeryVariance: 2600,
    icuVariance: 200,
    variancePct: 15.2,
  },
  {
    period: 'Mar Cycle A',
    totalBudget: 48500,
    actualOT: 57950,
    erVariance: 5100,
    surgeryVariance: 3100,
    icuVariance: 1600,
    variancePct: 19.5,
  },
  {
    period: 'Mar Cycle B (Latest)',
    totalBudget: 48500,
    actualOT: 59420,
    erVariance: 5350,
    surgeryVariance: 3480,
    icuVariance: 2120,
    variancePct: 22.5,
  },
];

interface Props {
  onNotifyLead?: (message: string) => void;
  className?: string;
}

export function OvertimeBudgetVarianceChart({ onNotifyLead, className = '' }: Props) {
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [activeMetricView, setActiveMetricView] = useState<'trends' | 'units' | 'root_cause'>('trends');

  // Selected Unit Data
  const selectedUnit = useMemo(() => {
    return CLINICAL_UNITS_DATA.find((u) => u.unitId === selectedUnitId) || null;
  }, [selectedUnitId]);

  // Aggregate Metrics
  const summaryStats = useMemo(() => {
    let totalBudget = 0;
    let totalActual = 0;
    let unitsOverBudget = 0;
    let recurringCriticalUnits = 0;

    CLINICAL_UNITS_DATA.forEach((u) => {
      totalBudget += u.budgetAllocated;
      totalActual += u.actualOvertimeSpend;
      if (u.varianceAmount > 0) unitsOverBudget++;
      if (u.consecutiveCyclesOverBudget >= 3) recurringCriticalUnits++;
    });

    const netVariance = totalActual - totalBudget;
    const netVariancePct = totalBudget > 0 ? (netVariance / totalBudget) * 100 : 0;

    return {
      totalBudget,
      totalActual,
      netVariance,
      netVariancePct: Math.round(netVariancePct * 10) / 10,
      unitsOverBudget,
      recurringCriticalUnits,
      totalUnits: CLINICAL_UNITS_DATA.length,
    };
  }, []);

  // Filtered Chart Data based on selected unit
  const chartData = useMemo(() => {
    if (selectedUnitId === 'all') {
      return OVERTIME_TREND_CHART_DATA;
    }
    const unit = CLINICAL_UNITS_DATA.find((u) => u.unitId === selectedUnitId);
    if (!unit) return OVERTIME_TREND_CHART_DATA;

    return unit.historicalCycles.map((c) => ({
      period: c.cycleName.replace('Cycle ', 'C'),
      totalBudget: c.budget,
      actualOT: c.actual,
      varianceAmount: c.actual - c.budget,
      variancePct: c.variancePct,
    }));
  }, [selectedUnitId]);

  return (
    <div
      id="overtime-variance-container"
      className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden ${className}`}
    >
      {/* Top Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-slate-50 via-white to-amber-50/20 dark:from-slate-900 dark:to-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Clinical Overtime Trends & Budget Variance Engine
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                FLSA & Acuity Monitor
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Identifies hospital clinical units exhibiting recurring multi-cycle overtime variances and labor budget drift.
            </p>
          </div>
        </div>

        {/* View Switches */}
        <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 self-start md:self-auto">
          <button
            id="btn-ot-view-trends"
            onClick={() => setActiveMetricView('trends')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeMetricView === 'trends'
                ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Trends Chart</span>
          </button>
          <button
            id="btn-ot-view-units"
            onClick={() => setActiveMetricView('units')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeMetricView === 'units'
                ? 'bg-white dark:bg-slate-900 text-amber-600 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Unit Variances ({CLINICAL_UNITS_DATA.length})</span>
          </button>
          <button
            id="btn-ot-view-drivers"
            onClick={() => setActiveMetricView('root_cause')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeMetricView === 'root_cause'
                ? 'bg-white dark:bg-slate-900 text-rose-600 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Root Causes</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Strip - Responsive across tablet and desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Total Overtime Spend</span>
            <DollarSign className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-black font-mono text-slate-900 dark:text-slate-100">
            ${summaryStats.totalActual.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
            <span>Budget:</span>
            <span className="font-mono font-medium">${summaryStats.totalBudget.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Net Budget Variance</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-black font-mono text-rose-600 dark:text-rose-400">
            +${summaryStats.netVariance.toLocaleString()}
          </div>
          <div className="text-[10px] text-rose-600 font-bold mt-0.5">
            +{summaryStats.netVariancePct}% over authorized cap
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/30 dark:bg-rose-950/20 shadow-2xs">
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 mb-1">
            <span className="text-[11px] font-semibold">Recurring Critical Units</span>
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-black font-mono text-rose-700 dark:text-rose-300">
            {summaryStats.recurringCriticalUnits} Units
          </div>
          <div className="text-[10px] text-rose-600 font-medium mt-0.5">
            ≥ 3 consecutive cycles over budget
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Units Exceeding Threshold</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-black font-mono text-amber-600 dark:text-amber-400">
            {summaryStats.unitsOverBudget} of {summaryStats.totalUnits} Units
          </div>
          <div className="text-[10px] text-slate-500 font-medium mt-0.5">
            ER (+36.9%) & Surgery (+29.0%)
          </div>
        </div>
      </div>

      {/* Interactive Clinical Unit Filter Bar */}
      <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" /> Filter Unit:
        </span>
        <button
          onClick={() => setSelectedUnitId('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer min-h-[36px] ${
            selectedUnitId === 'all'
              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
          }`}
        >
          All Hospital Units
        </button>
        {CLINICAL_UNITS_DATA.map((unit) => {
          const isSelected = selectedUnitId === unit.unitId;
          const isCritical = unit.consecutiveCyclesOverBudget >= 3;
          return (
            <button
              key={unit.unitId}
              onClick={() => setSelectedUnitId(unit.unitId)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer min-h-[36px] ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <span>{unit.unitName}</span>
              {isCritical && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="p-4 sm:p-6">
        {/* VIEW 1: RECHARTS TREND VISUALIZATION */}
        {activeMetricView === 'trends' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>
                    {selectedUnitId === 'all'
                      ? 'Hospital-Wide Overtime Spend vs. Allocated Budget Baseline'
                      : `${selectedUnit?.unitName} — Multi-Cycle Overtime Trajectory`}
                  </span>
                  {selectedUnit && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold uppercase ${
                        selectedUnit.recurringStatus === 'CRITICAL'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          : selectedUnit.recurringStatus === 'ELEVATED'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {selectedUnit.recurringStatus} (Cycle Streak: {selectedUnit.consecutiveCyclesOverBudget})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Visualized over 6 rolling bi-weekly pay cycles (Jan 2026 – Mar 2026). Dashed line indicates approved labor budget ceiling.
                </p>
              </div>

              {selectedUnit && (
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Lead: <strong className="text-slate-800 dark:text-slate-200">{selectedUnit.leadPhysician}</strong>
                </div>
              )}
            </div>

            {/* Recharts Container - Optimized for responsiveness & touch */}
            <div className="h-72 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const actual = payload.find((p) => p.dataKey === 'actualOT')?.value as number;
                        const budget = payload.find((p) => p.dataKey === 'totalBudget')?.value as number;
                        const variance = actual - budget;
                        const variancePct = budget > 0 ? ((variance / budget) * 100).toFixed(1) : '0';

                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs space-y-1.5 min-w-[200px]">
                            <div className="font-bold text-slate-200 border-b border-slate-700 pb-1">
                              {label}
                            </div>
                            <div className="flex justify-between items-center text-amber-400">
                              <span>Actual OT Spend:</span>
                              <span className="font-mono font-bold">${actual?.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-slate-300">
                              <span>Budget Cap:</span>
                              <span className="font-mono font-bold">${budget?.toLocaleString()}</span>
                            </div>
                            <div
                              className={`flex justify-between items-center font-bold pt-1 border-t border-slate-800 ${
                                variance > 0 ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              <span>Variance:</span>
                              <span className="font-mono">
                                {variance > 0 ? `+$${variance.toLocaleString()}` : `-$${Math.abs(variance).toLocaleString()}`}{' '}
                                ({variance > 0 ? `+${variancePct}%` : `${variancePct}%`})
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    wrapperStyle={{ fontSize: '11px', fontWeight: 600 }}
                  />
                  <Bar
                    dataKey="actualOT"
                    name="Actual Overtime Spend ($)"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={45}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalBudget"
                    name="Approved Budget Ceiling ($)"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    dot={{ r: 4, fill: '#ef4444' }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Tactical Recurring Variance Callout Box */}
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                    Recurring Overtime Variance Insight for Medical Leads
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    <strong>Emergency (4 cycles)</strong> and <strong>Surgery (3 cycles)</strong> are operating in a chronic overtime pattern. Average hospital overtime premium adds <strong>$10,950/cycle</strong> in avoidable 1.5x FLSA multiplier costs.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                <button
                  id="btn-trigger-float-pool"
                  onClick={() => {
                    if (onNotifyLead) {
                      onNotifyLead(
                        'Triggered Float Pool Dispatch: 4 PRN Critical Care/Trauma RNs allocated to Emergency Department for upcoming weekend night shifts.'
                      );
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer min-h-[40px]"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Dispatch Float Pool</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: CLINICAL UNITS OVERTIME VARIANCE SCORECARD */}
        {activeMetricView === 'units' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Clinical Units Overtime Budget Variance Scorecard
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Clinical department leads review recurring overages to adjust clinical staffing rosters before next payroll close.
                </p>
              </div>
            </div>

            {/* Responsive Table for Desktop & Large Tablet */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Clinical Unit</th>
                    <th className="py-3 px-4">Lead Physician</th>
                    <th className="py-3 px-4 text-right">Budget</th>
                    <th className="py-3 px-4 text-right">Actual OT Spend</th>
                    <th className="py-3 px-4 text-right">Variance ($ / %)</th>
                    <th className="py-3 px-4 text-center">Consecutive Cycles</th>
                    <th className="py-3 px-4 text-center">Risk Status</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {CLINICAL_UNITS_DATA.map((unit) => {
                    const isCritical = unit.recurringStatus === 'CRITICAL';
                    const isElevated = unit.recurringStatus === 'ELEVATED';

                    return (
                      <tr
                        key={unit.unitId}
                        onClick={() => setSelectedUnitId(unit.unitId)}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                          selectedUnitId === unit.unitId ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-2">
                            <span>{unit.unitName}</span>
                            <span className="text-[10px] font-mono text-slate-400">({unit.departmentCode})</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                          {unit.leadPhysician}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                          ${unit.budgetAllocated.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                          ${unit.actualOvertimeSpend.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          <span
                            className={`font-bold ${
                              unit.varianceAmount > 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {unit.varianceAmount > 0 ? `+$${unit.varianceAmount.toLocaleString()}` : `-$${Math.abs(unit.varianceAmount).toLocaleString()}`}{' '}
                            ({unit.variancePercentage > 0 ? `+${unit.variancePercentage}%` : `${unit.variancePercentage}%`})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`inline-flex items-center justify-center font-mono font-bold px-2 py-0.5 rounded-full text-xs ${
                              unit.consecutiveCyclesOverBudget >= 3
                                ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                                : unit.consecutiveCyclesOverBudget > 0
                                ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                            {unit.consecutiveCyclesOverBudget} Cycles
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                              isCritical
                                ? 'bg-rose-600 text-white'
                                : isElevated
                                ? 'bg-amber-500 text-white'
                                : unit.recurringStatus === 'WATCH'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            }`}
                          >
                            {unit.recurringStatus}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedUnitId(unit.unitId);
                              setActiveMetricView('trends');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                          >
                            View Trajectory
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

        {/* VIEW 3: CLINICAL ROOT CAUSES & DEPARTMENT LEAD RECOMMENDATIONS */}
        {activeMetricView === 'root_cause' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Clinical Drivers & Recurring Overtime Variance Analysis
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Detailed operational root causes and policy recommendations for Chief Medical Officers and Department Chairs.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CLINICAL_UNITS_DATA.filter((u) => u.varianceAmount > 0).map((unit) => (
                <div
                  key={unit.unitId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/90 shadow-2xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-700 pb-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {unit.unitName}
                        </h4>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            unit.recurringStatus === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {unit.consecutiveCyclesOverBudget} Cycles Exceeded
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">Lead: {unit.leadPhysician}</span>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-bold text-rose-600 dark:text-rose-400 text-sm">
                        +${unit.varianceAmount.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">+{unit.variancePercentage}% Drift</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                      Clinical Operational Drivers
                    </span>
                    <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                      {unit.primaryDrivers.map((driver, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-500 font-bold">•</span>
                          <span>{driver}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-2.5 rounded-lg bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50">
                    <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider block mb-0.5">
                      Recommended Lead Action
                    </span>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {unit.mitigationRecommendation}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
