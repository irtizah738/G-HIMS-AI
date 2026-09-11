'use client';

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  Building2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  TrendingDown,
  Filter,
  Layers,
  Sparkles,
  Package,
  Boxes,
  Truck,
  ShieldAlert,
} from 'lucide-react';
import { InventoryBalance, InventoryLocation, ItemMaster } from '@/types/scm-domain';

interface ScmWardStockParChartProps {
  balances: InventoryBalance[];
  items: ItemMaster[];
  locations: InventoryLocation[];
  onInitiateReplenish?: (itemId: string, wardLocationId: string, shortfallQty: number) => void;
  selectedItemId?: string;
}

interface WardChartDataPoint {
  locationId: string;
  wardName: string;
  shortCode: string;
  currentStock: number;
  parLevel: number;
  availableStock: number;
  shortfall: number;
  fulfillmentPercent: number;
  status: 'OPTIMAL' | 'LOW' | 'CRITICAL_DEFICIT';
  itemNames: string[];
}

export function ScmWardStockParChart({
  balances,
  items,
  locations,
  onInitiateReplenish,
  selectedItemId,
}: ScmWardStockParChartProps) {
  // Selected Item filter: 'ALL' or specific itemId
  const [activeItemId, setActiveItemId] = useState<string>(selectedItemId || 'ALL');
  // Metric Mode: 'UNITS' (Raw count vs PAR) or 'PERCENTAGE' (% of PAR satisfied)
  const [displayMode, setDisplayMode] = useState<'UNITS' | 'PERCENTAGE'>('UNITS');
  // Category filter
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Major hospital wards to display
  const wardLocations = useMemo(() => {
    // Default major wards if locations list is small
    const majorLocationMap = new Map<string, InventoryLocation>();
    locations.forEach((l) => {
      // Exclude pure quarantine holds from standard clinical PAR charts unless specifically relevant
      if (l.locationType !== 'QUARANTINE_STORE' && l.locationType !== 'DAMAGED_STORE') {
        majorLocationMap.set(l.locationId, l);
      }
    });

    // Ensure standard acute wards exist in list for comprehensive hospital overview
    const standardWards = [
      { id: 'loc-icu-hub', name: 'Intensive Care Unit (ICU)', code: 'ICU' },
      { id: 'loc-ed-store', name: 'Emergency Dept (ED)', code: 'ED' },
      { id: 'loc-ot-store', name: 'Operating Theater (OT)', code: 'OT' },
      { id: 'loc-pharmacy-main', name: 'Inpatient Central Pharmacy', code: 'PHARM' },
      { id: 'loc-cath-lab', name: 'Cardiac Cath Lab', code: 'CATH' },
      { id: 'loc-central', name: 'Central Materials Depot', code: 'WHSE' },
    ];

    standardWards.forEach((sw) => {
      if (!majorLocationMap.has(sw.id)) {
        majorLocationMap.set(sw.id, {
          locationId: sw.id,
          tenantId: 'metro-health',
          facilityId: 'FAC-MAIN',
          locationType: 'WARD_STORE',
          name: sw.name,
          code: sw.code,
          temperatureControlled: true,
          restricted: false,
          active: true,
        });
      }
    });

    return Array.from(majorLocationMap.values());
  }, [locations]);

  // Compute stock vs PAR per ward
  const chartData: WardChartDataPoint[] = useMemo(() => {
    return wardLocations.map((loc) => {
      let wardBalances = balances.filter((b) => b.locationId === loc.locationId);

      // Filter by selected item if specified
      if (activeItemId !== 'ALL') {
        wardBalances = wardBalances.filter((b) => b.itemId === activeItemId);
      }

      // Filter by category if specified
      if (categoryFilter !== 'ALL') {
        const itemIdsInCat = new Set(
          items.filter((it) => it.categoryId === categoryFilter).map((it) => it.itemId)
        );
        wardBalances = wardBalances.filter((b) => itemIdsInCat.has(b.itemId));
      }

      let currentStock = 0;
      let availableStock = 0;
      let parLevel = 0;
      const itemNamesSet = new Set<string>();

      if (activeItemId !== 'ALL') {
        const targetItem = items.find((i) => i.itemId === activeItemId);
        if (targetItem) {
          itemNamesSet.add(targetItem.name);
          // Standard ward PAR target derived from targetItem.minimumStock or reorderPoint
          parLevel = Math.max(10, Math.round(targetItem.minimumStock * 0.4));
          // Central store handles full PAR
          if (loc.locationId === 'loc-central' || loc.locationId === 'loc-pharmacy-main') {
            parLevel = targetItem.minimumStock;
          }
        }

        wardBalances.forEach((b) => {
          currentStock += b.onHand;
          availableStock += b.available;
          if (b.minimumStock > 0) {
            parLevel = Math.max(parLevel, b.minimumStock);
          }
        });
      } else {
        // Aggregated items across ward
        wardBalances.forEach((b) => {
          currentStock += b.onHand;
          availableStock += b.available;
          parLevel += b.minimumStock || 25;
          itemNamesSet.add(b.itemName);
        });

        // If ward currently has zero balances recorded in system, assign baseline realistic PAR
        if (parLevel === 0) {
          parLevel = loc.locationId === 'loc-central' ? 200 : 45;
        }
      }

      const shortfall = Math.max(0, parLevel - currentStock);
      const fulfillmentPercent = parLevel > 0 ? Math.round((currentStock / parLevel) * 100) : 100;

      let status: 'OPTIMAL' | 'LOW' | 'CRITICAL_DEFICIT' = 'OPTIMAL';
      if (fulfillmentPercent < 45) {
        status = 'CRITICAL_DEFICIT';
      } else if (fulfillmentPercent < 85) {
        status = 'LOW';
      }

      // Short readable ward name for x-axis
      let shortCode = loc.code || loc.name.substring(0, 8);
      if (loc.locationId === 'loc-icu-hub') shortCode = 'ICU';
      if (loc.locationId === 'loc-ed-store') shortCode = 'ED Staging';
      if (loc.locationId === 'loc-ot-store') shortCode = 'OT Suites';
      if (loc.locationId === 'loc-pharmacy-main') shortCode = 'Pharmacy';
      if (loc.locationId === 'loc-cath-lab') shortCode = 'Cath Lab';
      if (loc.locationId === 'loc-central') shortCode = 'Central Depot';

      return {
        locationId: loc.locationId,
        wardName: loc.name,
        shortCode,
        currentStock,
        parLevel,
        availableStock,
        shortfall,
        fulfillmentPercent,
        status,
        itemNames: Array.from(itemNamesSet),
      };
    });
  }, [wardLocations, balances, activeItemId, categoryFilter, items]);

  // Aggregate executive metrics
  const summaryMetrics = useMemo(() => {
    const totalWards = chartData.length;
    const deficitWards = chartData.filter((d) => d.shortfall > 0);
    const criticalWards = chartData.filter((d) => d.status === 'CRITICAL_DEFICIT');
    const totalShortfallUnits = chartData.reduce((acc, d) => acc + d.shortfall, 0);
    const totalCurrentStock = chartData.reduce((acc, d) => acc + d.currentStock, 0);
    const totalParUnits = chartData.reduce((acc, d) => acc + d.parLevel, 0);
    const overallFulfillment =
      totalParUnits > 0 ? Math.round((totalCurrentStock / totalParUnits) * 100) : 100;

    // Ward with biggest deficit
    const sortedByDeficit = [...chartData].sort((a, b) => b.shortfall - a.shortfall);
    const topDeficitWard = sortedByDeficit[0]?.shortfall > 0 ? sortedByDeficit[0] : null;

    return {
      totalWards,
      deficitWardsCount: deficitWards.length,
      criticalWardsCount: criticalWards.length,
      totalShortfallUnits,
      totalCurrentStock,
      totalParUnits,
      overallFulfillment,
      topDeficitWard,
    };
  }, [chartData]);

  // Selected item object
  const selectedItemObj = useMemo(() => {
    if (activeItemId === 'ALL') return null;
    return items.find((i) => i.itemId === activeItemId) || null;
  }, [items, activeItemId]);

  return (
    <div
      id="scm-ward-par-dashboard-panel"
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-5"
    >
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Boxes className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Ward Inventory vs Minimum PAR Level Analysis
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">
              Recharts Analytics
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time visual comparison of on-hand physical stock against established ward PAR
            thresholds.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Item Selector */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium">Item:</span>
            <select
              id="select-ward-par-item"
              value={activeItemId}
              onChange={(e) => setActiveItemId(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 font-medium focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Items (Ward Total Units)</option>
              {items.map((it) => (
                <option key={it.itemId} value={it.itemId}>
                  {it.name} ({it.itemCode}) — {it.criticality}
                </option>
              ))}
            </select>
          </div>

          {/* Metric Toggle */}
          <div className="flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
            <button
              id="btn-par-mode-units"
              onClick={() => setDisplayMode('UNITS')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                displayMode === 'UNITS'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Units (Stock vs PAR)
            </button>
            <button
              id="btn-par-mode-percentage"
              onClick={() => setDisplayMode('PERCENTAGE')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                displayMode === 'PERCENTAGE'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              PAR Fulfillment (%)
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 font-medium">Hospital PAR Compliance</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-lg font-bold ${
                summaryMetrics.overallFulfillment >= 85
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : summaryMetrics.overallFulfillment >= 60
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {summaryMetrics.overallFulfillment}%
            </span>
            <span className="text-[10px] text-slate-400">
              ({summaryMetrics.totalCurrentStock} / {summaryMetrics.totalParUnits} units)
            </span>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 font-medium">Wards Under Minimum PAR</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-lg font-bold ${
                summaryMetrics.deficitWardsCount > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {summaryMetrics.deficitWardsCount}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {summaryMetrics.totalWards}
              </span>
            </span>
            {summaryMetrics.criticalWardsCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                {summaryMetrics.criticalWardsCount} Critical
              </span>
            )}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 font-medium">Aggregate Stock Shortfall</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-lg font-bold ${
                summaryMetrics.totalShortfallUnits > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {summaryMetrics.totalShortfallUnits.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">units</span>
            </span>
            <span className="text-[10px] text-slate-400">to meet minimum</span>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 font-medium">Primary Deficit Focus</p>
          {summaryMetrics.topDeficitWard ? (
            <div className="mt-1">
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 truncate">
                {summaryMetrics.topDeficitWard.wardName}
              </p>
              <p className="text-[10px] text-slate-400">
                Shortfall: {summaryMetrics.topDeficitWard.shortfall} units (
                {summaryMetrics.topDeficitWard.fulfillmentPercent}% PAR)
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 mt-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>All Wards At Adequate PAR</span>
            </div>
          )}
        </div>
      </div>

      {/* Selected Item Banner (if specific item chosen) */}
      {selectedItemObj && (
        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <Package className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-blue-950 dark:text-blue-200">
                  {selectedItemObj.name}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-semibold">
                  {selectedItemObj.itemCode}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                    selectedItemObj.criticality === 'VITAL'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {selectedItemObj.criticality}
                </span>
              </div>
              <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 mt-0.5">
                Hospital Min PAR: {selectedItemObj.minimumStock} {selectedItemObj.unitOfMeasure} |
                Reorder Point: {selectedItemObj.reorderPoint} | Unit Cost: ${selectedItemObj.unitCost}
              </p>
            </div>
          </div>

          <button
            onClick={() => setActiveItemId('ALL')}
            className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline font-semibold cursor-pointer shrink-0"
          >
            Clear Item Filter &times;
          </button>
        </div>
      )}

      {/* Main Recharts Bar Chart Container */}
      <div className="h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {displayMode === 'UNITS' ? (
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 15, left: -10, bottom: 25 }}
              barGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
              <XAxis
                dataKey="shortCode"
                tick={{ fontSize: 11, fill: '#64748b' }}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <Tooltip content={<CustomWardTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ paddingBottom: 12, fontSize: 12 }}
              />
              <Bar
                name="Current Stock (On Hand)"
                dataKey="currentStock"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-stock-${index}`}
                    fill={
                      entry.status === 'CRITICAL_DEFICIT'
                        ? '#ef4444' // Rose-500 for critical understock
                        : entry.status === 'LOW'
                        ? '#f59e0b' // Amber-500 for low buffer
                        : '#3b82f6' // Blue-500 for optimal stock
                    }
                  />
                ))}
              </Bar>
              <Bar
                name="Target Minimum PAR"
                dataKey="parLevel"
                fill="#94a3b8"
                opacity={0.45}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          ) : (
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 15, left: -10, bottom: 25 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
              <XAxis
                dataKey="shortCode"
                tick={{ fontSize: 11, fill: '#64748b' }}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                unit="%"
                domain={[0, (dataMax: number) => Math.max(120, Math.ceil(dataMax / 20) * 20)]}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <Tooltip content={<CustomWardTooltip />} />
              <ReferenceLine
                y={100}
                stroke="#10b981"
                strokeDasharray="4 4"
                label={{
                  value: '100% PAR Target',
                  position: 'insideTopRight',
                  fill: '#10b981',
                  fontSize: 10,
                }}
              />
              <Bar
                name="PAR Fulfillment (%)"
                dataKey="fulfillmentPercent"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-pct-${index}`}
                    fill={
                      entry.fulfillmentPercent >= 100
                        ? '#10b981' // Emerald
                        : entry.fulfillmentPercent >= 70
                        ? '#3b82f6' // Blue
                        : entry.fulfillmentPercent >= 45
                        ? '#f59e0b' // Amber
                        : '#ef4444' // Rose
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Ward Action Cards Table */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Ward Inventory Roster & Rapid Replenishment Actions
          </span>
          <span className="text-[11px] text-slate-400">
            Color Legend:{' '}
            <span className="text-rose-600 font-semibold">&lt;45% Critical Deficit</span> |{' '}
            <span className="text-amber-600 font-semibold">45-85% Low</span> |{' '}
            <span className="text-blue-600 font-semibold">&gt;85% Adequate</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {chartData.map((ward) => (
            <div
              key={ward.locationId}
              className={`p-3.5 rounded-xl border transition-all ${
                ward.status === 'CRITICAL_DEFICIT'
                  ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60'
                  : ward.status === 'LOW'
                  ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
                  : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {ward.wardName}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Code: <span className="font-mono">{ward.shortCode}</span>
                  </p>
                </div>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    ward.status === 'CRITICAL_DEFICIT'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      : ward.status === 'LOW'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}
                >
                  {ward.fulfillmentPercent}% PAR
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-center pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                <div>
                  <p className="text-[10px] text-slate-400">Current Stock</p>
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {ward.currentStock}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Target PAR</p>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    {ward.parLevel}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Shortfall</p>
                  <p
                    className={`text-xs font-bold ${
                      ward.shortfall > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600'
                    }`}
                  >
                    {ward.shortfall > 0 ? `-${ward.shortfall}` : '0'}
                  </p>
                </div>
              </div>

              {ward.shortfall > 0 && (
                <div className="mt-3 pt-2">
                  <button
                    onClick={() => {
                      if (onInitiateReplenish) {
                        onInitiateReplenish(
                          activeItemId !== 'ALL' ? activeItemId : 'itm-ceftriaxone',
                          ward.locationId,
                          ward.shortfall
                        );
                      }
                    }}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Auto-Replenish {ward.shortfall} Units</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Custom Tooltip component for Recharts
function CustomWardTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;

  const data: WardChartDataPoint = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 shadow-xl text-xs space-y-2 min-w-[200px]">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-1.5">
        <p className="font-bold text-slate-900 dark:text-slate-100">{data.wardName}</p>
        <p className="text-[10px] text-slate-400 font-mono">Location ID: {data.locationId}</p>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
          <span>Current Stock:</span>
          <span className="font-bold text-blue-600 dark:text-blue-400">{data.currentStock} units</span>
        </div>
        <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
          <span>Minimum PAR Level:</span>
          <span className="font-bold text-slate-700 dark:text-slate-200">{data.parLevel} units</span>
        </div>
        <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
          <span>PAR Fulfillment:</span>
          <span
            className={`font-bold ${
              data.fulfillmentPercent >= 100
                ? 'text-emerald-600'
                : data.fulfillmentPercent >= 60
                ? 'text-amber-600'
                : 'text-rose-600'
            }`}
          >
            {data.fulfillmentPercent}%
          </span>
        </div>
        {data.shortfall > 0 ? (
          <div className="flex justify-between items-center text-rose-600 dark:text-rose-400 font-semibold pt-1 border-t border-slate-100 dark:border-slate-800">
            <span>PAR Deficit:</span>
            <span>-{data.shortfall} units</span>
          </div>
        ) : (
          <div className="text-emerald-600 text-[11px] font-semibold pt-1 border-t border-slate-100 dark:border-slate-800">
            ✓ Target PAR satisfied
          </div>
        )}
      </div>
    </div>
  );
}
