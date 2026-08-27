'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useTheme } from '@/lib/theme/theme-context';
import {
  Search,
  Command,
  TrendingUp,
  ShieldCheck,
  LayoutGrid,
  HeartPulse,
  GitFork,
  Users,
  Stethoscope,
  ShieldAlert,
  BedDouble,
  Scissors,
  FlaskConical,
  Droplet,
  Video,
  DollarSign,
  FileCheck,
  Cpu,
  Server,
  Building2,
  Sparkles,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  UserPlus,
  PlusCircle,
  ArrowRight,
  CornerDownLeft,
  X,
  FileSpreadsheet,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const {
    activeTab,
    setActiveTab,
    patients,
    copilotOpen,
    setCopilotOpen,
    networkMode,
    setNetworkMode,
    mismatches,
  } = useHospital();
  const { theme, setTheme } = useTheme();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Navigation options
  const navigationItems = useMemo(
    () => [
      {
        id: 'command',
        title: 'Hospital Management & Executive KPI',
        category: 'Executive & Strategy',
        icon: TrendingUp,
        action: () => {
          setActiveTab('command');
          onClose();
        },
      },
      {
        id: 'matrix',
        title: 'Module Readiness & Audit Matrix',
        category: 'Executive & Strategy',
        icon: ShieldCheck,
        action: () => {
          setActiveTab('matrix');
          onClose();
        },
      },
      {
        id: 'directory',
        title: 'All Modules Directory & Subsystems',
        category: 'Executive & Strategy',
        icon: LayoutGrid,
        action: () => {
          setActiveTab('directory');
          onClose();
        },
      },
      {
        id: 'disease-intake',
        title: 'Disease-Centric Intake & Pre-Consultation Protocols',
        category: 'Clinical & EHR',
        icon: HeartPulse,
        action: () => {
          setActiveTab('disease-intake');
          onClose();
        },
      },
      {
        id: 'workflow-runtime',
        title: 'Clinical Workflow Runtime & DAG Protocol Engine',
        category: 'Clinical & EHR',
        icon: GitFork,
        action: () => {
          setActiveTab('workflow-runtime');
          onClose();
        },
      },
      {
        id: 'patients',
        title: 'Patient Master Index (MPI) & Longitudinal EHR Records',
        category: 'Clinical & EHR',
        icon: Users,
        action: () => {
          setActiveTab('patients');
          onClose();
        },
      },
      {
        id: 'opd',
        title: 'OPD Encounters, Nursing Triage & Specialist Queue',
        category: 'Clinical & EHR',
        icon: Stethoscope,
        action: () => {
          setActiveTab('opd');
          onClose();
        },
      },
      {
        id: 'emergency',
        title: 'Emergency Department (ED) & ESI Trauma Triage',
        category: 'Clinical & EHR',
        icon: ShieldAlert,
        action: () => {
          setActiveTab('emergency');
          onClose();
        },
      },
      {
        id: 'beds',
        title: 'Inpatient Bed Management, ICU & Ward Occupancy',
        category: 'Inpatient & Surgical',
        icon: BedDouble,
        action: () => {
          setActiveTab('beds');
          onClose();
        },
      },
      {
        id: 'surgery',
        title: 'Operating Theater (OT) Suites & Surgical Worklists',
        category: 'Inpatient & Surgical',
        icon: Scissors,
        action: () => {
          setActiveTab('surgery');
          onClose();
        },
      },
      {
        id: 'ancillary',
        title: 'Ancillary Services (Laboratory, RIS/PACS, Pharmacy)',
        category: 'Diagnostics & Pharmacy',
        icon: FlaskConical,
        action: () => {
          setActiveTab('ancillary');
          onClose();
        },
      },
      {
        id: 'bloodbank',
        title: 'Blood Bank Inventory, Cross-Matching & Transfusions',
        category: 'Diagnostics & Pharmacy',
        icon: Droplet,
        action: () => {
          setActiveTab('bloodbank');
          onClose();
        },
      },
      {
        id: 'telehealth',
        title: 'Telehealth Consultations & Remote Virtual Clinic',
        category: 'Specialty Services',
        icon: Video,
        action: () => {
          setActiveTab('telehealth');
          onClose();
        },
      },
      {
        id: 'billing',
        title: 'Revenue Leakage Detection & Double-Entry ERP General Ledger',
        category: 'Enterprise & Finance',
        icon: DollarSign,
        action: () => {
          setActiveTab('billing');
          onClose();
        },
      },
      {
        id: 'claims',
        title: 'Insurance Claims, Pre-Auth & Payer Gateway',
        category: 'Enterprise & Finance',
        icon: FileCheck,
        action: () => {
          setActiveTab('claims');
          onClose();
        },
      },
      {
        id: 'interop',
        title: 'HL7 v2 / FHIR R4 Interoperability & Integration Gateway',
        category: 'Infrastructure & Audits',
        icon: Cpu,
        action: () => {
          setActiveTab('interop');
          onClose();
        },
      },
      {
        id: 'sheets',
        title: 'Google Sheets & Drive Hub — Live Clinical & ERP Synchronization',
        category: 'Infrastructure & Audits',
        icon: FileSpreadsheet,
        action: () => {
          setActiveTab('sheets');
          onClose();
        },
      },
      {
        id: 'audit',
        title: 'Immutable Audit Ledger, Event Store & Offline Outbox',
        category: 'Infrastructure & Audits',
        icon: Server,
        action: () => {
          setActiveTab('audit');
          onClose();
        },
      },
      {
        id: 'staff',
        title: 'Staff Directory, Clinical Privileges & Credentialing (HCM)',
        category: 'Human Capital & Governance',
        icon: Building2,
        action: () => {
          setActiveTab('staff');
          onClose();
        },
      },
    ],
    [setActiveTab, onClose]
  );

  // Quick Action options
  const actionItems = useMemo(
    () => [
      {
        id: 'act-ai-copilot',
        title: 'Toggle AI Clinical Copilot & Ambient Scribe',
        category: 'Quick Actions',
        icon: Sparkles,
        action: () => {
          setCopilotOpen(!copilotOpen);
          onClose();
        },
      },
      {
        id: 'act-toggle-theme',
        title: `Switch Theme to ${theme === 'dark' ? 'Light Mode' : 'Dark Mode'}`,
        category: 'Quick Actions',
        icon: theme === 'dark' ? Sun : Moon,
        action: () => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      {
        id: 'act-toggle-network',
        title: `Toggle Network Mode (Currently: ${networkMode === 'online' ? 'Online Cloud' : 'Offline Edge'})`,
        category: 'Quick Actions',
        icon: networkMode === 'online' ? WifiOff : Wifi,
        action: () => {
          setNetworkMode(networkMode === 'online' ? 'offline' : 'online');
          onClose();
        },
      },
      {
        id: 'act-view-mismatches',
        title: `Audit ${mismatches.filter((m) => m.status === 'pending_review').length} Pending Revenue Leakages`,
        category: 'Quick Actions',
        icon: DollarSign,
        action: () => {
          setActiveTab('billing');
          onClose();
        },
      },
    ],
    [copilotOpen, setCopilotOpen, theme, setTheme, networkMode, setNetworkMode, mismatches, setActiveTab, onClose]
  );

  // Patients fast list
  const patientItems = useMemo(
    () =>
      patients.map((p) => ({
        id: `patient-${p.id}`,
        title: `${p.fullName} — MRN: ${p.mrn} (${p.age}y ${p.gender}, Bed: ${p.activeBedId || 'Outpatient'})`,
        category: 'Patients (MPI)',
        icon: Users,
        action: () => {
          setActiveTab('patients');
          onClose();
        },
      })),
    [patients, setActiveTab, onClose]
  );

  // Combine and filter
  const allItems = useMemo(() => {
    return [...actionItems, ...navigationItems, ...patientItems];
  }, [actionItems, navigationItems, patientItems]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return allItems.slice(0, 14);
    const q = search.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q)
      )
      .slice(0, 16);
  }, [search, allItems]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Reset index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="modal-command-palette-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-start justify-center pt-[10vh] px-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="modal-command-palette-container"
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[75vh] animate-in zoom-in-95 duration-150 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 gap-3">
          <Search className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command, module name, patient MRN, or action..."
            className="w-full bg-transparent border-none outline-hidden text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
            ESC to close
          </span>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-100 dark:divide-slate-800/40">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-xs">
              <p className="font-semibold text-slate-600 dark:text-slate-400">No matching commands or records found.</p>
              <p className="mt-1">Try searching for &quot;OPD&quot;, &quot;Billing&quot;, &quot;Copilot&quot;, or patient names.</p>
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`cmd-item-${item.id}`}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span className="truncate">{item.title}</span>
                      <span
                        className={`text-[10px] ${
                          isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {item.category}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isSelected && (
                      <span className="text-[10px] font-medium text-blue-100 flex items-center gap-1">
                        Press <CornerDownLeft className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[10px]">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[10px]">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[10px]">↵</kbd>
              Select
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
            <Command className="w-3.5 h-3.5" />
            <span>G-HIMS Universal Palette</span>
          </div>
        </div>
      </div>
    </div>
  );
}
