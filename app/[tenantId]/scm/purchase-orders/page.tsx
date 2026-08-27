'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import { useParams } from 'next/navigation';
import {
  Vendor,
  PurchaseOrder,
  PurchaseOrderLineItem,
  POStatus,
  PaymentTerms,
} from '@/types/supply-chain';
import {
  getPurchaseOrders,
  getVendors,
  createPurchaseOrder,
  receivePOItems,
  updatePurchaseOrderStatus,
  subscribeToPurchaseOrders,
} from '@/lib/firebase/services/supply-chain';
import { formatCurrency } from '@/lib/utils';
import {
  ShoppingCart,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Truck,
  AlertTriangle,
  FileText,
  Building2,
  Package,
  Boxes,
  ArrowRight,
  ShieldCheck,
  Eye,
  Trash2,
  RefreshCw,
  Printer,
  ChevronDown,
  X,
  FileCheck2,
  Calendar,
  DollarSign,
  Barcode,
  Layers,
} from 'lucide-react';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function PurchaseOrdersPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'metro-health';

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');

  // Modals & Drawers state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [isReceivingModalOpen, setIsReceivingModalOpen] = useState(false);
  const [poToReceive, setPoToReceive] = useState<PurchaseOrder | null>(null);

  // Form State for New PO
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [deptDestination, setDeptDestination] = useState('Central Hospital Warehouse & Depository');
  const [deliveryDueDate, setDeliveryDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>('Net30');
  const [poNotes, setPoNotes] = useState('');
  const [lineItems, setLineItems] = useState<
    Array<{
      itemId: string;
      itemName: string;
      sku: string;
      category: string;
      orderedQuantity: number;
      unitOfMeasure: string;
      unitPrice: number;
      taxRate: number;
    }>
  >([
    {
      itemId: 'item-iv-cannula-20g',
      itemName: 'Introcan Safety IV Cannula 20G (Pink) with Wings',
      sku: 'MED-IVC-20G-100',
      category: 'Medical Consumables',
      orderedQuantity: 100,
      unitOfMeasure: 'Box (50s)',
      unitPrice: 42.5,
      taxRate: 0.05,
    },
  ]);

  // Form State for Receiving Modal
  const [receivingInputs, setReceivingInputs] = useState<
    Record<
      string,
      {
        quantityToReceive: number;
        batchLot: string;
        expirationDate: string;
        passedInspection: boolean;
        inspectionNotes: string;
      }
    >
  >({});
  const [receivingInvoiceNum, setReceivingInvoiceNum] = useState('');
  const [receiverName, setReceiverName] = useState('Kevin O\'Connor (Lead SCM Receiving)');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Predefined SKU catalog for quick selection
  const itemCatalog = [
    { itemId: 'item-iv-cannula-20g', itemName: 'Introcan Safety IV Cannula 20G with Wings', sku: 'MED-IVC-20G-100', category: 'Medical Consumables', uom: 'Box (50s)', unitPrice: 42.5 },
    { itemId: 'item-cvc-triple-lumen', itemName: 'Arrow Triple-Lumen CVC Catheter Kit 7Fr 20cm', sku: 'MED-CVC-7FR-KIT', category: 'Vascular Access', uom: 'Kit', unitPrice: 165.0 },
    { itemId: 'item-vicryl-suture-20', itemName: 'Coated VICRYL Suture 2-0 SH Needle (36 foils)', sku: 'ETH-VIC-20-SH', category: 'Surgical Consumables', uom: 'Box', unitPrice: 140.0 },
    { itemId: 'item-sterile-gloves-75', itemName: 'Protexis Latex-Free Surgical Gloves Size 7.5', sku: 'MED-GLV-SURG-75', category: 'PPE Barrier', uom: 'Box (50 pairs)', unitPrice: 34.0 },
    { itemId: 'item-epinephrine-1mg', itemName: 'Epinephrine Injection 1mg/mL Ampoules (10s)', sku: 'MED-EPI-1MG-AMP', category: 'Resuscitation Pharma', uom: 'Pack', unitPrice: 85.0 },
    { itemId: 'item-chest-tube-32fr', itemName: 'Argyle Thoracic Vent & Chest Tube 32Fr', sku: 'MED-CHEST-32FR', category: 'Trauma Devices', uom: 'Unit', unitPrice: 45.0 },
    { itemId: 'item-3m-attest-bi-1492v', itemName: '3M Attest Super Rapid Readout BI 1492V', sku: '3M-ATT-1492V', category: 'CSSD Quality Assurance', uom: 'Box (50 vials)', unitPrice: 280.0 },
  ];

  // Initial load and live subscription
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function loadData() {
      try {
        setLoading(true);
        const [vList, poList] = await Promise.all([
          getVendors(tenantId),
          getPurchaseOrders(tenantId),
        ]);
        setVendors(vList);
        setPurchaseOrders(poList);
        if (vList.length > 0) {
          setSelectedVendorId((prev) => prev || vList[0].id);
          setPaymentTerms((prev) => prev || vList[0].paymentTerms || 'Net30');
        }

        unsubscribe = subscribeToPurchaseOrders(tenantId, (pos) => {
          setPurchaseOrders(pos);
        });
      } catch (err) {
        console.error('Error loading PO workbench:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [tenantId]);

  // When vendor changes in creation form, update terms
  const handleVendorSelect = (vId: string) => {
    setSelectedVendorId(vId);
    const v = vendors.find((vend) => vend.id === vId);
    if (v) {
      setPaymentTerms(v.paymentTerms || 'Net30');
    }
  };

  // Line item modifiers
  const handleAddLineItem = () => {
    const defaultTemplate = itemCatalog[0];
    setLineItems((prev) => [
      ...prev,
      {
        itemId: defaultTemplate.itemId,
        itemName: defaultTemplate.itemName,
        sku: defaultTemplate.sku,
        category: defaultTemplate.category,
        orderedQuantity: 20,
        unitOfMeasure: defaultTemplate.uom,
        unitPrice: defaultTemplate.unitPrice,
        taxRate: 0.05,
      },
    ]);
  };

  const handleRemoveLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleLineItemChange = (
    index: number,
    field: string,
    value: string | number
  ) => {
    setLineItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;

        if (field === 'catalogSelect') {
          const match = itemCatalog.find((c) => c.itemId === value);
          if (match) {
            return {
              ...item,
              itemId: match.itemId,
              itemName: match.itemName,
              sku: match.sku,
              category: match.category,
              unitOfMeasure: match.uom,
              unitPrice: match.unitPrice,
            };
          }
        }

        return {
          ...item,
          [field]: value,
        };
      })
    );
  };

  // Auto Calculations
  const calculatedSubtotal = useMemo(() => {
    return lineItems.reduce((acc, l) => acc + (Number(l.orderedQuantity) || 0) * (Number(l.unitPrice) || 0), 0);
  }, [lineItems]);

  const calculatedTax = useMemo(() => {
    return Math.round(calculatedSubtotal * 0.05 * 100) / 100;
  }, [calculatedSubtotal]);

  const calculatedTotal = useMemo(() => {
    return Math.round((calculatedSubtotal + calculatedTax) * 100) / 100;
  }, [calculatedSubtotal, calculatedTax]);

  // Submit New PO
  const handleCreatePO = async (asStatus: POStatus = 'submitted') => {
    if (!selectedVendorId || lineItems.length === 0) return;
    const vendor = vendors.find((v) => v.id === selectedVendorId);

    setIsSubmitting(true);
    try {
      const poNumber = `PO-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const timestamp = new Date().toISOString();

      const compiledLineItems: PurchaseOrderLineItem[] = lineItems.map((l, idx) => ({
        id: `line-${idx + 1}-${Date.now().toString().slice(-4)}`,
        itemId: l.itemId,
        itemName: l.itemName,
        sku: l.sku,
        category: l.category,
        orderedQuantity: Number(l.orderedQuantity) || 1,
        receivedQuantity: 0,
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: Number(l.unitPrice) || 0,
        taxRate: 0.05,
        discount: 0,
        lineTotal: Math.round((Number(l.orderedQuantity) || 1) * (Number(l.unitPrice) || 0) * 100) / 100,
        inspectionStatus: 'pending',
      }));

      const newPO: PurchaseOrder = {
        id: `po-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        poNumber,
        vendorId: selectedVendorId,
        vendorName: vendor?.name || 'Selected Vendor',
        vendorEmail: vendor?.email,
        status: asStatus,
        departmentDestination: deptDestination,
        lineItems: compiledLineItems,
        subtotal: calculatedSubtotal,
        taxTotal: calculatedTax,
        discountTotal: 0,
        totalCost: calculatedTotal,
        currency: 'USD',
        paymentTerms,
        approvalSignatures:
          asStatus === 'submitted'
            ? [
                {
                  role: 'procurement_officer',
                  signedBy: 'Zainab Qureshi (Lead SCM Officer)',
                  signedAt: timestamp,
                  signatureHash: `SIG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
                  approved: true,
                  comments: 'Submitted for vendor dispatch and receiving intake.',
                },
              ]
            : [],
        shippingAddress: 'Metropolitan Memorial Hospital, Loading Dock B, Gate 4',
        deliveryDueDate,
        requestedBy: 'Hospital Procurement Officer',
        createdDate: timestamp,
        updatedAt: timestamp,
        notes: poNotes,
      };

      await createPurchaseOrder(tenantId, newPO);
      setIsCreateModalOpen(false);
      // Reset form
      setPoNotes('');
    } catch (err) {
      console.error('Failed to create purchase order:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Receiving Modal for a PO
  const openReceivingModal = (po: PurchaseOrder) => {
    setPoToReceive(po);
    const initialInputs: Record<string, {
      quantityToReceive: number;
      batchLot: string;
      expirationDate: string;
      passedInspection: boolean;
      inspectionNotes: string;
    }> = {};

    po.lineItems.forEach((line) => {
      const remaining = Math.max(0, line.orderedQuantity - (line.receivedQuantity || 0));
      initialInputs[line.itemId] = {
        quantityToReceive: remaining,
        batchLot: `LOT-${Date.now().toString().slice(-5)}`,
        expirationDate: '2028-12-31',
        passedInspection: true,
        inspectionNotes: 'Barcodes verified, sterility seal intact.',
      };
    });

    setReceivingInputs(initialInputs);
    setReceivingInvoiceNum(`INV-${po.poNumber.replace('PO-', '')}`);
    setIsReceivingModalOpen(true);
  };

  // Execute Receiving Form Submission
  const handleConfirmReceiving = async () => {
    if (!poToReceive) return;
    setIsSubmitting(true);
    try {
      const itemsPayload = Object.entries(receivingInputs).map(([itemId, data]) => ({
        itemId,
        quantityToReceive: Number(data.quantityToReceive) || 0,
        batchLot: data.batchLot,
        expirationDate: data.expirationDate,
        passedInspection: data.passedInspection,
        inspectionNotes: data.inspectionNotes,
      }));

      await receivePOItems(
        tenantId,
        poToReceive.id,
        itemsPayload,
        receiverName,
        receivingInvoiceNum
      );

      setIsReceivingModalOpen(false);
      setPoToReceive(null);
    } catch (err) {
      console.error('Receiving transaction failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered list of POs
  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter((po) => {
      const matchesSearch =
        po.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        po.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        po.lineItems.some((l) => l.itemName.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === 'all' || po.status === statusFilter;
      const matchesVendor = vendorFilter === 'all' || po.vendorId === vendorFilter;

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [purchaseOrders, searchQuery, statusFilter, vendorFilter]);

  // Aggregated Header KPI Stats
  const openPOSpend = useMemo(() => {
    return purchaseOrders
      .filter((p) => p.status === 'submitted' || p.status === 'partially_received')
      .reduce((acc, p) => acc + (p.totalCost || 0), 0);
  }, [purchaseOrders]);

  const pendingShipments = useMemo(() => {
    return purchaseOrders.filter(
      (p) => p.status === 'submitted' || p.status === 'partially_received'
    ).length;
  }, [purchaseOrders]);

  const getStatusBadge = (status: POStatus) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <Clock className="w-3 h-3" /> Draft
          </span>
        );
      case 'submitted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <Truck className="w-3 h-3 text-blue-600" /> In Transit
          </span>
        );
      case 'partially_received':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Boxes className="w-3 h-3 text-amber-600" /> Partial Intake
          </span>
        );
      case 'received':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> GRN Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <X className="w-3 h-3" /> Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-xs">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">
                  Procurement & Purchase Orders (SCM)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  WMS Phase 7
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Hospital procurement workbench, vendor lead time tracking, and Goods Received Note (GRN) inspection.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            id="btn-create-po-modal-open"
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Create Purchase Order</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Open PO Commitments</span>
            <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{formatCurrency(openPOSpend)}</span>
            <span className="text-[11px] font-bold text-blue-600">In Transit</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pending Deliveries</span>
            <span className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Truck className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{pendingShipments} Shipments</span>
            <span className="text-[11px] font-bold text-amber-600">Awaiting Intake</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Contracted Vendors</span>
            <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Building2 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{vendors.length} Approved</span>
            <span className="text-[11px] font-bold text-emerald-600">96% Reliability</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Average Lead Time</span>
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">3.4 Days</span>
            <span className="text-[11px] font-bold text-emerald-600">Medline / Ethicon</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search PO #, vendor, or items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {/* Status Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
            {['all', 'submitted', 'partially_received', 'received', 'draft'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'partially_received' ? 'Partial' : st}
              </button>
            ))}
          </div>

          {/* Vendor Filter */}
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            aria-label="Filter by Vendor"
            className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:bg-white focus:outline-hidden"
          >
            <option value="all">All Vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Purchase Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">PO Number & Date</th>
                <th className="py-3.5 px-4">Vendor & Terms</th>
                <th className="py-3.5 px-4">Destination</th>
                <th className="py-3.5 px-4">Line Items</th>
                <th className="py-3.5 px-4 text-right">Total Spend</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredPOs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-sm">No Purchase Orders found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Create a new PO or adjust your filters above.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPOs.map((po) => {
                  const totalOrdered = po.lineItems.reduce((acc, l) => acc + l.orderedQuantity, 0);
                  const totalReceived = po.lineItems.reduce((acc, l) => acc + (l.receivedQuantity || 0), 0);
                  const progressPct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900">{po.poNumber}</div>
                        <div className="text-[11px] text-slate-500">
                          Due: {po.deliveryDueDate}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">{po.vendorName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Terms: {po.paymentTerms}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 max-w-[200px] truncate">
                        <span className="text-xs text-slate-700">
                          {po.departmentDestination}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">
                            {po.lineItems.length} items
                          </span>
                          <span className="text-[10px] text-slate-500">
                            ({totalReceived}/{totalOrdered} rec&apos;d)
                          </span>
                        </div>
                        {/* Mini progress bar */}
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                          <div
                            className={`h-full rounded-full ${
                              progressPct === 100
                                ? 'bg-emerald-500'
                                : progressPct > 0
                                ? 'bg-amber-500'
                                : 'bg-slate-300'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-extrabold text-slate-900">
                          {formatCurrency(po.totalCost)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          +{formatCurrency(po.taxTotal)} tax
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {getStatusBadge(po.status)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {po.status !== 'received' && po.status !== 'cancelled' && (
                            <button
                              id={`btn-receive-po-${po.id}`}
                              onClick={() => openReceivingModal(po)}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              title="Receive & Inspect Shipment"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>Receive</span>
                            </button>
                          )}
                          <button
                            id={`btn-view-po-${po.id}`}
                            onClick={() => setSelectedPO(po)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                            title="View Purchase Order Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
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

      {/* ==================================================================== */}
      {/* CREATE PURCHASE ORDER MODAL */}
      {/* ==================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black shadow-xs">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Draft New Purchase Order (PO)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Specify vendor, delivery parameters, and procurement line items.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
              {/* Vendor & General Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Vendor Partner
                  </label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => handleVendorSelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-500"
                  >
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.leadTimeDays}d lead time)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Department Destination
                  </label>
                  <select
                    value={deptDestination}
                    onChange={(e) => setDeptDestination(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-500"
                  >
                    <option value="Central Hospital Warehouse & Depository">Central Hospital Warehouse</option>
                    <option value="OR Supply Hub & Surgery Suites">OR Supply Hub & Surgery Suites</option>
                    <option value="Intensive Care Unit (ICU 3rd Floor Hub)">ICU 3rd Floor Hub</option>
                    <option value="Emergency & Trauma Resuscitation Bay">Emergency & Trauma Bay</option>
                    <option value="Central Sterile Services Department (CSSD)">CSSD Decontamination</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Delivery Due Date
                  </label>
                  <input
                    type="date"
                    value={deliveryDueDate}
                    onChange={(e) => setDeliveryDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                    Procurement Line Items ({lineItems.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold">
                        <th className="py-2.5 px-3">Item / SKU Catalog</th>
                        <th className="py-2.5 px-2 w-24">Qty</th>
                        <th className="py-2.5 px-2 w-28">UOM</th>
                        <th className="py-2.5 px-2 w-28">Unit Price ($)</th>
                        <th className="py-2.5 px-3 text-right">Line Total</th>
                        <th className="py-2.5 px-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lineItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3">
                            <select
                              value={item.itemId}
                              onChange={(e) =>
                                handleLineItemChange(idx, 'catalogSelect', e.target.value)
                              }
                              className="w-full py-1 px-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800"
                            >
                              {itemCatalog.map((cat) => (
                                <option key={cat.itemId} value={cat.itemId}>
                                  {cat.itemName} ({cat.sku})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              min="1"
                              value={item.orderedQuantity}
                              onChange={(e) =>
                                handleLineItemChange(idx, 'orderedQuantity', Number(e.target.value))
                              }
                              className="w-full py-1 px-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-center"
                            />
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="text"
                              value={item.unitOfMeasure}
                              onChange={(e) =>
                                handleLineItemChange(idx, 'unitOfMeasure', e.target.value)
                              }
                              className="w-full py-1 px-2 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            />
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={item.unitPrice}
                              onChange={(e) =>
                                handleLineItemChange(idx, 'unitPrice', Number(e.target.value))
                              }
                              className="w-full py-1 px-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-extrabold text-slate-900">
                            {formatCurrency(
                              (Number(item.orderedQuantity) || 0) * (Number(item.unitPrice) || 0)
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {lineItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLineItem(idx)}
                                className="text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Procurement Notes / Justification
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter clinical urgency, contract reference, or delivery notes..."
                    value={poNotes}
                    onChange={(e) => setPoNotes(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-hidden"
                  />
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-semibold">{formatCurrency(calculatedSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Estimated Tax (5% VAT):</span>
                    <span className="font-semibold">{formatCurrency(calculatedTax)}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between text-sm font-black text-slate-900">
                    <span>Total PO Authorization:</span>
                    <span className="text-blue-600">{formatCurrency(calculatedTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleCreatePO('draft')}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs rounded-xl shadow-2xs cursor-pointer"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleCreatePO('submitted')}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileCheck2 className="w-3.5 h-3.5" />
                  )}
                  <span>Sign & Submit PO</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* GOODS RECEIVING & INSPECTION MODAL (GRN) */}
      {/* ==================================================================== */}
      {isReceivingModalOpen && poToReceive && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Goods Received Note (GRN) & Intake Inspection
                  </h3>
                  <p className="text-xs text-slate-500">
                    Receiving for PO: <span className="font-bold text-slate-800">{poToReceive.poNumber}</span> ({poToReceive.vendorName})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsReceivingModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
              {/* Receiving metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Receiving Inspection Officer
                  </label>
                  <input
                    type="text"
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Vendor Invoice / Delivery Note #
                  </label>
                  <input
                    type="text"
                    value={receivingInvoiceNum}
                    onChange={(e) => setReceivingInvoiceNum(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-mono font-semibold text-slate-800"
                  />
                </div>
              </div>

              {/* Items Verification Checklist */}
              <div>
                <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider block mb-2">
                  Shipment Line Items Intake & QA Checklist
                </span>

                <div className="space-y-3">
                  {poToReceive.lineItems.map((line) => {
                    const currentInput = receivingInputs[line.itemId] || {
                      quantityToReceive: 0,
                      batchLot: '',
                      expirationDate: '',
                      passedInspection: true,
                      inspectionNotes: '',
                    };

                    const remainingToReceive = Math.max(
                      0,
                      line.orderedQuantity - (line.receivedQuantity || 0)
                    );

                    return (
                      <div
                        key={line.itemId}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                          <div>
                            <div className="font-extrabold text-slate-900 text-sm">
                              {line.itemName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              SKU: {line.sku} | UOM: {line.unitOfMeasure}
                            </div>
                          </div>
                          <div className="text-right text-xs">
                            <span className="font-bold text-slate-700">
                              Ordered: {line.orderedQuantity}
                            </span>
                            <span className="text-slate-400 mx-1.5">|</span>
                            <span className="font-bold text-emerald-600">
                              Already Rec&apos;d: {line.receivedQuantity || 0}
                            </span>
                            <span className="text-slate-400 mx-1.5">|</span>
                            <span className="font-extrabold text-blue-600">
                              Remaining: {remainingToReceive}
                            </span>
                          </div>
                        </div>

                        {/* Intake inputs row */}
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              Qty Receiving Now
                            </label>
                            <input
                              type="number"
                              min="0"
                              max={remainingToReceive}
                              value={currentInput.quantityToReceive}
                              onChange={(e) =>
                                setReceivingInputs((prev) => ({
                                  ...prev,
                                  [line.itemId]: {
                                    ...prev[line.itemId],
                                    quantityToReceive: Number(e.target.value),
                                  },
                                }))
                              }
                              className="w-full py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200 font-black text-slate-900 focus:bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              Batch / Lot #
                            </label>
                            <input
                              type="text"
                              value={currentInput.batchLot}
                              onChange={(e) =>
                                setReceivingInputs((prev) => ({
                                  ...prev,
                                  [line.itemId]: {
                                    ...prev[line.itemId],
                                    batchLot: e.target.value,
                                  },
                                }))
                              }
                              placeholder="e.g. LOT-2026-90"
                              className="w-full py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200 font-mono font-semibold"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              Expiration Date
                            </label>
                            <input
                              type="date"
                              value={currentInput.expirationDate}
                              onChange={(e) =>
                                setReceivingInputs((prev) => ({
                                  ...prev,
                                  [line.itemId]: {
                                    ...prev[line.itemId],
                                    expirationDate: e.target.value,
                                  },
                                }))
                              }
                              className="w-full py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200 font-semibold"
                            />
                          </div>

                          <div className="flex flex-col justify-end">
                            <label className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={currentInput.passedInspection}
                                onChange={(e) =>
                                  setReceivingInputs((prev) => ({
                                    ...prev,
                                    [line.itemId]: {
                                      ...prev[line.itemId],
                                      passedInspection: e.target.checked,
                                    },
                                  }))
                                }
                                className="w-4 h-4 text-emerald-600 rounded"
                              />
                              <span className="text-[11px] font-bold text-slate-800">
                                QA Passed
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsReceivingModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmReceiving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-2"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                <span>Finalize Intake & Increment Central Stock</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* PURCHASE ORDER DETAIL VOUCHER DRAWER */}
      {/* ==================================================================== */}
      {selectedPO && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">
                    Purchase Order Voucher: {selectedPO.poNumber}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Created {new Date(selectedPO.createdDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                  title="Print PO Voucher"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedPO(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Voucher Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Status Header */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[11px] text-slate-500 font-semibold block">PO Status</span>
                  <div className="mt-1">{getStatusBadge(selectedPO.status)}</div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500 font-semibold block">Payment Terms</span>
                  <span className="font-extrabold text-slate-800 text-sm font-mono">
                    {selectedPO.paymentTerms}
                  </span>
                </div>
              </div>

              {/* Vendor & Shipping Specs */}
              <div className="grid grid-cols-2 gap-4 border-b border-slate-200 pb-4">
                <div>
                  <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-1">
                    Vendor Partner
                  </span>
                  <div className="font-bold text-slate-900 text-sm">{selectedPO.vendorName}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5">{selectedPO.vendorEmail}</div>
                </div>
                <div>
                  <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-1">
                    Destination & Delivery
                  </span>
                  <div className="font-bold text-slate-900">{selectedPO.departmentDestination}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5">
                    Target Due Date: {selectedPO.deliveryDueDate}
                  </div>
                </div>
              </div>

              {/* Itemized Table */}
              <div>
                <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-2">
                  Line Items Manifest
                </span>
                <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <th className="p-2.5">Item</th>
                      <th className="p-2.5 text-center">Ordered</th>
                      <th className="p-2.5 text-center">Rec&apos;d</th>
                      <th className="p-2.5 text-right">Price</th>
                      <th className="p-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedPO.lineItems.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900">{l.itemName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{l.sku}</div>
                        </td>
                        <td className="p-2.5 text-center font-bold">{l.orderedQuantity}</td>
                        <td className="p-2.5 text-center font-bold text-emerald-600">
                          {l.receivedQuantity || 0}
                        </td>
                        <td className="p-2.5 text-right">{formatCurrency(l.unitPrice)}</td>
                        <td className="p-2.5 text-right font-bold text-slate-900">
                          {formatCurrency(l.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-semibold">{formatCurrency(selectedPO.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Sales Tax (VAT):</span>
                  <span className="font-semibold">{formatCurrency(selectedPO.taxTotal)}</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-sm text-slate-900">
                  <span>Total Cost:</span>
                  <span className="text-blue-600">{formatCurrency(selectedPO.totalCost)}</span>
                </div>
              </div>

              {/* Signatures History */}
              {selectedPO.approvalSignatures.length > 0 && (
                <div>
                  <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-2">
                    Digital Approval Signatures
                  </span>
                  <div className="space-y-2">
                    {selectedPO.approvalSignatures.map((sig, idx) => (
                      <div
                        key={idx}
                        className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-200 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-emerald-900">{sig.signedBy}</div>
                          <div className="text-[10px] text-emerald-700 font-mono">
                            {sig.role.toUpperCase()} | {new Date(sig.signedAt).toLocaleString()}
                          </div>
                          {sig.comments && (
                            <p className="text-[11px] text-slate-600 mt-1 italic">
                              &ldquo;{sig.comments}&rdquo;
                            </p>
                          )}
                        </div>
                        <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Goods Received Logs History */}
              {selectedPO.receivingLogs && selectedPO.receivingLogs.length > 0 && (
                <div>
                  <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-2">
                    Goods Received Notes (GRN History)
                  </span>
                  <div className="space-y-2">
                    {selectedPO.receivingLogs.map((log) => (
                      <div
                        key={log.id}
                        className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-slate-900 font-mono">
                            {log.grnNumber}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(log.receivedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Intake Officer: <span className="font-semibold">{log.receivedBy}</span>
                          {log.vendorInvoiceNumber && ` | Inv: ${log.vendorInvoiceNumber}`}
                        </div>
                        <div className="border-t border-slate-200/60 pt-1 text-[11px] text-slate-600">
                          {log.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span>
                                {it.itemName} (Lot: {it.batchLot})
                              </span>
                              <span className="font-bold text-emerald-700">
                                +{it.quantityReceived} units
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
