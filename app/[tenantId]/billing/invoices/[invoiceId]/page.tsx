'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import {
  Receipt,
  Printer,
  CreditCard,
  Banknote,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Plus,
  Trash2,
  DollarSign,
  Building2,
  FileText,
  User,
  Activity,
  AlertCircle,
  Percent,
} from 'lucide-react';
import { Invoice, ChargeItem, InvoicePaymentMethod } from '@/types/billing';
import { formatCurrency } from '@/lib/utils';
import { calculateLineItem } from '@/lib/billing/charges';

interface PageProps {
  params: Promise<{
    tenantId: string;
    invoiceId: string;
  }>;
}

export default function InvoicePosTerminalPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';
  const invoiceId = resolvedParams.invoiceId || 'inv-enc-8092-441';

  const [invoice, setInvoice] = useState<Invoice>({
    id: invoiceId,
    tenantId,
    invoiceNumber: 'INV-2026-08491',
    patientId: 'p-1001',
    patientName: 'Robert Martinez',
    mrn: 'GH-2026-1042',
    encounterId: 'enc-8092-441',
    tariffId: 'tf-ppo-02',
    tariffName: 'BlueCross / Commercial PPO Tier-1',
    planName: 'private_insurance',
    payerName: 'BlueCross BlueShield of Texas',
    policyNumber: 'BCBS-TX-984920',
    approvalCode: 'AUTH-940219-BCBS',
    totalGross: 4395.0,
    totalDiscount: 725.0,
    totalTax: 0,
    totalCoverage: 2936.0,
    totalPatientDue: 734.0,
    totalPaid: 0,
    balanceDue: 734.0,
    paymentStatus: 'pending',
    paymentMethod: 'split',
    items: [
      {
        id: 'chg-101',
        entitySource: 'consultation',
        code: 'CPT-99214',
        description: 'Level 4 Detailed Outpatient Cardiology Consultation',
        quantity: 1,
        unitPrice: 145,
        grossAmount: 145,
        discountAmount: 35,
        tax: 0,
        netAmount: 145,
        insurancePortion: 116,
        patientPortion: 29,
        timestamp: '2026-02-19T09:15:00Z',
        status: 'billed',
        icd10Code: 'I25.10',
        icd10Description: 'Atherosclerotic heart disease of native coronary artery',
      },
      {
        id: 'chg-102',
        entitySource: 'procedure',
        code: 'CPT-33512',
        description: 'Off-Pump Coronary Artery Bypass Graft (CABG x3)',
        quantity: 1,
        unitPrice: 3400,
        grossAmount: 3400,
        discountAmount: 600,
        tax: 0,
        netAmount: 3400,
        insurancePortion: 2720,
        patientPortion: 680,
        timestamp: '2026-02-19T10:30:00Z',
        status: 'billed',
        icd10Code: 'I25.10',
        icd10Description: 'Atherosclerotic heart disease',
      },
      {
        id: 'chg-103',
        entitySource: 'bed_day',
        code: 'BED-ICU-01',
        description: 'ICU Critical Care Day Stay & Telemetry Monitoring',
        quantity: 1,
        unitPrice: 850,
        grossAmount: 850,
        discountAmount: 90,
        tax: 0,
        netAmount: 850,
        insurancePortion: 100,
        patientPortion: 25,
        timestamp: '2026-02-19T14:00:00Z',
        status: 'billed',
      },
    ],
    createdAt: '2026-02-19T14:30:00Z',
    updatedAt: '2026-02-19T15:00:00Z',
  });

  const [paymentAmount, setPaymentAmount] = useState<number>(invoice.balanceDue);
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('card');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [receiptPrinted, setReceiptPrinted] = useState(false);

  // New Charge Item Form
  const [newSource, setNewSource] = useState<'consultation' | 'pharmacy' | 'lab' | 'radiology' | 'bed_day'>('pharmacy');
  const [newCode, setNewCode] = useState('RX-ATORV-40');
  const [newDesc, setNewDesc] = useState('Atorvastatin Calcium 40mg Oral Tablet');
  const [newQty, setNewQty] = useState(1);
  const [newPrice, setNewPrice] = useState(45);

  const handleCollectPayment = () => {
    const nextPaid = invoice.totalPaid + Number(paymentAmount);
    const nextBalance = Math.max(0, invoice.totalPatientDue - nextPaid);

    setInvoice((prev) => ({
      ...prev,
      totalPaid: nextPaid,
      balanceDue: nextBalance,
      paymentStatus: nextBalance === 0 ? 'paid' : 'partially_paid',
      paymentMethod,
      updatedAt: new Date().toISOString(),
    }));

    setReceiptPrinted(true);
  };

  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    const calculated = calculateLineItem({
      entitySource: newSource,
      code: newCode,
      description: newDesc,
      quantity: Number(newQty),
      standardPrice: Number(newPrice),
      tariff: {
        id: 'tf-ppo-02',
        tenantId,
        name: 'PPO Tier-1',
        planName: 'private_insurance',
        defaultDiscountPercent: 15,
        copayPercent: 20,
        priceOverrides: {},
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    });

    const updatedItems = [...invoice.items, calculated];
    const totalGross = updatedItems.reduce((sum, item) => sum + item.grossAmount, 0);
    const totalCoverage = updatedItems.reduce((sum, item) => sum + item.insurancePortion, 0);
    const totalPatientDue = updatedItems.reduce((sum, item) => sum + item.patientPortion, 0);
    const balanceDue = Math.max(0, totalPatientDue - invoice.totalPaid);

    setInvoice((prev) => ({
      ...prev,
      items: updatedItems,
      totalGross,
      totalCoverage,
      totalPatientDue,
      balanceDue,
      updatedAt: new Date().toISOString(),
    }));

    setPaymentAmount(balanceDue);
    setShowAddItemModal(false);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Breadcrumb & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <Link
            href={`/${tenantId}/billing/invoices`}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Invoice POS Terminal: {invoice.invoiceNumber}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Patient: <strong className="text-slate-800 dark:text-slate-200">{invoice.patientName}</strong> ({invoice.mrn}) &bull; Encounter: {invoice.encounterId}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Invoice Slip</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddItemModal(true)}
            className="px-3.5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Charge Item</span>
          </button>
        </div>
      </div>

      {/* Invoice Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Itemized Line Items Table (8 cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Itemized Clinical & Pharmacy Charge Items
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automated 80/20 commercial split calculation with deductible cap enforcement
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {invoice.tariffName}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 font-bold">Code / Item</th>
                  <th className="py-2.5 font-bold text-center">Qty</th>
                  <th className="py-2.5 font-bold text-right">Unit Price</th>
                  <th className="py-2.5 font-bold text-right">Total Net</th>
                  <th className="py-2.5 font-bold text-right text-blue-600 dark:text-blue-400">Payer Covered</th>
                  <th className="py-2.5 font-bold text-right text-slate-900 dark:text-slate-100">Patient Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoice.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                    <td className="py-3">
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400 block">
                        {item.code}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {item.description}
                      </span>
                    </td>
                    <td className="py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {item.quantity}
                    </td>
                    <td className="py-3 text-right font-medium text-slate-600 dark:text-slate-400">
                      {formatCurrency(item.unitPrice)}
                    </td>
                    <td className="py-3 text-right font-bold text-slate-900 dark:text-slate-100">
                      {formatCurrency(item.netAmount)}
                    </td>
                    <td className="py-3 text-right font-bold text-blue-600 dark:text-blue-400">
                      {formatCurrency(item.insurancePortion)}
                    </td>
                    <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(item.patientPortion)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary Breakdown */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <div className="w-72 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Gross Hospital Total:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(invoice.totalGross)}
                </span>
              </div>
              <div className="flex justify-between text-blue-600 dark:text-blue-400">
                <span>Payer Coverage (EDI Claim):</span>
                <span className="font-bold">-{formatCurrency(invoice.totalCoverage)}</span>
              </div>
              <div className="flex justify-between text-slate-900 dark:text-slate-100 font-bold pt-2 border-t border-slate-200 dark:border-slate-700">
                <span>Patient Responsibility (Copay):</span>
                <span className="text-base font-black text-slate-900 dark:text-slate-100">
                  {formatCurrency(invoice.totalPatientDue)}
                </span>
              </div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                <span>Total Paid to Date:</span>
                <span>{formatCurrency(invoice.totalPaid)}</span>
              </div>
              <div className="flex justify-between text-rose-600 dark:text-rose-400 font-bold pt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                <span>Outstanding Patient Balance:</span>
                <span className="text-base font-black">{formatCurrency(invoice.balanceDue)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: POS Copay Collection Terminal (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                POS Copay Collection Terminal
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Terminal #04
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`p-2.5 rounded-xl border text-center font-bold flex flex-col items-center gap-1 transition-all ${
                      paymentMethod === 'card'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Credit Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`p-2.5 rounded-xl border text-center font-bold flex flex-col items-center gap-1 transition-all ${
                      paymentMethod === 'cash'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Cash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('mobile_wallet')}
                    className={`p-2.5 rounded-xl border text-center font-bold flex flex-col items-center gap-1 transition-all ${
                      paymentMethod === 'mobile_wallet'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Wallet/QR</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Collection Amount ($)
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-black text-slate-900 dark:text-slate-100"
                />
              </div>

              <button
                type="button"
                onClick={handleCollectPayment}
                disabled={invoice.balanceDue === 0}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 text-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {invoice.balanceDue === 0 ? 'Invoice Settled' : `Process Settlement (${formatCurrency(paymentAmount)})`}
                </span>
              </button>
            </div>

            {receiptPrinted && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Payment recorded successfully. Electronic receipt dispatched to patient portal.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Add Ad-Hoc Charge Item
              </h3>
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAddNewItem} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Source Category
                </label>
                <select
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                >
                  <option value="pharmacy">Pharmacy / Medication</option>
                  <option value="lab">Pathology Lab Test</option>
                  <option value="radiology">Radiology & Imaging</option>
                  <option value="consultation">Specialist Consultation</option>
                  <option value="bed_day">Room & Nursing Bed Day</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Item / CPT Code
                </label>
                <input
                  required
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <input
                  required
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newQty}
                    onChange={(e) => setNewQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Unit Price ($)
                  </label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Calculate & Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
