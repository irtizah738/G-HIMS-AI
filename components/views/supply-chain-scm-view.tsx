'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { SupplierContract } from '@/types/scm-sourcing';
import {
  ItemMaster,
  InventoryLocation,
  BatchLotRecord,
  StockTransaction,
  InventoryBalance,
  PurchaseRequisition,
  PurchaseOrderRecord,
  GoodsReceiptNote,
  StockTransferRecord,
  PatientConsumptionRecord,
  RecallCase,
  SupplierMaster,
  ThreeWayMatchResult,
  AISCMRecommendation,
} from '@/types/scm-domain';
import {
  hydrateScmEdgeData,
  loadLocalScmEdgeData,
  approvePurchaseRequisitionEdge,
  recordGoodsReceiptEdge,
  recordStockTransactionEdge,
  submitPurchaseRequisitionEdge,
} from '@/lib/supply-chain/scm-edge-adapter';
import {
  initiateScmRecallEdge,
  executeRecallQuarantineEdge,
} from '@/lib/supply-chain/scm-recall-edge-adapter';
import { upsertReplenishmentPolicyEdge } from '@/lib/supply-chain/scm-planning-edge-adapter';
import { ScmExpiryDashboard } from '@/components/supply-chain/scm-expiry-dashboard';
import { ScmAuditComplianceView } from '@/components/supply-chain/scm-audit-compliance-view';
import { ScmProcurementModule } from '@/components/supply-chain/scm-procurement-module';
import { ScmBatchTrackingLedger } from '@/components/supply-chain/scm-batch-tracking-ledger';
import { ScmWardStockParChart } from '@/components/supply-chain/scm-ward-stock-par-chart';
import { ScmMobileBarcodeScanner } from '@/components/supply-chain/scm-mobile-barcode-scanner';
import { ScmParNotificationSystem } from '@/components/supply-chain/scm-par-notification-system';
import { ScmParProjectionWidget } from '@/components/supply-chain/scm-par-projection-widget';
import { ScmPoAiSummaryCard } from '@/components/supply-chain/scm-po-ai-summary-card';
import { ScmSupplierRadarChart } from '@/components/supply-chain/scm-supplier-radar-chart';
import { ScmSupplierOnTimeDeliveryWidget } from '@/components/supply-chain/scm-supplier-on-time-delivery-widget';
import { ScmParManagementTable } from '@/components/supply-chain/scm-par-management-table';
import { ScmItemDetailQrModal } from '@/components/supply-chain/scm-item-detail-qr-modal';
import {
  allocateFefoBatches,
  evaluateReplenishment,
  calculateSupplierScorecard,
} from '@/lib/supply-chain/scm-engine';
import { parseHealthcareBarcode } from '@/lib/supply-chain/barcode-scanner';
import {
  ShoppingCart,
  Package,
  Boxes,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  Building2,
  Search,
  Filter,
  RefreshCw,
  QrCode,
  FileText,
  DollarSign,
  Layers,
  ThermometerSnowflake,
  ShieldAlert,
  UserCheck,
  Sparkles,
  ArrowRight,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  SlidersHorizontal,
  Plus,
  Send,
  Download,
  Eye,
  AlertCircle,
  Activity,
  Calendar,
} from 'lucide-react';

interface SupplyChainScmViewProps {
  tenantId?: string;
}

