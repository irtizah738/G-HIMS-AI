'use client';

import React, { useState, useMemo } from 'react';
import {
  InventoryBalance,
  ItemMaster,
  InventoryLocation,
  StockTransaction,
} from '@/types/scm-domain';
import {
  Sliders,
  Save,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Search,
  Filter,
  RefreshCw,
  TrendingDown,
  Sparkles,
  RotateCcw,
  QrCode,
} from 'lucide-react';

interface ScmParManagementTableProps {
  balances: InventoryBalance[];
  items: ItemMaster[];
  locations: InventoryLocation[];
  transactions: StockTransaction[];
  onSaveParLevel?: (balanceId: string, newMin: number, newReorderPoint: number) => Promise<void>;
  onTriggerReorder?: (item: ItemMaster, suggestedQty: number) => void;
  onOpenQrLabel?: (item: ItemMaster) => void;
}

interface LocalParRowState {
  minimumStock: number;
  reorderPoint: number;
  isModified: boolean;
  isSaving: boolean;
  savedSuccess: boolean;
}

export function ScmParManagementTable({
  balances,
  items,
  locations,
  transactions,
  onSaveParLevel,
  onTriggerReorder,
  onOpenQrLabel,
}: ScmParManagementTableProps) {
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'BELOW_PAR' | 'OPTIMAL'>('ALL');

  // Track modified PAR levels by balanceId
  const [localParMap, setLocalParMap] = useState<Record<string, LocalParRowState>>({});

  // 7-day consumption velocity map
  const dailyBurnMap = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;
    const map = new Map<string, number>();

    transactions
      .filter((tx) => {
        const txTime = new Date(tx.recordedAt || tx.occurredAt).getTime();
        return (
          ['CONSUMPTION', 'ISSUE', 'DISPENSE', 'TRANSFER_OUT'].includes(tx.transactionType) &&
          txTime >= sevenDaysAgo
        );
      })
      .forEach((tx) => {
        const key = `${tx.itemId}_${tx.fromLocationId || 'loc-central'}`;
        map.set(key, (map.get(key) || 0) + (tx.quantity || 0));
        map.set(`${tx.itemId}_ALL`, (map.get(`${tx.itemId}_ALL`) || 0) + (tx.quantity || 0));
      });

    return map;
  }, [transactions]);

  // Handle slider drag
  const handleSliderChange = (balanceId: string, newMin: number) => {
    setLocalParMap((prev) => ({
      ...prev,
      [balanceId]: {
        minimumStock: newMin,
        reorderPoint: Math.round(newMin * 1.2), // Reorder point typically 120% of min stock
        isModified: true,
        isSaving: false,
        savedSuccess: false,
      },
    }));
  };

  // Reset row to original
  const handleResetRow = (balanceId: string, originalMin: number) => {
    setLocalParMap((prev) => {
      const next = { ...prev };
      delete next[balanceId];
      return next;
    });
  };

  // Save specific row
  const handleSaveRow = async (balanceId: string) => {
    const rowState = localParMap[balanceId];
    if (!rowState || !onSaveParLevel) return;

    setLocalParMap((prev) => ({
      ...prev,
      [balanceId]: { ...prev[balanceId], isSaving: true },
    }));

    try {
      await onSaveParLevel(balanceId, rowState.minimumStock, rowState.reorderPoint);
      setLocalParMap((prev) => ({
        ...prev,
        [balanceId]: {
          ...prev[balanceId],
          isModified: false,
          isSaving: false,
          savedSuccess: true,
        },
      }));
      setTimeout(() => {
        setLocalParMap((prev) => {
          if (!prev[balanceId]) return prev;
          return {
            ...prev,
            [balanceId]: { ...prev[balanceId], savedSuccess: false },
          };
        });
      }, 3000);
    } catch {
      setLocalParMap((prev) => ({
        ...prev,
        [balanceId]: { ...prev[balanceId], isSaving: false },
      }));
    }
  };

  // Filtered rows
  const filteredBalances = useMemo(() => {
    return balances.filter((bal) => {
      if (selectedLocation !== 'ALL' && bal.locationId !== selectedLocation) return false;

      const currentMin = localParMap[bal.balanceId]?.minimumStock ?? bal.minimumStock ?? 20;
      const available = bal.available ?? bal.onHand ?? 0;
      const isBelowPar = available < currentMin;

      if (statusFilter === 'BELOW_PAR' && !isBelowPar) return false;
      if (statusFilter === 'OPTIMAL' && isBelowPar) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          bal.itemName.toLowerCase().includes(q) ||
          bal.itemCode.toLowerCase().includes(q) ||
          bal.locationName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [balances, selectedLocation, statusFilter, searchQuery, localParMap]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                PAR Level & Minimum Stock Calibration Table
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dynamically adjust minimum stock reorder thresholds using the interactive sliders. Real-time deficit and burn-rate calculations update instantly.
              </p>
            </div>
          </div>
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter(statusFilter === 'BELOW_PAR' ? 'ALL' : 'BELOW_PAR')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'BELOW_PAR'
                ? 'bg-rose-500 text-white border-rose-600 shadow-xs'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Below PAR Deficit</span>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'OPTIMAL' ? 'ALL' : 'OPTIMAL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'OPTIMAL'
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Optimal Buffer</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search item, code, location..."
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

      {/* Table with Interactive Range Sliders */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="p-3">Item & Ward Location</th>
              <th className="p-3 text-right">Available Stock</th>
              <th className="p-3 w-80">Dynamic Minimum Stock (PAR) Slider</th>
              <th className="p-3 text-center">Buffer Status</th>
              <th className="p-3 text-center">Estimated Runout</th>
              <th className="p-3 text-center">Save / Reorder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredBalances.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No inventory balances match the selected criteria.
                </td>
              </tr>
            ) : (
              filteredBalances.map((bal) => {
                const itm = items.find((i) => i.itemId === bal.itemId);
                const currentMin =
                  localParMap[bal.balanceId]?.minimumStock ?? bal.minimumStock ?? 20;
                const isModified = localParMap[bal.balanceId]?.isModified ?? false;
                const isSaving = localParMap[bal.balanceId]?.isSaving ?? false;
                const savedSuccess = localParMap[bal.balanceId]?.savedSuccess ?? false;

                const available = Math.max(0, bal.available ?? bal.onHand ?? 0);
                const deficit = Math.max(0, currentMin - available);
                const isBelowPar = available < currentMin;
                const isNearPar = !isBelowPar && available < currentMin * 1.25;

                // Slider max bounds
                const sliderMax = Math.max(100, Math.round(Math.max(currentMin * 2, available * 1.5)));

                // 7-day burn rate
                const recorded7Day =
                  dailyBurnMap.get(`${bal.itemId}_${bal.locationId}`) ??
                  dailyBurnMap.get(`${bal.itemId}_ALL`) ??
                  0;
                const dailyBurn = recorded7Day > 0 ? Number((recorded7Day / 7).toFixed(1)) : 3;
                const daysLeft = dailyBurn > 0 ? Math.round(available / dailyBurn) : 99;

                return (
                  <tr
                    key={bal.balanceId}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                      isBelowPar
                        ? 'bg-rose-50/40 dark:bg-rose-950/20 border-l-4 border-l-rose-500'
                        : isModified
                        ? 'bg-blue-50/30 dark:bg-blue-950/20'
                        : ''
                    }`}
                  >
                    {/* Item Info */}
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {isBelowPar && (
                          <span className="relative flex h-2 w-2 shrink-0" title="Critical: Below Minimum PAR Level">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                          </span>
                        )}
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {bal.itemName}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {bal.itemCode}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                        <Layers className="w-3 h-3 text-slate-400" />
                        <span>{bal.locationName}</span>
                        <span>•</span>
                        <span>Max PAR: {bal.maximumStock || currentMin * 2} {bal.uom}</span>
                      </div>
                    </td>

                    {/* Current Available Stock */}
                    <td className="p-3 text-right">
                      <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {available}
                      </div>
                      <div className="text-[10px] text-slate-400">{bal.uom} on hand</div>
                    </td>

                    {/* Dynamic Range Slider Column */}
                    <td className="p-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 font-medium">
                            Target Min Reorder Point:
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-xs font-extrabold px-2 py-0.5 rounded ${
                                isModified
                                  ? 'bg-blue-600 text-white shadow-xs'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {currentMin} {bal.uom}
                            </span>
                            {isModified && (
                              <button
                                onClick={() => handleResetRow(bal.balanceId, bal.minimumStock || 20)}
                                title="Reset to original PAR"
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Interactive Range Slider */}
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-400 font-mono">0</span>
                          <input
                            type="range"
                            min="0"
                            max={sliderMax}
                            step="5"
                            value={currentMin}
                            onChange={(e) =>
                              handleSliderChange(bal.balanceId, parseInt(e.target.value, 10))
                            }
                            className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-hidden"
                          />
                          <span className="text-[10px] text-slate-400 font-mono">{sliderMax}</span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Auto Reorder Point: {Math.round(currentMin * 1.2)} {bal.uom}</span>
                          {isModified && (
                            <span className="text-blue-600 dark:text-blue-400 font-semibold animate-pulse">
                              Pending Save
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Buffer Status */}
                    <td className="p-3 text-center">
                      {isBelowPar ? (
                        <div className="inline-flex flex-col items-center px-2.5 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 animate-pulse ring-2 ring-rose-400/30">
                          <span className="text-[10px] font-extrabold uppercase flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-rose-500" />
                            Below PAR
                          </span>
                          <span className="font-mono text-[11px] font-bold">
                            Deficit: -{deficit} {bal.uom}
                          </span>
                        </div>
                      ) : isNearPar ? (
                        <div className="inline-flex flex-col items-center px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300">
                          <span className="text-[10px] font-extrabold uppercase">Near Buffer</span>
                          <span className="font-mono text-[11px]">+{available - currentMin} margin</span>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
                          <span className="text-[10px] font-extrabold uppercase flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            Optimal
                          </span>
                          <span className="font-mono text-[11px]">
                            {Math.round((available / Math.max(1, currentMin)) * 100)}% PAR
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Linear Runout Estimate */}
                    <td className="p-3 text-center">
                      <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {daysLeft > 60 ? '60+ days' : `${daysLeft} days`}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {dailyBurn} {bal.uom}/day burn
                      </div>
                    </td>

                    {/* Actions: Save PAR, Trigger Replenish, or QR Label */}
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {onOpenQrLabel && itm && (
                          <button
                            type="button"
                            onClick={() => onOpenQrLabel(itm)}
                            title={`Generate & Print Standardized QR Label for ${bal.itemName}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" />
                          </button>
                        )}
                        {isModified ? (
                          <button
                            onClick={() => handleSaveRow(bal.balanceId)}
                            disabled={isSaving}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 shadow-xs cursor-pointer transition-colors"
                          >
                            <Save className={`w-3 h-3 ${isSaving ? 'animate-spin' : ''}`} />
                            <span>{isSaving ? 'Saving...' : 'Save'}</span>
                          </button>
                        ) : savedSuccess ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Saved
                          </span>
                        ) : isBelowPar && onTriggerReorder && itm ? (
                          <button
                            onClick={() => onTriggerReorder(itm, deficit)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 text-xs font-semibold border border-rose-200 dark:border-rose-900 cursor-pointer animate-pulse"
                          >
                            Reorder {deficit}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">In Sync</span>
                        )}
                      </div>
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
