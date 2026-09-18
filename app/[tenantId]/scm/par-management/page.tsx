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
  recordParBreachNotifications,
} from '@/lib/firebase/services/supply-chain';
import {
  evaluateParLevels,
  generateAutomatedRequisitions,
  determineItemHealthStatus,
  runAutomatedParCheck,
  AutomatedParCheckResult,
  AutomatedParNotification,
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
  Bell,
  Volume2,
  VolumeX,
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

  // Automated PAR Health & Min-Quantity Breach Detection State
  const [isScanningPar, setIsScanningPar] = useState(false);
  const [lastCheckTimestamp, setLastCheckTimestamp] = useState<string | null>(null);
  const [activeBreachNotifications, setActiveBreachNotifications] = useState<AutomatedParNotification[]>([]);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState(false);
  const [activeToasts, setActiveToasts] = useState<AutomatedParNotification[]>([]);
  const [filterBelowMinOnly, setFilterBelowMinOnly] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

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

  // Run Automated Check against all location-based PAR items to flag below-min reorder points
  const autoCheckResult = useMemo<AutomatedParCheckResult>(() => {
    return runAutomatedParCheck(locations);
  }, [locations]);

  // Audio synthesizer chime for clinical PAR breaches
  const playBreachChime = () => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Ignore audio restriction fallback
    }
  };

  // Explicit Automated Check trigger: flags below-min items, plays chime, records notifications
  const handleTriggerAutomatedCheck = async () => {
    setIsScanningPar(true);
    const result = runAutomatedParCheck(locations);
    setActiveBreachNotifications(result.notifications);
    setLastCheckTimestamp(new Date().toLocaleTimeString());

    if (result.belowMinCount > 0) {
      playBreachChime();
      setActiveToasts(result.notifications.slice(0, 3));
      setTimeout(() => {
        setActiveToasts([]);
      }, 6500);
      try {
        await recordParBreachNotifications(tenantId, result.notifications);
      } catch (e) {
        console.warn('Failed to persist automated PAR breach notifications:', e);
      }
    }

    setTimeout(() => {
      setIsScanningPar(false);
    }, 600);
  };

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
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="btn-sound-toggle"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors cursor-pointer"
            title={soundEnabled ? 'Mute alert sounds' : 'Enable alert sounds'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-indigo-600" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
          </button>

          <button
            id="btn-notifications-drawer-open"
            onClick={() => setIsNotificationDrawerOpen(true)}
            className="relative px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 flex items-center gap-2 cursor-pointer transition-all shadow-2xs"
          >
            <Bell className="w-4 h-4 text-rose-600" />
            <span>Breach Alerts</span>
            {autoCheckResult.belowMinCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white animate-pulse">
                {autoCheckResult.belowMinCount}
              </span>
            )}
          </button>

          <button
            id="btn-run-automated-par-check"
            onClick={handleTriggerAutomatedCheck}
            disabled={isScanningPar}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer hover:shadow-md disabled:opacity-75"
          >
            <RefreshCw className={`w-4 h-4 text-amber-300 ${isScanningPar ? 'animate-spin' : ''}`} />
            <span>{isScanningPar ? 'Scanning Location Stocks...' : 'Run Automated PAR Check'}</span>
          </button>

          <button
            id="btn-run-auto-replenishment"
            onClick={handleRunAutoReplenishment}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer hover:shadow-md"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Auto-Replenish Wards</span>
          </button>

          <button
            id="btn-manual-transfer-open"
            onClick={() => openTransferModal()}
            className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-2xs flex items-center gap-2 cursor-pointer"
          >
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            <span>Transfer Stock</span>
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

      {/* Automated Stock Deficit Alert Banner */}
      {autoCheckResult.belowMinCount > 0 && (
        <div className="bg-gradient-to-r from-rose-600 via-rose-700 to-red-800 text-white p-4 sm:p-5 rounded-2xl shadow-md border border-rose-500/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-white/10 text-white shrink-0">
              <Flame className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-sm uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded text-[10px]">
                  Autonomous Check Active
                </span>
                <span className="text-xs text-rose-100 font-mono">
                  {lastCheckTimestamp ? `Last check: ${lastCheckTimestamp}` : 'Continuous Floor Monitoring'}
                </span>
              </div>
              <h4 className="font-extrabold text-base text-white mt-1">
                {autoCheckResult.belowMinCount} Location Items Falling Below &apos;minQuantity&apos; Reorder Point
              </h4>
              <p className="text-xs text-rose-100/90 mt-0.5">
                Total Deficit: <span className="font-bold text-white">{autoCheckResult.totalShortfallUnits} units</span> | Estimated Replenishment Value:{' '}
                <span className="font-bold text-white">${autoCheckResult.totalDeficitCost.toLocaleString()}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
            <button
              onClick={() => setFilterBelowMinOnly(!filterBelowMinOnly)}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs ${
                filterBelowMinOnly
                  ? 'bg-white text-rose-700'
                  : 'bg-white/20 hover:bg-white/30 text-white border border-white/30'
              }`}
            >
              {filterBelowMinOnly ? 'Show All SKUs' : `Filter Below Min (${autoCheckResult.belowMinCount})`}
            </button>
            <button
              onClick={() => setIsNotificationDrawerOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-rose-900 hover:bg-rose-50 transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5 text-rose-700" />
              <span>Breach Alerts Feed</span>
            </button>
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

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setFilterBelowMinOnly(!filterBelowMinOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 border ${
              filterBelowMinOnly
                ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Below Min ({autoCheckResult.belowMinCount})</span>
          </button>

          <div className="relative w-full sm:w-60">
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
      </div>

      {/* Detailed PAR Location Cards & Stock Items */}
      <div className="space-y-6">
        {displayedLocations.map((loc) => {
          const evalResult = parEvaluation.evaluations.find((e) => e.locationId === loc.id);
          const filteredItems = loc.items.filter((i) => {
            const matchesSearch =
              i.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
              i.sku.toLowerCase().includes(searchQuery.toLowerCase());
            if (!matchesSearch) return false;
            if (filterBelowMinOnly) {
              return i.currentQuantity < i.minQuantity;
            }
            return true;
          });

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

                      const isBelowMin = item.currentQuantity < item.minQuantity;
                      const shortfall = Math.max(0, item.minQuantity - item.currentQuantity);
                      const isNearReorder = !isBelowMin && item.currentQuantity <= item.reorderPoint;

                      const pct = Math.min(
                        100,
                        Math.round((item.currentQuantity / item.maxQuantity) * 100)
                      );

                      return (
                        <tr
                          key={item.itemId}
                          className={`transition-colors ${
                            isBelowMin
                              ? 'bg-rose-50/90 dark:bg-rose-950/25 border-l-4 border-l-rose-600 font-semibold'
                              : isNearReorder
                              ? 'bg-amber-50/60 dark:bg-amber-950/15 border-l-4 border-l-amber-500'
                              : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-extrabold text-slate-900">{item.itemName}</span>
                              {item.criticalItem && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-100 text-rose-700">
                                  CRITICAL
                                </span>
                              )}
                              {isBelowMin && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-600 text-white shadow-2xs animate-pulse">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-200" /> BELOW MIN PAR
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
                                isBelowMin
                                  ? 'text-rose-700 bg-rose-100 px-2 py-0.5 rounded-lg inline-block'
                                  : status === 'critical'
                                  ? 'text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg'
                                  : status === 'warning'
                                  ? 'text-amber-600'
                                  : 'text-slate-900'
                              }`}
                            >
                              {item.currentQuantity}
                            </span>
                            {isBelowMin && (
                              <div className="text-[10px] font-extrabold text-rose-700 bg-rose-200/70 px-1.5 py-0.2 rounded mt-0.5">
                                Deficit: -{shortfall}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-600">
                            {item.maxQuantity}
                          </td>
                          <td className="py-3 px-3 min-w-[120px]">
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  isBelowMin || status === 'critical'
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
                            {isBelowMin ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-2xs animate-pulse">
                                <AlertTriangle className="w-3 h-3 text-amber-200" /> Below Min
                              </span>
                            ) : status === 'critical' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertTriangle className="w-3 h-3" /> Critical
                              </span>
                            ) : status === 'warning' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-3 h-3" /> Reorder
                              </span>
                            ) : status === 'optimal' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" /> Optimal
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                Overstocked
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isBelowMin && (
                                <button
                                  onClick={() =>
                                    handleAdjustQuantity(
                                      loc.id,
                                      item.itemId,
                                      Math.max(1, item.maxQuantity - item.currentQuantity)
                                    )
                                  }
                                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black cursor-pointer shadow-2xs transition-colors flex items-center gap-1 whitespace-nowrap"
                                  title="Replenish item to maximum target PAR level"
                                >
                                  <Sparkles className="w-2.5 h-2.5 text-amber-200" />
                                  <span>Top-Up</span>
                                </button>
                              )}
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

      {/* ==================================================================== */}
      {/* BREACH NOTIFICATIONS DRAWER / MODAL */}
      {/* ==================================================================== */}
      {isNotificationDrawerOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-end p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-xl h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-200 bg-rose-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-600 text-white">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Automated PAR Breach Notifications
                  </h3>
                  <p className="text-xs text-rose-700 font-medium">
                    {autoCheckResult.notifications.length} Floor SKUs Currently Below Min Reorder Point
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsNotificationDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-rose-100 text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-3 divide-y divide-slate-100">
              {autoCheckResult.notifications.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800">All PAR Locations Healthy</p>
                  <p className="text-xs text-slate-400">No items are currently below minimum reorder points.</p>
                </div>
              ) : (
                autoCheckResult.notifications.map((notif, idx) => (
                  <div key={idx} className="pt-3 first:pt-0 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                              notif.urgency === 'CRITICAL'
                                ? 'bg-rose-600 text-white'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {notif.urgency}
                          </span>
                          <span className="font-extrabold text-slate-900 text-xs">
                            {notif.itemName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Location: <span className="font-bold text-slate-700">{notif.locationName}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 font-medium">
                      {notif.message}
                    </p>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-bold text-rose-600">
                          Current: {notif.currentQuantity} (Min: {notif.minQuantity})
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="font-extrabold text-slate-700">
                          Deficit: -{notif.shortfall} units
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const loc = locations.find((l) => l.id === notif.locationId);
                          const it = loc?.items.find((i) => i.itemId === notif.itemId);
                          if (it) {
                            handleAdjustQuantity(notif.locationId, notif.itemId, Math.max(1, it.maxQuantity - it.currentQuantity));
                          }
                        }}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                      >
                        <Sparkles className="w-3 h-3 text-amber-200" />
                        <span>Top-Up Item</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={handleTriggerAutomatedCheck}
                className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
                <span>Re-Scan Wards</span>
              </button>
              <button
                type="button"
                onClick={() => setIsNotificationDrawerOpen(false)}
                className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* FLOATING TOAST NOTIFICATION STACK */}
      {/* ==================================================================== */}
      {activeToasts.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {activeToasts.map((toast, idx) => (
            <div
              key={idx}
              className="bg-slate-900 text-white p-3.5 rounded-xl shadow-2xl border border-rose-500/40 pointer-events-auto flex items-start gap-3 animate-in fade-in slide-in-from-bottom-3 duration-300"
            >
              <div className="p-1.5 rounded-lg bg-rose-600 text-white shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4 text-amber-200" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-rose-400">
                    PAR Reorder Alert
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono">Just Now</span>
                </div>
                <div className="text-xs font-extrabold text-white truncate mt-0.5">
                  {toast.itemName} ({toast.locationName})
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">
                  Stock at {toast.currentQuantity} is below min {toast.minQuantity}. Shortfall: {toast.shortfall} units.
                </p>
              </div>
              <button
                onClick={() => setActiveToasts((prev) => prev.filter((_, i) => i !== idx))}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