export function SupplyChainScmView({ tenantId = 'metro-health' }: SupplyChainScmViewProps) {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'par_management'
    | 'expiry'
    | 'procurement'
    | 'inventory'
    | 'audit'
    | 'batches'
    | 'locations'
    | 'grn'
    | 'transfers'
    | 'traceability'
    | 'recalls'
    | 'suppliers'
    | 'ai_advisory'
  >('dashboard');

  // Core SCM State
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [batches, setBatches] = useState<BatchLotRecord[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>([]);
  const [grns, setGrns] = useState<GoodsReceiptNote[]>([]);
  const [transfers, setTransfers] = useState<StockTransferRecord[]>([]);
  const [consumptions, setConsumptions] = useState<PatientConsumptionRecord[]>([]);
  const [recallCases, setRecallCases] = useState<RecallCase[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [supplierContracts, setSupplierContracts] = useState<SupplierContract[]>([]);
  const [threeWayMatches, setThreeWayMatches] = useState<ThreeWayMatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [governanceNotice, setGovernanceNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<string>('ALL');
  const [selectedParChartItemId, setSelectedParChartItemId] = useState<string>('ALL');

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerInput, setScannerInput] = useState('');
  const [scanResultFeedback, setScanResultFeedback] = useState<string | null>(null);

  const [isNewRequisitionOpen, setIsNewRequisitionOpen] = useState(false);
  const [reqPriority, setReqPriority] = useState<'NORMAL' | 'URGENT' | 'EMERGENCY'>('NORMAL');
  const [reqSelectedItem, setReqSelectedItem] = useState('');
  const [reqQuantity, setReqQuantity] = useState(10);
  const [reqJustification, setReqJustification] = useState('');

  const [isStockIssueOpen, setIsStockIssueOpen] = useState(false);
  const [issueItem, setIssueItem] = useState<ItemMaster | null>(null);
  const [issueQty, setIssueQty] = useState(1);
  const [issueRecipient, setIssueRecipient] = useState('ICU Nurse Station B');

  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);
  const [recallBatchNum, setRecallBatchNum] = useState('');
  const [recallReason, setRecallReason] = useState('');

  // Goods Receipt Note Modal State
  const [isNewGrnOpen, setIsNewGrnOpen] = useState(false);
  const [grnPoNumber, setGrnPoNumber] = useState('PO-2026-0041');
  const [grnSupplierName, setGrnSupplierName] = useState('Pfizer BioPharma Ltd');
  const [grnDeliveryNote, setGrnDeliveryNote] = useState('DN-98421');
  const [grnItemId, setGrnItemId] = useState('');
  const [grnBatchNumber, setGrnBatchNumber] = useState('LOT-2026-N201');
  const [grnManufactureDate, setGrnManufactureDate] = useState(new Date().toISOString().split('T')[0]);
  const [grnExpirationDate, setGrnExpirationDate] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]
  );
  const [grnQuantity, setGrnQuantity] = useState(50);
  const [grnTempCelsius, setGrnTempCelsius] = useState(4.2);
  const [grnInspectionStatus, setGrnInspectionStatus] = useState<'PASSED' | 'FAILED'>('PASSED');
  const [isSubmittingGrn, setIsSubmittingGrn] = useState(false);

  // Item QR Code Label Modal State
  const [selectedQrItem, setSelectedQrItem] = useState<ItemMaster | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const handleOpenQrModal = (item: ItemMaster) => {
    setSelectedQrItem(item);
    setIsQrModalOpen(true);
  };

  // Local-first SCM read model: render encrypted IndexedDB immediately,
  // then refresh from the authenticated server snapshot when connectivity exists.
  const applyScmData = (data: Awaited<ReturnType<typeof loadLocalScmEdgeData>>) => {
    setItems(data.items || []);
    setLocations(data.locations || []);
    setBatches(data.batches || []);
    setBalances(data.balances || []);
    setTransactions((data.transactions || []).slice(0, 50));
    setRequisitions(data.requisitions || []);
    setPurchaseOrders(data.purchaseOrders || []);
    setGrns(data.goodsReceiptNotes || []);
    setTransfers(data.stockTransfers || []);
    setConsumptions(data.consumptions || []);
    setRecallCases(data.recalls || []);
    setSuppliers(data.suppliers || []);
    setSupplierContracts(data.supplierContracts || []);
    setThreeWayMatches(data.threeWayMatches || []);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      applyScmData(await loadLocalScmEdgeData(tenantId));
      applyScmData(await hydrateScmEdgeData(tenantId));
    } catch (err) {
      console.error('Failed loading SCM edge data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Aggregate Executive KPIs
  const kpis = useMemo(() => {
    const totalValuation = balances.reduce((sum, b) => sum + (b.totalValuation || 0), 0);
    const totalOnHandUnits = balances.reduce((sum, b) => sum + b.onHand, 0);
    const totalAvailableUnits = balances.reduce((sum, b) => sum + b.available, 0);
    const totalQuarantinedUnits = balances.reduce((sum, b) => sum + b.quarantined, 0);

    const now = Date.now();
    const expiringIn30Days = batches.filter((b) => {
      const exp = new Date(b.expiryDate).getTime();
      const diffDays = (exp - now) / (1000 * 3600 * 24);
      return diffDays >= 0 && diffDays <= 30 && b.quantityRemaining > 0;
    }).length;

    const criticalStockouts = balances.filter(
      (b) => b.available <= b.minimumStock && b.onHand < b.minimumStock
    ).length;

    const coldChainExcursions = batches.filter((b) => b.temperatureExcursionDetected).length;
    const openOrdersCount = purchaseOrders.filter((p) => p.status !== 'CLOSED').length;
    const pendingRequisitions = requisitions.filter((r) => r.status === 'PENDING_APPROVAL').length;

    return {
      totalValuation: Math.round(totalValuation * 100) / 100,
      totalOnHandUnits,
      totalAvailableUnits,
      totalQuarantinedUnits,
      expiringIn30Days,
      criticalStockouts,
      coldChainExcursions,
      openOrdersCount,
      pendingRequisitions,
    };
  }, [balances, batches, purchaseOrders, requisitions]);

  // Filtered inventory balances
  const filteredBalances = useMemo(() => {
    return balances.filter((b) => {
      const matchSearch =
        b.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.batchNumber.toLowerCase().includes(searchQuery.toLowerCase());
      const matchLoc =
        selectedLocationFilter === 'ALL' || b.locationId === selectedLocationFilter;
      return matchSearch && matchLoc;
    });
  }, [balances, searchQuery, selectedLocationFilter]);

  // Handle Quick Barcode Scan
  const handleScanLookup = () => {
    if (!scannerInput.trim()) return;
    const res = parseHealthcareBarcode(scannerInput);
    if (res.itemCode || res.gtin || res.batchNumber) {
      const matchedItem = items.find(
        (it) =>
          it.itemCode === res.itemCode ||
          it.barcode === res.raw ||
          (res.gtin && it.gtin === res.gtin)
      );
      const matchedBatch = batches.find((b) => b.batchNumber === res.batchNumber);

      let msg = `Barcode Parsed [${res.format}]: `;
      if (matchedItem) msg += `Item: ${matchedItem.name} (${matchedItem.itemCode}). `;
      if (matchedBatch) msg += `Batch: ${matchedBatch.batchNumber} (Expires: ${matchedBatch.expiryDate.split('T')[0]}).`;
      setScanResultFeedback(msg);
      if (matchedItem) {
        setSearchQuery(matchedItem.itemCode);
      }
    } else {
      setScanResultFeedback(`Scan processed: "${scannerInput}". No explicit hospital item matched.`);
    }
  };

  // Handle Requisition Submission
  const handleCreateRequisition = async () => {
    if (!reqSelectedItem) return;
    const targetItem = items.find((i) => i.itemId === reqSelectedItem);
    if (!targetItem) return;

    const newReqId = `req-${Date.now()}`;
    const newReq: PurchaseRequisition = {
      requisitionId: newReqId,
      tenantId,
      facilityId: 'FAC-MAIN',
      requisitionNumber: `PR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      requestingDepartment: 'Critical Care / Pharmacy Hub',
      requestingLocationId: 'loc-pharmacy-main',
      requestedBy: {
        userId: 'usr-clinician',
        userName: 'Clinical Duty Pharmacist',
        role: 'Staff Pharmacist',
      },
      priority: reqPriority,
      items: [
        {
          itemId: targetItem.itemId,
          itemCode: targetItem.itemCode,
          itemName: targetItem.name,
          requestedQuantity: reqQuantity,
          uom: targetItem.unitOfMeasure,
          currentStock: balances
            .filter((balance) => balance.itemId === targetItem.itemId)
            .reduce((sum, balance) => sum + balance.available, 0),
          reorderPoint: targetItem.reorderPoint,
          suggestedQuantity: targetItem.reorderQuantity || reqQuantity,
          estimatedUnitCost: targetItem.unitCost,
          estimatedTotal: targetItem.unitCost * reqQuantity,
          justification: reqJustification,
        },
      ],
      justification: reqJustification || 'Clinical demand replenishment',
      requiredByDate: new Date(Date.now() + 3 * 86400000).toISOString(),
      estimatedTotalCost: targetItem.unitCost * reqQuantity,
      currency: 'USD',
      clinicalCriticality: targetItem.criticality,
      status: 'PENDING_APPROVAL',
      approvalHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await submitPurchaseRequisitionEdge(newReq);
    setIsNewRequisitionOpen(false);
    setReqJustification('');
    await loadData();
  };

  // Handle Requisition Approval
  const handleApproveRequisition = async (reqId: string) => {
    const requisition = requisitions.find((item) => item.requisitionId === reqId);
    if (!requisition) return;

    await approvePurchaseRequisitionEdge({
      requisitionId: reqId,
      decision: 'APPROVED',
      comments:
        'Approved through the authenticated SCM governance workflow.',
      approvedLines: requisition.items.map((line) => ({
        itemId: line.itemId,
        approvedQuantity: line.requestedQuantity,
      })),
    });
    await loadData();
  };

  // Handle FEFO Stock Issue
  const handleExecuteStockIssue = async () => {
    if (!issueItem || issueQty <= 0) return;

    const sourceLocationId = 'loc-pharmacy-main';
    const availableItemBatches = batches
      .filter((b) => b.itemId === issueItem.itemId && b.status === 'AVAILABLE')
      .map((batch) => {
        const sourceBalance = balances.find(
          (balance) =>
            balance.itemId === issueItem.itemId &&
            balance.batchId === batch.batchId &&
            balance.locationId === sourceLocationId
        );
        return {
          ...batch,
          quantityRemaining: sourceBalance?.onHand || 0,
          quantityReserved: sourceBalance?.reserved || 0,
        };
      })
      .filter((batch) => batch.quantityRemaining > 0);
    const fefoResult = allocateFefoBatches(availableItemBatches, issueQty);

    if (fefoResult.allocations.length === 0) {
      alert('No viable batches available to issue!');
      return;
    }

    for (const alloc of fefoResult.allocations) {
      const txnId = `txn_iss_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const targetBatch = batches.find((b) => b.batchId === alloc.batchId);
      await recordStockTransactionEdge({
        transactionId: txnId,
        tenantId,
        facilityId:
          balances.find(
            (balance) =>
              balance.itemId === issueItem.itemId &&
              balance.batchId === alloc.batchId &&
              balance.locationId === sourceLocationId
          )?.facilityId || 'FAC-MAIN',
        itemId: issueItem.itemId,
        itemCode: issueItem.itemCode,
        itemName: issueItem.name,
        batchId: alloc.batchId,
        batchNumber: alloc.batchNumber,
        manufactureDate: targetBatch?.manufactureDate,
        expirationDate: alloc.expiryDate,
        fromLocationId: sourceLocationId,
        fromLocationName: 'Inpatient Central Pharmacy',
        toLocationId: 'loc-icu-hub',
        toLocationName: issueRecipient,
        quantity: alloc.allocatedQty,
        uom: issueItem.stockUOM || issueItem.unitOfMeasure,
        normalizedQuantity: alloc.allocatedQty,
        unitCost: issueItem.unitCost,
        totalCost: issueItem.unitCost * alloc.allocatedQty,
        currency: 'USD',
        transactionType: 'TRANSFER_OUT',
        referenceType: 'INTERNAL_REQUEST',
        referenceId: `REQ-${Date.now()}`,
        performedBy: {
          userId: 'usr-pharmacy',
          userName: 'Duty Pharmacist',
          role: 'Pharmacist',
        },
        occurredAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        idempotencyKey: `idemp_${txnId}`,
        source: 'ONLINE',
      });
    }

    setIsStockIssueOpen(false);
    setIssueItem(null);
    await loadData();
  };

  // Handle Goods Receipt Note (GRN) through the governed SCM-2 command.
  const handleCreateGoodsReceiptNote = async () => {
    const matchingPo = purchaseOrders.find(
      (po) => po.poNumber === grnPoNumber
    );
    if (!matchingPo) {
      setGovernanceNotice(
        'Select an authoritative purchase order before receiving goods.'
      );
      return;
    }

    const selectedItem = items.find((item) => item.itemId === grnItemId);
    const poLine = matchingPo.items.find(
      (line) => line.itemId === selectedItem?.itemId
    );
    const destination = locations.find(
      (location) =>
        location.locationId === matchingPo.destinationLocationId &&
        location.active
    );

    if (!selectedItem || !poLine || !destination) {
      setGovernanceNotice(
        'The selected item or destination is not part of the authoritative purchase order.'
      );
      return;
    }

    setIsSubmittingGrn(true);
    setGovernanceNotice(null);

    const receivedAt = new Date().toISOString();
    const failed = grnInspectionStatus === 'FAILED';
    const temperatureExcursion =
      grnTempCelsius > 8 || grnTempCelsius < 2;
    const batchId = `batch:${selectedItem.itemId}:${grnBatchNumber}`;

    try {
      await recordGoodsReceiptEdge({
        grnId: `grn_${crypto.randomUUID()}`,
        grnNumber: `GRN-${new Date().getFullYear()}-${Date.now()
          .toString()
          .slice(-8)}`,
        purchaseOrderId: matchingPo.poId,
        facilityId: matchingPo.facilityId,
        deliveryNoteNumber: grnDeliveryNote.trim(),
        receivedAt,
        inspectionStatus: failed
          ? 'FAILED'
          : temperatureExcursion
            ? 'QUARANTINED'
            : 'PASSED',
        destinationLocationId: destination.locationId,
        destinationLocationName: destination.name,
        items: [
          {
            itemId: selectedItem.itemId,
            batchId,
            batchNumber: grnBatchNumber.trim(),
            lotNumber: grnBatchNumber.trim(),
            quantityReceived: grnQuantity,
            quantityAccepted: failed ? 0 : grnQuantity,
            quantityRejected: failed ? grnQuantity : 0,
            quantityDamaged: 0,
            uom: poLine.uom,
            expiryDate: new Date(grnExpirationDate).toISOString(),
            manufactureDate: new Date(grnManufactureDate).toISOString(),
            manufacturer: matchingPo.supplierName,
            recordedTemperatureCelsius: grnTempCelsius,
            temperatureExcursion,
            inspectionPassed: !failed,
            inspectionNotes: failed
              ? 'Dock inspection failed; no stock accepted.'
              : temperatureExcursion
                ? 'Temperature excursion detected; accepted stock quarantined.'
                : 'Dock inspection passed.',
            unitCost: Number(poLine.unitPrice),
          },
        ],
      });

      setIsNewGrnOpen(false);
      setGovernanceNotice(
        'Goods receipt committed through SCM-2. Inventory balances will refresh from the authoritative event projection.'
      );
      await loadData();
    } catch (error) {
      setGovernanceNotice(
        error instanceof Error ? error.message : 'Governed goods receipt failed.'
      );
    } finally {
      setIsSubmittingGrn(false);
    }
  };

  // Governed SCM-8 recall initiation + authoritative stock quarantine.
  const handleTriggerBatchRecall = async () => {
    const targetBatch = batches.find(
      (batch) => batch.batchNumber.trim() === recallBatchNum.trim()
    );
    if (!targetBatch) {
      setGovernanceNotice('No authoritative batch matches the recall batch number.');
      return;
    }
    const affectedBalances = balances.filter(
      (balance) =>
        balance.batchId === targetBatch.batchId &&
        Number(balance.onHand || 0) > 0
    );
    if (!affectedBalances.length) {
      setGovernanceNotice('The selected batch has no authoritative on-hand balances to quarantine.');
      return;
    }

    const recallId = `recall_${crypto.randomUUID()}`;
    const initiatedAt = new Date().toISOString();
    try {
      await initiateScmRecallEdge(
        {
          recallId,
          recallCaseNumber: `RCL-${new Date().getFullYear()}-${Date.now()
            .toString()
            .slice(-8)}`,
          itemId: targetBatch.itemId,
          scope: 'BATCH_WIDE',
          targetBatchNumbers: [targetBatch.batchNumber],
          recallReason: recallReason.trim(),
          severity: 'URGENT_CLASS_2',
          initiatedAt,
        },
        `scm-recall-init:${recallId}`
      );
      await executeRecallQuarantineEdge(
        {
          recallId,
          batchIds: [targetBatch.batchId],
          balanceIds: affectedBalances.map((balance) => balance.balanceId),
          finalChunk: true,
        },
        `scm-recall-quarantine:${recallId}:final`
      );
      setIsRecallModalOpen(false);
      setRecallBatchNum('');
      setRecallReason('');
      setGovernanceNotice(
        'Recall initiated and affected on-hand stock quarantined through the governed SCM-8 workflow.'
      );
      await loadData();
    } catch (error) {
      setGovernanceNotice(
        error instanceof Error ? error.message : 'Governed recall initiation failed.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Supply Chain & Inventory Management
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold">
                  G-HIMS SCM OS
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hospital-grade procurement, FEFO stock engine, Cold-Chain monitoring, and patient implant traceability.
              </p>
            </div>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Automated PAR Notification System & Toast Alerts */}
          <ScmParNotificationSystem
            tenantId={tenantId}
            items={items}
            balances={balances}
            onRequisitionCreated={loadData}
            onFocusItemInChart={(itemId) => {
              setSelectedParChartItemId(itemId);
              setActiveTab('dashboard');
            }}
          />

          <button
            id="btn-scm-barcode-scanner"
            onClick={() => setIsScannerOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center gap-2 border border-blue-200 dark:border-blue-900 transition-colors cursor-pointer"
          >
            <QrCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Camera & QR Rapid Scan
          </button>
          <button
            id="btn-scm-new-requisition"
            onClick={() => setIsNewRequisitionOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Requisition
          </button>
          <button
            id="btn-scm-trigger-recall"
            onClick={() => setIsRecallModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2 border border-rose-200 dark:border-rose-900 transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            Emergency Recall
          </button>
          <button
            id="btn-scm-refresh"
            onClick={loadData}
            title="Refresh Ledger"
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          </button>
        </div>
      </div>

      {governanceNotice && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex items-center justify-between gap-3">
          <span>{governanceNotice}</span>
          <button
            type="button"
            onClick={() => setGovernanceNotice(null)}
            className="font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

            {/* KPI Overview Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs text-slate-500 font-medium">Total Inventory Value</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">
            ${kpis.totalValuation.toLocaleString()}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
            <DollarSign className="w-3 h-3" />
            <span>Weighted Cost Basis</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('inventory')}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 cursor-pointer hover:border-blue-400 transition-colors"
        >
          <p className="text-xs text-slate-500 font-medium">Stock On Hand</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">
            {kpis.totalOnHandUnits.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">units</span>
          </p>
          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
            <Boxes className="w-3 h-3" />
            <span>{kpis.totalAvailableUnits} Available &rarr;</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('expiry')}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 cursor-pointer hover:border-amber-400 transition-colors"
        >
          <p className="text-xs text-slate-500 font-medium">Expiring &lt;30 Days</p>
          <p className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-1">
            {kpis.expiringIn30Days}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-amber-600 mt-1">
            <Clock className="w-3 h-3" />
            <span>FEFO Enforced &rarr;</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs text-slate-500 font-medium">Acute Stockout Risk</p>
          <p className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-1">
            {kpis.criticalStockouts}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-rose-500 mt-1">
            <AlertTriangle className="w-3 h-3" />
            <span>Below Safety Buffer</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs text-slate-500 font-medium">Cold Chain Holds</p>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">
            {kpis.coldChainExcursions}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-blue-500 mt-1">
            <ThermometerSnowflake className="w-3 h-3" />
            <span>Temp Excursion Alert</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('procurement')}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 cursor-pointer hover:border-indigo-400 transition-colors"
        >
          <p className="text-xs text-slate-500 font-medium">Pending Approvals</p>
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-1">
            {kpis.pendingRequisitions}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-indigo-500 mt-1">
            <UserCheck className="w-3 h-3" />
            <span>Requisition Queue &rarr;</span>
          </div>
        </div>
      </div>

      {/* Subsystem Primary Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
        {[
          { id: 'dashboard', label: 'Executive Dashboard', icon: Activity },
          { id: 'par_management', label: 'PAR Management & Projections', icon: SlidersHorizontal },
          { id: 'expiry', label: 'Expiry & FEFO Engine', icon: Clock },
          { id: 'procurement', label: 'Procurement Lifecycle', icon: ShoppingCart },
          { id: 'inventory', label: 'Item & Stock Ledger', icon: Layers },
          { id: 'audit', label: 'Audit & Compliance', icon: ShieldAlert },
          { id: 'batches', label: 'Batch Master & Lots', icon: Boxes },
          { id: 'locations', label: 'Locations & Hierarchy', icon: Building2 },
          { id: 'grn', label: 'Goods Receiving (GRN)', icon: Truck },
          { id: 'transfers', label: 'Stock Movements & Transfers', icon: ArrowRight },
          { id: 'traceability', label: 'Patient & Implant Trace', icon: UserCheck },
          { id: 'recalls', label: 'Product Recall Center', icon: AlertCircle },
          { id: 'suppliers', label: 'Suppliers & 3-Way Match', icon: DollarSign },
          { id: 'ai_advisory', label: 'AI Advisory & Forecasting', icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-scm-${tab.id}`}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl whitespace-nowrap cursor-pointer transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* 1. EXECUTIVE DASHBOARD TAB */}
      {/* ==================================================================== */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* AI-Powered Summary Generator for Active Purchase Orders */}
          <ScmPoAiSummaryCard
            purchaseOrders={purchaseOrders}
            suppliers={suppliers}
            onOpenPoDetails={() => {
              setActiveTab('procurement');
            }}
          />

          {/* Interactive Recharts Hospital Ward Stock vs Minimum PAR Level Chart */}
          <ScmWardStockParChart
            balances={balances}
            items={items}
            locations={locations}
            selectedItemId={selectedParChartItemId}
            onInitiateReplenish={(itemId, wardLocationId, shortfall) => {
              setReqSelectedItem(itemId);
              setReqQuantity(shortfall || 25);
              setReqPriority('URGENT');
              setIsNewRequisitionOpen(true);
            }}
          />

          {/* Recharts Radar Chart: Supplier Reliability Metrics (On-Time Delivery vs Order Accuracy) */}
          <ScmSupplierRadarChart
            suppliers={suppliers}
            onSelectSupplier={() => {
              setActiveTab('suppliers');
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: High-Risk Items & Critical Reorder Needs */}
            <div className="lg:col-span-2 space-y-6">
              {/* Critical Reorder Watchlist */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    Critical Reorder Watchlist (PAR / Min-Max Alerts)
                  </h3>
                  <span className="text-xs text-slate-400">Automated Replenishment Engine</span>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((it) => {
                    const itemBalances = balances.filter((b) => b.itemId === it.itemId);
                    const totalAvail = itemBalances.reduce((sum, b) => sum + b.available, 0);
                    const rep = evaluateReplenishment(it, totalAvail, 5); // 5 units daily usage
                    if (!rep.needsReorder) return null;

                    return (
                      <div key={it.itemId} className="py-3 flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {it.name}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                              {it.itemCode}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                it.criticality === 'VITAL'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {it.criticality}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {rep.reason}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {totalAvail} / {it.reorderPoint} {it.unitOfMeasure}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {rep.daysOfCoverRemaining} days cover
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setReqSelectedItem(it.itemId);
                              setReqQuantity(rep.suggestedReorderQuantity);
                              setReqPriority(it.criticality === 'VITAL' ? 'URGENT' : 'NORMAL');
                              setIsNewRequisitionOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-semibold border border-blue-200 dark:border-blue-900 cursor-pointer"
                          >
                            Reorder {rep.suggestedReorderQuantity}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Real-Time Immutable Stock Ledger Activity Feed */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    Immutable Stock Movements Ledger (Recent)
                  </h3>
                  <span className="text-xs text-slate-400">Append-Only Event Stream</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-semibold">
                        <th className="pb-2">Timestamp</th>
                        <th className="pb-2">Type</th>
                        <th className="pb-2">Item Code & Name</th>
                        <th className="pb-2">Batch / Serial</th>
                        <th className="pb-2">Qty</th>
                        <th className="pb-2">Performed By</th>
                        <th className="pb-2">Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {transactions.slice(0, 5).map((tx) => (
                        <tr key={tx.transactionId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 text-slate-500">
                            {new Date(tx.recordedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                tx.transactionType === 'RECEIPT' || tx.transactionType === 'TRANSFER_IN'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : tx.transactionType === 'CONSUMPTION' || tx.transactionType === 'ISSUE'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {tx.transactionType}
                            </span>
                          </td>
                          <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200">
                            {tx.itemName}
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-slate-500">
                            {tx.batchNumber || tx.serialId || '—'}
                          </td>
                          <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100">
                            {tx.quantity} {tx.uom}
                          </td>
                          <td className="py-2.5 text-slate-500">{tx.performedBy.userName}</td>
                          <td className="py-2.5 text-slate-400 font-mono text-[10px]">
                            {tx.referenceId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right 1 Col: Cold-Chain Monitor & Active Recalls Alert */}
            <div className="space-y-6">
              {/* Cold-Chain & Excursion Monitor */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ThermometerSnowflake className="w-4 h-4 text-blue-500" />
                    Cold-Chain & Excursion Monitor
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300 font-bold">
                    Target: 2°C - 8°C
                  </span>
                </div>

                <div className="space-y-3">
                  {batches
                    .filter((b) => b.temperatureExcursionDetected || b.status === 'QUARANTINED')
                    .map((b) => (
                      <div
                        key={b.batchId}
                        className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-rose-800 dark:text-rose-300">
                            {b.itemName}
                          </span>
                          <span className="font-mono text-[10px] bg-rose-100 dark:bg-rose-900 text-rose-800 dark:text-rose-200 px-1.5 py-0.5 rounded">
                            {b.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-1">
                          Batch: <span className="font-mono">{b.batchNumber}</span> — {b.quarantineReason}
                        </p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-rose-200/60 dark:border-rose-900/60 text-[11px] text-slate-500">
                          <span>Quarantined Qty: {b.quantityRemaining} units</span>
                          <span className="text-rose-600 font-semibold">Locked from Dispensing</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Implant & Critical Traceability Alert */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-emerald-500" />
                    Active Surgical Implants Tracked
                  </h3>
                  <span className="text-xs text-slate-400">UDI & Serial Trace</span>
                </div>

                <div className="space-y-3">
                  {consumptions
                    .filter((c) => c.isImplant)
                    .map((c) => (
                      <div
                        key={c.consumptionId}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {c.itemName}
                          </span>
                          <span className="font-mono text-[10px] text-emerald-600 font-semibold">
                            {c.patientMRN}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Patient: {c.patientName} — {c.procedureName}
                        </p>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
                          <span>SN: {c.serialNumber || 'N/A'}</span>
                          <span>Surgeon: {c.surgeonOrDoctorName?.split(',')[0]}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. PAR MANAGEMENT & 7-DAY LINEAR PROJECTIONS TAB */}
      {/* ==================================================================== */}
      {activeTab === 'par_management' && (
        <div className="space-y-6">
          {/* Simple Linear Projection Widget (7-Day Consumption Burn Rate & Stockout Horizon) */}
          <ScmParProjectionWidget
            balances={balances}
            transactions={transactions}
            items={items}
            locations={locations}
            onTriggerReorder={(it, qty) => {
              setReqSelectedItem(it.itemId);
              setReqQuantity(qty);
              setReqPriority(it.criticality === 'VITAL' ? 'URGENT' : 'NORMAL');
              setIsNewRequisitionOpen(true);
            }}
          />

          {/* Interactive Range Slider Table: Dynamically Calibrate Minimum Stock Reorder Point */}
          <ScmParManagementTable
            balances={balances}
            items={items}
            locations={locations}
            transactions={transactions}
            onSaveParLevel={async (balanceId, newMin, newReorderPoint) => {
              const balance = balances.find((row) => row.balanceId === balanceId);
              const item = balance
                ? items.find((row) => row.itemId === balance.itemId)
                : undefined;
              if (!balance || !item) {
                throw new Error('Authoritative inventory balance or item master is unavailable.');
              }
              const maxQuantity = Math.max(
                newReorderPoint,
                newMin,
                Number(balance.maximumStock || item.maximumStock || 0)
              );
              await upsertReplenishmentPolicyEdge(
                {
                  policyId: `rpol_${balance.facilityId}_${balance.locationId}_${balance.itemId}`,
                  facilityId: balance.facilityId,
                  locationId: balance.locationId,
                  itemId: balance.itemId,
                  preferredSupplierId: item.preferredVendorIds?.[0],
                  minQuantity: newMin,
                  maxQuantity,
                  reorderPoint: newReorderPoint,
                  safetyStockQuantity: Math.max(0, Number(item.safetyStock || newMin)),
                  safetyStockDays: 2,
                  leadTimeDays: Math.max(1, Number(item.leadTimeDays || 1)),
                  mode: 'AUTO',
                  active: true,
                },
                `scm-par-policy:${balance.balanceId}:${newMin}:${newReorderPoint}`
              );
              setGovernanceNotice(
                'PAR/reorder policy saved through the governed SCM-7 replenishment policy command.'
              );
              await loadData();
            }}
            onTriggerReorder={(it, qty) => {
              setReqSelectedItem(it.itemId);
              setReqQuantity(qty);
              setReqPriority(it.criticality === 'VITAL' ? 'URGENT' : 'NORMAL');
              setIsNewRequisitionOpen(true);
            }}
            onOpenQrLabel={handleOpenQrModal}
          />
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. SCM EXPIRY MANAGEMENT & FEFO ENGINE TAB */}
      {/* ==================================================================== */}
      {activeTab === 'expiry' && (
        <ScmExpiryDashboard
          tenantId={tenantId}
          items={items}
          batches={batches}
          balances={balances}
          locations={locations}
          onRefresh={loadData}
        />
      )}

      {/* ==================================================================== */}
      {/* 3. ITEM & STOCK LEDGER (BATCH & LOT TRACKING) TAB */}
      {/* ==================================================================== */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          <ScmBatchTrackingLedger
            tenantId={tenantId}
            items={items}
            batches={batches}
            transactions={transactions}
            locations={locations}
            balances={balances}
            onRefresh={loadData}
            onOpenQrLabel={handleOpenQrModal}
          />

          {/* Derived Balances Master Table */}
          <div className="space-y-4">
          {/* Controls & Search */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Item, SKU, Code or Batch..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-xs text-slate-500 whitespace-nowrap">Location:</label>
              <select
                value={selectedLocationFilter}
                onChange={(e) => setSelectedLocationFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <option value="ALL">All Hospital Locations</option>
                {locations.map((loc) => (
                  <option key={loc.locationId} value={loc.locationId}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Derived Balances Master Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Authoritative Derived Inventory Balances
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Formula: available = onHand - reserved - quarantined - damaged - expired
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {filteredBalances.length} Records
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3.5">Item Code & Name</th>
                    <th className="p-3.5">Store Location</th>
                    <th className="p-3.5">Batch / Expiry</th>
                    <th className="p-3.5 text-right">On Hand</th>
                    <th className="p-3.5 text-right text-blue-600">Reserved</th>
                    <th className="p-3.5 text-right text-rose-600">Quarantine</th>
                    <th className="p-3.5 text-right font-bold text-emerald-600">Available</th>
                    <th className="p-3.5 text-right">Unit Cost</th>
                    <th className="p-3.5 text-right">Total Valuation</th>
                    <th className="p-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredBalances.map((bal) => {
                    const isBelowPar = bal.available < bal.minimumStock;
                    return (
                      <tr
                        key={bal.balanceId}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                          isBelowPar ? 'bg-rose-50/40 dark:bg-rose-950/20 border-l-4 border-l-rose-500' : ''
                        }`}
                      >
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            {isBelowPar && (
                              <span className="relative flex h-2 w-2 shrink-0" title="Critical: Below Minimum PAR Level">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                              </span>
                            )}
                            <div className="font-bold text-slate-900 dark:text-slate-100">
                              {bal.itemName}
                            </div>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {bal.itemCode} • {bal.uom}
                          </div>
                        </td>
                        <td className="p-3.5 text-slate-600 dark:text-slate-300">
                          {bal.locationName}
                        </td>
                        <td className="p-3.5">
                          <div className="font-mono text-xs text-slate-800 dark:text-slate-200">
                            {bal.batchNumber}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Exp: {bal.expiryDate ? bal.expiryDate.split('T')[0] : 'N/A'}
                          </div>
                        </td>
                        <td className="p-3.5 text-right font-semibold text-slate-800 dark:text-slate-200">
                          {bal.onHand}
                        </td>
                        <td className="p-3.5 text-right text-blue-600 dark:text-blue-400 font-semibold">
                          {bal.reserved}
                        </td>
                        <td className="p-3.5 text-right text-rose-600 dark:text-rose-400 font-semibold">
                          {bal.quarantined}
                        </td>
                        <td className="p-3.5 text-right font-bold text-sm">
                          <span
                            className={
                              isBelowPar
                                ? 'text-rose-600 dark:text-rose-400 animate-pulse font-extrabold'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {bal.available}
                          </span>
                          {isBelowPar && (
                            <span className="block text-[10px] text-rose-500 font-normal">
                              Below Min ({bal.minimumStock})
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right text-slate-500">${bal.unitCost}</td>
                        <td className="p-3.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          ${bal.totalValuation.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const foundItem = items.find((i) => i.itemId === bal.itemId);
                                if (foundItem) handleOpenQrModal(foundItem);
                              }}
                              title={`Generate & Print Standardized QR Label for ${bal.itemName}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                const foundItem = items.find((i) => i.itemId === bal.itemId);
                                if (foundItem) {
                                  setIssueItem(foundItem);
                                  setIsStockIssueOpen(true);
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[11px] font-semibold cursor-pointer"
                            >
                              Issue Stock
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
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. BATCHES & FEFO EXPIRY TAB */}
      {/* ==================================================================== */}
      {activeTab === 'batches' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              FEFO (First-Expiry-First-Out) & Batch Tracking Horizon
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              All dispensations and issues strictly allocate earliest-expiring viable batches first.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold">
                  <tr>
                    <th className="p-3">Batch / Lot #</th>
                    <th className="p-3">Item Name</th>
                    <th className="p-3">Expiry Date</th>
                    <th className="p-3">Days Until Expiry</th>
                    <th className="p-3">Remaining Stock</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Cold Chain</th>
                    <th className="p-3 text-center">FEFO Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {batches
                    .slice()
                    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
                    .map((b) => {
                      const now = Date.now();
                      const exp = new Date(b.expiryDate).getTime();
                      const daysLeft = Math.ceil((exp - now) / (1000 * 3600 * 24));

                      return (
                        <tr key={b.batchId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {b.batchNumber}
                          </td>
                          <td className="p-3 font-medium text-slate-800 dark:text-slate-200">
                            {b.itemName}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">
                            {b.expiryDate.split('T')[0]}
                          </td>
                          <td className="p-3">
                            <span
                              className={`font-semibold ${
                                daysLeft <= 30
                                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                                  : daysLeft <= 90
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {daysLeft} days
                            </span>
                          </td>
                          <td className="p-3 font-bold text-slate-900 dark:text-slate-100">
                            {b.quantityRemaining} units
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                b.status === 'AVAILABLE'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : b.status === 'QUARANTINED'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="p-3">
                            {b.temperatureExcursionDetected ? (
                              <span className="text-rose-600 font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Excursion Flagged
                              </span>
                            ) : (
                              <span className="text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Compliant
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {b.status === 'AVAILABLE' && daysLeft <= 60 ? (
                              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 text-[10px] font-bold">
                                Priority 1 (FEFO)
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">Standard</span>
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
      )}

      {/* ==================================================================== */}
      {/* 4. LOCATIONS & HIERARCHY TAB */}
      {/* ==================================================================== */}
      {activeTab === 'locations' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              Hospital Physical Storage & Department Hierarchy
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Multi-level hierarchy: Facility → Building → Floor → Department Stockrooms.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map((loc) => {
                const locBalances = balances.filter((b) => b.locationId === loc.locationId);
                const totalUnits = locBalances.reduce((sum, b) => sum + b.onHand, 0);
                const locValuation = locBalances.reduce((sum, b) => sum + b.totalValuation, 0);

                return (
                  <div
                    key={loc.locationId}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {loc.name}
                        </h4>
                        <p className="text-xs font-mono text-slate-400">{loc.code}</p>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 font-bold">
                        {loc.locationType}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 space-y-1">
                      <p>Building: {loc.building || 'Main Hospital'}</p>
                      <p>Floor: {loc.floor || 'Floor 1'}</p>
                      <p>
                        Temp Controlled:{' '}
                        {loc.temperatureControlled
                          ? `Yes (${loc.targetTempMin || 18}°C - ${loc.targetTempMax || 24}°C)`
                          : 'No'}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                      <div>
                        <p className="text-slate-400">Total Units</p>
                        <p className="font-bold text-slate-900 dark:text-slate-100">{totalUnits}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-400">Store Valuation</p>
                        <p className="font-bold text-emerald-600">
                          ${locValuation.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. PROCUREMENT LIFECYCLE (PR -> APPROVAL -> PO) TAB */}
      {/* ==================================================================== */}
      {activeTab === 'procurement' && (
        <ScmProcurementModule
          tenantId={tenantId}
          items={items}
          requisitions={requisitions}
          purchaseOrders={purchaseOrders}
          suppliers={suppliers}
          supplierContracts={supplierContracts}
          locations={locations}
          onRefresh={loadData}
        />
      )}

      {/* ==================================================================== */}
      {/* 6. AUDIT & REGULATORY COMPLIANCE TAB */}
      {/* ==================================================================== */}
      {activeTab === 'audit' && (
        <ScmAuditComplianceView
          tenantId={tenantId}
          items={items}
          batches={batches}
          balances={balances}
          locations={locations}
          onRefresh={loadData}
        />
      )}

      {/* ==================================================================== */}
      {/* 6. GOODS RECEIVING (GRN) TAB */}
      {/* ==================================================================== */}
      {activeTab === 'grn' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
                  Goods Received Notes (GRN) & Receiving Inspection Ledger
                </h3>
                <p className="text-xs text-slate-400">
                  Dock receiving inspection verifies tamper seals, cold-chain data loggers, and batch expiry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewGrnOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Receive Inbound Goods (GRN)
              </button>
            </div>

            <div className="space-y-3">
              {grns.map((g) => (
                <div
                  key={g.grnId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {g.grnNumber}
                      </span>
                      <span className="text-slate-400 font-mono">PO: {g.poNumber}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {g.supplierName}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        g.inspectionStatus === 'PASSED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      Inspection: {g.inspectionStatus}
                    </span>
                  </div>

                  <div className="text-slate-500">
                    Received by: {g.receivedBy.userName} • Delivery Note: {g.deliveryNoteNumber}
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    {g.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {it.itemName}
                          </span>
                          <span className="font-mono text-slate-500 ml-2">
                            Batch: {it.batchNumber} (Exp: {it.expiryDate.split('T')[0]})
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-emerald-600">
                            Accepted: {it.quantityAccepted} {it.uom}
                          </span>
                          {it.recordedTemperatureCelsius && (
                            <span className="text-[11px] text-blue-500 ml-2 font-mono">
                              {it.recordedTemperatureCelsius}°C
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 7. TRANSFERS & MOVEMENTS TAB */}
      {/* ==================================================================== */}
      {activeTab === 'transfers' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              Inter-Store Stock Transfers & In-Transit Tracking
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Tracks warehouse to satellite pharmacy transfers with discrepancy reconciliation.
            </p>

            <div className="space-y-3">
              {transfers.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No active transfers logged.</p>
              ) : (
                transfers.map((tr) => (
                  <div
                    key={tr.transferId}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-blue-600">{tr.transferNumber}</span>
                      <span className="font-bold text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                        {tr.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                      <span>{tr.fromLocationName}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-bold">{tr.toLocationName}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 8. PATIENT & IMPLANT TRACEABILITY TAB */}
      {/* ==================================================================== */}
      {activeTab === 'traceability' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              Patient Implant & High-Risk Biologicals Traceability Graph
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Dual-directional traceability: Patient Encounter ↔ Implant Serial / UDI ↔ Batch ↔ Supplier PO.
            </p>

            <div className="space-y-4">
              {consumptions.map((c) => (
                <div
                  key={c.consumptionId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {c.itemName}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                          {c.itemType}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Procedure: {c.procedureName || 'Clinical Administration'}
                      </p>
                    </div>

                    <div className="text-right font-mono text-xs">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{c.patientName}</p>
                      <p className="text-slate-400">{c.patientMRN}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Batch Number</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {c.batchNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Serial / UDI</span>
                      <span className="font-bold text-blue-600">{c.serialNumber || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Documented By</span>
                      <span className="text-slate-700 dark:text-slate-300">{c.documentedBy}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Surgeon / MD</span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {c.surgeonOrDoctorName || 'Staff Clinician'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 9. RECALL CENTER TAB */}
      {/* ==================================================================== */}
      {activeTab === 'recalls' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Product Recall & Quarantine Incident Center
                </h3>
                <p className="text-xs text-slate-400">
                  Instant batch quarantine execution across all hospital locations with patient exposure identification.
                </p>
              </div>
              <button
                onClick={() => setIsRecallModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer"
              >
                Initiate Emergency Recall
              </button>
            </div>

            <div className="space-y-4">
              {recallCases.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  No active recall cases logged. All medical supplies and implants currently verified compliant.
                </div>
              ) : (
                recallCases.map((rec) => (
                  <div
                    key={rec.recallId}
                    className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 text-xs space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-rose-700 text-sm">
                            {rec.recallCaseNumber}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px]">
                            {rec.severity}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1">
                          {rec.itemName} ({rec.itemCode})
                        </p>
                      </div>

                      <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px]">
                        {rec.status}
                      </span>
                    </div>

                    <p className="text-slate-600 dark:text-slate-300">
                      Reason: <span className="font-medium text-slate-800 dark:text-slate-200">{rec.recallReason}</span>
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-rose-200/60 dark:border-rose-900/60">
                      <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-[11px] font-bold text-rose-700 block mb-1">
                          Hospital Stock Quarantined ({rec.quarantinedQuantityAcrossStores} units)
                        </span>
                        {rec.quarantinedLocationBreakdown?.map((loc, idx) => (
                          <div key={idx} className="flex justify-between text-[11px] py-0.5 text-slate-600">
                            <span>{loc.locationName}</span>
                            <span className="font-bold">{loc.quarantinedQuantity} units</span>
                          </div>
                        ))}
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-[11px] font-bold text-rose-700 block mb-1">
                          Exposed Patients Identified ({rec.identifiedPatientExposuresCount})
                        </span>
                        {rec.affectedPatients?.map((pat, idx) => (
                          <div key={idx} className="text-[11px] py-0.5 text-slate-600 flex justify-between">
                            <span>
                              {pat.patientName} ({pat.patientMRN})
                            </span>
                            <span className="text-rose-600 font-medium">Notification Pending</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 10. SUPPLIERS & 3-WAY MATCH TAB */}
      {/* ==================================================================== */}
      {activeTab === 'suppliers' && (
        <div className="space-y-6">
          {/* 30-Day Supplier On-Time Delivery & Latency Performance Widget */}
          <ScmSupplierOnTimeDeliveryWidget
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            grns={grns}
          />

          {/* Supplier Reliability Metrics Radar Chart (On-Time Delivery vs Order Accuracy) */}
          <ScmSupplierRadarChart suppliers={suppliers} />

          {/* 3-Way Match Verification Center */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
              Three-Way Invoice Matching (PO + GRN + Invoice)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Automated financial reconciliation preventing phantom billing and quantity mismatches.
            </p>

            <div className="space-y-3">
              {threeWayMatches.map((m) => (
                <div
                  key={m.matchId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Invoice {m.invoiceNumber}
                      </span>
                      <span className="text-slate-400 font-mono">PO: {m.poNumber}</span>
                      <span className="text-slate-400 font-mono">GRN: {m.grnNumber}</span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        m.matchStatus === 'FULLY_MATCHED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {m.matchStatus}
                    </span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Supplier</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {m.supplierName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">PO Total</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        ${m.totalPoAmount.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Billed Total</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        ${m.totalInvoiceAmount.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Net Variance</span>
                      <span
                        className={`font-bold ${
                          m.netVariance === 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        ${m.netVariance}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Supplier Directory & Scorecards */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">
              Supplier Directory & Explainable Performance Scorecards
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suppliers.map((sup) => (
                <div
                  key={sup.supplierId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {sup.displayName}
                      </h4>
                      <p className="text-slate-500">{sup.contactPerson}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-600">
                        {sup.scorecard?.overallExplainableScore || 95}
                        <span className="text-xs text-slate-400"> / 100</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Weighted Score</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px]">
                    <div>
                      <span className="text-slate-400 block text-[10px]">On-Time</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {sup.scorecard?.onTimeDeliveryRatePercent || 95}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Quality</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {sup.scorecard?.qualityAcceptanceRatePercent || 99}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Fill Rate</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {sup.scorecard?.fillRatePercent || 98}%
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 italic">
                    {sup.scorecard?.scoringFormulaExplanation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 11. AI ADVISORY & FORECASTING TAB */}
      {/* ==================================================================== */}
      {activeTab === 'ai_advisory' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                SCM AI Copilot & Predictive Demand Advisor
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Explainable clinical demand forecasting, shrinkage anomaly detection, and replenishment optimization.
            </p>

            <div className="space-y-3">
              {[
                {
                  type: 'DEMAND_FORECAST',
                  item: 'Ceftriaxone Sodium 1g Injection',
                  code: 'MED-CEF-1G',
                  urgency: 'HIGH',
                  headline: 'Projected 38% Surge in ICU Anti-Infective Consumption',
                  explanation:
                    'Historical sepsis admissions rise sharply in Q3. Current stock cover is only 8.2 days based on projected ICU bed occupancy.',
                  recommendation: 'Order 150 vials immediately to prevent acute stockout by next Tuesday.',
                  dataPoints: ['ICU Bed Occupancy Trend', 'Historical Seasonal Usage', 'Supplier Lead Time: 3 days'],
                },
                {
                  type: 'EXPIRY_RISK',
                  item: 'Ceftriaxone Sodium 1g (Batch LOT-CEF-2026A)',
                  code: 'MED-CEF-1G',
                  urgency: 'MEDIUM',
                  headline: '22 Vials Expiring in 15 Days (FEFO Prioritization Required)',
                  explanation:
                    'Batch LOT-CEF-2026A will expire on March 20. Current consumption rate ensures complete utilization if prioritized in Inpatient Pharmacy.',
                  recommendation: 'Route all upcoming internal requisitions to LOT-CEF-2026A before dispensing fresh LOT-CEF-2026B.',
                  dataPoints: ['Expiry Countdown: 15 Days', 'Daily Ward Usage: 3.5 vials/day'],
                },
                {
                  type: 'ANOMALY_DETECTION',
                  item: 'Insulin Glargine 100 U/mL (Batch LOT-INS-9884X)',
                  code: 'MED-INS-GLA',
                  urgency: 'CRITICAL',
                  headline: 'Cold-Chain Data Logger Breach: Temperature Excursion Hold',
                  explanation:
                    'Courier data-logger recorded 14.8°C for 6.5 hours during road transit, exceeding the 2°C - 8°C protein stability limit.',
                  recommendation: 'Keep all 20 units in Bio-Medical Quarantine Store. Return to supplier under GDP warranty clause.',
                  dataPoints: ['Data-Logger URI: LOG-SFI-4410', 'EMA GDP Protocol Annex 2'],
                },
              ].map((rec, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-2.5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          rec.urgency === 'CRITICAL'
                            ? 'bg-rose-100 text-rose-800'
                            : rec.urgency === 'HIGH'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {rec.type} • {rec.urgency}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1">
                        {rec.headline}
                      </h4>
                    </div>
                  </div>

                  <p className="text-slate-600 dark:text-slate-300">{rec.explanation}</p>

                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-medium">
                    <span className="text-indigo-600 font-bold mr-1">Action Recommendation:</span>
                    {rec.recommendation}
                  </div>

                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                    <span>Evidence Used:</span>
                    {rec.dataPoints.map((dp, dIdx) => (
                      <span
                        key={dIdx}
                        className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500"
                      >
                        {dp}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODALS */}
      {/* ==================================================================== */}

      {/* 1. Mobile Camera Barcode & QR Rapid Inventory Scanner */}
      <ScmMobileBarcodeScanner
        tenantId={tenantId}
        items={items}
        batches={batches}
        locations={locations}
        balances={balances}
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onStockUpdated={loadData}
      />

      {/* 2. New Purchase Requisition Modal */}
      {isNewRequisitionOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Create Clinical Purchase Requisition (PR)
              </h3>
              <button
                onClick={() => setIsNewRequisitionOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Select Item from Master:</label>
                <select
                  value={reqSelectedItem}
                  onChange={(e) => setReqSelectedItem(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                >
                  <option value="">-- Choose Item --</option>
                  {items.map((i) => (
                    <option key={i.itemId} value={i.itemId}>
                      {i.name} ({i.itemCode}) — Unit Cost: ${i.unitCost}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Requested Quantity:</label>
                  <input
                    type="number"
                    min="1"
                    value={reqQuantity}
                    onChange={(e) => setReqQuantity(parseInt(e.target.value, 10) || 1)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Priority Level:</label>
                  <select
                    value={reqPriority}
                    onChange={(e) =>
                      setReqPriority(e.target.value as 'NORMAL' | 'URGENT' | 'EMERGENCY')
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="NORMAL">Normal (Routine Replenishment)</option>
                    <option value="URGENT">Urgent (&lt;3 Days Buffer)</option>
                    <option value="EMERGENCY">Emergency (Life-Saving Override)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Clinical Justification:</label>
                <textarea
                  rows={2}
                  value={reqJustification}
                  onChange={(e) => setReqJustification(e.target.value)}
                  placeholder="State clinical rationale, expected patient surge, or upcoming surgery..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsNewRequisitionOpen(false)}
                className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRequisition}
                disabled={!reqSelectedItem}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                Submit for Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Issue Stock Modal */}
      {isStockIssueOpen && issueItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                FEFO Stock Issue: {issueItem.name}
              </h3>
              <button
                onClick={() => setIsStockIssueOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Recipient Ward / Store:</label>
                <input
                  type="text"
                  value={issueRecipient}
                  onChange={(e) => setIssueRecipient(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">
                  Quantity to Issue ({issueItem.unitOfMeasure}):
                </label>
                <input
                  type="number"
                  min="1"
                  value={issueQty}
                  onChange={(e) => setIssueQty(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-[11px] text-blue-900 dark:text-blue-300">
                FEFO Engine will automatically pick the earliest-expiring viable batch. Expired, quarantined, or recalled batches are strictly bypassed.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsStockIssueOpen(false)}
                className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteStockIssue}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm FEFO Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Emergency Recall Modal */}
      {isRecallModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-rose-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                Initiate Emergency Batch Recall
              </h3>
              <button
                onClick={() => setIsRecallModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Executing this action will immediately lock and quarantine all matching stock across all hospital stores and identify every patient who received the batch.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Target Batch Number:</label>
                <select
                  value={recallBatchNum}
                  onChange={(e) => setRecallBatchNum(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                >
                  <option value="">-- Choose Batch to Recall --</option>
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchNumber}>
                      {b.batchNumber} — {b.itemName} ({b.quantityRemaining} units remaining)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Reason for Recall:</label>
                <textarea
                  rows={3}
                  value={recallReason}
                  onChange={(e) => setRecallReason(e.target.value)}
                  placeholder="e.g. Manufacturer Class I safety notice for particulate matter contamination..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsRecallModalOpen(false)}
                className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleTriggerBatchRecall}
                disabled={!recallBatchNum || !recallReason}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                Execute Recall & Quarantine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Inbound Goods Receiving (GRN) Modal */}
      {isNewGrnOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Receive Inbound Goods (GRN & Batch Registration)
                </h3>
              </div>
              <button
                onClick={() => setIsNewGrnOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Captures dock receiving inspection with mandatory batch, lot, manufacture, and expiration dates. Automatically posts immutable stock ledger and balance updates.
            </p>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Purchase Order #:</label>
                  <select
                    value={grnPoNumber}
                    onChange={(e) => setGrnPoNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="">-- Select receivable PO --</option>
                    {purchaseOrders
                      .filter((po) =>
                        ['APPROVED', 'SENT', 'SENT_TO_SUPPLIER', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED'].includes(po.status)
                      )
                      .map((po) => (
                        <option key={po.poId} value={po.poNumber}>
                          {po.poNumber} — {po.supplierName}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Delivery Note / AWB #:</label>
                  <input
                    type="text"
                    value={grnDeliveryNote}
                    onChange={(e) => setGrnDeliveryNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Supplier / Vendor:</label>
                  <input
                    type="text"
                    value={
                      purchaseOrders.find((po) => po.poNumber === grnPoNumber)
                        ?.supplierName || grnSupplierName
                    }
                    readOnly
                    aria-readonly="true"
                    className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Item from Master:</label>
                  <select
                    value={grnItemId || (items[0]?.itemId ?? '')}
                    onChange={(e) => setGrnItemId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  >
                    {items.map((it) => (
                      <option key={it.itemId} value={it.itemId}>
                        {it.name} ({it.itemCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Batch / Lot #:</label>
                  <input
                    type="text"
                    value={grnBatchNumber}
                    onChange={(e) => setGrnBatchNumber(e.target.value)}
                    placeholder="e.g. LOT-2026-N201"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Manufacture Date:</label>
                  <input
                    type="date"
                    value={grnManufactureDate}
                    onChange={(e) => setGrnManufactureDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Expiration Date:</label>
                  <input
                    type="date"
                    value={grnExpirationDate}
                    onChange={(e) => setGrnExpirationDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Quantity Received:</label>
                  <input
                    type="number"
                    min="1"
                    value={grnQuantity}
                    onChange={(e) => setGrnQuantity(parseInt(e.target.value, 10) || 1)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Dock Temp (°C):</label>
                  <input
                    type="number"
                    step="0.1"
                    value={grnTempCelsius}
                    onChange={(e) => setGrnTempCelsius(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Dock QA Status:</label>
                  <select
                    value={grnInspectionStatus}
                    onChange={(e) => setGrnInspectionStatus(e.target.value as 'PASSED' | 'FAILED')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="PASSED">Passed Inspection (Available)</option>
                    <option value="FAILED">Failed / Excursion (Quarantine)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewGrnOpen(false)}
                className="px-3.5 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGoodsReceiptNote}
                disabled={isSubmittingGrn || !grnBatchNumber}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isSubmittingGrn ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Recording GRN...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Accept & Post Goods Receipt
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Standardized Inventory Label Generator Modal */}
      <ScmItemDetailQrModal
        item={selectedQrItem}
        isOpen={isQrModalOpen}
        onClose={() => {
          setIsQrModalOpen(false);
          setSelectedQrItem(null);
        }}
        balances={balances}
        batches={batches}
        locations={locations}
        tenantId={tenantId}
      />
    </div>
  );
}
