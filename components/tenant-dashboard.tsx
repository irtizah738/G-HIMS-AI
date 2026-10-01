'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useHospital } from '@/lib/context/hospital-context';
import { useAuth } from '@/lib/firebase/auth-context';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { CommandHubView } from '@/components/views/command-hub-view';

// Sleek loading skeleton for deferred views
const ViewSkeleton = () => (
  <div className="w-full min-h-[480px] p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-800 animate-pulse flex flex-col gap-5 shadow-xs">
    <div className="flex items-center justify-between">
      <div className="space-y-2 w-1/3">
        <div className="h-7 bg-slate-200 dark:bg-slate-800 rounded-lg w-3/4"></div>
        <div className="h-4 bg-slate-100 dark:bg-slate-800/60 rounded w-1/2"></div>
      </div>
      <div className="h-10 w-28 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
      <div className="h-24 bg-slate-100 dark:bg-slate-800/50 rounded-xl"></div>
      <div className="h-24 bg-slate-100 dark:bg-slate-800/50 rounded-xl"></div>
      <div className="h-24 bg-slate-100 dark:bg-slate-800/50 rounded-xl"></div>
      <div className="h-24 bg-slate-100 dark:bg-slate-800/50 rounded-xl"></div>
    </div>
    <div className="h-72 bg-slate-100 dark:bg-slate-800/40 rounded-xl mt-2"></div>
  </div>
);

