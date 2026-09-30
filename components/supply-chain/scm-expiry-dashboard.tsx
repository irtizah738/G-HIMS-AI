'use client';

import React, { useState, useMemo } from 'react';
import {
  ItemMaster,
  BatchLotRecord,
  InventoryBalance,
  InventoryLocation,
  StockTransaction,
} from '@/types/scm-domain';
import {
  allocateFefoBatches,
  categorizeExpiry,
  FEFOAllocationResult,
  ExpiryAlertCategory,
} from '@/lib/supply-chain/scm-engine';
import { quarantineBatchRecord } from '@/lib/firebase/services/scm-firestore-service';
import { recordStockTransactionEdge } from '@/lib/supply-chain/scm-edge-adapter';
import {
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  Package,
  Layers,
  ThermometerSnowflake,
  Filter,
  Search,
  Sparkles,
  Calendar,
  DollarSign,
  Activity,
  Boxes,
} from 'lucide-react';

interface ScmExpiryDashboardProps {
  tenantId: string;
  items: ItemMaster[];
  batches: BatchLotRecord[];
  balances: InventoryBalance[];
  locations: InventoryLocation[];
  onRefresh: () => Promise<void>;
}

export function ScmExpiryDashboard({
  tenantId,
  items,
  batches,
  balances,
  locations,
  onRefresh,
}: ScmExpiryDashboardProps) {
  // Threshold & Filter State
  const [thresholdDays, setThresholdDays] = useState<number>(30);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // FEFO Issuance Engine Sandbox State
  const [fefoItemId, setFefoItemId] = useState<string>(items[0]?.itemId || '');
  const [fefoQuantity, setFefoQuantity] = useState<number>(10);
  const [fefoDestination, setFefoDestination] = useState<string>('ICU Emergency Stockroom');
  const [fefoReason, setFefoReason] = useState<string>('EMERGENCY_REPLENISHMENT');

  // Categorize All Batches
  const categorizedBatches = useMemo(() => {
    return batches.map((b) => {
      const catInfo = categorizeExpiry(b.expiryDate);
      const item = items.find((it) => it.itemId === b.itemId);
      return {
        ...b,
        categoryInfo: catInfo,
        itemDetail: item,
        financialValue: Math.round((b.quantityRemaining || 0) * (b.unitCost || item?.unitCost || 0) * 100) / 100,
      };
    });
  }, [batches, items]);

  // Aggregate Metrics based on configurable threshold
  const metrics = useMemo(() => {
    const expired = categorizedBatches.filter((b) => b.categoryInfo.category === 'EXPIRED');
    const expiringToday = categorizedBatches.filter((b) => b.categoryInfo.category === 'EXPIRING_TODAY');
    const expiringIn30 = categorizedBatches.filter((b) => b.categoryInfo.category === 'EXPIRING_30_DAYS');
    const expiringWithinCustomThreshold = categorizedBatches.filter(
      (b) => b.categoryInfo.daysRemaining >= 0 && b.categoryInfo.daysRemaining <= thresholdDays && b.quantityRemaining > 0
    );
    const safeStock = categorizedBatches.filter((b) => b.categoryInfo.daysRemaining > thresholdDays);

    const totalAtRiskValuation = expiringWithinCustomThreshold.reduce((sum, b) => sum + b.financialValue, 0);
    const totalExpiredValuation = expired.reduce((sum, b) => sum + b.financialValue, 0);

    return {
      expiredCount: expired.length,
      expiredUnits: expired.reduce((sum, b) => sum + b.quantityRemaining, 0),
      expiredValuation: totalExpiredValuation,
      todayCount: expiringToday.length,
      todayUnits: expiringToday.reduce((sum, b) => sum + b.quantityRemaining, 0),
      next30Count: expiringIn30.length,
      next30Units: expiringIn30.reduce((sum, b) => sum + b.quantityRemaining, 0),
      customThresholdCount: expiringWithinCustomThreshold.length,
      customThresholdUnits: expiringWithinCustomThreshold.reduce((sum, b) => sum + b.quantityRemaining, 0),
      totalAtRiskValuation,
      safeStockCount: safeStock.length,
    };
  }, [categorizedBatches, thresholdDays]);

  // Filtered Batches for Table
  const filteredBatches = useMemo(() => {
    return categorizedBatches.filter((b) => {
      const matchesSearch =
        b.batchNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.manufacturer || '').toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        categoryFilter === 'ALL' ||
        (categoryFilter === 'EXPIRED' && b.categoryInfo.category === 'EXPIRED') ||
        (categoryFilter === 'EXPIRING_TODAY' && b.categoryInfo.category === 'EXPIRING_TODAY') ||
        (categoryFilter === 'EXPIRING_30_DAYS' && b.categoryInfo.category === 'EXPIRING_30_DAYS') ||
        (categoryFilter === 'EXPIRING_THRESHOLD' && b.categoryInfo.daysRemaining <= thresholdDays && b.categoryInfo.daysRemaining >= 0) ||
        (categoryFilter === 'SAFE' && b.categoryInfo.daysRemaining > thresholdDays);

      return matchesSearch && matchesCategory;
    });
  }, [categorizedBatches, searchQuery, categoryFilter, thresholdDays]);

  // Selected Item for FEFO Sandbox
  const selectedFefoItem = useMemo(() => {
    return items.find((i) => i.itemId === fefoItemId) || items[0];
  }, [items, fefoItemId]);

  // Live FEFO Allocation Preview
  const fefoAllocationPreview: FEFOAllocationResult = useMemo(() => {
    if (!selectedFefoItem) {
      return {
        allocations: [],
        fulfilledQty: 0,
        unfulfilledQty: fefoQuantity,
        isFullyFulfilled: false,
        warnings: ['Select an item to simulate FEFO allocation.'],
      };
    }
    const itemBatches = batches.filter(
      (b) => b.itemId === selectedFefoItem.itemId && b.status === 'AVAILABLE' && b.quantityRemaining > 0
    );
    return allocateFefoBatches(itemBatches, fefoQuantity);
  }, [batches, selectedFefoItem, fefoQuantity]);

  // Quarantine Batch Action Handler
  const handleQuarantineBatch = async (batchId: string, batchNumber: string) => {
    if (!confirm(`Confirm immediate quarantine of batch ${batchNumber}? This locks the lot from all dispensing.`)) {
      return;
    }
    setActionLoading(true);
    try {
      await quarantineBatchRecord(
        tenantId,
        batchId,
        'MANDATORY EXPIRY / SHELF-LIFE BREACH: Quarantined by SCM Expiry Engine',
        {
          userId: 'usr_scm_expiry_officer',
          userName: 'Clinical SCM Expiry Officer',
          role: 'Supply Chain Specialist',
        }
      );
      setStatusMessage({
        type: 'success',
        text: `Batch ${batchNumber} successfully quarantined and locked from clinical dispensing.`,
      });
      await onRefresh();
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to quarantine batch.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Execute FEFO Stock Issuance
  const handleExecuteFefoIssuance = async () => {
    if (!selectedFefoItem || fefoAllocationPreview.allocations.length === 0) {
      setStatusMessage({ type: 'error', text: 'No viable batches available to issue!' });
      return;
    }
    setActionLoading(true);
    try {
      for (const alloc of fefoAllocationPreview.allocations) {
        const txnId = `txn_fefo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await recordStockTransactionEdge({
          transactionId: txnId,
          tenantId,
          facilityId: 'FAC-MAIN',
          itemId: selectedFefoItem.itemId,
          itemCode: selectedFefoItem.itemCode,
          itemName: selectedFefoItem.name,
          batchId: alloc.batchId,
          batchNumber: alloc.batchNumber,
          manufactureDate: alloc.manufactureDate,
          expirationDate: alloc.expiryDate,
          fromLocationId: 'loc-pharmacy-main',
          fromLocationName: 'Inpatient Central Pharmacy',
          toLocationId: 'loc-icu-hub',
          toLocationName: fefoDestination,
          quantity: alloc.allocatedQty,
          uom: selectedFefoItem.unitOfMeasure,
          normalizedQuantity: alloc.allocatedQty,
          unitCost: selectedFefoItem.unitCost,
          totalCost: selectedFefoItem.unitCost * alloc.allocatedQty,
          currency: 'USD',
          transactionType: 'ISSUE',
          referenceType: 'INTERNAL_REQUEST',
          referenceId: `FEFO-${Date.now().toString().slice(-6)}`,
          reasonCode: fefoReason,
          performedBy: {
            userId: 'usr_fefo_pharmacist',
            userName: 'Duty FEFO Pharmacist',
            role: 'Clinical Pharmacist',
          },
          authorizedBy: {
            userId: 'usr_chief_pharmacist',
            userName: 'Chief Pharmacy Officer',
            role: 'Director of Pharmacy',
          },
          occurredAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          idempotencyKey: `idemp_${txnId}`,
          source: 'ONLINE',
        });
      }

      setStatusMessage({
        type: 'success',
        text: `FEFO issuance completed! Issued ${fefoAllocationPreview.fulfilledQty} ${selectedFefoItem.unitOfMeasure} of ${selectedFefoItem.name} across ${fefoAllocationPreview.allocations.length} prioritized lot(s).`,
      });
      await onRefresh();
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error executing FEFO issuance.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Feedback Toast */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Threshold Configuration & Top Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-200 dark:border-amber-900">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                SCM Expiry & FEFO Intelligence Hub
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold font-mono">
                  Algorithm Active
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Continuous surveillance of shelf-life horizons, automated risk alerts, and algorithmic First-Expiry-First-Out dispensing.
              </p>
            </div>
          </div>
        </div>

        {/* Configurable Threshold Slider & Selector */}
        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
            <Filter className="w-3.5 h-3.5 text-blue-500" />
            Alert Threshold:
          </label>
          <div className="flex items-center gap-1">
            {[15, 30, 60, 90].map((days) => (
              <button
                key={days}
                id={`btn-threshold-${days}`}
                onClick={() => setThresholdDays(days)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  thresholdDays === days
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Expiry Risk Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        {/* Expired */}
        <div
          onClick={() => setCategoryFilter(categoryFilter === 'EXPIRED' ? 'ALL' : 'EXPIRED')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            categoryFilter === 'EXPIRED'
              ? 'ring-2 ring-rose-500 bg-rose-50/80 dark:bg-rose-950/40 border-rose-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> Expired Stock
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-mono">
              &lt;0 Days
            </span>
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2">
            {metrics.expiredCount} <span className="text-xs font-normal text-slate-500">lots</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {metrics.expiredUnits} units (${metrics.expiredValuation.toLocaleString()})
          </p>
        </div>

        {/* Expiring Today */}
        <div
          onClick={() => setCategoryFilter(categoryFilter === 'EXPIRING_TODAY' ? 'ALL' : 'EXPIRING_TODAY')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            categoryFilter === 'EXPIRING_TODAY'
              ? 'ring-2 ring-red-500 bg-red-50/80 dark:bg-red-950/40 border-red-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-red-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> Expiring Today
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 font-mono">
              0 Days
            </span>
          </div>
          <div className="text-2xl font-black text-red-600 dark:text-red-400 mt-2">
            {metrics.todayCount} <span className="text-xs font-normal text-slate-500">lots</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {metrics.todayUnits} units
          </p>
        </div>

        {/* Expiring Next 30 Days */}
        <div
          onClick={() => setCategoryFilter(categoryFilter === 'EXPIRING_30_DAYS' ? 'ALL' : 'EXPIRING_30_DAYS')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            categoryFilter === 'EXPIRING_30_DAYS'
              ? 'ring-2 ring-amber-500 bg-amber-50/80 dark:bg-amber-950/40 border-amber-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Next 30 Days
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-mono">
              FEFO Priority
            </span>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-2">
            {metrics.next30Count} <span className="text-xs font-normal text-slate-500">lots</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {metrics.next30Units} units
          </p>
        </div>

        {/* Within Custom Threshold */}
        <div
          onClick={() => setCategoryFilter(categoryFilter === 'EXPIRING_THRESHOLD' ? 'ALL' : 'EXPIRING_THRESHOLD')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            categoryFilter === 'EXPIRING_THRESHOLD'
              ? 'ring-2 ring-blue-500 bg-blue-50/80 dark:bg-blue-950/40 border-blue-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" /> &le;{thresholdDays}d Threshold
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono">
              Configured
            </span>
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">
            {metrics.customThresholdCount} <span className="text-xs font-normal text-slate-500">lots</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {metrics.customThresholdUnits} units
          </p>
        </div>

        {/* Total Financial Risk Exposure */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-500" /> Value at Expiry Risk
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
              &le;{thresholdDays} Days
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-2">
            ${metrics.totalAtRiskValuation.toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
            Surveillance active
          </p>
        </div>
      </div>

      {/* Automated Expiry Alerts Banner */}
      {metrics.expiredCount > 0 || metrics.next30Count > 0 ? (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                Automated Clinical Expiry Alert
              </h4>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                {metrics.expiredCount > 0 && `${metrics.expiredCount} lot(s) have passed expiry date and require mandatory quarantine. `}
                {metrics.next30Count > 0 && `${metrics.next30Count} lot(s) are expiring within 30 days. Priority FEFO routing recommended to prevent inventory write-off.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCategoryFilter('EXPIRING_30_DAYS')}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-xs"
            >
              Filter FEFO Priorities
            </button>
          </div>
        </div>
      ) : null}

      {/* Two-Column Workspace: Left = Batch Expiry Ledger, Right = Interactive FEFO Engine Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Columns: Categorized Batches & Expiry Surveillance Table */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-blue-500" />
                  Lot & Batch Expiry Ledger
                </h3>
                <p className="text-xs text-slate-400">
                  Showing {filteredBatches.length} of {batches.length} batches across all locations
                </p>
              </div>

              {/* Search input & Filter reset */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search batch, item..."
                    className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {categoryFilter !== 'ALL' && (
                  <button
                    onClick={() => setCategoryFilter('ALL')}
                    className="text-xs text-blue-600 hover:underline cursor-pointer whitespace-nowrap font-medium"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-2.5">Batch / Lot</th>
                    <th className="p-2.5">Item & Manufacturer</th>
                    <th className="p-2.5">Mfg Date</th>
                    <th className="p-2.5">Expiry Date</th>
                    <th className="p-2.5">Shelf Status</th>
                    <th className="p-2.5 text-right">Qty Left</th>
                    <th className="p-2.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredBatches.map((b) => {
                    const isExpired = b.categoryInfo.category === 'EXPIRED';
                    const isQuarantined = b.status === 'QUARANTINED';
                    return (
                      <tr
                        key={b.batchId}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                          isExpired ? 'bg-rose-50/30 dark:bg-rose-950/20' : ''
                        }`}
                      >
                        <td className="p-2.5">
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {b.batchNumber}
                          </span>
                          {b.categoryInfo.isFefoPriority && (
                            <div className="text-[10px] text-amber-600 font-semibold">
                              ★ FEFO Priority
                            </div>
                          )}
                        </td>
                        <td className="p-2.5">
                          <div className="font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                            {b.itemName}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {b.manufacturer || 'Certified Vendor'} • {b.itemCode}
                          </div>
                        </td>
                        <td className="p-2.5 font-mono text-[11px] text-slate-500">
                          {b.manufactureDate ? b.manufactureDate.split('T')[0] : '—'}
                        </td>
                        <td className="p-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {b.expiryDate.split('T')[0]}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] border ${b.categoryInfo.badgeStyle}`}
                          >
                            {b.categoryInfo.daysRemaining < 0
                              ? `Expired (${Math.abs(b.categoryInfo.daysRemaining)}d ago)`
                              : b.categoryInfo.daysRemaining === 0
                              ? 'Expiring Today'
                              : `${b.categoryInfo.daysRemaining} days remaining`}
                          </span>
                          {b.temperatureExcursionDetected && (
                            <span className="ml-1 text-[10px] text-rose-600 font-bold">
                              [Temp Alert]
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-right font-bold text-slate-900 dark:text-slate-100">
                          {b.quantityRemaining}
                        </td>
                        <td className="p-2.5 text-center">
                          {isQuarantined ? (
                            <span className="text-[10px] font-bold text-rose-600 px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950">
                              QUARANTINED
                            </span>
                          ) : isExpired ? (
                            <button
                              disabled={actionLoading}
                              onClick={() => handleQuarantineBatch(b.batchId, b.batchNumber)}
                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold cursor-pointer"
                            >
                              Quarantine
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setFefoItemId(b.itemId);
                              }}
                              className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[10px] font-semibold cursor-pointer border border-blue-200 dark:border-blue-800"
                            >
                              FEFO Test
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Interactive FEFO Algorithmic Allocation Sandbox */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  FEFO Algorithmic Allocation Engine
                </h3>
                <p className="text-xs text-slate-400">
                  Deterministic simulation & execution of stock issuance by earliest expiry
                </p>
              </div>
            </div>

            {/* Input Controls */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Target Medication / Medical Item:
                </label>
                <select
                  value={fefoItemId}
                  onChange={(e) => setFefoItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {items.map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {it.name} ({it.itemCode}) — {it.unitOfMeasure}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Requested Quantity:
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={fefoQuantity}
                    onChange={(e) => setFefoQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Destination Ward:
                  </label>
                  <input
                    type="text"
                    value={fefoDestination}
                    onChange={(e) => setFefoDestination(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Clinical Movement Reason Code:
                </label>
                <select
                  value={fefoReason}
                  onChange={(e) => setFefoReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  <option value="EMERGENCY_REPLENISHMENT">EMERGENCY_REPLENISHMENT — STAT Ward Restock</option>
                  <option value="SCHEDULED_DOSING">SCHEDULED_DOSING — Routine Inpatient Round</option>
                  <option value="OT_SURGICAL_PREP">OT_SURGICAL_PREP — Sterile Tray Preparation</option>
                  <option value="FEFO_STOCK_ROTATION">FEFO_STOCK_ROTATION — Preventative Shelf Rotation</option>
                </select>
              </div>
            </div>

            {/* FEFO Algorithm Result Card */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Algorithmic Allocation Result:
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                    fefoAllocationPreview.isFullyFulfilled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  {fefoAllocationPreview.fulfilledQty} of {fefoQuantity} Allocated
                </span>
              </div>

              {/* Warning Messages */}
              {fefoAllocationPreview.warnings.length > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300 mb-3 space-y-1">
                  {fefoAllocationPreview.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Allocated Batch Sequence */}
              <div className="space-y-2">
                {fefoAllocationPreview.allocations.map((alloc, idx) => (
                  <div
                    key={alloc.batchId}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-[10px] font-bold flex items-center justify-center">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-slate-900 dark:text-slate-100">
                          {alloc.batchNumber}
                        </span>
                      </div>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        +{alloc.allocatedQty} {selectedFefoItem?.unitOfMeasure}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500">
                      <div>
                        Mfg: <span className="font-mono text-slate-700 dark:text-slate-300">{alloc.manufactureDate ? alloc.manufactureDate.split('T')[0] : 'N/A'}</span>
                      </div>
                      <div className="text-right">
                        Exp: <span className="font-mono text-amber-600 font-semibold">{alloc.expiryDate.split('T')[0]} ({alloc.daysUntilExpiry}d)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Execute Stock Issue Button */}
              <button
                id="btn-execute-fefo-issuance"
                disabled={actionLoading || fefoAllocationPreview.allocations.length === 0}
                onClick={handleExecuteFefoIssuance}
                className="w-full mt-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
              >
                <ArrowRight className="w-4 h-4" />
                {actionLoading ? 'Executing Transaction...' : `Execute FEFO Stock Issuance (${fefoAllocationPreview.fulfilledQty} Units)`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
