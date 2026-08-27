'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  RefreshCw,
  FolderTree,
  DollarSign,
  TrendingUp,
  Landmark,
  FileSpreadsheet,
  X,
  CreditCard,
} from 'lucide-react';
import { Account, AccountCategory, JournalEntry } from '@/types/erp-finance';
import {
  subscribeToAccounts,
  createAccount,
  seedInitialChartOfAccounts,
  subscribeToJournalEntries,
} from '@/lib/firebase/services/erp-finance';

export default function ChartOfAccountsPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AccountCategory | 'all'>('all');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  // New Account Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<AccountCategory>('asset');
  const [newSubCategory, setNewSubCategory] = useState('Current Assets');
  const [newNormalBalance, setNewNormalBalance] = useState<'debit' | 'credit'>('debit');
  const [newBalance, setNewBalance] = useState<number>(0);
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubAccounts = subscribeToAccounts(tenantId, (data) => {
      setAccounts(data);
      setLoading(false);
    });

    const unsubJE = subscribeToJournalEntries(tenantId, (data) => {
      setJournalEntries(data);
    });

    return () => {
      unsubAccounts();
      unsubJE();
    };
  }, [tenantId]);

  // Aggregate Category Totals
  const totals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    let revenue = 0;
    let expenses = 0;

    accounts.forEach((acc) => {
      const bal = Number(acc.balance) || 0;
      if (acc.category === 'asset') assets += bal;
      if (acc.category === 'liability') liabilities += bal;
      if (acc.category === 'equity') equity += bal;
      if (acc.category === 'revenue') revenue += bal;
      if (acc.category === 'expense') expenses += bal;
    });

    // Net operating surplus = Revenue - Expenses
    const netIncome = revenue - expenses;
    // Total claims on assets = Liabilities + Equity + Net Income
    const accountingEquationImbalance = Math.abs(assets - (liabilities + equity + (revenue - expenses)));

    return {
      assets,
      liabilities,
      equity,
      revenue,
      expenses,
      netIncome,
      isBalanced: accountingEquationImbalance < 0.05,
    };
  }, [accounts]);

  // Filtered accounts list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesSearch =
        acc.accountCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.subCategory.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCat = selectedCategory === 'all' || acc.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [accounts, searchTerm, selectedCategory]);

  // Account Ledger Transactions drilldown
  const selectedAccountTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    const list: Array<{
      entryNumber: string;
      postingDate: string;
      referenceNumber: string;
      description: string;
      lineDescription: string;
      debit: number;
      credit: number;
    }> = [];

    journalEntries.forEach((je) => {
      je.lines.forEach((line) => {
        if (line.accountCode === selectedAccount.accountCode) {
          list.push({
            entryNumber: je.entryNumber,
            postingDate: je.postingDate,
            referenceNumber: je.referenceNumber,
            description: je.description,
            lineDescription: line.description,
            debit: line.debit,
            credit: line.credit,
          });
        }
      });
    });

    return list.sort((a, b) => new Date(b.postingDate).getTime() - new Date(a.postingDate).getTime());
  }, [selectedAccount, journalEntries]);

  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newCode.trim() || !newName.trim()) {
      setCreateError('Please provide both an Account Code and an Account Name.');
      return;
    }

    const duplicate = accounts.some((a) => a.accountCode.trim() === newCode.trim());
    if (duplicate) {
      setCreateError(`Account code "${newCode}" is already in use.`);
      return;
    }

    setCreating(true);
    try {
      await createAccount(tenantId, {
        accountCode: newCode.trim(),
        accountName: newName.trim(),
        category: newCategory,
        subCategory: newSubCategory.trim() || 'General',
        normalBalance: newNormalBalance,
        balance: Number(newBalance) || 0,
        currency: 'USD',
        description: newDescription.trim(),
        isActive: true,
      });

      setShowCreateModal(false);
      setNewCode('');
      setNewName('');
      setNewBalance(0);
      setNewDescription('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create account.');
    } finally {
      setCreating(false);
    }
  };

  const getCategoryBadgeColor = (category: AccountCategory) => {
    switch (category) {
      case 'asset':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'liability':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'equity':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'revenue':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'expense':
        return 'bg-rose-50 text-rose-700 border-rose-200';
    }
  };

  return (
    <div className="space-y-6 pb-12" id="chart-of-accounts-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Chart of Accounts (COA)
              </h1>
              <p className="text-sm text-slate-500">
                Multi-tier general ledger structure, normal balance governance & live ledger drill-down
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="seed-coa-btn"
            onClick={() => seedInitialChartOfAccounts(tenantId)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            title="Reset standard healthcare accounts hierarchy"
          >
            <RefreshCw className="h-4 w-4 text-slate-500" />
            Restore Standard COA
          </button>
          <button
            id="open-create-account-modal-btn"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            New GL Account
          </button>
        </div>
      </div>

      {/* Accounting Equation KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Assets */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>1000 Total Assets</span>
            <ArrowUpRight className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            ${totals.assets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Normal: Debit balance</div>
        </div>

        {/* Liabilities */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>2000 Total Liabilities</span>
            <ArrowDownRight className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            ${totals.liabilities.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Normal: Credit balance</div>
        </div>

        {/* Equity */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>3000 Retained Equity</span>
            <Landmark className="h-4 w-4 text-purple-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            ${totals.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Reserves & capital</div>
        </div>

        {/* Operating Revenue */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>4000 Clinical Revenue</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-emerald-600">
            ${totals.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Hospital & OR Billings</div>
        </div>

        {/* Operating Expenses */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>6000 Operating Exp</span>
            <DollarSign className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-xl font-bold text-rose-600">
            ${totals.expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Salaries, drugs & supplies</div>
        </div>
      </div>

      {/* Accounting Health & Category Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'All Accounts' },
              { id: 'asset', label: 'Assets (1000s)' },
              { id: 'liability', label: 'Liabilities (2000s)' },
              { id: 'equity', label: 'Equity (3000s)' },
              { id: 'revenue', label: 'Revenue (4000s)' },
              { id: 'expense', label: 'Expenses (6000s)' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              id={`tab-coa-${tab.id}`}
              onClick={() => setSelectedCategory(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                selectedCategory === tab.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="search-accounts-input"
            type="text"
            placeholder="Search by code or title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Main Accounts Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="accounts-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Code</th>
                <th className="py-3.5 px-4">Account Title & Description</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Sub-Category</th>
                <th className="py-3.5 px-4 text-center">Normal Bal</th>
                <th className="py-3.5 px-4 text-right">GL Current Balance</th>
                <th className="py-3.5 px-4 text-center">Governance</th>
                <th className="py-3.5 px-4 text-right">Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading Chart of Accounts...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No accounts found matching your query.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((account) => {
                  const isNegative = account.balance < 0;
                  return (
                    <tr
                      key={account.id}
                      id={`account-row-${account.accountCode}`}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                      onClick={() => setSelectedAccount(account)}
                    >
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800 text-sm">
                        {account.accountCode}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {account.accountName}
                        </div>
                        {account.description && (
                          <div className="text-xs text-slate-500 line-clamp-1 max-w-md">
                            {account.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${getCategoryBadgeColor(
                            account.category
                          )}`}
                        >
                          {account.category.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs font-medium">
                        {account.subCategory}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block text-xs font-mono font-medium px-2 py-0.5 rounded ${
                            account.normalBalance === 'debit'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {account.normalBalance.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">
                        <span
                          className={
                            isNegative
                              ? 'text-rose-600'
                              : account.category === 'revenue'
                              ? 'text-emerald-600'
                              : 'text-slate-900'
                          }
                        >
                          ${Math.abs(account.balance).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          {isNegative ? ' CR' : ''}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {account.isSystemLocked ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium"
                            title="Core system-locked control account"
                          >
                            <Lock className="h-3.5 w-3.5 text-slate-400" />
                            System
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Custom</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          id={`view-ledger-${account.accountCode}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAccount(account);
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors"
                        >
                          View Ledger
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account Ledger Drill-down Drawer */}
      {selectedAccount && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-200"
          id="account-ledger-modal"
          onClick={() => setSelectedAccount(null)}
        >
          <div
            className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <FolderTree className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                      {selectedAccount.accountCode}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900">
                      {selectedAccount.accountName}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedAccount.subCategory} • Normal Balance:{' '}
                    <span className="font-semibold text-slate-700 capitalize">
                      {selectedAccount.normalBalance}
                    </span>
                  </p>
                </div>
              </div>
              <button
                id="close-ledger-drawer-btn"
                onClick={() => setSelectedAccount(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Account Summary Stats */}
            <div className="grid grid-cols-2 gap-4 my-5 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                  Current GL Balance
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
                  ${selectedAccount.balance.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                  Journal Activity Count
                </div>
                <div className="text-2xl font-mono font-bold text-indigo-600 mt-1">
                  {selectedAccountTransactions.length} Postings
                </div>
              </div>
            </div>

            {/* Ledger Transactions Stream */}
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
                Individual Ledger Postings History
              </h3>

              {selectedAccountTransactions.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-sm">
                  No direct journal transactions recorded for this account code yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {selectedAccountTransactions.map((tx, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-white rounded-lg border border-slate-200 hover:border-indigo-300 transition-colors shadow-2xs"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                            {tx.entryNumber}
                          </span>
                          <span className="text-xs text-slate-500">{tx.postingDate}</span>
                        </div>
                        <span className="text-xs font-mono font-semibold text-slate-500">
                          Ref: {tx.referenceNumber}
                        </span>
                      </div>

                      <div className="text-sm font-medium text-slate-800">
                        {tx.lineDescription || tx.description}
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs font-mono">
                        <span className="text-slate-500">Post Breakdown</span>
                        <div className="flex items-center gap-4">
                          {tx.debit > 0 && (
                            <span className="text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded">
                              Debit: ${tx.debit.toFixed(2)}
                            </span>
                          )}
                          {tx.credit > 0 && (
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                              Credit: ${tx.credit.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Account Creation Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="create-account-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <Plus className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">
                  Create General Ledger Account
                </h2>
              </div>
              <button
                id="close-create-modal-btn"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAccountSubmit} className="p-5 space-y-4">
              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Code *
                  </label>
                  <input
                    id="new-account-code-input"
                    type="text"
                    placeholder="e.g. 1550"
                    required
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    id="new-account-category-select"
                    value={newCategory}
                    onChange={(e) => {
                      const cat = e.target.value as AccountCategory;
                      setNewCategory(cat);
                      setNewNormalBalance(
                        cat === 'asset' || cat === 'expense' ? 'debit' : 'credit'
                      );
                    }}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="asset">Asset (1000s)</option>
                    <option value="liability">Liability (2000s)</option>
                    <option value="equity">Equity (3000s)</option>
                    <option value="revenue">Revenue (4000s)</option>
                    <option value="expense">Expense (6000s)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Name / Title *
                </label>
                <input
                  id="new-account-name-input"
                  type="text"
                  placeholder="e.g. Radiotherapy Linear Accelerators"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sub-Category
                  </label>
                  <input
                    id="new-account-subcategory-input"
                    type="text"
                    placeholder="e.g. Fixed Assets"
                    value={newSubCategory}
                    onChange={(e) => setNewSubCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Normal Balance
                  </label>
                  <select
                    id="new-account-normal-balance-select"
                    value={newNormalBalance}
                    onChange={(e) => setNewNormalBalance(e.target.value as 'debit' | 'credit')}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="debit">Debit (Normal for Assets/Expenses)</option>
                    <option value="credit">Credit (Normal for Liab/Equity/Rev)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Initial Starting Balance ($)
                </label>
                <input
                  id="new-account-balance-input"
                  type="number"
                  step="0.01"
                  value={newBalance}
                  onChange={(e) => setNewBalance(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description / Operational Scope
                </label>
                <textarea
                  id="new-account-description-input"
                  rows={2}
                  placeholder="Optional audit notes or classification guide..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-create-account-btn"
                  disabled={creating}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {creating ? 'Saving...' : 'Add Account to COA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
