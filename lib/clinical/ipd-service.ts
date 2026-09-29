import { Bed, Patient } from '@/lib/types/ghims';
import {
  IpdPathwayData,
  IpdStageKey,
  IPD_STAGE_DEFINITIONS,
  IpdPhysicianOrder,
  IpdMedicationItem,
  IpdLabItem,
  IpdImagingItem,
  IpdProgressNote,
} from '@/lib/types/ipd';

export interface DischargedCensusRecord {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  age: number;
  gender: string;
  bedId: string;
  bedNumber: string;
  ward: string;
  admissionDate: string;
  dischargeDate: string;
  lengthOfStayDays: number;
  primaryDiagnosis: string;
  dischargingDoctor: string;
  dischargeDisposition: string;
  gatePassCode: string;
  medicationReconciliationCompleted: boolean;
  financialClearanceCompleted: boolean;
  followUpDate: string;
  dischargeSummaryNote: string;
}

export const initialDischargedCensus: DischargedCensusRecord[] = [
  {
    id: 'dc-rec-101',
    patientId: 'p-hist-901',
    patientName: 'Eleanor Vance',
    mrn: 'GH-2026-8812',
    age: 62,
    gender: 'Female',
    bedId: 'bed-103',
    bedNumber: 'B-103',
    ward: 'ICU',
    admissionDate: '2026-09-14',
    dischargeDate: '2026-09-20',
    lengthOfStayDays: 6,
    primaryDiagnosis: 'Acute Coronary Syndrome, s/p successful stent placement',
    dischargingDoctor: 'Dr. Sarah Jenkins',
    dischargeDisposition: 'Home with Home Health Care Support',
    gatePassCode: 'GP-2026-0920-741',
    medicationReconciliationCompleted: true,
    financialClearanceCompleted: true,
    followUpDate: '2026-09-28 (Cardiology Clinic)',
    dischargeSummaryNote: 'Hemodynamically stable. Dual antiplatelet therapy titrated. Troponin negative on discharge. Low-sodium cardiac diet instructions provided.',
  },
  {
    id: 'dc-rec-102',
    patientId: 'p-hist-902',
    patientName: 'Marcus Aurelius Sterling',
    mrn: 'GH-2026-7204',
    age: 45,
    gender: 'Male',
    bedId: 'bed-202',
    bedNumber: 'B-202',
    ward: 'General',
    admissionDate: '2026-09-17',
    dischargeDate: '2026-09-21',
    lengthOfStayDays: 4,
    primaryDiagnosis: 'Laparoscopic Cholecystectomy for symptomatic cholelithiasis',
    dischargingDoctor: 'Dr. Fatima Zahra',
    dischargeDisposition: 'Home with Self-Care',
    gatePassCode: 'GP-2026-0921-118',
    medicationReconciliationCompleted: true,
    financialClearanceCompleted: true,
    followUpDate: '2026-10-02 (Surgical Outpatient OPD)',
    dischargeSummaryNote: 'Wounds clean, no signs of surgical site infection. Tolerating regular diet. Pain controlled on oral acetaminophen.',
  },
];

