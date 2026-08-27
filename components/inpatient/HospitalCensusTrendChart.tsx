'use client';

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Calendar,
  Users,
  LogOut,
  UserPlus,
  Zap,
} from 'lucide-react';

interface HospitalCensusTrendChartProps {
  tenantId?: string;
  totalCapacity?: number;
  currentOccupied?: number;
}

interface DailyCensusDataPoint {
  day: string;
  date: string;
  admissions: number;
  discharges: number;
  netDelta: number;
  totalCensus: number;
  occupancyRate: number;
  transfers: number;
}

export const HospitalCensusTrendChart: React.FC<HospitalCensusTrendChartProps> = ({
  tenantId = 'metro-health',
  totalCapacity = 140,
  currentOccupied = 112,
}) => {
  const [metricView, setMetricView] = useState<'velocity' | 'cumulative' | 'net'>('velocity');

  // Generate 7-day intake/discharge velocity data anchored to current local time and realistic variance
  const data: DailyCensusDataPoint[] = useMemo(() => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();
    const result: DailyCensusDataPoint[] = [];

    // Seeded realistic daily admissions and discharges for 7 days
    const historicalSeeds = [
      { dayOffset: 6, admits: 14, discharges: 11, transfers: 4 },
      { dayOffset: 5, admits: 18, discharges: 15, transfers: 6 },
      { dayOffset: 4, admits: 22, discharges: 19, transfers: 8 },
      { dayOffset: 3, admits: 25, discharges: 21, transfers: 7 },
      { dayOffset: 2, admits: 20, discharges: 24, transfers: 5 },
      { dayOffset: 1, admits: 17, discharges: 16, transfers: 9 },
      { dayOffset: 0, admits: 21, discharges: 18, transfers: 6 }, // Today
    ];

    // Compute dynamic running census backwards from currentOccupied
    let runningCensus = currentOccupied;
    const computedReversed: DailyCensusDataPoint[] = [];

    for (let i = historicalSeeds.length - 1; i >= 0; i--) {
      const item = historicalSeeds[i];
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - item.dayOffset);

      const dayLabel = item.dayOffset === 0 ? 'Today' : `${dayNames[targetDate.getDay()]} ${targetDate.getDate()}`;
      const fullDateStr = targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const net = item.admits - item.discharges;

      computedReversed.unshift({
        day: dayLabel,
        date: fullDateStr,
        admissions: item.admits,
        discharges: item.discharges,
        netDelta: net,
        totalCensus: runningCensus,
        occupancyRate: Math.min(100, Math.round((runningCensus / Math.max(1, totalCapacity)) * 100)),
        transfers: item.transfers,
      });

      // Step back for previous day
      runningCensus = Math.max(80, runningCensus - net);
    }

    return computedReversed;
  }, [totalCapacity, currentOccupied]);

  // Aggregate 7-day velocity metrics
  const totalAdmissions7d = useMemo(() => data.reduce((acc, d) => acc + d.admissions, 0), [data]);
  const totalDischarges7d = useMemo(() => data.reduce((acc, d) => acc + d.discharges, 0), [data]);
  const netVelocity7d = totalAdmissions7d - totalDischarges7d;
  const avgAdmissionsPerDay = Math.round((totalAdmissions7d / data.length) * 10) / 10;
  const avgDischargesPerDay = Math.round((totalDischarges7d / data.length) * 10) / 10;
  const peakIntakeDay = useMemo(() => {
    return [...data].sort((a, b) => b.admissions - a.admissions)[0];
  }, [data]);

  return (
    <div
      id="hospital-census-trend-card"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 transition-all"
    >
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Activity className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Hospital-Wide Census & Intake Velocity
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              7-Day Rolling Trend
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Real-time patient intake versus discharge turnaround velocity across all wards.
          </p>
        </div>

        {/* View Toggle Tabs */}
        <div className="flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => setMetricView('velocity')}
            className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
              metricView === 'velocity'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Intake vs Discharge
          </button>
          <button
            type="button"
            onClick={() => setMetricView('cumulative')}
            className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
              metricView === 'cumulative'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Total Census
          </button>
          <button
            type="button"
            onClick={() => setMetricView('net')}
            className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
              metricView === 'net'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Net Bed Delta
          </button>
        </div>
      </div>

      {/* 4 Crisp Summary Velocity Metrics */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Admissions (Intake) */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between text-xs font-semibold text-blue-800 dark:text-blue-300">
            <span className="flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5 text-blue-600" />
              Total Admissions
            </span>
            <span className="text-[10px] text-blue-600">7 Days</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-blue-950 dark:text-blue-200">+{totalAdmissions7d}</span>
            <span className="text-[11px] font-medium text-slate-500">~{avgAdmissionsPerDay}/day</span>
          </div>
        </div>

        {/* Total Discharges */}
        <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-800 dark:text-amber-300">
            <span className="flex items-center gap-1">
              <LogOut className="h-3.5 w-3.5 text-amber-600" />
              Total Discharges
            </span>
            <span className="text-[10px] text-amber-600">7 Days</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-amber-950 dark:text-amber-200">-{totalDischarges7d}</span>
            <span className="text-[11px] font-medium text-slate-500">~{avgDischargesPerDay}/day</span>
          </div>
        </div>

        {/* Net Bed Velocity Delta */}
        <div
          className={`rounded-xl border p-3 ${
            netVelocity7d >= 0
              ? 'border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/50 dark:bg-indigo-950/20'
              : 'border-emerald-100 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-indigo-600" />
              Net Bed Velocity
            </span>
            <span className="text-[10px] text-slate-400">Delta</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-slate-900 dark:text-white">
              {netVelocity7d >= 0 ? `+${netVelocity7d}` : netVelocity7d}
            </span>
            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center">
              {netVelocity7d >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {netVelocity7d >= 0 ? 'Intake Pressure' : 'Outflow Clearance'}
            </span>
          </div>
        </div>

        {/* Peak Intake Day */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-850">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-purple-600" />
              Peak Intake Day
            </span>
            <span className="text-[10px] text-purple-600 font-bold">{peakIntakeDay?.day}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-slate-900 dark:text-white">
              {peakIntakeDay?.admissions} <span className="text-xs font-normal text-slate-500">admits</span>
            </span>
            <span className="text-[11px] font-medium text-slate-500">{peakIntakeDay?.date}</span>
          </div>
        </div>
      </div>

      {/* Main Recharts Visualizer */}
      <div className="mt-5 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {metricView === 'velocity' ? (
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="admissionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="dischargeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload as DailyCensusDataPoint;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-xs text-xs font-sans dark:border-slate-800 dark:bg-slate-900/95 dark:text-white">
                        <div className="font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-1 dark:border-slate-800 flex justify-between gap-4">
                          <span>{label} ({item.date})</span>
                          <span className="font-mono text-blue-600 dark:text-blue-400">Census: {item.totalCensus}</span>
                        </div>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-4 text-blue-600 font-semibold">
                            <span>• Admissions (Intake):</span>
                            <span className="font-mono">+{item.admissions}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-amber-600 font-semibold">
                            <span>• Discharges:</span>
                            <span className="font-mono">-{item.discharges}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300">
                            <span>• Internal Transfers:</span>
                            <span className="font-mono">{item.transfers}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 font-bold border-t border-slate-100 pt-1 dark:border-slate-800">
                            <span>Net Velocity Delta:</span>
                            <span className={item.netDelta >= 0 ? 'text-blue-600 font-mono' : 'text-emerald-600 font-mono'}>
                              {item.netDelta >= 0 ? `+${item.netDelta}` : item.netDelta}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ paddingBottom: 10, fontSize: 11 }}
              />
              <Area
                type="monotone"
                dataKey="admissions"
                name="Admissions (Intake)"
                stroke="#2563eb"
                strokeWidth={2.5}
                fill="url(#admissionGradient)"
                dot={{ r: 3, fill: '#2563eb' }}
                activeDot={{ r: 5 }}
              />
              <Area
                type="monotone"
                dataKey="discharges"
                name="Discharges"
                stroke="#d97706"
                strokeWidth={2.5}
                fill="url(#dischargeGradient)"
                dot={{ r: 3, fill: '#d97706' }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          ) : metricView === 'cumulative' ? (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="censusGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload as DailyCensusDataPoint;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs dark:border-slate-800 dark:bg-slate-900">
                        <div className="font-bold text-slate-900 dark:text-white">{label} ({item.date})</div>
                        <div className="mt-1 text-purple-700 dark:text-purple-300 font-bold">
                          Active Inpatient Census: {item.totalCensus} / {totalCapacity} beds ({item.occupancyRate}%)
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="totalCensus"
                name="Hospital Total Census"
                stroke="#7c3aed"
                strokeWidth={3}
                fill="url(#censusGradient)"
                dot={{ r: 4, fill: '#7c3aed' }}
              />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload as DailyCensusDataPoint;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs dark:border-slate-800 dark:bg-slate-900">
                        <div className="font-bold text-slate-900 dark:text-white">{label} ({item.date})</div>
                        <div className="mt-1 font-semibold">
                          Net Patient Flow: <strong className={item.netDelta >= 0 ? 'text-blue-600' : 'text-emerald-600'}>
                            {item.netDelta >= 0 ? `+${item.netDelta}` : item.netDelta} patients
                          </strong>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="netDelta"
                name="Net Flow (Admits - Discharges)"
                stroke="#059669"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#059669' }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
