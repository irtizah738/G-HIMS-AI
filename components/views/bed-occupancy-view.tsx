'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bed, WardType, BedStatus } from '@/lib/types/ghims';
import * as d3 from 'd3';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  BedDouble,
  UserPlus,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Activity,
  Volume2,
  VolumeX,
  TrendingUp,
  X,
  Layers,
  History,
  ShieldAlert,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { useHospital } from '@/lib/context/hospital-context';
import { clinicalAudioAlerts } from '@/lib/clinical/audio-alerts';

interface ActivityLogItem {
  id: string;
  time: string;
  type: 'ADMIT' | 'DISCHARGE' | 'STATUS_CHANGE' | 'NEWS2_ALERT' | 'SYNC';
  title: string;
  description: string;
  severity?: 'NORMAL' | 'WARN' | 'CRITICAL';
}

export function BedOccupancyView() {
  const {
    beds,
    patients,
    staff,
    updateBedStatus,
    admitPatientToBed,
    dischargePatientFromBed,
    setSelectedPatientId,
    setActiveTab,
  } = useHospital();

  const [selectedWard, setSelectedWard] = useState<WardType | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<BedStatus | 'All'>('All');
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [admitPatientId, setAdmitPatientId] = useState('');
  const [admitDoctor, setAdmitDoctor] = useState('Dr. Fatima Zahra');
  const [admitNurse, setAdmitNurse] = useState('Nurse Clara Oswald');
  const [showActivityDrawer, setShowActivityDrawer] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);

  const doctorsList = useMemo(() => staff.filter((s) => s.role === 'Physician' || s.role === 'Surgeon'), [staff]);
  const nursesList = useMemo(() => staff.filter((s) => s.role === 'Nurse'), [staff]);

  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([
    {
      id: 'log-1',
      time: '10:42 AM',
      type: 'NEWS2_ALERT',
      title: 'NEWS2 Critical Alert Triggered',
      description: 'Bed B-103 (Marcus Brody) computed NEWS2 score = 6 (RR 24, SpO2 91%).',
      severity: 'CRITICAL',
    },
    {
      id: 'log-2',
      time: '10:15 AM',
      type: 'ADMIT',
      title: 'Patient Admitted to ICU-01',
      description: 'Admitted Helen Cho (MRN-8491) by Dr. Sarah Jenkins.',
      severity: 'NORMAL',
    },
    {
      id: 'log-3',
      time: '09:50 AM',
      type: 'SYNC',
      title: 'Dual-Engine Telemetry Synced',
      description: 'IndexedDB offline queue flushed 3 occupancy delta transactions.',
      severity: 'NORMAL',
    },
    {
      id: 'log-4',
      time: '09:12 AM',
      type: 'STATUS_CHANGE',
      title: 'Bed Cleaned & Marked Ready',
      description: 'Bed G-204 terminal disinfection completed by housekeeping.',
      severity: 'NORMAL',
    },
  ]);

  const d3SvgRef = useRef<SVGSVGElement | null>(null);

  const wards: (WardType | 'All')[] = [
    'All',
    'ICU',
    'General',
    'Emergency',
    'Maternity',
    'Pediatrics',
    'Surgery',
  ];

  // Daily census 7-day trend data for Recharts
  const censusTrendData = useMemo(() => {
    return [
      { day: 'Mon', admissions: 12, discharges: 10, occupancyRate: 78 },
      { day: 'Tue', admissions: 15, discharges: 11, occupancyRate: 82 },
      { day: 'Wed', admissions: 18, discharges: 14, occupancyRate: 85 },
      { day: 'Thu', admissions: 14, discharges: 16, occupancyRate: 81 },
      { day: 'Fri', admissions: 22, discharges: 15, occupancyRate: 89 },
      { day: 'Sat', admissions: 19, discharges: 18, occupancyRate: 87 },
      { day: 'Today', admissions: 16, discharges: 12, occupancyRate: 86 },
    ];
  }, []);

  const filteredBeds = useMemo(() => {
    return beds.filter((b) => {
      const matchWard = selectedWard === 'All' || b.ward === selectedWard;
      const matchStatus = statusFilter === 'All' || b.status === statusFilter;
      return matchWard && matchStatus;
    });
  }, [beds, selectedWard, statusFilter]);

  // Ward summary statistics
  const wardSummary = useMemo(() => {
    const counts: Record<string, { total: number; occupied: number; available: number }> = {};
    beds.forEach((bed) => {
      if (!counts[bed.ward]) {
        counts[bed.ward] = { total: 0, occupied: 0, available: 0 };
      }
      counts[bed.ward].total += 1;
      if (bed.status === 'occupied') counts[bed.ward].occupied += 1;
      if (bed.status === 'available') counts[bed.ward].available += 1;
    });
    return counts;
  }, [beds]);

  // Trigger sound alarm when high NEWS2 alerts exist
  const highRiskBedsCount = useMemo(() => {
    return beds.filter((b) => b.vitalAlert || (b.notes && b.notes.includes('NEWS2: 6'))).length;
  }, [beds]);

  const handleToggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    clinicalAudioAlerts.setSoundEnabled(!next);
    if (!next) {
      clinicalAudioAlerts.playSuccessChime();
    }
  };

  const handleTriggerTestAudio = () => {
    clinicalAudioAlerts.playNews2HighAlert();
  };

  // Render D3 Interactive Ward Distribution Chart
  useEffect(() => {
    if (!d3SvgRef.current) return;

    const svg = d3.select(d3SvgRef.current);
    svg.selectAll('*').remove();

    const width = 440;
    const height = 180;
    const margin = { top: 20, right: 20, bottom: 35, left: 40 };

    const data = Object.entries(wardSummary).map(([ward, stat]) => ({
      ward,
      rate: stat.total > 0 ? Math.round((stat.occupied / stat.total) * 100) : 0,
      occupied: stat.occupied,
      total: stat.total,
    }));

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.ward))
      .range([margin.left, width - margin.right])
      .padding(0.3);

    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Grid lines
    svg
      .append('g')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-dasharray', '2,2')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-width + margin.left + margin.right)
          .tickFormat(() => '')
      )
      .call((g) => g.select('.domain').remove());

    // Bars
    svg
      .selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.ward) || 0)
      .attr('y', (d) => y(d.rate))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - margin.bottom - y(d.rate))
      .attr('rx', 4)
      .attr('fill', (d) => {
        if (d.rate >= 85) return '#ef4444';
        if (d.rate >= 60) return '#3b82f6';
        return '#10b981';
      });

    // Value labels on bars
    svg
      .selectAll('.label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => (x(d.ward) || 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.rate) - 6)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', '#475569')
      .text((d) => `${d.rate}%`);

    // X Axis
    svg
      .append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x))
      .call((g) => g.select('.domain').attr('stroke', '#cbd5e1'))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#64748b');

    // Y Axis
    svg
      .append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d) => `${d}%`))
      .call((g) => g.select('.domain').remove())
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#94a3b8');
  }, [wardSummary]);

  const handleAdmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBed || !admitPatientId) return;
    admitPatientToBed(admitPatientId, selectedBed.id, admitDoctor, admitNurse);
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'ADMIT',
        title: `Admitted to Bed ${selectedBed.bedNumber}`,
        description: `Patient ID ${admitPatientId} assigned to ${selectedBed.ward} Ward.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);

    setShowAdmitModal(false);
    setAdmitPatientId('');
    setSelectedBed(null);
  };

  const handleDischarge = (bedId: string, bedNumber: string) => {
    dischargePatientFromBed(bedId);
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'DISCHARGE',
        title: `Discharged from Bed ${bedNumber}`,
        description: `Bed ${bedNumber} status shifted to 'cleaning'.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);
  };

  const getStatusBadge = (status: BedStatus) => {
    switch (status) {
      case 'occupied':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            Occupied
          </span>
        );
      case 'available':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Available
          </span>
        );
      case 'cleaning':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Cleaning
          </span>
        );
      case 'maintenance':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            Maintenance
          </span>
        );
      case 'reserved':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Reserved
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls with Audio Synthesizer Toggle & Activity Drawer Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
            <BedDouble className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Inpatient Bed Board & Clinical NEWS2 Telemetry
              {highRiskBedsCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 animate-pulse">
                  <ShieldAlert className="w-3 h-3" />
                  {highRiskBedsCount} High NEWS2 Alert
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live census occupancy, Web Audio compliance alarms & 7-day admission trend analytics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Web Audio Synthesizer Test & Mute Button */}
          <button
            id="btn-toggle-audio-alerts"
            type="button"
            onClick={handleToggleSound}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all ${
              soundMuted
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
            }`}
            title="Toggle Web Audio Clinical Compliance Alarms"
          >
            {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{soundMuted ? 'Audio Muted' : 'Audio Active'}</span>
          </button>

          <button
            id="btn-test-alert-sound"
            type="button"
            onClick={handleTriggerTestAudio}
            className="px-2.5 py-1.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-xl transition-colors"
            title="Test NEWS2 High-Risk Alarm Frequency"
          >
            Test Alarm
          </button>

          {/* Activity Stream Drawer Button */}
          <button
            id="btn-open-activity-drawer"
            type="button"
            onClick={() => setShowActivityDrawer(true)}
            className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            <span>Activity Stream</span>
          </button>
        </div>
      </div>

      {/* Top Banner: 7-Day Census Trend Chart & D3 Ward Distribution Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recharts Daily Census Trend Line Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                7-Day Census Admissions vs Discharges Trend
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Institutional throughput analytics and daily bed turnover rate
              </p>
            </div>
            <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
              Avg Occupancy: 83.8%
            </span>
          </div>

          <div className="w-full h-48 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={censusTrendData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    color: '#f8fafc',
                    fontSize: '11px',
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />
                <Line
                  type="monotone"
                  dataKey="admissions"
                  name="Admissions"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="discharges"
                  name="Discharges"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="occupancyRate"
                  name="Occupancy %"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* D3 Ward Capacity Heatmap (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Live Ward Capacity Distribution
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                D3 telemetry across specialty wings
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
              Live D3
            </span>
          </div>

          <div className="w-full flex justify-center overflow-x-auto my-auto">
            <svg ref={d3SvgRef} viewBox="0 0 440 180" className="w-full max-w-sm h-40" />
          </div>
        </div>
      </div>

      {/* Ward Filter Bar & Controls */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Ward:
          </span>
          {wards.map((ward) => (
            <button
              key={ward}
              id={`filter-ward-${ward.toLowerCase()}`}
              onClick={() => setSelectedWard(ward)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedWard === ward
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {ward}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status:</span>
          <select
            id="select-bed-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BedStatus | 'All')}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="All">All Statuses</option>
            <option value="available">Available Only</option>
            <option value="occupied">Occupied Only</option>
            <option value="cleaning">Cleaning</option>
            <option value="maintenance">Maintenance</option>
            <option value="reserved">Reserved</option>
          </select>
        </div>
      </div>

      {/* Bed Grid with Pulsing NEWS2 Visual Notification */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredBeds.map((bed) => {
          const isOccupied = bed.status === 'occupied';
          const isNews2Alert = bed.vitalAlert || (bed.notes && bed.notes.includes('NEWS2: 6'));

          return (
            <div
              key={bed.id}
              id={`bed-card-${bed.id}`}
              onClick={() => setSelectedBed(bed)}
              className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-slate-900 relative hover:shadow-md flex flex-col justify-between ${
                isNews2Alert
                  ? 'border-rose-500 ring-2 ring-rose-500/40 bg-rose-50/20 dark:bg-rose-950/20 animate-pulse'
                  : selectedBed?.id === bed.id
                  ? 'ring-2 ring-blue-600 border-transparent'
                  : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div>
                {/* High-Risk NEWS2 Warning Banner */}
                {isNews2Alert && (
                  <div className="mb-2.5 px-2.5 py-1 rounded-lg bg-rose-600 text-white flex items-center justify-between shadow-xs">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      NEWS2 Critical Alert (Score: ≥5)
                    </span>
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {bed.bedNumber}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400">({bed.room})</span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {bed.ward} Ward
                    </span>
                  </div>
                  <div>{getStatusBadge(bed.status)}</div>
                </div>

                {/* Patient info if occupied */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {isOccupied ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {bed.patientName}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (bed.patientId) {
                              setSelectedPatientId(bed.patientId);
                              setActiveTab('patients');
                            }
                          }}
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                        >
                          MPI Profile &rarr;
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Attending: {bed.assignedDoctor || 'Assigned'}</span>
                      </div>
                      {bed.notes && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 italic truncate">
                          {bed.notes}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-1">
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                        {bed.status === 'available'
                          ? 'Bed clean & available'
                          : bed.status === 'cleaning'
                          ? 'Housekeeping in progress'
                          : bed.status === 'maintenance'
                          ? bed.notes || 'Facility repair underway'
                          : 'Reserved for patient'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1">
                {isOccupied ? (
                  <button
                    id={`btn-discharge-${bed.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDischarge(bed.id, bed.bedNumber);
                    }}
                    className="w-full py-1.5 px-2 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Discharge & Clean
                  </button>
                ) : bed.status === 'available' ? (
                  <button
                    id={`btn-admit-${bed.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBed(bed);
                      setShowAdmitModal(true);
                    }}
                    className="w-full py-1.5 px-2 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Admit Patient
                  </button>
                ) : (
                  <button
                    id={`btn-ready-${bed.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBedStatus(bed.id, 'available', 'Cleared and ready');
                    }}
                    className="w-full py-1.5 px-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark Ready
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity Stream Drawer */}
      {showActivityDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl p-6 flex flex-col justify-between border-l border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Bed Board Activity Stream
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Real-time offline queue & occupancy event log
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowActivityDrawer(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Log List */}
              <div className="mt-4 flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
                {activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3.5 rounded-xl border text-xs flex flex-col gap-1.5 ${
                      log.severity === 'CRITICAL'
                        ? 'bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                        : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">{log.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{log.time}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">{log.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowActivityDrawer(false)}
                className="w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bed Detail Modal */}
      {selectedBed && !showAdmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {selectedBed.bedNumber}
                  </h3>
                  {getStatusBadge(selectedBed.status)}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedBed.ward} Ward &bull; {selectedBed.room}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBed(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1"
              >
                &times;
              </button>
            </div>

            {selectedBed.status === 'occupied' && (
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Patient:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedBed.patientName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Admitted:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.admissionDate}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Attending Physician:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.assignedDoctor || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Primary Nurse:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.assignedNurse || 'N/A'}
                  </span>
                </div>
              </div>
            )}

            {/* Change Status Options */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Change Bed Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  id="btn-status-available"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'available');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                >
                  Mark Available
                </button>
                <button
                  id="btn-status-cleaning"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'cleaning');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100"
                >
                  Mark Cleaning
                </button>
                <button
                  id="btn-status-maintenance"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'maintenance', 'Routine calibration');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                >
                  Maintenance
                </button>
                <button
                  id="btn-status-reserved"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'reserved');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
                >
                  Reserve Bed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admit Patient Modal */}
      {showAdmitModal && selectedBed && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Admit Patient to {selectedBed.bedNumber}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedBed.ward} Ward &bull; Room {selectedBed.room}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdmitModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAdmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Patient *
                </label>
                <select
                  required
                  value={admitPatientId}
                  onChange={(e) => setAdmitPatientId(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">-- Choose Patient from MPI --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn}) - Age: {p.age}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Attending Physician
                </label>
                <select
                  value={admitDoctor}
                  onChange={(e) => setAdmitDoctor(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {doctorsList.map((doc) => (
                    <option key={doc.id} value={doc.fullName}>
                      {doc.fullName} ({doc.department})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Primary Nurse
                </label>
                <select
                  value={admitNurse}
                  onChange={(e) => setAdmitNurse(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {nursesList.map((nurse) => (
                    <option key={nurse.id} value={nurse.fullName}>
                      {nurse.fullName} ({nurse.department})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdmitModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
