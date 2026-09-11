'use client';

import React, { useState, useMemo } from 'react';
import {
  ItemMaster,
  BatchLotRecord,
  StockTransaction,
  InventoryLocation,
  InventoryBalance,
} from '@/types/scm-domain';
import {
  recordStockTransaction,
  createBatchRecord,
} from '@/lib/firebase/services/scm-firestore-service';
import {
  Layers,
  Boxes,
  Clock,
  Calendar,
  Search,
  Filter,
  Plus,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Activity,
  ArrowRight,
  ShieldCheck,
  ThermometerSnowflake,
  ShieldAlert,
  QrCode,
} from 'lucide-react';

interface ScmBatchTrackingLedgerProps {
  tenantId: string;
  items: ItemMaster[];
  batches: BatchLotRecord[];
  transactions: StockTransaction[];
  locations: InventoryLocation[];
  balances: InventoryBalance[];
  onRefresh: () => Promise<void>;
  onOpenQrLabel?: (item: ItemMaster) => void;
}

export function ScmBatchTrackingLedger({
  tenantId,
  items,
  batches,
  transactions,
  locations,
  balances,
  onRefresh,
  onOpenQrLabel,
}: ScmBatchTrackingLedgerProps) {
  const [viewMode, setViewMode] = useState<'LEDGER' | 'ITEM_MASTER' | 'BATCH_REGISTRY'>('LEDGER');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');

  // Register New Batch Modal
  const [isNewBatchOpen, setIsNewBatchOpen] = useState(false);
  const [batchItemId, setBatchItemId] = useState(items[0]?.itemId || '');
  const [batchNumberInput, setBatchNumberInput] = useState('');
  const [batchMfgDate, setBatchMfgDate] = useState(new Date().toISOString().split('T')[0]);
  const [batchExpDate, setBatchExpDate] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]
  );
  const [batchQty, setBatchQty] = useState(100);
  const [batchManufacturer, setBatchManufacturer] = useState('Pfizer BioPharma Ltd');
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);

  // Quick Transaction Modal with Batch Details
  const [isNewTxnOpen, setIsNewTxnOpen] = useState(false);
  const [txnItemId, setTxnItemId] = useState(items[0]?.itemId || '');
  const [txnType, setTxnType] = useState<StockTransaction['transactionType']>('ISSUE');
  const [txnBatchId, setTxnBatchId] = useState('');
  const [txnFromLoc, setTxnFromLoc] = useState(locations[0]?.locationId || '');
  const [txnToLoc, setTxnToLoc] = useState(locations[1]?.locationId || locations[0]?.locationId || '');
  const [txnQty, setTxnQty] = useState(5);
  const [txnReason, setTxnReason] = useState('ROUTINE_WARD_DISPENSE');
  const [isSubmittingTxn, setIsSubmittingTxn] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Target item for new batch
  const selectedBatchItem = useMemo(() => {
    return items.find((i) => i.itemId === batchItemId) || items[0];
  }, [items, batchItemId]);

  // Target item for transaction
  const selectedTxnItem = useMemo(() => {
    return items.find((i) => i.itemId === txnItemId) || items[0];
  }, [items, txnItemId]);

  // Batches for transaction item
  const txnAvailableBatches = useMemo(() => {
    return batches.filter((b) => b.itemId === txnItemId);
  }, [batches, txnItemId]);

  // Filtered Transactions for Stock Ledger
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const matchItem = selectedItemFilter === 'ALL' || tx.itemId === selectedItemFilter;
      const matchType = selectedTypeFilter === 'ALL' || tx.transactionType === selectedTypeFilter;
      const q = searchQuery.toLowerCase();
      const matchQuery =
        tx.itemName.toLowerCase().includes(q) ||
        tx.itemCode.toLowerCase().includes(q) ||
        (tx.batchNumber || '').toLowerCase().includes(q) ||
        (tx.batchId || '').toLowerCase().includes(q) ||
        (tx.referenceId || '').toLowerCase().includes(q) ||
        (tx.performedBy?.userName || '').toLowerCase().includes(q);

      return matchItem && matchType && matchQuery;
    });
  }, [transactions, selectedItemFilter, selectedTypeFilter, searchQuery]);

  // Filtered Item Master
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const q = searchQuery.toLowerCase();
      return (
        it.name.toLowerCase().includes(q) ||
        it.itemCode.toLowerCase().includes(q) ||
        (it.categoryId || '').toLowerCase().includes(q) ||
        (it.itemType || '').toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  // Handle Register New Batch
  const handleRegisterNewBatch = async () => {
    if (!selectedBatchItem || !batchNumberInput.trim()) return;
    setIsSubmittingBatch(true);
    setFeedback(null);

    const newBatchId = `btc-${Date.now()}`;
    const newBatch: BatchLotRecord = {
      batchId: newBatchId,
      tenantId,
      itemId: selectedBatchItem.itemId,
      itemCode: selectedBatchItem.itemCode,
      itemName: selectedBatchItem.name,
      batchNumber: batchNumberInput.trim().toUpperCase(),
      manufacturer: batchManufacturer,
      manufactureDate: new Date(batchMfgDate).toISOString(),
      expiryDate: new Date(batchExpDate).toISOString(),
      receivedDate: new Date().toISOString(),
      supplierId: 'vnd-direct',
      supplierName: 'Direct Manufacturer / Primary Distributor',
      unitCost: selectedBatchItem.unitCost,
      currency: 'USD',
      quantityReceived: batchQty,
      quantityRemaining: batchQty,
      quantityReserved: 0,
      storageCondition: selectedBatchItem.storageRequirements || 'Standard Climate Controlled',
      status: 'AVAILABLE',
      temperatureExcursionDetected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await createBatchRecord(tenantId, newBatch, {
        userId: 'usr_dock_inspector',
        userName: 'David Miller (Receiving QA)',
        role: 'Dock Inspector',
      });
      setFeedback({
        type: 'success',
        text: `Batch ${newBatch.batchNumber} registered for ${selectedBatchItem.name}. Expiry tracked: ${batchExpDate}.`,
      });
      setIsNewBatchOpen(false);
      setBatchNumberInput('');
      await onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to register batch.',
      });
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  // Handle Record Stock Transaction
  const handleRecordStockTransaction = async () => {
    if (!selectedTxnItem || txnQty <= 0) return;
    setIsSubmittingTxn(true);
    setFeedback(null);

    const chosenBatch = batches.find((b) => b.batchId === txnBatchId) || txnAvailableBatches[0];
    const fromLocation = locations.find((l) => l.locationId === txnFromLoc) || locations[0];
    const toLocation = locations.find((l) => l.locationId === txnToLoc) || locations[1] || locations[0];

    const txnId = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTxn: StockTransaction = {
      transactionId: txnId,
      tenantId,
      facilityId: 'FAC-MAIN',
      itemId: selectedTxnItem.itemId,
      itemCode: selectedTxnItem.itemCode,
      itemName: selectedTxnItem.name,
      batchId: chosenBatch?.batchId,
      batchNumber: chosenBatch?.batchNumber || 'LOT-STANDARD',
      manufactureDate: chosenBatch?.manufactureDate,
      expirationDate: chosenBatch?.expiryDate,
      fromLocationId: fromLocation?.locationId || 'loc-pharmacy-main',
      fromLocationName: fromLocation?.name || 'Inpatient Central Pharmacy',
      toLocationId: toLocation?.locationId || 'loc-icu-hub',
      toLocationName: toLocation?.name || 'ICU Ward Hub',
      quantity: txnQty,
      uom: selectedTxnItem.unitOfMeasure,
      normalizedQuantity: txnQty,
      unitCost: selectedTxnItem.unitCost,
      totalCost: Math.round(selectedTxnItem.unitCost * txnQty * 100) / 100,
      currency: 'USD',
      transactionType: txnType,
      referenceType: 'INTERNAL_REQUEST',
      referenceId: `REF-${Date.now().toString().slice(-6)}`,
      reasonCode: txnReason,
      performedBy: {
        userId: 'usr_staff_pharmacist',
        userName: 'Elena Rostova, CPIM',
        role: 'Hospital SCM Specialist',
      },
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      idempotencyKey: `idemp-${txnId}`,
      source: 'ONLINE',
    };

    try {
      await recordStockTransaction(tenantId, newTxn);
      setFeedback({
        type: 'success',
        text: `Stock transaction recorded! Moved ${txnQty} ${selectedTxnItem.unitOfMeasure} of ${selectedTxnItem.name} (Batch: ${newTxn.batchNumber}, Exp: ${newTxn.expirationDate ? newTxn.expirationDate.split('T')[0] : 'N/A'}).`,
      });
      setIsNewTxnOpen(false);
      await onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to record stock transaction.',
      });
    } finally {
      setIsSubmittingTxn(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Feedback */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            )}
            <span className="font-semibold">{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="underline ml-4 cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Top Banner & Mode Selector */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 border border-blue-200 dark:border-blue-900">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Item Master & Stock Movement Ledger
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold font-mono">
                  Batch & Lot Traced
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                End-to-end traceability capturing batchId, manufactureDate, and expirationDate on every hospital stock movement.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewMode('LEDGER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                viewMode === 'LEDGER'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Stock Ledger
            </button>
            <button
              onClick={() => setViewMode('ITEM_MASTER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                viewMode === 'ITEM_MASTER'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Item Master Catalog
            </button>
          </div>

          <button
            onClick={() => setIsNewBatchOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-slate-200 dark:border-slate-700"
          >
            <Plus className="w-4 h-4" />
            Register Batch / Lot
          </button>

          <button
            onClick={() => setIsNewTxnOpen(true)}
            className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Activity className="w-4 h-4" />
            Record Movement
          </button>
        </div>
      </div>

      {/* VIEW 1: IMMUTABLE STOCK LEDGER WITH BATCH/MFG/EXP TRACKING */}
      {viewMode === 'LEDGER' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Item, Batch, Lot #, Ref..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Filter Item:</label>
              <select
                value={selectedItemFilter}
                onChange={(e) => setSelectedItemFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <option value="ALL">All Items ({items.length})</option>
                {items.map((it) => (
                  <option key={it.itemId} value={it.itemId}>
                    {it.name}
                  </option>
                ))}
              </select>

              <label className="text-xs text-slate-500 font-semibold whitespace-nowrap ml-2">Type:</label>
              <select
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <option value="ALL">All Movements</option>
                <option value="RECEIPT">RECEIPT</option>
                <option value="ISSUE">ISSUE</option>
                <option value="TRANSFER_IN">TRANSFER_IN</option>
                <option value="TRANSFER_OUT">TRANSFER_OUT</option>
                <option value="ADJUSTMENT_IN">ADJUSTMENT_IN</option>
                <option value="ADJUSTMENT_OUT">ADJUSTMENT_OUT</option>
                <option value="CONSUMPTION">CONSUMPTION</option>
              </select>
            </div>
          </div>

          {/* Master Ledger Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  Append-Only Stock Ledger (Audit Traced)
                </h3>
                <p className="text-xs text-slate-400">
                  Every entry captures batchId, manufactureDate, and expirationDate
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 font-semibold">
                {filteredTransactions.length} Transactions
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Movement Type</th>
                    <th className="p-3">Item Code & Name</th>
                    <th className="p-3">Batch / Lot #</th>
                    <th className="p-3">Mfg Date</th>
                    <th className="p-3">Expiration Date</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3">From &rarr; To Location</th>
                    <th className="p-3">Performed By</th>
                    <th className="p-3 font-mono">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.transactionId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="p-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {new Date(tx.recordedAt).toLocaleString([], {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            tx.transactionType === 'RECEIPT' || tx.transactionType === 'TRANSFER_IN'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : tx.transactionType === 'ISSUE' || tx.transactionType === 'CONSUMPTION'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                          }`}
                        >
                          {tx.transactionType}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {tx.itemName}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {tx.itemCode}
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {tx.batchNumber || '—'}
                        </span>
                        {tx.batchId && (
                          <span className="text-[10px] text-slate-400 block">
                            ID: {tx.batchId}
                          </span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {tx.manufactureDate ? tx.manufactureDate.split('T')[0] : '—'}
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-[11px]">
                        {tx.expirationDate ? (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">
                            {tx.expirationDate.split('T')[0]}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {tx.quantity} <span className="text-slate-400 font-normal">{tx.uom}</span>
                      </td>
                      <td className="p-3 max-w-xs text-slate-600 dark:text-slate-300 text-[11px]">
                        <div>{tx.fromLocationName || 'Dock'}</div>
                        <div className="text-slate-400">&darr; {tx.toLocationName || 'Dispense'}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap text-slate-500">
                        {tx.performedBy.userName}
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-[10px] text-slate-400">
                        {tx.referenceId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: ITEM MASTER CATALOG WITH TRACEABILITY PROFILES */}
      {viewMode === 'ITEM_MASTER' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-500" />
                Hospital Item Master & Traceability Classification
              </h3>
              <p className="text-xs text-slate-400">
                Governance parameters for batch, expiry, and cold-chain compliance
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {filteredItems.length} Registered Items
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="p-3">Item Code & Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Criticality</th>
                  <th className="p-3">Batch Tracking</th>
                  <th className="p-3">Expiry Tracking</th>
                  <th className="p-3">Cold Chain</th>
                  <th className="p-3 text-right">Standard Cost</th>
                  <th className="p-3 text-right">Safety Stock</th>
                  <th className="p-3 text-center">Label / Barcode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((it) => (
                  <tr key={it.itemId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {it.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {it.itemCode} • UOM: {it.unitOfMeasure}
                      </div>
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">
                      {it.categoryId || it.itemType}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          it.criticality === 'VITAL'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            : it.criticality === 'ESSENTIAL'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {it.criticality}
                      </span>
                    </td>
                    <td className="p-3">
                      {it.requiresBatchTracking ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mandated
                        </span>
                      ) : (
                        <span className="text-slate-400">Optional</span>
                      )}
                    </td>
                    <td className="p-3">
                      {it.requiresExpiryTracking ? (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> FEFO Mandate
                        </span>
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-3">
                      {(it.storageRequirements || '').includes('2°C') || (it.storageRequirements || '').includes('Refrigerated') ? (
                        <span className="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1">
                          <ThermometerSnowflake className="w-3.5 h-3.5" /> {it.storageRequirements}
                        </span>
                      ) : (
                        <span className="text-slate-500">{it.storageRequirements || 'Standard Ambient'}</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-bold text-slate-900 dark:text-slate-100">
                      ${it.unitCost}
                    </td>
                    <td className="p-3 text-right text-slate-600 dark:text-slate-300 font-medium">
                      {it.reorderPoint} {it.unitOfMeasure}
                    </td>
                    <td className="p-3 text-center">
                      {onOpenQrLabel && (
                        <button
                          type="button"
                          onClick={() => onOpenQrLabel(it)}
                          title={`Generate & Print Standardized QR Label for ${it.name}`}
                          className="px-2 py-1 rounded-lg text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-semibold border border-slate-200 dark:border-slate-700"
                        >
                          <QrCode className="w-3.5 h-3.5 text-blue-600" />
                          <span>QR Label</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Register New Batch */}
      {isNewBatchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-600" />
                Register New Medical Batch / Lot
              </h3>
              <button
                onClick={() => setIsNewBatchOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Item Master:
                </label>
                <select
                  value={batchItemId}
                  onChange={(e) => setBatchItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {items.map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {it.name} ({it.itemCode})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Batch / Lot Number:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. LOT-2026-XYZ"
                    value={batchNumberInput}
                    onChange={(e) => setBatchNumberInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Initial Lot Quantity:
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={batchQty}
                    onChange={(e) => setBatchQty(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Manufacture Date:
                  </label>
                  <input
                    type="date"
                    value={batchMfgDate}
                    onChange={(e) => setBatchMfgDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Expiration Date:
                  </label>
                  <input
                    type="date"
                    value={batchExpDate}
                    onChange={(e) => setBatchExpDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Manufacturer / Certified Supplier:
                </label>
                <input
                  type="text"
                  value={batchManufacturer}
                  onChange={(e) => setBatchManufacturer(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsNewBatchOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={isSubmittingBatch || !batchNumberInput.trim()}
                onClick={handleRegisterNewBatch}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shadow-xs transition-colors"
              >
                {isSubmittingBatch ? 'Registering...' : 'Register Batch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Record Stock Transaction with Full Batch Metadata */}
      {isNewTxnOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600" />
                Record Stock Transaction (Batch Traced)
              </h3>
              <button
                onClick={() => setIsNewTxnOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Item:
                </label>
                <select
                  value={txnItemId}
                  onChange={(e) => {
                    setTxnItemId(e.target.value);
                    setTxnBatchId('');
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {items.map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {it.name} ({it.itemCode})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Movement Type:
                  </label>
                  <select
                    value={txnType}
                    onChange={(e) => setTxnType(e.target.value as typeof txnType)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <option value="ISSUE">ISSUE (Ward Dispense)</option>
                    <option value="RECEIPT">RECEIPT (Goods In)</option>
                    <option value="TRANSFER_IN">TRANSFER_IN</option>
                    <option value="TRANSFER_OUT">TRANSFER_OUT</option>
                    <option value="CONSUMPTION">CONSUMPTION (Patient Use)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Allocated Batch / Lot:
                  </label>
                  <select
                    value={txnBatchId}
                    onChange={(e) => setTxnBatchId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    {txnAvailableBatches.length > 0 ? (
                      txnAvailableBatches.map((b) => (
                        <option key={b.batchId} value={b.batchId}>
                          {b.batchNumber} (Exp: {b.expiryDate.split('T')[0]})
                        </option>
                      ))
                    ) : (
                      <option value="">LOT-GENERAL</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    From Location:
                  </label>
                  <select
                    value={txnFromLoc}
                    onChange={(e) => setTxnFromLoc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    {locations.map((loc) => (
                      <option key={loc.locationId} value={loc.locationId}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    To Location / Ward:
                  </label>
                  <select
                    value={txnToLoc}
                    onChange={(e) => setTxnToLoc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    {locations.map((loc) => (
                      <option key={loc.locationId} value={loc.locationId}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Quantity:
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={txnQty}
                    onChange={(e) => setTxnQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Reason Code:
                  </label>
                  <select
                    value={txnReason}
                    onChange={(e) => setTxnReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <option value="ROUTINE_WARD_DISPENSE">ROUTINE_WARD_DISPENSE</option>
                    <option value="EMERGENCY_RESTOCK">EMERGENCY_RESTOCK</option>
                    <option value="SURGERY_TRAY_ALLOCATION">SURGERY_TRAY_ALLOCATION</option>
                    <option value="GOODS_RECEIPT_STOW">GOODS_RECEIPT_STOW</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsNewTxnOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={isSubmittingTxn}
                onClick={handleRecordStockTransaction}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-xs transition-colors"
              >
                {isSubmittingTxn ? 'Recording...' : 'Commit Stock Movement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
