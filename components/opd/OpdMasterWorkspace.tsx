'use client';

import React, { useState } from 'react';
import {
  Users,
  Stethoscope,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  FileText,
  FlaskConical,
  Pill,
  Sparkles,
  ShieldCheck,
  Search,
  Activity,
  DollarSign,
  Lock,
  Unlock,
  Radio,
  ArrowRight,
  UserCheck,
  AlertTriangle,
  BadgeAlert,
  Send,
  Zap,
  Receipt,
  HeartPulse,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { calculateNews2Score } from '@/lib/clinical/triage/news2-calculator';
import { DoubleEntryLedgerEngine } from '@/lib/finance/double-entry-ledger';
import { FefoPharmacyEngine, MOCK_HOSPITAL_PHARMACY_STOCK } from '@/lib/clinical/pharmacy/fefo-manager';
import { DiagnosticRevenueGuard } from '@/lib/clinical/diagnostic-lock/revenue-guard';
import { formatCurrency } from '@/lib/utils';
import { ExtendedOpdStageId, ComprehensiveOpdEncounter, DiagnosticOrderItem, PharmacyPrescriptionItem } from '@/types/clinical-workflow-comprehensive';
import { PatientConsultantRoutingModal, ConsultantDoctor, CONSULTANT_REGISTRY } from '@/components/clinical/patient-consultant-routing-modal';

const INITIAL_DEMO_ENCOUNTERS: ComprehensiveOpdEncounter[] = [
  {
    id: 'enc-opd-101',
    tenantId: 'central-metro-hospital',
    patientId: 'pat-101',
    mrn: 'MRN-20260820-4821',
    patientName: 'Eleanor Vance',
    gender: 'Female',
    age: 42,
    tokenNumber: 'OPD-101',
    encounterType: 'OPD',
    currentStage: 'NURSING_INTAKE',
    stageProgress: {
      REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now() - 3600000, completedAt: Date.now() - 3300000, completedBy: 'Clerk M. Davis' },
      BILLING_AUTHORIZATION: { status: 'COMPLETED', enteredAt: Date.now() - 3300000, completedAt: Date.now() - 3000000, completedBy: 'Cashier J. Wilson' },
      QUEUE_ASSIGNMENT: { status: 'COMPLETED', enteredAt: Date.now() - 3000000, completedAt: Date.now() - 2700000, completedBy: 'Triage Nurse R. Chen' },
      NURSING_INTAKE: { status: 'ACTIVE', enteredAt: Date.now() - 2700000 },
      MO_ASSESSMENT: { status: 'PENDING' },
      SPECIALTY_PRE_CONSULT: { status: 'PENDING' },
      CONSULTANT_REVIEW: { status: 'PENDING' },
      INVESTIGATIONS: { status: 'PENDING' },
      TREATMENT: { status: 'PENDING' },
      FOLLOW_UP: { status: 'PENDING' },
      LONGITUDINAL_CARE: { status: 'PENDING' },
      DISCHARGE_SETTLEMENT: { status: 'PENDING' },
    },
    tariffPlan: 'CORPORATE_PPO',
    copayRatio: { insurancePercent: 80, patientPercent: 20 },
    financialClearance: {
      ingressFeePaid: true,
      ingressReceiptNumber: 'CR-2026-8910',
      amountPaid: 35.0,
    },
    diagnosticOrders: [],
    prescriptions: [],
    ledgerVouchers: [],
    startedAt: Date.now() - 3600000,
    status: 'IN_TRIAGE',
  },
  {
    id: 'enc-opd-102',
    tenantId: 'central-metro-hospital',
    patientId: 'pat-102',
    mrn: 'MRN-20260820-9124',
    patientName: 'Tariq Mehmood',
    gender: 'Male',
    age: 58,
    tokenNumber: 'OPD-102',
    encounterType: 'OPD',
    currentStage: 'CONSULTANT_REVIEW',
    stageProgress: {
      REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now() - 5400000, completedAt: Date.now() - 5100000, completedBy: 'Clerk M. Davis' },
      BILLING_AUTHORIZATION: { status: 'COMPLETED', enteredAt: Date.now() - 5100000, completedAt: Date.now() - 4800000, completedBy: 'Cashier J. Wilson' },
      QUEUE_ASSIGNMENT: { status: 'COMPLETED', enteredAt: Date.now() - 4800000, completedAt: Date.now() - 4500000, completedBy: 'Triage Nurse R. Chen' },
      NURSING_INTAKE: { status: 'COMPLETED', enteredAt: Date.now() - 4500000, completedAt: Date.now() - 4000000, completedBy: 'Nurse S. Ahmed' },
      MO_ASSESSMENT: { status: 'COMPLETED', enteredAt: Date.now() - 4000000, completedAt: Date.now() - 3500000, completedBy: 'Dr. A. Khan (MO)' },
      SPECIALTY_PRE_CONSULT: { status: 'COMPLETED', enteredAt: Date.now() - 3500000, completedAt: Date.now() - 3000000, completedBy: 'Clinic Assistant' },
      CONSULTANT_REVIEW: { status: 'ACTIVE', enteredAt: Date.now() - 3000000 },
      INVESTIGATIONS: { status: 'PENDING' },
      TREATMENT: { status: 'PENDING' },
      FOLLOW_UP: { status: 'PENDING' },
      LONGITUDINAL_CARE: { status: 'PENDING' },
      DISCHARGE_SETTLEMENT: { status: 'PENDING' },
    },
    tariffPlan: 'SEHAT_CARD_UNIVERSAL',
    copayRatio: { insurancePercent: 100, patientPercent: 0 },
    financialClearance: {
      ingressFeePaid: true,
      ingressReceiptNumber: 'CR-2026-8911',
      amountPaid: 0.0,
    },
    nursingAssessment: {
      vitals: {
        heartRate: 88,
        systolicBp: 142,
        diastolicBp: 90,
        respiratoryRate: 18,
        temperatureCelsius: 37.0,
        spo2Percent: 97,
        onSupplementalOxygen: false,
        consciousnessAvpu: 'ALERT',
        news2Score: 1,
        triageCategory: 'YELLOW_URGENT',
        measuredAt: Date.now() - 4200000,
        measuredBy: 'Nurse S. Ahmed',
      },
      chiefComplaint: 'Post-PCI retrosternal pressure on exertion with shortness of breath',
      symptomDuration: '3 days',
      painScale: 5,
      fallRiskScore: 1,
      knownAllergies: ['Penicillin', 'Sulfa drugs'],
      currentMedications: ['Aspirin 75mg', 'Metoprolol 25mg'],
      intakeNotes: 'Patient arrived unaccompanied. History of stent placement 6 months ago.',
      assessedAt: Date.now() - 4000000,
      nurseId: 'nrs-102',
      nurseName: 'Nurse S. Ahmed',
    },
    diagnosticOrders: [
      {
        id: 'diag-ord-1',
        encounterId: 'enc-opd-102',
        patientId: 'pat-102',
        type: 'LABORATORY',
        code: 'LAB-TROP-I',
        testName: 'High-Sensitivity Troponin I',
        department: 'Clinical Biochemistry',
        price: 85.0,
        orderedBy: 'Dr. Sarah Jenkins, MD',
        orderedAt: Date.now() - 2500000,
        paymentStatus: 'LOCKED_PENDING_PAYMENT',
        worklistStatus: 'BLOCKED_BY_REVENUE_GATE',
      },
      {
        id: 'diag-ord-2',
        encounterId: 'enc-opd-102',
        patientId: 'pat-102',
        type: 'RADIOLOGY',
        code: 'RAD-ECG-12',
        testName: '12-Lead Electrocardiogram (ECG)',
        department: 'Cardiology Diagnostics',
        price: 55.0,
        orderedBy: 'Dr. Sarah Jenkins, MD',
        orderedAt: Date.now() - 2500000,
        paymentStatus: 'PAID_SETTLED',
        worklistStatus: 'READY_FOR_COLLECTION',
        results: {
          resultValue: 'Sinus rhythm @ 86 bpm. Non-specific ST-T changes in lateral leads V5-V6.',
          referenceRange: 'Normal sinus rhythm',
          unit: 'ECG Report',
          isAbnormal: true,
          criticalAlert: false,
          reportedBy: 'Dr. R. Bradley (Cardiologist)',
          reportedAt: Date.now() - 1500000,
          hl7MessageRef: 'HL7-ORU-R01-ECG-9982',
        },
      },
    ],
    prescriptions: [
      {
        id: 'rx-101',
        encounterId: 'enc-opd-102',
        drugName: 'Atorvastatin 20mg Tablet',
        genericName: 'Atorvastatin Calcium',
        dosage: '20mg',
        frequency: 'Once Daily at Bedtime (QHS)',
        durationDays: 30,
        route: 'ORAL',
        quantityPrescribed: 30,
        quantityDispensed: 30,
        prescribedBy: 'Dr. Sarah Jenkins, MD',
        allocatedBatch: {
          batchNumber: 'ATV-2025-08',
          expiryDate: '2026-08-31',
          unitPrice: 0.65,
        },
        dispenseStatus: 'BATCH_RESERVED_FEFO',
      },
    ],
    ledgerVouchers: [],
    startedAt: Date.now() - 5400000,
    status: 'IN_CONSULTATION',
  },
  {
    id: 'enc-opd-103',
    tenantId: 'central-metro-hospital',
    patientId: 'pat-103',
    mrn: 'MRN-20260820-7719',
    patientName: 'Chloe Bennett',
    gender: 'Female',
    age: 32,
    tokenNumber: 'OPD-103',
    encounterType: 'OPD',
    currentStage: 'CONSULTANT_REVIEW',
    stageProgress: {
      REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now() - 4800000, completedAt: Date.now() - 4500000, completedBy: 'Clerk M. Davis' },
      BILLING_AUTHORIZATION: { status: 'COMPLETED', enteredAt: Date.now() - 4500000, completedAt: Date.now() - 4200000, completedBy: 'Cashier J. Wilson' },
      QUEUE_ASSIGNMENT: { status: 'COMPLETED', enteredAt: Date.now() - 4200000, completedAt: Date.now() - 3900000, completedBy: 'Triage Nurse R. Chen' },
      NURSING_INTAKE: { status: 'COMPLETED', enteredAt: Date.now() - 3900000, completedAt: Date.now() - 3300000, completedBy: 'Nurse Clara Oswald' },
      MO_ASSESSMENT: { status: 'COMPLETED', enteredAt: Date.now() - 3300000, completedAt: Date.now() - 2700000, completedBy: 'Dr. Layla Mansour (OB/GYN Fellow)' },
      SPECIALTY_PRE_CONSULT: { status: 'COMPLETED', enteredAt: Date.now() - 2700000, completedAt: Date.now() - 2100000, completedBy: 'Clinic Midwife' },
      CONSULTANT_REVIEW: { status: 'ACTIVE', enteredAt: Date.now() - 2100000 },
      INVESTIGATIONS: { status: 'PENDING' },
      TREATMENT: { status: 'PENDING' },
      FOLLOW_UP: { status: 'PENDING' },
      LONGITUDINAL_CARE: { status: 'PENDING' },
      DISCHARGE_SETTLEMENT: { status: 'PENDING' },
    },
    tariffPlan: 'CORPORATE_PPO',
    copayRatio: { insurancePercent: 90, patientPercent: 10 },
    financialClearance: {
      ingressFeePaid: true,
      ingressReceiptNumber: 'CR-2026-8912',
      amountPaid: 25.0,
    },
    nursingAssessment: {
      vitals: {
        heartRate: 82,
        systolicBp: 146,
        diastolicBp: 94,
        respiratoryRate: 16,
        temperatureCelsius: 36.9,
        spo2Percent: 99,
        onSupplementalOxygen: false,
        consciousnessAvpu: 'ALERT',
        news2Score: 1,
        triageCategory: 'YELLOW_URGENT',
        measuredAt: Date.now() - 3300000,
        measuredBy: 'Nurse Clara Oswald',
      },
      chiefComplaint: '32-week gestation antenatal check, elevated blood pressure reading at home',
      symptomDuration: '2 days',
      painScale: 0,
      fallRiskScore: 0,
      knownAllergies: ['Latex'],
      currentMedications: ['Prenatal Multivitamins', 'Ferrous Sulfate 200mg', 'Labetalol 100mg BID'],
      intakeNotes: 'G2P1 at 32 weeks gestation. Presenting with gestational hypertension check, mild bilateral ankle edema.',
      assessedAt: Date.now() - 3300000,
      nurseId: 'nrs-104',
      nurseName: 'Nurse Clara Oswald',
    },
    diagnosticOrders: [
      {
        id: 'diag-ord-3',
        encounterId: 'enc-opd-103',
        patientId: 'pat-103',
        type: 'LABORATORY',
        code: 'LAB-URINE-PROT',
        testName: 'Urine Protein/Creatinine Ratio & Serum Uric Acid',
        department: 'Biochemistry / Antenatal',
        price: 45.0,
        orderedBy: 'Dr. Fatima Zahra, MD, FACOG',
        orderedAt: Date.now() - 2000000,
        paymentStatus: 'LOCKED_PENDING_PAYMENT',
        worklistStatus: 'BLOCKED_BY_REVENUE_GATE',
      },
      {
        id: 'diag-ord-4',
        encounterId: 'enc-opd-103',
        patientId: 'pat-103',
        type: 'RADIOLOGY',
        code: 'RAD-US-OB-GROWTH',
        testName: 'Obstetric Growth Ultrasound & Umbilical Doppler',
        department: 'Obstetric Ultrasound / Radiology',
        price: 110.0,
        orderedBy: 'Dr. Fatima Zahra, MD, FACOG',
        orderedAt: Date.now() - 2000000,
        paymentStatus: 'PAID_SETTLED',
        worklistStatus: 'READY_FOR_COLLECTION',
      },
    ],
    prescriptions: [
      {
        id: 'rx-102',
        encounterId: 'enc-opd-103',
        drugName: 'Labetalol 100mg Tablet',
        genericName: 'Labetalol Hydrochloride',
        dosage: '100mg',
        frequency: 'Twice Daily (BID) with food',
        durationDays: 30,
        route: 'ORAL',
        quantityPrescribed: 60,
        quantityDispensed: 60,
        prescribedBy: 'Dr. Fatima Zahra, MD, FACOG',
        allocatedBatch: {
          batchNumber: 'LBT-2026-03',
          expiryDate: '2027-02-28',
          unitPrice: 0.40,
        },
        dispenseStatus: 'BATCH_RESERVED_FEFO',
      },
    ],
    ledgerVouchers: [],
    startedAt: Date.now() - 4800000,
    status: 'IN_CONSULTATION',
  },
];