export function createDefaultIpdPathway(bed: Bed, patient?: Patient): IpdPathwayData {
  const patientId = bed.patientId || patient?.id || 'p-gen-01';
  const patientName = bed.patientName || patient?.fullName || 'Inpatient';
  const mrn = patient?.mrn || `GH-2026-${patientId.replace(/\D/g, '') || '4412'}`;
  const admissionDate = bed.admissionDate || new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
  const attendingPhysician = bed.assignedDoctor || 'Dr. Fatima Zahra';
  const primaryNurse = bed.assignedNurse || 'Nurse Clara Oswald';
  const primaryDiagnosis = (bed as any).diagnosis || 'Inpatient Medical Care / Clinical Observation';

  const orders: IpdPhysicianOrder[] = [
    {
      id: `ord-${bed.id}-1`,
      orderType: 'DIET',
      description: 'Cardiac diabetic diet, sodium < 2g/day',
      prescribedBy: attendingPhysician,
      orderedAt: `${admissionDate} 08:30`,
      status: 'ACTIVE',
      priority: 'ROUTINE',
    },
    {
      id: `ord-${bed.id}-2`,
      orderType: 'ACTIVITY',
      description: 'Ambulate with assistance twice daily, fall precautions level 2',
      prescribedBy: attendingPhysician,
      orderedAt: `${admissionDate} 09:00`,
      status: 'ACTIVE',
      priority: 'ROUTINE',
    },
    {
      id: `ord-${bed.id}-3`,
      orderType: 'MEDICATION',
      description: 'Ceftriaxone 1g IV daily + Enoxaparin 40mg SubQ daily for DVT prophylaxis',
      prescribedBy: attendingPhysician,
      orderedAt: `${admissionDate} 10:15`,
      status: 'ACTIVE',
      priority: 'URGENT',
    },
    {
      id: `ord-${bed.id}-4`,
      orderType: 'LAB',
      description: 'CBC with Diff, Comprehensive Metabolic Panel, CRP, Troponin-I STAT',
      prescribedBy: attendingPhysician,
      orderedAt: `${admissionDate} 10:20`,
      status: 'COMPLETED',
      priority: 'STAT',
    },
  ];

  const medications: IpdMedicationItem[] = [
    {
      id: `med-${bed.id}-1`,
      name: 'Ceftriaxone IV',
      dose: '1 g',
      route: 'IV',
      frequency: 'Every 24 hours',
      lastAdministered: 'Today, 08:00',
      nextDose: 'Tomorrow, 08:00',
      status: 'GIVEN',
      pharmacistVerified: true,
    },
    {
      id: `med-${bed.id}-2`,
      name: 'Enoxaparin Sodium',
      dose: '40 mg / 0.4 mL',
      route: 'SubQ',
      frequency: 'Once daily at 20:00',
      lastAdministered: 'Yesterday, 20:00',
      nextDose: 'Today, 20:00',
      status: 'SCHEDULED',
      pharmacistVerified: true,
    },
    {
      id: `med-${bed.id}-3`,
      name: 'Pantoprazole',
      dose: '40 mg',
      route: 'Oral',
      frequency: 'Every morning before breakfast',
      lastAdministered: 'Today, 07:30',
      nextDose: 'Tomorrow, 07:30',
      status: 'GIVEN',
      pharmacistVerified: true,
    },
    {
      id: `med-${bed.id}-4`,
      name: 'Acetaminophen',
      dose: '650 mg',
      route: 'Oral',
      frequency: 'Every 6 hours PRN for pain > 4/10',
      status: 'SCHEDULED',
      pharmacistVerified: true,
    },
  ];

  const labs: IpdLabItem[] = [
    {
      id: `lab-${bed.id}-1`,
      testName: 'Complete Blood Count (CBC)',
      panel: 'Hematology',
      orderedAt: `${admissionDate} 10:20`,
      result: 'WBC: 8.4 (Normal), Hgb: 13.8 g/dL, Plt: 240k',
      referenceRange: 'WBC: 4.5-11.0, Hgb: 12-16',
      status: 'RESULTED',
      criticalAlert: false,
    },
    {
      id: `lab-${bed.id}-2`,
      testName: 'Comprehensive Metabolic Panel',
      panel: 'Clinical Chemistry',
      orderedAt: `${admissionDate} 10:20`,
      result: 'Na: 139, K: 4.1, Cr: 0.9 mg/dL, eGFR > 90',
      referenceRange: 'Cr: 0.6-1.2, K: 3.5-5.0',
      status: 'RESULTED',
      criticalAlert: false,
    },
    {
      id: `lab-${bed.id}-3`,
      testName: 'High-Sensitivity Troponin I',
      panel: 'Cardiac Biomarkers',
      orderedAt: `${admissionDate} 10:20`,
      result: '< 0.01 ng/mL (Negative)',
      referenceRange: '< 0.04 ng/mL',
      status: 'RESULTED',
      criticalAlert: false,
    },
    {
      id: `lab-${bed.id}-4`,
      testName: 'Repeat AM Electrolytes & BUN/Cr',
      panel: 'Clinical Chemistry',
      orderedAt: 'Today, 05:00',
      status: 'COLLECTED',
    },
  ];

  const imaging: IpdImagingItem[] = [
    {
      id: `img-${bed.id}-1`,
      modality: 'XRAY',
      studyName: 'Chest X-Ray PA & Lateral',
      orderedAt: `${admissionDate} 11:00`,
      status: 'REPORTED',
      findings: 'Clear bilateral lung fields. Cardiothoracic ratio normal. No acute focal consolidation, pneumothorax, or pleural effusion.',
      radiologist: 'Dr. Alexander Hayes, MD (Board Certified Radiologist)',
    },
    {
      id: `img-${bed.id}-2`,
      modality: 'ULTRASOUND',
      studyName: 'Bedside Abdominal Ultrasound / POCUS',
      orderedAt: 'Yesterday, 14:00',
      status: 'REPORTED',
      findings: 'Gallbladder without wall thickening or pericholecystic fluid. Normal caliber IVC with normal respiratory collapse.',
      radiologist: attendingPhysician,
    },
  ];

  const progressNotes: IpdProgressNote[] = [
    {
      id: `soap-${bed.id}-1`,
      timestamp: 'Today, 09:30 AM',
      author: attendingPhysician,
      role: 'Attending Physician',
      soap: {
        subjective: 'Patient reports feeling markedly better. Pain decreased to 2/10. Slept well overnight with no dyspnea or chest pressure.',
        objective: 'Vitals: BP 122/78 mmHg, HR 72 bpm regular, SpO2 98% room air, Temp 36.8°C. Lungs clear to auscultation bilaterally. Abdomen soft, non-tender, active bowel sounds. Surgical/IV sites clean.',
        assessment: 'Improving clinical trajectory. Infection markers downtrending. Tolerating oral intake and oral hydration well.',
        plan: '1. Transition IV Ceftriaxone to oral antibiotic. 2. Continue DVT prophylaxis. 3. Advance to full diet. 4. Initiate multidisciplinary discharge planning with clinical pharmacist.',
      },
      news2Score: 0,
    },
    {
      id: `soap-${bed.id}-2`,
      timestamp: 'Yesterday, 10:00 AM',
      author: attendingPhysician,
      role: 'Attending Physician',
      soap: {
        subjective: 'Mild nausea after breakfast, resolved with oral Ondansetron.',
        objective: 'Afebrile, BP 128/82, HR 78, NEWS2 Score: 1 (Mild tachycardia on exertion).',
        assessment: 'Post-admission day 1 recovery proceeding according to clinical pathway.',
        plan: 'Maintain current regimen, encourage gentle mobilization with nursing team.',
      },
      news2Score: 1,
    },
  ];

  const defaultStageStatuses: Record<IpdStageKey, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'> = {
    ADMISSION: 'COMPLETED',
    BED_ALLOCATION: 'COMPLETED',
    NURSING: 'COMPLETED',
    PHYSICIAN_ORDERS: 'COMPLETED',
    MEDICATION: 'COMPLETED',
    LABS: 'COMPLETED',
    IMAGING: 'COMPLETED',
    DAILY_PROGRESS: 'COMPLETED',
    PROCEDURES: 'COMPLETED',
    CONSULTATIONS: 'COMPLETED',
    DISCHARGE_PLANNING: 'IN_PROGRESS',
    MEDICATION_RECONCILIATION: 'IN_PROGRESS',
    FINANCIAL_RECONCILIATION: 'IN_PROGRESS',
    DISCHARGE: 'PENDING',
    FOLLOW_UP: 'PENDING',
  };

  return {
    patientId,
    patientName,
    mrn,
    bedId: bed.id,
    bedNumber: bed.bedNumber,
    ward: bed.ward,
    admissionDate,
    attendingPhysician,
    primaryNurse,
    primaryDiagnosis,
    allergies: patient?.allergies && patient.allergies.length > 0 ? patient.allergies : ['No Known Drug Allergies (NKDA)'],
    currentStage: 'DISCHARGE_PLANNING',
    stageStatuses: defaultStageStatuses,
    orders,
    medications,
    labs,
    imaging,
    progressNotes,
    procedures: [
      {
        id: `proc-${bed.id}-1`,
        procedureName: 'Ultrasound-Guided Peripheral IV Placement',
        performedBy: primaryNurse,
        date: `${admissionDate} 09:30`,
        status: 'COMPLETED',
        notes: '18G cannula placed in right cephalic vein on first pass. Clean dressing applied.',
      },
    ],
    consultations: [
      {
        id: `cons-${bed.id}-1`,
        specialty: 'Clinical Pharmacy',
        consultantName: 'PharmD Kevin Zhao',
        reason: 'Inpatient medication reconciliation & renal dose clearance',
        requestedAt: `${admissionDate} 11:00`,
        status: 'COMPLETED',
        recommendation: 'All home medications reconciled. No significant drug interactions identified. Renal clearances adequate.',
      },
    ],
    dischargePlanning: {
      estimatedDischargeDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      transportNeeded: false,
      homeCareOrdered: false,
      socialWorkCleared: true,
      patientEducationDone: true,
    },
    medicationReconciliation: {
      pharmacistName: 'PharmD Kevin Zhao',
      reconciliationDate: new Date().toISOString().split('T')[0],
      reconciledCount: 5,
      discrepanciesResolved: true,
    },
    financialReconciliation: {
      totalEstimatedCharges: 4250.0,
      insuranceApprovedAmount: 3950.0,
      patientCoPaySettled: true,
      billingCleared: true,
      clearedBy: 'Payer Pre-Auth & Revenue Cycle Management',
    },
    dischargeExecution: {
      dischargingPhysician: attendingPhysician,
      gatePassId: `GP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      disposition: 'Home with Self-Care Instructions',
    },
    followUp: {
      clinicAppointmentDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      telehealthFollowUpDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      instructions: 'Return to emergency department if fever > 38.5°C, acute chest tightness, or persistent severe nausea develops. Take all prescribed medications as indicated on the reconciled discharge prescription sheet.',
    },
  };
}


/**
 * Production/STAGING-safe IPD pathway read-model skeleton.
 *
 * Unlike createDefaultIpdPathway(), this function never fabricates clinical
 * notes, medications, results, procedures, consultations, reconciliation, or
 * financial clearance. Those facts must arrive from authoritative projections.
 */
export function createAuthoritativeIpdPathwaySkeleton(
  bed: Bed,
  patient?: Patient
): IpdPathwayData {
  const patientId = bed.patientId || patient?.id || '';
  const patientName = bed.patientName || patient?.fullName || '';
  const mrn = patient?.mrn || '';
  const admissionDate = bed.admissionDate || '';
  const attendingPhysician = bed.assignedDoctor || '';
  const primaryNurse = bed.assignedNurse || '';

  const stageStatuses: Record<IpdStageKey, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'> = {
    ADMISSION: patient?.activeEncounterId ? 'COMPLETED' : 'PENDING',
    BED_ALLOCATION: bed.status === 'occupied' && !!bed.patientId ? 'COMPLETED' : 'PENDING',
    NURSING: 'PENDING',
    PHYSICIAN_ORDERS: 'PENDING',
    MEDICATION: 'PENDING',
    LABS: 'PENDING',
    IMAGING: 'PENDING',
    DAILY_PROGRESS: 'PENDING',
    PROCEDURES: 'PENDING',
    CONSULTATIONS: 'PENDING',
    DISCHARGE_PLANNING: 'PENDING',
    MEDICATION_RECONCILIATION: 'PENDING',
    FINANCIAL_RECONCILIATION: 'PENDING',
    DISCHARGE: 'PENDING',
    FOLLOW_UP: 'PENDING',
  };

  return {
    patientId,
    patientName,
    mrn,
    bedId: bed.id,
    bedNumber: bed.bedNumber,
    ward: bed.ward,
    admissionDate,
    attendingPhysician,
    primaryNurse,
    primaryDiagnosis: '',
    allergies: patient?.allergies || [],
    currentStage: 'ADMISSION',
    stageStatuses,
    orders: [],
    medications: [],
    labs: [],
    imaging: [],
    progressNotes: [],
    procedures: [],
    consultations: [],
    dischargePlanning: {
      estimatedDischargeDate: '',
      transportNeeded: false,
      homeCareOrdered: false,
      socialWorkCleared: false,
      patientEducationDone: false,
    },
    medicationReconciliation: {
      pharmacistName: '',
      reconciliationDate: '',
      reconciledCount: 0,
      discrepanciesResolved: false,
    },
    financialReconciliation: {
      totalEstimatedCharges: 0,
      insuranceApprovedAmount: 0,
      patientCoPaySettled: false,
      billingCleared: false,
      clearedBy: '',
    },
    dischargeExecution: {},
    followUp: {},
  };
}
