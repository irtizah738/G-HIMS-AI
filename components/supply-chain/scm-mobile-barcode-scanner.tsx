'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  QrCode,
  Camera,
  VideoOff,
  RefreshCw,
  Flashlight,
  FlashlightOff,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  Layers,
  ArrowRight,
  Upload,
  Plus,
  Minus,
  Sparkles,
  Package,
  Building2,
  Calendar,
  X,
  History,
  ShieldAlert,
} from 'lucide-react';
import { parseHealthcareBarcode, ParsedBarcodeResult } from '@/lib/supply-chain/barcode-scanner';
import {
  ItemMaster,
  BatchLotRecord,
  InventoryLocation,
  InventoryBalance,
  StockTransaction,
} from '@/types/scm-domain';
import { recordStockTransactionEdge } from '@/lib/supply-chain/scm-edge-adapter';

interface ScmMobileBarcodeScannerProps {
  tenantId: string;
  items: ItemMaster[];
  batches: BatchLotRecord[];
  locations: InventoryLocation[];
  balances: InventoryBalance[];
  isOpen: boolean;
  onClose: () => void;
  onStockUpdated?: () => Promise<void> | void;
}

export function ScmMobileBarcodeScanner({
  tenantId,
  items,
  batches,
  locations,
  balances,
  isOpen,
  onClose,
  onStockUpdated,
}: ScmMobileBarcodeScannerProps) {
  // Camera Stream States
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  // Scanned Code State
  const [rawScannedCode, setRawScannedCode] = useState<string>('');
  const [parsedData, setParsedData] = useState<ParsedBarcodeResult | null>(null);
  const [matchedItem, setMatchedItem] = useState<ItemMaster | null>(null);
  const [matchedBatch, setMatchedBatch] = useState<BatchLotRecord | null>(null);

  // Rapid Inventory Update State
  const [selectedLocationId, setSelectedLocationId] = useState<string>('loc-icu-hub');
  const [updateMode, setUpdateMode] = useState<'COUNT' | 'RECEIPT' | 'DISPENSE'>('COUNT');
  const [updateQuantity, setUpdateQuantity] = useState<number>(10);
  const [updateNotes, setUpdateNotes] = useState<string>('Rapid mobile barcode audit scan');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState<{
    txId: string;
    itemName: string;
    delta: number;
    newTotal: number;
    locationName: string;
  } | null>(null);

  // Sound Synth Feedback
  const playScanBeep = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch crisp chime
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } catch {
      // Audio context might be restricted before user gesture
    }
  }, []);

  // Haptic feedback
  const triggerHaptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([60, 40, 60]);
    }
  }, []);

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      setStream(mediaStream);
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      // Check for torch capability
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        setTorchSupported(Boolean(capabilities.torch));
      }
    } catch (err: any) {
      console.warn('Camera access issue:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please enable camera access in your browser settings.'
          : 'No camera hardware detected or camera is in use by another application.'
      );
      setCameraActive(false);
    }
  }, [facingMode, stream]);

  // Stop Camera Stream
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setCameraActive(false);
    setTorchEnabled(false);
  }, [stream]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!stream || !torchSupported) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const nextState = !torchEnabled;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchEnabled(nextState);
      } catch (err) {
        console.warn('Torch toggle failed:', err);
      }
    }
  };

  // Flip Camera
  const toggleCameraFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Process and Resolve Barcode
  const handleBarcodeIdentified = useCallback(
    (codeText: string) => {
      const clean = codeText.trim();
      if (!clean) return;

      playScanBeep();
      triggerHaptic();

      setRawScannedCode(clean);
      const parsed = parseHealthcareBarcode(clean);
      setParsedData(parsed);

      // Match item from master
      const matched = items.find(
        (it) =>
          it.barcode === clean ||
          it.itemCode === parsed.itemCode ||
          (parsed.gtin && it.gtin === parsed.gtin) ||
          it.itemCode.toLowerCase() === clean.toLowerCase()
      );
      setMatchedItem(matched || null);

      // Match batch if lot present
      if (parsed.batchNumber) {
        const b = batches.find((x) => x.batchNumber === parsed.batchNumber);
        setMatchedBatch(b || null);
      } else if (matched) {
        const defaultBatch = batches.find((x) => x.itemId === matched.itemId);
        setMatchedBatch(defaultBatch || null);
      }

      // Default count quantity based on current balance
      if (matched) {
        const currBal = balances.find(
          (b) => b.itemId === matched.itemId && b.locationId === selectedLocationId
        );
        setUpdateQuantity(currBal ? currBal.onHand : 20);
      }
      setSubmissionSuccess(null);
    },
    [items, batches, balances, selectedLocationId, playScanBeep, triggerHaptic]
  );

  // Continuous Camera Scan Frame Loop
  useEffect(() => {
    if (!isOpen || !cameraActive) return;

    let isScanning = true;
    const interval = setInterval(async () => {
      if (!isScanning || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 1. Try Native BarcodeDetector if available
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const barcodeDetector = new (window as any).BarcodeDetector({
            formats: ['qr_code', 'code_128', 'data_matrix', 'ean_13', 'upc_a'],
          });
          const detected = await barcodeDetector.detect(video);
          if (detected && detected.length > 0) {
            const raw = detected[0].rawValue;
            if (raw && raw !== rawScannedCode) {
              handleBarcodeIdentified(raw);
              return;
            }
          }
        } catch {
          // Native detector might throw on unsupported platforms; fallback to jsQR
        }
      }

      // 2. jsQR Fallback on frame image data
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (qrCode && qrCode.data && qrCode.data !== rawScannedCode) {
          handleBarcodeIdentified(qrCode.data);
        }
      } catch {
        // Frame analysis error catch
      }
    }, 220);

    return () => {
      isScanning = false;
      clearInterval(interval);
    };
  }, [isOpen, cameraActive, rawScannedCode, handleBarcodeIdentified]);

  // Handle Photo Upload as fallback
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          handleBarcodeIdentified(code.data);
        } else {
          alert('No recognizable QR code or barcode detected in this image. Please try again.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Start or Stop Camera when Modal Opens/Closes
  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, facingMode]);

  // Current on-hand in selected location
  const currentLocationBalance = matchedItem
    ? balances.find((b) => b.itemId === matchedItem.itemId && b.locationId === selectedLocationId)
    : null;

  // Execute Rapid Stock Update
  const handleCommitRapidUpdate = async () => {
    if (!matchedItem) return;
    setIsSubmitting(true);

    try {
      const targetLoc = locations.find((l) => l.locationId === selectedLocationId);
      const locName = targetLoc ? targetLoc.name : 'Hospital Ward';
      const batchNumber =
        matchedBatch?.batchNumber || parsedData?.batchNumber || 'LOT-QUICK-AUDIT';
      const batchId = matchedBatch?.batchId || 'btc-quick-audit';

      let txType: StockTransaction['transactionType'] = 'ADJUSTMENT_IN';
      let deltaQty = updateQuantity;

      const currentQty = currentLocationBalance ? currentLocationBalance.onHand : 0;

      if (updateMode === 'COUNT') {
        // Physical Count Adjustment
        const variance = updateQuantity - currentQty;
        if (variance >= 0) {
          txType = 'ADJUSTMENT_IN';
          deltaQty = variance;
        } else {
          txType = 'ADJUSTMENT_OUT';
          deltaQty = Math.abs(variance);
        }
      } else if (updateMode === 'RECEIPT') {
        txType = 'RECEIPT';
        deltaQty = updateQuantity;
      } else if (updateMode === 'DISPENSE') {
        txType = 'CONSUMPTION';
        deltaQty = updateQuantity;
      }

      const newTxId = `txn-scan-${Date.now()}`;
      const nowIso = new Date().toISOString();

      const newTxn: StockTransaction = {
        transactionId: newTxId,
        tenantId,
        facilityId: 'FAC-MAIN',
        itemId: matchedItem.itemId,
        itemCode: matchedItem.itemCode,
        itemName: matchedItem.name,
        batchId,
        batchNumber,
        toLocationId: selectedLocationId,
        toLocationName: locName,
        quantity: deltaQty,
        uom: matchedItem.unitOfMeasure,
        normalizedQuantity: deltaQty,
        unitCost: matchedItem.unitCost,
        totalCost: deltaQty * matchedItem.unitCost,
        currency: 'USD',
        transactionType: txType,
        referenceType: 'CYCLE_COUNT',
        referenceId: `SCAN-AUDIT-${new Date().getFullYear()}`,
        performedBy: {
          userId: 'usr-mobile-scanner',
          userName: 'Mobile Nurse / Inventory Officer',
          role: 'Ward Clinical Inventory Lead',
        },
        occurredAt: nowIso,
        recordedAt: nowIso,
        deviceId: 'MOBILE-CAM-SCN-01',
        idempotencyKey: `idemp-scan-${newTxId}`,
        source: 'ONLINE',
        metadata: {
          rawBarcode: rawScannedCode,
          barcodeFormat: parsedData?.format || 'UNKNOWN',
          updateMode,
          notes: updateNotes,
        },
      };

      await recordStockTransactionEdge(newTxn);

      const computedNewTotal =
        updateMode === 'COUNT'
          ? updateQuantity
          : updateMode === 'RECEIPT'
          ? currentQty + deltaQty
          : Math.max(0, currentQty - deltaQty);

      setSubmissionSuccess({
        txId: newTxId,
        itemName: matchedItem.name,
        delta: deltaQty,
        newTotal: computedNewTotal,
        locationName: locName,
      });

      if (onStockUpdated) {
        await onStockUpdated();
      }
    } catch (err) {
      console.error('Failed to commit rapid stock update:', err);
      alert('Failed to update stock. Please check permissions or network connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <Camera className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Mobile Barcode & QR Rapid Inventory Scanner
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Direct camera feed with instant GS1 parsing, physical counts & stock movements
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Scrollable */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Camera Viewfinder Box */}
          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video max-h-60 w-full flex items-center justify-center shadow-inner">
            {cameraActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Reticle Overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-56 h-36 border-2 border-blue-500/80 rounded-xl relative">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white" />

                    {/* Animated Scanning Laser */}
                    <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_8px_#f43f5e] animate-bounce opacity-80 mt-16" />
                  </div>
                </div>

                {/* Camera Floating Controls */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  {torchSupported && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      title="Toggle Torch"
                      className={`p-2 rounded-xl backdrop-blur-md cursor-pointer transition-colors ${
                        torchEnabled ? 'bg-amber-500 text-white' : 'bg-black/40 text-white hover:bg-black/60'
                      }`}
                    >
                      {torchEnabled ? (
                        <Flashlight className="w-4 h-4" />
                      ) : (
                        <FlashlightOff className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    title="Flip Camera"
                    className="p-2 rounded-xl bg-black/40 hover:bg-black/60 text-white backdrop-blur-md cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center p-6 space-y-3">
                <VideoOff className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-400 max-w-sm">
                  {cameraError || 'Camera inactive. Click to initialize camera stream.'}
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-sm"
                >
                  Start Live Camera Feed
                </button>
              </div>
            )}

            {/* Hidden canvas for jsQR analysis */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Quick Fallback Barcode Chips & File Upload */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400 text-[11px] font-medium">Demo Barcodes:</span>
              <button
                type="button"
                onClick={() => handleBarcodeIdentified('8901082001923')}
                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-mono cursor-pointer"
              >
                Ceftriaxone 1g
              </button>
              <button
                type="button"
                onClick={() =>
                  handleBarcodeIdentified('(01)07611299014299(17)280331(10)LOT-STENT-7811')
                }
                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-mono cursor-pointer"
              >
                GS1 Coronary Stent
              </button>
              <button
                type="button"
                onClick={() =>
                  handleBarcodeIdentified('CON-SAL-500:LOT-SAL-04421:2027-06-30:24')
                }
                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-mono cursor-pointer"
              >
                Normal Saline 500mL
              </button>
            </div>

            <label className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
              <Upload className="w-3 h-3" />
              <span>Upload Photo / Barcode</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Scanned Result Banner */}
          {rawScannedCode && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-bold">
                  {parsedData?.format || 'BARCODE'} DETECTED
                </span>
                <span className="font-mono text-[11px] text-slate-500 truncate max-w-xs">
                  {rawScannedCode}
                </span>
              </div>

              {matchedItem ? (
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {matchedItem.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Code: <span className="font-mono">{matchedItem.itemCode}</span> | Brand:{' '}
                        {matchedItem.brandName || 'N/A'} | UOM: {matchedItem.unitOfMeasure}
                      </p>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        matchedItem.criticality === 'VITAL'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {matchedItem.criticality}
                    </span>
                  </div>

                  {matchedBatch && (
                    <div className="flex items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>
                        Batch: <strong className="font-mono text-slate-900 dark:text-slate-100">{matchedBatch.batchNumber}</strong>
                      </span>
                      <span>
                        Expires:{' '}
                        <strong className="text-slate-900 dark:text-slate-100">
                          {matchedBatch.expiryDate.split('T')[0]}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Parsed barcode code: &quot;{rawScannedCode}&quot;. No matching hospital item in master catalog.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Rapid Inventory Update Form */}
          {matchedItem && (
            <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-blue-950 dark:text-blue-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  Rapid Inventory Update Execution
                </h4>
                <span className="text-[10px] text-blue-800 dark:text-blue-300">
                  Atomic Transaction Commit
                </span>
              </div>

              {/* Mode Selection */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setUpdateMode('COUNT')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                    updateMode === 'COUNT'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  Physical Count
                </button>
                <button
                  type="button"
                  onClick={() => setUpdateMode('RECEIPT')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                    updateMode === 'RECEIPT'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  Restock / Intake
                </button>
                <button
                  type="button"
                  onClick={() => setUpdateMode('DISPENSE')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                    updateMode === 'DISPENSE'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  Ward Dispense
                </button>
              </div>

              {/* Target Ward Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Target Hospital Ward / Storage Hub:
                  </label>
                  <select
                    value={selectedLocationId}
                    onChange={(e) => setSelectedLocationId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    {locations.map((loc) => (
                      <option key={loc.locationId} value={loc.locationId}>
                        {loc.name} ({loc.code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantity Input with Quick Inc/Dec */}
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    {updateMode === 'COUNT'
                      ? 'New Counted Physical Stock:'
                      : updateMode === 'RECEIPT'
                      ? 'Quantity to Receive:'
                      : 'Quantity to Dispense:'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUpdateQuantity((q) => Math.max(1, q - 1))}
                      className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={updateQuantity}
                      onChange={(e) => setUpdateQuantity(parseInt(e.target.value, 10) || 1)}
                      className="w-full px-3 py-2 text-center rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => setUpdateQuantity((q) => q + 1)}
                      className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Status Comparison Preview */}
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400 text-[10px] block">Current On-Hand in Ward:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {currentLocationBalance ? currentLocationBalance.onHand : 0}{' '}
                    {matchedItem.unitOfMeasure}
                  </span>
                </div>

                <ArrowRight className="w-4 h-4 text-blue-500" />

                <div className="text-right">
                  <span className="text-slate-400 text-[10px] block">Projected New Balance:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {updateMode === 'COUNT'
                      ? updateQuantity
                      : updateMode === 'RECEIPT'
                      ? (currentLocationBalance?.onHand || 0) + updateQuantity
                      : Math.max(0, (currentLocationBalance?.onHand || 0) - updateQuantity)}{' '}
                    {matchedItem.unitOfMeasure}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleCommitRapidUpdate}
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Committing Stock Transaction...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Commit {updateMode} of {updateQuantity} {matchedItem.unitOfMeasure}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Success Banner */}
          {submissionSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Inventory Ledger Successfully Updated!</span>
              </div>
              <p>
                Updated <strong>{submissionSuccess.itemName}</strong> at{' '}
                <strong>{submissionSuccess.locationName}</strong>. New on-hand balance is{' '}
                <strong>{submissionSuccess.newTotal} units</strong>.
              </p>
              <div className="flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-400 font-mono pt-1 border-t border-emerald-200 dark:border-emerald-900">
                <span>Ref: {submissionSuccess.txId}</span>
                <button
                  type="button"
                  onClick={() => {
                    setRawScannedCode('');
                    setMatchedItem(null);
                    setSubmissionSuccess(null);
                  }}
                  className="font-bold underline cursor-pointer"
                >
                  Scan Next Item &rarr;
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-500">
            Compliant with GS1-128, DataMatrix & FDA UDI barcode standards
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
