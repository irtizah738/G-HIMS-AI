'use client';

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import {
  Clock,
  AlertTriangle,
  Moon,
  Sun,
  ShieldAlert,
  Info,
  Filter,
  Activity,
  Layers,
} from 'lucide-react';
import { AuditLogEntry, getLogSeverity, AuditSeverity } from '@/lib/audit/logger';

interface AuditTimeOfDayScatterPlotProps {
  logs: AuditLogEntry[];
  onSelectLog?: (log: AuditLogEntry) => void;
}

interface ScatterDataPoint {
  id: string;
  hourDecimal: number; // 0.00 to 24.00
  timeString: string;
  dateString: string;
  severityLevel: number; // 3: Critical, 2: Warning, 1: Info
  severityName: AuditSeverity;
  action: string;
  actor: string;
  role: string;
  resource: string;
  details: string;
  ipAddress: string;
  isOffHours: boolean;
  rawLog: AuditLogEntry;
}

const SEVERITY_COLORS: Record<AuditSeverity, string> = {
  CRITICAL: '#EF4444', // Red-500
  WARNING: '#F59E0B',  // Amber-500
  INFO: '#3B82F6',     // Blue-500
};

const SEVERITY_LABELS: Record<number, string> = {
  1: 'Info',
  2: 'Warning',
  3: 'Critical',
};

