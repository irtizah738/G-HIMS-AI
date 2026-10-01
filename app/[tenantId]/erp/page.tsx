'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Landmark, Calculator, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  hydrateFinanceLedger,
  loadLocalFinanceLedger,
} from '@/lib/finance/finance-edge-adapter';
import type { Account, JournalEntry } from '@/types/erp-finance';

export default function ErpFinanceDashboardPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [source, setSource] = useState<'LOCAL' | 'SERVER'>('LOCAL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apply = (value: { accounts: Account[]; journals: JournalEntry[] }) => {
    setAccounts(value.accounts);
    setJournals(value.journals);
  };

  const refresh = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const local = await loadLocalFinanceLedger(tenantId);
      apply(local);
      try {
        const server = await hydrateFinanceLedger(tenantId);
        apply(server);
        setSource('SERVER');
      } catch (serverError) {
        setSource('LOCAL');
        setError(
          serverError instanceof Error
            ? serverError.message
            : 'Server finance hydration is currently unavailable.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const totals = useMemo(() => {
    const posted = journals.filter((journal) => journal.status === 'posted');
    return {
      activeAccounts: accounts.filter((account) => account.isActive).length,
      postedJournals: posted.length,
      debit: posted.reduce((sum, journal) => sum + Number(journal.totalDebits || 0), 0),
      credit: posted.reduce((sum, journal) => sum + Number(journal.totalCredits || 0), 0),
    };
  }, [accounts, journals]);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">G-HIMS Finance</p>
              <h1 className="mt-1 text-2xl font-black">Authoritative Finance Control Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                Finance state is hydrated from governed read models. All mutations are executed through versioned server commands; this page performs no direct Firestore writes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-semibold"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Projection source: {source}
            {loading ? ' • hydrating…' : ''}
          </div>
          {error ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Server hydration unavailable; showing encrypted local projection. {error}
            </p>
          ) : null}
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ['Active accounts', totals.activeAccounts.toLocaleString()],
            ['Posted journals', totals.postedJournals.toLocaleString()],
            ['Posted debits', totals.debit.toLocaleString()],
            ['Posted credits', totals.credit.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Link href={`/${tenantId}/erp/chart-of-accounts`} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-blue-400">
            <BookOpen className="h-6 w-6 text-blue-600" />
            <h2 className="mt-3 font-black">Chart of Accounts</h2>
            <p className="mt-1 text-sm text-slate-500">Governed account administration and authoritative balances.</p>
          </Link>
          <Link href={`/${tenantId}/erp/journal-entries`} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-blue-400">
            <Calculator className="h-6 w-6 text-blue-600" />
            <h2 className="mt-3 font-black">Journal Entries</h2>
            <p className="mt-1 text-sm text-slate-500">Versioned, balanced journal commands with posting-period controls.</p>
          </Link>
          <Link href={`/${tenantId}/erp/fixed-assets`} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-blue-400">
            <Landmark className="h-6 w-6 text-blue-600" />
            <h2 className="mt-3 font-black">Fixed Assets</h2>
            <p className="mt-1 text-sm text-slate-500">Capitalization, depreciation, transfer and disposal through governed commands.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
