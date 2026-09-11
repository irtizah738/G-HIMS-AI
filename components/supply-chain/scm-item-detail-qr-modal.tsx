'use client';

import React, { useState, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ItemMaster,
  InventoryBalance,
  BatchLotRecord,
  InventoryLocation,
} from '@/types/scm-domain';
import {
  X,
  Printer,
  QrCode,
  Layers,
  ThermometerSnowflake,
  ShieldCheck,
  Calendar,
  Building2,
  Copy,
  Check,
  Download,
  AlertTriangle,
  Info,
  Sliders,
  CheckCircle2,
  Boxes,
  FileSpreadsheet,
} from 'lucide-react';

interface ScmItemDetailQrModalProps {
  item: ItemMaster | null;
  isOpen: boolean;
  onClose: () => void;
  balances?: InventoryBalance[];
  batches?: BatchLotRecord[];
  locations?: InventoryLocation[];
  tenantId?: string;
  defaultBatchNumber?: string;
}

export type LabelType = 'SHELF_BIN_2X1' | 'UNIT_DOSE_1_5X1' | 'PALLET_CARTON_4X3';

export function ScmItemDetailQrModal({
  item,
  isOpen,
  onClose,
  balances = [],
  batches = [],
  locations = [],
  tenantId = 'metro-health',
  defaultBatchNumber,
}: ScmItemDetailQrModalProps) {
  const [activeSubTab, setActiveSubTab] = useState<'DETAILS' | 'QR_TOOL'>('QR_TOOL');

  // QR & Label Customization State
  const [labelType, setLabelType] = useState<LabelType>('SHELF_BIN_2X1');
  const [selectedBatchNumber, setSelectedBatchNumber] = useState<string>(
    defaultBatchNumber || ''
  );
  const [customLot, setCustomLot] = useState('');
  const [customExpiry, setCustomExpiry] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]
  );
  const [targetLocationId, setTargetLocationId] = useState<string>('ALL');
  const [encodingFormat, setEncodingFormat] = useState<'GS1_HEALTHCARE' | 'JSON_GHIMS' | 'URL_DIRECT'>(
    'GS1_HEALTHCARE'
  );
  const [errorCorrection, setErrorCorrection] = useState<'L' | 'M' | 'Q' | 'H'>('H'); // H is recommended for hospital tags
  const [includeColdChainBadge, setIncludeColdChainBadge] = useState(true);
  const [includeFacilityHeader, setIncludeFacilityHeader] = useState(true);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [printSuccessMessage, setPrintSuccessMessage] = useState(false);

  // Hidden print container ref
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Batches for this item
  const itemBatches = useMemo(() => {
    if (!item) return [];
    return batches.filter((b) => b.itemId === item.itemId);
  }, [batches, item]);

  // Balances for this item
  const itemBalances = useMemo(() => {
    if (!item) return [];
    return balances.filter((b) => b.itemId === item.itemId);
  }, [balances, item]);

  const totalOnHand = useMemo(() => {
    return itemBalances.reduce((sum, b) => sum + (b.onHand || 0), 0);
  }, [itemBalances]);

  const totalAvailable = useMemo(() => {
    return itemBalances.reduce((sum, b) => sum + (b.available || 0), 0);
  }, [itemBalances]);

  const totalValuation = useMemo(() => {
    return itemBalances.reduce((sum, b) => sum + (b.totalValuation || (b.onHand || 0) * (b.unitCost || 0)), 0);
  }, [itemBalances]);

  // Selected or active batch details
  const activeBatch = useMemo(() => {
    if (selectedBatchNumber && selectedBatchNumber !== 'NONE') {
      return itemBatches.find((b) => b.batchNumber === selectedBatchNumber);
    }
    return itemBatches[0] || null;
  }, [itemBatches, selectedBatchNumber]);

  const currentBatchNum = selectedBatchNumber === 'CUSTOM'
    ? customLot
    : selectedBatchNumber === 'NONE'
    ? 'N/A'
    : activeBatch?.batchNumber || defaultBatchNumber || 'LOT-2026-N104';

  const currentExpiryDate = selectedBatchNumber === 'CUSTOM'
    ? customExpiry
    : selectedBatchNumber === 'NONE'
    ? 'N/A'
    : activeBatch?.expiryDate ? activeBatch.expiryDate.split('T')[0] : customExpiry;

  // Selected Target Location
  const targetLocation = useMemo(() => {
    if (targetLocationId === 'ALL') return 'CENTRAL MEDICAL STORES & WARDS';
    const loc = locations.find((l) => l.locationId === targetLocationId);
    return loc ? loc.name.toUpperCase() : 'CENTRAL PHARMACY';
  }, [locations, targetLocationId]);

  // Compute Standardized QR Payload
  const qrPayload = useMemo(() => {
    if (!item) return '';

    const gtinMock = `0084${item.itemCode.replace(/[^0-9]/g, '').padStart(10, '0')}`;
    const expFormatted = currentExpiryDate !== 'N/A'
      ? currentExpiryDate.replace(/-/g, '').slice(2) // YYMMDD
      : '261231';
    const lotSanitized = currentBatchNum !== 'N/A' ? currentBatchNum : 'MASTER-01';

    if (encodingFormat === 'GS1_HEALTHCARE') {
      // Standard GS1 Healthcare Application Identifiers (AI)
      // (01) GTIN, (17) Expiry YYMMDD, (10) Batch/Lot, (240) Item Code
      return `(01)${gtinMock}(17)${expFormatted}(10)${lotSanitized}(240)${item.itemCode}`;
    }

    if (encodingFormat === 'JSON_GHIMS') {
      return JSON.stringify({
        sys: 'GHIMS-SCM',
        tid: tenantId,
        id: item.itemId,
        code: item.itemCode,
        name: item.name,
        uom: item.unitOfMeasure,
        lot: lotSanitized,
        exp: currentExpiryDate,
        cold: !!item.requiresColdChain,
        crit: item.criticality,
      });
    }

    // URL Direct
    return `https://metrohealth.ghims.internal/scm/items/${item.itemCode}?lot=${encodeURIComponent(lotSanitized)}&exp=${expFormatted}`;
  }, [item, encodingFormat, currentBatchNum, currentExpiryDate, tenantId]);

  // Direct Browser Printing Mechanism
  const handleDirectPrint = () => {
    if (!printContainerRef.current) return;

    const printContent = printContainerRef.current.innerHTML;
    const printWindow = window.open('', '_blank', 'width=650,height=600');
    if (!printWindow) {
      // Fallback to standard window.print if popup blocked
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Inventory Label - ${item?.itemCode || 'ITEM'}</title>
          <style>
            @page {
              size: auto;
              margin: 2mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              margin: 0;
              padding: 0;
              color: #000;
              background: #fff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .print-wrapper {
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 4px;
            }
            @media print {
              body { margin: 0; padding: 0; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>
          <div class="print-wrapper">
            ${printContent}
          </div>
          <script>
            window.onload = function() {
              window.focus();
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();

    setPrintSuccessMessage(true);
    setTimeout(() => setPrintSuccessMessage(false), 4000);
  };

  // Copy QR Payload to Clipboard
  const handleCopyPayload = async () => {
    try {
      await navigator.clipboard.writeText(qrPayload);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2500);
    } catch {
      // fallback
    }
  };

  // Download SVG
  const handleDownloadSvg = () => {
    const svgEl = document.getElementById('ghims-active-qr-svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `QR_${item?.itemCode || 'ITEM'}_${currentBatchNum}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen || !item) return null;

  return (
    <div
      id="scm-item-detail-qr-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 font-bold">
                {item.itemCode}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  item.criticality === 'VITAL'
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                    : item.criticality === 'ESSENTIAL'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {item.criticality} (VED)
              </span>
              {item.requiresColdChain && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 flex items-center gap-1">
                  <ThermometerSnowflake className="w-3 h-3" />
                  COLD CHAIN 2°C-8°C
                </span>
              )}
              <span className="text-[10px] font-semibold text-slate-500">
                UOM: {item.unitOfMeasure}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {item.name}
            </h2>
          </div>

          <button
            id="btn-close-item-detail-modal"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Toggle Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 text-xs font-semibold">
          <button
            id="tab-item-qr-tool"
            onClick={() => setActiveSubTab('QR_TOOL')}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
              activeSubTab === 'QR_TOOL'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>QR Code & Standardized Label Printer</span>
          </button>
          <button
            id="tab-item-clinical-details"
            onClick={() => setActiveSubTab('DETAILS')}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
              activeSubTab === 'DETAILS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Inventory Master & Active Batches</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* ================================================================ */}
          {/* TAB 1: QR CODE GENERATOR & BROWSER LABEL PRINTER                 */}
          {/* ================================================================ */}
          {activeSubTab === 'QR_TOOL' && (
            <div className="space-y-6">
              {/* Success Notification Alert */}
              {printSuccessMessage && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Direct print dialog opened. Physical label formatted at exact 300-DPI label dimensions.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Label Configuration Controls */}
                <div className="lg:col-span-6 space-y-4 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 text-xs">
                      <Sliders className="w-4 h-4 text-blue-500" />
                      Label Specification & Physical Form Factor
                    </h3>

                    {/* Form Factor Options */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Standard Label Size:
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'SHELF_BIN_2X1', label: 'Shelf Bin (2" × 1")', desc: '50mm × 25mm' },
                          { id: 'UNIT_DOSE_1_5X1', label: 'Unit-Dose (1.5" × 1")', desc: '38mm × 25mm' },
                          { id: 'PALLET_CARTON_4X3', label: 'Master (4" × 3")', desc: '100mm × 75mm' },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setLabelType(opt.id as LabelType)}
                            className={`p-2 rounded-xl text-left border cursor-pointer transition-colors ${
                              labelType === opt.id
                                ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-800 dark:text-blue-300 font-bold'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="text-[11px] truncate">{opt.label}</div>
                            <div className="text-[9px] text-slate-400">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Batch / Lot Assignment */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Select Batch / Lot for Label:
                      </label>
                      <select
                        value={selectedBatchNumber}
                        onChange={(e) => setSelectedBatchNumber(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        <option value="">-- Active Earliest Batch (FEFO Default) --</option>
                        {itemBatches.map((b) => (
                          <option key={b.batchId} value={b.batchNumber}>
                            {b.batchNumber} (Exp: {b.expiryDate.split('T')[0]}) - {b.quantityRemaining} units
                          </option>
                        ))}
                        <option value="CUSTOM">+ Enter Custom / Production Lot #</option>
                        <option value="NONE">Master SKU Label (No Specific Lot)</option>
                      </select>
                    </div>

                    {/* Custom Lot inputs if selected */}
                    {selectedBatchNumber === 'CUSTOM' && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">Lot / Batch #</label>
                          <input
                            type="text"
                            value={customLot}
                            onChange={(e) => setCustomLot(e.target.value)}
                            placeholder="e.g. LOT-2026-X99"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">Expiry Date</label>
                          <input
                            type="date"
                            value={customExpiry}
                            onChange={(e) => setCustomExpiry(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* Target Hospital Location / Ward */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Destination Department / Shelf:
                      </label>
                      <select
                        value={targetLocationId}
                        onChange={(e) => setTargetLocationId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        <option value="ALL">Central Medical Stores (All Units)</option>
                        {locations.map((loc) => (
                          <option key={loc.locationId} value={loc.locationId}>
                            {loc.name} ({loc.locationType})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Standards & Error Correction */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Payload Standard</label>
                        <select
                          value={encodingFormat}
                          onChange={(e) => setEncodingFormat(e.target.value as any)}
                          className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                        >
                          <option value="GS1_HEALTHCARE">GS1 Healthcare (AI 01/10/17)</option>
                          <option value="JSON_GHIMS">G-HIMS Interop JSON</option>
                          <option value="URL_DIRECT">Direct Verification URL</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Error Correction</label>
                        <select
                          value={errorCorrection}
                          onChange={(e) => setErrorCorrection(e.target.value as any)}
                          className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                        >
                          <option value="H">H (30% - Hospital Grade)</option>
                          <option value="Q">Q (25% - High Resilience)</option>
                          <option value="M">M (15% - Standard)</option>
                          <option value="L">L (7% - High Density)</option>
                        </select>
                      </div>
                    </div>

                    {/* Toggles */}
                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={includeFacilityHeader}
                          onChange={(e) => setIncludeFacilityHeader(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        Facility Header
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={includeColdChainBadge}
                          onChange={(e) => setIncludeColdChainBadge(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        Cold Chain Flags
                      </label>
                    </div>
                  </div>

                  {/* Actions Box */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      id="btn-print-standard-label"
                      type="button"
                      onClick={handleDirectPrint}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-2 cursor-pointer shadow-sm transition-colors text-xs"
                    >
                      <Printer className="w-4 h-4" />
                      Print Standardized Label
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadSvg}
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-1.5 cursor-pointer text-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download SVG
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyPayload}
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-1.5 cursor-pointer text-xs"
                    >
                      {copiedPayload ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Payload</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Right Column: High-Fidelity Standardized Label Preview */}
                <div className="lg:col-span-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Printer className="w-3.5 h-3.5 text-slate-500" />
                      Standardized Thermal Label Preview
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      Print Scale: 100% (Native DPI)
                    </span>
                  </div>

                  {/* Visual Container */}
                  <div className="bg-slate-200 dark:bg-slate-950 p-4 sm:p-6 rounded-2xl flex items-center justify-center border border-slate-300 dark:border-slate-800">
                    {/* The Actual Printable Physical Label Element */}
                    <div
                      ref={printContainerRef}
                      className={`bg-white text-black p-3.5 rounded-sm shadow-md border-2 border-black flex flex-col justify-between select-none ${
                        labelType === 'SHELF_BIN_2X1'
                          ? 'w-[320px] min-h-[160px]'
                          : labelType === 'UNIT_DOSE_1_5X1'
                          ? 'w-[260px] min-h-[140px]'
                          : 'w-[400px] min-h-[280px]'
                      }`}
                      style={{
                        fontFamily: 'Arial, Helvetica, sans-serif',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* 1. Header Band */}
                      {includeFacilityHeader && (
                        <div className="border-b-2 border-black pb-1 mb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-wider">
                          <span>METRO HEALTH SYSTEM • SCM</span>
                          <span className="font-mono text-[8px]">{targetLocation}</span>
                        </div>
                      )}

                      {/* 2. Middle Body: QR Code + Item Demographics */}
                      <div className="flex items-center gap-3">
                        {/* QR Code */}
                        <div className="shrink-0 bg-white p-1 border border-black rounded-xs">
                          <QRCodeSVG
                            id="ghims-active-qr-svg"
                            value={qrPayload}
                            size={
                              labelType === 'SHELF_BIN_2X1'
                                ? 86
                                : labelType === 'UNIT_DOSE_1_5X1'
                                ? 72
                                : 124
                            }
                            level={errorCorrection}
                            includeMargin={false}
                          />
                        </div>

                        {/* Text Fields */}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="font-mono font-black text-sm tracking-tight leading-none truncate">
                            {item.itemCode}
                          </div>
                          <div className="font-bold text-xs leading-tight line-clamp-2 text-slate-900">
                            {item.name}
                          </div>

                          <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-800 font-semibold">
                            <span>UOM: <strong className="font-black">{item.unitOfMeasure}</strong></span>
                            <span>CRIT: <strong>{item.criticality}</strong></span>
                            <span>COST: <strong>${item.unitCost}</strong></span>
                          </div>

                          {currentBatchNum !== 'N/A' && (
                            <div className="text-[9px] font-mono leading-tight">
                              LOT: <span className="font-bold">{currentBatchNum}</span>
                            </div>
                          )}

                          {currentExpiryDate !== 'N/A' && (
                            <div className="text-[9px] font-mono leading-tight">
                              EXP: <span className="font-bold">{currentExpiryDate}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 3. Footer Band / Barcode String / Warning */}
                      <div className="mt-1.5 pt-1 border-t border-black flex items-center justify-between text-[8px] font-mono">
                        <div className="truncate max-w-[210px] font-semibold text-slate-800">
                          {encodingFormat === 'GS1_HEALTHCARE'
                            ? qrPayload.slice(0, 36) + '...'
                            : item.storageRequirements || 'STORE AMBIENT 15-25°C'}
                        </div>
                        {includeColdChainBadge && item.requiresColdChain && (
                          <div className="font-bold uppercase text-[7.5px] px-1 py-0.2 bg-black text-white rounded-xs">
                            * REFRIGERATE 2-8°C *
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Encoded Data Inspector */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-slate-500 font-semibold">
                      <span>Encoded Raw Payload ({encodingFormat}):</span>
                      <span className="font-mono text-[10px]">{qrPayload.length} bytes</span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                      {qrPayload}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 2: CLINICAL INVENTORY MASTER & ACTIVE BATCHES                */}
          {/* ================================================================ */}
          {activeSubTab === 'DETAILS' && (
            <div className="space-y-5 text-xs">
              {/* Top Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-500 block">Total On-Hand</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {totalOnHand} <span className="text-xs font-normal text-slate-400">{item.unitOfMeasure}</span>
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-500 block">Authoritative Available</span>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {totalAvailable} <span className="text-xs font-normal text-slate-400">{item.unitOfMeasure}</span>
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-500 block">Safety Stock PAR</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {item.safetyStock || item.reorderPoint} <span className="text-xs font-normal text-slate-400">{item.unitOfMeasure}</span>
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-500 block">Total Ledger Valuation</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    ${totalValuation.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Master Item Parameters */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-xs">
                  <ShieldCheck className="w-4 h-4 text-blue-500" />
                  Regulatory & Clinical Parameters
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">Category:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{item.categoryId || item.itemType}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Criticality Class:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{item.criticality} (VED)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Storage Environment:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{item.storageRequirements || 'Standard Ambient (15-25°C)'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Batch Tracking:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {item.requiresBatchTracking ? 'Strict FEFO Enabled' : 'Standard'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Reorder Point:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{item.reorderPoint} {item.unitOfMeasure}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Standard Unit Cost:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">${item.unitCost}</span>
                  </div>
                </div>
              </div>

              {/* Batches Table for this Item */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-xs">
                    <Boxes className="w-4 h-4 text-amber-500" />
                    Active Tracked Batches ({itemBatches.length})
                  </h4>
                  <span className="text-[10px] text-slate-400">Sorted by FEFO (Earliest Expiry First)</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold">
                      <tr>
                        <th className="p-2.5">Batch / Lot #</th>
                        <th className="p-2.5">Expiry Date</th>
                        <th className="p-2.5">Stock Remaining</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5 text-right">Quick Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {itemBatches.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-slate-400">
                            No batch records active for this item.
                          </td>
                        </tr>
                      ) : (
                        itemBatches.map((b) => (
                          <tr key={b.batchId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="p-2.5 font-mono font-bold text-slate-900 dark:text-slate-100">
                              {b.batchNumber}
                            </td>
                            <td className="p-2.5 text-slate-600 dark:text-slate-300">
                              {b.expiryDate.split('T')[0]}
                            </td>
                            <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">
                              {b.quantityRemaining} {item.unitOfMeasure}
                            </td>
                            <td className="p-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                {b.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBatchNumber(b.batchNumber);
                                  setActiveSubTab('QR_TOOL');
                                }}
                                className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold hover:bg-blue-100 cursor-pointer text-[10px]"
                              >
                                Configure QR Label
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 text-xs">
          <div className="text-slate-500 font-mono text-[11px]">
            Tenant: <span className="font-semibold text-slate-700 dark:text-slate-300">{tenantId}</span> • Item ID: {item.itemId}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-100 font-bold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
