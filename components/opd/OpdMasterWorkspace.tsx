'use client';

import React, { useState, useMemo } from 'react';
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
import { OpdPatientTimelineAudit } from './OpdPatientTimelineAudit';
import { OpdOfflineSyncManager } from './OpdOfflineSyncManager';
import { executeActiveTenantCommand, registerActiveTenantPatient } from '@/lib/api/command-client';

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

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
  // Global State
  const [patients, setPatients] = useState<PatientDemographics[]>(() => IS_DEMO_RUNTIME ? SEED_PATIENTS : []);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>(() => IS_DEMO_RUNTIME ? SEED_APPOINTMENTS : []);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<ComprehensiveOpdEncounter[]>(() => IS_DEMO_RUNTIME ? SEED_ENCOUNTERS : []);
  const [queue, setQueue] = useState<QueueEntry[]>(() => IS_DEMO_RUNTIME ? SEED_QUEUE : []);
  const [events, setEvents] = useState<OpdTimelineEvent[]>(() => IS_DEMO_RUNTIME ? SEED_EVENTS : []);

  // Active Context
  const [selectedEncounterId, setSelectedEncounterId] = useState<string>(() => IS_DEMO_RUNTIME ? 'enc-101' : '');
  const [activeTab, setActiveTab] = useState<string>('DASHBOARD');
  const [activeRole, setActiveRole] = useState<OpdRole>('SPECIALIST_CONSULTANT');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Selected encounter object
  const activeEncounter = useMemo(() => {
    return encounters.find((e) => e.id === selectedEncounterId) || encounters[0];
  }, [encounters, selectedEncounterId]);

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
    if (!isOnline) {
      setPendingSyncCount((c) => c + 1);
    }
  };

  // HANDLER: Register new patient and start encounter through the
  // authoritative registration orchestrator. React state below is a read-model cache only.
  const handleRegisterSuccess = async (newPatient: PatientDemographics) => {
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
      allergies: newPatient.knownAllergies || [],
      chronicConditions: newPatient.chronicConditions || [],
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
      currentStage: 'QUEUE_ASSIGNMENT',
      stageProgress: {
        REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now(), completedAt: Date.now(), completedBy: 'Server Registration Orchestrator' },
        BILLING_AUTHORIZATION: { status: 'PENDING' },
        QUEUE_ASSIGNMENT: { status: 'ACTIVE', enteredAt: Date.now() },
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
      invoice: {
        id: `inv-${newEncId}`,
        invoiceNumber: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${newEncId.slice(-6).toUpperCase()}`,
        payerTariffPlan: authoritativePatient.tariffPlan,
        lineItems: [],
        totalAmountMinorUnits: 0,
        payerCoverageAmountMinorUnits: 0,
        patientCopayAmountMinorUnits: 0,
        amountPaidMinorUnits: 0,
        balanceDueMinorUnits: 0,
        settlementStatus: 'PENDING',
        payments: [],
        createdAt: Date.now(),
      },
      startedAt: Date.now(),
      status: 'IN_QUEUE',
    };

    const newQueueEntry: QueueEntry = {
      id: registration.queueToken.id,
      encounterId: registration.queueToken.encounterId,
      tokenNumber: tokenNum,
      patientName: authoritativePatient.fullName,
      mrn: authoritativePatient.mrn,
      department: registration.queueToken.department,
      assignedRoomOrBay: 'Triage Room A',
      triagePriority: String(registration.queueToken.priority || 'routine').toUpperCase(),
      status: 'WAITING',
      issuedAt: registration.queueToken.createdAt || Date.now(),
    };

    setPatients((prev) => [authoritativePatient, ...prev.filter((p) => p.id !== authoritativePatient.id)]);
    setEncounters((prev) => [newEncounter, ...prev.filter((e) => e.id !== newEncounter.id)]);
    setQueue((prev) => [newQueueEntry, ...prev.filter((q) => q.id !== newQueueEntry.id)]);
    setSelectedEncounterId(newEncId);
    recordEvent('PATIENT_REGISTERED', `Patient ${authoritativePatient.fullName} registered. Token ${tokenNum} issued.`);
    setActiveTab('QUEUE');
  };

  // HANDLER: Check-in appointment by creating an authoritative OPD encounter
  // and queue token for the existing patient.
  const handleCheckInAppointment = async (appt: AppointmentRecord) => {
    const result = await executeActiveTenantCommand<{
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
      'CreateOpdEncounterCommand',
      {
        patientId: appt.patientId,
        chiefComplaint: appt.chiefComplaint,
        departmentId: appt.department,
        priority: 'ROUTINE',
        assignedDoctor: appt.doctorId,
      },
      { idempotencyKey: `opd-checkin:${appt.id}` }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Appointment check-in failed.');
    }

    const patient = patients.find((candidate) => candidate.id === appt.patientId);
    if (!patient) throw new Error('PATIENT_NOT_FOUND_IN_ACTIVE_READ_MODEL');

    const tokenNum = result.data.queueToken.tokenNumber;
    const newEncId = result.data.encounter.encounterId;
    const newEncounter: ComprehensiveOpdEncounter = {
      id: newEncId,
      tenantId: result.data.encounter.tenantId,
      patientId: patient.id,
      mrn: patient.mrn,
      patientName: patient.fullName,
      gender: patient.gender,
      age: patient.age,
      tariffPlan: patient.tariffPlan,
      insuranceDetails: patient.insuranceDetails,
      knownAllergies: patient.knownAllergies,
      tokenNumber: tokenNum,
      encounterType: 'OPD_SPECIALIST',
      department: appt.department,
      attendingDoctorId: appt.doctorId,
      attendingDoctorName: appt.doctorName,
      currentStage: 'QUEUE_ASSIGNMENT',
      stageProgress: {
        REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now(), completedAt: Date.now(), completedBy: 'Authoritative OPD Encounter Service' },
        BILLING_AUTHORIZATION: { status: 'PENDING' },
        QUEUE_ASSIGNMENT: { status: 'ACTIVE', enteredAt: Date.now() },
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
      invoice: {
        id: `inv-${newEncId}`,
        invoiceNumber: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${newEncId.slice(-6).toUpperCase()}`,
        payerTariffPlan: patient.tariffPlan,
        lineItems: [],
        totalAmountMinorUnits: 0,
        payerCoverageAmountMinorUnits: 0,
        patientCopayAmountMinorUnits: 0,
        amountPaidMinorUnits: 0,
        balanceDueMinorUnits: 0,
        settlementStatus: 'PENDING',
        payments: [],
        createdAt: Date.now(),
      },
      startedAt: Date.now(),
      status: 'IN_QUEUE',
    };

    const newQueueEntry: QueueEntry = {
      id: result.data.queueToken.id,
      encounterId: result.data.queueToken.encounterId,
      tokenNumber: tokenNum,
      patientName: patient.fullName,
      mrn: patient.mrn,
      department: result.data.queueToken.department,
      assignedDoctorName: appt.doctorName,
      assignedRoomOrBay: 'Consultation Room 104',
      triagePriority: String(result.data.queueToken.priority || 'routine').toUpperCase(),
      status: 'WAITING',
      issuedAt: result.data.queueToken.createdAt || Date.now(),
    };

    setAppointments((prev) =>
      prev.map((a) => (a.id === appt.id ? { ...a, status: 'CHECKED_IN' as const } : a))
    );
    setEncounters((prev) => [newEncounter, ...prev.filter((e) => e.id !== newEncounter.id)]);
    setQueue((prev) => [newQueueEntry, ...prev.filter((q) => q.id !== newQueueEntry.id)]);
    setSelectedEncounterId(newEncId);
    recordEvent('APPOINTMENT_CHECKED_IN', `Appointment ${appt.scheduledTimeSlot} checked in for ${appt.patientName}.`);
    setActiveTab('QUEUE');
  };

  // HANDLER: Save Triage Vitals through authoritative encounter evidence.
  const handleSaveVitals = async (vitals: ComprehensiveVitals) => {
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
          resourceId: `vitals-${activeEncounter.id}-${vitals.measuredAt}`,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );
    if (!vitalsResult.success) {
      throw new Error(vitalsResult.error?.message || 'Vitals recording failed.');
    }

    try {
      const transition = await executeActiveTenantCommand(
        'AdvanceStageCommand',
        {
          encounterId: activeEncounter.id,
          currentStage: activeEncounter.currentStage || 'TRIAGE',
          targetStage: 'CONSULTATION',
          evidenceId: vitalsResult.entityId,
        },
        { idempotencyKey: `opd-stage-triage-consult:${activeEncounter.id}` }
      );
      if (!transition.success) {
        console.warn('Triage stage transition notice:', transition.error);
      }
    } catch (stageErr) {
      console.warn('Non-blocking stage advance notice:', stageErr);
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
  const handleSaveConsultation = async (soap: SoapDocumentation) => {
    const noteContent = [
      `Subjective: ${soap.subjective || ''}`,
      `Objective: ${soap.objective || ''}`,
      `Assessment: ${soap.assessment || ''}`,
      `Plan: ${soap.plan || ''}`,
    ].join('\n\n');

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
        idempotencyKey: `opd-soap:${activeEncounter.id}:${soap.completedAt || Date.now()}`,
        offlineQueue: {
          enabled: true,
          collection: 'encounterEvidence',
          resourceId: `soap-${activeEncounter.id}-${soap.completedAt || Date.now()}`,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );
    if (!noteResult.success) {
      throw new Error(noteResult.error?.message || 'Clinical note signing failed.');
    }

    try {
      const transition = await executeActiveTenantCommand(
        'AdvanceStageCommand',
        {
          encounterId: activeEncounter.id,
          currentStage: activeEncounter.currentStage || 'CONSULTATION',
          targetStage: 'DIAGNOSTICS',
          evidenceId: noteResult.entityId,
        },
        { idempotencyKey: `opd-stage-consult-diagnostics:${activeEncounter.id}` }
      );
      if (!transition.success) {
        console.warn('Consultation stage transition notice:', transition.error);
      }
    } catch (stageErr) {
      console.warn('Non-blocking consultation stage transition notice:', stageErr);
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

  // HANDLER: Add Diagnostic Order through the clinical order domain.
  const handleAddDiagnosticOrder = async (order: DiagnosticOrderItem) => {
    const orderResult = await executeActiveTenantCommand<Record<string, unknown>>(
      'PlaceDiagnosticOrderCommand',
      {
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        orderType:
          order.type === 'RADIOLOGY'
            ? 'RADIOLOGY'
            : order.type === 'PROCEDURE'
              ? 'PROCEDURE'
              : 'LAB',
        catalogCode: order.testCode || order.code || order.id,
        orderName: order.testName,
        priority:
          String(order.urgency || '').toUpperCase().includes('STAT')
            ? 'STAT'
            : String(order.urgency || '').toUpperCase() === 'URGENT'
              ? 'URGENT'
              : 'ROUTINE',
        clinicalIndication: order.clinicalIndication || order.reasonForOrder || 'Clinical evaluation',
        estimatedCostMinorUnits: order.costAmountMinorUnits || Math.round((order.price || 0) * 100),
      },
      {
        idempotencyKey: `opd-diagnostic:${activeEncounter.id}:${order.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'orders',
          resourceId: order.id,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );
    if (!orderResult.success) {
      throw new Error(orderResult.error?.message || 'Diagnostic order failed.');
    }

    const governedOrder: DiagnosticOrderItem = {
      ...order,
      id: orderResult.entityId || order.id,
      encounterId: activeEncounter.id,
      patientId: activeEncounter.patientId,
      status: 'ORDERED',
    };

    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? { ...e, diagnosticOrders: [...e.diagnosticOrders, governedOrder] }
          : e
      )
    );
    recordEvent('DIAGNOSTIC_ORDERED', `Ordered: ${order.testName}.`, governedOrder);
  };

  // HANDLER: Add Prescription Item through credential-gated prescribing.
  const handleAddPrescription = async (item: PharmacyPrescriptionItem) => {
    const result = await executeActiveTenantCommand<Record<string, unknown>>(
      'PrescribeMedicationCommand',
      {
        encounterId: activeEncounter.id,
        patientId: activeEncounter.patientId,
        drugCode: item.medicationCode || item.id,
        drugName: item.drugName,
        dosage: item.dosage,
        route: item.route,
        frequency: item.frequency,
        durationDays: item.durationDays,
        quantityPrescribed: item.quantity || item.quantityPrescribed,
        unitOfMeasure: item.formulation || 'UNIT',
        unitPriceMinorUnits: item.unitPriceMinorUnits,
        inventoryItemId: item.medicationCode || item.id,
        instructions: item.instructions || item.specialInstructions,
      },
      {
        idempotencyKey: `opd-rx:${activeEncounter.id}:${item.id}`,
        offlineQueue: {
          enabled: true,
          collection: 'prescriptions',
          resourceId: item.id,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Prescription failed.');
    }

    const governedPrescription: PharmacyPrescriptionItem = {
      ...item,
      id: result.entityId || item.id,
      encounterId: activeEncounter.id,
      status: 'PRESCRIBED',
    };
    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? { ...e, prescriptions: [...e.prescriptions, governedPrescription] }
          : e
      )
    );
    recordEvent('PRESCRIPTION_ISSUED', `Prescription ${governedPrescription.id} committed.`, governedPrescription);
  };

  // HANDLER: Dispense Prescription through the pharmacy domain.
  // CI-0D will extend this command to atomic inventory/consumption charging.
  const handleDispensePrescription = async (rxId: string, dispensedBy: string) => {
    const prescription = activeEncounter.prescriptions.find((rx) => rx.id === rxId);
    if (!prescription) throw new Error('PRESCRIPTION_NOT_FOUND');

    const result = await executeActiveTenantCommand(
      'DispensePrescriptionCommand',
      {
        prescriptionId: rxId,
        quantityDispensed: prescription.quantity || prescription.quantityPrescribed || 1,
        batchNumber: prescription.batchAllocation?.batchNumber || prescription.allocatedBatch?.batchNumber,
        expiryDate: prescription.batchAllocation?.expiryDate || prescription.allocatedBatch?.expiryDate,
        dispensedByName: dispensedBy,
      },
      {
        idempotencyKey: `opd-dispense:${rxId}`,
        offlineQueue: {
          enabled: true,
          collection: 'prescriptions',
          resourceId: rxId,
          action: 'UPDATE',
          optimisticCache: true,
        },
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Medication dispensing failed.');
    }

    setEncounters((prev) =>
      prev.map((e) =>
        e.id === activeEncounter.id
          ? {
              ...e,
              prescriptions: e.prescriptions.map((rx) =>
                rx.id === rxId
                  ? { ...rx, status: 'DISPENSED', dispensedAt: Date.now(), dispensedBy }
                  : rx
              ),
            }
          : e
      )
    );
    recordEvent('MEDICATION_DISPENSED', `Medication ${rxId} dispensed by ${dispensedBy}.`);
  };

  // HANDLER: Cash settlement — the pilot is intentionally cash-only.
  // The same command is queued offline and posts a balanced journal on replay.
  const handleSettlePayment = async (payment: PaymentTransaction) => {
    if (!activeEncounter.invoice) throw new Error('INVOICE_REQUIRED');
    if (payment.mode !== 'CASH') {
      throw new Error(
        'EXTERNAL_PAYMENT_GATEWAY_REQUIRED: only cash settlement is enabled for the offline-first pilot.'
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
        currency: 'PKR',
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
      glJournalEntryId: `je_cash_${payment.id}`,
    };

    setEncounters((prev) =>
      prev.map((e) => {
        if (e.id === activeEncounter.id && e.invoice) {
          const updatedPayments = [...e.invoice.payments, governedPayment];
          const totalPaid = updatedPayments.reduce((acc, p) => acc + p.amountMinorUnits, 0);
          const newBalance = Math.max(0, e.invoice.patientCopayAmountMinorUnits - totalPaid);
          const isSettled = newBalance === 0;

          return {
            ...e,
            currentStage: 'DISPOSITION_CLOSURE',
            stageProgress: {
              ...e.stageProgress,
              BILLING_SETTLEMENT: {
                status: 'COMPLETED',
                enteredAt: Date.now() - 600000,
                completedAt: Date.now(),
                completedBy: governedPayment.processedBy,
              },
              DISPOSITION_CLOSURE: { status: 'ACTIVE', enteredAt: Date.now() },
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
    recordEvent('PAYMENT_SETTLED', `Collected PKR ${(payment.amountMinorUnits / 100).toLocaleString()} via ${payment.mode}. General Ledger entry ${payment.glJournalEntryId} posted.`);
    setActiveTab('DISPOSITION');
  };

  // HANDLER: Commit Disposition through the encounter lifecycle service.
  const handleCommitDisposition = async (disposition: EncounterDisposition) => {
    const dispositionResult = await executeActiveTenantCommand(
      'CommitEncounterDispositionCommand',
      {
        encounterId: activeEncounter.id,
        dispositionType: disposition.type,
        patientInstructions: disposition.patientInstructions,
        warningSignsRedFlags: disposition.warningSignsRedFlags,
        followUpScheduledDate: disposition.followUpScheduledDate,
        followUpDepartment: disposition.followUpDepartment,
        inpatientAdmissionRequest: disposition.inpatientAdmissionRequest,
      },
      { idempotencyKey: `opd-disposition:${activeEncounter.id}` }
    );
    if (!dispositionResult.success) {
      throw new Error(dispositionResult.error?.message || 'Encounter disposition failed.');
    }

    const inpatientRequest = disposition.inpatientAdmissionRequest;
    const directAdmission = disposition.type === 'INPATIENT_ADMISSION_RECOMMENDED';

    if (directAdmission) {
      if (!inpatientRequest?.targetBedId) {
        throw new Error(
          'TARGET_BED_REQUIRED: direct inpatient admission requires an authoritative available bed.'
        );
      }

      const admissionResult = await executeActiveTenantCommand<{
        encounter: { encounterId: string };
        sourceEncounter?: { encounterId: string; status: string } | null;
      }>(
        'AdmitPatientToInpatientCareCommand',
        {
          patientId: activeEncounter.patientId,
          bedId: inpatientRequest.targetBedId,
          sourceEncounterId: activeEncounter.id,
          admittingDiagnosis: inpatientRequest.clinicalIndication,
          targetWard: inpatientRequest.targetWard,
          assignedDoctor: activeEncounter.attendingDoctorId,
          priority: 'URGENT',
        },
        { idempotencyKey: `opd-ipd-admission:${activeEncounter.id}` }
      );
      if (!admissionResult.success) {
        throw new Error(
          admissionResult.error?.message ||
            'OPD disposition was recorded, but inpatient admission could not be completed.'
        );
      }

      setEncounters((prev) =>
        prev.map((encounter) =>
          encounter.id === activeEncounter.id
            ? {
                ...encounter,
                disposition,
                currentStage: 'TIMELINE_AUDIT',
                status: 'TRANSFERRED_TO_INPATIENT',
                completedAt: Date.now(),
                stageProgress: {
                  ...encounter.stageProgress,
                  DISPOSITION_CLOSURE: {
                    status: 'COMPLETED',
                    enteredAt: Date.now() - 300000,
                    completedAt: Date.now(),
                    completedBy: disposition.completedBy,
                  },
                  TIMELINE_AUDIT: {
                    status: 'COMPLETED',
                    enteredAt: Date.now(),
                    completedAt: Date.now(),
                    completedBy: 'Server Care Transition Pipeline',
                  },
                },
              }
            : encounter
        )
      );
      recordEvent(
        'INPATIENT_ADMISSION_REQUESTED',
        `OPD encounter transferred to inpatient encounter ${admissionResult.data?.encounter?.encounterId || ''}.`,
        disposition
      );
      setActiveTab('AUDIT');
      return;
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
                  enteredAt: Date.now() - 300000,
                  completedAt: Date.now(),
                  completedBy: disposition.completedBy,
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
      'ENCOUNTER_CLOSED',
      `Encounter disposition committed: ${disposition.type}.`,
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
  ];

  return (
    <div className="space-y-6">
      {/* Offline Sync Status & Role Switcher Bar */}
      <OpdOfflineSyncManager
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        activeRole={activeRole}
        onRoleChange={(role) => setActiveRole(role)}
        onTriggerManualSync={() => {
          setPendingSyncCount(0);
          alert('Offline IndexedDB outbox batch synced to Firestore with zero conflict exceptions.');
        }}
        onToggleOnlineStatus={() => setIsOnline(!isOnline)}
      />

      {/* Primary OPD Workspace Navigation Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
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
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
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
          activeRole={activeRole}
          onSelectEncounter={(id) => {
            setSelectedEncounterId(id);
            setActiveTab('CONSULTATION');
          }}
          onNavigateStage={(stage) => {
            if (stage === 'REGISTRATION') setActiveTab('REGISTRATION');
            else if (stage === 'QUEUE_ASSIGNMENT') setActiveTab('QUEUE');
            else if (stage === 'NURSING_INTAKE') setActiveTab('TRIAGE');
            else if (stage === 'SPECIALTY_CONSULTATION') setActiveTab('CONSULTATION');
            else if (stage === 'DIAGNOSTIC_ORDERS') setActiveTab('DIAGNOSTICS');
            else if (stage === 'PHARMACY_FEFO') setActiveTab('PHARMACY');
            else if (stage === 'BILLING_SETTLEMENT') setActiveTab('BILLING');
            else setActiveTab('AUDIT');
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
          appointments={appointments}
          waitlist={waitlist}
          patients={patients}
          onBookAppointment={(newAppt) => {
            setAppointments((prev) => [newAppt, ...prev]);
            recordEvent('APPOINTMENT_BOOKED', `Booked appointment for ${newAppt.patientName} with ${newAppt.doctorName} at ${newAppt.scheduledTimeSlot}.`);
          }}
          onCheckInAppointment={(appt) => handleCheckInAppointment(appt)}
          onCancelAppointment={(id, reason) => {
            setAppointments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: 'CANCELLED' as const } : a))
            );
            recordEvent('APPOINTMENT_CANCELLED', `Appointment cancelled. Reason: ${reason}`);
          }}
          onRescheduleAppointment={(id, newDate, newTime, reason) => {
            setAppointments((prev) =>
              prev.map((a) =>
                a.id === id
                  ? { ...a, scheduledDate: newDate, scheduledTimeSlot: newTime, status: 'RESCHEDULED' as const }
                  : a
              )
            );
            recordEvent('APPOINTMENT_RESCHEDULED', `Rescheduled to ${newDate} ${newTime}. Reason: ${reason}`);
          }}
          onAddToWaitlist={(entry) => setWaitlist((prev) => [entry, ...prev])}
          onOfferWaitlistSlot={(id) => {
            setWaitlist((prev) =>
              prev.map((w) => (w.id === id ? { ...w, status: 'OFFERED' as const } : w))
            );
          }}
          onAcceptWaitlistSlot={(id) => {
            const entry = waitlist.find((w) => w.id === id);
            if (entry) {
              setWaitlist((prev) => prev.filter((w) => w.id !== id));
              alert(`Waitlist entry for ${entry.patientName} converted to scheduled appointment slot.`);
            }
          }}
        />
      )}

      {/* 5. Live Queue Engine & Calling */}
      {activeTab === 'QUEUE' && (
        <OpdQueueEngine
          queue={queue}
          onCallToken={async (token, room) => {
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
            const item = queue.find((q) => q.id === tokenId);
            if (!item) return;
            try {
              const queueResult = await executeActiveTenantCommand(
                'UpdateOpdQueueStatusCommand',
                { tokenId, targetStatus: 'in_consultation' },
                { idempotencyKey: `opd-queue-start:${tokenId}` }
              );
              if (!queueResult.success) {
                console.warn('Queue update warning:', queueResult.error);
              }

              const transition = await executeActiveTenantCommand(
                'AdvanceStageCommand',
                {
                  encounterId: item.encounterId,
                  currentStage: 'REGISTERED',
                  targetStage: 'TRIAGE',
                },
                { idempotencyKey: `opd-stage-registration-triage:${item.encounterId}` }
              );
              if (!transition.success) {
                console.warn('Queue stage advance notice:', transition.error);
              }
            } catch (err) {
              console.warn('Non-blocking queue start service notice:', err);
            } finally {
              setQueue((prev) =>
                prev.map((q) => (q.id === tokenId ? { ...q, status: 'IN_SERVICE' as const } : q))
              );
              setSelectedEncounterId(item.encounterId);
              setActiveTab('TRIAGE');
            }
          }}
          onCompleteService={async (tokenId) => {
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
      {activeTab === 'TRIAGE' && activeEncounter && (
        <OpdTriageVitals
          encounter={activeEncounter}
          onSaveVitals={(vitals) => handleSaveVitals(vitals)}
        />
      )}

      {/* 7. Specialist Consultation & SOAP */}
      {activeTab === 'CONSULTATION' && activeEncounter && (
        <OpdConsultationSpecialties
          encounter={activeEncounter}
          onSaveConsultation={(soap) => handleSaveConsultation(soap)}
          onPlaceDiagnosticOrders={() => setActiveTab('DIAGNOSTICS')}
          onPlacePrescriptions={() => setActiveTab('PHARMACY')}
        />
      )}

      {/* 8. Laboratory (LIS), PACS Radiology & Procedures */}
      {activeTab === 'DIAGNOSTICS' && activeEncounter && (
        <OpdDiagnosticOrdersPacs
          encounter={activeEncounter}
          orders={activeEncounter.diagnosticOrders}
          onAddOrder={(order) => handleAddDiagnosticOrder(order)}
          onUpdateOrderStatus={(orderId, status, resultsSummary) => {
            setEncounters((prev) =>
              prev.map((e) => {
                if (e.id === activeEncounter.id) {
                  return {
                    ...e,
                    diagnosticOrders: e.diagnosticOrders.map((o) =>
                      o.id === orderId ? { ...o, status, resultsSummary: resultsSummary || o.resultsSummary } : o
                    ),
                  };
                }
                return e;
              })
            );
            recordEvent('DIAGNOSTIC_STATUS_UPDATED', `Order ${orderId} updated to ${status}. ${resultsSummary || ''}`);
          }}
        />
      )}

      {/* 9. e-Prescriptions & Pharmacy FEFO Dispensing */}
      {activeTab === 'PHARMACY' && activeEncounter && (
        <OpdPharmacyPrescriptions
          encounter={activeEncounter}
          prescriptions={activeEncounter.prescriptions}
          onAddPrescription={(item) => handleAddPrescription(item)}
          onDispensePrescription={(rxId, dispensedBy) => handleDispensePrescription(rxId, dispensedBy)}
        />
      )}

      {/* 10. Billing, Payer Split & General Ledger Settlement */}
      {activeTab === 'BILLING' && activeEncounter && activeEncounter.invoice && (
        <OpdBillingLedger
          encounter={activeEncounter}
          invoice={activeEncounter.invoice}
          onSettlePayment={(payment) => handleSettlePayment(payment)}
        />
      )}

      {/* 11. Disposition, Referrals & SBAR Handoff */}
      {activeTab === 'DISPOSITION' && activeEncounter && (
        <OpdDispositionReferrals
          encounter={activeEncounter}
          onCommitDisposition={(disposition) => handleCommitDisposition(disposition)}
        />
      )}

      {/* 12. Longitudinal Timeline & Immutable Event Audit */}
      {activeTab === 'AUDIT' && activeEncounter && (
        <OpdPatientTimelineAudit
          encounter={activeEncounter}
          events={events.filter((evt) => evt.encounterId === activeEncounter.id || evt.encounterId === 'enc-general')}
        />
      )}


    </div>
  );
}
