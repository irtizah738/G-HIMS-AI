'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Search,
  Calendar,
  Clock,
  Activity,
  Stethoscope,
  FlaskConical,
  Pill,
  DollarSign,
  FileCheck,
  ShieldCheck,
  PlusCircle,
  LayoutDashboard,
  Layers,
  ChevronRight,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Flame,
} from 'lucide-react';
import {
  ComprehensiveOpdEncounter,
  PatientDemographics,
  AppointmentRecord,
  QueueEntry,
  ComprehensiveVitals,
  SoapDocumentation,
  DiagnosticOrderItem,
  PharmacyPrescriptionItem,
  OpdInvoice,
  PaymentTransaction,
  EncounterDisposition,
  OpdTimelineEvent,
  OpdRole,
  OpdWorkflowStage,
} from '@/types/opd-domain';

import { OpdDashboardKpis } from './OpdDashboardKpis';
import { OpdPatientSearchMpi } from './OpdPatientSearchMpi';
import { OpdRegistrationConsent } from './OpdRegistrationConsent';
import { OpdAppointmentsWaitlist } from './OpdAppointmentsWaitlist';
import { OpdQueueEngine } from './OpdQueueEngine';
import { OpdTriageVitals } from './OpdTriageVitals';
import { OpdConsultationSpecialties } from './OpdConsultationSpecialties';
import { OpdDiagnosticOrdersPacs } from './OpdDiagnosticOrdersPacs';
import { OpdPharmacyPrescriptions } from './OpdPharmacyPrescriptions';
import { OpdBillingLedger } from './OpdBillingLedger';
import { OpdDispositionReferrals } from './OpdDispositionReferrals';
import {
  OpdPatientTimelineAudit,
  type OpdTimelineIntegritySummary,
} from './OpdPatientTimelineAudit';
import { OpdOfflineSyncManager } from './OpdOfflineSyncManager';
import { executeActiveTenantCommand, registerActiveTenantPatient } from '@/lib/api/command-client';
import { useAuth } from '@/lib/auth/auth-context';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { hydrateEdgeSnapshot } from '@/lib/offline/hydration';
import {
  adaptAuthoritativeConsultationInvoice,
  adaptAuthoritativeOpdInvoice,
  buildOpdWorkspaceReadModel,
} from '@/lib/opd/workspace-read-model';
import { fetchAuthoritativeOpdTimeline } from '@/lib/opd/timeline-client';

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

function resolveOpdRole(roles: string[]): OpdRole {
  const normalized = new Set(roles.map((role) => String(role).trim().toUpperCase()));
  if (normalized.has('SYSTEM_ADMIN') || normalized.has('ADMINISTRATOR') || normalized.has('ADMIN')) return 'ADMINISTRATOR';
  if (normalized.has('MEDICAL_DIRECTOR')) return 'CLINICAL_DIRECTOR';
  if (normalized.has('CONSULTANT')) return 'SPECIALIST_CONSULTANT';
  if (normalized.has('DOCTOR') || normalized.has('PHYSICIAN')) return 'MEDICAL_OFFICER';
  if (normalized.has('NURSE')) return 'TRIAGE_NURSE';
  if (normalized.has('PHARMACIST')) return 'PHARMACIST';
  if (normalized.has('LAB_TECH') || normalized.has('LAB_TECHNICIAN')) return 'LAB_TECH';
  if (
    normalized.has('BILLING_CLERK') ||
    normalized.has('BILLING_ADMIN') ||
    normalized.has('CASHIER') ||
    normalized.has('FINANCE_MANAGER') ||
    normalized.has('ACCOUNTANT') ||
    normalized.has('REVENUE_CYCLE')
  ) return 'BILLING_CASHIER';
  if (normalized.has('RECEPTIONIST') || normalized.has('REGISTRAR')) return 'RECEPTIONIST';
  return 'UNAUTHORIZED';
}

const OPD_TAB_ROLES: Record<string, OpdRole[]> = {
  DASHBOARD: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','TRIAGE_NURSE','PHARMACIST','LAB_TECH','BILLING_CASHIER','RECEPTIONIST'],
  SEARCH_MPI: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','TRIAGE_NURSE','RECEPTIONIST'],
  REGISTRATION: ['ADMINISTRATOR','RECEPTIONIST'],
  APPOINTMENTS: ['ADMINISTRATOR','RECEPTIONIST'],
  QUEUE: ['ADMINISTRATOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','TRIAGE_NURSE','RECEPTIONIST'],
  TRIAGE: ['ADMINISTRATOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','TRIAGE_NURSE'],
  CONSULTATION: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER'],
  DIAGNOSTICS: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','LAB_TECH'],
  PHARMACY: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','PHARMACIST'],
  BILLING: ['ADMINISTRATOR','BILLING_CASHIER'],
  DISPOSITION: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER'],
  AUDIT: ['ADMINISTRATOR','CLINICAL_DIRECTOR','SPECIALIST_CONSULTANT','MEDICAL_OFFICER','TRIAGE_NURSE'],
};


// Initial Mock Seed Data (DEMO runtime only)
const SEED_PATIENTS: PatientDemographics[] = [
  {
    id: 'pat-101',
    mrn: 'MRN-20260901-8842',
    fullName: 'Eleanor Vance',
    preferredName: 'Nora',
    gender: 'Female',
    dob: '1984-04-12',
    age: 42,
    nationalId: '61101-1928374-2',
    maritalStatus: 'Married',
    nationality: 'Pakistani',
    primaryLanguage: 'English / Urdu',
    phone: '+92 300 8877665',
    email: 'eleanor.vance@example.org',
    residentialAddress: 'House 42, Street 18, F-7/2, Islamabad',
    emergencyContact: {
      name: 'Tariq Vance',
      relation: 'Spouse',
      phone: '+92 321 9988771',
    },
    tariffPlan: 'CORPORATE_PPO',
    insuranceDetails: {
      payerName: 'Jubilee Life Healthcare',
      policyNumber: 'POL-JUB-998811',
      coveragePercent: 80,
      copayPercent: 20,
      expiryDate: '2027-12-31',
    },
    bloodGroup: 'O+',
    knownAllergies: ['Penicillin', 'NSAIDs'],
    chronicConditions: ['Hypertension'],
    createdAt: Date.now() - 86400000,
  },
  {
    id: 'pat-102',
    mrn: 'MRN-20260901-9124',
    fullName: 'Tariq Mehmood',
    gender: 'Male',
    dob: '1968-08-22',
    age: 58,
    nationalId: '37405-9988112-1',
    maritalStatus: 'Married',
    nationality: 'Pakistani',
    primaryLanguage: 'Urdu',
    phone: '+92 333 5544332',
    residentialAddress: 'G-10/4, Islamabad',
    tariffPlan: 'SEHAT_CARD_UNIVERSAL',
    insuranceDetails: {
      payerName: 'State Universal Health Card (Sehat Sahulat)',
      policyNumber: 'CNIC-37405-9988112-1',
      coveragePercent: 100,
      copayPercent: 0,
    },
    bloodGroup: 'B+',
    knownAllergies: [],
    chronicConditions: ['Type 2 Diabetes', 'Coronary Artery Disease'],
    createdAt: Date.now() - 172800000,
  },
  {
    id: 'pat-103',
    mrn: 'MRN-20260901-3319',
    fullName: 'Amina Zainab (Pediatric)',
    gender: 'Female',
    dob: '2020-02-14',
    age: 6,
    nationalId: '61101-0019283-4',
    maritalStatus: 'Single',
    nationality: 'Pakistani',
    primaryLanguage: 'Urdu',
    phone: '+92 345 1122334',
    residentialAddress: 'Sector I-8/2, Islamabad',
    emergencyContact: {
      name: 'Zainab Bibi',
      relation: 'Mother',
      phone: '+92 345 1122334',
    },
    tariffPlan: 'OUT_OF_POCKET',
    bloodGroup: 'A+',
    knownAllergies: [],
    chronicConditions: [],
    createdAt: Date.now() - 43200000,
  },
];

const SEED_APPOINTMENTS: AppointmentRecord[] = [
  {
    id: 'appt-101',
    patientId: 'pat-101',
    patientName: 'Eleanor Vance',
    mrn: 'MRN-20260901-8842',
    doctorId: 'doc-01',
    doctorName: 'Dr. Sarah Jenkins',
    department: 'Cardiology',
    appointmentType: 'NEW_CONSULTATION',
    scheduledDate: new Date().toISOString().slice(0, 10),
    scheduledTimeSlot: '09:30',
    durationMinutes: 20,
    status: 'CHECKED_IN',
    chiefComplaint: 'Progressive exertional dyspnea and pedal swelling',
    bookingChannel: 'ONLINE_PORTAL',
    createdAt: Date.now() - 7200000,
  },
  {
    id: 'appt-102',
    patientId: 'pat-102',
    patientName: 'Tariq Mehmood',
    mrn: 'MRN-20260901-9124',
    doctorId: 'doc-02',
    doctorName: 'Dr. Marcus Vance',
    department: 'General Medicine',
    appointmentType: 'ROUTINE_REVIEW',
    scheduledDate: new Date().toISOString().slice(0, 10),
    scheduledTimeSlot: '10:00',
    durationMinutes: 20,
    status: 'CONFIRMED',
    chiefComplaint: 'Routine Diabetic HbA1c review and blood pressure check',
    bookingChannel: 'FRONT_DESK',
    createdAt: Date.now() - 14400000,
  },
];

const SEED_ENCOUNTERS: ComprehensiveOpdEncounter[] = [
  {
    id: 'enc-101',
    tenantId: 'demo-ghims-metropolitan-hospital',
    patientId: 'pat-101',
    mrn: 'MRN-20260901-8842',
    patientName: 'Eleanor Vance',
    gender: 'Female',
    age: 42,
    tariffPlan: 'CORPORATE_PPO',
    insuranceDetails: {
      payerName: 'Jubilee Life Healthcare',
      policyNumber: 'POL-JUB-998811',
      coveragePercent: 80,
      copayPercent: 20,
    },
    knownAllergies: ['Penicillin', 'NSAIDs'],
    tokenNumber: 'CARD-101',
    encounterType: 'OPD_SPECIALIST',
    department: 'Cardiology',
    attendingDoctorId: 'doc-01',
    attendingDoctorName: 'Dr. Sarah Jenkins (Cardiology)',
    currentStage: 'SPECIALTY_CONSULTATION',
    stageProgress: {
      REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now() - 3600000, completedAt: Date.now() - 3300000, completedBy: 'Registrar K. Ahmed' },
      BILLING_AUTHORIZATION: { status: 'COMPLETED', enteredAt: Date.now() - 3300000, completedAt: Date.now() - 3000000, completedBy: 'Cashier J. Wilson' },
      QUEUE_ASSIGNMENT: { status: 'COMPLETED', enteredAt: Date.now() - 3000000, completedAt: Date.now() - 2700000, completedBy: 'Triage Desk' },
      NURSING_INTAKE: { status: 'COMPLETED', enteredAt: Date.now() - 2700000, completedAt: Date.now() - 2100000, completedBy: 'Nurse R. Chen' },
      MO_ASSESSMENT: { status: 'COMPLETED', enteredAt: Date.now() - 2100000, completedAt: Date.now() - 1500000, completedBy: 'Dr. A. Khan (MO)' },
      SPECIALTY_CONSULTATION: { status: 'ACTIVE', enteredAt: Date.now() - 1500000 },
      DIAGNOSTIC_ORDERS: { status: 'PENDING' },
      PHARMACY_FEFO: { status: 'PENDING' },
      BILLING_SETTLEMENT: { status: 'PENDING' },
      DISPOSITION_CLOSURE: { status: 'PENDING' },
      TIMELINE_AUDIT: { status: 'PENDING' },
    },
    vitalsAssessment: {
      heartRate: 88,
      systolicBp: 134,
      diastolicBp: 86,
      respiratoryRate: 18,
      temperatureCelsius: 36.9,
      spo2Percent: 97,
      onSupplementalOxygen: false,
      bloodGlucoseMgDl: 110,
      heightCm: 168,
      weightKg: 68.5,
      bmi: 24.3,
      painScale: 2,
      fallRiskScore: 1,
      gcsScore: 15,
      gcsEye: 4,
      gcsVerbal: 5,
      gcsMotor: 6,
      consciousnessAvpu: 'ALERT',
      news2Score: 0,
      news2Risk: 'LOW',
      measuredAt: Date.now() - 2400000,
      measuredBy: 'Staff Nurse R. Chen (RN)',
      triageNotes: 'Alert, responsive. Mild bilateral ankle swelling noted.',
    },
    diagnosticOrders: [
      {
        id: 'diag-101',
        category: 'LABORATORY',
        testCode: 'LAB-BNP-03',
        testName: 'Serum NT-proBNP Quantitative',
        specimenType: 'Serum Gel Tube',
        specimenBarcode: 'SPEC-8842-BNP',
        urgency: 'URGENT',
        reasonForOrder: 'Heart failure assessment',
        status: 'PROCESSING',
        orderingDoctor: 'Dr. Sarah Jenkins',
        orderedAt: Date.now() - 1200000,
        costAmountMinorUnits: 450000,
        requiresConsent: false,
        consentVerified: true,
      },
      {
        id: 'diag-102',
        category: 'RADIOLOGY',
        testCode: 'RAD-CXR-01',
        testName: 'Chest X-Ray (PA View)',
        urgency: 'ROUTINE',
        reasonForOrder: 'Cardiomegaly check',
        status: 'VERIFIED',
        orderingDoctor: 'Dr. Sarah Jenkins',
        orderedAt: Date.now() - 1400000,
        resultsSummary: 'Normal cardiothoracic ratio, clear lung fields.',
        costAmountMinorUnits: 220000,
        requiresConsent: false,
        consentVerified: true,
      },
    ],
    prescriptions: [
      {
        id: 'rx-101',
        medicationCode: 'RX-FUROS-40',
        drugName: 'Furosemide',
        formulation: 'Tablet',
        dosage: '40 mg',
        route: 'Oral',
        frequency: 'OD (Once Daily Morning)',
        durationDays: 14,
        quantity: 14,
        unitPriceMinorUnits: 1500,
        totalAmountMinorUnits: 21000,
        specialInstructions: 'Take with morning meal. Hydrate well.',
        substitutionAllowed: true,
        status: 'PRESCRIBED',
        prescribedAt: Date.now() - 900000,
        prescribedBy: 'Dr. Sarah Jenkins',
        batchAllocation: {
          batchNumber: 'BTH-2026-088',
          expiryDate: '2027-11-30',
          locationBin: 'Shelf B-12',
          quantityAllocated: 14,
          fefoVerified: true,
        },
      },
    ],
    invoice: {
      id: 'inv-101',
      invoiceNumber: 'INV-20260901-001',
      payerTariffPlan: 'CORPORATE_PPO',
      lineItems: [
        { id: 'li-01', serviceCode: 'OPD-CONS-SPEC', description: 'Specialist Cardiology Consultation', category: 'CONSULTATION', quantity: 1, unitPriceMinorUnits: 350000, totalMinorUnits: 350000 },
        { id: 'li-02', serviceCode: 'LAB-BNP-03', description: 'Serum NT-proBNP Quantitative', category: 'LABORATORY', quantity: 1, unitPriceMinorUnits: 450000, totalMinorUnits: 450000 },
        { id: 'li-03', serviceCode: 'RAD-CXR-01', description: 'Chest X-Ray (PA View)', category: 'RADIOLOGY', quantity: 1, unitPriceMinorUnits: 220000, totalMinorUnits: 220000 },
        { id: 'li-04', serviceCode: 'RX-FUROS-40', description: 'Furosemide 40mg (14 Tabs)', category: 'PHARMACY', quantity: 1, unitPriceMinorUnits: 21000, totalMinorUnits: 21000 },
      ],
      totalAmountMinorUnits: 1041000, // PKR 10,410.00
      payerCoverageAmountMinorUnits: 832800, // 80% = PKR 8,328.00
      patientCopayAmountMinorUnits: 208200, // 20% = PKR 2,082.00
      amountPaidMinorUnits: 0,
      balanceDueMinorUnits: 208200,
      settlementStatus: 'PENDING',
      payments: [],
      createdAt: Date.now() - 1000000,
    },
    startedAt: Date.now() - 3600000,
    status: 'IN_CONSULTATION',
  },
];

