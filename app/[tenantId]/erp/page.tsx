'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Scale,
  DollarSign,
  TrendingUp,
  Building2,
  Calendar,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  History,
  FileCheck,
  RefreshCw,
  Search,
  Sparkles,
  ReceiptText,
  Briefcase,
  Layers,
  ChevronRight,
  ShieldAlert,
  Sliders,
  Check,
} from 'lucide-react';
import {
  Account,
  JournalEntry,
  AccountingPeriod,
  LedgerEntry,
  FinancialAuditLog,
  CashRegisterShift,
  FinancialAnomaly,
} from '@/types/erp-finance';
import {
  subscribeToAccounts,
  subscribeToJournalEntries,
  getAccountingPeriods,
  setAccountingPeriodStatus,
  subscribeToLedgerEntries,
  subscribeToFinancialAuditLogs,
  getCashRegisterShifts,
  openCashRegisterShift,
  closeAndReconcileShift,
  detectFinancialAnomalies,
} from '@/lib/firebase/services/erp-finance';

type ActiveTab = 'overview' | 'ledger' | 'periods' | 'shifts' | 'audit' | 'anomalies';

export default function ErpFinanceDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [loading, setLoading] = useState(true);

  // Core Data States
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [auditLogs, setAuditLogs] = useState<FinancialAuditLog[]>([]);
  const [cashShifts, setCashShifts] = useState<CashRegisterShift[]>([]);
  const [anomalies, setAnomalies] = useState<FinancialAnomaly[]>([]);

  // Filtering states
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [selectedAccountFilter, setSelectedAccountFilter] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');

  // Reconcile Modal State
  const [selectedShiftToReconcile, setSelectedShiftToReconcile] = useState<CashRegisterShift | null>(null);
  const [countedCash, setCountedCash] = useState<string>('');
  const [reconcileNotes, setReconcileNotes] = useState<string>('');
  const [reconciling, setReconciling] = useState(false);

  // New Shift Modal State
  const [showNewShiftModal, setShowNewShiftModal] = useState(false);
  const [newShiftCashier, setNewShiftCashier] = useState('Elena Rostova, CPhT');
  const [newShiftRegister, setNewShiftRegister] = useState('POS-PHARM-03');
  const [newShiftOpeningCash, setNewShiftOpeningCash] = useState('250.00');

  // Load and subscribe to real-time data
  useEffect(() => {
    setLoading(true);

    const unsubAccounts = subscribeToAccounts(tenantId, (data) => {
      setAccounts(data);
    });

    const unsubJournals = subscribeToJournalEntries(tenantId, (data) => {
      setJournalEntries(data);
    });

    const unsubLedger = subscribeToLedgerEntries(tenantId, (data) => {
      setLedgerEntries(data);
    });

    const unsubAudit = subscribeToFinancialAuditLogs(tenantId, (data) => {
      setAuditLogs(data);
    });

    // Load initial async sets
    async function loadAuxData() {
      try {
        const [periodData, shiftData, anomalyData] = await Promise.all([
          getAccountingPeriods(tenantId),
          getCashRegisterShifts(tenantId),
          detectFinancialAnomalies(tenantId),
        ]);
        setPeriods(periodData);
        setCashShifts(shiftData);
        setAnomalies(anomalyData);
      } catch (err) {
        console.error('Failed to load aux financial data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadAuxData();

    return () => {
      unsubAccounts();
      unsubJournals();
      unsubLedger();
      unsubAudit();
    };
  }, [tenantId]);

  // Aggregate Financial Statistics
  const financialTotals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    let revenue = 0;
    let expenses = 0;

    accounts.forEach((a) => {
      const bal = Number(a.balance) || 0;
      if (a.category === 'asset') assets += bal;
      if (a.category === 'liability') liabilities += bal;
      if (a.category === 'equity') equity += bal;
      if (a.category === 'revenue') revenue += bal;
      if (a.category === 'expense') expenses += bal;
    });

    const netOperatingSurplus = revenue - expenses;
    const operatingMarginPct = revenue > 0 ? (netOperatingSurplus / revenue) * 100 : 0;
    const totalEquationRight = liabilities + equity + netOperatingSurplus;
    const isEquationBalanced = Math.abs(assets - totalEquationRight) < 0.05;

    return {
      assets,
      liabilities,
      equity,
      revenue,
      expenses,
      netOperatingSurplus,
      operatingMarginPct,
      isEquationBalanced,
    };
  }, [accounts]);

  // Handle Changing Accounting Period Status
  const handleTogglePeriodStatus = async (
    periodId: string,
    currentStatus: AccountingPeriod['status'],
    newStatus: AccountingPeriod['status']
  ) => {
    try {
      await setAccountingPeriodStatus(tenantId, periodId, newStatus, 'Senior Finance Controller');
      const updated = await getAccountingPeriods(tenantId);
      setPeriods(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update period';
      alert(msg);
    }
  };

  // Handle Shift Reconcile Submit
  const handleReconcileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShiftToReconcile) return;

    setReconciling(true);
    try {
      const cashVal = parseFloat(countedCash) || 0;
      await closeAndReconcileShift(tenantId, selectedShiftToReconcile.id, {
        closingBalance: cashVal,
        cashCollected: selectedShiftToReconcile.cashCollected,
        cardCollected: selectedShiftToReconcile.cardCollected,
        systemExpectedCash: selectedShiftToReconcile.systemExpectedCash,
        reconciledBy: 'Head Cashier / Treasury Auditor',
        notes: reconcileNotes,
      });

      const updatedShifts = await getCashRegisterShifts(tenantId);
      setCashShifts(updatedShifts);
      setSelectedShiftToReconcile(null);
      setCountedCash('');
      setReconcileNotes('');
    } catch (err) {
      console.error('Failed to reconcile shift:', err);
    } finally {
      setReconciling(false);
    }
  };

  // Handle Open New Shift
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await openCashRegisterShift(tenantId, {
        cashierId: `csh-${Math.floor(100 + Math.random() * 900)}`,
        cashierName: newShiftCashier,
        registerId: newShiftRegister,
        openingBalance: parseFloat(newShiftOpeningCash) || 250,
      });

      const updated = await getCashRegisterShifts(tenantId);
      setCashShifts(updated);
      setShowNewShiftModal(false);
    } catch (err) {
      console.error('Failed to open shift:', err);
    }
  };

  // Filtered Ledger Entries
  const filteredLedger = useMemo(() => {
    return ledgerEntries.filter((le) => {
      const matchesSearch =
        le.entryNumber.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
        le.accountCode.includes(ledgerSearch) ||
        le.accountName.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
        (le.referenceNumber && le.referenceNumber.toLowerCase().includes(ledgerSearch.toLowerCase()));
      const matchesAcc = selectedAccountFilter === 'all' || le.accountCode === selectedAccountFilter;
      return matchesSearch && matchesAcc;
    });
  }, [ledgerEntries, ledgerSearch, selectedAccountFilter]);

  // Filtered Audit Logs
  const filteredAudit = useMemo(() => {
    return auditLogs.filter((log) => {
      return (
        log.auditNote.toLowerCase().includes(auditSearch.toLowerCase()) ||
        log.userName.toLowerCase().includes(auditSearch.toLowerCase()) ||
        log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
        log.hash.toLowerCase().includes(auditSearch.toLowerCase())
      );
    });
  }, [auditLogs, auditSearch]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Enterprise Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 uppercase tracking-wider">
                <Building2 className="h-3.5 w-3.5" />
                Hospital Enterprise Resource Planning (ERP)
              </div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                Accounts & Universal Finance Engine
              </h1>
              <p className="text-xs text-slate-500">
                Tenant: <span className="font-mono font-semibold text-slate-700">{tenantId}</span> •
                Double-Entry GAAP/IFRS Ledger & Fiscal Governance
              </p>
            </div>

            {/* Quick Navigation Links */}
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/${tenantId}/erp/chart-of-accounts`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs"
              >
                <Layers className="h-3.5 w-3.5 text-slate-500" />
                Chart of Accounts
              </Link>
              <Link
                href={`/${tenantId}/erp/journal-entries`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs"
              >
                <ReceiptText className="h-3.5 w-3.5 text-blue-600" />
                Journal Vouchers
              </Link>
              <Link
                href={`/${tenantId}/erp/fixed-assets`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs"
              >
                <Briefcase className="h-3.5 w-3.5 text-emerald-600" />
                Fixed Assets
              </Link>
              <Link
                href={`/${tenantId}/billing`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 transition-colors shadow-xs"
              >
                <DollarSign className="h-3.5 w-3.5" />
                Patient Revenue Hub
              </Link>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto no-scrollbar">
            <button
              id="tab-overview"
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'overview'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Scale className="h-4 w-4" />
              Financial Equilibrium & Overview
            </button>
            <button
              id="tab-ledger"
              onClick={() => setActiveTab('ledger')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'ledger'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <ReceiptText className="h-4 w-4" />
              General Ledger Running Stream ({ledgerEntries.length})
            </button>
            <button
              id="tab-periods"
              onClick={() => setActiveTab('periods')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'periods'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Calendar className="h-4 w-4" />
              Fiscal Periods & Governance ({periods.length})
            </button>
            <button
              id="tab-shifts"
              onClick={() => setActiveTab('shifts')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'shifts'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Clock className="h-4 w-4" />
              Cashier Shifts & POS Reconciliation ({cashShifts.length})
            </button>
            <button
              id="tab-audit"
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'audit'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <History className="h-4 w-4" />
              HIPAA/SOX Audit Trail ({auditLogs.length})
            </button>
            <button
              id="tab-anomalies"
              onClick={() => setActiveTab('anomalies')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === 'anomalies'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              Integrity & Anomaly Radar ({anomalies.length})
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* TAB 1: OVERVIEW & EQUILIBRIUM */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Real-time Balanced Equation Banner */}
            <div
              className={`p-5 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                financialTotals.isEquationBalanced
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-lg ${
                    financialTotals.isEquationBalanced
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  <Scale className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    {financialTotals.isEquationBalanced
                      ? 'General Ledger Balanced — Invariance Verified'
                      : 'General Ledger Imbalance Warning'}
                  </div>
                  <div className="text-sm mt-0.5">
                    Fundamental Accounting Formula:{' '}
                    <span className="font-mono font-bold">
                      Assets = Liabilities + Equity + (Revenue - Expenses)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="bg-white/80 backdrop-blur-xs px-3 py-1.5 rounded-md border border-emerald-200 text-slate-800">
                  Assets: <span className="font-bold">${financialTotals.assets.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <span>=</span>
                <div className="bg-white/80 backdrop-blur-xs px-3 py-1.5 rounded-md border border-emerald-200 text-slate-800">
                  Liab + Eq + Net:{' '}
                  <span className="font-bold">
                    $
                    {(
                      financialTotals.liabilities +
                      financialTotals.equity +
                      financialTotals.netOperatingSurplus
                    ).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Core Financial Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Total Capital & Liquid Assets</span>
                  <div className="p-1.5 bg-blue-50 text-blue-600 rounded-md">
                    <DollarSign className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
                  ${financialTotals.assets.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <span>Cash, Treasury, Accounts Receivable & Plant</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Liabilities & Vendor Payables</span>
                  <div className="p-1.5 bg-amber-50 text-amber-600 rounded-md">
                    <Layers className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
                  ${financialTotals.liabilities.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  <span>Trade AP, Accrued Payroll, Long-term Debt</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Operating Revenue (YTD)</span>
                  <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-md">
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-700 mt-2">
                  ${financialTotals.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  <span>Inpatient, OPD, Surgical & Pharmacy Billables</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Net Hospital Operating Margin</span>
                  <div className="p-1.5 bg-purple-50 text-purple-600 rounded-md">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
                  ${financialTotals.netOperatingSurplus.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs font-semibold text-emerald-600 mt-1">
                  <span>{financialTotals.operatingMarginPct.toFixed(1)}% Hospital EBITDA Margin</span>
                </div>
              </div>
            </div>

            {/* Sub-systems Hub Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Quick Actions Panel */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-blue-600" />
                  Fiscal Controls & Workflows
                </h3>
                <div className="space-y-2.5">
                  <Link
                    href={`/${tenantId}/erp/journal-entries`}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-xs font-semibold text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <ReceiptText className="h-4 w-4 text-blue-600" />
                      Post New Journal Voucher
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>

                  <button
                    onClick={() => setActiveTab('periods')}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-xs font-semibold text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-amber-600" />
                      Manage Period Locks (Jan-Dec 2026)
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>

                  <button
                    onClick={() => {
                      setShowNewShiftModal(true);
                      setActiveTab('shifts');
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-xs font-semibold text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-600" />
                      Open Cashier Register Shift
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>

                  <Link
                    href={`/${tenantId}/erp/fixed-assets`}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-xs font-semibold text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-purple-600" />
                      Execute Depreciation Run
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>
                </div>
              </div>

              {/* Chart of Accounts Summary */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4 md:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-600" />
                    Top Active General Ledger Accounts
                  </h3>
                  <Link
                    href={`/${tenantId}/erp/chart-of-accounts`}
                    className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    View All {accounts.length} Accounts <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Code</th>
                        <th className="py-2.5 px-3">Account Title</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3 text-right">Balance ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {accounts.slice(0, 5).map((acc) => (
                        <tr key={acc.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                            {acc.accountCode}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {acc.accountName}
                          </td>
                          <td className="py-2.5 px-3 capitalize">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium text-[11px]">
                              {acc.category}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">
                            ${Number(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GENERAL LEDGER STREAM */}
        {activeTab === 'ledger' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ReceiptText className="h-4 w-4 text-blue-600" />
                  General Ledger Line Stream
                </h2>
                <p className="text-xs text-slate-500">
                  Granular debit/credit postings with continuous calculated running balances
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by code, voucher..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500 w-56"
                  />
                </div>

                <select
                  value={selectedAccountFilter}
                  onChange={(e) => setSelectedAccountFilter(e.target.value)}
                  className="py-1.5 px-3 text-xs rounded-lg border border-slate-200 bg-white text-slate-700"
                >
                  <option value="all">All GL Accounts</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.accountCode}>
                      {a.accountCode} - {a.accountName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                  <tr>
                    <th className="py-3 px-4">Posting Date</th>
                    <th className="py-3 px-4">Voucher No.</th>
                    <th className="py-3 px-4">GL Code</th>
                    <th className="py-3 px-4">Account Title</th>
                    <th className="py-3 px-4">Module</th>
                    <th className="py-3 px-4 text-right">Debit ($)</th>
                    <th className="py-3 px-4 text-right">Credit ($)</th>
                    <th className="py-3 px-4 text-right">Running Bal ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLedger.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                        No general ledger line items matched the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLedger.map((le) => (
                      <tr key={le.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-600">{le.postingDate}</td>
                        <td className="py-3 px-4 font-mono font-bold text-blue-700">{le.entryNumber}</td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-800">{le.accountCode}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{le.accountName}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 uppercase">
                            {le.sourceModule}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-blue-700">
                          {le.debit > 0 ? `$${le.debit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                          {le.credit > 0 ? `$${le.credit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                          ${le.runningBalance.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: FISCAL PERIODS & GOVERNANCE */}
        {activeTab === 'periods' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  Fiscal Accounting Periods & Period-Lock Governance
                </h2>
                <p className="text-xs text-slate-500">
                  Enforces strict GAAP rules: Postings to Closed or Locked periods are rejected server-side.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                  <tr>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-4">Fiscal Year</th>
                    <th className="py-3 px-4">Date Range</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4">Closed By</th>
                    <th className="py-3 px-4 text-right">Fiscal Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {periods.map((period) => (
                    <tr key={period.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">{period.periodName}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{period.fiscalYear}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 text-xs">
                        {period.startDate} to {period.endDate}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold ${
                            period.status === 'open'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : period.status === 'soft_close'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : period.status === 'closed'
                              ? 'bg-slate-100 text-slate-700 border border-slate-300'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {period.status === 'open' && <Unlock className="h-3 w-3" />}
                          {period.status === 'soft_close' && <Clock className="h-3 w-3" />}
                          {period.status === 'closed' && <Lock className="h-3 w-3" />}
                          {period.status === 'locked' && <ShieldCheck className="h-3 w-3" />}
                          {period.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs">
                        {period.closedBy || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        {period.status === 'open' && (
                          <button
                            onClick={() => handleTogglePeriodStatus(period.id, period.status, 'soft_close')}
                            className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200"
                          >
                            Soft-Close
                          </button>
                        )}
                        {(period.status === 'open' || period.status === 'soft_close') && (
                          <button
                            onClick={() => handleTogglePeriodStatus(period.id, period.status, 'closed')}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
                          >
                            Close Period
                          </button>
                        )}
                        {period.status === 'closed' && (
                          <>
                            <button
                              onClick={() => handleTogglePeriodStatus(period.id, period.status, 'locked')}
                              className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200"
                            >
                              Permanent Lock
                            </button>
                            <button
                              onClick={() => handleTogglePeriodStatus(period.id, period.status, 'open')}
                              className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
                            >
                              Re-Open
                            </button>
                          </>
                        )}
                        {period.status === 'locked' && (
                          <span className="text-xs text-rose-600 font-semibold flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" /> Sealed by Audit
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: CASH REGISTER SHIFTS & RECONCILIATION */}
        {activeTab === 'shifts' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-600" />
                  Point-of-Care Cash Registers & Shift Reconciliation
                </h2>
                <p className="text-xs text-slate-500">
                  Daily cashier drawer tracking across Outpatient Clinics, Emergency Triage, and Hospital Pharmacy
                </p>
              </div>

              <button
                onClick={() => setShowNewShiftModal(true)}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5"
              >
                <Clock className="h-3.5 w-3.5" /> Open New Register Shift
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                  <tr>
                    <th className="py-3 px-4">Register ID</th>
                    <th className="py-3 px-4">Cashier Name</th>
                    <th className="py-3 px-4">Shift Started</th>
                    <th className="py-3 px-4 text-right">Opening Float ($)</th>
                    <th className="py-3 px-4 text-right">Cash Collected ($)</th>
                    <th className="py-3 px-4 text-right">System Expected ($)</th>
                    <th className="py-3 px-4 text-right">Variance ($)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cashShifts.map((shift) => (
                    <tr key={shift.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-700">{shift.registerId}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{shift.cashierName}</td>
                      <td className="py-3 px-4 font-mono text-slate-600 text-xs">
                        {new Date(shift.shiftStart).toLocaleDateString()} {new Date(shift.shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">${shift.openingBalance.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-800">
                        ${shift.cashCollected.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                        ${shift.systemExpectedCash.toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold ${
                          Math.abs(shift.variance) < 0.01
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {shift.status === 'open' ? '—' : `$${shift.variance.toFixed(2)}`}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                            shift.status === 'reconciled'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : shift.status === 'open'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {shift.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {shift.status === 'open' ? (
                          <button
                            onClick={() => {
                              setSelectedShiftToReconcile(shift);
                              setCountedCash(shift.systemExpectedCash.toFixed(2));
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200"
                          >
                            Count & Reconcile
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 font-medium">Reconciled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="h-4 w-4 text-blue-600" />
                  Immutable Financial Compliance Ledger (HIPAA §164.312(b))
                </h2>
                <p className="text-xs text-slate-500">
                  Every posting, reversal, period status modification, and cash shift generates a cryptographically hashed append-only audit record.
                </p>
              </div>

              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search audit trail..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500 w-64"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Officer / User</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Audit Memo</th>
                    <th className="py-3 px-4 font-mono">Cryptographic Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAudit.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                        No financial audit records recorded.
                      </td>
                    </tr>
                  ) : (
                    filteredAudit.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-600 text-xs whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{log.userName}</td>
                        <td className="py-3 px-4 text-slate-600">{log.userRole}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 uppercase">
                            {log.action.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800">{log.auditNote}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                          {log.hash.substring(0, 20)}...
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: INTEGRITY & ANOMALIES */}
        {activeTab === 'anomalies' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-blue-600" />
                Continuous Financial Audit & Anomaly Radar
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Automated background scanners continuously monitor general ledger vouchers, trial balance equations, and duplicate postings.
              </p>
            </div>

            <div className="space-y-3">
              {anomalies.map((anom) => (
                <div
                  key={anom.id}
                  className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                    anom.severity === 'critical'
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : anom.severity === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg mt-0.5 ${
                        anom.severity === 'critical'
                          ? 'bg-rose-100 text-rose-700'
                          : anom.severity === 'warning'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {anom.severity === 'critical' ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : anom.severity === 'warning' ? (
                        <Clock className="h-5 w-5" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold">{anom.title}</h4>
                      <p className="text-xs mt-1 leading-relaxed opacity-90">{anom.description}</p>
                      <div className="text-[11px] opacity-75 mt-2 font-mono">
                        Detected: {new Date(anom.detectedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded text-xs font-semibold uppercase ${
                      anom.status === 'resolved'
                        ? 'bg-emerald-200/60 text-emerald-900'
                        : anom.status === 'open'
                        ? 'bg-rose-200/60 text-rose-900'
                        : 'bg-amber-200/60 text-amber-900'
                    }`}
                  >
                    {anom.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RECONCILE CASH SHIFT MODAL */}
      {selectedShiftToReconcile && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-emerald-600" />
              Cash Drawer Shift Reconciliation
            </h3>
            <p className="text-xs text-slate-500">
              Terminal: <span className="font-mono font-bold text-slate-800">{selectedShiftToReconcile.registerId}</span> • Cashier: {selectedShiftToReconcile.cashierName}
            </p>

            <form onSubmit={handleReconcileSubmit} className="space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening Cash Float:</span>
                  <span className="font-mono font-bold">${selectedShiftToReconcile.openingBalance.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cash Collected in Shift:</span>
                  <span className="font-mono font-bold">${selectedShiftToReconcile.cashCollected.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-slate-900 font-semibold">
                  <span>System Expected Drawer Cash:</span>
                  <span className="font-mono font-bold text-blue-700">
                    ${selectedShiftToReconcile.systemExpectedCash.toFixed(2)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Physical Cash Counted ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full text-sm font-mono p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supervisor Audit Memo
                </label>
                <textarea
                  rows={2}
                  placeholder="Notes on drawer recount or denomination count..."
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedShiftToReconcile(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reconciling}
                  className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-xs"
                >
                  {reconciling ? 'Committing...' : 'Sign & Close Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OPEN NEW REGISTER SHIFT MODAL */}
      {showNewShiftModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              Open Cash Register Terminal
            </h3>

            <form onSubmit={handleOpenShift} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assign Cashier
                </label>
                <input
                  type="text"
                  required
                  value={newShiftCashier}
                  onChange={(e) => setNewShiftCashier(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Register Terminal ID
                </label>
                <select
                  value={newShiftRegister}
                  onChange={(e) => setNewShiftRegister(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="POS-OPD-01">POS-OPD-01 (Outpatient Clinic A)</option>
                  <option value="POS-ER-02">POS-ER-02 (Emergency Admissions)</option>
                  <option value="POS-PHARM-03">POS-PHARM-03 (Central Pharmacy)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Float / Change Fund ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newShiftOpeningCash}
                  onChange={(e) => setNewShiftOpeningCash(e.target.value)}
                  className="w-full text-sm font-mono p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewShiftModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-xs"
                >
                  Open Terminal Shift
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
