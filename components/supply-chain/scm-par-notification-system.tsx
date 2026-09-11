'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Bell,
  AlertTriangle,
  ShieldAlert,
  ShoppingCart,
  X,
  CheckCircle2,
  Volume2,
  VolumeX,
  ArrowRight,
  Sparkles,
  Package,
  Building2,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import { ItemMaster, InventoryBalance, PurchaseRequisition, StandardUOM } from '@/types/scm-domain';
import { createPurchaseRequisition } from '@/lib/firebase/services/scm-firestore-service';

export interface ParDeficitAlert {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  criticality: 'VITAL' | 'ESSENTIAL' | 'DESIRABLE';
  currentStock: number;
  minimumPar: number;
  reorderQuantity: number;
  shortfall: number;
  unitOfMeasure: string;
  unitCost: number;
  primaryLocationName: string;
  detectedAt: Date;
  status: 'ACTIVE' | 'SNOOZED' | 'REQUISITIONED';
}

interface ScmParNotificationSystemProps {
  tenantId: string;
  items: ItemMaster[];
  balances: InventoryBalance[];
  onRequisitionCreated?: () => Promise<void> | void;
  onFocusItemInChart?: (itemId: string) => void;
}

export function ScmParNotificationSystem({
  tenantId,
  items,
  balances,
  onRequisitionCreated,
  onFocusItemInChart,
}: ScmParNotificationSystemProps) {
  // Sound enabled preference
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Dismissed alert IDs (stored in session memory)
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  // Requisitioned alert IDs
  const [requisitionedAlertIds, setRequisitionedAlertIds] = useState<Set<string>>(new Set());
  // Alert Center Drawer Open
  const [isAlertCenterOpen, setIsAlertCenterOpen] = useState(false);
  // Toast notifications currently showing (max 3 at a time)
  const [activeToastIds, setActiveToastIds] = useState<string[]>([]);
  // Processing state for 1-click reorders
  const [processingReorderId, setProcessingReorderId] = useState<string | null>(null);

  // Sound chime synthesizer
  const playAlertChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {
      // Audio context might be restricted
    }
  }, [soundEnabled]);

  // Evaluate PAR Deficits across items and balances
  const allParAlerts: ParDeficitAlert[] = useMemo(() => {
    const alerts: ParDeficitAlert[] = [];

    items.forEach((item) => {
      // Calculate total available and on-hand across all ward balances
      const itemBalances = balances.filter((b) => b.itemId === item.itemId);
      const totalAvailable = itemBalances.reduce((sum, b) => sum + b.available, 0);
      const totalOnHand = itemBalances.reduce((sum, b) => sum + b.onHand, 0);

      const effectiveStock = totalAvailable > 0 ? totalAvailable : totalOnHand;
      const minimumPar = item.minimumStock || 20;

      // Deficit condition: current stock reached or breached minimum PAR level
      if (effectiveStock <= minimumPar) {
        const shortfall = minimumPar - effectiveStock;
        const primaryLoc = itemBalances[0]?.locationName || 'Major Hospital Wards';

        alerts.push({
          id: `alert-${item.itemId}`,
          itemId: item.itemId,
          itemName: item.name,
          itemCode: item.itemCode,
          criticality: item.criticality,
          currentStock: effectiveStock,
          minimumPar,
          reorderQuantity: item.reorderQuantity || Math.max(shortfall * 2, 50),
          shortfall,
          unitOfMeasure: item.unitOfMeasure,
          unitCost: item.unitCost,
          primaryLocationName: primaryLoc,
          detectedAt: new Date(),
          status: requisitionedAlertIds.has(`alert-${item.itemId}`)
            ? 'REQUISITIONED'
            : dismissedAlertIds.has(`alert-${item.itemId}`)
            ? 'SNOOZED'
            : 'ACTIVE',
        });
      }
    });

    // Sort: VITAL first, then by biggest deficit
    return alerts.sort((a, b) => {
      if (a.criticality === 'VITAL' && b.criticality !== 'VITAL') return -1;
      if (b.criticality === 'VITAL' && a.criticality !== 'VITAL') return 1;
      return b.shortfall - a.shortfall;
    });
  }, [items, balances, dismissedAlertIds, requisitionedAlertIds]);

  // Active alerts (not dismissed or already ordered)
  const activeAlerts = useMemo(() => {
    return allParAlerts.filter((a) => a.status === 'ACTIVE');
  }, [allParAlerts]);

  // Critical VITAL alerts count
  const vitalAlertsCount = useMemo(() => {
    return activeAlerts.filter((a) => a.criticality === 'VITAL').length;
  }, [activeAlerts]);

  // Sync active toasts when alerts change
  useEffect(() => {
    if (activeAlerts.length > 0) {
      // Pick top 2 most urgent active alerts for automatic toast banners
      const candidateIds = activeAlerts.slice(0, 2).map((a) => a.id);
      setActiveToastIds((prev) => {
        // If there's a new alert not in prev, play chime
        const hasNew = candidateIds.some((id) => !prev.includes(id));
        if (hasNew) {
          playAlertChime();
        }
        return candidateIds;
      });
    } else {
      setActiveToastIds([]);
    }
  }, [activeAlerts, playAlertChime]);

  // Dismiss a toast
  const dismissToast = (alertId: string) => {
    setDismissedAlertIds((prev) => new Set([...prev, alertId]));
    setActiveToastIds((prev) => prev.filter((id) => id !== alertId));
  };

  // 1-Click Purchase Requisition Execution
  const handleGenerateRequisition = async (alert: ParDeficitAlert) => {
    setProcessingReorderId(alert.id);
    try {
      const nowIso = new Date().toISOString();
      const prId = `PR-PAR-${Date.now().toString().slice(-6)}`;

      const newPR: PurchaseRequisition = {
        requisitionId: prId,
        tenantId,
        facilityId: 'FAC-MAIN',
        requisitionNumber: `PR-AUTOPAR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        requestingDepartment: 'Procurement Supply Chain Operations',
        requestingLocationId: 'loc-central',
        requestedBy: {
          userId: 'usr-procurement-officer',
          userName: 'Automated PAR Monitor System',
          role: 'Procurement Officer',
        },
        priority: alert.criticality === 'VITAL' ? 'EMERGENCY' : 'URGENT',
        items: [
          {
            itemId: alert.itemId,
            itemCode: alert.itemCode,
            itemName: alert.itemName,
            requestedQuantity: alert.reorderQuantity,
            uom: (alert.unitOfMeasure as StandardUOM) || 'EACH',
            currentStock: alert.currentStock,
            reorderPoint: alert.minimumPar,
            suggestedQuantity: alert.shortfall,
            estimatedUnitCost: alert.unitCost,
            estimatedTotal: alert.reorderQuantity * alert.unitCost,
            justification: `Automated PAR replenishment trigger: On-hand stock (${alert.currentStock}) reached minimum PAR threshold (${alert.minimumPar} ${alert.unitOfMeasure}). Deficit: ${alert.shortfall} units.`,
          },
        ],
        justification: `Critical Ward PAR replenishment order for ${alert.itemName}. System auto-detected stock at ${alert.currentStock} units vs safety minimum ${alert.minimumPar}.`,
        requiredByDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        estimatedTotalCost: alert.reorderQuantity * alert.unitCost,
        currency: 'USD',
        clinicalCriticality: alert.criticality,
        status: 'SUBMITTED',
        approvalHistory: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await createPurchaseRequisition(tenantId, newPR);

      // Mark as requisitioned
      setRequisitionedAlertIds((prev) => new Set([...prev, alert.id]));
      // Dismiss from active toasts
      setActiveToastIds((prev) => prev.filter((id) => id !== alert.id));

      if (onRequisitionCreated) {
        await onRequisitionCreated();
      }
    } catch (err) {
      console.error('Failed to create automated PR:', err);
    } finally {
      setProcessingReorderId(null);
    }
  };

  // Batch reorder all active deficits
  const handleBatchReorderAll = async () => {
    if (activeAlerts.length === 0) return;
    setProcessingReorderId('BATCH_ALL');
    try {
      for (const alert of activeAlerts) {
        await handleGenerateRequisition(alert);
      }
    } finally {
      setProcessingReorderId(null);
    }
  };

  return (
    <>
      {/* 1. Header Alert Bell Trigger Button */}
      <div className="relative inline-flex items-center">
        <button
          id="btn-scm-par-alerts-trigger"
          type="button"
          onClick={() => setIsAlertCenterOpen(!isAlertCenterOpen)}
          className={`relative p-2 rounded-xl border transition-colors flex items-center gap-1.5 cursor-pointer text-xs font-semibold ${
            vitalAlertsCount > 0
              ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 animate-pulse'
              : activeAlerts.length > 0
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
          }`}
          title="Procurement PAR Alert Hub"
        >
          <Bell className="w-4 h-4" />
          <span className="hidden sm:inline">PAR Alerts</span>
          {activeAlerts.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                vitalAlertsCount > 0 ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
              }`}
            >
              {activeAlerts.length}
            </span>
          )}
        </button>

        {/* Sound toggle right next to trigger */}
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer ml-1"
          title={soundEnabled ? 'Mute Alert Chimes' : 'Enable Alert Chimes'}
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
        </button>
      </div>

      {/* 2. Floating Toast Stack (Top-Right of screen/view) */}
      <div className="fixed top-20 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {activeToastIds.map((toastId) => {
          const alert = allParAlerts.find((a) => a.id === toastId);
          if (!alert) return null;

          const isVital = alert.criticality === 'VITAL';

          return (
            <div
              key={alert.id}
              className={`pointer-events-auto rounded-2xl p-4 shadow-xl border backdrop-blur-md transition-all animate-in slide-in-from-top-4 duration-300 ${
                isVital
                  ? 'bg-rose-50/95 dark:bg-slate-900/95 border-rose-300 dark:border-rose-800 text-slate-900 dark:text-slate-100 shadow-rose-500/10'
                  : 'bg-amber-50/95 dark:bg-slate-900/95 border-amber-300 dark:border-amber-800 text-slate-900 dark:text-slate-100 shadow-amber-500/10'
              }`}
            >
              {/* Toast Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`p-1.5 rounded-lg ${
                      isVital
                        ? 'bg-rose-600 text-white'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    {isVital ? (
                      <ShieldAlert className="w-4 h-4 animate-bounce" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                          isVital
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {isVital ? 'CRITICAL VITAL DEFICIT' : 'MINIMUM PAR ALERT'}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate max-w-[200px] mt-0.5">
                      {alert.itemName}
                    </h4>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => dismissToast(alert.id)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Stock Details */}
              <div className="mt-2.5 p-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 text-xs grid grid-cols-3 gap-1 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 block">Available:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    {alert.currentStock} {alert.unitOfMeasure}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Min PAR:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {alert.minimumPar} {alert.unitOfMeasure}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Deficit:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    -{alert.shortfall}
                  </span>
                </div>
              </div>

              {/* Toast Actions */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateRequisition(alert)}
                  disabled={processingReorderId === alert.id}
                  className="flex-1 py-1.5 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>
                    {processingReorderId === alert.id
                      ? 'Requisitioning...'
                      : `1-Click Reorder (${alert.reorderQuantity})`}
                  </span>
                </button>

                {onFocusItemInChart && (
                  <button
                    type="button"
                    onClick={() => {
                      onFocusItemInChart(alert.itemId);
                      dismissToast(alert.id);
                    }}
                    className="py-1.5 px-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                    title="Inspect Wards in Chart"
                  >
                    Chart
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => dismissToast(alert.id)}
                  className="py-1.5 px-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[11px] font-medium cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Procurement Officer PAR Alert Center Slide-Over Drawer */}
      {isAlertCenterOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
                  <Bell className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Procurement PAR Alert Hub
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Automated stockout & minimum threshold monitoring
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsAlertCenterOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Batch Reorder Bar */}
            {activeAlerts.length > 0 && (
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-blue-950 dark:text-blue-200">
                    {activeAlerts.length} Active PAR Breaches
                  </span>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300">
                    {vitalAlertsCount} critical vital medications/supplies
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleBatchReorderAll}
                  disabled={processingReorderId !== null}
                  className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Batch Reorder All</span>
                </button>
              </div>
            )}

            {/* Alert List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {allParAlerts.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    All Hospital PAR Levels Compliant
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Zero items are currently at or below minimum safety stock levels across wards.
                  </p>
                </div>
              ) : (
                allParAlerts.map((alert) => {
                  const isVital = alert.criticality === 'VITAL';
                  const isRequisitioned = alert.status === 'REQUISITIONED';

                  return (
                    <div
                      key={alert.id}
                      className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                        isRequisitioned
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 opacity-80'
                          : isVital
                          ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900'
                          : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                isVital
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {alert.criticality}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {alert.itemCode}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                            {alert.itemName}
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Primary Hub: {alert.primaryLocationName}
                          </p>
                        </div>

                        {isRequisitioned && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> PR Submitted
                          </span>
                        )}
                      </div>

                      {/* Stock vs Min Bar */}
                      <div className="grid grid-cols-3 gap-2 text-center text-xs py-1.5 px-2 rounded-lg bg-white/60 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Available</span>
                          <span className="font-bold text-rose-600">{alert.currentStock}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Min PAR</span>
                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                            {alert.minimumPar}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Shortfall</span>
                          <span className="font-bold text-rose-600">-{alert.shortfall}</span>
                        </div>
                      </div>

                      {!isRequisitioned && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleGenerateRequisition(alert)}
                            disabled={processingReorderId === alert.id}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <ShoppingCart className="w-3 h-3" />
                            <span>1-Click Reorder ({alert.reorderQuantity} units)</span>
                          </button>

                          {onFocusItemInChart && (
                            <button
                              type="button"
                              onClick={() => {
                                onFocusItemInChart(alert.itemId);
                                setIsAlertCenterOpen(false);
                              }}
                              className="py-1.5 px-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                              title="View in Ward Bar Chart"
                            >
                              Chart
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs text-slate-500">
              <span>Automatic PAR audit checks active</span>
              <button
                type="button"
                onClick={() => {
                  setDismissedAlertIds(new Set());
                }}
                className="text-blue-600 hover:underline cursor-pointer flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset Dismissals
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
