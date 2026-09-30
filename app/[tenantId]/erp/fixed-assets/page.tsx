'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  Landmark,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Play,
  Calendar,
  Layers,
  Sparkles,
  RefreshCw,
  X,
  Stethoscope,
  Server,
  Building,
  Truck,
  FileSpreadsheet,
  TrendingDown,
  Clock,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import {
  FixedAsset,
  AssetCategory,
  DepreciationScheduleItem,
  DepreciationRunLog,
  DepreciationMethod,
} from '@/types/erp-finance';
import {
  capitalizeFixedAssetEdge,
  hydrateFinanceAssets,
  loadLocalFinanceAssets,
  runDepreciationEdge,
} from '@/lib/finance/finance-edge-adapter';
import {
  calculateMonthlyDepreciation,
  calculateAssetDepreciationSchedule,
} from '@/lib/finance/double-entry';

export default function FixedAssetsPage() {
  const params = useParams();
  const tenantId = String(params?.tenantId || '').trim();

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [depreciationRuns, setDepreciationRuns] = useState<DepreciationRunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | 'all'>('all');
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);

  // Run Monthly Depreciation Modal State
  const [showRunModal, setShowRunModal] = useState(false);
  const [fiscalPeriod, setFiscalPeriod] = useState(
    new Date().toISOString().substring(0, 7) // '2026-08'
  );
  const [runningDepr, setRunningDepr] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [latestRunSuccess, setLatestRunSuccess] = useState<DepreciationRunLog | null>(null);

  // New Asset Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assetTag, setAssetTag] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('medical_equipment');
  const [department, setDepartment] = useState('Radiology & Imaging');
  const [location, setLocation] = useState('Main Diagnostic Suite 101');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [acquisitionCost, setAcquisitionCost] = useState<number>(120000);
  const [salvageValue, setSalvageValue] = useState<number>(10000);
  const [usefulLifeYears, setUsefulLifeYears] = useState<number>(7);
  const [depreciationMethod, setDepreciationMethod] =
    useState<DepreciationMethod>('straight_line');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [assetFacilityId, setAssetFacilityId] = useState('');
  const [assetCostCenterId, setAssetCostCenterId] = useState('');
  const [sourceJournalId, setSourceJournalId] = useState('');
  const [assetCurrency, setAssetCurrency] = useState('USD');

  const loadGovernedFinanceAssets = async () => {
    if (!tenantId) {
      setAssets([]);
      setDepreciationRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const local = await loadLocalFinanceAssets(tenantId);
      setAssets(local.assets);
      setDepreciationRuns(local.depreciationRuns);

      const hydrated = await hydrateFinanceAssets(tenantId);
      setAssets(hydrated.assets);
      setDepreciationRuns(hydrated.depreciationRuns);
    } catch (error) {
      console.error('Failed loading governed finance asset projections:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGovernedFinanceAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Aggregate Asset Financials
  const assetTotals = useMemo(() => {
    let grossCost = 0;
    let accumDepr = 0;
    let netBook = 0;
    let monthlyEligibleDepr = 0;

    assets.forEach((a) => {
      grossCost += Number(a.acquisitionCost) || 0;
      accumDepr += Number(a.accumulatedDepreciation) || 0;
      netBook += Number(a.currentBookValue) || 0;
      if (a.status === 'active') {
        monthlyEligibleDepr += calculateMonthlyDepreciation(a);
      }
    });

    return {
      grossCost,
      accumDepr,
      netBook,
      monthlyEligibleDepr,
    };
  }, [assets]);

  // Filtered Assets
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchesSearch =
        asset.assetTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
        asset.assetName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        asset.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (asset.serialNumber && asset.serialNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCategory =
        categoryFilter === 'all' || asset.assetCategory === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [assets, searchTerm, categoryFilter]);

  // Selected Asset Depreciation Schedule
  const selectedAssetSchedule = useMemo(() => {
    if (!selectedAsset) return [];
    return calculateAssetDepreciationSchedule(selectedAsset);
  }, [selectedAsset]);

  const handleRunDepreciation = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunError(null);
    setRunningDepr(true);

    try {
      const [yearText, monthText] = fiscalPeriod.split('-');
      const fiscalYear = Number(yearText);
      const postingPeriod = Number(monthText);
      const eligibleAssetIds = assets
        .filter(
          (asset) =>
            asset.status === 'active' &&
            asset.currentBookValue > asset.salvageValue
        )
        .map((asset) => asset.id);

      if (!eligibleAssetIds.length) {
        throw new Error('No active depreciable assets are available for this period.');
      }
      let latestResult: DepreciationRunLog | null = null;
      for (let offset = 0; offset < eligibleAssetIds.length; offset += 200) {
        const assetIds = eligibleAssetIds.slice(offset, offset + 200);
        latestResult = await runDepreciationEdge({
          runId: `dep_${fiscalPeriod}_${crypto.randomUUID()}`,
          fiscalYear,
          postingPeriod,
          currency: assetCurrency.trim().toUpperCase(),
          assetIds,
        });
      }
      setLatestRunSuccess(latestResult);
      await loadGovernedFinanceAssets();
    } catch (err: any) {
      setRunError(err.message || 'Depreciation execution failed.');
    } finally {
      setRunningDepr(false);
    }
  };

  const handleCreateAssetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!assetTag.trim() || !assetName.trim()) {
      setCreateError('Please provide both an Asset Tag and an Asset Name.');
      return;
    }

    if (acquisitionCost <= 0) {
      setCreateError('Acquisition cost must be greater than zero.');
      return;
    }

    if (salvageValue >= acquisitionCost) {
      setCreateError('Salvage value must be strictly less than acquisition cost.');
      return;
    }

    let assetAccountCode = '1510';
    let accumulatedDepreciationAccountCode = '1519';
    let depreciationExpenseAccountCode = '6210';

    if (assetCategory === 'it_hardware') {
      assetAccountCode = '1520';
      accumulatedDepreciationAccountCode = '1529';
      depreciationExpenseAccountCode = '6220';
    } else if (assetCategory === 'facility') {
      assetAccountCode = '1530';
      accumulatedDepreciationAccountCode = '1539';
      depreciationExpenseAccountCode = '6230';
    } else if (assetCategory === 'vehicles') {
      assetAccountCode = '1540';
      accumulatedDepreciationAccountCode = '1549';
      depreciationExpenseAccountCode = '6240';
    }

    setCreating(true);
    try {
      if (!tenantId) {
        throw new Error('Tenant route context is required.');
      }
      if (!assetFacilityId.trim() || !assetCostCenterId.trim()) {
        throw new Error('Facility ID and Cost Center ID are required.');
      }
      if (!sourceJournalId.trim()) {
        throw new Error(
          'A posted capital-expenditure clearing journal ID is required before capitalization.'
        );
      }

      const category =
        assetCategory === 'medical_equipment'
          ? 'MEDICAL_EQUIPMENT'
          : assetCategory === 'it_hardware'
            ? 'IT_HARDWARE'
            : assetCategory === 'facility'
              ? 'FACILITY'
              : 'VEHICLE';

      await capitalizeFixedAssetEdge({
        assetId: `asset_${crypto.randomUUID()}`,
        assetTag: assetTag.trim().toUpperCase(),
        serialNumber: serialNumber.trim() || undefined,
        assetName: assetName.trim(),
        assetCategory: category,
        facilityId: assetFacilityId.trim(),
        costCenterId: assetCostCenterId.trim(),
        acquisitionAt: Date.parse(`${purchaseDate}T00:00:00.000Z`),
        inServiceAt: Date.parse(`${purchaseDate}T00:00:00.000Z`),
        acquisitionCostMinorUnits: Math.round(Number(acquisitionCost) * 100),
        salvageValueMinorUnits: Math.round(Number(salvageValue) * 100),
        usefulLifeMonths: Math.round(Number(usefulLifeYears) * 12),
        assetAccountCode,
        accumulatedDepreciationAccountCode,
        depreciationExpenseAccountCode,
        currency: assetCurrency.trim().toUpperCase(),
        sourceReferenceId: sourceJournalId.trim(),
      });
      await loadGovernedFinanceAssets();

      setShowCreateModal(false);
      setAssetTag('');
      setSerialNumber('');
      setAssetName('');
      setAcquisitionCost(100000);
      setSalvageValue(10000);
      setSourceJournalId('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create fixed asset.');
    } finally {
      setCreating(false);
    }
  };

  const getCategoryIcon = (category: AssetCategory) => {
    switch (category) {
      case 'medical_equipment':
        return <Stethoscope className="h-4 w-4 text-blue-600" />;
      case 'it_hardware':
        return <Server className="h-4 w-4 text-purple-600" />;
      case 'facility':
        return <Building className="h-4 w-4 text-emerald-600" />;
      case 'vehicles':
        return <Truck className="h-4 w-4 text-amber-600" />;
    }
  };

  if (!tenantId) {
    return (
      <div className="p-6 text-sm text-rose-700">
        TENANT_CONTEXT_REQUIRED: Fixed Assets requires an explicit tenant route.
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" id="fixed-assets-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">
              <Landmark className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Fixed Asset Accounting & Depreciation
              </h1>
              <p className="text-sm text-slate-500">
                Medical machinery asset registry, amortization schedules & monthly automated GL write-down engine
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="open-depreciation-run-modal-btn"
            onClick={() => {
              setLatestRunSuccess(null);
              setRunError(null);
              setShowRunModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg shadow-xs transition-colors"
          >
            <Play className="h-4 w-4" />
            Run Monthly Depreciation
          </button>
          <button
            id="open-create-asset-modal-btn"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            Capitalize New Asset
          </button>
        </div>
      </div>

      {/* Asset Valuation KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Capitalized Assets */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Gross Capitalized Cost</span>
            <Layers className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            ${assetTotals.grossCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Total historical asset base</div>
        </div>

        {/* Accumulated Depreciation */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Accumulated Depr</span>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 font-mono">
            -${assetTotals.accumDepr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Contra-asset write-downs</div>
        </div>

        {/* Net Book Value (NBV) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Net Book Value (NBV)</span>
            <Landmark className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 font-mono">
            ${assetTotals.netBook.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Current balance sheet carrying value</div>
        </div>

        {/* Monthly Run Run-Rate */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Monthly Run Allocation</span>
            <Clock className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-indigo-700 font-mono">
            ${assetTotals.monthlyEligibleDepr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Estimated monthly GL expense</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'All Fixed Assets' },
              { id: 'medical_equipment', label: 'Medical Equipment' },
              { id: 'it_hardware', label: 'IT & PACS Servers' },
              { id: 'facility', label: 'Buildings & Facility' },
              { id: 'vehicles', label: 'Ambulance Fleet' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              id={`tab-asset-${tab.id}`}
              onClick={() => setCategoryFilter(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                categoryFilter === tab.id
                  ? 'bg-emerald-600 text-white shadow-xs'
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
            id="search-assets-input"
            type="text"
            placeholder="Search asset tag, model, dept..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Fixed Assets Registry Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="assets-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Asset Tag</th>
                <th className="py-3.5 px-4">Machine / Asset Name</th>
                <th className="py-3.5 px-4">Department & Location</th>
                <th className="py-3.5 px-4 text-right">Cost Basis</th>
                <th className="py-3.5 px-4 text-right">Accum Depr</th>
                <th className="py-3.5 px-4 text-right">Net Book Value</th>
                <th className="py-3.5 px-4 text-center">Lifespan</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading Asset Register...
                  </td>
                </tr>
              ) : filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No fixed assets found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const percentDepreciated = Math.min(
                    100,
                    Math.round((asset.accumulatedDepreciation / (asset.acquisitionCost - asset.salvageValue || 1)) * 100)
                  );

                  return (
                    <tr
                      key={asset.id}
                      id={`asset-row-${asset.assetTag}`}
                      onClick={() => setSelectedAsset(asset)}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            {asset.assetTag}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
                          {asset.assetName}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                          {getCategoryIcon(asset.assetCategory)}
                          <span>
                            {asset.manufacturer || 'Standard'} • {asset.model || asset.serialNumber}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-xs font-medium text-slate-800">{asset.department}</div>
                        <div className="text-xs text-slate-500">{asset.location}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                        ${asset.acquisitionCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-rose-600 font-bold">
                        -${asset.accumulatedDepreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700">
                        ${asset.currentBookValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="text-xs font-mono font-medium text-slate-700">
                          {asset.usefulLifeYears} Yrs
                        </div>
                        <div className="w-16 bg-slate-200 h-1.5 rounded-full mx-auto mt-1 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full"
                            style={{ width: `${percentDepreciated}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block text-xs font-semibold px-2 py-0.5 rounded capitalize ${
                            asset.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {asset.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          id={`view-schedule-${asset.assetTag}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAsset(asset);
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors"
                        >
                          Schedule
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

      {/* Asset Depreciation Schedule & Lifecycle Drawer */}
      {selectedAsset && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-200"
          id="asset-details-drawer"
          onClick={() => setSelectedAsset(null)}
        >
          <div
            className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <Landmark className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold bg-emerald-100 px-2 py-0.5 rounded text-emerald-800">
                      {selectedAsset.assetTag}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900">
                      {selectedAsset.assetName}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedAsset.department} • {selectedAsset.location}
                  </p>
                </div>
              </div>

              <button
                id="close-asset-drawer-btn"
                onClick={() => setSelectedAsset(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Asset Financial Summary */}
            <div className="grid grid-cols-3 gap-3 my-5 bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase">Cost Basis</div>
                <div className="text-lg font-mono font-bold text-slate-900 mt-1">
                  ${selectedAsset.acquisitionCost.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase">Accum Depr</div>
                <div className="text-lg font-mono font-bold text-rose-600 mt-1">
                  -${selectedAsset.accumulatedDepreciation.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase">Net Book Value</div>
                <div className="text-lg font-mono font-bold text-emerald-700 mt-1">
                  ${selectedAsset.currentBookValue.toLocaleString()}
                </div>
              </div>
            </div>

            {/* General Ledger Mapping Tags */}
            <div className="space-y-2 mb-5">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                GL Account Routing
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <div className="p-2 bg-slate-100 rounded border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Asset GL</span>
                  <span className="font-bold text-slate-800">{selectedAsset.assetAccountCode}</span>
                </div>
                <div className="p-2 bg-slate-100 rounded border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Accum Depr GL</span>
                  <span className="font-bold text-slate-800">
                    {selectedAsset.accumulatedDepreciationAccountCode}
                  </span>
                </div>
                <div className="p-2 bg-slate-100 rounded border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Expense GL</span>
                  <span className="font-bold text-slate-800">
                    {selectedAsset.depreciationExpenseAccountCode}
                  </span>
                </div>
              </div>
            </div>

            {/* Life-cycle Amortization Schedule Table */}
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Annual Straight-Line Depreciation Schedule
              </h3>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Period</th>
                      <th className="py-2.5 px-3 text-right">Opening NBV</th>
                      <th className="py-2.5 px-3 text-right">Annual Expense</th>
                      <th className="py-2.5 px-3 text-right">Accum Depr</th>
                      <th className="py-2.5 px-3 text-right">Closing NBV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedAssetSchedule.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {item.periodLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          ${item.openingBookValue.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-600 font-bold">
                          ${item.depreciationExpense.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700">
                          ${item.accumulatedDepreciation.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 font-bold">
                          ${item.closingBookValue.toLocaleString()}
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

      {/* Monthly Depreciation Execution Modal */}
      {showRunModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="monthly-depreciation-run-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <Play className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Execute Monthly Fixed Asset Depreciation
                  </h2>
                  <p className="text-xs text-slate-500">
                    Automated write-down calculation and composite GL posting
                  </p>
                </div>
              </div>

              <button
                id="close-run-modal-btn"
                onClick={() => setShowRunModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRunDepreciation} className="p-5 space-y-4">
              {runError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {runError}
                </div>
              )}

              {latestRunSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    Depreciation Run Successfully Posted!
                  </div>
                  <div className="text-xs text-emerald-700 space-y-1 font-mono">
                    <div>Run Reference: {latestRunSuccess.runNumber}</div>
                    <div>
                      Total Posted to GL: $
                      {latestRunSuccess.totalDepreciationPosted.toFixed(2)}
                    </div>
                    <div>
                      Active Assets Processed: {latestRunSuccess.assetsProcessedCount} Units
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Fiscal Period (YYYY-MM) *
                </label>
                <input
                  id="depr-fiscal-period-input"
                  type="month"
                  required
                  value={fiscalPeriod}
                  onChange={(e) => setFiscalPeriod(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="font-semibold text-slate-800">Batch Processing Preview</div>
                <div className="flex justify-between text-slate-600">
                  <span>Eligible Active Assets:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {assets.filter((a) => a.status === 'active' && a.currentBookValue > a.salvageValue).length} Machines
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Estimated Total Run Debit:</span>
                  <span className="font-mono font-bold text-indigo-700">
                    ${assetTotals.monthlyEligibleDepr.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowRunModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  id="submit-run-depreciation-btn"
                  disabled={runningDepr}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {runningDepr ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Posting to GL...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Commit Monthly Depreciation
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Capitalize New Asset Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="create-asset-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <Plus className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Capitalize Fixed Asset</h2>
              </div>
              <button
                id="close-create-asset-btn"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAssetSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Asset Tag *
                  </label>
                  <input
                    id="new-asset-tag-input"
                    type="text"
                    placeholder="e.g. RAD-CT-02"
                    required
                    value={assetTag}
                    onChange={(e) => setAssetTag(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Serial Number
                  </label>
                  <input
                    id="new-asset-serial-input"
                    type="text"
                    placeholder="e.g. SN-88219"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Machine / Asset Name *
                </label>
                <input
                  id="new-asset-name-input"
                  type="text"
                  placeholder="e.g. GE Healthcare Revolution 256-Slice CT Scanner"
                  required
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    id="new-asset-category-select"
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value as AssetCategory)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="medical_equipment">Medical Equipment (1510)</option>
                    <option value="it_hardware">IT Hardware & PACS (1520)</option>
                    <option value="facility">Building & Facilities (1530)</option>
                    <option value="vehicles">Ambulance Fleet (1540)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <input
                    id="new-asset-dept-input"
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Facility ID *
                  </label>
                  <input
                    id="new-asset-facility-input"
                    type="text"
                    required
                    value={assetFacilityId}
                    onChange={(e) => setAssetFacilityId(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cost Center ID *
                  </label>
                  <input
                    id="new-asset-cost-center-input"
                    type="text"
                    required
                    value={assetCostCenterId}
                    onChange={(e) => setAssetCostCenterId(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Posted CapEx Clearing Journal ID *
                  </label>
                  <input
                    id="new-asset-source-journal-input"
                    type="text"
                    required
                    value={sourceJournalId}
                    onChange={(e) => setSourceJournalId(e.target.value)}
                    placeholder="Journal containing debit to 1595"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Currency *
                  </label>
                  <input
                    id="new-asset-currency-input"
                    type="text"
                    maxLength={3}
                    required
                    value={assetCurrency}
                    onChange={(e) => setAssetCurrency(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Acquisition Cost ($) *
                  </label>
                  <input
                    id="new-asset-cost-input"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={acquisitionCost}
                    onChange={(e) => setAcquisitionCost(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Salvage Residual ($)
                  </label>
                  <input
                    id="new-asset-salvage-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={salvageValue}
                    onChange={(e) => setSalvageValue(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Useful Lifespan (Years) *
                  </label>
                  <input
                    id="new-asset-lifespan-input"
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={usefulLifeYears}
                    onChange={(e) => setUsefulLifeYears(parseInt(e.target.value, 10) || 1)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Depreciation Method
                  </label>
                  <select
                    id="new-asset-depr-method-select"
                    value={depreciationMethod}
                    onChange={(e) => setDepreciationMethod(e.target.value as DepreciationMethod)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="straight_line">Straight-Line (GAAP)</option>
                  </select>
                </div>
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
                  id="submit-create-asset-btn"
                  disabled={creating}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {creating ? 'Registering...' : 'Capitalize Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
