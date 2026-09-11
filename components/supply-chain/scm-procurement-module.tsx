'use client';

import React, { useState, useMemo } from 'react';
import {
  ItemMaster,
  PurchaseRequisition,
  PurchaseOrderRecord,
  SupplierMaster,
  InventoryLocation,
} from '@/types/scm-domain';
import {
  createPurchaseRequisition,
  updateRequisitionStatus,
  convertRequisitionToPO,
} from '@/lib/firebase/services/scm-firestore-service';
import {
  ShoppingCart,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Truck,
  Building2,
  DollarSign,
  AlertTriangle,
  UserCheck,
  FileText,
  Filter,
  Search,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

interface ScmProcurementModuleProps {
  tenantId: string;
  items: ItemMaster[];
  requisitions: PurchaseRequisition[];
  purchaseOrders: PurchaseOrderRecord[];
  suppliers: SupplierMaster[];
  locations: InventoryLocation[];
  onRefresh: () => Promise<void>;
}

export function ScmProcurementModule({
  tenantId,
  items,
  requisitions,
  purchaseOrders,
  suppliers,
  locations,
  onRefresh,
}: ScmProcurementModuleProps) {
  const [prFilter, setPrFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New PR Modal
  const [isNewPrOpen, setIsNewPrOpen] = useState(false);
  const [prDepartment, setPrDepartment] = useState('Intensive Care Unit (ICU)');
  const [prPriority, setPrPriority] = useState<'NORMAL' | 'URGENT' | 'EMERGENCY'>('NORMAL');
  const [prItemId, setPrItemId] = useState(items[0]?.itemId || '');
  const [prQuantity, setPrQuantity] = useState(25);
  const [prJustification, setPrJustification] = useState('Urgent clinical stock buffer replenishment for emergency admissions.');

  // Approval Modal
  const [selectedReqForApproval, setSelectedReqForApproval] = useState<PurchaseRequisition | null>(null);
  const [approvalDecision, setApprovalDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [approverName, setApproverName] = useState('Dr. Robert Henderson, MD');
  const [approverRole, setApproverRole] = useState('Clinical Director & CMO');
  const [approvalNotes, setApprovalNotes] = useState('Clinically validated under hospital emergency formulary protocol.');

  // Conversion to PO Modal
  const [selectedReqForPo, setSelectedReqForPo] = useState<PurchaseRequisition | null>(null);
  const [poSupplierId, setPoSupplierId] = useState(suppliers[0]?.supplierId || '');
  const [poPaymentTerms, setPoPaymentTerms] = useState('Net 30');
  const [poExpectedDays, setPoExpectedDays] = useState(3);
  const [poNotes, setPoNotes] = useState('Priority hospital supply shipment. Cold-chain continuous monitoring required.');

  // Filtered PRs
  const filteredRequisitions = useMemo(() => {
    return requisitions.filter((r) => {
      const matchFilter = prFilter === 'ALL' || r.status === prFilter;
      const q = searchQuery.toLowerCase();
      const matchQuery =
        r.requisitionNumber.toLowerCase().includes(q) ||
        r.requestingDepartment.toLowerCase().includes(q) ||
        r.justification.toLowerCase().includes(q) ||
        r.items.some((it) => it.itemName.toLowerCase().includes(q) || it.itemCode.toLowerCase().includes(q));
      return matchFilter && matchQuery;
    });
  }, [requisitions, prFilter, searchQuery]);

  // Executive Metrics
  const metrics = useMemo(() => {
    const pending = requisitions.filter((r) => r.status === 'PENDING_APPROVAL');
    const approved = requisitions.filter((r) => r.status === 'APPROVED');
    const converted = requisitions.filter((r) => r.status === 'CONVERTED_TO_PO');
    const totalPoSpend = purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);

    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      convertedCount: converted.length,
      activePoCount: purchaseOrders.length,
      totalPoSpend,
    };
  }, [requisitions, purchaseOrders]);

  // Selected Item for PR Modal
  const currentPrItem = useMemo(() => {
    return items.find((i) => i.itemId === prItemId) || items[0];
  }, [items, prItemId]);

  // Handle Create Requisition
  const handleCreateRequisition = async () => {
    if (!currentPrItem) return;
    setActionLoading(true);
    setFeedback(null);

    const newReqId = `pr-${Date.now()}`;
    const newPrNumber = `PR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const estTotal = Math.round(currentPrItem.unitCost * prQuantity * 100) / 100;

    const newReq: PurchaseRequisition = {
      requisitionId: newReqId,
      tenantId,
      facilityId: 'FAC-MAIN',
      requisitionNumber: newPrNumber,
      requestingDepartment: prDepartment,
      requestingLocationId: 'loc-pharmacy-main',
      requestedBy: {
        userId: 'usr_nurse_lead',
        userName: 'Sarah Jenkins, RN',
        role: 'ICU Head Nurse',
      },
      priority: prPriority,
      items: [
        {
          itemId: currentPrItem.itemId,
          itemCode: currentPrItem.itemCode,
          itemName: currentPrItem.name,
          requestedQuantity: prQuantity,
          uom: currentPrItem.unitOfMeasure,
          currentStock: 15,
          reorderPoint: currentPrItem.reorderPoint,
          suggestedQuantity: prQuantity,
          estimatedUnitCost: currentPrItem.unitCost,
          estimatedTotal: estTotal,
          justification: prJustification,
        },
      ],
      justification: prJustification,
      requiredByDate: new Date(Date.now() + 3 * 86400000).toISOString(),
      estimatedTotalCost: estTotal,
      currency: 'USD',
      clinicalCriticality: currentPrItem.criticality,
      status: 'PENDING_APPROVAL',
      approvalHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await createPurchaseRequisition(tenantId, newReq);
      setFeedback({
        type: 'success',
        text: `Requisition ${newPrNumber} submitted successfully. Immutably logged in audit stream.`,
      });
      setIsNewPrOpen(false);
      await onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create requisition.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Approval Review
  const handleSubmitApprovalDecision = async () => {
    if (!selectedReqForApproval) return;
    setActionLoading(true);
    try {
      await updateRequisitionStatus(tenantId, selectedReqForApproval.requisitionId, approvalDecision, {
        name: approverName,
        role: approverRole,
        comments: approvalNotes,
      });

      setFeedback({
        type: 'success',
        text: `Requisition ${selectedReqForApproval.requisitionNumber} marked as ${approvalDecision} with immutable audit event logged.`,
      });
      setSelectedReqForApproval(null);
      await onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error updating approval status.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle PO Conversion
  const handleExecutePoConversion = async () => {
    if (!selectedReqForPo) return;
    setActionLoading(true);
    setFeedback(null);

    const chosenSupplier = suppliers.find((s) => s.supplierId === poSupplierId) || suppliers[0];
    if (!chosenSupplier) {
      setFeedback({ type: 'error', text: 'Please select an approved supplier.' });
      setActionLoading(false);
      return;
    }

    try {
      const generatedPo = await convertRequisitionToPO(
        tenantId,
        selectedReqForPo.requisitionId,
        chosenSupplier.supplierId,
        chosenSupplier.displayName || chosenSupplier.legalName,
        {
          userId: 'usr_scm_director',
          userName: 'Elena Rostova, CPIM',
          role: 'Hospital SCM Director',
        },
        poNotes || `Converted to PO under payment terms ${poPaymentTerms}.`
      );

      setFeedback({
        type: 'success',
        text: `Successfully converted PR ${selectedReqForPo.requisitionNumber} into Purchase Order ${generatedPo.poNumber}! Both state transition events PR_CONVERTED_TO_PO and PO_GENERATED recorded.`,
      });
      setSelectedReqForPo(null);
      await onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to generate PO.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
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

      {/* Top Banner & Action */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 border border-blue-200 dark:border-blue-900">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Procurement Lifecycle & PO Generation Module
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold font-mono">
                  PR &rarr; Approval &rarr; PO
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                End-to-end procurement orchestrator with multi-tier medical approval rules and atomic domain event generation.
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-create-clinical-pr"
          onClick={() => setIsNewPrOpen(true)}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Purchase Requisition (PR)
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Pending Approvals</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-2">
            {metrics.pendingCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            Awaiting CMO / SCM review
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Approved (Ready for PO)</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {metrics.approvedCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            1-Click PO generation ready
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Converted to PO</span>
            <Truck className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">
            {metrics.convertedCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            Dispatched to vendors
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Active Purchase Orders</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-2">
            {metrics.activePoCount} <span className="text-xs font-normal text-slate-400">(${metrics.totalPoSpend.toLocaleString()})</span>
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
            Commitment total
          </p>
        </div>
      </div>

      {/* Two Tab Sections: 1. Purchase Requisitions & Approval Engine, 2. Generated Purchase Orders Master */}
      <div className="space-y-4">
        {/* PR Search & Filter Header */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Requisition, Item, Department..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
            {['ALL', 'PENDING_APPROVAL', 'APPROVED', 'CONVERTED_TO_PO', 'REJECTED'].map((st) => (
              <button
                key={st}
                onClick={() => setPrFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                  prFilter === st
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                {st.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Requisitions List */}
        <div className="space-y-3">
          {filteredRequisitions.map((req) => {
            const isPending = req.status === 'PENDING_APPROVAL';
            const isApproved = req.status === 'APPROVED';
            const isConverted = req.status === 'CONVERTED_TO_PO';

            return (
              <div
                key={req.requisitionId}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3"
              >
                {/* PR Top Info */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400">
                      {req.requisitionNumber}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                        req.priority === 'EMERGENCY'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          : req.priority === 'URGENT'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {req.priority}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Dept: <strong className="text-slate-700 dark:text-slate-300">{req.requestingDepartment}</strong>
                    </span>
                    <span className="text-xs text-slate-400">
                      • Requested by: {req.requestedBy.userName}
                    </span>
                  </div>

                  {/* Action Buttons for Lifecycle Transitions */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono ${
                        isApproved
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : isPending
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : isConverted
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {req.status}
                    </span>

                    {/* Pending State: Trigger Approval Modal */}
                    {isPending && (
                      <button
                        onClick={() => {
                          setSelectedReqForApproval(req);
                          setApprovalDecision('APPROVED');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Review & Approve
                      </button>
                    )}

                    {/* Approved State: 1-Click Convert to PO */}
                    {isApproved && (
                      <button
                        onClick={() => setSelectedReqForPo(req)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        Convert to PO
                      </button>
                    )}

                    {isConverted && (
                      <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800">
                        {req.convertedPOId ? `PO: ${req.convertedPOId}` : 'PO Generated'}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-500">Justification:</span> {req.justification}
                </p>

                {/* Line Items Table */}
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Line Items Requested:</div>
                  <div className="space-y-1.5">
                    {req.items.map((it, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs py-1 border-b border-slate-200/50 dark:border-slate-700/50 last:border-b-0"
                      >
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {it.itemName}
                          </span>
                          <span className="text-slate-400 font-mono text-[11px] ml-2">
                            ({it.itemCode})
                          </span>
                        </div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {it.requestedQuantity} {it.uom} &times; ${it.estimatedUnitCost} ={' '}
                          <span className="text-emerald-600 dark:text-emerald-400">${it.estimatedTotal}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Purchase Orders Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-500" />
                Active Purchase Orders (PO) Dispatched to Vendors
              </h3>
              <p className="text-xs text-slate-400">
                Official commitments generated from approved requisitions with 3-way match tracking
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 font-semibold">
              {purchaseOrders.length} Purchase Orders
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="p-3">PO Number</th>
                  <th className="p-3">Supplier Name</th>
                  <th className="p-3">Originating PR</th>
                  <th className="p-3">Expected Date</th>
                  <th className="p-3">Payment Terms</th>
                  <th className="p-3 text-right">Total Amount</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {purchaseOrders.map((po) => (
                  <tr key={po.poId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                      {po.poNumber}
                    </td>
                    <td className="p-3 font-medium text-slate-800 dark:text-slate-200">
                      {po.supplierName}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-slate-500">
                      {po.requisitionId || 'PR-Direct'}
                    </td>
                    <td className="p-3 font-mono text-slate-500">
                      {po.expectedDeliveryDate.split('T')[0]}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">
                      {po.paymentTerms}
                    </td>
                    <td className="p-3 text-right font-bold text-slate-900 dark:text-slate-100">
                      ${po.totalAmount.toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-mono">
                        {po.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 1. Modal: Create Clinical Purchase Requisition */}
      {isNewPrOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-blue-600" />
                Submit Clinical Purchase Requisition (PR)
              </h3>
              <button
                onClick={() => setIsNewPrOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Requesting Hospital Department:
                </label>
                <select
                  value={prDepartment}
                  onChange={(e) => setPrDepartment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  <option value="Intensive Care Unit (ICU)">Intensive Care Unit (ICU)</option>
                  <option value="Emergency Department (ED)">Emergency Department (ED)</option>
                  <option value="Operating Theatres (OT)">Operating Theatres (OT)</option>
                  <option value="Inpatient Central Pharmacy">Inpatient Central Pharmacy</option>
                  <option value="Oncology Infusion Center">Oncology Infusion Center</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Priority Level:
                  </label>
                  <select
                    value={prPriority}
                    onChange={(e) => setPrPriority(e.target.value as typeof prPriority)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <option value="NORMAL">NORMAL — Routine replenishment</option>
                    <option value="URGENT">URGENT — Depleted safety stock</option>
                    <option value="EMERGENCY">EMERGENCY (STAT) — Life-critical</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Requested Quantity:
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={prQuantity}
                    onChange={(e) => setPrQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Item Required:
                </label>
                <select
                  value={prItemId}
                  onChange={(e) => setPrItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {items.map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {it.name} ({it.itemCode}) — Est. Unit Cost: ${it.unitCost}
                    </option>
                  ))}
                </select>
              </div>

              {currentPrItem && (
                <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">
                    Estimated Requisition Total ({prQuantity} {currentPrItem.unitOfMeasure}):
                  </span>
                  <span className="font-bold text-sm text-blue-600 dark:text-blue-400">
                    ${Math.round(currentPrItem.unitCost * prQuantity * 100) / 100}
                  </span>
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Clinical Justification Notes:
                </label>
                <textarea
                  rows={2}
                  value={prJustification}
                  onChange={(e) => setPrJustification(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsNewPrOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleCreateRequisition}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-xs transition-colors"
              >
                {actionLoading ? 'Submitting...' : 'Submit Requisition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Multi-Tier Requisition Approval Review */}
      {selectedReqForApproval && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-600" />
                Approval Engine: Review {selectedReqForApproval.requisitionNumber}
              </h3>
              <button
                onClick={() => setSelectedReqForApproval(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Dept: {selectedReqForApproval.requestingDepartment} • Priority: {selectedReqForApproval.priority}
                </div>
                <div className="text-slate-500 mt-1">
                  Justification: {selectedReqForApproval.justification}
                </div>
                <div className="text-emerald-600 font-bold mt-1">
                  Estimated Total: ${selectedReqForApproval.estimatedTotalCost}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Approval Decision:
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setApprovalDecision('APPROVED')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer border ${
                      approvalDecision === 'APPROVED'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Approve PR
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovalDecision('REJECTED')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer border ${
                      approvalDecision === 'REJECTED'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Reject PR
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Approver Name:
                  </label>
                  <input
                    type="text"
                    value={approverName}
                    onChange={(e) => setApproverName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Role / Authority:
                  </label>
                  <input
                    type="text"
                    value={approverRole}
                    onChange={(e) => setApproverRole(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Approval / Rejection Audit Notes:
                </label>
                <textarea
                  rows={2}
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setSelectedReqForApproval(null)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleSubmitApprovalDecision}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-xs transition-colors"
              >
                {actionLoading ? 'Recording Decision...' : 'Commit Approval Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: 1-Click PO Generation from Approved PR */}
      {selectedReqForPo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                Generate Purchase Order from {selectedReqForPo.requisitionNumber}
              </h3>
              <button
                onClick={() => setSelectedReqForPo(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Approved Requisition: {selectedReqForPo.requisitionNumber} (${selectedReqForPo.estimatedTotalCost})
                </div>
                <div className="text-slate-500 mt-1">
                  Items: {selectedReqForPo.items.map((i) => `${i.itemName} (${i.requestedQuantity} ${i.uom})`).join(', ')}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Assign Hospital Supplier:
                </label>
                <select
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {suppliers.map((s) => (
                    <option key={s.supplierId} value={s.supplierId}>
                      {s.displayName || s.legalName} ({s.registrationNumber || s.supplierId}) — Score: {s.scorecard?.overallExplainableScore || 95}/100 • {s.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Commercial Payment Terms:
                  </label>
                  <select
                    value={poPaymentTerms}
                    onChange={(e) => setPoPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <option value="Net 30">Net 30 Days</option>
                    <option value="Net 60">Net 60 Days</option>
                    <option value="2% 10 Net 30">2% 10 Net 30 (Early Payment Discount)</option>
                    <option value="Immediate">Immediate / Advance</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Lead Time to Delivery:
                  </label>
                  <select
                    value={poExpectedDays}
                    onChange={(e) => setPoExpectedDays(parseInt(e.target.value) || 3)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <option value="1">1 Day (STAT / Expedited Courier)</option>
                    <option value="3">3 Days (Standard Hospital Delivery)</option>
                    <option value="7">7 Days (Weekly Restock)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Vendor Instructions / Cold-Chain Mandates:
                </label>
                <textarea
                  rows={2}
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setSelectedReqForPo(null)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleExecutePoConversion}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-xs transition-colors flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {actionLoading ? 'Generating PO...' : 'Confirm PO & Dispatch to Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
