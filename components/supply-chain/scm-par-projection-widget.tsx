'use client';

import React, { useMemo, useState } from 'react';
import {
  ItemMaster,
  InventoryBalance,
  StockTransaction,
  InventoryLocation,
} from '@/types/scm-domain';
import {
  Clock,
  AlertTriangle,
  TrendingDown,
  ShieldCheck,
  Calendar,
  Layers,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

interface ScmParProjectionWidgetProps {
  balances: InventoryBalance[];
  transactions: StockTransaction[];
  items: ItemMaster[];
  locations: InventoryLocation[];
  onTriggerReorder?: (item: ItemMaster, suggestedQty: number) => void;
}

export interface ItemStockoutProjection {
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationName: string;
  uom: string;
  criticality: string;
  availableStock: number;
  minimumStock: number;
  past7DaysConsumptionTotal: number;
  avgDailyConsumption: number;
  isEmpirical: boolean; // true if computed from actual 7-day transactions
  estimatedDaysUntilStockout: number;
  estimatedStockoutDate: string;
  riskStatus: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  suggestedReplenishmentQty: number;
}

export function ScmParProjectionWidget({
  balances,
  transactions,
  items,
  locations,
  onTriggerReorder,
}: ScmParProjectionWidgetProps) {
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'HEALTHY'>('ALL');

  // Compute 7-day linear consumption and stockout projections
  const projections = useMemo<ItemStockoutProjection[]>(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;

    // Filter consumption/issue transactions in the past 7 days
    const recentConsumptions = transactions.filter((tx) => {
      const txTime = new Date(tx.recordedAt || tx.occurredAt).getTime();
      const isConsumption = ['CONSUMPTION', 'ISSUE', 'DISPENSE', 'TRANSFER_OUT'].includes(
        tx.transactionType
      );
      return isConsumption && txTime >= sevenDaysAgo;
    });

    // Aggregate 7-day total consumption by item and location
    const consumptionMap = new Map<string, number>(); // key: `${itemId}_${locationId}`
    recentConsumptions.forEach((tx) => {
      const locId = tx.fromLocationId || 'loc-central';
      const key = `${tx.itemId}_${locId}`;
      consumptionMap.set(key, (consumptionMap.get(key) || 0) + (tx.quantity || 0));

      // Also track item-wide fallback
      const itemKey = `${tx.itemId}_ALL`;
      consumptionMap.set(itemKey, (consumptionMap.get(itemKey) || 0) + (tx.quantity || 0));
    });

    // Map each balance record to a linear projection
    return balances.map((bal) => {
      const itm = items.find((i) => i.itemId === bal.itemId);
      const locKey = `${bal.itemId}_${bal.locationId}`;
      const itemWideKey = `${bal.itemId}_ALL`;

      const recorded7DayTotal =
        consumptionMap.get(locKey) ?? consumptionMap.get(itemWideKey) ?? 0;

      let avgDaily: number;
      let isEmpirical = false;

      if (recorded7DayTotal > 0) {
        avgDaily = Number((recorded7DayTotal / 7).toFixed(2));
        isEmpirical = true;
      } else {
        // Deterministic baseline daily consumption velocity:
        // Estimated based on item reorderPoint (typical 14-day stock buffer) or default to 3 units/day
        const baselineRate = itm?.reorderPoint ? Math.max(1, Math.round(itm.reorderPoint / 14)) : 3;
        avgDaily = baselineRate;
      }

      const available = Math.max(0, bal.available ?? bal.onHand ?? 0);
      const daysUntilStockout =
        avgDaily > 0 ? Number((available / avgDaily).toFixed(1)) : 999;

      const stockoutTimestamp = now + daysUntilStockout * 86400000;
      const stockoutDate = new Date(stockoutTimestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      let riskStatus: 'CRITICAL' | 'WARNING' | 'HEALTHY' = 'HEALTHY';
      if (daysUntilStockout <= 3) {
        riskStatus = 'CRITICAL';
      } else if (daysUntilStockout <= 7) {
        riskStatus = 'WARNING';
      }

      // Suggested reorder = safety buffer (14 days of consumption + PAR deficit)
      const targetPar = bal.minimumStock || itm?.reorderPoint || 20;
      const deficit = Math.max(0, targetPar - available);
      const suggestedQty = Math.max(
        deficit,
        Math.round(avgDaily * (itm?.leadTimeDays || 7))
      );

      return {
        itemId: bal.itemId,
        itemCode: bal.itemCode || itm?.itemCode || 'SKU-GEN',
        itemName: bal.itemName || itm?.name || 'Medical Supply',
        locationId: bal.locationId,
        locationName: bal.locationName || 'Central Store',
        uom: bal.uom || itm?.unitOfMeasure || 'UNITS',
        criticality: itm?.criticality || 'ESSENTIAL',
        availableStock: available,
        minimumStock: targetPar,
        past7DaysConsumptionTotal: recorded7DayTotal,
        avgDailyConsumption: avgDaily,
        isEmpirical,
        estimatedDaysUntilStockout: daysUntilStockout,
        estimatedStockoutDate: stockoutDate,
        riskStatus,
        suggestedReplenishmentQty: Math.max(10, suggestedQty),
      };
    });
  }, [balances, transactions, items]);

  // Filtered projections
  const filtered = useMemo(() => {
    return projections.filter((p) => {
      if (selectedLocation !== 'ALL' && p.locationId !== selectedLocation) return false;
      if (riskFilter !== 'ALL' && p.riskStatus !== riskFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.itemName.toLowerCase().includes(q) ||
          p.itemCode.toLowerCase().includes(q) ||
          p.locationName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projections, selectedLocation, riskFilter, searchQuery]);

  // Summary counts
  const criticalCount = projections.filter((p) => p.riskStatus === 'CRITICAL').length;
  const warningCount = projections.filter((p) => p.riskStatus === 'WARNING').length;
  const healthyCount = projections.filter((p) => p.riskStatus === 'HEALTHY').length;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-5">
      {/* Header & Metric Highlight */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Linear PAR Stockout Projections (7-Day Burn Rate)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Calculates estimated days-until-stockout based on average daily consumption over the past 7 days.
              </p>
            </div>
          </div>
        </div>

        {/* Quick KPI Badges */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setRiskFilter(riskFilter === 'CRITICAL' ? 'ALL' : 'CRITICAL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              riskFilter === 'CRITICAL'
                ? 'bg-rose-500 text-white border-rose-600 shadow-xs'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{criticalCount} Critical (&le; 3d)</span>
          </button>

          <button
            onClick={() => setRiskFilter(riskFilter === 'WARNING' ? 'ALL' : 'WARNING')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              riskFilter === 'WARNING'
                ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900 hover:bg-amber-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{warningCount} Warning (4-7d)</span>
          </button>

          <button
            onClick={() => setRiskFilter(riskFilter === 'HEALTHY' ? 'ALL' : 'HEALTHY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              riskFilter === 'HEALTHY'
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{healthyCount} Stable (&gt;7d)</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search item name, code, ward..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium cursor-pointer"
          >
            <option value="ALL">All Hospital Locations ({locations.length})</option>
            {locations.map((loc) => (
              <option key={loc.locationId} value={loc.locationId}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Projections Table / Cards */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="p-3">Item & Ward Location</th>
              <th className="p-3 text-right">Available Stock</th>
              <th className="p-3 text-right">7-Day Avg Burn Rate</th>
              <th className="p-3">Linear Depletion Run-Out Horizon</th>
              <th className="p-3 text-center">Days to Stockout</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No inventory items match the selected filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((proj) => {
                const isCritical = proj.riskStatus === 'CRITICAL';
                const isWarning = proj.riskStatus === 'WARNING';
                const percentBuffer = Math.min(100, Math.round((proj.availableStock / Math.max(1, proj.minimumStock)) * 100));

                return (
                  <tr
                    key={`${proj.itemId}_${proj.locationId}`}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {proj.itemName}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {proj.itemCode}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            proj.criticality === 'VITAL'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {proj.criticality}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                        <Layers className="w-3 h-3 text-slate-400" />
                        <span>{proj.locationName}</span>
                        <span>•</span>
                        <span>Min PAR: {proj.minimumStock} {proj.uom}</span>
                      </div>
                    </td>

                    <td className="p-3 text-right">
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {proj.availableStock}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400">{proj.uom}</span>
                    </td>

                    <td className="p-3 text-right">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {proj.avgDailyConsumption} {proj.uom} / day
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {proj.isEmpirical ? (
                          <span className="text-blue-600 dark:text-blue-400">7-Day Total: {proj.past7DaysConsumptionTotal}</span>
                        ) : (
                          <span className="text-slate-400 italic">Baseline Velocity</span>
                        )}
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-500">PAR Coverage:</span>
                          <span
                            className={`font-semibold ${
                              isCritical
                                ? 'text-rose-600 dark:text-rose-400'
                                : isWarning
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {percentBuffer}% of target PAR
                          </span>
                        </div>

                        {/* Depletion Progress Bar */}
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isCritical
                                ? 'bg-rose-500'
                                : isWarning
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, (proj.estimatedDaysUntilStockout / 14) * 100)}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Today</span>
                          <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                            <Calendar className="w-3 h-3" />
                            Stockout: {proj.estimatedDaysUntilStockout > 60 ? '60+ days' : proj.estimatedStockoutDate}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="p-3 text-center">
                      <div
                        className={`inline-flex flex-col items-center justify-center px-3 py-1.5 rounded-xl border font-mono ${
                          isCritical
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                            : isWarning
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        <span className="text-base font-extrabold leading-none">
                          {proj.estimatedDaysUntilStockout > 99 ? '99+' : proj.estimatedDaysUntilStockout}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider font-bold mt-0.5">
                          Days Left
                        </span>
                      </div>
                    </td>

                    <td className="p-3 text-center">
                      {proj.riskStatus !== 'HEALTHY' ? (
                        <button
                          onClick={() => {
                            const itm = items.find((i) => i.itemId === proj.itemId);
                            if (itm && onTriggerReorder) {
                              onTriggerReorder(itm, proj.suggestedReplenishmentQty);
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] shadow-xs cursor-pointer flex items-center gap-1 mx-auto"
                        >
                          <span>Reorder {proj.suggestedReplenishmentQty}</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[11px] font-medium text-slate-400">Stock Buffer OK</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
