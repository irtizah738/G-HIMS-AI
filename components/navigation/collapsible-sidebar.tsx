'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useRouter } from 'next/navigation';
import {
  TrendingUp,
  LayoutGrid,
  ShieldCheck,
  DollarSign,
  FileCheck,
  Stethoscope,
  ShieldAlert,
  BedDouble,
  Scissors,
  FlaskConical,
  Droplet,
  Video,
  Cpu,
  Server,
  Users,
  Building2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  HeartPulse,
  Search,
  Zap,
  X,
  ShoppingCart,
  Boxes,
  Flame,
  BookOpen,
  ReceiptText,
  Landmark,
  CalendarDays,
  Award,
  Banknote,
  GitFork,
  FileSpreadsheet,
} from 'lucide-react';

interface CollapsibleSidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export function CollapsibleSidebar({
  isCollapsed,
  setIsCollapsed,
  mobileOpen,
  setMobileOpen,
}: CollapsibleSidebarProps) {
  const { activeTab, setActiveTab, stats, mismatches, patients, beds, opdQueue } = useHospital();
  const [searchTerm, setSearchTerm] = useState('');

  const pendingLeakageCount = mismatches.filter((m) => m.status === 'pending_review').length;
  const occupiedBedsCount = beds.filter((b) => b.status === 'occupied').length;
  const opdWaitingCount = opdQueue.filter((q) => q.status === 'waiting').length;

  const navigationSections = [
    {
      title: 'Command & Overview',
      items: [
        {
          id: 'command',
          name: 'Operations Command',
          shortName: 'Command',
          icon: TrendingUp,
        },
        {
          id: 'directory',
          name: 'All Subsystems Directory',
          shortName: 'Directory',
          icon: LayoutGrid,
        },
      ],
    },
    {
      title: 'Clinical & Patient Care',
      items: [
        {
          id: 'patients',
          name: 'Patient EHR Index (MPI)',
          shortName: 'Patients',
          icon: Users,
        },
        {
          id: 'opd',
          name: 'OPD Consultations',
          shortName: 'OPD',
          icon: Stethoscope,
        },
        {
          id: 'emergency',
          name: 'Emergency & Trauma (ER)',
          shortName: 'ER Trauma',
          icon: ShieldAlert,
        },
        {
          id: 'surgery',
          name: 'Operating Theaters (OT)',
          shortName: 'OT Suites',
          icon: Scissors,
          directHref: '/metro-health/or/schedule',
        },
        {
          id: 'beds',
          name: 'Inpatient Bed Census',
          shortName: 'Bed Census',
          icon: BedDouble,
          directHref: '/metro-health/inpatient/bed-board',
        },
        {
          id: 'disease-intake',
          name: 'Disease Protocols & Intake',
          shortName: 'Disease Intake',
          icon: HeartPulse,
        },
        {
          id: 'workflow-runtime',
          name: 'Clinical Workflow Runtime',
          shortName: 'Workflow DAG',
          icon: GitFork,
        },
        {
          id: 'telehealth',
          name: 'Telehealth & Virtual Care',
          shortName: 'Telehealth',
          icon: Video,
        },
      ],
    },
    {
      title: 'Diagnostics & Interoperability',
      items: [
        {
          id: 'ancillary',
          name: 'LIS Lab & Radiology (Rx)',
          shortName: 'Diagnostics',
          icon: FlaskConical,
        },
        {
          id: 'bloodbank',
          name: 'Blood Bank & Transfusion',
          shortName: 'Blood Bank',
          icon: Droplet,
        },
        {
          id: 'interop',
          name: 'HL7 & FHIR R4 Hub',
          shortName: 'HL7 / FHIR',
          icon: Cpu,
        },
        {
          id: 'sheets',
          name: 'Google Sheets & Drive Hub',
          shortName: 'Sheets Interop',
          icon: FileSpreadsheet,
        },
      ],
    },
    {
      title: 'Operations, Finance & ERP',
      items: [
        {
          id: 'billing',
          name: 'Billing & Revenue Audit',
          shortName: 'Billing ERP',
          icon: DollarSign,
        },
        {
          id: 'claims',
          name: 'Claims Scrubber (EDI 837)',
          shortName: 'Claims',
          icon: FileCheck,
        },
        {
          id: 'scm-pos',
          name: 'Supply Chain & Inventory',
          shortName: 'Supply Chain',
          icon: ShoppingCart,
          directHref: '/metro-health/scm/purchase-orders',
        },
        {
          id: 'erp-coa',
          name: 'Enterprise General Ledger',
          shortName: 'GL Accounts',
          icon: BookOpen,
          directHref: '/metro-health/erp/chart-of-accounts',
        },
        {
          id: 'staff',
          name: 'Staff Rosters & Credentials',
          shortName: 'Staff Rosters',
          icon: Building2,
        },
        {
          id: 'audit',
          name: 'Dual Edge Sync & Audit',
          shortName: 'Edge Sync',
          icon: Server,
        },
      ],
    },
  ];

  const router = useRouter();

  const handleSelectTab = (item: { id: string; directHref?: string }) => {
    if (item.directHref) {
      router.push(item.directHref);
    } else {
      setActiveTab(item.id);
    }
    if (mobileOpen) setMobileOpen(false);
  };

  const filteredSections = navigationSections.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.shortName.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      {/* Mobile & Tablet Backdrop */}
      {mobileOpen && (
        <div
          id="sidebar-mobile-backdrop"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 lg:hidden transition-opacity cursor-pointer animate-in fade-in duration-200"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        id="collapsible-main-sidebar"
        className={`fixed top-0 lg:top-16 bottom-0 left-0 z-50 lg:z-20 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-72 sm:w-80 lg:w-64 max-w-[85vw]'
        } ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } shadow-2xl lg:shadow-none select-none`}
      >
        {/* Mobile / Tablet Drawer Top Header */}
        <div className="lg:hidden p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
              <HeartPulse className="w-4 h-4" />
            </div>
            <div>
              <div className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">G-HIMS OS</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Hospital Subsystems Navigation</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="min-w-[40px] min-h-[40px] p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
            title="Close Menu"
            aria-label="Close Menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search / Collapse Toggle */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          {!isCollapsed ? (
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter subsystems..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-750 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Expand Navigation (Search & Details)"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Collapse / Expand Toggle Button on Desktop */}
          <button
            type="button"
            id="btn-toggle-sidebar-collapse"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Scrollable Navigation List */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scrollbar pb-12 lg:pb-4">
          {filteredSections.map((section, idx) => (
            <div key={section.title || idx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {section.title}
                </div>
              )}
              {isCollapsed && idx > 0 && (
                <div className="my-2 border-t border-slate-100 dark:border-slate-800" />
              )}

              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      id={`sidebar-nav-${item.id}`}
                      onClick={() => handleSelectTab(item)}
                      className={`w-full group relative flex items-center gap-3 rounded-xl transition-all cursor-pointer min-h-[42px] ${
                        isCollapsed ? 'justify-center p-2.5' : 'px-2.5 py-2'
                      } ${
                        isActive
                          ? 'bg-blue-600 text-white font-bold shadow-xs'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white font-medium'
                      }`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                          isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                        }`}
                      />

                      {!isCollapsed && (
                        <div className="flex-1 flex items-center text-left truncate">
                          <span className="text-xs truncate">{item.name}</span>
                        </div>
                      )}

                      {/* Tooltip on Collapsed */}
                      {isCollapsed && (
                        <div className="absolute left-full ml-2 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 flex items-center">
                          <span>{item.name}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
