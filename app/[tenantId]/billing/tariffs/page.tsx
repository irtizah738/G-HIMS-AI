'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import {
  Tag,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  DollarSign,
  ShieldCheck,
  Building2,
  FileText,
  Trash2,
  Edit2,
  X,
  ArrowRight,
  Receipt,
  Percent,
} from 'lucide-react';
import { Tariff, TariffPlanType, PriceOverride } from '@/types/billing';
import { formatCurrency } from '@/lib/utils';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function TariffsAdminPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'central-metro-hospital';

  const [tariffs, setTariffs] = useState<Tariff[]>([
    {
      id: 'tf-cash-01',
      tenantId,
      name: 'Cash / Self-Pay Standard Schedule',
      planName: 'cash',
      description: 'Standard retail hospital fee schedule for direct cash & un-insured patients.',
      defaultDiscountPercent: 0,
      copayPercent: 100,
      priceOverrides: {},
      overrideList: [],
      isDefault: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
    {
      id: 'tf-ppo-02',
      tenantId,
      name: 'BlueCross / Commercial PPO Tier-1',
      planName: 'private_insurance',
      payerCode: 'BCBS-TX-9901',
      description: 'Preferred provider commercial network schedule with negotiated 15% discount and 20% patient copay.',
      defaultDiscountPercent: 15,
      copayPercent: 20,
      maxCopayCap: 150,
      priceOverrides: {
        'CPT-99214': 145,
        'CPT-99285': 380,
        'CPT-33512': 3400,
      },
      overrideList: [
        {
          code: 'CPT-99214',
          description: 'Level 4 Detailed Outpatient Consultation',
          category: 'consultation',
          standardPrice: 180,
          overridePrice: 145,
        },
        {
          code: 'CPT-99285',
          description: 'Emergency Department High Severity Resuscitation',
          category: 'procedure',
          standardPrice: 450,
          overridePrice: 380,
        },
      ],
      status: 'active',
      createdAt: '2026-01-10T00:00:00Z',
      updatedAt: '2026-02-15T00:00:00Z',
    },
    {
      id: 'tf-corp-03',
      tenantId,
      name: 'Aramco & Corporate Health Package',
      planName: 'corporate',
      payerCode: 'CORP-ARAMCO-01',
      description: 'Corporate executive wellness and occupational health tariff with 100% employer coverage (0% copay).',
      defaultDiscountPercent: 10,
      copayPercent: 0,
      priceOverrides: {
        'LAB-80053': 65,
        'RAD-71046': 85,
      },
      overrideList: [
        {
          code: 'LAB-80053',
          description: 'Comprehensive Metabolic Panel (CMP)',
          category: 'lab',
          standardPrice: 85,
          overridePrice: 65,
        },
      ],
      status: 'active',
      createdAt: '2026-01-12T00:00:00Z',
      updatedAt: '2026-02-10T00:00:00Z',
    },
    {
      id: 'tf-gov-04',
      tenantId,
      name: 'Medicaid & State Assistance Plan',
      planName: 'government',
      payerCode: 'MEDICAID-STATE-80',
      description: 'Statutory government fee schedule with capped reimbursement ceilings and $10 fixed copay.',
      defaultDiscountPercent: 25,
      copayPercent: 5,
      maxCopayCap: 25,
      priceOverrides: {
        'CPT-99213': 75,
        'BED-GEN-01': 180,
      },
      overrideList: [
        {
          code: 'BED-GEN-01',
          description: 'General Ward Acute Care Inpatient Bed Day',
          category: 'bed_day',
          standardPrice: 250,
          overridePrice: 180,
        },
      ],
      status: 'active',
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-02-18T00:00:00Z',
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTariff, setSelectedTariff] = useState<Tariff>(tariffs[1]);
  const [showModal, setShowModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  // New Tariff Form
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState<TariffPlanType>('private_insurance');
  const [formPayerCode, setFormPayerCode] = useState('');
  const [formDiscount, setFormDiscount] = useState(10);
  const [formCopay, setFormCopay] = useState(20);
  const [formCap, setFormCap] = useState(200);
  const [formDesc, setFormDesc] = useState('');

  // New Override Form
  const [overrideCode, setOverrideCode] = useState('CPT-99213');
  const [overrideDesc, setOverrideDesc] = useState('Office Consultation Level 3');
  const [overrideCat, setOverrideCat] = useState<'consultation' | 'lab' | 'radiology' | 'pharmacy' | 'bed_day' | 'procedure'>('consultation');
  const [overrideStd, setOverrideStd] = useState(120);
  const [overridePrice, setOverridePrice] = useState(95);

  const filteredTariffs = tariffs.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.planName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.payerCode && t.payerCode.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleCreateTariff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName) return;

    const newTariff: Tariff = {
      id: `tf-${Date.now()}`,
      tenantId,
      name: formName,
      planName: formPlan,
      payerCode: formPayerCode,
      description: formDesc || 'Custom institutional tariff plan.',
      defaultDiscountPercent: Number(formDiscount) || 0,
      copayPercent: Number(formCopay) || 0,
      maxCopayCap: Number(formCap) || undefined,
      priceOverrides: {},
      overrideList: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTariffs((prev) => [...prev, newTariff]);
    setSelectedTariff(newTariff);
    setShowModal(false);
    setFormName('');
    setFormPayerCode('');
    setFormDesc('');
  };

  const handleAddOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTariff || !overrideCode) return;

    const newOverride: PriceOverride = {
      code: overrideCode,
      description: overrideDesc,
      category: overrideCat as any,
      standardPrice: Number(overrideStd),
      overridePrice: Number(overridePrice),
    };

    const updated = {
      ...selectedTariff,
      priceOverrides: {
        ...selectedTariff.priceOverrides,
        [overrideCode]: Number(overridePrice),
      },
      overrideList: [...(selectedTariff.overrideList || []), newOverride],
      updatedAt: new Date().toISOString(),
    };

    setTariffs((prev) => prev.map((t) => (t.id === selectedTariff.id ? updated : t)));
    setSelectedTariff(updated);
    setShowOverrideModal(false);
  };

  const handleDeleteOverride = (code: string) => {
    if (!selectedTariff) return;

    const newOverrides = { ...selectedTariff.priceOverrides };
    delete newOverrides[code];

    const updated = {
      ...selectedTariff,
      priceOverrides: newOverrides,
      overrideList: (selectedTariff.overrideList || []).filter((o) => o.code !== code),
      updatedAt: new Date().toISOString(),
    };

    setTariffs((prev) => prev.map((t) => (t.id === selectedTariff.id ? updated : t)));
    setSelectedTariff(updated);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Tag className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Multi-Tariff Administration & Fee Schedules
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage commercial PPO rates, corporate coverage rules, copay caps, and CPT / LOINC overrides for {tenantId}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/${tenantId}/billing/invoices/inv-enc-8092-441`}
            className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>POS Invoices</span>
          </Link>
          <Link
            href={`/${tenantId}/billing/claims`}
            className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Claims Workbench</span>
          </Link>
          <button
            id="btn-add-tariff"
            type="button"
            onClick={() => setShowModal(true)}
            className="px-3.5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add Tariff
          </button>
        </div>
      </div>

      {/* Main 2-Column Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Tariff Plan List (4 cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Active Plans ({filteredTariffs.length})
            </span>
            <div className="relative w-40">
              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter tariffs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {filteredTariffs.map((t) => {
              const isSelected = selectedTariff?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTariff(t)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-400 dark:border-blue-700 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                          {t.name}
                        </span>
                        {t.isDefault && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Default
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 capitalize block mt-0.5">
                        Plan: {t.planName.replace('_', ' ')} &bull; {t.payerCode || 'Cash Direct'}
                      </span>
                    </div>
                    <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                      {t.copayPercent}% Copay
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Tier Discount: {t.defaultDiscountPercent}%</span>
                    <span>{Object.keys(t.priceOverrides || {}).length} Overrides</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Tariff Detail & CPT Override Matrix (8 cols) */}
        {selectedTariff ? (
          <div className="lg:col-span-8 space-y-5">
            {/* Tariff Header Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {selectedTariff.name}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 capitalize">
                      {selectedTariff.planName.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {selectedTariff.description}
                  </p>
                </div>

                <button
                  id="btn-add-cpt-override"
                  type="button"
                  onClick={() => setShowOverrideModal(true)}
                  className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add CPT/LOINC Override
                </button>
              </div>

              {/* Key Metric Blocks */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Patient Copay
                  </span>
                  <span className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {selectedTariff.copayPercent}%
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Default Discount
                  </span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                    {selectedTariff.defaultDiscountPercent}%
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Copay Max Ceiling
                  </span>
                  <span className="text-lg font-black text-amber-600 dark:text-amber-400">
                    {selectedTariff.maxCopayCap ? formatCurrency(selectedTariff.maxCopayCap) : 'No Cap'}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold block">
                    Payer Code
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 block truncate">
                    {selectedTariff.payerCode || 'CASH-DIR'}
                  </span>
                </div>
              </div>
            </div>

            {/* CPT / Procedure Overrides Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Negotiated Procedure & Diagnostic Fee Overrides
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Exact fixed charges taking precedence over standard retail charge master
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 font-bold">Code</th>
                      <th className="py-2.5 font-bold">Description</th>
                      <th className="py-2.5 font-bold">Category</th>
                      <th className="py-2.5 font-bold text-right">Standard Master</th>
                      <th className="py-2.5 font-bold text-right">Tariff Override</th>
                      <th className="py-2.5 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(selectedTariff.overrideList || []).length > 0 ? (
                      selectedTariff.overrideList!.map((item) => (
                        <tr key={item.code} className="hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors">
                          <td className="py-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                            {item.code}
                          </td>
                          <td className="py-3 font-medium text-slate-900 dark:text-slate-100 max-w-xs">
                            {item.description}
                          </td>
                          <td className="py-3 capitalize text-slate-500 dark:text-slate-400">
                            {item.category}
                          </td>
                          <td className="py-3 text-right font-medium text-slate-400 line-through">
                            {formatCurrency(item.standardPrice)}
                          </td>
                          <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(item.overridePrice)}
                          </td>
                          <td className="py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteOverride(item.code)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-xs text-slate-400 italic">
                          No specific line-item overrides configured for this tariff. Standard discount of{' '}
                          {selectedTariff.defaultDiscountPercent}% applies across all charge categories.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* New Tariff Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Create New Tariff Schedule
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTariff} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tariff Name *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Aetna Choice POS II"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Plan Type
                  </label>
                  <select
                    value={formPlan}
                    onChange={(e) => setFormPlan(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  >
                    <option value="cash">Cash / Self-Pay</option>
                    <option value="private_insurance">Private Insurance</option>
                    <option value="corporate">Corporate</option>
                    <option value="government">Government</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payer Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. AETNA-901"
                    value={formPayerCode}
                    onChange={(e) => setFormPayerCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Copay %
                  </label>
                  <input
                    type="number"
                    value={formCopay}
                    onChange={(e) => setFormCopay(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Discount %
                  </label>
                  <input
                    type="number"
                    value={formDiscount}
                    onChange={(e) => setFormDiscount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Copay Cap ($)
                  </label>
                  <input
                    type="number"
                    value={formCap}
                    onChange={(e) => setFormCap(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description / Contract Terms
                </label>
                <textarea
                  rows={2}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Contractual policy terms, coverage notes..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Tariff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Override Modal */}
      {showOverrideModal && selectedTariff && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Add CPT / LOINC Override
              </h3>
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddOverride} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Procedure / CPT Code *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. CPT-99213"
                  value={overrideCode}
                  onChange={(e) => setOverrideCode(e.target.value)}
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
                  placeholder="e.g. Level 3 Office Consultation"
                  value={overrideDesc}
                  onChange={(e) => setOverrideDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Standard Retail ($)
                  </label>
                  <input
                    type="number"
                    value={overrideStd}
                    onChange={(e) => setOverrideStd(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Override Price ($)
                  </label>
                  <input
                    type="number"
                    value={overridePrice}
                    onChange={(e) => setOverridePrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