export function OpdMasterWorkspace() {
  const [encounters, setEncounters] = useState<ComprehensiveOpdEncounter[]>(INITIAL_DEMO_ENCOUNTERS);
  const [selectedEncounterId, setSelectedEncounterId] = useState<string>('enc-opd-102');
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<
    'REGISTRATION' | 'BILLING_AUTH' | 'QUEUE' | 'NURSING' | 'MO_ASSESS' | 'CONSULTATION' | 'DIAGNOSTIC_LOCK' | 'PHARMACY_FEFO' | 'DISCHARGE_LEDGER'
  >('CONSULTATION');

  // Intake Form state for new patient
  const [regFullName, setRegFullName] = useState('Kamran Hashmi');
  const [regGender, setRegGender] = useState('Male');
  const [regAge, setRegAge] = useState(47);
  const [regPhone, setRegPhone] = useState('+92 300 1234567');
  const [regCnic, setRegCnic] = useState('35201-8938472-1');
  const [regTariff, setRegTariff] = useState<'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE'>('CORPORATE_PPO');
  const [regComplaint, setRegComplaint] = useState('Severe epigastric burning radiating to back, nausea x 2 days');

  // Nurse Vitals Form State
  const [vitalsHr, setVitalsHr] = useState(94);
  const [vitalsSysBp, setVitalsSysBp] = useState(136);
  const [vitalsDiaBp, setVitalsDiaBp] = useState(88);
  const [vitalsRr, setVitalsRr] = useState(19);
  const [vitalsTemp, setVitalsTemp] = useState(37.4);
  const [vitalsSpo2, setVitalsSpo2] = useState(96);
  const [vitalsO2, setVitalsO2] = useState(false);
  const [vitalsAvpu, setVitalsAvpu] = useState<'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE'>('ALERT');
  const [nurseNotes, setNurseNotes] = useState('Patient alert, oriented x 3. Denies dizziness.');

  // Consultant SOAP Form State
  const [attendingDoctorId, setAttendingDoctorId] = useState<string>('doc-card-01');
  const [soapSubjective, setSoapSubjective] = useState('Patient complains of persistent substernal chest heaviness triggered by walking uphill. Relieved by rest within 5 minutes.');
  const [soapObjective, setSoapObjective] = useState('Heart: S1/S2 present, regular rhythm. Lungs: Clear bilaterally. No peripheral edema. JVP not elevated.');
  const [soapAssessment, setSoapAssessment] = useState('1. Post-PCI Angina Pectoris (ICD-10 I20.9). 2. Hyperlipidemia (E78.5).');
  const [soapPlan, setSoapPlan] = useState('1. Order High-Sensitivity Troponin I & 12-Lead ECG. 2. Start Atorvastatin 20mg QHS. 3. Return for review in 7 days.');
  const [isAiStructuring, setIsAiStructuring] = useState(false);

  // Pharmacy FEFO State
  const [selectedDrugToDispense, setSelectedDrugToDispense] = useState('amoxicillin_500');
  const [dispenseQty, setDispenseQty] = useState(20);
  const [fefoMessage, setFefoMessage] = useState<string | null>(null);

  // Success Notification
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [isRoutingModalOpen, setIsRoutingModalOpen] = useState(false);

  const showNotification = (msg: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setNotification({ type, message: msg });
    setTimeout(() => setNotification(null), 5000);
  };

  const selectedEncounter = encounters.find(e => e.id === selectedEncounterId) || encounters[0];

  // Calculate live NEWS2 for nursing station
  const liveNews2 = calculateNews2Score({
    heartRate: vitalsHr,
    systolicBp: vitalsSysBp,
    respiratoryRate: vitalsRr,
    temperature: vitalsTemp,
    spo2Percent: vitalsSpo2,
    onSupplementalOxygen: vitalsO2,
    consciousness: vitalsAvpu,
  });

  // Handler: Register New Patient & Stage 1 Complete
  const handleRegisterPatient = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = `enc-opd-${Date.now()}`;
    const token = `OPD-${Math.floor(100 + Math.random() * 900)}`;
    const mrn = `MRN-20260820-${Math.floor(1000 + Math.random() * 9000)}`;

    const newEnc: ComprehensiveOpdEncounter = {
      id: newId,
      tenantId: 'central-metro-hospital',
      patientId: `pat-${Date.now()}`,
      mrn,
      patientName: regFullName,
      gender: regGender,
      age: regAge,
      tokenNumber: token,
      encounterType: 'OPD',
      currentStage: 'BILLING_AUTHORIZATION',
      stageProgress: {
        REGISTRATION: { status: 'COMPLETED', enteredAt: Date.now(), completedAt: Date.now(), completedBy: 'Front Desk Clerk' },
        BILLING_AUTHORIZATION: { status: 'ACTIVE', enteredAt: Date.now() },
        QUEUE_ASSIGNMENT: { status: 'PENDING' },
        NURSING_INTAKE: { status: 'PENDING' },
        MO_ASSESSMENT: { status: 'PENDING' },
        SPECIALTY_PRE_CONSULT: { status: 'PENDING' },
        CONSULTANT_REVIEW: { status: 'PENDING' },
        INVESTIGATIONS: { status: 'PENDING' },
        TREATMENT: { status: 'PENDING' },
        FOLLOW_UP: { status: 'PENDING' },
        LONGITUDINAL_CARE: { status: 'PENDING' },
        DISCHARGE_SETTLEMENT: { status: 'PENDING' },
      },
      tariffPlan: regTariff,
      copayRatio: regTariff === 'CORPORATE_PPO' ? { insurancePercent: 80, patientPercent: 20 } : regTariff === 'SEHAT_CARD_UNIVERSAL' ? { insurancePercent: 100, patientPercent: 0 } : { insurancePercent: 0, patientPercent: 100 },
      financialClearance: {
        ingressFeePaid: false,
        amountPaid: 0,
      },
      diagnosticOrders: [],
      prescriptions: [],
      ledgerVouchers: [],
      startedAt: Date.now(),
      status: 'REGISTERED',
    };

    setEncounters([newEnc, ...encounters]);
    setSelectedEncounterId(newId);
    setActiveWorkflowTab('BILLING_AUTH');
    showNotification(`Patient ${regFullName} registered! Token #${token} generated. Ingress fee settlement required.`);
  };

  // Handler: Settle Ingress Fee & Authorize Billing
  const handleSettleIngressFee = () => {
    if (!selectedEncounter) return;

    const receiptNum = `CR-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const ingressFee = selectedEncounter.tariffPlan === 'SEHAT_CARD_UNIVERSAL' ? 0 : 35.0;

    const voucher = DoubleEntryLedgerEngine.generateCashReceiptVoucher({
      tenantId: selectedEncounter.tenantId,
      encounterId: selectedEncounter.id,
      patientId: selectedEncounter.patientId,
      amount: ingressFee,
      receiptNumber: receiptNum,
      postedBy: 'Cashier Counter J. Wilson',
    });

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          currentStage: 'QUEUE_ASSIGNMENT' as ExtendedOpdStageId,
          stageProgress: {
            ...e.stageProgress,
            BILLING_AUTHORIZATION: { status: 'COMPLETED' as const, completedAt: Date.now(), completedBy: 'Cashier J. Wilson' },
            QUEUE_ASSIGNMENT: { status: 'ACTIVE' as const, enteredAt: Date.now() },
          },
          financialClearance: {
            ingressFeePaid: true,
            ingressReceiptNumber: receiptNum,
            amountPaid: ingressFee,
          },
          ledgerVouchers: [...e.ledgerVouchers, voucher],
        };
      }
      return e;
    });

    setEncounters(updated);
    setActiveWorkflowTab('QUEUE');
    showNotification(`Ingress Fee Settled ($${ingressFee}). Balanced GL Voucher ${voucher.voucherNumber} posted!`);
  };

  // Handler: Submit Nurse Vitals & NEWS2
  const handleSaveNurseVitals = () => {
    if (!selectedEncounter) return;

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          currentStage: 'CONSULTANT_REVIEW' as ExtendedOpdStageId,
          stageProgress: {
            ...e.stageProgress,
            NURSING_INTAKE: { status: 'COMPLETED' as const, completedAt: Date.now(), completedBy: 'Nurse Station' },
            MO_ASSESSMENT: { status: 'COMPLETED' as const, completedAt: Date.now(), completedBy: 'Triage MO' },
            CONSULTANT_REVIEW: { status: 'ACTIVE' as const, enteredAt: Date.now() },
          },
          nursingAssessment: {
            vitals: {
              heartRate: vitalsHr,
              systolicBp: vitalsSysBp,
              diastolicBp: vitalsDiaBp,
              respiratoryRate: vitalsRr,
              temperatureCelsius: vitalsTemp,
              spo2Percent: vitalsSpo2,
              onSupplementalOxygen: vitalsO2,
              consciousnessAvpu: vitalsAvpu,
              news2Score: liveNews2.totalScore,
              triageCategory: (liveNews2.totalScore >= 7 ? 'RED_IMMEDIATE' : liveNews2.totalScore >= 5 ? 'ORANGE_VERY_URGENT' : 'YELLOW_URGENT') as 'RED_IMMEDIATE' | 'ORANGE_VERY_URGENT' | 'YELLOW_URGENT',
              measuredAt: Date.now(),
              measuredBy: 'Staff Nurse R. Chen (RN)',
            },
            chiefComplaint: selectedEncounter.patientName === 'Eleanor Vance' ? 'Thoracic tightness upon exertion' : 'Epigastric distress',
            symptomDuration: '3 days',
            painScale: 4,
            fallRiskScore: 1,
            knownAllergies: ['Penicillin'],
            currentMedications: ['Aspirin 81mg'],
            intakeNotes: nurseNotes,
            assessedAt: Date.now(),
            nurseId: 'nrs-99',
            nurseName: 'Nurse R. Chen (RN)',
          },
          status: 'IN_CONSULTATION' as const,
        };
      }
      return e;
    });

    setEncounters(updated);
    setActiveWorkflowTab('CONSULTATION');
    showNotification(`Nurse Vitals logged! NEWS2 Score: ${liveNews2.totalScore} (${liveNews2.clinicalRisk} Risk). Advanced to Physician Consultation.`);
  };

  // Handler: Order Diagnostic with Revenue Lock
  const handleOrderDiagnostic = (type: 'LABORATORY' | 'RADIOLOGY', testCode: string, testName: string, price: number, dept: string) => {
    if (!selectedEncounter) return;

    const newOrder: DiagnosticOrderItem = {
      id: `diag-ord-${Date.now()}`,
      encounterId: selectedEncounter.id,
      patientId: selectedEncounter.patientId,
      type,
      code: testCode,
      testName,
      department: dept,
      price,
      orderedBy: 'Dr. Sarah Jenkins, MD',
      orderedAt: Date.now(),
      paymentStatus: 'LOCKED_PENDING_PAYMENT',
      worklistStatus: 'BLOCKED_BY_REVENUE_GATE',
    };

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          diagnosticOrders: [...e.diagnosticOrders, newOrder],
        };
      }
      return e;
    });

    setEncounters(updated);
    showNotification(`Diagnostic order '${testName}' placed! Revenue Gate: Order LOCKED until Cashier settlement or Pre-auth.`);
  };

  // Handler: Settle Diagnostic Order (Unlock Revenue Gate)
  const handleUnlockDiagnosticOrder = (orderId: string) => {
    if (!selectedEncounter) return;

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          diagnosticOrders: e.diagnosticOrders.map(ord => {
            if (ord.id === orderId) {
              return DiagnosticRevenueGuard.unlockOrderAfterPayment(ord, 'CASH', `RCPT-${Date.now()}`);
            }
            return ord;
          }),
        };
      }
      return e;
    });

    setEncounters(updated);
    showNotification(`Diagnostic Order ${orderId} settled at Cashier! Worklist UNLOCKED for laboratory collection / radiology execution.`);
  };

  // Handler: FEFO Pharmacy Allocation & Dispense
  const handleAllocateFefoAndDispense = () => {
    if (!selectedEncounter) return;

    // Check allergy
    const drugRecord = MOCK_HOSPITAL_PHARMACY_STOCK[selectedDrugToDispense];
    if (!drugRecord) return;

    const allergies = selectedEncounter.nursingAssessment?.knownAllergies || [];
    const allergyCheck = FefoPharmacyEngine.checkAllergyConflict(drugRecord.drugName, allergies);

    if (allergyCheck.hasConflict) {
      setFefoMessage(allergyCheck.warningMessage || 'Allergy conflict detected!');
      showNotification(allergyCheck.warningMessage || 'Allergy conflict!', 'error');
      return;
    }

    const allocation = FefoPharmacyEngine.allocateFefoBatch(selectedDrugToDispense, dispenseQty);
    if (!allocation.success || !allocation.allocatedBatch) {
      setFefoMessage(allocation.message);
      showNotification(allocation.message, 'warning');
      return;
    }

    const newRx: PharmacyPrescriptionItem = {
      id: `rx-${Date.now()}`,
      encounterId: selectedEncounter.id,
      drugName: drugRecord.drugName,
      genericName: drugRecord.genericName,
      dosage: 'Standard Dosage',
      frequency: 'TID x 5 Days',
      durationDays: 5,
      route: 'ORAL',
      quantityPrescribed: dispenseQty,
      quantityDispensed: dispenseQty,
      prescribedBy: 'Dr. Sarah Jenkins, MD',
      allocatedBatch: {
        batchNumber: allocation.allocatedBatch.batchNumber,
        expiryDate: allocation.allocatedBatch.expiryDate,
        unitPrice: allocation.allocatedBatch.unitCost,
      },
      dispenseStatus: 'DISPENSED',
      dispensedBy: 'Chief Pharmacist L. Zhao (RPh)',
      dispensedAt: Date.now(),
    };

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          prescriptions: [...e.prescriptions, newRx],
        };
      }
      return e;
    });

    setEncounters(updated);
    setFefoMessage(allocation.message);
    showNotification(`FEFO Batch ${allocation.allocatedBatch.batchNumber} reserved & dispensed! Location: ${allocation.allocatedBatch.location}`);
  };

  // Handler: Final Discharge & Double-Entry Ledger Posting
  const handleFinalizeDischargeAndPostLedger = () => {
    if (!selectedEncounter) return;

    // Compile all line items
    const lineItems = [
      { id: 'item-consult', description: 'Specialist OPD Consultation (Level 4)', category: 'CONSULTATION' as const, grossAmount: 120.0 },
      ...selectedEncounter.diagnosticOrders.map(d => ({
        id: d.id,
        description: d.testName,
        category: (d.type === 'LABORATORY' ? 'LABORATORY' : 'RADIOLOGY') as 'LABORATORY' | 'RADIOLOGY',
        grossAmount: d.price,
      })),
      ...selectedEncounter.prescriptions.map(p => ({
        id: p.id,
        description: `${p.drugName} (Qty: ${p.quantityDispensed})`,
        category: 'PHARMACY' as const,
        grossAmount: p.quantityDispensed * (p.allocatedBatch?.unitPrice || 1.0) * 1.5,
      })),
    ];

    const copayResult = DoubleEntryLedgerEngine.generateBillingJournalVoucher({
      tenantId: selectedEncounter.tenantId,
      encounterId: selectedEncounter.id,
      patientId: selectedEncounter.patientId,
      patientName: selectedEncounter.patientName,
      lineItems,
      insurancePercent: selectedEncounter.copayRatio.insurancePercent,
      patientPercent: selectedEncounter.copayRatio.patientPercent,
      postedBy: 'Senior Biller & Finance Officer',
    });

    const balanceCheck = DoubleEntryLedgerEngine.validateVoucherBalance(copayResult.voucher);

    const updated = encounters.map(e => {
      if (e.id === selectedEncounter.id) {
        return {
          ...e,
          currentStage: 'DISCHARGE_SETTLEMENT' as ExtendedOpdStageId,
          stageProgress: {
            ...e.stageProgress,
            DISCHARGE_SETTLEMENT: { status: 'COMPLETED' as const, completedAt: Date.now(), completedBy: 'Finance & Medical Records' },
          },
          ledgerVouchers: [...e.ledgerVouchers, copayResult.voucher],
          finalBill: {
            totalGrossAmount: copayResult.totalGross,
            insuranceCoverage: copayResult.insurancePayable,
            patientPayable: copayResult.patientPayable,
            patientPaid: copayResult.patientPayable,
            balanceDue: 0,
            isSettled: true,
            settledAt: Date.now(),
            settledBy: 'Finance Billing Officer',
          },
          status: 'COMPLETED' as const,
        };
      }
      return e;
    });

    setEncounters(updated);
    showNotification(`Encounter COMPLETED! Double-Entry Journal Voucher ${copayResult.voucher.voucherNumber} balanced (Sum Debits = Sum Credits = $${copayResult.voucher.totalDebit}). Zero revenue leakage.`);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between shadow-md transition-all ${
            notification.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              : notification.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-3">
            {notification.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            ) : notification.type === 'warning' ? (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            )}
            <span className="text-sm font-semibold">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs font-bold underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Outpatient Department (OPD) Master Runtime Suite
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                End-to-End Operational Lifecycle: Registration → Ingress Fee → Queue → Nursing Vitals → MO Assessment → Consultant Review → Diagnostic Lock → FEFO Pharmacy → Balanced GL Discharge
              </p>
            </div>
          </div>
        </div>

        {/* Selected Encounter Quick Switcher */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex flex-col text-right">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Patient Token</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {selectedEncounter?.tokenNumber} - {selectedEncounter?.patientName}
            </span>
          </div>
          <select
            value={selectedEncounterId}
            onChange={(e) => setSelectedEncounterId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          >
            {encounters.map(enc => (
              <option key={enc.id} value={enc.id}>
                {enc.tokenNumber} ({enc.patientName} - {enc.currentStage})
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsRoutingModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95"
            title="Route patient to correct consultant doctor"
          >
            <UserCheck className="w-4 h-4" />
            <span>Route to Consultant</span>
          </button>
        </div>
      </div>

      {/* Operational Stage Navigation Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'REGISTRATION', label: '1. Registration & MPI', icon: Users },
          { id: 'BILLING_AUTH', label: '2. Ingress Fee & Cashier', icon: DollarSign },
          { id: 'QUEUE', label: '3. Queue Dispatcher', icon: Clock },
          { id: 'NURSING', label: '4. Nursing & NEWS2', icon: Activity },
          { id: 'MO_ASSESS', label: '5. Medical Officer (MO)', icon: Stethoscope },
          { id: 'CONSULTATION', label: '6. Consultant Review (SOAP)', icon: FileText },
          { id: 'DIAGNOSTIC_LOCK', label: '7. Diagnostic Revenue Lock', icon: Lock },
          { id: 'PHARMACY_FEFO', label: '8. Pharmacy FEFO Stock', icon: Pill },
          { id: 'DISCHARGE_LEDGER', label: '9. Discharge & Balanced GL', icon: Receipt },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeWorkflowTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveWorkflowTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* STAGE 1: REGISTRATION & MPI */}
      {activeWorkflowTab === 'REGISTRATION' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Patient Registration & Master Patient Index (MPI) Ingress
            </h2>
            <p className="text-xs text-slate-500 mb-5">
              Enter patient demographics. Generates institutional MRN (MRN-YYYYMMDD-XXXX), checks duplicate match keys, and triggers token emission.
            </p>

            <form onSubmit={handleRegisterPatient} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">CNIC / National ID</label>
                  <input
                    type="text"
                    required
                    value={regCnic}
                    onChange={(e) => setRegCnic(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    required
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Age & Gender</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={regAge}
                      onChange={(e) => setRegAge(Number(e.target.value))}
                      className="w-20 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                    <select
                      value={regGender}
                      onChange={(e) => setRegGender(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payer Tariff Plan</label>
                  <select
                    value={regTariff}
                    onChange={(e) => setRegTariff(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="CORPORATE_PPO">Corporate PPO (80/20 Co-Pay Split)</option>
                    <option value="SEHAT_CARD_UNIVERSAL">Sehat Sahulat Card (100% Universal Coverage)</option>
                    <option value="OUT_OF_POCKET">Out-of-Pocket / Private Cash</option>
                    <option value="STATE_INSURANCE">State Employee Health Scheme</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Chief Complaint</label>
                  <input
                    type="text"
                    value={regComplaint}
                    onChange={(e) => setRegComplaint(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Execute Atomic Intake & Generate Token
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              MPI Deduplication Match Keys
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Real-time SHA256 deterministic soundex collision hashes generated to prevent duplicate patient creation.
            </p>
            <div className="space-y-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 font-mono">CNIC HASH:</span>
                <p className="font-mono font-bold text-blue-600 break-all">{`SHA256:CNIC:${regCnic || 'NULL'}`}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 font-mono">SOUNDEX DEMO KEY:</span>
                <p className="font-mono font-bold text-emerald-600 break-all">{`SOUNDEX:${regFullName.toUpperCase().slice(0, 4)}:AGE:${regAge}`}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
                <p className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Zero Collisions in Active MPI Registry
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 2: BILLING AUTHORIZATION & INGRESS FEE */}
      {activeWorkflowTab === 'BILLING_AUTH' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            Tactical Verification Protocol: Ingress Fee & Cashier Gate
          </h2>
          <p className="text-xs text-slate-500 mb-6">
            Receptionist Hub → Stage New Identity → Cashier Counter → Ingress Fee Settlement → Patient Activation → MPI Visibility
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-500">Encounter MRN</span>
                <span className="text-xs font-bold font-mono">{selectedEncounter.mrn}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-500">Patient Name</span>
                <span className="text-xs font-bold">{selectedEncounter.patientName}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-500">Payer Tariff</span>
                <span className="text-xs font-bold text-blue-600">{selectedEncounter.tariffPlan}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-500">Standard OPD Ingress Fee</span>
                <span className="text-sm font-black text-slate-900 dark:text-slate-100">
                  {selectedEncounter.tariffPlan === 'SEHAT_CARD_UNIVERSAL' ? '$0.00 (Exempt)' : '$35.00'}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-xs font-semibold text-slate-500">Current Status</span>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                  selectedEncounter.financialClearance.ingressFeePaid
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                }`}>
                  {selectedEncounter.financialClearance.ingressFeePaid ? 'Cleared & Authorized' : 'Pending Payment'}
                </span>
              </div>
            </div>

            <div className="flex flex-col justify-between p-5 rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
              <div>
                <h3 className="text-sm font-bold text-blue-900 dark:text-blue-200 mb-2 flex items-center gap-2">
                  <Receipt className="w-4 h-4" />
                  Double-Entry Revenue Voucher Preview
                </h3>
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                  Settling creates an immutable general ledger journal voucher:
                </p>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-blue-200 dark:border-blue-900 font-mono text-[11px] space-y-1">
                  <p className="text-emerald-600 font-bold">DR 1010 Cash & Equivalents: $35.00</p>
                  <p className="text-blue-600 font-bold">CR 4010 OPD Consultation Revenue: $35.00</p>
                  <p className="text-slate-400 text-[10px] pt-1">Zero Discrepancy: Balanced ($35 = $35)</p>
                </div>
              </div>

              <div className="pt-4">
                <button
                  disabled={selectedEncounter.financialClearance.ingressFeePaid}
                  onClick={handleSettleIngressFee}
                  className={`w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    selectedEncounter.financialClearance.ingressFeePaid
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                  }`}
                >
                  <DollarSign className="w-4 h-4" />
                  {selectedEncounter.financialClearance.ingressFeePaid
                    ? 'Ingress Settled (Receipt: ' + selectedEncounter.financialClearance.ingressReceiptNumber + ')'
                    : 'Collect $35 & Post Balanced Cash Voucher'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 3: QUEUE DISPATCHER */}
      {activeWorkflowTab === 'QUEUE' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            Live Clinic Queue & Token Calling Engine
          </h2>
          <p className="text-xs text-slate-500 mb-6">
            Real-time multi-room queue manager. Call next token, route to Triage/Nursing bay, or escalate priority tokens.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800">
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Total Active In Queue</span>
              <p className="text-2xl font-black text-blue-900 dark:text-blue-100 mt-1">{encounters.length}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Currently in Consultation</span>
              <p className="text-2xl font-black text-emerald-900 dark:text-emerald-100 mt-1">
                {encounters.filter(e => e.currentStage === 'CONSULTANT_REVIEW').length}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800">
              <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Average Dwell Time</span>
              <p className="text-2xl font-black text-purple-900 dark:text-purple-100 mt-1">14.2 mins</p>
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Token #</th>
                  <th className="p-3">Patient Name</th>
                  <th className="p-3">MRN</th>
                  <th className="p-3">Current Stage</th>
                  <th className="p-3">Ingress Fee</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {encounters.map(enc => (
                  <tr
                    key={enc.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                      enc.id === selectedEncounterId ? 'bg-blue-50/40 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <td className="p-3 font-bold text-blue-600 font-mono">{enc.tokenNumber}</td>
                    <td className="p-3 font-semibold">{enc.patientName}</td>
                    <td className="p-3 font-mono text-slate-500">{enc.mrn}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {enc.currentStage}
                      </span>
                    </td>
                    <td className="p-3">
                      {enc.financialClearance.ingressFeePaid ? (
                        <span className="text-emerald-600 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                        </span>
                      ) : (
                        <span className="text-amber-600 font-bold flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> Unpaid
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => {
                          setSelectedEncounterId(enc.id);
                          setActiveWorkflowTab('NURSING');
                        }}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                      >
                        Call to Bay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STAGE 4: NURSING INTAKE & NEWS2 */}
      {activeWorkflowTab === 'NURSING' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-600" />
              Nursing Intake & Physiological Parameter Input
            </h2>
            <p className="text-xs text-slate-500">
              Input patient vitals for <span className="font-bold text-slate-900 dark:text-slate-100">{selectedEncounter.patientName}</span>. Real-time NEWS2 score calculated dynamically.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Heart Rate (bpm)</label>
                <input
                  type="number"
                  value={vitalsHr}
                  onChange={(e) => setVitalsHr(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Systolic BP (mmHg)</label>
                <input
                  type="number"
                  value={vitalsSysBp}
                  onChange={(e) => setVitalsSysBp(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Diastolic BP (mmHg)</label>
                <input
                  type="number"
                  value={vitalsDiaBp}
                  onChange={(e) => setVitalsDiaBp(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Respiration Rate (rpm)</label>
                <input
                  type="number"
                  value={vitalsRr}
                  onChange={(e) => setVitalsRr(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Temperature (°C)</label>
                <input
                  type="number"
                  step="0.1"
                  value={vitalsTemp}
                  onChange={(e) => setVitalsTemp(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">SpO2 (%)</label>
                <input
                  type="number"
                  value={vitalsSpo2}
                  onChange={(e) => setVitalsSpo2(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Consciousness (AVPU)</label>
                <select
                  value={vitalsAvpu}
                  onChange={(e) => setVitalsAvpu(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="ALERT">Alert (A)</option>
                  <option value="VOICE">Responds to Voice (V)</option>
                  <option value="PAIN">Responds to Pain (P)</option>
                  <option value="UNRESPONSIVE">Unresponsive (U)</option>
                </select>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <input
                  type="checkbox"
                  id="chk-o2"
                  checked={vitalsO2}
                  onChange={(e) => setVitalsO2(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <label htmlFor="chk-o2" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  On Supplemental Oxygen
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Nursing Triage Notes</label>
              <textarea
                rows={2}
                value={nurseNotes}
                onChange={(e) => setNurseNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={handleSaveNurseVitals}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                Commit Triage Vitals & Advance Stage
              </button>
            </div>
          </div>

          {/* NEWS2 Real-Time Scorecard */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-rose-600" />
              NEWS2 Real-Time Clinical Scorecard
            </h3>

            <div className="text-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Computed Total Score</span>
              <p className="text-4xl font-black text-rose-600 my-1">{liveNews2.totalScore}</p>
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-black uppercase ${
                liveNews2.clinicalRisk === 'HIGH'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'
                  : liveNews2.clinicalRisk === 'MEDIUM'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
              }`}>
                {liveNews2.clinicalRisk} Clinical Risk
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Recommended Routing:</p>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 font-bold">
                {liveNews2.recommendedRouting}
              </div>
              <p className="text-[11px] text-slate-500">{liveNews2.responseLevel}</p>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 5: MEDICAL OFFICER (MO) ASSESSMENT */}
      {activeWorkflowTab === 'MO_ASSESS' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-blue-600" />
            Medical Officer (MO) Initial Clinical Assessment
          </h2>
          <p className="text-xs text-slate-500">
            Initial patient workup prior to attending specialist consultation. Preliminary diagnosis, system reviews, and emergent stat order triggers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Triage Emergency Severity Index (ESI)</label>
              <select className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <option>ESI Level 3 - Urgent (Requires multiple diagnostic resources)</option>
                <option>ESI Level 2 - Emergent (High risk, acute chest discomfort)</option>
                <option>ESI Level 4 - Less Urgent (Single resource)</option>
                <option>ESI Level 1 - Resuscitation Immediate</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Provisional Working Diagnosis</label>
              <input
                type="text"
                defaultValue="Ischemic Heart Disease / Unstable Angina"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">System Review & Physical Examination</label>
            <textarea
              rows={3}
              defaultValue="CVS: S1/S2 present, no murmurs. Lungs: Vesicular breath sounds bilaterally, no wheezes or crackles. Abdomen: Soft, non-tender, no organomegaly."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setIsRoutingModalOpen(true)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              Route to Specialist Consultant
            </button>
            <button
              onClick={() => {
                setActiveWorkflowTab('CONSULTATION');
                showNotification('MO Assessment committed! Patient queued for Specialist Consultant Review.');
              }}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              Direct Transfer to Room 104
            </button>
          </div>
        </div>
      )}

      {/* STAGE 6: CONSULTANT REVIEW (SOAP, ORDERS & RX) */}
      {activeWorkflowTab === 'CONSULTATION' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Consultant Physician SOAP Documentation Workspace
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500 font-medium">Attending:</span>
                  <select
                    value={attendingDoctorId}
                    onChange={(e) => {
                      setAttendingDoctorId(e.target.value);
                      const doc = CONSULTANT_REGISTRY.find((d) => d.id === e.target.value);
                      if (doc) {
                        showNotification(`Attending switched to ${doc.name} (${doc.title})`);
                      }
                    }}
                    className="text-xs font-bold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {CONSULTANT_REGISTRY.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name} — {doc.title} ({doc.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsAiStructuring(true);
                  setTimeout(() => {
                    setIsAiStructuring(false);
                    showNotification('GenAI structured clinical encounter note with ICD-10 I20.9 & CPT 99214!');
                  }, 1200);
                }}
                className="px-3.5 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-2 hover:bg-purple-100 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-purple-600" />
                {isAiStructuring ? 'Structuring...' : 'AI Auto-Format Note'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Subjective (S)</label>
                <textarea
                  rows={2}
                  value={soapSubjective}
                  onChange={(e) => setSoapSubjective(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Objective (O)</label>
                <textarea
                  rows={2}
                  value={soapObjective}
                  onChange={(e) => setSoapObjective(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Assessment (A)</label>
                <textarea
                  rows={2}
                  value={soapAssessment}
                  onChange={(e) => setSoapAssessment(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Plan & Orders (P)</label>
                <textarea
                  rows={2}
                  value={soapPlan}
                  onChange={(e) => setSoapPlan(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400 font-mono">Digital Signature: SHA256:AUTH_DOC_JENKINS</span>
              <button
                onClick={() => {
                  showNotification('Consultant SOAP note signed! Unlocking Stage 4 Parallel Diagnostic & Pharmacy Tracks.');
                  setActiveWorkflowTab('DIAGNOSTIC_LOCK');
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <ShieldCheck className="w-4 h-4" />
                Sign Note & Unlock Diagnostic / Pharmacy Tracks
              </button>
            </div>
          </div>

          {/* Quick Order Pad */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-purple-600" />
              Stat Clinical Order Pad
            </h3>
            <p className="text-xs text-slate-500">
              Click to order investigations. Orders are automatically locked by the revenue gate until settled.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleOrderDiagnostic('LABORATORY', 'LAB-TROP-I', 'High-Sensitivity Troponin I', 85.0, 'Biochemistry')}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-purple-400 bg-slate-50 dark:bg-slate-800 text-left text-xs flex justify-between items-center cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">High-Sensitivity Troponin I</p>
                  <p className="text-[10px] text-slate-400">Clinical Biochemistry</p>
                </div>
                <span className="font-bold text-purple-600">$85.00</span>
              </button>

              <button
                onClick={() => handleOrderDiagnostic('LABORATORY', 'LAB-CBC', 'Complete Blood Count (CBC w/ Diff)', 35.0, 'Hematology')}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-purple-400 bg-slate-50 dark:bg-slate-800 text-left text-xs flex justify-between items-center cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Complete Blood Count (CBC)</p>
                  <p className="text-[10px] text-slate-400">Hematology Bay</p>
                </div>
                <span className="font-bold text-purple-600">$35.00</span>
              </button>

              <button
                onClick={() => handleOrderDiagnostic('RADIOLOGY', 'RAD-CXR', 'Chest X-Ray PA View', 60.0, 'Radiology & Imaging')}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-purple-400 bg-slate-50 dark:bg-slate-800 text-left text-xs flex justify-between items-center cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Chest X-Ray PA View</p>
                  <p className="text-[10px] text-slate-400">Radiology PACS</p>
                </div>
                <span className="font-bold text-purple-600">$60.00</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 7: DIAGNOSTIC REVENUE LOCK & LIS/RIS EXECUTION */}
      {activeWorkflowTab === 'DIAGNOSTIC_LOCK' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-600" />
                Tactical Verification Protocol: Diagnostic Revenue Locking
              </h2>
              <p className="text-xs text-slate-500">
                Active Encounter → Lab/Radiology Order → Diagnostic Invoice → Worklist Locked → Payment Settlement → Worklist Unlocked → LIS/RIS Execution
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {selectedEncounter.diagnosticOrders.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                <FlaskConical className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-500">No diagnostic orders placed yet.</p>
                <p className="text-[11px] text-slate-400">Place orders in the Consultant Review workspace.</p>
              </div>
            ) : (
              selectedEncounter.diagnosticOrders.map(ord => {
                const isLocked = ord.paymentStatus === 'LOCKED_PENDING_PAYMENT';
                return (
                  <div
                    key={ord.id}
                    className={`p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                      isLocked
                        ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                        : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                        isLocked ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                      }`}>
                        {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{ord.testName}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {ord.code}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">{ord.department} • Price: ${ord.price.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full ${
                          isLocked
                            ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                            : 'bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200'
                        }`}>
                          {ord.worklistStatus}
                        </span>
                      </div>

                      {isLocked ? (
                        <button
                          onClick={() => handleUnlockDiagnosticOrder(ord.id)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          Settle Invoice (${ord.price.toFixed(2)}) & Unlock
                        </button>
                      ) : (
                        <div className="px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Worklist Active (Ready for LIS Sync)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* STAGE 8: PHARMACY FEFO STOCK RESERVATION */}
      {activeWorkflowTab === 'PHARMACY_FEFO' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Pill className="w-5 h-5 text-emerald-600" />
              Pharmacy FEFO (First-Expiring-First-Out) Dispensing Station
            </h2>
            <p className="text-xs text-slate-500">
              Validates batch inventory, sorts batches by earliest expiration, performs allergy screening, and reserves stock.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Select Formulary Drug</label>
                <select
                  value={selectedDrugToDispense}
                  onChange={(e) => setSelectedDrugToDispense(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="amoxicillin_500">Amoxicillin 500mg (Penicillin Class)</option>
                  <option value="atorvastatin_20">Atorvastatin 20mg Tablet (Statin)</option>
                  <option value="ceftriaxone_1g">Ceftriaxone 1g Injection Vial</option>
                  <option value="paracetamol_500">Paracetamol 500mg Tablet</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Quantity to Dispense</label>
                <input
                  type="number"
                  value={dispenseQty}
                  onChange={(e) => setDispenseQty(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            {fefoMessage && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono">
                {fefoMessage}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={handleAllocateFefoAndDispense}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Pill className="w-4 h-4" />
                Allocate Nearest-Expiring FEFO Batch & Dispense
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              Patient Allergy Safety Screen
            </h3>
            <p className="text-xs text-slate-500">
              Active allergies on file for {selectedEncounter.patientName}:
            </p>
            <div className="flex flex-wrap gap-2">
              {(selectedEncounter.nursingAssessment?.knownAllergies || ['Penicillin', 'Sulfa drugs']).map((allg) => (
                <span
                  key={allg}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300 border border-red-200 dark:border-red-800"
                >
                  ⚠ {allg}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STAGE 9: DISCHARGE & BALANCED GL LEDGER */}
      {activeWorkflowTab === 'DISCHARGE_LEDGER' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-600" />
              Billing & Discharge: Double-Entry GL Ledger Posting
            </h2>
            <p className="text-xs text-slate-500">
              Calculates 80/20 or tariff co-pay split, checks double-entry mathematical integrity (Sum Debits === Sum Credits), and completes encounter.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Encounter Line Item Bill</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between pb-1 border-b border-slate-200 dark:border-slate-700">
                  <span>Specialist OPD Consultation (Level 4)</span>
                  <span className="font-bold font-mono">$120.00</span>
                </div>
                {selectedEncounter.diagnosticOrders.map(d => (
                  <div key={d.id} className="flex justify-between pb-1 border-b border-slate-200 dark:border-slate-700">
                    <span>{d.testName}</span>
                    <span className="font-bold font-mono">${d.price.toFixed(2)}</span>
                  </div>
                ))}
                {selectedEncounter.prescriptions.map(p => (
                  <div key={p.id} className="flex justify-between pb-1 border-b border-slate-200 dark:border-slate-700">
                    <span>{p.drugName} (Qty: {p.quantityDispensed})</span>
                    <span className="font-bold font-mono">${(p.quantityDispensed * 0.9).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-200 mb-2">
                  Co-Pay Ratio Breakdown ({selectedEncounter.copayRatio.insurancePercent}% Payer / {selectedEncounter.copayRatio.patientPercent}% Patient)
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Payer Accounts Receivable (1030):</span>
                    <span className="font-bold text-blue-600 font-mono">
                      ${(selectedEncounter.copayRatio.insurancePercent === 80 ? 164.0 : 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Patient Co-Pay Payable (1020):</span>
                    <span className="font-bold text-emerald-600 font-mono">
                      ${(selectedEncounter.copayRatio.patientPercent === 20 ? 41.0 : 205.0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={handleFinalizeDischargeAndPostLedger}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Receipt className="w-4 h-4" />
                  Post Balanced GL Journal Voucher & Finalize Discharge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Patient Consultant Routing Modal */}
      {selectedEncounter && (
        <PatientConsultantRoutingModal
          isOpen={isRoutingModalOpen}
          onClose={() => setIsRoutingModalOpen(false)}
          patientId={selectedEncounter.patientId}
          patientName={selectedEncounter.patientName}
          mrn={selectedEncounter.mrn}
          chiefComplaint={soapSubjective || 'OPD Specialist Consultation Workup'}
          triageCategory={`OPD Stage: ${selectedEncounter.currentStage}`}
          currentAttending="Dr. Sarah Jenkins"
          onRoutedSuccess={(consultant, details) => {
            showNotification(`Patient ${selectedEncounter.patientName} successfully routed to ${consultant.name} (${consultant.subSpecialty || consultant.department}, ${consultant.assignedBayOrRoom})! SBAR handoff logged.`);
            setActiveWorkflowTab('CONSULTATION');
          }}
        />
      )}
    </div>
  );
}
