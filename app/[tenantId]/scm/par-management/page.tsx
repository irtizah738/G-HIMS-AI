'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import {
  PARLocation,
  PARItem,
  StockTransferRequest,
  PARAlert,
} from '@/types/supply-chain';
import {
  getParLocations,
  updateParItemQuantity,
  transferStockBetweenLocations,
  getStockTransfers,
  createStockTransfer,
  subscribeToParLocations,
  subscribeToStockTransfers,
} from '@/lib/firebase/services/supply-chain';
import {
  evaluateParLevels,
  generateAutomatedRequisitions,
  determineItemHealthStatus,
} from '@/lib/supply-chain/par-replenishment';
import { formatCurrency } from '@/lib/utils';
import {
  Layers,
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Minus,
  ArrowRightLeft,
  Truck,
  Building2,
  Package,
  Search,
  Sparkles,
  ShieldAlert,
  Send,
  Check,
  X,
  Boxes,
  Eye,
  Sliders,
  DollarSign,
  TrendingDown,
  Warehouse,
  Flame,
} from 'lucide-react';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function PARManagementPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'metro-health';

  const [locations, setLocations] = useState<PARLocation[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StockTransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<string>('all');

  // Automated Requisition Generation & Transfer Execution State
  const [generatedRequisitions, setGeneratedRequisitions] = useState<StockTransferRequest[]>([]);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferSourceId, setTransferSourceId] = useState('loc-central-warehouse');
  const [transferDestId, setTransferDestId] = useState('');
  const [transferItems, setTransferItems] = useState<
    Array<{ itemId: string; itemName: string; maxAvailable: number; quantity: number }>
  >([]);
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);
  const [quickEditQty, setQuickEditQty] = useState<{ [key: string]: number }>({});
  const [showAutoRequisitionBanner, setShowAutoRequisitionBanner] = useState(true);

  // Live Subscription
  useEffect(() => {
    let unsubLocs: (() => void) | undefined;
    let unsubTransfers: (() => void) | undefined;

    async function init() {
      try {
        setLoading(true);
        const [locData, trData] = await Promise.all([
          getParLocations(tenantId),
          getStockTransfers(tenantId),
        ]);
        setLocations(locData);
        setStockTransfers(trData);

        unsubLocs = subscribeToParLocations(tenantId, (data) => {
          setLocations(data);
        });

        unsubTransfers = subscribeToStockTransfers(tenantId, (data) => {
          setStockTransfers(data);
        });
      } catch (err) {
        console.error('Error loading PAR management data:', err);
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      if (unsubLocs) unsubLocs();
      if (unsubTransfers) unsubTransfers();
    };
  }, [tenantId]);

  // Run PAR Level Evaluation Engine
  const parEvaluation = useMemo(() => {
    return evaluateParLevels(locations);
  }, [locations]);

  // Central warehouse location for source inventory checks
  const centralWarehouse = useMemo(() => {
    return (
      locations.find(
        (l) =>
          l.id === 'loc-central-warehouse' ||
          l.department.toLowerCase().includes('central-warehouse')
      ) || locations[0]
    );
  }, [locations]);

  // Handle Automated Replenishment Run
  const handleRunAutoReplenishment = async () => {
    const requisitions = generateAutomatedRequisitions(
      locations,
      tenantId,
      centralWarehouse?.id || 'loc-central-warehouse',
      centralWarehouse?.name || 'Central Hospital Warehouse & Depository'
    );

    setGeneratedRequisitions(requisitions);

    // Auto-save generated requisitions to Firestore
    for (const req of requisitions) {
      await createStockTransfer(tenantId, req);
    }
  };

  // Quick Quantity Top-Up or Consumption
  const handleAdjustQuantity = async (
    locationId: string,
    itemId: string,
    delta: number
  ) => {
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) return;
    const item = loc.items.find((i) => i.itemId === itemId);
    if (!item) return;

    const newQty = Math.max(0, item.currentQuantity + delta);
    await updateParItemQuantity(tenantId, locationId, itemId, newQty);
  };

  // Open Manual Stock Transfer Modal
  const openTransferModal = (targetLocId?: string) => {
    const target = targetLocId || locations.find((l) => l.id !== centralWarehouse?.id)?.id || '';
    setTransferDestId(target);
    setTransferSourceId(centralWarehouse?.id || 'loc-central-warehouse');

    const destLoc = locations.find((l) => l.id === target);
    if (destLoc && centralWarehouse) {
      const itemsList = destLoc.items.map((it) => {
        const warehouseStock =
          centralWarehouse.items.find((w) => w.itemId === it.itemId)?.currentQuantity || 100;
        const deficit = Math.max(0, it.maxQuantity - it.currentQuantity);
        return {
          itemId: it.itemId,
          itemName: it.itemName,
          maxAvailable: warehouseStock,
          quantity: deficit > 0 ? deficit : 0,
        };
      });
      setTransferItems(itemsList);
    }
    setIsTransferModalOpen(true);
  };

  // Execute Atomic Transfer Between Central Store and Ward PAR
  const handleExecuteTransfer = async (
    transferReqId?: string,
    sourceLocId?: string,
    destLocId?: string,
    customItems?: { itemId: string; quantity: number }[]
  ) => {
    setIsProcessingTransfer(true);
    try {
      const sId = sourceLocId || transferSourceId;
      const dId = destLocId || transferDestId;
      const itemsToMove =
        customItems ||
        transferItems
          .filter((it) => it.quantity > 0)
          .map((it) => ({ itemId: it.itemId, quantity: it.quantity }));

      if (itemsToMove.length === 0) return;

      const tId =
        transferReqId || `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      await transferStockBetweenLocations(
        tenantId,
        tId,
        sId,
        dId,
        itemsToMove,
        'Nurse/SCM Logistics Officer'
      );

      setIsTransferModalOpen(false);
    } catch (err: any) {
      alert(`Transfer failed: ${err.message || 'Unknown stock movement error'}`);
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  // Filtered Locations & Items
  const displayedLocations = useMemo(() => {
    return locations.filter((loc) => {
      if (selectedLocationId !== 'all' && loc.id !== selectedLocationId) return false;
      return true;
    });
  }, [locations, selectedLocationId]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white flex items-center justify-center shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                Clinical PAR Levels & Floor Replenishment
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200">
                SCM Module
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Periodic Automatic Replacement monitoring across ICU, OR Suites, ER Trauma, and Central Store.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            id="btn-run-auto-replenishment"
            onClick={handleRunAutoReplenishment}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer hover:shadow-md"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Run PAR Replenishment Engine</span>
          </button>
          <button
            id="btn-manual-transfer-open"
            onClick={() => openTransferModal()}
            className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-2xs flex items-center gap-2 cursor-pointer"
          >
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            <span>Dispatch Stock Transfer</span>
          </button>
        </div>
      </div>

      {/* KPI Global Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">System-Wide Health</span>
            <span className="p-2 rounded-lg bg-violet-50 text-violet-600">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {parEvaluation.globalStats.systemWideHealthScore}%
            </span>
            <span className="text-[11px] font-bold text-emerald-600">PAR Compliance</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Critical Stock Deficits</span>
            <span className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <Flame className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-rose-600">
              {parEvaluation.globalStats.criticalDeficitAlertsCount} SKUs
            </span>
            <span className="text-[11px] font-bold text-rose-600">Below Floor Min</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Monitored Stock</span>
            <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {formatCurrency(parEvaluation.globalStats.totalStockValue)}
            </span>
            <span className="text-[11px] font-bold text-slate-500">
              {parEvaluation.globalStats.totalSKUsMonitored} SKUs
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Deficit Valuation</span>
            <span className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <TrendingDown className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {formatCurrency(parEvaluation.globalStats.totalDeficitValue)}
            </span>
            <span className="text-[11px] font-bold text-amber-600">To Max PAR</span>
          </div>
        </div>
      </div>

      {/* Critical Deficit Alert Carousel / Banner */}
      {parEvaluation.allAlerts.length > 0 && showAutoRequisitionBanner && (
        <div className="bg-gradient-to-r from-rose-500 to-rose-600 rounded-2xl p-4 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">
                Immediate Clinical Attention: {parEvaluation.allAlerts.length} Stock Deficits Flagged
              </h3>
              <p className="text-xs text-rose-100 mt-0.5">
                {parEvaluation.allAlerts.filter((a) => a.criticalItem).length} items are marked Life-Saving/Critical (e.g. Epinephrine, Chest Tubes, Suture Kits).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRunAutoReplenishment}
              className="px-3.5 py-1.5 bg-white text-rose-700 hover:bg-rose-50 font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Generate Transfer Requisitions
            </button>
            <button
              onClick={() => setShowAutoRequisitionBanner(false)}
              className="p-1.5 text-white/80 hover:text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Pending Internal Stock Transfers Queue */}
      {stockTransfers.some((t) => t.status === 'pending_approval' || t.status === 'dispatched') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-extrabold text-slate-900">
                Pending Internal Replenishment Requisitions ({stockTransfers.filter((t) => t.status !== 'received').length})
              </h3>
            </div>
            <span className="text-xs text-slate-500">Atomic Central Store Dispatch</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stockTransfers
              .filter((t) => t.status !== 'received')
              .map((transfer) => (
                <div
                  key={transfer.id}
                  className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between gap-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-extrabold text-slate-900">
                        {transfer.requisitionNumber}
                      </div>
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        Destination:{' '}
                        <span className="font-bold text-slate-700">
                          {transfer.destinationLocationName}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 uppercase">
                      {transfer.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="border-t border-slate-200/60 pt-2 space-y-1">
                    {transfer.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-[11px] text-slate-600">
                        <span>{item.itemName}</span>
                        <span className="font-extrabold text-slate-900">
                          {item.quantity} {item.unitOfMeasure || 'Units'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                    <span className="text-[10px] text-slate-400">
                      Req by: {transfer.requestedBy}
                    </span>
                    <button
                      onClick={() =>
                        handleExecuteTransfer(
                          transfer.id,
                          transfer.sourceLocationId,
                          transfer.destinationLocationId,
                          transfer.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity }))
                        )
                      }
                      disabled={isProcessingTransfer}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Dispatch & Receive</span>
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Ward Location Selector & Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedLocationId('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              selectedLocationId === 'all'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Clinical Wards ({locations.length})
          </button>
          {locations.map((loc) => {
            const locEval = parEvaluation.evaluations.find((e) => e.locationId === loc.id);
            const hasCritical = (locEval?.criticalCount || 0) > 0;

            return (
              <button
                key={loc.id}
                onClick={() => setSelectedLocationId(loc.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  selectedLocationId === loc.id
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{loc.name.split('(')[0]}</span>
                {hasCritical && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search SKU or item name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-hidden"
          />
        </div>
      </div>

      {/* Detailed PAR Location Cards & Stock Items */}
      <div className="space-y-6">
        {displayedLocations.map((loc) => {
          const evalResult = parEvaluation.evaluations.find((e) => e.locationId === loc.id);
          const filteredItems = loc.items.filter((i) =>
            i.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            i.sku.toLowerCase().includes(searchQuery.toLowerCase())
          );

          return (
            <div
              key={loc.id}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
            >
              {/* Location Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-black text-slate-900 text-base">{loc.name}</h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                      {loc.floor}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Lead: <span className="font-semibold">{loc.managerName}</span> | Contact: {loc.contactExtension}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      PAR Health Score
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-lg font-black ${
                          (evalResult?.healthScorePercent || 100) > 85
                            ? 'text-emerald-600'
                            : (evalResult?.healthScorePercent || 100) > 60
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {evalResult?.healthScorePercent || 100}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => openTransferModal(loc.id)}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Top-Up Ward</span>
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100/60 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Item & SKU</th>
                      <th className="py-3 px-3">Bin Location</th>
                      <th className="py-3 px-3 text-center">Min PAR</th>
                      <th className="py-3 px-3 text-center">Current Stock</th>
                      <th className="py-3 px-3 text-center">Max PAR</th>
                      <th className="py-3 px-3">PAR Gauge</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Quick Adjust</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredItems.map((item) => {
                      const status = determineItemHealthStatus(
                        item.currentQuantity,
                        item.minQuantity,
                        item.maxQuantity,
                        item.reorderPoint
                      );

                      const pct = Math.min(
                        100,
                        Math.round((item.currentQuantity / item.maxQuantity) * 100)
                      );

                      return (
                        <tr key={item.itemId} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-slate-900">{item.itemName}</span>
                              {item.criticalItem && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-100 text-rose-700">
                                  CRITICAL
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              SKU: {item.sku} | UOM: {item.unitOfMeasure}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                            {item.storageBin || 'Shelf A-1'}
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-600">
                            {item.minQuantity}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`text-sm font-black ${
                                status === 'critical'
                                  ? 'text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg'
                                  : status === 'warning'
                                  ? 'text-amber-600'
                                  : 'text-slate-900'
                              }`}
                            >
                              {item.currentQuantity}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-600">
                            {item.maxQuantity}
                          </td>
                          <td className="py-3 px-3 min-w-[120px]">
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  status === 'critical'
                                    ? 'bg-rose-500'
                                    : status === 'warning'
                                    ? 'bg-amber-500'
                                    : status === 'overstocked'
                                    ? 'bg-purple-500'
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-[9px] text-slate-400 text-right mt-0.5 font-bold">
                              {pct}% Capacity
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {status === 'critical' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertTriangle className="w-3 h-3" /> Critical
                              </span>
                            )}
                            {status === 'warning' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-3 h-3" /> Reorder
                              </span>
                            )}
                            {status === 'optimal' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" /> Optimal
                              </span>
                            )}
                            {status === 'overstocked' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                Overstocked
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleAdjustQuantity(loc.id, item.itemId, -1)}
                                className="p-1 rounded bg-slate-100 hover:bg-rose-100 hover:text-rose-700 text-slate-600 transition-colors cursor-pointer"
                                title="Log Consumption (-1)"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleAdjustQuantity(loc.id, item.itemId, 5)}
                                className="p-1 rounded bg-slate-100 hover:bg-emerald-100 hover:text-emerald-700 text-slate-600 transition-colors cursor-pointer text-[10px] font-bold px-1.5"
                                title="Quick Restock (+5)"
                              >
                                +5
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* DISPATCH STOCK TRANSFER MODAL */}
      {/* ==================================================================== */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Dispatch Stock from Central Warehouse
                  </h3>
                  <p className="text-xs text-slate-500">
                    Atomic inventory transfer from Central Storage to Floor PAR station.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Source Inventory</label>
                  <div className="font-semibold text-slate-900 bg-white p-2 rounded-lg border border-slate-200">
                    {centralWarehouse?.name || 'Central Hospital Warehouse'}
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Destination Clinical Ward
                  </label>
                  <select
                    value={transferDestId}
                    onChange={(e) => {
                      setTransferDestId(e.target.value);
                      const dest = locations.find((l) => l.id === e.target.value);
                      if (dest && centralWarehouse) {
                        setTransferItems(
                          dest.items.map((it) => ({
                            itemId: it.itemId,
                            itemName: it.itemName,
                            maxAvailable:
                              centralWarehouse.items.find((w) => w.itemId === it.itemId)
                                ?.currentQuantity || 100,
                            quantity: Math.max(0, it.maxQuantity - it.currentQuantity),
                          }))
                        );
                      }
                    }}
                    className="w-full p-2 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 focus:outline-hidden"
                  >
                    {locations
                      .filter((l) => l.id !== centralWarehouse?.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-2">
                  Items to Transfer
                </span>
                <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <th className="p-2.5">Item Name</th>
                      <th className="p-2.5 text-center">Warehouse Stock</th>
                      <th className="p-2.5 text-right w-32">Transfer Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transferItems.map((item, idx) => (
                      <tr key={item.itemId}>
                        <td className="p-2.5 font-bold text-slate-900">{item.itemName}</td>
                        <td className="p-2.5 text-center font-bold text-slate-600">
                          {item.maxAvailable} units
                        </td>
                        <td className="p-2.5 text-right">
                          <input
                            type="number"
                            min="0"
                            max={item.maxAvailable}
                            value={item.quantity}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setTransferItems((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                              );
                            }}
                            className="w-24 py-1 px-2 rounded-lg bg-slate-50 border border-slate-200 font-black text-center text-slate-900"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessingTransfer}
                onClick={() => handleExecuteTransfer()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
              >
                {isProcessingTransfer ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                )}
                <span>Confirm & Commit Atomic Transaction</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