const SEED_QUEUE: QueueEntry[] = [
  {
    id: 'q-101',
    encounterId: 'enc-101',
    tokenNumber: 'CARD-101',
    patientName: 'Eleanor Vance',
    mrn: 'MRN-20260901-8842',
    department: 'Cardiology',
    assignedRoomOrBay: 'Consultation Room 104',
    assignedDoctorName: 'Dr. Sarah Jenkins',
    triagePriority: 'YELLOW_URGENT',
    status: 'IN_SERVICE',
    issuedAt: Date.now() - 3000000,
    calledAt: Date.now() - 1500000,
  },
  {
    id: 'q-102',
    encounterId: 'enc-102',
    tokenNumber: 'MED-102',
    patientName: 'Tariq Mehmood',
    mrn: 'MRN-20260901-9124',
    department: 'General Medicine',
    assignedRoomOrBay: 'Consultation Room 101',
    assignedDoctorName: 'Dr. Marcus Vance',
    triagePriority: 'GREEN_STANDARD',
    status: 'WAITING',
    issuedAt: Date.now() - 2400000,
  },
];

const SEED_EVENTS: OpdTimelineEvent[] = [
  {
    id: 'evt-01',
    encounterId: 'enc-101',
    eventType: 'PATIENT_REGISTERED',
    timestamp: Date.now() - 3600000,
    actorName: 'Registrar K. Ahmed',
    actorRole: 'RECEPTIONIST',
    description: 'Patient registered under Corporate PPO tariff. Informed consents captured.',
    hash: 'SHA256:8f2a99c4d1e2b3a4',
  },
  {
    id: 'evt-02',
    encounterId: 'enc-101',
    eventType: 'TRIAGE_VITALS_RECORDED',
    timestamp: Date.now() - 2400000,
    actorName: 'Nurse R. Chen',
    actorRole: 'TRIAGE_NURSE',
    description: 'Physiological vitals captured. NEWS2 score = 0 (Low risk). GCS = 15.',
    hash: 'SHA256:1a2b3c4d5e6f7a8b',
  },
  {
    id: 'evt-03',
    encounterId: 'enc-101',
    eventType: 'QUEUE_CALLED',
    timestamp: Date.now() - 1500000,
    actorName: 'Dr. Sarah Jenkins',
    actorRole: 'SPECIALIST_CONSULTANT',
    description: 'Token CARD-101 called to Consultation Room 104.',
    hash: 'SHA256:9c8b7a6f5e4d3c2b',
  },
];

