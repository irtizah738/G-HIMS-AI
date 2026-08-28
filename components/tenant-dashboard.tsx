'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useHospital } from '@/lib/context/hospital-context';
import { useAuth } from '@/lib/firebase/auth-context';
import Image from 'next/image';
import { CommandHubView } from '@/components/views/command-hub-view';
import { BillingErpView } from '@/components/views/billing-erp-view';
import { OpdEncountersView } from '@/components/views/opd-encounters-view';
import { BedOccupancyView } from '@/components/views/bed-occupancy-view';
import { AncillaryServicesView } from '@/components/views/ancillary-services-view';
import { OrdersInteropView } from '@/components/views/orders-interop-view';
import { AuditLedgerView } from '@/components/views/audit-ledger-view';
import { PatientMpiView } from '@/components/views/patient-mpi-view';
import { StaffView } from '@/components/views/staff-view';
import { EmergencyTriageView } from '@/components/views/emergency-triage-view';
import { SurgeryTheaterView } from '@/components/views/surgery-theater-view';
import { BloodBankView } from '@/components/views/blood-bank-view';
import { TelehealthView } from '@/components/views/telehealth-view';
import { ClaimsPreAuthView } from '@/components/views/claims-preauth-view';
import { WorkflowRuntimeView } from '@/components/views/workflow-runtime-view';
import { AllModulesDirectory } from '@/components/views/all-modules-directory';
import { ModuleReadinessMatrixView } from '@/components/views/module-readiness-matrix-view';
import { GoogleSheetsView } from '@/components/views/google-sheets-view';
import { DiseaseCentricIntakeView } from '@/components/views/disease-centric-intake-view';
import { AiCopilotDrawer } from '@/components/ai/ai-copilot-drawer';
import { FloatingCopilotBot } from '@/components/ai/floating-copilot-bot';
import { CollapsibleSidebar } from '@/components/navigation/collapsible-sidebar';
import { SyncStatusIndicator } from '@/components/navigation/sync-status-indicator';
import { CommandPalette } from '@/components/navigation/command-palette';
import { HeaderProfileMenu } from '@/components/auth/header-profile-menu';
import {
  BedDouble,
  Users,
  HeartPulse,
  Receipt,
  KeyRound,
  FlaskConical,
  Building2,
  Bell,
  Search,
  Activity,
  Sparkles,
  ShieldAlert,
  TrendingUp,
  Stethoscope,
  Cpu,
  Server,
  DollarSign,
  Wifi,
  WifiOff,
  Layers,
  Scissors,
  Droplet,
  Video,
  FileCheck,
  ChevronDown,
  LayoutGrid,
  Menu,
  Command,
  Radio,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function TenantDashboard() {
  const { activeTab, setActiveTab, stats, mismatches, copilotOpen, setCopilotOpen, networkMode, patients } = useHospital();
  const { user, signInWithGoogle, signOut, loading: authLoading } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global Keyboard Shortcuts (Cmd/Ctrl + K, Cmd/Ctrl + J, Cmd/Ctrl + B)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K -> Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      // Cmd/Ctrl + J -> AI Copilot
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCopilotOpen(!copilotOpen);
      }
      // Cmd/Ctrl + B -> Toggle Sidebar
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copilotOpen, setCopilotOpen]);

  const pendingLeakageCount = mismatches.filter((m) => m.status === 'pending_review').length;

  return (
    <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Top Main Navigation Bar */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 shadow-xs transition-colors">
        <div className="w-full px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          {/* Left Brand and Mobile Toggle */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Mobile / Tablet Hamburger Drawer Button */}
            <button
              id="btn-mobile-sidebar-toggle"
              onClick={() => setSidebarMobileOpen(!sidebarMobileOpen)}
              className="lg:hidden w-9 h-9 p-0 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
              title="Toggle Navigation Menu"
              aria-label="Toggle Navigation Menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Logo and Brand */}
            <div
              onClick={() => setActiveTab('command')}
              className="flex items-center gap-2.5 cursor-pointer select-none group"
            >
              <div className="w-8 h-8 rounded-xl bg-blue-600 group-hover:bg-blue-500 text-white flex items-center justify-center font-bold shadow-xs transition-colors shrink-0">
                <HeartPulse className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm tracking-tight">G-HIMS</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium hidden sm:inline border-l border-slate-200 dark:border-slate-700 pl-2">
                  Metropolitan Health
                </span>
              </div>
            </div>
          </div>

          {/* Center Universal Search Bar - Tablet & Desktop */}
          <div className="flex-1 max-w-md mx-2 lg:mx-6 hidden md:block">
            <button
              id="btn-global-command-search"
              onClick={() => setCommandPaletteOpen(true)}
              className="w-full h-9 px-3 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/70 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs transition-all cursor-pointer shadow-2xs group"
            >
              <span className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                <span className="truncate">Search commands, patients, modules...</span>
              </span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[10px] font-mono text-slate-400">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right Action Tools: Sync Status & Sign In / Profile Menu */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile Search Button */}
            <button
              id="btn-mobile-command-search"
              onClick={() => setCommandPaletteOpen(true)}
              className="md:hidden w-9 h-9 p-0 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
              title="Search (⌘K)"
              aria-label="Search commands and patients"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Global Dual-Engine Sync Status */}
            <SyncStatusIndicator />

            {/* Unified Staff Profile & Sign In Dropdown Menu */}
            <HeaderProfileMenu tenantId="central-metro-hospital" />
          </div>
        </div>
      </header>

      {/* Main Body Area with Collapsible Persistent Sidebar */}
      <div className="flex-1 flex w-full relative">
        {/* Collapsible Persistent Sidebar */}
        <CollapsibleSidebar
          isCollapsed={isSidebarCollapsed}
          setIsCollapsed={setIsSidebarCollapsed}
          mobileOpen={sidebarMobileOpen}
          setMobileOpen={setSidebarMobileOpen}
        />

        {/* Content View with dynamic margin offset for persistent sidebar */}
        <main
          className={`flex-1 min-w-0 transition-all duration-300 ease-in-out ${
            isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'
          } p-3 sm:p-5 lg:p-8 pb-28`}
        >
          <div className="max-w-7xl mx-auto w-full">
            {activeTab === 'directory' && <AllModulesDirectory />}
            {activeTab === 'matrix' && <ModuleReadinessMatrixView />}
            {activeTab === 'workflow-runtime' && <WorkflowRuntimeView />}
            {activeTab === 'disease-intake' && <DiseaseCentricIntakeView />}
            {activeTab === 'command' && <CommandHubView />}
            {activeTab === 'billing' && <BillingErpView />}
            {activeTab === 'claims' && <ClaimsPreAuthView />}
            {activeTab === 'opd' && <OpdEncountersView />}
            {activeTab === 'emergency' && <EmergencyTriageView />}
            {activeTab === 'beds' && <BedOccupancyView />}
            {activeTab === 'surgery' && <SurgeryTheaterView />}
            {activeTab === 'ancillary' && <AncillaryServicesView />}
            {activeTab === 'bloodbank' && <BloodBankView />}
            {activeTab === 'telehealth' && <TelehealthView />}
            {activeTab === 'interop' && <OrdersInteropView />}
            {activeTab === 'sheets' && <GoogleSheetsView />}
            {activeTab === 'audit' && <AuditLedgerView />}
            {activeTab === 'patients' && <PatientMpiView />}
            {activeTab === 'staff' && <StaffView />}
          </div>
        </main>
      </div>

      {/* Universal Command Palette (⌘K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* AI Clinical Copilot & Scribe Drawer */}
      <AiCopilotDrawer />

      {/* Floating Bottom-Right AI Copilot Bot Trigger */}
      <FloatingCopilotBot
        isOpen={copilotOpen}
        onToggle={() => setCopilotOpen(!copilotOpen)}
      />
    </div>
  );
}
