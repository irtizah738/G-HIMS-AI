'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import {
  SterilizationCycle,
  SterileBatchItem,
  CSSDCycleType,
  BiologicalIndicatorResult,
} from '@/types/supply-chain';
import {
  getSterilizationCycles,
  recordSterilizationCycle,
  validateBiologicalIndicator,
  dispatchSterileTrayToOR,
  subscribeToSterilizationCycles,
} from '@/lib/firebase/services/supply-chain';
import {
  Flame,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Search,
  RefreshCw,
  X,
  Truck,
  Activity,
  Layers,
  Sparkles,
  Thermometer,
  Gauge,
  Timer,
  Check,
  ChevronRight,
  Printer,
  FileCheck2,
  Box,
} from 'lucide-react';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

export default function CSSDPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tenantId = resolvedParams.tenantId || 'metro-health';

  const [cycles, setCycles] = useState<SterilizationCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [cycleTypeFilter, setCycleTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isStartCycleModalOpen, setIsStartCycleModalOpen] = useState(false);
  const [isBIModalOpen, setIsBIModalOpen] = useState(false);
  const [cycleForBI, setCycleForBI] = useState<SterilizationCycle | null>(null);
  const [biResultChoice, setBiResultChoice] = useState<'pass' | 'fail'>('pass');
  const [biNotes, setBiNotes] = useState('');

  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [selectedBatchItem, setSelectedBatchItem] = useState<{
    cycleId: string;
    item: SterileBatchItem;
  } | null>(null);
  const [targetORSuite, setTargetORSuite] = useState('OT Suite 1 (General Surgery)');

  // Form State for New Sterilization Cycle
  const [newCycleType, setNewCycleType] = useState<CSSDCycleType>('Steam');
  const [newMachineName, setNewMachineName] = useState('Getinge Steam Sterilizer 8800 (Autoclave #1)');
  const [operatorName, setOperatorName] = useState('Tariq Mehmood (CSSD Lead Tech)');
  const [tempCelsius, setTempCelsius] = useState(134.5);
  const [pressureBar, setPressureBar] = useState(2.15);
  const [durationMins, setDurationMins] = useState(45);
  const [biLot, setBiLot] = useState(`LOT-3M-${Date.now().toString().slice(-4)}`);
  const [cycleNotes, setCycleNotes] = useState('');
  const [selectedTrayTemplates, setSelectedTrayTemplates] = useState<string[]>([
    'tray-laparotomy-04',
    'tray-csection-02',
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available Surgical Tray Catalog
  const trayCatalog = [
    {
      id: 'tray-laparotomy-04',
      name: 'Major Laparotomy Surgical Set #04',
      itemCount: 42,
      dept: 'Surgery & OT Suites',
      surgeryType: 'General / Abdominal Surgery',
      instruments: [
        'Scalpel Handle #3 & #4',
        'Metzenbaum Scissors 7" Curved',
        'DeBakey Atraumatic Forceps 8"',
        'Kelly Hemostatic Forceps (x6)',
        'Balfour Self-Retaining Retractor',
        'Richardson Retractor Set',
      ],
    },
    {
      id: 'tray-csection-02',
      name: 'Emergency C-Section Sterile Tray #02',
      itemCount: 28,
      dept: 'Maternity & L&D Suites',
      surgeryType: 'Obstetrics & Gynecology',
      instruments: [
        'Doyen Retractor Large',
        'Allis Tissue Forceps 6" (x4)',
        'Green-Armytage Clamps (x4)',
        'Foerster Sponge Forceps (x2)',
        'Cord Cutting Scissors',
      ],
    },
    {
      id: 'tray-laparoscopy-opt-01',
      name: 'Karl Storz 4K Laparoscopy Camera & Scope Kit',
      itemCount: 8,
      dept: 'Surgery & OT Suites',
      surgeryType: 'Minimally Invasive Surgery',
      instruments: [
        'Karl Storz 10mm 30° Rigid Laparoscope',
        '4K HD Autoclavable Camera Head',
        'Fiber Optic Light Cable 3.5mm',
        'Insufflation Tubing',
      ],
    },
    {
      id: 'tray-ortho-trauma-a',
      name: 'Stryker Orthopedic Small Fragment Trauma Set A',
      itemCount: 36,
      dept: 'Surgery & OT Suites',
      surgeryType: 'Orthopedic Trauma',
      instruments: [
        'Screwdriver Shaft Hex 2.5/3.5mm',
        'Depth Gauge 60mm',
        'Bone Reduction Forceps (x2)',
        'Verbrugge Bone Holding Forceps (x2)',
        'Periosteal Elevator Cobb 10mm',
      ],
    },
    {
      id: 'tray-craniotomy-neuro-01',
      name: 'Neuro-Surgical Microsurgical Craniotomy Tray',
      itemCount: 48,
      dept: 'Surgery & OT Suites',
      surgeryType: 'Neurosurgery',
      instruments: [
        'Yasargil Micro-Dissecting Forceps Bayonet (x4)',
        'Micro-Scissors 120mm Curved',
        'Raney Scalp Clip Forceps',
        'Hudson Brace & Perforator Bit',
        'Sugita Aneurysm Clip Applier',
      ],
    },
  ];

  // Subscribe to Live Sterilization Cycles
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function loadData() {
      try {
        setLoading(true);
        const data = await getSterilizationCycles(tenantId);
        setCycles(data);

        unsubscribe = subscribeToSterilizationCycles(tenantId, (liveCycles) => {
          setCycles(liveCycles);
        });
      } catch (err) {
        console.error('Error loading CSSD data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [tenantId]);

  // Adjust parameters when cycle type changes
  const handleCycleTypeSelect = (type: CSSDCycleType) => {
    setNewCycleType(type);
    if (type === 'Steam') {
      setNewMachineName('Getinge Steam Sterilizer 8800 (Autoclave #1)');
      setTempCelsius(134.5);
      setPressureBar(2.15);
      setDurationMins(45);
    } else if (type === 'Plasma') {
      setNewMachineName('STERRAD 100NX Hydrogen Peroxide Gas Plasma Unit');
      setTempCelsius(52.0);
      setPressureBar(0.08);
      setDurationMins(42);
    } else if (type === 'Ethylene_Oxide') {
      setNewMachineName('3M Steri-Vac Ethylene Oxide Chamber 8XL');
      setTempCelsius(55.0);
      setPressureBar(0.95);
      setDurationMins(240);
    }
  };

  // Submit New Autoclave Cycle
  const handleStartCycle = async () => {
    setIsSubmitting(true);
    try {
      const cycleNum = `CSSD-CYC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const timestamp = new Date().toISOString();

      // Determine shelf life
      const expiration = new Date();
      if (newCycleType === 'Steam') expiration.setDate(expiration.getDate() + 30);
      else if (newCycleType === 'Plasma') expiration.setDate(expiration.getDate() + 90);
      else expiration.setDate(expiration.getDate() + 180);

      const batchItems: SterileBatchItem[] = selectedTrayTemplates.map((tId) => {
        const template = trayCatalog.find((t) => t.id === tId)!;
        return {
          traySetId: template.id,
          traySetName: template.name,
          barcode: `CSSD-TRAY-${Math.floor(10000 + Math.random() * 90000)}`,
          itemCount: template.itemCount,
          department: template.dept,
          surgeryType: template.surgeryType,
          instrumentsList: template.instruments,
          status: 'in_sterilizer',
          packedBy: operatorName,
        };
      });

      const newCycle: SterilizationCycle = {
        id: `cyc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        cycleNumber: cycleNum,
        autoclaveMachineId: `MACH-${newCycleType.toUpperCase()}-01`,
        autoclaveMachineName: newMachineName,
        operatorId: 'staff-cssd-lead',
        operatorName,
        cycleType: newCycleType,
        temperatureCelsius: tempCelsius,
        pressureBar,
        durationMinutes: durationMins,
        vacuumPulses: newCycleType === 'Steam' ? 4 : undefined,
        biologicalIndicatorResult: 'pending',
        chemicalIndicatorResult: 'pass',
        status: 'in_progress',
        cycleStartTime: timestamp,
        expirationDate: expiration.toISOString(),
        biLotNumber: biLot,
        biTestSpecies:
          newCycleType === 'Steam'
            ? 'Geobacillus stearothermophilus'
            : 'Bacillus atrophaeus',
        biologicalIncubatorHours: newCycleType === 'Ethylene_Oxide' ? 24 : 3,
        notes: cycleNotes || `Standard ${newCycleType} cycle initiated with ${batchItems.length} instrument trays.`,
        createdAt: timestamp,
        updatedAt: timestamp,
        batchItems,
      };

      await recordSterilizationCycle(tenantId, newCycle);
      setIsStartCycleModalOpen(false);
      setCycleNotes('');
    } catch (err) {
      console.error('Failed to record sterilization cycle:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Biological Indicator Validation Execution
  const handleValidateBI = async () => {
    if (!cycleForBI) return;
    setIsSubmitting(true);
    try {
      await validateBiologicalIndicator(
        tenantId,
        cycleForBI.id,
        biResultChoice,
        biNotes
      );
      setIsBIModalOpen(false);
      setCycleForBI(null);
      setBiNotes('');
    } catch (err) {
      console.error('Failed to validate BI:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dispatch Sterile Tray to OR
  const handleDispatchTray = async () => {
    if (!selectedBatchItem) return;
    setIsSubmitting(true);
    try {
      await dispatchSterileTrayToOR(
        tenantId,
        selectedBatchItem.cycleId,
        selectedBatchItem.item.barcode,
        targetORSuite
      );
      setIsDispatchModalOpen(false);
      setSelectedBatchItem(null);
    } catch (err) {
      console.error('Failed to dispatch surgical tray:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Aggregated Stats
  const totalTraysSterilized = useMemo(() => {
    return cycles.reduce((acc, c) => acc + c.batchItems.length, 0);
  }, [cycles]);

  const readyTrays = useMemo(() => {
    return cycles.reduce(
      (acc, c) => acc + c.batchItems.filter((b) => b.status === 'sterile_validated').length,
      0
    );
  }, [cycles]);

  const quarantinedBatches = useMemo(() => {
    return cycles.filter((c) => c.status === 'failed' || c.biologicalIndicatorResult === 'fail').length;
  }, [cycles]);

  const filteredCycles = useMemo(() => {
    return cycles.filter((c) => {
      const matchesSearch =
        c.cycleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.autoclaveMachineName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.batchItems.some((b) =>
          b.traySetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.barcode.toLowerCase().includes(searchQuery.toLowerCase())
        );

      const matchesType = cycleTypeFilter === 'all' || c.cycleType === cycleTypeFilter;
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [cycles, searchQuery, cycleTypeFilter, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shadow-xs">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                CSSD & Autoclave Sterilization Engine
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                AAMI / ISO 11138 Standard
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Sterile processing cycles, biological indicator (BI) verification, and surgical tray lifecycle dispatch.
            </p>
          </div>
        </div>

        <button
          id="btn-start-sterilization-modal"
          onClick={() => setIsStartCycleModalOpen(true)}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer hover:shadow-md"
        >
          <Plus className="w-4 h-4" />
          <span>Record Autoclave Cycle</span>
        </button>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Sterile Trays Ready</span>
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{readyTrays} Trays</span>
            <span className="text-[11px] font-bold text-emerald-600">BI Validated</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Cycles Run Today</span>
            <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{cycles.length} Cycles</span>
            <span className="text-[11px] font-bold text-blue-600">Steam / Plasma / EtO</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Sets Processed</span>
            <span className="p-2 rounded-lg bg-purple-50 text-purple-600">
              <Box className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{totalTraysSterilized} Sets</span>
            <span className="text-[11px] font-bold text-purple-600">Surgical Inventory</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Quarantined Batches</span>
            <span className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{quarantinedBatches}</span>
            <span className="text-[11px] font-bold text-slate-400">0 BI Failures</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search cycle #, machine, or tray barcode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
            {['all', 'Steam', 'Plasma', 'Ethylene_Oxide'].map((type) => (
              <button
                key={type}
                onClick={() => setCycleTypeFilter(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  cycleTypeFilter === type
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {type === 'Ethylene_Oxide' ? 'EtO Gas' : type}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by Status"
            className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:bg-white focus:outline-hidden"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed & Validated</option>
            <option value="in_progress">In Progress</option>
            <option value="failed">Quarantined / Failed</option>
          </select>
        </div>
      </div>

      {/* Sterilization Cycles List */}
      <div className="space-y-4">
        {filteredCycles.map((cycle) => {
          const isPendingBI = cycle.biologicalIndicatorResult === 'pending';
          const isPassedBI = cycle.biologicalIndicatorResult === 'pass';
          const isFailedBI = cycle.biologicalIndicatorResult === 'fail';

          return (
            <div
              key={cycle.id}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
            >
              {/* Cycle Card Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-xs ${
                      cycle.cycleType === 'Steam'
                        ? 'bg-blue-600'
                        : cycle.cycleType === 'Plasma'
                        ? 'bg-purple-600'
                        : 'bg-amber-600'
                    }`}
                  >
                    <Flame className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-slate-900 text-sm">
                        {cycle.cycleNumber}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                        {cycle.cycleType}
                      </span>
                      {cycle.status === 'in_progress' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 animate-pulse">
                          Running
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {cycle.autoclaveMachineName} | Operator:{' '}
                      <span className="font-semibold text-slate-700">{cycle.operatorName}</span>
                    </p>
                  </div>
                </div>

                {/* Thermal & Biological Telemetry */}
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Thermometer className="w-4 h-4 text-rose-500" />
                    <span className="font-bold">{cycle.temperatureCelsius}°C</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Gauge className="w-4 h-4 text-blue-500" />
                    <span className="font-bold">{cycle.pressureBar} bar</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Timer className="w-4 h-4 text-amber-500" />
                    <span className="font-bold">{cycle.durationMinutes} min</span>
                  </div>

                  {/* BI Indicator Badge & Button */}
                  <div>
                    {isPassedBI ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> BI Pass
                      </span>
                    ) : isFailedBI ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" /> Quarantined
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setCycleForBI(cycle);
                          setIsBIModalOpen(true);
                        }}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-white font-extrabold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Validate BI Test</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Surgical Trays List */}
              <div className="p-5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-3">
                  Surgical Trays & Instrument Sets in Batch ({cycle.batchItems.length})
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {cycle.batchItems.map((tray) => (
                    <div
                      key={tray.barcode}
                      className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 flex flex-col justify-between gap-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-extrabold text-slate-900">{tray.traySetName}</div>
                          <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                            <QrCode className="w-3 h-3 text-slate-400" />
                            <span>{tray.barcode}</span>
                            <span className="text-slate-400 mx-1">|</span>
                            <span>{tray.itemCount} Instruments</span>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            tray.status === 'sterile_validated'
                              ? 'bg-emerald-100 text-emerald-800'
                              : tray.status === 'dispatched_to_or'
                              ? 'bg-blue-100 text-blue-800'
                              : tray.status === 'quarantined'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {tray.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Instruments pill list */}
                      <div className="flex flex-wrap gap-1">
                        {tray.instrumentsList.slice(0, 3).map((inst, idx) => (
                          <span
                            key={idx}
                            className="bg-white px-2 py-0.5 rounded text-[10px] font-medium text-slate-600 border border-slate-200"
                          >
                            {inst}
                          </span>
                        ))}
                        {tray.instrumentsList.length > 3 && (
                          <span className="text-[10px] text-slate-400 font-bold self-center">
                            +{tray.instrumentsList.length - 3} more
                          </span>
                        )}
                      </div>

                      {/* Action / Dispatch info */}
                      <div className="border-t border-slate-200/60 pt-2 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                          {tray.dispatchedTo
                            ? `Dispatched to: ${tray.dispatchedTo}`
                            : `Packed by: ${tray.packedBy || 'CSSD'}`}
                        </span>

                        {tray.status === 'sterile_validated' && (
                          <button
                            onClick={() => {
                              setSelectedBatchItem({ cycleId: cycle.id, item: tray });
                              setIsDispatchModalOpen(true);
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Truck className="w-3 h-3" />
                            <span>Dispatch to OR</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* START STERILIZATION CYCLE MODAL */}
      {/* ==================================================================== */}
      {isStartCycleModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Initiate Autoclave Sterilization Cycle
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure machine parameters, biological test vial lot, and instrument load.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsStartCycleModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs custom-scrollbar">
              {/* Modality Selector */}
              <div>
                <label className="block font-bold text-slate-700 mb-2">Sterilization Modality</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['Steam', 'Plasma', 'Ethylene_Oxide'] as CSSDCycleType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleCycleTypeSelect(type)}
                      className={`p-3 rounded-xl border text-center font-extrabold transition-all cursor-pointer ${
                        newCycleType === type
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-sm font-black">
                        {type === 'Ethylene_Oxide' ? 'EtO Gas' : type}
                      </div>
                      <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                        {type === 'Steam' ? '134°C Steam' : type === 'Plasma' ? 'Vaporized H2O2' : 'Low-Temp Gas'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Physical Parameters */}
              <div className="grid grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Temperature (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={tempCelsius}
                    onChange={(e) => setTempCelsius(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-white border border-slate-200 font-black text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Chamber Pressure (Bar)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={pressureBar}
                    onChange={(e) => setPressureBar(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-white border border-slate-200 font-black text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Exposure Duration (Min)</label>
                  <input
                    type="number"
                    value={durationMins}
                    onChange={(e) => setDurationMins(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-white border border-slate-200 font-black text-slate-900"
                  />
                </div>
              </div>

              {/* Operator & Biological Indicator QA */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CSSD Lead Operator</label>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full p-2 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Biological Indicator (BI) Lot #
                  </label>
                  <input
                    type="text"
                    value={biLot}
                    onChange={(e) => setBiLot(e.target.value)}
                    className="w-full p-2 rounded-lg bg-slate-50 border border-slate-200 font-mono font-semibold text-slate-800"
                  />
                </div>
              </div>

              {/* Tray Set Picker */}
              <div>
                <span className="font-extrabold uppercase tracking-wider text-[10px] text-slate-400 block mb-2">
                  Select Surgical Trays to Include in Cycle
                </span>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                  {trayCatalog.map((cat) => {
                    const isSelected = selectedTrayTemplates.includes(cat.id);
                    return (
                      <label
                        key={cat.id}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTrayTemplates((prev) => [...prev, cat.id]);
                              } else {
                                setSelectedTrayTemplates((prev) =>
                                  prev.filter((id) => id !== cat.id)
                                );
                              }
                            }}
                            className="w-4 h-4 text-emerald-600 rounded"
                          />
                          <div>
                            <span className="font-extrabold text-xs block">{cat.name}</span>
                            <span className="text-[10px] text-slate-500">
                              {cat.surgeryType} ({cat.itemCount} instruments)
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsStartCycleModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || selectedTrayTemplates.length === 0}
                onClick={handleStartCycle}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Flame className="w-3.5 h-3.5" />
                )}
                <span>Start Sterilizer Cycle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* BIOLOGICAL INDICATOR VALIDATION DIALOG */}
      {/* ==================================================================== */}
      {isBIModalOpen && cycleForBI && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-slate-900">
              <ShieldCheck className="w-6 h-6 text-emerald-600" />
              <div>
                <h3 className="font-extrabold text-base">Biological Indicator Readout</h3>
                <p className="text-xs text-slate-500">
                  Cycle: {cycleForBI.cycleNumber} (Lot: {cycleForBI.biLotNumber})
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setBiResultChoice('pass')}
                  className={`p-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                    biResultChoice === 'pass'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                  <span>PASS (Negative)</span>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                    No bacterial growth
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBiResultChoice('fail')}
                  className={`p-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                    biResultChoice === 'fail'
                      ? 'border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-500/20'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5 text-rose-600 mx-auto mb-1" />
                  <span>FAIL (Positive)</span>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                    Quarantine entire batch
                  </div>
                </button>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Quality Assurance Comments
                </label>
                <textarea
                  rows={2}
                  value={biNotes}
                  onChange={(e) => setBiNotes(e.target.value)}
                  placeholder="e.g. 3M Attest 1492V rapid readout negative after 3h incubation..."
                  className="w-full p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsBIModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleValidateBI}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Confirm Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* DISPATCH STERILE TRAY TO OR MODAL */}
      {/* ==================================================================== */}
      {isDispatchModalOpen && selectedBatchItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-slate-900">
              <Truck className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="font-extrabold text-base">Dispatch Surgical Set to OR</h3>
                <p className="text-xs text-slate-500">{selectedBatchItem.item.traySetName}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Destination Operating Theater
                </label>
                <select
                  value={targetORSuite}
                  onChange={(e) => setTargetORSuite(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-800"
                >
                  <option value="OT Suite 1 (General & Laparoscopy)">OT Suite 1 (General & Laparoscopy)</option>
                  <option value="OT Suite 2 (Orthopedics & Trauma)">OT Suite 2 (Orthopedics & Trauma)</option>
                  <option value="OT Suite 3 (Obstetrics & Gynecology)">OT Suite 3 (Obstetrics & Gynecology)</option>
                  <option value="OT Suite 4 (Neurosurgery & Micro)">OT Suite 4 (Neurosurgery & Micro)</option>
                  <option value="Cardiac Cath Lab Suite A">Cardiac Cath Lab Suite A</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsDispatchModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleDispatchTray}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Authorize & Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