export default function AuditTimeOfDayScatterPlot({
  logs,
  onSelectLog,
}: AuditTimeOfDayScatterPlotProps) {
  const [filterMode, setFilterMode] = useState<'ALL' | 'OFF_HOURS_ONLY' | 'CRITICAL_ONLY'>('ALL');

  // Convert raw audit logs into scatter data points with precise decimal hours
  const scatterPoints = useMemo<ScatterDataPoint[]>(() => {
    return logs.map((log) => {
      const date = new Date(log.timestamp);
      const hours = isNaN(date.getTime()) ? 12 : date.getHours();
      const minutes = isNaN(date.getTime()) ? 0 : date.getMinutes();
      const seconds = isNaN(date.getTime()) ? 0 : date.getSeconds();

      const hourDecimal = parseFloat((hours + minutes / 60 + seconds / 3600).toFixed(2));
      const isOffHours = hours < 7 || hours >= 19; // 7:00 PM to 7:00 AM

      const severity = getLogSeverity(log);
      let severityLevel = 1;
      if (severity === 'CRITICAL') severityLevel = 3;
      else if (severity === 'WARNING') severityLevel = 2;

      const timeString = isNaN(date.getTime())
        ? '12:00:00'
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const dateString = isNaN(date.getTime())
        ? 'N/A'
        : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

      return {
        id: log.id,
        hourDecimal,
        timeString,
        dateString,
        severityLevel,
        severityName: severity,
        action: log.action,
        actor: log.userName || 'System',
        role: log.userRole || 'Staff',
        resource: log.resource,
        details: log.details,
        ipAddress: log.ipAddress || '127.0.0.1',
        isOffHours,
        rawLog: log,
      };
    });
  }, [logs]);

  // Filtered scatter points
  const visiblePoints = useMemo(() => {
    if (filterMode === 'OFF_HOURS_ONLY') {
      return scatterPoints.filter((p) => p.isOffHours);
    }
    if (filterMode === 'CRITICAL_ONLY') {
      return scatterPoints.filter((p) => p.severityName === 'CRITICAL');
    }
    return scatterPoints;
  }, [scatterPoints, filterMode]);

  // Summary Metrics
  const offHoursEvents = useMemo(() => scatterPoints.filter((p) => p.isOffHours), [scatterPoints]);
  const offHoursCritical = useMemo(
    () => offHoursEvents.filter((p) => p.severityName === 'CRITICAL'),
    [offHoursEvents]
  );
  const offHoursPercentage =
    scatterPoints.length > 0
      ? ((offHoursEvents.length / scatterPoints.length) * 100).toFixed(1)
      : '0.0';

  // Format 24-hour ticks
  const formatHourTick = (hour: number) => {
    const h = Math.floor(hour);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}${period}`;
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                24-Hour Time-of-Day Audit Event Frequency
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                Off-Hours Anomaly Scanner
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Scatter distribution mapping event timestamps across the 24-hour diurnal cycle to flag
              abnormal late-night access and sensitive resource operations
            </p>
          </div>
        </div>

        {/* Filters & Toggles */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              filterMode === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All 24 Hours ({scatterPoints.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('OFF_HOURS_ONLY')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'OFF_HOURS_ONLY'
                ? 'bg-indigo-600 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Off-Hours (19:00 - 07:00)</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-indigo-700/80 text-white">
              {offHoursEvents.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('CRITICAL_ONLY')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'CRITICAL_ONLY'
                ? 'bg-rose-600 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Critical Only</span>
          </button>
        </div>
      </div>

      {/* Off-Hours Alert Banner if Anomalies Exist */}
      {offHoursCritical.length > 0 && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-950">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold shrink-0 animate-pulse">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-rose-900">
                {offHoursCritical.length} Critical Off-Hours Incident
                {offHoursCritical.length > 1 ? 's' : ''} Flagged
              </span>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Sensitive actions (such as DELETE on patient PHI or medication records) occurred
                between 19:00 and 07:00. Compliance review recommended.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFilterMode('OFF_HOURS_ONLY')}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] shrink-0 cursor-pointer shadow-2xs transition-colors"
          >
            Isolate Off-Hours Events
          </button>
        </div>
      )}

      {/* Main Scatter Chart Container */}
      <div className="h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            margin={{
              top: 20,
              right: 30,
              bottom: 25,
              left: 20,
            }}
          >
            {/* Shaded Reference Areas for Off-Hours (00:00 - 07:00 and 19:00 - 24:00) */}
            <ReferenceArea
              x1={0}
              x2={7}
              y1={0.5}
              y2={3.5}
              fill="#F1F5F9"
              fillOpacity={0.7}
              stroke="#E2E8F0"
              strokeDasharray="3 3"
              label={{
                value: '🌙 Off-Hours (Night: 00:00 - 07:00)',
                position: 'insideTopLeft',
                fill: '#64748B',
                fontSize: 10,
                fontWeight: 700,
              }}
            />
            <ReferenceArea
              x1={7}
              x2={19}
              y1={0.5}
              y2={3.5}
              fill="#F8FAFC"
              fillOpacity={0.2}
              stroke="#CBD5E1"
              strokeDasharray="2 2"
              label={{
                value: '☀️ Standard Clinical Operations (07:00 - 19:00)',
                position: 'insideTop',
                fill: '#0284C7',
                fontSize: 10,
                fontWeight: 700,
              }}
            />
            <ReferenceArea
              x1={19}
              x2={24}
              y1={0.5}
              y2={3.5}
              fill="#F1F5F9"
              fillOpacity={0.7}
              stroke="#E2E8F0"
              strokeDasharray="3 3"
              label={{
                value: '🌙 Off-Hours (Evening: 19:00 - 24:00)',
                position: 'insideTopRight',
                fill: '#64748B',
                fontSize: 10,
                fontWeight: 700,
              }}
            />

            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={true} />

            <XAxis
              type="number"
              dataKey="hourDecimal"
              name="Time of Day"
              domain={[0, 24]}
              ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
              tickFormatter={formatHourTick}
              stroke="#64748B"
              fontSize={11}
              fontWeight={600}
              label={{
                value: 'Time of Day (24-Hour Clock)',
                position: 'insideBottom',
                offset: -12,
                fill: '#475569',
                fontSize: 11,
                fontWeight: 700,
              }}
            />

            <YAxis
              type="number"
              dataKey="severityLevel"
              name="Severity Level"
              domain={[0.5, 3.5]}
              ticks={[1, 2, 3]}
              tickFormatter={(val) => SEVERITY_LABELS[val] || ''}
              stroke="#64748B"
              fontSize={11}
              fontWeight={700}
              width={65}
            />

            <ZAxis range={[90, 180]} />

            {/* Custom Interactive Tooltip */}
            <RechartsTooltip
              cursor={{ strokeDasharray: '3 3', stroke: '#94A3B8' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const pt = payload[0].payload as ScatterDataPoint;
                  return (
                    <div className="bg-slate-900 text-white p-3.5 rounded-xl shadow-2xl border border-slate-700 max-w-xs space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                            style={{ backgroundColor: SEVERITY_COLORS[pt.severityName] }}
                          />
                          <span className="font-mono text-white">{pt.timeString}</span>
                        </div>
                        <span
                          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                            pt.severityName === 'CRITICAL'
                              ? 'bg-rose-600 text-white'
                              : pt.severityName === 'WARNING'
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-blue-600 text-white'
                          }`}
                        >
                          {pt.severityName}
                        </span>
                      </div>

                      {/* Off-Hours Badge in Tooltip */}
                      {pt.isOffHours && (
                        <div className="px-2 py-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1 text-[10px] font-bold">
                          <Moon className="w-3 h-3 text-indigo-400" />
                          <span>OFF-HOURS EVENT (19:00 - 07:00)</span>
                        </div>
                      )}

                      <div className="space-y-1 font-mono text-[11px]">
                        <div>
                          <span className="text-slate-400">ACTION: </span>
                          <span className="font-bold text-white">{pt.action}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">ACTOR: </span>
                          <span className="text-slate-200">
                            {pt.actor} ({pt.role})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">TARGET: </span>
                          <span className="text-indigo-300 font-bold break-all">{pt.resource}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">IP: </span>
                          <span className="text-slate-300">{pt.ipAddress}</span>
                        </div>
                      </div>

                      <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-300 line-clamp-2">
                        {pt.details}
                      </div>

                      <p className="text-[9px] text-slate-400 text-center pt-1 italic">
                        Click scatter point to inspect payload
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />

            <Scatter
              name="Audit Events"
              data={visiblePoints}
              onClick={(node) => {
                if (node && node.rawLog && onSelectLog) {
                  onSelectLog(node.rawLog);
                }
              }}
              cursor="pointer"
            >
              {visiblePoints.map((entry) => (
                <Cell
                  key={`cell-${entry.id}`}
                  fill={SEVERITY_COLORS[entry.severityName]}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Scatter Legend & Analytics Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
        {/* Severity Color Legend */}
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Severity:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500 inline-block" />
            <span className="font-semibold text-slate-700">Critical (e.g. DELETE, Alerts)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
            <span className="font-semibold text-slate-700">Warning (e.g. Offline Sync)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
            <span className="font-semibold text-slate-700">Info (e.g. Reads, Notes)</span>
          </div>
        </div>

        {/* Off-Hours Statistics */}
        <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
          <span>
            Off-Hours Ratio:{' '}
            <strong className="text-indigo-600 font-bold">{offHoursPercentage}%</strong> (
            {offHoursEvents.length} of {scatterPoints.length})
          </span>
          <span className="hidden md:inline text-slate-300">|</span>
          <span>
            Critical Off-Hours:{' '}
            <strong
              className={offHoursCritical.length > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}
            >
              {offHoursCritical.length} flagged
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
}