export function OpdMasterWorkspace() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const requestedEncounterId = String(
    searchParams.get('opdEncounterId') || ''
  ).trim();
  const activeRole = useMemo(() => resolveOpdRole(auth.roles), [auth.roles]);
  const normalizedRoles = useMemo(
    () => new Set(auth.roles.map((role) => String(role).trim().toUpperCase())),
    [auth.roles]
  );
  const normalizedPrivileges = useMemo(
    () => new Set(auth.clinicalPrivileges.map((privilege) => String(privilege).trim().toUpperCase())),
    [auth.clinicalPrivileges]
  );
  const isAdministrator = normalizedRoles.has('SYSTEM_ADMIN') || normalizedRoles.has('ADMINISTRATOR') || normalizedRoles.has('ADMIN');
  const canPrescribe = isAdministrator || (
    (normalizedRoles.has('DOCTOR') || normalizedRoles.has('CONSULTANT')) &&
    normalizedPrivileges.has('PRESCRIBE')
  );
  const canDispense = isAdministrator || (
    normalizedRoles.has('PHARMACIST') &&
    normalizedPrivileges.has('DISPENSE_MEDICATION')
  );
  const canSettlePayment =
    isAdministrator ||
    [
      'BILLING_CLERK',
      'BILLING_ADMIN',
      'CASHIER',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'REVENUE_CYCLE',
    ].some((role) => normalizedRoles.has(role));
  const canAccessTab = (tabId: string) =>
    (OPD_TAB_ROLES[tabId] || []).includes(activeRole);

  // Global State
  const [patients, setPatients] = useState<PatientDemographics[]>(() => IS_DEMO_RUNTIME ? SEED_PATIENTS : []);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>(() => IS_DEMO_RUNTIME ? SEED_APPOINTMENTS : []);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<ComprehensiveOpdEncounter[]>(() => IS_DEMO_RUNTIME ? SEED_ENCOUNTERS : []);
  const [queue, setQueue] = useState<QueueEntry[]>(() => IS_DEMO_RUNTIME ? SEED_QUEUE : []);
  const [events, setEvents] = useState<OpdTimelineEvent[]>(() => IS_DEMO_RUNTIME ? SEED_EVENTS : []);
  const [timelineIntegrity, setTimelineIntegrity] =
    useState<OpdTimelineIntegritySummary | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [dashboardSnapshotMeta, setDashboardSnapshotMeta] = useState<{
    source: 'SERVER' | 'LOCAL' | 'DEMO';
    generatedAt: number;
    snapshotVersion: string;
  }>(() => ({
    source: IS_DEMO_RUNTIME ? 'DEMO' : 'LOCAL',
    generatedAt: IS_DEMO_RUNTIME ? Date.now() : 0,
    snapshotVersion: IS_DEMO_RUNTIME ? 'demo' : 'unhydrated',
  }));

  // Active Context
  const [selectedEncounterId, setSelectedEncounterId] = useState<string>(() => IS_DEMO_RUNTIME ? 'enc-101' : '');
  const [activeTab, setActiveTab] = useState<string>('DASHBOARD');
  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    conflictsCount,
    lastError: syncError,
    offlineSimulationActive,
    triggerSync,
    setOfflineSimulation,
  } = useOfflineStatus(auth.activeTenant?.tenantId);
  const [billingReconciliationBusy, setBillingReconciliationBusy] =
    useState<boolean>(false);
  const [billingReconciliationError, setBillingReconciliationError] =
    useState<string | null>(null);
  const offlineWorkflowTail = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (isOnline && pendingSyncCount === 0) {
      offlineWorkflowTail.current.clear();
    }
  }, [isOnline, pendingSyncCount]);

  const refreshAuthoritativeWorkspace = useCallback(async () => {
    if (IS_DEMO_RUNTIME || auth.loading || !auth.activeTenant?.tenantId) return;

    const snapshot = await hydrateEdgeSnapshot(auth.activeTenant.tenantId, {
        surface: 'OPD',
      });
    const readModel = buildOpdWorkspaceReadModel(snapshot);

    setDashboardSnapshotMeta({
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      snapshotVersion: snapshot.snapshotVersion,
    });
    setPatients(readModel.patients);
    setAppointments(readModel.appointments);
    setWaitlist(readModel.waitlist);
    setEncounters(readModel.encounters);
    setQueue(readModel.queue);
    setSelectedEncounterId((current) => {
      if (
        current &&
        readModel.encounters.some((encounter) => encounter.id === current)
      ) {
        return current;
      }
      return readModel.encounters[0]?.id || '';
    });
  }, [
    auth.activeTenant?.tenantId,
    auth.loading,
    auth.user?.uid,
  ]);

  const refreshAuthoritativeTimeline = useCallback(
    async (requestedEncounterId?: string) => {
      if (IS_DEMO_RUNTIME) return;

      const tenantId = auth.activeTenant?.tenantId;
      const encounterId = String(
        requestedEncounterId || selectedEncounterId || ''
      ).trim();
      if (!tenantId || !encounterId) {
        setEvents([]);
        setTimelineIntegrity(null);
        setTimelineError(null);
        return;
      }

      if (!isOnline) {
        setEvents([]);
        setTimelineIntegrity(null);
        setTimelineError(
          'OPD_TIMELINE_ONLINE_REQUIRED: authoritative event and audit provenance is unavailable while offline.'
        );
        return;
      }

      setTimelineLoading(true);
      setTimelineError(null);
      setEvents([]);
      setTimelineIntegrity(null);
      try {
        const result = await fetchAuthoritativeOpdTimeline(
          tenantId,
          encounterId
        );
        setEvents(result.timeline);
        setTimelineIntegrity(result.integrity);
      } catch (error) {
        setEvents([]);
        setTimelineIntegrity(null);
        setTimelineError(
          error instanceof Error
            ? error.message
            : 'Authoritative OPD timeline could not be loaded.'
        );
      } finally {
        setTimelineLoading(false);
      }
    },
    [auth.activeTenant?.tenantId, isOnline, selectedEncounterId]
  );

  useEffect(() => {
    if (IS_DEMO_RUNTIME || auth.loading || !auth.activeTenant?.tenantId) return;

    let cancelled = false;
    void refreshAuthoritativeWorkspace().catch((error) => {
      if (!cancelled) {
        console.error('OPD authoritative hydration failed:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    auth.activeTenant?.tenantId,
    auth.loading,
    auth.user?.uid,
    refreshAuthoritativeWorkspace,
  ]);

  useEffect(() => {
    if (IS_DEMO_RUNTIME || !auth.activeTenant?.tenantId) return;

    const handleSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string }>).detail;
      if (
        detail?.tenantId &&
        detail.tenantId !== auth.activeTenant?.tenantId
      ) {
        return;
      }
      void refreshAuthoritativeWorkspace().catch((error) => {
        console.error('OPD post-sync hydration failed:', error);
      });
      if (activeTab === 'AUDIT' && selectedEncounterId) {
        void refreshAuthoritativeTimeline(selectedEncounterId);
      }
    };

    window.addEventListener('ghims:edge-sync-complete', handleSyncComplete);
    return () => {
      window.removeEventListener(
        'ghims:edge-sync-complete',
        handleSyncComplete
      );
    };
  }, [
    activeTab,
    auth.activeTenant?.tenantId,
    refreshAuthoritativeTimeline,
    refreshAuthoritativeWorkspace,
    selectedEncounterId,
  ]);

  useEffect(() => {
    if (
      IS_DEMO_RUNTIME ||
      activeTab !== 'AUDIT' ||
      !selectedEncounterId
    ) {
      return;
    }

    void refreshAuthoritativeTimeline(selectedEncounterId);
  }, [
    activeTab,
    refreshAuthoritativeTimeline,
    selectedEncounterId,
  ]);

  // Selected encounter object
  useEffect(() => {
    if (!requestedEncounterId) return;
    if (!encounters.some((encounter) => encounter.id === requestedEncounterId)) {
      return;
    }
    setSelectedEncounterId(requestedEncounterId);
  }, [encounters, requestedEncounterId]);

  const activeEncounter = useMemo(() => {
    return encounters.find((e) => e.id === selectedEncounterId) || encounters[0];
  }, [encounters, selectedEncounterId]);

  const activeBillingInvoice = useMemo(() => {
    if (!activeEncounter) return undefined;

    if (
      activeEncounter.consultationInvoice &&
      activeEncounter.consultationInvoice.settlementStatus !== 'SETTLED'
    ) {
      return activeEncounter.consultationInvoice;
    }

    const openDiagnosticInvoice = (activeEncounter.diagnosticInvoices || []).find(
      (invoice) =>
        invoice.billingPurpose === 'OPD_DIAGNOSTIC' &&
        invoice.settlementStatus !== 'SETTLED' &&
        invoice.settlementStatus !== 'VOIDED'
    );
    if (openDiagnosticInvoice) return openDiagnosticInvoice;

    const openPharmacyInvoice = (activeEncounter.pharmacyInvoices || []).find(
      (invoice) =>
        invoice.billingPurpose === 'OPD_PHARMACY' &&
        invoice.settlementStatus !== 'SETTLED' &&
        invoice.settlementStatus !== 'VOIDED'
    );
    if (openPharmacyInvoice) return openPharmacyInvoice;

    const openSupplementalInvoice = (
      activeEncounter.supplementalInvoices || []
    ).find(
      (invoice) =>
        invoice.billingPurpose === 'OPD_REVENUE_INTEGRITY' &&
        invoice.settlementStatus !== 'SETTLED' &&
        invoice.settlementStatus !== 'VOIDED'
    );
    if (openSupplementalInvoice) return openSupplementalInvoice;

    return IS_DEMO_RUNTIME ? activeEncounter.invoice : undefined;
  }, [activeEncounter]);

  const requireOnlineOpdAuthority = useCallback(
    (operation: string) => {
      if (!isOnline) {
        throw new Error(
          `OPD_ONLINE_AUTHORITY_REQUIRED: ${operation} requires live server authority and cannot be committed from an offline replica.`
        );
      }
    },
    [isOnline]
  );

  // DEMO-only visual event helper. Production audit events are server-generated.
  const recordEvent = (eventType: any, description: string, payload?: any) => {
    if (!IS_DEMO_RUNTIME) return;
    const newEvt: OpdTimelineEvent = {
      id: `evt-${Date.now()}`,
      encounterId: activeEncounter?.id || 'enc-general',
      eventType,
      timestamp: Date.now(),
      actorName:
        activeRole === 'RECEPTIONIST'
          ? 'Registrar K. Ahmed'
          : activeRole === 'TRIAGE_NURSE'
          ? 'Nurse R. Chen'
          : activeRole === 'PHARMACIST'
          ? 'Pharm. Tariq Bilal'
          : activeRole === 'BILLING_CASHIER'
          ? 'Cashier Bilal Malik'
          : 'Dr. Sarah Jenkins',
      actorRole: activeRole,
      description,
      payload,
      hash: 'DEMO-NON-AUTHORITATIVE',
    };
    setEvents((prev) => [newEvt, ...prev]);
  };

  // HANDLER: Register new patient and start encounter through the
  // authoritative registration orchestrator. React state below is a read-model cache only.
  const handleRegisterSuccess = async (newPatient: PatientDemographics) => {
    if (newPatient.tariffPlan !== 'OUT_OF_POCKET') {
      throw new Error(
        'OPD_PILOT_PAYER_NOT_SUPPORTED: controlled OPD registration currently supports OUT_OF_POCKET only.'
      );
    }
    const registrationTariffPlan: 'OUT_OF_POCKET' = newPatient.tariffPlan;

    const registration = await registerActiveTenantPatient<{
      patient: {
        id: string;
        tenantId: string;
        mrn: string;
        fullName: string;
        gender: string;
        dateOfBirth: string;
      };
      encounter: {
        id: string;
        department: string;
        chiefComplaint: string;
      };
      queuedOffline?: boolean;
      consultationInvoicePendingSync?: boolean;
      localConsultationInvoiceId?: string;
      queueToken: {
        id: string;
        encounterId: string;
        tokenNumber: string;
        department: string;
        priority: string;
        status: string;
        createdAt: number;
      };
    }>({
      fullName: newPatient.fullName,
      dateOfBirth: newPatient.dob,
      gender: newPatient.gender,
      contactPhone: newPatient.phone,
      address: newPatient.residentialAddress,
      bloodGroup: newPatient.bloodGroup,
      identifiers: [
        ...(newPatient.nationalId
          ? [{ type: 'CNIC', value: newPatient.nationalId, issuer: 'National Registry' }]
          : []),
        ...(newPatient.phone
          ? [{ type: 'PHONE', value: newPatient.phone, issuer: 'Telecom' }]
          : []),
      ],
      ...(newPatient.knownAllergies
        ? { allergies: newPatient.knownAllergies }
        : {}),
      ...(newPatient.chronicConditions
        ? { chronicConditions: newPatient.chronicConditions }
        : {}),
      tariffPlan: registrationTariffPlan,
      insuranceDetails: newPatient.insuranceDetails,
      consentDecisions: newPatient.registrationConsentDecisions,
      encounterType: 'OPD',
      department: 'General Medicine',
      priority: 'ROUTINE',
      chiefComplaint: 'New outpatient registration',
    });

    const authoritativePatient: PatientDemographics = {
      ...newPatient,
      id: registration.patient.id,
      mrn: registration.patient.mrn,
      fullName: registration.patient.fullName,
      dob: registration.patient.dateOfBirth,
      createdAt: Date.now(),
    };

    const tokenNum = registration.queueToken.tokenNumber;
    const newEncId = registration.encounter.id;

    const offlineRegistration = registration.queuedOffline === true;
    let consultationInvoice: OpdInvoice | undefined;

    if (!offlineRegistration) {
      const consultationBilling = await executeActiveTenantCommand<{
        invoice: Record<string, any>;
      }>(
        'CreateOpdConsultationInvoiceCommand',
        { encounterId: newEncId },
        { idempotencyKey: `opd-consultation-invoice:${newEncId}` }
      );
      if (!consultationBilling.success || !consultationBilling.data?.invoice) {
        throw new Error(
          consultationBilling.error?.message ||
            'Authoritative consultation invoice creation failed. The patient is registered, but OPD service remains blocked until billing configuration is corrected.'
        );
      }
      consultationInvoice = adaptAuthoritativeConsultationInvoice(
        consultationBilling.data.invoice
      );
    }
    const newEncounter: ComprehensiveOpdEncounter = {
      id: newEncId,
      tenantId: registration.patient.tenantId,
      patientId: authoritativePatient.id,
      mrn: authoritativePatient.mrn,
      patientName: authoritativePatient.fullName,
      gender: authoritativePatient.gender,
      age: authoritativePatient.age,
      tariffPlan: authoritativePatient.tariffPlan,
      insuranceDetails: authoritativePatient.insuranceDetails,
      knownAllergies: authoritativePatient.knownAllergies,
      tokenNumber: tokenNum,
      encounterType: 'OPD_ROUTINE',
      department: registration.queueToken.department || 'General Medicine',
      currentStage: 'REGISTRATION',
      stageProgress: {
        REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now(), completedAt: Date.now(), completedBy: 'Server Registration Orchestrator' },
        BILLING_AUTHORIZATION: offlineRegistration
          ? { status: 'PENDING' }
          : { status: 'ACTIVE', enteredAt: Date.now() },
        QUEUE_ASSIGNMENT: { status: 'PENDING' },
        NURSING_INTAKE: { status: 'PENDING' },
        MO_ASSESSMENT: { status: 'PENDING' },
        SPECIALTY_CONSULTATION: { status: 'PENDING' },
        DIAGNOSTIC_ORDERS: { status: 'PENDING' },
        PHARMACY_FEFO: { status: 'PENDING' },
        BILLING_SETTLEMENT: { status: 'PENDING' },
        DISPOSITION_CLOSURE: { status: 'PENDING' },
        TIMELINE_AUDIT: { status: 'PENDING' },
      },
      diagnosticOrders: [],
      prescriptions: [],
      ...(consultationInvoice ? { consultationInvoice } : {}),
      startedAt: Date.now(),
      status: 'REGISTERED',
    };

    const newQueueEntry: QueueEntry = {
      id: registration.queueToken.id,
      encounterId: registration.queueToken.encounterId,
      tokenNumber: tokenNum,
      patientName: authoritativePatient.fullName,
      mrn: authoritativePatient.mrn,
      department: registration.queueToken.department,
      assignedRoomOrBay: 'UNASSIGNED',
      triagePriority: String(registration.queueToken.priority || 'routine').toUpperCase(),
      status: 'PAYMENT_PENDING',
      issuedAt: registration.queueToken.createdAt || Date.now(),
    };

    setPatients((prev) => [authoritativePatient, ...prev.filter((p) => p.id !== authoritativePatient.id)]);
    setEncounters((prev) => [newEncounter, ...prev.filter((e) => e.id !== newEncounter.id)]);
    setQueue((prev) => [newQueueEntry, ...prev.filter((q) => q.id !== newQueueEntry.id)]);
    setSelectedEncounterId(newEncId);
    recordEvent(
      'PATIENT_REGISTERED',
      offlineRegistration
        ? `Patient ${authoritativePatient.fullName} captured offline. Registration and consultation billing are pending authoritative sync; token ${tokenNum} cannot enter the clinical queue until payment is cleared.`
        : `Patient ${authoritativePatient.fullName} registered. Token ${tokenNum} issued.`
    );
    setActiveTab('DASHBOARD');
  };

  const handleBookAppointment = async (input: {
    patientId: string;
    providerEmployeeId: string;
    facilityId: string;
    departmentId: string;
    appointmentType: AppointmentRecord['appointmentType'];
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    chiefComplaint: string;
    bookingChannel: string;
  }) => {
    requireOnlineOpdAuthority('appointment booking');
    const result = await executeActiveTenantCommand(
      'BookOpdAppointmentCommand',
      input,
      {
        idempotencyKey:
          `opd-appt-book:${input.patientId}:${input.providerEmployeeId}:${input.scheduledStartAt}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Appointment booking failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleCheckInAppointment = async (appt: AppointmentRecord) => {
    requireOnlineOpdAuthority('appointment check-in');
    const result = await executeActiveTenantCommand<{
      appointment: Record<string, any>;
      encounter: {
        encounterId: string;
        tenantId: string;
      };
      queueToken: {
        id: string;
        encounterId: string;
        tokenNumber: string;
        department: string;
        priority: string;
        createdAt: number;
      };
    }>(
      'CheckInOpdAppointmentCommand',
      { appointmentId: appt.id },
      { idempotencyKey: `opd-appt-checkin:${appt.id}` }
    );

    if (!result.success || !result.data?.encounter?.encounterId) {
      throw new Error(result.error?.message || 'Appointment check-in failed.');
    }

    const newEncId = result.data.encounter.encounterId;
    const consultationBilling = await executeActiveTenantCommand<{
      invoice: Record<string, any>;
    }>(
      'CreateOpdConsultationInvoiceCommand',
      { encounterId: newEncId },
      { idempotencyKey: `opd-consultation-invoice:${newEncId}` }
    );

    await refreshAuthoritativeWorkspace();
    setSelectedEncounterId(newEncId);
    setActiveTab('BILLING');

    if (!consultationBilling.success || !consultationBilling.data?.invoice) {
      throw new Error(
        consultationBilling.error?.message ||
          'Appointment is checked in, but consultation invoice creation failed. Retry billing creation before clinical queue release.'
      );
    }
  };

  const handleResumeAppointmentBilling = async (
    appt: AppointmentRecord
  ) => {
    requireOnlineOpdAuthority('appointment billing recovery');
    const encounterId = String(appt.encounterId || '').trim();
    if (!encounterId) {
      throw new Error(
        'APPOINTMENT_ENCOUNTER_LINK_REQUIRED: checked-in appointment is missing its authoritative encounter linkage.'
      );
    }

    const consultationBilling = await executeActiveTenantCommand<{
      invoice: Record<string, any>;
    }>(
      'CreateOpdConsultationInvoiceCommand',
      { encounterId },
      { idempotencyKey: `opd-consultation-invoice:${encounterId}` }
    );

    if (
      !consultationBilling.success &&
      consultationBilling.error?.code !==
        'OPD_CONSULTATION_INVOICE_ALREADY_EXISTS'
    ) {
      throw new Error(
        consultationBilling.error?.message ||
          'Consultation invoice recovery failed.'
      );
    }

    await refreshAuthoritativeWorkspace();
    setSelectedEncounterId(encounterId);
    setActiveTab('BILLING');
  };

  const handleCancelAppointment = async (
    appointmentId: string,
    reason: string
  ) => {
    requireOnlineOpdAuthority('appointment cancellation');
    const result = await executeActiveTenantCommand(
      'CancelOpdAppointmentCommand',
      { appointmentId, reason },
      { idempotencyKey: `opd-appt-cancel:${appointmentId}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Appointment cancellation failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleRescheduleAppointment = async (input: {
    appointmentId: string;
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    reason: string;
  }) => {
    requireOnlineOpdAuthority('appointment rescheduling');
    const result = await executeActiveTenantCommand(
      'RescheduleOpdAppointmentCommand',
      input,
      {
        idempotencyKey:
          `opd-appt-reschedule:${input.appointmentId}:${input.scheduledStartAt}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Appointment reschedule failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleMarkAppointmentNoShow = async (
    appointmentId: string,
    reason: string
  ) => {
    requireOnlineOpdAuthority('appointment no-show mutation');
    const result = await executeActiveTenantCommand(
      'MarkOpdAppointmentNoShowCommand',
      { appointmentId, reason },
      { idempotencyKey: `opd-appt-noshow:${appointmentId}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'No-show update failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleAddWaitlistEntry = async (input: {
    patientId: string;
    facilityId: string;
    preferredDepartmentId: string;
    preferredProviderEmployeeId?: string;
    priority: 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';
    notificationPreference: 'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL';
    notes?: string;
  }) => {
    requireOnlineOpdAuthority('waitlist creation');
    const result = await executeActiveTenantCommand(
      'AddOpdWaitlistEntryCommand',
      input,
      {
        idempotencyKey:
          `opd-waitlist-add:${input.patientId}:${input.facilityId}:${input.preferredDepartmentId}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Waitlist creation failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleOfferWaitlistSlot = async (input: {
    waitlistId: string;
    providerEmployeeId: string;
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    offerTtlMinutes?: number;
  }) => {
    requireOnlineOpdAuthority('waitlist slot offer');
    const result = await executeActiveTenantCommand(
      'OfferOpdWaitlistSlotCommand',
      input,
      {
        idempotencyKey:
          `opd-waitlist-offer:${input.waitlistId}:${input.providerEmployeeId}:${input.scheduledStartAt}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Waitlist slot offer failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleAcceptWaitlistSlot = async (input: {
    waitlistId: string;
    appointmentType: AppointmentRecord['appointmentType'];
    chiefComplaint: string;
    bookingChannel?: string;
  }) => {
    requireOnlineOpdAuthority('waitlist acceptance');
    const result = await executeActiveTenantCommand(
      'AcceptOpdWaitlistOfferCommand',
      input,
      {
        idempotencyKey: `opd-waitlist-accept:${input.waitlistId}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Waitlist acceptance failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  const handleCancelWaitlistEntry = async (
    waitlistId: string,
    reason: string
  ) => {
    requireOnlineOpdAuthority('waitlist cancellation');
    const result = await executeActiveTenantCommand(
      'CancelOpdWaitlistEntryCommand',
      { waitlistId, reason },
      { idempotencyKey: `opd-waitlist-cancel:${waitlistId}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Waitlist cancellation failed.');
    }
    await refreshAuthoritativeWorkspace();
  };

  // HANDLER: Save Triage Vitals through authoritative encounter evidence.
  // The evidence and its dependent stage transition are both replayable offline.
  // A local evidence reference is deliberately used when the write is queued;
  // the reconciliation service remaps it to the canonical evidence ID before
  // replaying AdvanceStageCommand.
  const handleSaveVitals = async (vitals: ComprehensiveVitals) => {
    const localEvidenceId = `vitals-${activeEncounter.id}-${vitals.measuredAt}`;
    const vitalsResult = await executeActiveTenantCommand<Record<string, unknown>>(
      'RecordVitalsCommand',
      {
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        heartRate: vitals.heartRate,
        bloodPressure: `${vitals.systolicBp}/${vitals.diastolicBp}`,
        temperature: vitals.temperatureCelsius,
        respiratoryRate: vitals.respiratoryRate,
        oxygenSaturation: vitals.spo2Percent,
        spO2Scale: vitals.spO2Scale,
        onSupplementalOxygen: vitals.onSupplementalOxygen,
        gcsScore: vitals.gcsScore,
        consciousness:
          vitals.consciousnessAvpu === 'ALERT'
            ? 'Alert'
            : vitals.consciousnessAvpu === 'VOICE'
              ? 'Voice'
              : vitals.consciousnessAvpu === 'PAIN'
                ? 'Pain'
                : vitals.consciousnessAvpu === 'UNRESPONSIVE'
                  ? 'Unresponsive'
                  : undefined,
        measuredAt: vitals.measuredAt,
      },
      {
        idempotencyKey: `opd-vitals:${activeEncounter.id}:${vitals.measuredAt}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounterEvidence',
          resourceId: localEvidenceId,
          action: 'CREATE',
          dependsOnMutationIds: offlineWorkflowTail.current.get(activeEncounter.id)
            ? [offlineWorkflowTail.current.get(activeEncounter.id)!]
            : undefined,
          optimisticCache: true,
        },
      }
    );
    if (!vitalsResult.success) {
      throw new Error(vitalsResult.error?.message || 'Vitals recording failed.');
    }

    const transition = await executeActiveTenantCommand(
      'AdvanceStageCommand',
      {
        encounterId: activeEncounter.id,
        currentStage: activeEncounter.currentStage || 'TRIAGE',
        targetStage: 'CONSULTATION',
        evidenceId: vitalsResult.entityId || localEvidenceId,
      },
      {
        idempotencyKey: `opd-stage-triage-consult:${activeEncounter.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounters',
          resourceId: activeEncounter.id,
          action: 'UPDATE',
          dependsOnMutationIds: vitalsResult.queuedOffline
            ? [vitalsResult.commandId]
            : undefined,
          optimisticCache: true,
          optimisticPayload: {
            currentStage: 'CONSULTATION',
            offlineStagePendingSync: true,
            offlinePendingTargetStage: 'CONSULTATION',
          },
        },
      }
    );
    if (!transition.success) {
      throw new Error(
        transition.error?.message ||
          'Clinical workflow runtime blocked transition from triage to consultation.'
      );
    }
    if (transition.queuedOffline) {
      offlineWorkflowTail.current.set(activeEncounter.id, transition.commandId);
    }

    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? {
              ...e,
              vitalsAssessment: vitals,
              currentStage: 'SPECIALTY_CONSULTATION',
              status: 'IN_CONSULTATION',
              stageProgress: {
                ...e.stageProgress,
                NURSING_INTAKE: {
                  status: 'COMPLETED',
                  enteredAt: Date.now() - 600000,
                  completedAt: Date.now(),
                  completedBy: 'Authoritative Clinical Documentation',
                },
                SPECIALTY_CONSULTATION: { status: 'ACTIVE', enteredAt: Date.now() },
              },
            }
          : e
      )
    );
    recordEvent('TRIAGE_VITALS_RECORDED', `Vitals committed for encounter ${activeEncounter.id}.`, vitals);
    setActiveTab('CONSULTATION');
  };

  // HANDLER: Save Consultation SOAP as signed encounter evidence.
  // As with triage, offline replay preserves ordering by queueing the evidence
  // before the dependent DAG transition and remapping the local evidence ID.
  const handleSaveConsultation = async (soap: SoapDocumentation) => {
    const noteContent = [
      `Subjective: ${soap.subjective || ''}`,
      `Objective: ${soap.objective || ''}`,
      `Assessment: ${soap.assessment || ''}`,
      `Plan: ${soap.plan || ''}`,
    ].join('\n\n');
    const noteTimestamp = soap.completedAt || Date.now();
    const localEvidenceId = `soap-${activeEncounter.id}-${noteTimestamp}`;

    const noteResult = await executeActiveTenantCommand<Record<string, unknown>>(
      'SignClinicalNoteCommand',
      {
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        category: 'SOAP',
        content: noteContent,
        acceptedStructuredData: {
          diagnoses: soap.diagnoses || [],
          specialtyTemplate: soap.specialtyTemplate,
          specialtyData: soap.specialtyData || soap.specialtySpecificData,
        },
      },
      {
        idempotencyKey: `opd-soap:${activeEncounter.id}:${noteTimestamp}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounterEvidence',
          resourceId: localEvidenceId,
          action: 'CREATE',
          dependsOnMutationIds: offlineWorkflowTail.current.get(activeEncounter.id)
            ? [offlineWorkflowTail.current.get(activeEncounter.id)!]
            : undefined,
          optimisticCache: true,
        },
      }
    );
    if (!noteResult.success) {
      throw new Error(noteResult.error?.message || 'Clinical note signing failed.');
    }

    const transition = await executeActiveTenantCommand(
      'AdvanceStageCommand',
      {
        encounterId: activeEncounter.id,
        currentStage: activeEncounter.currentStage || 'CONSULTATION',
        targetStage: 'DIAGNOSTICS',
        evidenceId: noteResult.entityId || localEvidenceId,
      },
      {
        idempotencyKey: `opd-stage-consult-diagnostics:${activeEncounter.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounters',
          resourceId: activeEncounter.id,
          action: 'UPDATE',
          dependsOnMutationIds: noteResult.queuedOffline
            ? [noteResult.commandId]
            : undefined,
          optimisticCache: true,
          optimisticPayload: {
            currentStage: 'DIAGNOSTICS',
            offlineStagePendingSync: true,
            offlinePendingTargetStage: 'DIAGNOSTICS',
          },
        },
      }
    );
    if (!transition.success) {
      throw new Error(
        transition.error?.message ||
          'Clinical workflow runtime blocked transition from consultation to diagnostics.'
      );
    }
    if (transition.queuedOffline) {
      offlineWorkflowTail.current.set(activeEncounter.id, transition.commandId);
    }

    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? {
              ...e,
              soap,
              currentStage: 'DIAGNOSTIC_ORDERS',
              stageProgress: {
                ...e.stageProgress,
                SPECIALTY_CONSULTATION: {
                  status: 'COMPLETED',
                  enteredAt: Date.now() - 1200000,
                  completedAt: Date.now(),
                  completedBy: 'Signed Clinical Evidence',
                },
                DIAGNOSTIC_ORDERS: { status: 'ACTIVE', enteredAt: Date.now() },
              },
            }
          : e
      )
    );
    recordEvent('CONSULTATION_COMMITTED', `Signed SOAP evidence ${noteResult.entityId || ''}.`, soap);
    setActiveTab('DIAGNOSTICS');
  };

  // HANDLER: Add Diagnostic Order through the authoritative clinical/financial domain.
  // The client supplies clinical intent and a catalog identity only. Price,
  // specimen identity, invoice, AR and GL state are all server-owned.
  const handleAddDiagnosticOrder = async (order: DiagnosticOrderItem) => {
    const requestedUrgency = String(order.urgency || '').toUpperCase();
    if (!isOnline && requestedUrgency.includes('STAT')) {
      throw new Error(
        'STAT_DIAGNOSTIC_REQUIRES_ONLINE_AUTHORITY: emergency diagnostic payment override and immediate worklist dispatch require live server authority.'
      );
    }

    const category = String(order.type || order.category || '').toUpperCase();
    const orderType =
      category === 'RADIOLOGY'
        ? 'RADIOLOGY'
        : category === 'PROCEDURE'
          ? 'PROCEDURE'
          : 'LAB';

    const orderResult = await executeActiveTenantCommand<{
      order: Record<string, any>;
      invoice: Record<string, any>;
    }>(
      'PlaceDiagnosticOrderCommand',
      {
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        orderType,
        catalogCode: order.testCode || order.code || order.id,
        priority:
          String(order.urgency || '').toUpperCase().includes('STAT')
            ? 'STAT'
            : String(order.urgency || '').toUpperCase() === 'URGENT'
              ? 'URGENT'
              : 'ROUTINE',
        clinicalIndication:
          order.clinicalIndication ||
          order.reasonForOrder ||
          'Clinical evaluation',
        ...(String(order.urgency || '').toUpperCase().includes('STAT') &&
        order.statOverrideReason
          ? { statOverrideReason: order.statOverrideReason }
          : {}),
      },
      {
        idempotencyKey: `opd-diagnostic:${activeEncounter.id}:${order.id}`,
        ...(requestedUrgency.includes('STAT')
          ? {}
          : {
              offlineQueue: {
                enabled: true,
                collection: 'orders',
                resourceId: order.id,
                action: 'CREATE' as const,
                dependsOnMutationIds: offlineWorkflowTail.current.get(
                  activeEncounter.id
                )
                  ? [offlineWorkflowTail.current.get(activeEncounter.id)!]
                  : undefined,
                optimisticCache: true,
                optimisticPayload: {
                  encounterId: activeEncounter.id,
                  patientId: activeEncounter.patientId,
                  orderType,
                  catalogCode: order.testCode || order.code || order.id,
                  orderName: order.testName,
                  clinicalIndication:
                    order.clinicalIndication ||
                    order.reasonForOrder ||
                    'Clinical evaluation',
                  priority:
                    requestedUrgency === 'URGENT' ? 'URGENT' : 'ROUTINE',
                  revenueLockStatus: 'PENDING_SERVER_REPLAY',
                  paymentStatus: 'LOCKED_PENDING_PAYMENT',
                  worklistStatus: 'OFFLINE_PENDING_SYNC',
                  status: 'ORDERED',
                  createdAt: order.orderedAt || Date.now(),
                },
              },
            }),
      }
    );

    if (orderResult.queuedOffline) {
      const pendingOrder: DiagnosticOrderItem = {
        ...order,
        id: order.id,
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        revenueLockStatus: 'PENDING_SERVER_REPLAY',
        paymentStatus: 'LOCKED_PENDING_PAYMENT',
        worklistStatus: 'OFFLINE_PENDING_SYNC',
        orderedBy: 'PENDING_SERVER_SYNC',
        orderedAt: order.orderedAt || Date.now(),
        status: 'ORDERED',
      };

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                diagnosticOrders: [
                  ...encounter.diagnosticOrders.filter(
                    (existing) => existing.id !== pendingOrder.id
                  ),
                  pendingOrder,
                ],
              }
            : encounter
        )
      );
      offlineWorkflowTail.current.set(
        activeEncounter.id,
        orderResult.commandId
      );
      recordEvent(
        'DIAGNOSTIC_ORDERED',
        `Diagnostic intent ${pendingOrder.testName} captured offline. Pricing, invoice creation, payment gate and worklist release remain pending authoritative server replay.`,
        pendingOrder
      );
      return;
    }

    if (!orderResult.success || !orderResult.data?.order || !orderResult.data?.invoice) {
      throw new Error(orderResult.error?.message || 'Diagnostic order failed.');
    }

    const authoritative = orderResult.data.order;
    const governedOrder: DiagnosticOrderItem = {
      ...order,
      id: String(authoritative.orderId || orderResult.entityId || order.id),
      encounterId: String(authoritative.encounterId || activeEncounter.id),
      patientId: String(authoritative.patientId || activeEncounter.patientId),
      type:
        String(authoritative.orderType || '').toUpperCase() === 'RADIOLOGY'
          ? 'RADIOLOGY'
          : String(authoritative.orderType || '').toUpperCase() === 'PROCEDURE'
            ? 'PROCEDURE'
            : 'LABORATORY',
      category:
        String(authoritative.orderType || '').toUpperCase() === 'RADIOLOGY'
          ? 'RADIOLOGY'
          : String(authoritative.orderType || '').toUpperCase() === 'PROCEDURE'
            ? 'PROCEDURE'
            : 'LABORATORY',
      testCode: String(authoritative.catalogCode || order.testCode || ''),
      testName: String(authoritative.orderName || order.testName || ''),
      clinicalIndication: String(
        authoritative.clinicalIndication || order.clinicalIndication || ''
      ),
      reasonForOrder: String(
        authoritative.clinicalIndication || order.reasonForOrder || ''
      ),
      costAmountMinorUnits: Number(authoritative.costMinorUnits || 0),
      currency: String(authoritative.currency || ''),
      billingInvoiceId: String(authoritative.billingInvoiceId || ''),
      chargeId: String(authoritative.chargeId || ''),
      revenueLockStatus: String(authoritative.revenueLockStatus || ''),
      paymentStatus:
        String(authoritative.revenueLockStatus || '') === 'PAID_SETTLED'
          ? 'PAID_SETTLED'
          : 'LOCKED_PENDING_PAYMENT',
      worklistStatus: String(authoritative.worklistStatus || ''),
      specimenType: authoritative.specimenType
        ? String(authoritative.specimenType)
        : undefined,
      specimenBarcode: authoritative.specimenBarcode
        ? String(authoritative.specimenBarcode)
        : undefined,
      orderedBy: String(authoritative.orderedBy || ''),
      orderedAt: Number(authoritative.createdAt || Date.now()),
      status: 'ORDERED',
    };
    const diagnosticInvoice = adaptAuthoritativeOpdInvoice(
      orderResult.data.invoice
    );

    setEncounters((prev) =>
      prev.map((encounter) =>
        encounter.id === activeEncounter.id
          ? {
              ...encounter,
              diagnosticOrders: [
                ...encounter.diagnosticOrders.filter(
                  (existing) => existing.id !== governedOrder.id
                ),
                governedOrder,
              ],
              diagnosticInvoices: [
                ...(encounter.diagnosticInvoices || []).filter(
                  (invoice) => invoice.id !== diagnosticInvoice.id
                ),
                diagnosticInvoice,
              ],
            }
          : encounter
      )
    );

    recordEvent(
      'DIAGNOSTIC_ORDERED',
      governedOrder.revenueLockStatus === 'UNLOCKED_STAT_OVERRIDE'
        ? `STAT diagnostic order ${governedOrder.testName} dispatched under audited emergency override.`
        : `Diagnostic order ${governedOrder.testName} created and locked pending cashier settlement.`,
      governedOrder
    );
  };

  const handleAdvanceDiagnosticWorklist = async (
    orderId: string,
    targetStatus: 'SPECIMEN_COLLECTED' | 'IN_PROCESSING'
  ) => {
    const result = await executeActiveTenantCommand<Record<string, any>>(
      'AdvanceDiagnosticWorklistCommand',
      { orderId, targetStatus },
      {
        idempotencyKey: `opd-diagnostic-work:${orderId}:${targetStatus}`,
        offlineQueue: {
          enabled: true,
          collection: 'orders',
          resourceId: orderId,
          action: 'UPDATE',
          optimisticCache: true,
          optimisticPayload: {
            worklistStatus: `${targetStatus}_PENDING_SYNC`,
            status:
              targetStatus === 'SPECIMEN_COLLECTED'
                ? 'COLLECTED'
                : 'PROCESSING',
          },
        },
      }
    );

    if (result.queuedOffline) {
      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                diagnosticOrders: encounter.diagnosticOrders.map((existing) =>
                  existing.id === orderId
                    ? {
                        ...existing,
                        worklistStatus: `${targetStatus}_PENDING_SYNC`,
                        status:
                          targetStatus === 'SPECIMEN_COLLECTED'
                            ? 'COLLECTED'
                            : 'PROCESSING',
                      }
                    : existing
                ),
              }
            : encounter
        )
      );
      recordEvent(
        'DIAGNOSTIC_STATUS_UPDATED',
        `Diagnostic worklist action ${targetStatus} captured offline for ${orderId}; server replay may still require conflict review.`
      );
      return;
    }

    if (!result.success || !result.data) {
      throw new Error(
        result.error?.message || 'Diagnostic worklist transition failed.'
      );
    }

    const authoritative = result.data;
    setEncounters((prev) =>
      prev.map((encounter) =>
        encounter.id === activeEncounter.id
          ? {
              ...encounter,
              diagnosticOrders: encounter.diagnosticOrders.map((existing) =>
                existing.id === orderId
                  ? {
                      ...existing,
                      revenueLockStatus: String(
                        authoritative.revenueLockStatus ||
                          existing.revenueLockStatus ||
                          ''
                      ),
                      worklistStatus: String(
                        authoritative.worklistStatus ||
                          existing.worklistStatus ||
                          ''
                      ),
                      status:
                        String(authoritative.worklistStatus || '') ===
                        'SPECIMEN_COLLECTED'
                          ? 'COLLECTED'
                          : String(authoritative.worklistStatus || '') ===
                              'IN_PROCESSING'
                            ? 'PROCESSING'
                            : existing.status,
                    }
                  : existing
              ),
            }
          : encounter
      )
    );
  };

  // HANDLER: Add Prescription Item through credential-gated prescribing.
  const handleAddPrescription = async (
    item: PharmacyPrescriptionItem,
    safety?: {
      safetyAcknowledgementFindingIds?: string[];
      safetyOverrideReason?: string;
    }
  ) => {
    requireOnlineOpdAuthority('medication prescribing safety evaluation');
    try {
      const result = await executeActiveTenantCommand<Record<string, any>>(
        'PrescribeMedicationCommand',
        {
          encounterId: activeEncounter.id,
          patientId: activeEncounter.patientId,
          drugCode: item.medicationCode || item.id,
          dosage: item.dosage,
          route: item.route,
          frequency: item.frequency,
          durationDays: item.durationDays,
          quantityPrescribed: item.quantity || item.quantityPrescribed,
          unitOfMeasure: item.formulation || 'UNIT',
          instructions: item.instructions || item.specialInstructions,
          safetyAcknowledgementFindingIds:
            safety?.safetyAcknowledgementFindingIds,
          safetyOverrideReason: safety?.safetyOverrideReason,
        },
        {
          // Financially relevant medication ordering fails closed offline until
          // RP15 qualifies command replay/remapping.
          idempotencyKey: `opd-rx:${activeEncounter.id}:${item.id}`,
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Prescription failed.');
      }

      const authoritative = result.data || {};
      const governedPrescription: PharmacyPrescriptionItem = {
        ...item,
        id: String(
          authoritative.prescriptionId || result.entityId || item.id
        ),
        encounterId: String(
          authoritative.encounterId || activeEncounter.id
        ),
        medicationCode: String(
          authoritative.drugCode || item.medicationCode || ''
        ),
        drugName: String(authoritative.drugName || ''),
        dosage: String(authoritative.dosage || item.dosage),
        route: String(authoritative.route || item.route),
        frequency: String(authoritative.frequency || item.frequency),
        durationDays: Number(
          authoritative.durationDays || item.durationDays
        ),
        quantity: Number(
          authoritative.quantityPrescribed ||
            item.quantity ||
            item.quantityPrescribed ||
            0
        ),
        quantityPrescribed: Number(
          authoritative.quantityPrescribed ||
            item.quantityPrescribed ||
            item.quantity ||
            0
        ),
        formulation: String(
          authoritative.unitOfMeasure || item.formulation || ''
        ),
        status: 'PRESCRIBED',
        prescribedBy: String(
          authoritative.prescribedBy || item.prescribedBy || ''
        ),
        prescribedAt: Number(
          authoritative.createdAt || item.prescribedAt || Date.now()
        ),
      };
      setEncounters((prev) =>
        prev.map((e) =>
          e.id === activeEncounter.id
            ? { ...e, prescriptions: [...e.prescriptions, governedPrescription] }
            : e
        )
      );
      recordEvent('PRESCRIPTION_ISSUED', `Prescription ${governedPrescription.id} committed.`, governedPrescription);
    } catch (rxError) {
      console.warn('[OpdMasterWorkspace] PrescribeMedication error handled:', rxError);
      throw rxError;
    }
  };

  // HANDLER: Dispense Prescription through the pharmacy domain.
  // CI-0D will extend this command to atomic inventory/consumption charging.
  const handleDispensePrescription = async (rxId: string) => {
    requireOnlineOpdAuthority('physical FEFO pharmacy dispensing');
    const prescription = activeEncounter.prescriptions.find((rx) => rx.id === rxId);
    if (!prescription) throw new Error('PRESCRIPTION_NOT_FOUND');

    const result = await executeActiveTenantCommand(
      'DispensePrescriptionCommand',
      {
        prescriptionId: rxId,
        quantityDispensed: prescription.quantity || prescription.quantityPrescribed || 1,
        batchNumber: prescription.batchAllocation?.batchNumber || prescription.allocatedBatch?.batchNumber,
        expiryDate:
          prescription.batchAllocation?.expiryDate ||
          prescription.allocatedBatch?.expiryDate,
      },
      {
        // Inventory + patient billing is atomic and must not be queued invisibly
        // before RP15 offline financial replay qualification.
        idempotencyKey: `opd-dispense:${rxId}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Medication dispensing failed.');
    }

    const data = result.data as any;
    const authoritativePrescription = data?.prescription || {};
    const pharmacyInvoice = data?.invoice
      ? adaptAuthoritativeOpdInvoice(data.invoice)
      : undefined;

    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? {
              ...e,
              prescriptions: e.prescriptions.map((rx) =>
                rx.id === rxId
                  ? {
                      ...rx,
                      status: 'DISPENSED',
                      quantityDispensed: Number(
                        authoritativePrescription.quantityDispensed ||
                          rx.quantityDispensed ||
                          0
                      ),
                      dispensedAt: Number(
                        authoritativePrescription.dispensedAt || Date.now()
                      ),
                      dispensedBy: String(
                        authoritativePrescription.dispensedBy || ''
                      ),
                    }
                  : rx
              ),
              pharmacyInvoices: pharmacyInvoice
                ? [
                    ...(e.pharmacyInvoices || []).filter(
                      (invoice) => invoice.id !== pharmacyInvoice.id
                    ),
                    pharmacyInvoice,
                  ]
                : e.pharmacyInvoices,
            }
          : e
      )
    );
    recordEvent(
      'MEDICATION_DISPENSED',
      `Medication ${rxId} dispensed and pharmacy receivable posted.`
    );
  };

  // HANDLER: Cash settlement — the pilot is intentionally cash-only.
  // Billing is part of the authoritative OPD DAG. The client may render an
  // optimistic balance, but it cannot skip the server-owned billing stage or
  // advance to disposition until the local invoice is fully settled.
  const handleSettlePayment = async (payment: PaymentTransaction) => {
    const consultationInvoice = activeEncounter.consultationInvoice;
    if (
      consultationInvoice &&
      consultationInvoice.billingPurpose === 'OPD_CONSULTATION' &&
      activeEncounter.currentStage === 'REGISTRATION'
    ) {
      if (payment.mode !== 'CASH') {
        throw new Error(
          'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the offline-first pilot.'
        );
      }
      if (!Number.isSafeInteger(payment.amountMinorUnits) || payment.amountMinorUnits <= 0) {
        throw new Error('INVALID_PAYMENT_AMOUNT: enter a positive whole minor-unit amount.');
      }

      const outstanding = Math.max(
        0,
        consultationInvoice.balanceDueMinorUnits
      );
      if (payment.amountMinorUnits > outstanding) {
        throw new Error(
          'PAYMENT_EXCEEDS_BALANCE: cash collection cannot exceed the outstanding consultation balance.'
        );
      }

      const result = await executeActiveTenantCommand<{
        receipt: { receiptId: string; journalId: string };
        journal: { journalId: string };
        invoice: Record<string, any>;
        encounter?: Record<string, any>;
      }>(
        'RecordCashReceiptCommand',
        {
          receiptId: payment.id,
          invoiceId: consultationInvoice.id,
          encounterId: activeEncounter.id,
          patientId: activeEncounter.patientId,
          amountMinorUnits: payment.amountMinorUnits,
          currency: consultationInvoice.currency || 'PKR',
          referenceNumber: payment.referenceNumber,
          collectedAt: payment.processedAt,
          cashierName: payment.processedBy,
        },
        {
          idempotencyKey: `opd-consultation-cash-receipt:${payment.id}`,
          offlineQueue: {
            enabled: true,
            collection: 'cashReceipts',
            resourceId: payment.id,
            action: 'CREATE',
            optimisticCache: true,
          },
        }
      );

      if (result.queuedOffline) {
        const pendingPayment: PaymentTransaction = {
          ...payment,
          invoiceId: consultationInvoice.id,
          status: 'PENDING',
          glJournalEntryId: '',
        };
        setEncounters((prev) =>
          prev.map((encounter) =>
            encounter.id === activeEncounter.id
              ? {
                  ...encounter,
                  consultationInvoice: {
                    ...consultationInvoice,
                    payments: [
                      ...consultationInvoice.payments.filter(
                        (existing) => existing.id !== pendingPayment.id
                      ),
                      pendingPayment,
                    ],
                  },
                }
              : encounter
          )
        );
        setActiveTab('BILLING');
        return;
      }

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Consultation cash receipt command failed.');
      }

      const governedPayment: PaymentTransaction = {
        ...payment,
        invoiceId: consultationInvoice.id,
        glJournalEntryId:
          result.data.journal?.journalId ||
          result.data.receipt?.journalId ||
          '',
      };
      const newBalance = Math.max(
        0,
        outstanding - governedPayment.amountMinorUnits
      );
      const totalPaid =
        consultationInvoice.patientCopayAmountMinorUnits - newBalance;
      const isSettled = newBalance === 0;

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                consultationInvoice: {
                  ...consultationInvoice,
                  payments: [...consultationInvoice.payments, governedPayment],
                  balanceDueMinorUnits: newBalance,
                  settlementStatus: isSettled ? 'SETTLED' : 'PARTIALLY_PAID',
                  ...(isSettled ? { settledAt: Date.now() } : {}),
                },
                financialClearance: {
                  ingressFeePaid: isSettled,
                  ingressReceiptNumber: isSettled
                    ? governedPayment.referenceNumber
                    : undefined,
                  amountPaid: totalPaid / 100,
                },
                stageProgress: {
                  ...encounter.stageProgress,
                  BILLING_AUTHORIZATION: {
                    status: isSettled ? 'COMPLETED' : 'ACTIVE',
                    enteredAt:
                      encounter.stageProgress?.BILLING_AUTHORIZATION?.enteredAt ||
                      Date.now(),
                    ...(isSettled
                      ? {
                          completedAt: Date.now(),
                          completedBy: governedPayment.processedBy,
                        }
                      : {}),
                  },
                  QUEUE_ASSIGNMENT: {
                    status: isSettled ? 'ACTIVE' : 'PENDING',
                    ...(isSettled ? { enteredAt: Date.now() } : {}),
                  },
                },
              }
            : encounter
        )
      );

      if (isSettled) {
        setQueue((prev) =>
          prev.map((token) =>
            token.encounterId === activeEncounter.id
              ? { ...token, status: 'WAITING' as const }
              : token
          )
        );
      }

      setActiveTab(
        isSettled && canAccessTab('QUEUE') ? 'QUEUE' : 'BILLING'
      );
      return;
    }

    const diagnosticInvoice = (activeEncounter.diagnosticInvoices || []).find(
      (invoice) => invoice.id === payment.invoiceId
    );
    if (diagnosticInvoice) {
      if (payment.mode !== 'CASH') {
        throw new Error(
          'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the controlled OPD pilot.'
        );
      }
      if (!Number.isSafeInteger(payment.amountMinorUnits) || payment.amountMinorUnits <= 0) {
        throw new Error(
          'INVALID_PAYMENT_AMOUNT: enter a positive whole minor-unit amount.'
        );
      }
      if (payment.amountMinorUnits > diagnosticInvoice.balanceDueMinorUnits) {
        throw new Error(
          'PAYMENT_EXCEEDS_BALANCE: cash collection cannot exceed the outstanding diagnostic balance.'
        );
      }

      const result = await executeActiveTenantCommand<{
        receipt: { receiptId: string; journalId: string };
        journal: { journalId: string };
        invoice: Record<string, any>;
        diagnosticOrder?: Record<string, any>;
      }>(
        'RecordCashReceiptCommand',
        {
          receiptId: payment.id,
          invoiceId: diagnosticInvoice.id,
          encounterId: activeEncounter.id,
          patientId: activeEncounter.patientId,
          amountMinorUnits: payment.amountMinorUnits,
          currency: diagnosticInvoice.currency || 'PKR',
          referenceNumber: payment.referenceNumber,
          collectedAt: payment.processedAt,
          cashierName: payment.processedBy,
        },
        {
          idempotencyKey: `opd-diagnostic-cash-receipt:${payment.id}`,
          offlineQueue: {
            enabled: true,
            collection: 'cashReceipts',
            resourceId: payment.id,
            action: 'CREATE',
            optimisticCache: true,
          },
        }
      );

      if (result.queuedOffline) {
        const pendingPayment: PaymentTransaction = {
          ...payment,
          invoiceId: diagnosticInvoice.id,
          status: 'PENDING',
          glJournalEntryId: '',
        };
        setEncounters((prev) =>
          prev.map((encounter) =>
            encounter.id === activeEncounter.id
              ? {
                  ...encounter,
                  diagnosticInvoices: (encounter.diagnosticInvoices || []).map(
                    (invoice) =>
                      invoice.id === diagnosticInvoice.id
                        ? {
                            ...invoice,
                            payments: [
                              ...invoice.payments.filter(
                                (existing) =>
                                  existing.id !== pendingPayment.id
                              ),
                              pendingPayment,
                            ],
                          }
                        : invoice
                  ),
                }
              : encounter
          )
        );
        setActiveTab('BILLING');
        return;
      }

      if (!result.success || !result.data) {
        throw new Error(
          result.error?.message || 'Diagnostic cash receipt command failed.'
        );
      }

      const governedPayment: PaymentTransaction = {
        ...payment,
        invoiceId: diagnosticInvoice.id,
        glJournalEntryId:
          result.data.journal?.journalId ||
          result.data.receipt?.journalId ||
          '',
      };
      const nextBalance = Math.max(
        0,
        diagnosticInvoice.balanceDueMinorUnits - payment.amountMinorUnits
      );
      const isSettled = nextBalance === 0;
      const releasedOrder = result.data.diagnosticOrder;

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                diagnosticInvoices: (encounter.diagnosticInvoices || []).map(
                  (invoice) =>
                    invoice.id === diagnosticInvoice.id
                      ? {
                          ...invoice,
                          balanceDueMinorUnits: nextBalance,
                          settlementStatus: isSettled
                            ? 'SETTLED'
                            : 'PARTIALLY_PAID',
                          payments: [...invoice.payments, governedPayment],
                          ...(isSettled ? { settledAt: Date.now() } : {}),
                        }
                      : invoice
                ),
                diagnosticOrders: encounter.diagnosticOrders.map((order) =>
                  releasedOrder &&
                  order.id ===
                    String(
                      releasedOrder.orderId ||
                        diagnosticInvoice.sourceOrderId ||
                        ''
                    )
                    ? {
                        ...order,
                        revenueLockStatus: String(
                          releasedOrder.revenueLockStatus ||
                            order.revenueLockStatus ||
                            ''
                        ),
                        paymentStatus:
                          String(releasedOrder.revenueLockStatus || '') ===
                          'PAID_SETTLED'
                            ? 'PAID_SETTLED'
                            : order.paymentStatus,
                        worklistStatus: String(
                          releasedOrder.worklistStatus ||
                            order.worklistStatus ||
                            ''
                        ),
                      }
                    : order
                ),
              }
            : encounter
        )
      );

      recordEvent(
        'DIAGNOSTIC_PAYMENT_CAPTURED',
        isSettled
          ? `Diagnostic invoice ${diagnosticInvoice.invoiceNumber} settled; execution gate released.`
          : `Partial diagnostic payment captured for ${diagnosticInvoice.invoiceNumber}.`,
        { invoiceId: diagnosticInvoice.id, amountMinorUnits: payment.amountMinorUnits }
      );
      setActiveTab('BILLING');
      return;
    }

    const pharmacyInvoice = (activeEncounter.pharmacyInvoices || []).find(
      (invoice) => invoice.id === payment.invoiceId
    );
    if (pharmacyInvoice) {
      if (payment.mode !== 'CASH') {
        throw new Error(
          'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the controlled OPD pilot.'
        );
      }
      if (
        !Number.isSafeInteger(payment.amountMinorUnits) ||
        payment.amountMinorUnits <= 0
      ) {
        throw new Error(
          'INVALID_PAYMENT_AMOUNT: enter a positive whole minor-unit amount.'
        );
      }
      if (payment.amountMinorUnits > pharmacyInvoice.balanceDueMinorUnits) {
        throw new Error(
          'PAYMENT_EXCEEDS_BALANCE: cash collection cannot exceed the outstanding pharmacy balance.'
        );
      }

      const result = await executeActiveTenantCommand<{
        receipt: { receiptId: string; journalId: string };
        journal: { journalId: string };
        invoice: Record<string, any>;
      }>(
        'RecordCashReceiptCommand',
        {
          receiptId: payment.id,
          invoiceId: pharmacyInvoice.id,
          encounterId: activeEncounter.id,
          patientId: activeEncounter.patientId,
          amountMinorUnits: payment.amountMinorUnits,
          currency: pharmacyInvoice.currency || 'PKR',
          referenceNumber: payment.referenceNumber,
          collectedAt: payment.processedAt,
          cashierName: payment.processedBy,
        },
        {
          idempotencyKey: `opd-pharmacy-cash-receipt:${payment.id}`,
          offlineQueue: {
            enabled: true,
            collection: 'cashReceipts',
            resourceId: payment.id,
            action: 'CREATE',
            optimisticCache: true,
          },
        }
      );

      if (result.queuedOffline) {
        const pendingPayment: PaymentTransaction = {
          ...payment,
          invoiceId: pharmacyInvoice.id,
          status: 'PENDING',
          glJournalEntryId: '',
        };
        setEncounters((prev) =>
          prev.map((encounter) =>
            encounter.id === activeEncounter.id
              ? {
                  ...encounter,
                  pharmacyInvoices: (encounter.pharmacyInvoices || []).map(
                    (invoice) =>
                      invoice.id === pharmacyInvoice.id
                        ? {
                            ...invoice,
                            payments: [
                              ...invoice.payments.filter(
                                (existing) =>
                                  existing.id !== pendingPayment.id
                              ),
                              pendingPayment,
                            ],
                          }
                        : invoice
                  ),
                }
              : encounter
          )
        );
        setActiveTab('BILLING');
        return;
      }

      if (!result.success || !result.data) {
        throw new Error(
          result.error?.message || 'Pharmacy cash receipt command failed.'
        );
      }

      const governedPayment: PaymentTransaction = {
        ...payment,
        invoiceId: pharmacyInvoice.id,
        glJournalEntryId:
          result.data.journal?.journalId ||
          result.data.receipt?.journalId ||
          '',
      };
      const nextBalance = Math.max(
        0,
        pharmacyInvoice.balanceDueMinorUnits - payment.amountMinorUnits
      );
      const isSettled = nextBalance === 0;

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                pharmacyInvoices: (encounter.pharmacyInvoices || []).map(
                  (invoice) =>
                    invoice.id === pharmacyInvoice.id
                      ? {
                          ...invoice,
                          balanceDueMinorUnits: nextBalance,
                          settlementStatus: isSettled
                            ? 'SETTLED'
                            : 'PARTIALLY_PAID',
                          payments: [...invoice.payments, governedPayment],
                          ...(isSettled ? { settledAt: Date.now() } : {}),
                        }
                      : invoice
                ),
              }
            : encounter
        )
      );

      recordEvent(
        'PHARMACY_PAYMENT_CAPTURED',
        isSettled
          ? `Pharmacy invoice ${pharmacyInvoice.invoiceNumber} settled.`
          : `Partial pharmacy payment captured for ${pharmacyInvoice.invoiceNumber}.`,
        {
          invoiceId: pharmacyInvoice.id,
          amountMinorUnits: payment.amountMinorUnits,
        }
      );
      setActiveTab('BILLING');
      return;
    }

    const supplementalInvoice = (
      activeEncounter.supplementalInvoices || []
    ).find((invoice) => invoice.id === payment.invoiceId);
    if (supplementalInvoice) {
      if (payment.mode !== 'CASH') {
        throw new Error(
          'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the controlled OPD pilot.'
        );
      }
      if (
        !Number.isSafeInteger(payment.amountMinorUnits) ||
        payment.amountMinorUnits <= 0
      ) {
        throw new Error(
          'INVALID_PAYMENT_AMOUNT: enter a positive whole minor-unit amount.'
        );
      }
      if (
        payment.amountMinorUnits > supplementalInvoice.balanceDueMinorUnits
      ) {
        throw new Error(
          'PAYMENT_EXCEEDS_BALANCE: cash collection cannot exceed the outstanding supplemental balance.'
        );
      }

      const result = await executeActiveTenantCommand<{
        receipt: { receiptId: string; journalId: string };
        journal: { journalId: string };
        invoice: Record<string, any>;
      }>(
        'RecordCashReceiptCommand',
        {
          receiptId: payment.id,
          invoiceId: supplementalInvoice.id,
          encounterId: activeEncounter.id,
          patientId: activeEncounter.patientId,
          amountMinorUnits: payment.amountMinorUnits,
          currency: supplementalInvoice.currency || 'PKR',
          referenceNumber: payment.referenceNumber,
          collectedAt: payment.processedAt,
          cashierName: payment.processedBy,
        },
        {
          idempotencyKey: `opd-ri-cash-receipt:${payment.id}`,
          offlineQueue: {
            enabled: true,
            collection: 'cashReceipts',
            resourceId: payment.id,
            action: 'CREATE',
            optimisticCache: true,
          },
        }
      );

      if (result.queuedOffline) {
        const pendingPayment: PaymentTransaction = {
          ...payment,
          invoiceId: supplementalInvoice.id,
          status: 'PENDING',
          glJournalEntryId: '',
        };
        setEncounters((prev) =>
          prev.map((encounter) =>
            encounter.id === activeEncounter.id
              ? {
                  ...encounter,
                  supplementalInvoices: (
                    encounter.supplementalInvoices || []
                  ).map((invoice) =>
                    invoice.id === supplementalInvoice.id
                      ? {
                          ...invoice,
                          payments: [
                            ...invoice.payments.filter(
                              (existing) =>
                                existing.id !== pendingPayment.id
                            ),
                            pendingPayment,
                          ],
                        }
                      : invoice
                  ),
                }
              : encounter
          )
        );
        setActiveTab('BILLING');
        return;
      }

      if (!result.success || !result.data) {
        throw new Error(
          result.error?.message ||
            'Revenue Integrity cash receipt command failed.'
        );
      }

      const governedPayment: PaymentTransaction = {
        ...payment,
        invoiceId: supplementalInvoice.id,
        glJournalEntryId:
          result.data.journal?.journalId ||
          result.data.receipt?.journalId ||
          '',
      };
      const nextBalance = Math.max(
        0,
        supplementalInvoice.balanceDueMinorUnits - payment.amountMinorUnits
      );
      const isSettled = nextBalance === 0;

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                supplementalInvoices: (
                  encounter.supplementalInvoices || []
                ).map((invoice) =>
                  invoice.id === supplementalInvoice.id
                    ? {
                        ...invoice,
                        balanceDueMinorUnits: nextBalance,
                        settlementStatus: isSettled
                          ? 'SETTLED'
                          : 'PARTIALLY_PAID',
                        payments: [...invoice.payments, governedPayment],
                        ...(isSettled ? { settledAt: Date.now() } : {}),
                      }
                    : invoice
                ),
              }
            : encounter
        )
      );

      recordEvent(
        'REVENUE_INTEGRITY_PAYMENT_CAPTURED',
        isSettled
          ? `Revenue Integrity invoice ${supplementalInvoice.invoiceNumber} settled.`
          : `Partial payment captured for ${supplementalInvoice.invoiceNumber}.`,
        {
          invoiceId: supplementalInvoice.id,
          amountMinorUnits: payment.amountMinorUnits,
        }
      );
      setActiveTab('BILLING');
      return;
    }

    if (!IS_DEMO_RUNTIME) {
      throw new Error(
        'LEGACY_FINAL_INVOICE_DISABLED: production OPD closes through authoritative final billing reconciliation, not a client aggregate invoice.'
      );
    }
    if (!activeEncounter.invoice) throw new Error('FINAL_INVOICE_REQUIRED');
    if (payment.mode !== 'CASH') {
      throw new Error(
        'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the offline-first pilot.'
      );
    }
    if (!Number.isSafeInteger(payment.amountMinorUnits) || payment.amountMinorUnits <= 0) {
      throw new Error('INVALID_PAYMENT_AMOUNT: enter a positive whole minor-unit amount.');
    }

    const currentBalance = Math.max(
      0,
      activeEncounter.invoice.balanceDueMinorUnits
    );
    if (payment.amountMinorUnits > currentBalance) {
      throw new Error(
        'PAYMENT_EXCEEDS_BALANCE: cash collection cannot exceed the outstanding patient balance.'
      );
    }

    const billingTransition = await executeActiveTenantCommand(
      'AdvanceStageCommand',
      {
        encounterId: activeEncounter.id,
        currentStage: activeEncounter.currentStage || 'DIAGNOSTICS',
        targetStage: 'BILLING_SETTLEMENT',
      },
      {
        idempotencyKey: `opd-stage-billing:${activeEncounter.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounters',
          resourceId: activeEncounter.id,
          action: 'UPDATE',
          optimisticCache: false,
        },
      }
    );
    if (!billingTransition.success) {
      throw new Error(
        billingTransition.error?.message ||
          'Clinical workflow runtime blocked transition into billing settlement.'
      );
    }

    const result = await executeActiveTenantCommand<{
      receipt: { receiptId: string; journalId: string };
      journal: { journalId: string };
    }>(
      'RecordCashReceiptCommand',
      {
        receiptId: payment.id,
        invoiceId: payment.invoiceId,
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        amountMinorUnits: payment.amountMinorUnits,
        currency: activeEncounter.invoice.currency || 'PKR',
        referenceNumber: payment.referenceNumber,
        collectedAt: payment.processedAt,
        cashierName: payment.processedBy,
      },
      {
        idempotencyKey: `cash-receipt:${payment.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'cashReceipts',
          resourceId: payment.id,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Cash receipt command failed.');
    }

    const governedPayment: PaymentTransaction = {
      ...payment,
      glJournalEntryId:
        result.data?.journal?.journalId ||
        result.data?.receipt?.journalId ||
        '',
    };
    const newBalance = Math.max(
      0,
      currentBalance - governedPayment.amountMinorUnits
    );
    const totalPaid =
      activeEncounter.invoice.patientCopayAmountMinorUnits - newBalance;
    const isSettled = newBalance === 0;

    if (isSettled) {
      const dispositionTransition = await executeActiveTenantCommand(
        'AdvanceStageCommand',
        {
          encounterId: activeEncounter.id,
          currentStage: 'BILLING_SETTLEMENT',
          targetStage: 'DISCHARGE_OR_REFERRAL',
          evidenceId: result.entityId || payment.id,
        },
        {
          idempotencyKey: `opd-stage-disposition:${activeEncounter.id}`,
          offlineQueue: {
            enabled: true,
            collection: 'encounters',
            resourceId: activeEncounter.id,
            action: 'UPDATE',
            optimisticCache: false,
          },
        }
      );
      if (!dispositionTransition.success) {
        throw new Error(
          dispositionTransition.error?.message ||
            'Clinical workflow runtime blocked transition from billing to disposition.'
        );
      }
    }

    setEncounters((prev) =>
      prev.map((e) => {
        if (e.id === activeEncounter.id && e.invoice) {
          const updatedPayments = [...e.invoice.payments, governedPayment];

          return {
            ...e,
            currentStage: isSettled ? 'DISPOSITION_CLOSURE' : 'BILLING_SETTLEMENT',
            stageProgress: {
              ...e.stageProgress,
              BILLING_SETTLEMENT: {
                status: isSettled ? 'COMPLETED' : 'ACTIVE',
                enteredAt:
                  e.stageProgress?.BILLING_SETTLEMENT?.enteredAt || Date.now(),
                ...(isSettled
                  ? {
                      completedAt: Date.now(),
                      completedBy: governedPayment.processedBy,
                    }
                  : {}),
              },
              ...(isSettled
                ? {
                    DISPOSITION_CLOSURE: {
                      status: 'ACTIVE',
                      enteredAt: Date.now(),
                    },
                  }
                : {}),
            },
            invoice: {
              ...e.invoice,
              payments: updatedPayments,
              amountPaidMinorUnits: totalPaid,
              balanceDueMinorUnits: newBalance,
              settlementStatus: isSettled ? 'SETTLED' : 'PARTIALLY_SETTLED',
            },
          };
        }
        return e;
      })
    );
    recordEvent(
      isSettled ? 'PAYMENT_SETTLED' : 'PAYMENT_PARTIALLY_SETTLED',
      `Collected PKR ${(payment.amountMinorUnits / 100).toLocaleString()} via ${payment.mode}. General Ledger entry ${governedPayment.glJournalEntryId} posted.`
    );
    setActiveTab(isSettled ? 'DISPOSITION' : 'BILLING');
  };

  const handleFinalizeBillingReconciliation = async () => {
    requireOnlineOpdAuthority('final billing reconciliation');
    if (!activeEncounter) return;
    if (activeBillingInvoice) {
      throw new Error(
        'OUTSTANDING_INVOICE_REQUIRED: settle every consultation, diagnostic, pharmacy, and Revenue Integrity invoice before final reconciliation.'
      );
    }

    setBillingReconciliationBusy(true);
    setBillingReconciliationError(null);
    try {
      const currentStage = String(activeEncounter.currentStage || '');
      if (currentStage !== 'BILLING_SETTLEMENT') {
        const billingStage = await executeActiveTenantCommand(
          'AdvanceStageCommand',
          {
            encounterId: activeEncounter.id,
            currentStage:
              activeEncounter.currentStage || 'PHARMACY_DISPENSARY',
            targetStage: 'BILLING_SETTLEMENT',
          },
          {
            idempotencyKey: `opd-final-billing-stage:${activeEncounter.id}`,
          }
        );
        if (!billingStage.success) {
          throw new Error(
            billingStage.error?.message ||
              'Workflow runtime blocked entry into final billing settlement.'
          );
        }
      }

      const reconciliation = await executeActiveTenantCommand<{
        reconciliation: {
          reconciliationId: string;
          status: 'CLEARED';
          reconciledAt: number;
        };
        encounter: Record<string, any>;
      }>(
        'ReconcileOpdBillingCommand',
        { encounterId: activeEncounter.id },
        {
          idempotencyKey: `opd-final-billing-reconcile:${activeEncounter.id}`,
        }
      );
      if (
        !reconciliation.success ||
        !reconciliation.data?.reconciliation?.reconciliationId
      ) {
        throw new Error(
          reconciliation.error?.message ||
            'Final OPD billing reconciliation failed.'
        );
      }

      const reconciliationId =
        reconciliation.data.reconciliation.reconciliationId;
      const dispositionStage = await executeActiveTenantCommand(
        'AdvanceStageCommand',
        {
          encounterId: activeEncounter.id,
          currentStage: 'BILLING_SETTLEMENT',
          targetStage: 'DISCHARGE_OR_REFERRAL',
          evidenceId: reconciliationId,
        },
        {
          idempotencyKey: `opd-final-billing-clearance:${activeEncounter.id}`,
        }
      );
      if (!dispositionStage.success) {
        throw new Error(
          dispositionStage.error?.message ||
            'Workflow runtime blocked disposition after billing reconciliation.'
        );
      }

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                currentStage: 'DISPOSITION_CLOSURE',
                billingReconciliationId: reconciliationId,
                billingReconciliationState: 'CLEARED',
                billingClosedAt:
                  reconciliation.data?.reconciliation?.reconciledAt ||
                  Date.now(),
                stageProgress: {
                  ...encounter.stageProgress,
                  BILLING_SETTLEMENT: {
                    status: 'COMPLETED',
                    enteredAt:
                      encounter.stageProgress?.BILLING_SETTLEMENT?.enteredAt ||
                      Date.now(),
                    completedAt: Date.now(),
                    completedBy: 'Server Billing Authority',
                  },
                  DISPOSITION_CLOSURE: {
                    status: 'ACTIVE',
                    enteredAt: Date.now(),
                  },
                },
              }
            : encounter
        )
      );
      setActiveTab(
        canAccessTab('DISPOSITION') ? 'DISPOSITION' : 'BILLING'
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Final billing reconciliation failed.';
      setBillingReconciliationError(message);
    } finally {
      setBillingReconciliationBusy(false);
    }
  };

  // HANDLER: Commit disposition. OPD -> IPD admission is one atomic care
  // transition; it must never first write an intermediate "bed requested"
  // disposition that can survive a failed admission.
  const handleCommitDisposition = async (disposition: EncounterDisposition) => {
    requireOnlineOpdAuthority('final disposition and care transition');
    const inpatientRequest = disposition.inpatientAdmissionRequest;
    const directAdmission =
      disposition.type === 'INPATIENT_ADMISSION_RECOMMENDED';

    if (directAdmission) {
      if (!inpatientRequest?.targetBedId) {
        throw new Error(
          'TARGET_BED_REQUIRED: direct inpatient admission requires an authoritative available bed.'
        );
      }

      const admissionResult = await executeActiveTenantCommand<{
        encounter: { encounterId: string };
        sourceEncounter?: {
          encounterId: string;
          status: string;
          linkedEncounterId?: string;
        } | null;
        sourceAppointment?: Record<string, any> | null;
      }>(
        'AdmitPatientToInpatientCareCommand',
        {
          patientId: activeEncounter.patientId,
          bedId: inpatientRequest.targetBedId,
          sourceEncounterId: activeEncounter.id,
          admittingDiagnosis: inpatientRequest.clinicalIndication,
          priority: 'URGENT',
        },
        {
          idempotencyKey: `opd-ipd-admission:${activeEncounter.id}`,
        }
      );
      if (!admissionResult.success) {
        throw new Error(
          admissionResult.error?.message ||
            'Atomic OPD-to-IPD transition failed; the OPD encounter remains unchanged.'
        );
      }

      const transitionedAt = Date.now();
      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                disposition,
                currentStage: 'TIMELINE_AUDIT',
                status: 'TRANSFERRED_TO_INPATIENT',
                completedAt: transitionedAt,
                stageProgress: {
                  ...encounter.stageProgress,
                  DISPOSITION_CLOSURE: {
                    status: 'COMPLETED',
                    enteredAt:
                      encounter.stageProgress?.DISPOSITION_CLOSURE?.enteredAt ||
                      transitionedAt,
                    completedAt: transitionedAt,
                    completedBy: 'Server Care Transition Authority',
                  },
                  TIMELINE_AUDIT: {
                    status: 'COMPLETED',
                    enteredAt: transitionedAt,
                    completedAt: transitionedAt,
                    completedBy: 'Server Care Transition Authority',
                  },
                },
              }
            : encounter
        )
      );
      recordEvent(
        'INPATIENT_ADMISSION_REQUESTED',
        `OPD encounter atomically transferred to inpatient encounter ${admissionResult.data?.encounter?.encounterId || ''}.`,
        {
          sourceEncounterId: activeEncounter.id,
          inpatientEncounterId:
            admissionResult.data?.encounter?.encounterId || '',
          targetBedId: inpatientRequest.targetBedId,
        }
      );
      setActiveTab('AUDIT');
      return;
    }

    const dispositionResult = await executeActiveTenantCommand(
      'CommitEncounterDispositionCommand',
      {
        encounterId: activeEncounter.id,
        dispositionType: disposition.type,
        patientInstructions: disposition.patientInstructions,
        warningSignsRedFlags: disposition.warningSignsRedFlags,
        followUpScheduledDate: disposition.followUpScheduledDate,
        followUpDepartment: disposition.followUpDepartment,
        internalReferral: disposition.internalReferral
          ? {
              targetDepartment: disposition.internalReferral.targetDepartment,
              ...(disposition.internalReferral.targetDoctor
                ? { targetDoctor: disposition.internalReferral.targetDoctor }
                : {}),
              priority: disposition.internalReferral.priority,
              clinicalReason: disposition.internalReferral.clinicalReason,
            }
          : undefined,
        externalReferral: disposition.externalReferral
          ? {
              receivingHospitalName:
                disposition.externalReferral.receivingHospitalName,
              ...(disposition.externalReferral.receivingDoctorName
                ? {
                    receivingDoctorName:
                      disposition.externalReferral.receivingDoctorName,
                  }
                : {}),
              sbarHandover: disposition.externalReferral.sbarHandover,
            }
          : undefined,
      },
      { idempotencyKey: `opd-disposition:${activeEncounter.id}` }
    );
    if (!dispositionResult.success) {
      throw new Error(
        dispositionResult.error?.message || 'Encounter disposition failed.'
      );
    }

    setEncounters((prev) =>
      prev.map((encounter) =>
        encounter.id === activeEncounter.id
          ? {
              ...encounter,
              disposition,
              currentStage: 'TIMELINE_AUDIT',
              status: 'COMPLETED',
              completedAt: Date.now(),
              stageProgress: {
                ...encounter.stageProgress,
                DISPOSITION_CLOSURE: {
                  status: 'COMPLETED',
                  enteredAt:
                    encounter.stageProgress?.DISPOSITION_CLOSURE?.enteredAt ||
                    Date.now(),
                  completedAt: Date.now(),
                  completedBy: 'Server Encounter Authority',
                },
                TIMELINE_AUDIT: {
                  status: 'COMPLETED',
                  enteredAt: Date.now(),
                  completedAt: Date.now(),
                  completedBy: 'Server Audit Pipeline',
                },
              },
            }
          : encounter
      )
    );
    recordEvent(
      'DISPOSITION_COMMITTED',
      `Disposition committed: ${disposition.type}`,
      disposition
    );
    setActiveTab('AUDIT');
  };

  // Navigation Items
  const navTabs = [
    { id: 'DASHBOARD', label: 'Overview', icon: LayoutDashboard },
    { id: 'SEARCH_MPI', label: 'MPI Search', icon: Search },
    { id: 'REGISTRATION', label: 'Registration', icon: PlusCircle },
    { id: 'APPOINTMENTS', label: 'Appointments', icon: Calendar },
    { id: 'QUEUE', label: 'Live Queue', icon: Clock },
    { id: 'TRIAGE', label: 'Triage / NEWS2', icon: Activity },
    { id: 'CONSULTATION', label: 'Consultation', icon: Stethoscope },
    { id: 'DIAGNOSTICS', label: 'Lab & PACS', icon: FlaskConical },
    { id: 'PHARMACY', label: 'Pharmacy FEFO', icon: Pill },
    { id: 'BILLING', label: 'Billing / GL', icon: DollarSign },
    { id: 'DISPOSITION', label: 'Disposition', icon: FileCheck },
    { id: 'AUDIT', label: 'Audit Trail', icon: ShieldCheck },
  ].filter((tab) => canAccessTab(tab.id));

  return (
    <div className="space-y-6">
      {/* Offline Sync Status & Role Switcher Bar */}
      <OpdOfflineSyncManager
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingSyncCount={pendingSyncCount}
        conflictsCount={conflictsCount}
        lastError={syncError}
        activeRole={activeRole}
        allowPersonaSwitch={false}
        allowOfflineSimulation={IS_DEMO_RUNTIME}
        offlineSimulationActive={offlineSimulationActive}
        onRoleChange={() => undefined}
        onTriggerManualSync={async () => {
          const result = await triggerSync(auth.activeTenant?.tenantId);
          if (result.syncedCount > 0) {
            await refreshAuthoritativeWorkspace();
          }
        }}
        onToggleOfflineSimulation={async () => {
          if (!IS_DEMO_RUNTIME) return;
          await setOfflineSimulation(!offlineSimulationActive);
        }}
      />

      {activeRole === 'UNAUTHORIZED' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          Your authenticated account has no OPD departmental role. Contact Hospital IAM/Credentialing instead of changing a client-side persona.
        </div>
      )}

      {/* Primary OPD Workspace Navigation Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-testid={`opd-tab-${tab.id.toLowerCase()}`}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Patient Quick Banner (if patient is selected) */}
      {activeEncounter && activeTab !== 'DASHBOARD' && activeTab !== 'SEARCH_MPI' && (
        <div
          data-testid="opd-active-patient-banner"
          data-encounter-id={activeEncounter.id}
          data-patient-id={activeEncounter.patientId}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center font-black text-blue-600 text-sm">
              {activeEncounter.patientName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {activeEncounter.patientName}
                </h3>
                <span className="text-xs font-mono font-bold text-blue-600">
                  {activeEncounter.mrn}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  Token: {activeEncounter.tokenNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {activeEncounter.age}y • {activeEncounter.gender} • Tariff: <strong>{activeEncounter.tariffPlan?.replace(/_/g, ' ')}</strong> • Dept: {activeEncounter.department}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Active Stage:</span>
            <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {activeEncounter.currentStage.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )}

      {/* TAB CONTENT PANELS */}

      {/* 1. Overview & KPIs Dashboard */}
      {activeTab === 'DASHBOARD' && (
        <OpdDashboardKpis
          encounters={encounters}
          queue={queue}
          activeRole={activeRole}
          snapshotSource={dashboardSnapshotMeta.source}
          snapshotGeneratedAt={dashboardSnapshotMeta.generatedAt}
          snapshotVersion={dashboardSnapshotMeta.snapshotVersion}
          pendingSyncCount={pendingSyncCount}
          isOnline={isOnline}
          onSelectEncounter={(id) => {
            setSelectedEncounterId(id);
            if (canAccessTab('CONSULTATION')) {
              setActiveTab('CONSULTATION');
            }
          }}
          onNavigateStage={(stage) => {
            if (canAccessTab(stage)) {
              setActiveTab(stage);
            }
          }}
        />
      )}

      {/* 2. Patient Search & MPI Duplicate Matching */}
      {activeTab === 'SEARCH_MPI' && (
        <OpdPatientSearchMpi
          patients={patients}
          onSelectPatient={(p) => {
            const existingEnc = encounters.find((e) => e.patientId === p.id);
            if (existingEnc) {
              setSelectedEncounterId(existingEnc.id);
              setActiveTab('CONSULTATION');
            } else {
              handleRegisterSuccess(p);
            }
          }}
          onInitiateNewRegistration={(initial) => {
            setActiveTab('REGISTRATION');
          }}
          onInitiateMergeRequest={(source, target, reason) => {
            recordEvent('MPI_MERGE_REQUESTED', `Merge request from ${source} to ${target}. Reason: ${reason}`);
            alert('MPI duplicate merge request submitted for Medical Records Administrator authorization.');
          }}
        />
      )}

      {/* 3. Patient Registration & Informed Consent */}
      {activeTab === 'REGISTRATION' && (
        <OpdRegistrationConsent
          onRegisterSuccess={(newPatient) => handleRegisterSuccess(newPatient)}
          onCancel={() => setActiveTab('DASHBOARD')}
        />
      )}

      {/* 4. Appointments & Waitlist */}
      {activeTab === 'APPOINTMENTS' && (
        <OpdAppointmentsWaitlist
          tenantId={auth.activeTenant?.tenantId || ''}
          facilityIds={auth.user?.facilityIds || []}
          departmentIds={auth.user?.departmentIds || []}
          isOnline={!auth.isOffline}
          appointments={appointments}
          waitlist={waitlist}
          patients={patients}
          onBookAppointment={handleBookAppointment}
          onCheckInAppointment={handleCheckInAppointment}
          onResumeBillingAppointment={handleResumeAppointmentBilling}
          onCancelAppointment={handleCancelAppointment}
          onRescheduleAppointment={handleRescheduleAppointment}
          onMarkNoShowAppointment={handleMarkAppointmentNoShow}
          onAddToWaitlist={handleAddWaitlistEntry}
          onOfferWaitlistSlot={handleOfferWaitlistSlot}
          onAcceptWaitlistSlot={handleAcceptWaitlistSlot}
          onCancelWaitlist={handleCancelWaitlistEntry}
        />
      )}

      {/* 5. Live Queue Engine & Calling */}
      {activeTab === 'QUEUE' && canAccessTab('QUEUE') && (
        <OpdQueueEngine
          queue={queue}
          onCallToken={async (token, room) => {
            requireOnlineOpdAuthority('shared OPD queue call');
            const item = queue.find((q) => q.tokenNumber === token);
            if (!item) return;
            const result = await executeActiveTenantCommand(
              'UpdateOpdQueueStatusCommand',
              { tokenId: item.id, targetStatus: 'called', assignedRoomOrBay: room },
              { idempotencyKey: `opd-queue-call:${item.id}` }
            );
            if (!result.success) throw new Error(result.error?.message || 'Queue call failed.');
            setQueue((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, status: 'CALLED' as const, calledAt: Date.now(), assignedRoomOrBay: room } : q))
            );
            recordEvent('QUEUE_CALLED', `Token ${token} called to ${room}.`);
          }}
          onStartService={async (tokenId) => {
            requireOnlineOpdAuthority('OPD queue service start');
            const item = queue.find((q) => q.id === tokenId);
            if (!item) return;

            const result = await executeActiveTenantCommand<{
              queueToken: Record<string, unknown>;
              encounter: Record<string, unknown>;
            }>(
              'StartOpdServiceCommand',
              { tokenId, assignedRoomOrBay: item.assignedRoomOrBay },
              { idempotencyKey: `opd-start-service:${tokenId}` }
            );

            if (!result.success) {
              throw new Error(
                result.error?.message ||
                  'OPD service start was rejected by the authoritative payment/workflow gate.'
              );
            }

            setQueue((prev) =>
              prev.map((q) =>
                q.id === tokenId
                  ? { ...q, status: 'IN_SERVICE' as const, serviceStartedAt: Date.now() }
                  : q
              )
            );
            setEncounters((prev) =>
              prev.map((encounter) =>
                encounter.id === item.encounterId
                  ? {
                      ...encounter,
                      currentStage: 'TRIAGE',
                      status: 'IN_TRIAGE',
                      stageProgress: {
                        ...encounter.stageProgress,
                        REGISTRATION: {
                          ...(encounter.stageProgress?.REGISTRATION || {}),
                          status: 'COMPLETED',
                          completedAt: Date.now(),
                        },
                        NURSING_INTAKE: {
                          status: 'ACTIVE',
                          enteredAt: Date.now(),
                        },
                      },
                    }
                  : encounter
              )
            );
            setSelectedEncounterId(item.encounterId);
            setActiveTab('TRIAGE');
          }}
          onCompleteService={async (tokenId) => {
            requireOnlineOpdAuthority('OPD queue completion');
            const result = await executeActiveTenantCommand(
              'UpdateOpdQueueStatusCommand',
              { tokenId, targetStatus: 'completed' },
              { idempotencyKey: `opd-queue-complete:${tokenId}` }
            );
            if (!result.success) throw new Error(result.error?.message || 'Queue completion failed.');
            setQueue((prev) =>
              prev.map((q) => (q.id === tokenId ? { ...q, status: 'COMPLETED' as const } : q))
            );
          }}
          onSkipToken={async (tokenId) => {
            requireOnlineOpdAuthority('OPD queue no-show update');
            const result = await executeActiveTenantCommand(
              'UpdateOpdQueueStatusCommand',
              { tokenId, targetStatus: 'no_show' },
              { idempotencyKey: `opd-queue-noshow:${tokenId}` }
            );
            if (!result.success) throw new Error(result.error?.message || 'Queue no-show failed.');
            setQueue((prev) =>
              prev.map((q) => (q.id === tokenId ? { ...q, status: 'SKIPPED' as const } : q))
            );
          }}
          onTransferQueue={async (tokenId, targetDept, targetDoc, targetRoom) => {
            requireOnlineOpdAuthority('OPD queue transfer');
            const result = await executeActiveTenantCommand(
              'UpdateOpdQueueStatusCommand',
              {
                tokenId,
                targetStatus: 'transferred',
                targetDepartment: targetDept,
                assignedDoctorName: targetDoc,
                assignedRoomOrBay: targetRoom,
              },
              { idempotencyKey: `opd-queue-transfer:${tokenId}` }
            );
            if (!result.success) throw new Error(result.error?.message || 'Queue transfer failed.');
            setQueue((prev) =>
              prev.map((q) =>
                q.id === tokenId
                  ? {
                      ...q,
                      department: targetDept,
                      assignedDoctorName: targetDoc,
                      assignedRoomOrBay: targetRoom || q.assignedRoomOrBay,
                      status: 'TRANSFERRED' as const,
                    }
                  : q
              )
            );
            recordEvent('QUEUE_TRANSFERRED', `Token transferred to ${targetDept} (${targetRoom}).`);
          }}
          onOverridePriority={(tokenId, newPriority, reason) => {
            if (!IS_DEMO_RUNTIME) {
              alert('Priority override requires the upcoming governed triage-priority command.');
              return;
            }
            setQueue((prev) =>
              prev.map((q) => (q.id === tokenId ? { ...q, triagePriority: newPriority } : q))
            );
            recordEvent('PRIORITY_OVERRIDDEN', `Triage priority escalated to ${newPriority}. Justification: ${reason}`);
          }}
          onSelectQueueItem={(encId) => {
            setSelectedEncounterId(encId);
            setActiveTab('TRIAGE');
          }}
        />
      )}

      {/* 6. Triage Vitals Station & Risk Scoring */}
      {activeTab === 'TRIAGE' && canAccessTab('TRIAGE') && activeEncounter && (
        <OpdTriageVitals
          encounter={activeEncounter}
          onSaveVitals={(vitals) => handleSaveVitals(vitals)}
        />
      )}

      {/* 7. Specialist Consultation & SOAP */}
      {activeTab === 'CONSULTATION' && canAccessTab('CONSULTATION') && activeEncounter && (
        <OpdConsultationSpecialties
          encounter={activeEncounter}
          onSaveConsultation={(soap) => handleSaveConsultation(soap)}
          onPlaceDiagnosticOrders={() => setActiveTab('DIAGNOSTICS')}
          onPlacePrescriptions={() => setActiveTab('PHARMACY')}
          online={isOnline}
        />
      )}

      {/* 8. Laboratory (LIS), PACS Radiology & Procedures */}
      {activeTab === 'DIAGNOSTICS' && canAccessTab('DIAGNOSTICS') && activeEncounter && (
        <OpdDiagnosticOrdersPacs
          encounter={activeEncounter}
          orders={activeEncounter.diagnosticOrders}
          onAddOrder={(order) => handleAddDiagnosticOrder(order)}
          onAdvanceOrderWorklist={(orderId, targetStatus) =>
            handleAdvanceDiagnosticWorklist(orderId, targetStatus)
          }
        />
      )}

      {/* 9. e-Prescriptions & Pharmacy FEFO Dispensing */}
      {activeTab === 'PHARMACY' && canAccessTab('PHARMACY') && activeEncounter && (
        <OpdPharmacyPrescriptions
          encounter={activeEncounter}
          prescriptions={activeEncounter.prescriptions}
          canPrescribe={canPrescribe}
          canDispense={canDispense}
          onlineAuthorityAvailable={isOnline}
          onAddPrescription={(item, safety) =>
            handleAddPrescription(item, safety)
          }
          onDispensePrescription={(rxId) => handleDispensePrescription(rxId)}
        />
      )}

      {/* 10. Billing settlement + final reconciliation */}
      {activeTab === 'BILLING' &&
        canAccessTab('BILLING') &&
        activeEncounter &&
        activeBillingInvoice && (
          <OpdBillingLedger
            encounter={activeEncounter}
            invoice={activeBillingInvoice}
            canSettlePayment={canSettlePayment}
            onSettlePayment={(payment) => handleSettlePayment(payment)}
          />
        )}

      {activeTab === 'BILLING' &&
        canAccessTab('BILLING') &&
        activeEncounter &&
        !activeBillingInvoice && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-teal-600" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Final OPD billing reconciliation
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  No open point-of-service invoice is visible. The server must
                  now prove every encounter charge is invoiced, every patient AR
                  item is settled, and every diagnostic/pharmacy service is
                  finalized before disposition can open.
                </p>
              </div>
            </div>

            {billingReconciliationError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{billingReconciliationError}</span>
              </div>
            )}

            <button
              data-testid="opd-final-reconcile"
              type="button"
              disabled={
                !canSettlePayment ||
                billingReconciliationBusy ||
                activeEncounter.billingReconciliationState === 'CLEARED'
              }
              onClick={() => void handleFinalizeBillingReconciliation()}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileCheck className="h-4 w-4" />
              {activeEncounter.billingReconciliationState === 'CLEARED'
                ? 'Billing reconciled'
                : billingReconciliationBusy
                  ? 'Reconciling…'
                  : 'Reconcile & unlock disposition'}
            </button>
          </div>
        )}

      {/* 11. Disposition, Referrals & SBAR Handoff */}
      {activeTab === 'DISPOSITION' && canAccessTab('DISPOSITION') && activeEncounter && (
        <OpdDispositionReferrals
          encounter={activeEncounter}
          onCommitDisposition={(disposition) => handleCommitDisposition(disposition)}
        />
      )}

      {/* 12. Longitudinal Timeline & Immutable Event Audit */}
      {activeTab === 'AUDIT' && activeEncounter && (
        <OpdPatientTimelineAudit
          encounter={activeEncounter}
          events={events.filter(
            (event) =>
              event.encounterId === activeEncounter.id ||
              (IS_DEMO_RUNTIME && event.encounterId === 'enc-general')
          )}
          loading={timelineLoading}
          error={timelineError}
          integrity={timelineIntegrity}
          demo={IS_DEMO_RUNTIME}
        />
      )}


    </div>
  );
}
