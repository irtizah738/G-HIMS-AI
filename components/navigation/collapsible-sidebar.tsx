'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { useHospital } from '@/lib/context/hospital-context';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import { useAuth as useEnterpriseAuth } from '@/lib/auth/auth-context';
import { useTenant } from '@/lib/tenant/context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { normalizeRole } from '@/lib/auth/rbac';
import { ThemeToggle } from '@/components/theme/theme-toggle';
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
  User,
  Settings,
  UserCheck,
  BarChart3,
  Shield,
} from 'lucide-react';
import { RbacRoleSwitcherModal } from '@/components/auth/rbac-role-switcher';

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
  const { user: firebaseUser } = useFirebaseAuth();
  const { role: tenantRole } = useTenant();
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);

  let enterpriseAuth: ReturnType<typeof useEnterpriseAuth> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    enterpriseAuth = useEnterpriseAuth();
  } catch {
    enterpriseAuth = null;
  }

  let rbac: ReturnType<typeof useRBAC> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rbac = useRBAC();
  } catch {
    rbac = null;
  }

  const [searchTerm, setSearchTerm] = useState('');

  // Unified identity resolution adhering strictly to G-HIMS authentication and RBAC protocol
  const activeUser = useMemo(() => {
    // 1. If user explicitly signed in with Firebase (Google SSO)
    if (firebaseUser) {
      return {
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Medical Staff',
        email: firebaseUser.email || 'user@centralmetro.health',
        photoURL: firebaseUser.photoURL,
        role: rbac?.roleDefinition?.displayName || tenantRole || 'Doctor',
        designation: rbac?.demoPersona?.title || 'Cardiology & Intensive Care',
      };
    }

    // 2. If enterprise authenticated staff is logged in
    if (enterpriseAuth?.user) {
      if (rbac?.demoPersona && rbac.currentRole !== normalizeRole(enterpriseAuth.roles?.[0])) {
        return {
          displayName: rbac.demoPersona.name,
          email: rbac.demoPersona.email,
          photoURL: null,
          role: rbac.roleDefinition.displayName,
          designation: rbac.demoPersona.title,
        };
      }

      return {
        displayName: enterpriseAuth.user.displayName || 'Dr. Sarah Jenkins, MD',
        email: enterpriseAuth.user.email,
        photoURL: null,
        role: rbac?.roleDefinition?.displayName || enterpriseAuth.roles?.[0] || 'Doctor',
        designation: rbac?.demoPersona?.title || 'Cardiology & Intensive Care',
      };
    }

    // 3. Fallback to active RBAC simulation persona
    if (rbac?.demoPersona) {
      return {
        displayName: rbac.demoPersona.name,
        email: rbac.demoPersona.email,
        photoURL: null,
        role: rbac.roleDefinition.displayName,
        designation: rbac.demoPersona.title,
      };
    }

    // 4. Default baseline clinician persona
    return {
      displayName: 'Dr. Sarah Jenkins, MD',
      email: 's.jenkins@centralmetro.health',
      photoURL: null,
      role: 'Doctor',
      designation: 'Lead Attending Cardiologist',
    };
  }, [firebaseUser, enterpriseAuth?.user, enterpriseAuth?.roles, rbac?.demoPersona, rbac?.roleDefinition, rbac?.currentRole, tenantRole]);

  const displayName = activeUser.displayName;
  const designation = activeUser.designation || rbac?.roleDefinition?.displayName || tenantRole || 'Lead Attending Cardiologist';

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
          name: 'All 52 Domains Directory',
          shortName: '52 Domains',
          icon: LayoutGrid,
          badge: '52',
        },
        {
          id: 'reporting',
          name: 'Advanced Reporting & Analytics',
          shortName: 'KPI Analytics',
          icon: BarChart3,
          badge: 'KPIs',
        },
        {
          id: 'rbac',
          name: 'RBAC Security Matrix',
          shortName: 'RBAC Matrix',
          icon: Shield,
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
          id: 'consultant-command',
          name: 'Consultant Command Center',
          shortName: 'Consultant',
          icon: Stethoscope,
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
        },
        {
          id: 'beds',
          name: 'Inpatient Bed Census',
          shortName: 'Bed Census',
          icon: BedDouble,
        },
        {
          id: 'nursing-emar',
          name: 'Inpatient Nursing & eMAR',
          shortName: 'Nursing eMAR',
          icon: BedDouble,
        },
        {
          id: 'dialysis-nephrology',
          name: 'Renal Care & Dialysis',
          shortName: 'Dialysis',
          icon: Droplet,
        },
        {
          id: 'maternity-labor-delivery',
          name: 'Obstetrics & Partogram',
          shortName: 'Obstetrics',
          icon: HeartPulse,
        },
        {
          id: 'oncology-tumor-board',
          name: 'Oncology & Tumor Board',
          shortName: 'Oncology',
          icon: HeartPulse,
        },
        {
          id: 'rehab-physical-therapy',
          name: 'Rehabilitation',
          shortName: 'Rehab',
          icon: Stethoscope,
        },
        {
          id: 'disease-intake',
          name: 'Disease Protocols & Intake',
          shortName: 'Disease Intake',
          icon: HeartPulse,
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
        },
        {
          id: 'erp-coa',
          name: 'Enterprise General Ledger',
          shortName: 'GL Accounts',
          icon: BookOpen,
        },
        {
          id: 'hcm',
          name: 'Hospital Workforce & HR OS',
          shortName: 'Workforce HR',
          icon: UserCheck,
        },
        {
          id: 'resources',
          name: 'Resource & Capacity OS',
          shortName: 'Resources & OT',
          icon: Boxes,
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
    {
      title: 'System & Governance',
      items: [
        {
          id: 'settings',
          name: 'Enterprise Settings & Config',
          shortName: 'Settings',
          icon: Settings,
        },
      ],
    },
  ];

  const isPatientRole = rbac?.currentRole === 'patient';

  const patientSections = [
    {
      title: 'Patient Healthcare Portal',
      items: [
        {
          id: 'patient-portal',
          name: 'My Health Record & Portal',
          shortName: 'My Health',
          icon: User,
        },
        {
          id: 'telehealth',
          name: 'Telehealth Consultations',
          shortName: 'Telehealth',
          icon: Video,
        },
        {
          id: 'opd',
          name: 'Appointments & Consultations',
          shortName: 'Appointments',
          icon: Stethoscope,
        },
        {
          id: 'billing',
          name: 'Invoices & Co-Pays',
          shortName: 'My Invoices',
          icon: DollarSign,
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

  const activeSections = isPatientRole ? patientSections : navigationSections;

  const filteredSections = activeSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // RBAC Authorization Gate
        const allowedByRbac = rbac ? rbac.canAccessModule(item.id) : true;
        if (!allowedByRbac) return false;

        // Search text filter
        if (!searchTerm) return true;
        return (
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.shortName.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }),
    }))
    .filter((section) => section.items.length > 0);

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
            className="min-w-[44px] min-h-[44px] p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
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
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scrollbar">
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
                        <div className="flex-1 flex items-center justify-between text-left truncate gap-1.5">
                          <span className="text-xs truncate">{item.name}</span>
                          {(item as { badge?: string }).badge && (
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80'
                              }`}
                            >
                              {(item as { badge?: string }).badge}
                            </span>
                          )}
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

        {/* User Name, Designation & Day/Night Mode Switcher Footer */}
        <div className="border-t border-slate-200/80 dark:border-slate-800 p-2 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-xs mt-auto shrink-0">
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-white dark:bg-slate-850 border border-slate-200/80 dark:border-slate-750 shadow-2xs">
              {/* User Avatar + Name + Designation (Click to switch demo role) */}
              <div
                id="btn-sidebar-user-role-badge"
                onClick={() => setRoleSwitcherOpen(true)}
                className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800 p-1 rounded-lg transition-colors"
                title="Click to Switch Demo Role / Persona"
              >
                <div className="relative shrink-0">
                  {activeUser.photoURL ? (
                    <Image
                      src={activeUser.photoURL}
                      alt={displayName}
                      width={30}
                      height={30}
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover border border-slate-300 dark:border-slate-600 shadow-2xs"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shadow-2xs">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                </div>

                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {displayName}
                    </p>
                    <UserCheck className="w-3 h-3 text-slate-400 group-hover:text-blue-500 shrink-0" />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate capitalize leading-tight mt-0.5">
                    {designation}
                  </p>
                </div>
              </div>

              {/* Day / Night Mode Button */}
              <div className="shrink-0 flex items-center pl-1 border-l border-slate-100 dark:border-slate-800">
                <ThemeToggle variant="button" />
              </div>
            </div>
          ) : (
            /* Collapsed State: Stacked Avatar & Settings & Theme Toggle */
            <div className="flex flex-col items-center gap-2 p-0.5">
              <button
                type="button"
                id="btn-sidebar-collapsed-settings"
                onClick={() => {
                  setActiveTab('settings');
                  if (mobileOpen) setMobileOpen(false);
                }}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Enterprise Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <div
                onClick={() => setRoleSwitcherOpen(true)}
                className="relative group cursor-pointer"
                title={`Active: ${displayName} (${designation}) - Click to Switch Role`}
              >
                {activeUser.photoURL ? (
                  <Image
                    src={activeUser.photoURL}
                    alt={displayName}
                    width={28}
                    height={28}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover border border-slate-300 dark:border-slate-600 shadow-2xs"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shadow-2xs">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}

                {/* Floating Tooltip on Hover */}
                <div className="absolute left-full ml-2 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  <p className="font-bold">{displayName}</p>
                  <p className="text-[10px] text-slate-400 font-normal">{designation} • Click to switch</p>
                </div>
              </div>

              {/* Theme Toggle Button */}
              <ThemeToggle variant="button" />
            </div>
          )}
        </div>
      </aside>

      {/* RBAC Role Switcher Modal */}
      <RbacRoleSwitcherModal
        isOpen={roleSwitcherOpen}
        onClose={() => setRoleSwitcherOpen(false)}
      />
    </>
  );
}
