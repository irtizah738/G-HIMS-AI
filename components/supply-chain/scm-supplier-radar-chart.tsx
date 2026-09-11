'use client';

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Award,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Truck,
  Building,
  Filter,
  BarChart3,
  Layers,
} from 'lucide-react';
import { SupplierMaster } from '@/types/scm-domain';

interface ScmSupplierRadarChartProps {
  suppliers: SupplierMaster[];
  onSelectSupplier?: (supplierId: string) => void;
}

// Fixed color palette for vendor radar overlays
const VENDOR_COLORS = [
  { stroke: '#2563eb', fill: '#3b82f6', name: 'Blue' }, // Blue
  { stroke: '#10b981', fill: '#34d399', name: 'Emerald' }, // Emerald
  { stroke: '#8b5cf6', fill: '#a78bfa', name: 'Purple' }, // Purple
  { stroke: '#f59e0b', fill: '#fbbf24', name: 'Amber' }, // Amber
  { stroke: '#ec4899', fill: '#f472b6', name: 'Pink' }, // Pink
  { stroke: '#06b6d4', fill: '#22d3ee', name: 'Cyan' }, // Cyan
];

export function ScmSupplierRadarChart({
  suppliers,
  onSelectSupplier,
}: ScmSupplierRadarChartProps) {
  // Selected suppliers for comparison (default first 3)
  const defaultSelectedIds = useMemo(() => {
    return suppliers.slice(0, 3).map((s) => s.supplierId);
  }, [suppliers]);

  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(defaultSelectedIds);
  const [activeMetricHover, setActiveMetricHover] = useState<string | null>(null);

  // Toggle selection
  const toggleSupplier = (supplierId: string) => {
    if (selectedSupplierIds.includes(supplierId)) {
      if (selectedSupplierIds.length > 1) {
        setSelectedSupplierIds(selectedSupplierIds.filter((id) => id !== supplierId));
      }
    } else {
      if (selectedSupplierIds.length < 4) {
        setSelectedSupplierIds([...selectedSupplierIds, supplierId]);
      }
    }
  };

  // Prepare radar metrics data
  // Dimensions:
  // 1. On-Time Delivery (%)
  // 2. Order Accuracy / Fill Rate (%)
  // 3. Quality Acceptance (%)
  // 4. Regulatory Compliance (%)
  // 5. Lead Time Score (100 - avgLeadDays * 8)
  // 6. Price Stability (100 - priceVariance * 5)
  const radarData = useMemo(() => {
    if (!suppliers || suppliers.length === 0) return [];

    const dimensions = [
      { key: 'onTimeDelivery', label: 'On-Time Delivery', fullMark: 100 },
      { key: 'orderAccuracy', label: 'Order Accuracy / Fill Rate', fullMark: 100 },
      { key: 'qualityAcceptance', label: 'Quality Acceptance', fullMark: 100 },
      { key: 'complianceScore', label: 'Regulatory Compliance', fullMark: 100 },
      { key: 'leadTimeScore', label: 'Lead Time Adherence', fullMark: 100 },
      { key: 'overallScore', label: 'Overall Reliability Index', fullMark: 100 },
    ];

    return dimensions.map((dim) => {
      const dataPoint: Record<string, any> = {
        metric: dim.label,
        fullMark: dim.fullMark,
      };

      suppliers.forEach((s) => {
        const sc = s.scorecard;
        let val = 85;

        if (dim.key === 'onTimeDelivery') {
          val = sc?.onTimeDeliveryRatePercent ?? 92;
        } else if (dim.key === 'orderAccuracy') {
          val = sc?.fillRatePercent ?? 95;
        } else if (dim.key === 'qualityAcceptance') {
          val = sc?.qualityAcceptanceRatePercent ?? 98;
        } else if (dim.key === 'complianceScore') {
          val =
            sc?.complianceStatus === 'FULLY_COMPLIANT'
              ? 98
              : sc?.complianceStatus === 'WARNING_RENEWAL_DUE'
              ? 75
              : 50;
        } else if (dim.key === 'leadTimeScore') {
          const leadDays = sc?.averageLeadTimeDays ?? 4;
          val = Math.max(50, Math.min(100, Math.round(100 - leadDays * 5)));
        } else if (dim.key === 'overallScore') {
          val = sc?.overallExplainableScore ?? 90;
        }

        dataPoint[s.supplierId] = Math.round(val);
      });

      return dataPoint;
    });
  }, [suppliers]);

  // Selected suppliers metadata
  const activeSuppliers = useMemo(() => {
    return suppliers.filter((s) => selectedSupplierIds.includes(s.supplierId));
  }, [suppliers, selectedSupplierIds]);

  // Best in class metrics
  const topOnTime = useMemo(() => {
    return [...suppliers].sort(
      (a, b) =>
        (b.scorecard?.onTimeDeliveryRatePercent || 0) - (a.scorecard?.onTimeDeliveryRatePercent || 0)
    )[0];
  }, [suppliers]);

  const topAccuracy = useMemo(() => {
    return [...suppliers].sort(
      (a, b) => (b.scorecard?.fillRatePercent || 0) - (a.scorecard?.fillRatePercent || 0)
    )[0];
  }, [suppliers]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Supplier Reliability Radar (On-Time vs Order Accuracy)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Multi-dimensional vendor performance visualization comparing delivery SLA adherence, fill rates, and quality scores.
              </p>
            </div>
          </div>
        </div>

        {/* Benchmarks Highlights */}
        <div className="flex items-center gap-3 text-xs">
          {topOnTime && (
            <div className="bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px] font-semibold">Top On-Time Delivery</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {topOnTime.displayName} ({topOnTime.scorecard?.onTimeDeliveryRatePercent}%)
              </span>
            </div>
          )}
          {topAccuracy && (
            <div className="bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px] font-semibold">Top Order Accuracy</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {topAccuracy.displayName} ({topAccuracy.scorecard?.fillRatePercent}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Vendor Selector Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" />
          Compare Vendors (up to 4):
        </span>
        {suppliers.map((s, idx) => {
          const isSelected = selectedSupplierIds.includes(s.supplierId);
          const colorIdx = selectedSupplierIds.indexOf(s.supplierId);
          const color = colorIdx >= 0 ? VENDOR_COLORS[colorIdx % VENDOR_COLORS.length] : null;

          return (
            <button
              key={s.supplierId}
              onClick={() => toggleSupplier(s.supplierId)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer border ${
                isSelected && color
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
              }`}
              style={{
                borderColor: isSelected && color ? color.stroke : undefined,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: isSelected && color ? color.stroke : '#94a3b8',
                }}
              />
              <span>{s.displayName || s.legalName}</span>
              {isSelected && (
                <span className="text-[10px] opacity-75 font-mono">
                  {s.scorecard?.overallExplainableScore || 90}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Grid: Radar Chart + Scorecard Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Radar Chart (7 Cols) */}
        <div className="lg:col-span-7 h-[380px] w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
              <PolarGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <PolarAngleAxis
                dataKey="metric"
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
              />
              <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#cbd5e1" fontSize={10} />

              {activeSuppliers.map((s, idx) => {
                const color = VENDOR_COLORS[idx % VENDOR_COLORS.length];
                return (
                  <Radar
                    key={s.supplierId}
                    name={s.displayName || s.legalName}
                    dataKey={s.supplierId}
                    stroke={color.stroke}
                    fill={color.fill}
                    fillOpacity={0.25}
                    strokeWidth={2}
                  />
                );
              })}

              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1.5 border border-slate-700">
                        <div className="font-bold border-b border-slate-800 pb-1 text-slate-200">
                          {label}
                        </div>
                        {payload.map((entry: any, i: number) => (
                          <div key={i} className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: entry.color }}
                              />
                              {entry.name}:
                            </span>
                            <span className="font-mono font-bold">{entry.value}%</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                wrapperStyle={{
                  paddingTop: 16,
                  fontSize: 12,
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Comparative Metric Breakdown (5 Cols) */}
        <div className="lg:col-span-5 space-y-3">
          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            Vendor Reliability Breakdown
          </h4>

          <div className="space-y-2.5">
            {activeSuppliers.map((s, idx) => {
              const color = VENDOR_COLORS[idx % VENDOR_COLORS.length];
              const sc = s.scorecard;

              return (
                <div
                  key={s.supplierId}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-md shrink-0"
                        style={{ backgroundColor: color.stroke }}
                      />
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {s.displayName || s.legalName}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        s.riskLevel === 'LOW'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : s.riskLevel === 'MEDIUM'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {s.riskLevel} RISK
                    </span>
                  </div>

                  {/* 2-Column SLA Stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div>
                      <span className="text-slate-400 block text-[10px]">On-Time Delivery SLA</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono text-xs">
                        {sc?.onTimeDeliveryRatePercent ?? 92}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Order Accuracy / Fill</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono text-xs">
                        {sc?.fillRatePercent ?? 95}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Quality Acceptance</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono text-xs">
                        {sc?.qualityAcceptanceRatePercent ?? 98}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Avg Dock Lead Time</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono text-xs">
                        {sc?.averageLeadTimeDays ?? 3.5} Days
                      </span>
                    </div>
                  </div>

                  {onSelectSupplier && (
                    <button
                      onClick={() => onSelectSupplier(s.supplierId)}
                      className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1 pt-1"
                    >
                      <span>View Supplier Profile & Contracts</span>
                      <span>&rarr;</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
