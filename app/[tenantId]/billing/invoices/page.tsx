'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import {
  Receipt,
  Search,
  CheckCircle2,
  Clock,
  DollarSign,
  User,
  Filter,
  ArrowRight,
  Plus,
  Printer,
  ShieldCheck,
  Building2,
  FileSpreadsheet,
} from 'lucide-react';
import { Invoice, InvoicePaymentStatus } from '@/types/billing';
import { formatCurrency } from '@/lib/utils';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function InvoicesDirectoryPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';

  const [invoices, setInvoices] = useState<Invoice[]>([
    {
      id: 'inv-enc-8092-441',
      tenantId,
      invoiceNumber: 'INV-2026-08491',
      patientId: 'p-1001',
      patientName: 'Robert Martinez',
      mrn: 'GH-2026-1042',
      encounterId: 'enc-8092-441',
      tariffId: 'tf-ppo-02',
      tariffName: 'BlueCross PPO Tier-1',
      planName: 'private_insurance',
      payerName: 'BlueCross BlueShield of Texas',
      policyNumber: 'BCBS-TX-984920',
      totalGross: 4850.0,
      totalDiscount: 727.5,
      totalTax: 0,
      totalCoverage: 3300.0,
      totalPatientDue: 822.5,
      totalPaid: 822.5,
      balanceDue: 0,
      paymentStatus: 'paid',
      paymentMethod: 'card',
      items: [
        {
          id: 'chg-1',
          entitySource: 'consultation',
          code: 'CPT-99214',
          description: 'Detailed Outpatient Cardiology Review',
          quantity: 1,
          unitPrice: 145,
          grossAmount: 145,
          discountAmount: 25,
          tax: 0,
          netAmount: 145,
          insurancePortion: 116,
          patientPortion: 29,
          timestamp: '2026-02-18T10:00:00Z',
          status: 'billed',
        },
        {
          id: 'chg-2',
          entitySource: 'procedure',
          code: 'CPT-33512',
          description: 'Coronary Artery Bypass Graft (CABG x3)',
          quantity: 1,
          unitPrice: 3400,
          grossAmount: 3400,
          discountAmount: 600,
          tax: 0,
          netAmount: 3400,
          insurancePortion: 2720,
          patientPortion: 680,
          timestamp: '2026-02-18T11:00:00Z',
          status: 'billed',
        },
        {
          id: 'chg-3',
          entitySource: 'bed_day',
          code: 'BED-ICU-01',
          description: 'ICU Critical Care Day Stay & Continuous Telemetry',
          quantity: 1,
          unitPrice: 850,
          grossAmount: 850,
          discountAmount: 102.5,
          tax: 0,
          netAmount: 850,
          insurancePortion: 464,
          patientPortion: 113.5,
          timestamp: '2026-02-18T14:00:00Z',
          status: 'billed',
        },
      ],
      createdAt: '2026-02-18T14:30:00Z',
      updatedAt: '2026-02-18T15:00:00Z',
    },
    {
      id: 'inv-enc-8092-442',
      tenantId,
      invoiceNumber: 'INV-2026-08492',
      patientId: 'p-1002',
      patientName: 'Eleanor Vance',
      mrn: 'GH-2026-3391',
      encounterId: 'enc-8092-442',
      tariffId: 'tf-cash-01',
      tariffName: 'Cash / Self-Pay Standard',
      planName: 'cash',
      totalGross: 620.0,
      totalDiscount: 0,
      totalTax: 0,
      totalCoverage: 0,
      totalPatientDue: 620.0,
      totalPaid: 300.0,
      balanceDue: 320.0,
      paymentStatus: 'partially_paid',
      paymentMethod: 'split',
      items: [
        {
          id: 'chg-4',
          entitySource: 'consultation',
          code: 'CPT-99213',
          description: 'Standard Orthopedic Examination',
          quantity: 1,
          unitPrice: 120,
          grossAmount: 120,
          discountAmount: 0,
          tax: 0,
          netAmount: 120,
          insurancePortion: 0,
          patientPortion: 120,
          timestamp: '2026-02-19T09:00:00Z',
          status: 'billed',
        },
        {
          id: 'chg-5',
          entitySource: 'radiology',
          code: 'RAD-73562',
          description: 'Right Knee 3-View Radiograph',
          quantity: 1,
          unitPrice: 500,
          grossAmount: 500,
          discountAmount: 0,
          tax: 0,
          netAmount: 500,
          insurancePortion: 0,
          patientPortion: 500,
          timestamp: '2026-02-19T09:30:00Z',
          status: 'billed',
        },
      ],
      createdAt: '2026-02-19T10:00:00Z',
      updatedAt: '2026-02-19T10:15:00Z',
    },
    {
      id: 'inv-enc-8092-443',
      tenantId,
      invoiceNumber: 'INV-2026-08493',
      patientId: 'p-1003',
      patientName: 'Sofia Chen',
      mrn: 'GH-2026-7731',
      encounterId: 'enc-8092-443',
      tariffId: 'tf-corp-03',
      tariffName: 'Corporate Executive Health',
      planName: 'corporate',
      payerName: 'Aramco Energy Corporate Group',
      totalGross: 1450.0,
      totalDiscount: 145.0,
      totalTax: 0,
      totalCoverage: 1450.0,
      totalPatientDue: 0,
      totalPaid: 0,
      balanceDue: 0,
      paymentStatus: 'pending',
      paymentMethod: 'insurance_claim',
      items: [
        {
          id: 'chg-6',
          entitySource: 'lab',
          code: 'LAB-80053',
          description: 'Comprehensive Metabolic Panel (CMP)',
          quantity: 1,
          unitPrice: 65,
          grossAmount: 65,
          discountAmount: 20,
          tax: 0,
          netAmount: 65,
          insurancePortion: 65,
          patientPortion: 0,
          timestamp: '2026-02-19T11:00:00Z',
          status: 'billed',
        },
      ],
      createdAt: '2026-02-19T11:30:00Z',
      updatedAt: '2026-02-19T11:30:00Z',
    },
  ]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredInvoices = invoices.filter((inv) => {
    const matchSearch =
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.patientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.mrn.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || inv.paymentStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const getStatusBadge = (status: InvoicePaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Fully Settled
          </span>
        );
      case 'partially_paid':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Partially Paid
          </span>
        );
      case 'pending':
        return (
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Payer Pending
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Receipt className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Point-of-Sale & Split Invoicing Register
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Interactive copay collection, payer coverage allocation, and settlement terminals for {tenantId}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/${tenantId}/billing/tariffs`}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
          >
            Tariff Schedules
          </Link>
          <Link
            href={`/${tenantId}/billing/claims`}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
          >
            Claims Workbench
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by invoice #, patient, or MRN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
          >
            <option value="all">All Invoices</option>
            <option value="paid">Fully Settled</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="pending">Payer Pending</option>
          </select>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400">
                <th className="py-3.5 px-4 font-bold">Invoice #</th>
                <th className="py-3.5 px-4 font-bold">Patient / MRN</th>
                <th className="py-3.5 px-4 font-bold">Tariff / Payer</th>
                <th className="py-3.5 px-4 font-bold text-right">Gross Total</th>
                <th className="py-3.5 px-4 font-bold text-right">Payer Portion</th>
                <th className="py-3.5 px-4 font-bold text-right">Patient Due</th>
                <th className="py-3.5 px-4 font-bold text-right">Balance Due</th>
                <th className="py-3.5 px-4 font-bold text-center">Status</th>
                <th className="py-3.5 px-4 font-bold text-center">Terminal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-bold text-slate-900 dark:text-slate-100 block">
                      {inv.patientName}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">{inv.mrn}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-medium text-slate-800 dark:text-slate-200 block">
                      {inv.tariffName || 'Cash Plan'}
                    </span>
                    <span className="text-[11px] text-slate-400">{inv.payerName || 'Direct Payment'}</span>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                    {formatCurrency(inv.totalGross)}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-blue-600 dark:text-blue-400">
                    {formatCurrency(inv.totalCoverage)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                    {formatCurrency(inv.totalPatientDue)}
                  </td>
                  <td className="py-3 px-4 text-right font-black text-rose-600 dark:text-rose-400">
                    {formatCurrency(inv.balanceDue)}
                  </td>
                  <td className="py-3 px-4 text-center">{getStatusBadge(inv.paymentStatus)}</td>
                  <td className="py-3 px-4 text-center">
                    <Link
                      href={`/${tenantId}/billing/invoices/${inv.id}`}
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold rounded-xl inline-flex items-center gap-1 transition-colors"
                    >
                      <span>Open POS</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
