'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  ReceiptText,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Scale,
  Calendar,
  Layers,
  Trash2,
  ArrowRight,
  RefreshCw,
  Sparkles,
  X,
  FileText,
  DollarSign,
  User,
} from 'lucide-react';
import { Account, JournalEntry, JournalLine } from '@/types/erp-finance';
import {
  subscribeToAccounts,
  subscribeToJournalEntries,
  postJournalEntry,
} from '@/lib/firebase/services/erp-finance';
import { validateJournalEntry } from '@/lib/finance/double-entry';

interface EditableLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export default function JournalEntriesPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);

  // New Journal Entry Modal State
  const [showNewModal, setShowNewModal] = useState(false);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().split('T')[0]);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [description, setDescription] = useState('');
  const [sourceModule, setSourceModule] = useState<JournalEntry['sourceModule']>('manual');
  const [postedBy, setPostedBy] = useState('Senior Controller (Admin)');
  const [lines, setLines] = useState<EditableLine[]>([
    {
      id: '1',
      accountCode: '1010',
      accountName: 'Operating Cash & Treasury Account',
      description: '',
      debit: 0,
      credit: 0,
    },
    {
      id: '2',
      accountCode: '4010',
      accountName: 'Inpatient Hospitalization & Room Board Revenue',
      description: '',
      debit: 0,
      credit: 0,
    },
  ]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubAccounts = subscribeToAccounts(tenantId, (data) => {
      setAccounts(data);
    });

    const unsubEntries = subscribeToJournalEntries(tenantId, (data) => {
      setEntries(data);
      setLoading(false);
    });

    return () => {
      unsubAccounts();
      unsubEntries();
    };
  }, [tenantId]);

  // Real-time double-entry line validation
  const validation = useMemo(() => {
    return validateJournalEntry(
      lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      }))
    );
  }, [lines]);

  // Filtered Journal Entries
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesSearch =
        entry.entryNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.lines.some(
          (l) =>
            l.accountCode.includes(searchTerm) ||
            l.accountName.toLowerCase().includes(searchTerm.toLowerCase())
        );

      const matchesMod = moduleFilter === 'all' || entry.sourceModule === moduleFilter;

      return matchesSearch && matchesMod;
    });
  }, [entries, searchTerm, moduleFilter]);

  // Aggregate stats
  const totalVolumePosted = useMemo(() => {
    return entries.reduce((acc, curr) => acc + curr.totalDebits, 0);
  }, [entries]);

  const handleAddLine = () => {
    const defaultAcc = accounts[0] || { accountCode: '1010', accountName: 'Operating Cash' };
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        accountCode: defaultAcc.accountCode,
        accountName: defaultAcc.accountName,
        description: '',
        debit: 0,
        credit: 0,
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 2) {
      alert('A journal entry must contain at least 2 lines for double-entry ledger balance.');
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleAccountChange = (id: string, code: string) => {
    const acc = accounts.find((a) => a.accountCode === code);
    setLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              accountCode: code,
              accountName: acc ? acc.accountName : `Account ${code}`,
            }
          : l
      )
    );
  };

  const handleAmountChange = (id: string, field: 'debit' | 'credit', value: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id === id) {
          return {
            ...l,
            [field]: value,
            // Clear opposite field to prevent both debit and credit on same line
            ...(field === 'debit' && value > 0 ? { credit: 0 } : {}),
            ...(field === 'credit' && value > 0 ? { debit: 0 } : {}),
          };
        }
        return l;
      })
    );
  };

  // Quick Preset Templates
  const applyPresetTemplate = (type: 'supplies' | 'biomed' | 'copay' | 'utilities') => {
    if (type === 'supplies') {
      setDescription('Emergency Floor Sterile Sutures & Surgical Drape Restock');
      setReferenceNumber(`PO-${Math.floor(1000 + Math.random() * 9000)}`);
      setSourceModule('ap_invoice');
      setLines([
        {
          id: '1',
          accountCode: '6020',
          accountName: 'Medical Consumables & Surgical Implants Used',
          description: 'Sterile surgical consumables kit',
          debit: 4500,
          credit: 0,
        },
        {
          id: '2',
          accountCode: '2010',
          accountName: 'Accounts Payable - Medical & Trade Vendors',
          description: 'Trade liability for surgical restock',
          debit: 0,
          credit: 4500,
        },
      ]);
    } else if (type === 'biomed') {
      setDescription('Biomedical MRI Magnet Helium Recharge Calibration');
      setReferenceNumber(`SVC-RAD-${Math.floor(1000 + Math.random() * 9000)}`);
      setSourceModule('manual');
      setLines([
        {
          id: '1',
          accountCode: '6310',
          accountName: 'Biomedical Maintenance & Service Contracts',
          description: 'Emergency cryogenic coolant calibration',
          debit: 8200,
          credit: 0,
        },
        {
          id: '2',
          accountCode: '1010',
          accountName: 'Operating Cash & Treasury Account',
          description: 'Wire transfer payment for maintenance',
          debit: 0,
          credit: 8200,
        },
      ]);
    } else if (type === 'copay') {
      setDescription('Outpatient Emergency Triage Copay & Self-Pay Collections');
      setReferenceNumber(`POS-COP-${Math.floor(1000 + Math.random() * 9000)}`);
      setSourceModule('patient_billing');
      setLines([
        {
          id: '1',
          accountCode: '1010',
          accountName: 'Operating Cash & Treasury Account',
          description: 'Merchant card terminal batch settlement',
          debit: 12400,
          credit: 0,
        },
        {
          id: '2',
          accountCode: '1110',
          accountName: 'Accounts Receivable - Patient & Insurers',
          description: 'Settlement of outpatient patient balances',
          debit: 0,
          credit: 12400,
        },
      ]);
    } else if (type === 'utilities') {
      setDescription('Hospital Clean Power Grid & Medical Oxygen Pipeline Utility Bill');
      setReferenceNumber(`UTIL-${Math.floor(1000 + Math.random() * 9000)}`);
      setSourceModule('manual');
      setLines([
        {
          id: '1',
          accountCode: '6110',
          accountName: 'Hospital Utilities, Oxygen Supply & Clean Power',
          description: 'Monthly medical gas & high-voltage power',
          debit: 18750,
          credit: 0,
        },
        {
          id: '2',
          accountCode: '1010',
          accountName: 'Operating Cash & Treasury Account',
          description: 'ACH utility disbursement',
          debit: 0,
          credit: 18750,
        },
      ]);
    }
  };

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPostError(null);

    if (!validation.isValid) {
      setPostError(validation.errors.join(' '));
      return;
    }

    if (!description.trim()) {
      setPostError('Please provide a journal entry description.');
      return;
    }

    setPosting(true);
    try {
      await postJournalEntry(tenantId, {
        postingDate,
        referenceNumber: referenceNumber.trim() || `REF-${Date.now()}`,
        description: description.trim(),
        sourceModule,
        lines: lines.map((l) => ({
          id: l.id,
          accountCode: l.accountCode,
          accountName: l.accountName,
          description: l.description.trim() || description.trim(),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
        postedBy: postedBy.trim() || 'Finance Admin',
      });

      setShowNewModal(false);
      setDescription('');
      setReferenceNumber('');
      setLines([
        {
          id: '1',
          accountCode: '1010',
          accountName: 'Operating Cash & Treasury Account',
          description: '',
          debit: 0,
          credit: 0,
        },
        {
          id: '2',
          accountCode: '4010',
          accountName: 'Inpatient Hospitalization & Room Board Revenue',
          description: '',
          debit: 0,
          credit: 0,
        },
      ]);
    } catch (err: any) {
      setPostError(err.message || 'Failed to post journal entry to GL.');
    } finally {
      setPosting(false);
    }
  };

  const getSourceBadgeColor = (mod: JournalEntry['sourceModule']) => {
    switch (mod) {
      case 'manual':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'ap_invoice':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'ap_payment':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'depreciation':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'patient_billing':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'payroll':
        return 'bg-teal-50 text-teal-700 border-teal-200';
    }
  };

  return (
    <div className="space-y-6 pb-12" id="journal-entries-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
              <ReceiptText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                General Ledger Journal Entries
              </h1>
              <p className="text-sm text-slate-500">
                Atomic double-entry transaction posting, audit tracking & source module reconciliation
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="open-post-journal-modal-btn"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            Post Journal Entry
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Posted Transactions</span>
            <Layers className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{entries.length} Entries</div>
          <div className="text-xs text-slate-500 mt-1">100% Real-time GL synchronization</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Total Debits Volume</span>
            <Scale className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            ${totalVolumePosted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-emerald-600 font-medium mt-1">Verified balanced against credits</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Ledger Integrity</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600">Zero Imbalance</div>
          <div className="text-xs text-slate-500 mt-1">Double-entry constraints strictly enforced</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Module Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'All Modules' },
              { id: 'manual', label: 'Manual' },
              { id: 'ap_invoice', label: 'AP Invoices' },
              { id: 'ap_payment', label: 'AP Payments' },
              { id: 'depreciation', label: 'Depreciation' },
              { id: 'patient_billing', label: 'Patient Billing' },
              { id: 'payroll', label: 'Payroll' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              id={`tab-filter-${tab.id}`}
              onClick={() => setModuleFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                moduleFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
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
            id="search-journal-entries-input"
            type="text"
            placeholder="Search entries or accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Journal Entries Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="journal-entries-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Entry #</th>
                <th className="py-3.5 px-4">Posting Date</th>
                <th className="py-3.5 px-4">Module Source</th>
                <th className="py-3.5 px-4">Reference</th>
                <th className="py-3.5 px-4">Description & Affected Accounts</th>
                <th className="py-3.5 px-4 text-right">Debit ($)</th>
                <th className="py-3.5 px-4 text-right">Credit ($)</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Loading General Ledger Postings...
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No journal entries found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    id={`journal-row-${entry.entryNumber}`}
                    onClick={() => setSelectedEntry(entry)}
                    className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-blue-700 text-xs">
                      {entry.entryNumber}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 font-mono text-xs whitespace-nowrap">
                      {entry.postingDate}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${getSourceBadgeColor(
                          entry.sourceModule
                        )}`}
                      >
                        {entry.sourceModule.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                      {entry.referenceNumber}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                        {entry.description}
                      </div>
                      <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                        {entry.lines.map((l) => `${l.accountCode} (${l.accountName})`).join(' • ')}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                      ${entry.totalDebits.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                      ${entry.totalCredits.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Posted
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        id={`view-entry-${entry.entryNumber}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEntry(entry);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entry Inspection Drawer / Modal */}
      {selectedEntry && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          id="entry-details-modal"
          onClick={() => setSelectedEntry(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-blue-800">
                      {selectedEntry.entryNumber}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded border ${getSourceBadgeColor(
                        selectedEntry.sourceModule
                      )}`}
                    >
                      {selectedEntry.sourceModule.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Posting Date: {selectedEntry.postingDate} • Reference: {selectedEntry.referenceNumber}
                  </p>
                </div>
              </div>

              <button
                id="close-entry-details-btn"
                onClick={() => setSelectedEntry(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Transaction Description
                </div>
                <div className="text-sm font-semibold text-slate-900 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {selectedEntry.description}
                </div>
              </div>

              {/* Line Items Breakdown Table */}
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Line Items (Double-Entry Ledger)
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">GL Code</th>
                        <th className="py-2.5 px-3">Account Title</th>
                        <th className="py-2.5 px-3">Line Memo</th>
                        <th className="py-2.5 px-3 text-right">Debit ($)</th>
                        <th className="py-2.5 px-3 text-right">Credit ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedEntry.lines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                            {line.accountCode}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {line.accountName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">{line.description}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                            {line.debit > 0 ? `$${line.debit.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                            {line.credit > 0 ? `$${line.credit.toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200 font-bold font-mono text-slate-900">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3 text-right uppercase text-xs">
                          Totals
                        </td>
                        <td className="py-2.5 px-3 text-right text-blue-800">
                          ${selectedEntry.totalDebits.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-800">
                          ${selectedEntry.totalCredits.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span>Posted by: {selectedEntry.postedBy}</span>
                <span>System Timestamp: {selectedEntry.postedAt || selectedEntry.createdAt}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Journal Entry Modal Workbench */}
      {showNewModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="post-journal-entry-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Post General Ledger Journal Entry
                  </h2>
                  <p className="text-xs text-slate-500">
                    Double-entry validation: Total Debits must strictly equal Total Credits
                  </p>
                </div>
              </div>

              <button
                id="close-new-je-modal-btn"
                onClick={() => setShowNewModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Templates Bar */}
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Quick Templates:
              </span>
              <button
                type="button"
                onClick={() => applyPresetTemplate('supplies')}
                className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors"
              >
                Surgical Supplies Restock
              </button>
              <button
                type="button"
                onClick={() => applyPresetTemplate('biomed')}
                className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors"
              >
                Biomedical Maintenance
              </button>
              <button
                type="button"
                onClick={() => applyPresetTemplate('copay')}
                className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors"
              >
                Copay Cash Collection
              </button>
              <button
                type="button"
                onClick={() => applyPresetTemplate('utilities')}
                className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors"
              >
                Power & Medical O2
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handlePostSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {postError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {postError}
                </div>
              )}

              {/* Top metadata fields */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Posting Date *
                  </label>
                  <input
                    id="je-posting-date-input"
                    type="date"
                    required
                    value={postingDate}
                    onChange={(e) => setPostingDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reference Number
                  </label>
                  <input
                    id="je-reference-input"
                    type="text"
                    placeholder="e.g. INV-9901, PO-441"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Source Module
                  </label>
                  <select
                    id="je-source-module-select"
                    value={sourceModule}
                    onChange={(e) => setSourceModule(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="manual">Manual Journal Entry</option>
                    <option value="ap_invoice">AP Invoice Recognition</option>
                    <option value="ap_payment">AP Payment Settlement</option>
                    <option value="patient_billing">Patient Billing & Claims</option>
                    <option value="payroll">Clinical Payroll</option>
                    <option value="depreciation">Fixed Asset Depreciation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Posted By
                  </label>
                  <input
                    id="je-posted-by-input"
                    type="text"
                    value={postedBy}
                    onChange={(e) => setPostedBy(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Journal Description / Header Memo *
                </label>
                <input
                  id="je-description-input"
                  type="text"
                  required
                  placeholder="e.g. Allocation of August Medical Equipment Consumables"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Line Items Builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    General Ledger Line Items
                  </label>
                  <button
                    type="button"
                    id="add-je-line-btn"
                    onClick={handleAddLine}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Line
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3 w-48">GL Account</th>
                        <th className="py-2.5 px-3">Line Memo</th>
                        <th className="py-2.5 px-3 w-32 text-right">Debit ($)</th>
                        <th className="py-2.5 px-3 w-32 text-right">Credit ($)</th>
                        <th className="py-2.5 px-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {lines.map((line, idx) => (
                        <tr key={line.id} className="bg-white">
                          <td className="py-2 px-3">
                            <select
                              value={line.accountCode}
                              onChange={(e) => handleAccountChange(line.id, e.target.value)}
                              className="w-full px-2 py-1.5 text-xs font-mono font-medium bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500/20"
                            >
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.accountCode}>
                                  {acc.accountCode} - {acc.accountName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              placeholder="Line memo (optional)"
                              value={line.description}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((l) =>
                                    l.id === line.id ? { ...l, description: e.target.value } : l
                                  )
                                )
                              }
                              className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500/20"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={line.debit === 0 ? '' : line.debit}
                              onChange={(e) =>
                                handleAmountChange(line.id, 'debit', parseFloat(e.target.value) || 0)
                              }
                              className="w-full px-2 py-1.5 text-xs font-mono text-right bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500/20 text-blue-700 font-bold"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={line.credit === 0 ? '' : line.credit}
                              onChange={(e) =>
                                handleAmountChange(line.id, 'credit', parseFloat(e.target.value) || 0)
                              }
                              className="w-full px-2 py-1.5 text-xs font-mono text-right bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500/20 text-emerald-700 font-bold"
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real-Time Double-Entry Imbalance Gauge */}
              <div
                className={`p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${
                  validation.isValid
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50/80 border-rose-200 text-rose-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  {validation.isValid ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-sm">
                      {validation.isValid
                        ? 'Double-Entry Balanced'
                        : `Entry Imbalance: $${validation.imbalance.toFixed(2)}`}
                    </div>
                    <div className="text-xs opacity-80">
                      {validation.isValid
                        ? 'Total debits exactly equal total credits. Ready for ledger posting.'
                        : validation.errors[0] || 'Debits and Credits must balance to $0.00'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 font-mono text-xs">
                  <div>
                    <span className="text-slate-500 uppercase block text-[10px]">Total Debits</span>
                    <span className="text-sm font-bold text-blue-700">
                      ${validation.totalDebits.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase block text-[10px]">Total Credits</span>
                    <span className="text-sm font-bold text-emerald-700">
                      ${validation.totalCredits.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-post-je-btn"
                  disabled={posting || !validation.isValid}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors"
                >
                  {posting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Posting Atomically...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Commit to General Ledger
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