// Dynamic module code-splitting to prevent massive initial bundle timeout
const BillingErpView = dynamic(() => import('@/components/views/billing-erp-view').then(m => m.BillingErpView), { loading: ViewSkeleton, ssr: false });
const OpdEncountersView = dynamic(() => import('@/components/views/opd-encounters-view').then(m => m.OpdEncountersView), { loading: ViewSkeleton, ssr: false });
const GovernedBedBoard = dynamic(() => import('@/components/inpatient/governed-bed-board').then(m => m.GovernedBedBoard), { loading: ViewSkeleton, ssr: false });
const AncillaryServicesView = dynamic(() => import('@/components/views/ancillary-services-view').then(m => m.AncillaryServicesView), { loading: ViewSkeleton, ssr: false });
const OrdersInteropView = dynamic(() => import('@/components/views/orders-interop-view').then(m => m.OrdersInteropView), { loading: ViewSkeleton, ssr: false });
const AuditLedgerView = dynamic(() => import('@/components/views/audit-ledger-view').then(m => m.AuditLedgerView), { loading: ViewSkeleton, ssr: false });
const PatientMpiView = dynamic(() => import('@/components/views/patient-mpi-view').then(m => m.PatientMpiView), { loading: ViewSkeleton, ssr: false });
const StaffView = dynamic(() => import('@/components/views/staff-view').then(m => m.StaffView), { loading: ViewSkeleton, ssr: false });
const EmergencyTriageView = dynamic(() => import('@/components/views/emergency-triage-view').then(m => m.EmergencyTriageView), { loading: ViewSkeleton, ssr: false });
const SurgeryTheaterView = dynamic(() => import('@/components/views/surgery-theater-view').then(m => m.SurgeryTheaterView), { loading: ViewSkeleton, ssr: false });
const BloodBankView = dynamic(() => import('@/components/views/blood-bank-view').then(m => m.BloodBankView), { loading: ViewSkeleton, ssr: false });
const TelehealthView = dynamic(() => import('@/components/views/telehealth-view').then(m => m.TelehealthView), { loading: ViewSkeleton, ssr: false });
const ClaimsPreAuthView = dynamic(() => import('@/components/views/claims-preauth-view').then(m => m.ClaimsPreAuthView), { loading: ViewSkeleton, ssr: false });
const AllModulesDirectory = dynamic(() => import('@/components/views/all-modules-directory').then(m => m.AllModulesDirectory), { loading: ViewSkeleton, ssr: false });
const ModuleReadinessMatrixView = dynamic(() => import('@/components/views/module-readiness-matrix-view').then(m => m.ModuleReadinessMatrixView), { loading: ViewSkeleton, ssr: false });
const GoogleSheetsView = dynamic(() => import('@/components/views/google-sheets-view').then(m => m.GoogleSheetsView), { loading: ViewSkeleton, ssr: false });
const DiseaseCentricIntakeView = dynamic(() => import('@/components/views/disease-centric-intake-view').then(m => m.DiseaseCentricIntakeView), { loading: ViewSkeleton, ssr: false });
const SettingsView = dynamic(() => import('@/components/views/settings-view').then(m => m.SettingsView), { loading: ViewSkeleton, ssr: false });
const PatientPortalView = dynamic(() => import('@/components/views/patient-portal-view').then(m => m.PatientPortalView), { loading: ViewSkeleton, ssr: false });
const HrManagementView = dynamic(() => import('@/components/views/hr-management-view').then(m => m.HrManagementView), { loading: ViewSkeleton, ssr: false });
const ResourceCapacityView = dynamic(() => import('@/components/views/resource-capacity-view').then(m => m.ResourceCapacityView), { loading: ViewSkeleton, ssr: false });
const SupplyChainScmView = dynamic(() => import('@/components/views/supply-chain-scm-view').then(m => m.SupplyChainScmView), { loading: ViewSkeleton, ssr: false });
const ReportingAnalyticsView = dynamic(() => import('@/components/views/reporting-analytics-view').then(m => m.ReportingAnalyticsView), { loading: ViewSkeleton, ssr: false });
const RbacManagementView = dynamic(() => import('@/components/views/rbac-management-view').then(m => m.RbacManagementView), { loading: ViewSkeleton, ssr: false });
import { RbacModuleGate } from '@/components/auth/rbac-gate';
import { RbacRoleSwitcherModal } from '@/components/auth/rbac-role-switcher';
import { useRBAC } from '@/lib/auth/rbac-context';
import { AiCopilotDrawer } from '@/components/ai/ai-copilot-drawer';
import { FloatingCopilotBot } from '@/components/ai/floating-copilot-bot';
import { CollapsibleSidebar } from '@/components/navigation/collapsible-sidebar';
import { SyncStatusIndicator } from '@/components/navigation/sync-status-indicator';
import { CommandPalette } from '@/components/navigation/command-palette';
import { HeaderProfileMenu } from '@/components/auth/header-profile-menu';
import { HospitalOperationalContextBar } from '@/components/navigation/hospital-operational-context-bar';
import { useTenant } from '@/lib/tenant/context';
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
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function TenantDashboard() {
  const { currentTenant } = useTenant();
  const currentTenantId = currentTenant?.id || 'central-metro-hospital';
  const { activeTab, setActiveTab, stats, mismatches, copilotOpen, setCopilotOpen, networkMode, patients } = useHospital();
  const { user, signInWithGoogle, signOut, loading: authLoading } = useAuth();
  const { currentRole, roleDefinition, canAccessModule, setRole } = useRBAC();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);

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
                  {currentTenant?.name || currentTenantId}
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
            <HeaderProfileMenu tenantId={currentTenantId} />
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
        <div
          className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ease-in-out ${
            isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'
          }`}
        >
          {/* Global Hospital Operational Context Bar (Facility, Unit, User, Role, Active Patient, Workflow) */}
          <HospitalOperationalContextBar onOpenPatientSearch={() => setCommandPaletteOpen(true)} />

          <main className="flex-1 min-w-0 p-3 sm:p-5 lg:p-8 pb-28">
            <div className="max-w-7xl mx-auto w-full">
            {activeTab === 'patient-portal' && <PatientPortalView />}
            {activeTab === 'directory' && (
              <RbacModuleGate moduleId="directory" moduleName="All Modules Directory">
                <AllModulesDirectory />
              </RbacModuleGate>
            )}
            {activeTab === 'matrix' && (
              <RbacModuleGate moduleId="matrix" moduleName="Module Readiness Matrix">
                <ModuleReadinessMatrixView />
              </RbacModuleGate>
            )}
            {activeTab === 'disease-intake' && (
              <RbacModuleGate moduleId="disease-intake" moduleName="Disease Intake Protocols">
                <DiseaseCentricIntakeView />
              </RbacModuleGate>
            )}
            {activeTab === 'command' && (
              <RbacModuleGate moduleId="command" moduleName="Executive Command Hub">
                <CommandHubView />
              </RbacModuleGate>
            )}
            {(activeTab === 'billing' || activeTab === 'erp-coa') && (
              <RbacModuleGate moduleId="billing" moduleName="Revenue Leakage & ERP Billing">
                <BillingErpView />
              </RbacModuleGate>
            )}
            {activeTab === 'claims' && (
              <RbacModuleGate moduleId="claims" moduleName="Claims & Pre-Authorization">
                <ClaimsPreAuthView />
              </RbacModuleGate>
            )}
            {(activeTab === 'opd' || activeTab === 'workflow-runtime') && (
              <RbacModuleGate moduleId="opd" moduleName="OPD Encounters & Consultations">
                <OpdEncountersView initialViewMode="master_suite" />
              </RbacModuleGate>
            )}
            {activeTab === 'emergency' && (
              <RbacModuleGate moduleId="emergency" moduleName="Emergency & Trauma (ER)">
                <EmergencyTriageView />
              </RbacModuleGate>
            )}
            {activeTab === 'beds' && (
              <RbacModuleGate moduleId="beds" moduleName="Inpatient Bed Occupancy">
                <GovernedBedBoard />
              </RbacModuleGate>
            )}
            {activeTab === 'surgery' && (
              <RbacModuleGate moduleId="surgery" moduleName="Operating Theater (OT)">
                <SurgeryTheaterView />
              </RbacModuleGate>
            )}
            {activeTab === 'ancillary' && (
              <RbacModuleGate moduleId="ancillary" moduleName="LIS Lab & Ancillary Services">
                <AncillaryServicesView />
              </RbacModuleGate>
            )}
            {activeTab === 'bloodbank' && (
              <RbacModuleGate moduleId="bloodbank" moduleName="Blood Bank & Transfusion">
                <BloodBankView />
              </RbacModuleGate>
            )}
            {activeTab === 'telehealth' && (
              <RbacModuleGate moduleId="telehealth" moduleName="Telehealth & Virtual Care">
                <TelehealthView />
              </RbacModuleGate>
            )}
            {activeTab === 'interop' && (
              <RbacModuleGate moduleId="interop" moduleName="HL7 & FHIR R4 Interop Hub">
                <OrdersInteropView />
              </RbacModuleGate>
            )}
            {activeTab === 'sheets' && (
              <RbacModuleGate moduleId="sheets" moduleName="Google Sheets Hub">
                <GoogleSheetsView />
              </RbacModuleGate>
            )}
            {activeTab === 'audit' && (
              <RbacModuleGate moduleId="audit" moduleName="Audit Ledger & Edge Outbox">
                <AuditLedgerView />
              </RbacModuleGate>
            )}
            {activeTab === 'patients' && (
              <RbacModuleGate moduleId="patients" moduleName="Patient Master Index (MPI)">
                <PatientMpiView />
              </RbacModuleGate>
            )}
            {activeTab === 'staff' && (
              <RbacModuleGate moduleId="staff" moduleName="Staff Directory & Rosters">
                <StaffView />
              </RbacModuleGate>
            )}
            {(activeTab === 'hcm' || activeTab === 'workforce') && (
              <RbacModuleGate moduleId="staff" moduleName="Hospital Workforce & HR Operating System">
                <HrManagementView />
              </RbacModuleGate>
            )}
            {activeTab === 'resources' && (
              <RbacModuleGate moduleId="beds" moduleName="Hospital Resource & Capacity Operating System">
                <ResourceCapacityView />
              </RbacModuleGate>
            )}
            {(activeTab === 'scm' || activeTab === 'scm-pos' || activeTab === 'supply-chain') && (
              <RbacModuleGate moduleId="scm-pos" moduleName="Supply Chain & Inventory Management">
                <SupplyChainScmView tenantId={currentTenantId} />
              </RbacModuleGate>
            )}
            {(activeTab === 'reporting' || activeTab === 'analytics') && (
              <RbacModuleGate moduleId="reporting" moduleName="Advanced Reporting & Analytics">
                <ReportingAnalyticsView />
              </RbacModuleGate>
            )}
            {(activeTab === 'rbac' || activeTab === 'roles' || activeTab === 'permissions') && (
              <RbacModuleGate moduleId="rbac" moduleName="RBAC Management & Permission Matrix">
                <RbacManagementView />
              </RbacModuleGate>
            )}
            {activeTab === 'settings' && (
              <RbacModuleGate moduleId="settings" moduleName="Enterprise Settings">
                <SettingsView />
              </RbacModuleGate>
            )}
          </div>
        </main>
        </div>
      </div>

      {/* Universal Command Palette (⌘K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* RBAC Role Switcher Modal */}
      <RbacRoleSwitcherModal
        isOpen={roleSwitcherOpen}
        onClose={() => setRoleSwitcherOpen(false)}
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
