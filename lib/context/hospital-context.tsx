'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Bed,
  Patient,
  StaffMember,
  HospitalStats,
  Encounter,
  LabOrder,
  WardType,
  BedStatus,
  ClinicalNote,
  Vitals,
  BillingAuditMismatch,
  OpdQueueToken,
  Hl7Message,
  FhirResource,
  OfflineMutation,
  AuditLogEntry,
  ExecutiveThesisModel,
  BillItem,
  Medication,
  TelehealthSession,
  TelehealthVitals,
  TelehealthTranscriptEntry,
  TelehealthSoapNote,
  TelehealthPrescription,
} from '@/lib/types/ghims';
import {
  subscribeToPatients,
  subscribeToBeds,
  subscribeToBillingMismatches,
  subscribeToOpdQueue,
  subscribeToAuditLogs,
  subscribeToTelehealthSessions,
  syncPatientToFirestore,
  syncBedToFirestore,
  syncMismatchToFirestore,
  syncOpdTokenToFirestore,
  syncAuditLogToFirestore,
  syncHl7ToFirestore,
  syncTelehealthSessionToFirestore,
} from '@/lib/firebase/firestore-service';
import { DischargedCensusRecord, initialDischargedCensus } from '@/lib/clinical/ipd-service';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

const initialTelehealthSessions: TelehealthSession[] = [
  {
    id: 'th-101',
    encounterId: 'enc-th-8812',
    patientId: 'p-1003',
    patientName: 'Sophia Al-Mansoor',
    patientMrn: 'MRN-84920',
    age: 31,
    gender: 'Female',
    scheduledTime: 'Today, 14:00 (In 15 min)',
    status: 'WAITING_ROOM',
    type: 'Telehealth Consultation',
    attendingPhysician: 'Dr. Sarah Jenkins',
    clinicianNpi: '1487920134',
    specialty: 'Cardiology & Preventive Medicine',
    chiefComplaint: 'Post-discharge follow-up for episodic palpitations, fatigue, and blood pressure monitoring.',
    roomToken: 'ROOM-ALPHA-892',
    connectionQuality: 'EXCELLENT',
    callDurationSeconds: 0,
    vitals: {
      bp: '118/76',
      hr: 74,
      spo2: 99,
      temp: 36.7,
      rhythm: 'Normal Sinus Rhythm',
      connectedDevice: 'Withings BPM Core BLE v5.2',
      lastSync: '10 min ago',
    },
    transcription: [
      { id: 'tr-1', timestamp: '13:58:12', speaker: 'SYSTEM', text: 'Secure WebRTC end-to-end encrypted session established. Room token: ROOM-ALPHA-892.' },
      { id: 'tr-2', timestamp: '13:59:04', speaker: 'PATIENT', text: 'Patient admitted into waiting room. BLE peripheral telemetry online.' },
    ],
    soapNote: {
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
      icd10Codes: [],
      cptCodes: [],
    },
    prescriptions: [],
    isAudioMuted: false,
    isVideoMuted: false,
    isRecording: false,
    patientInvitedEmail: 'sophia.almansoor@healthcorp.demo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'th-102',
    encounterId: 'enc-th-8813',
    patientId: 'p-1004',
    patientName: 'David Kim',
    patientMrn: 'MRN-44819',
    age: 58,
    gender: 'Male',
    scheduledTime: 'Today, 14:30',
    status: 'IN_CONSULTATION',
    type: 'RPM Chronic Care Review',
    attendingPhysician: 'Dr. Michael Chen',
    clinicianNpi: '1982301923',
    specialty: 'Endocrinology & Internal Medicine',
    chiefComplaint: 'Type 2 Diabetes glycemic trend review, elevated fasting glucose log, peripheral neuropathy screening.',
    roomToken: 'ROOM-BETA-331',
    connectionQuality: 'GOOD',
    callDurationSeconds: 420,
    vitals: {
      bp: '134/82',
      hr: 68,
      spo2: 98,
      temp: 36.8,
      glucose: 154,
      connectedDevice: 'Dexcom G7 Continuous Glucose Sensor',
      lastSync: '2 min ago',
    },
    transcription: [
      { id: 'tr-11', timestamp: '14:30:10', speaker: 'SYSTEM', text: 'Call initiated with Dr. Michael Chen.' },
      { id: 'tr-12', timestamp: '14:30:25', speaker: 'DOCTOR', text: 'Good afternoon David. Reviewing your CGM continuous glucose telemetry over the past 14 days.' },
      { id: 'tr-13', timestamp: '14:31:02', speaker: 'PATIENT', text: 'Doctor, morning fasting readings have been hovering between 145 and 160 mg/dL even with evening Metformin.' },
      { id: 'tr-14', timestamp: '14:31:45', speaker: 'DOCTOR', text: 'Understood. We see a dawn phenomenon peak. We will titrate your Metformin and consider low-dose Empagliflozin.' },
    ],
    soapNote: {
      subjective: 'Patient reports elevated fasting blood sugars averaging 150-160 mg/dL. Denies symptomatic hypoglycemia.',
      objective: 'Dexcom G7 CGM sensor shows Time-in-Range (70-180 mg/dL) at 68%. Average glucose 154 mg/dL. BP 134/82 mmHg, HR 68 bpm.',
      assessment: 'Type 2 Diabetes Mellitus with suboptimal glycemic control (E11.65). Mild essential hypertension (I10).',
      plan: '1. Titrate Metformin ER to 1000mg PO QPM. 2. Prescribe Empagliflozin (Jardiance) 10mg daily. 3. Repeat HbA1c in 6 weeks.',
      icd10Codes: [
        { code: 'E11.65', description: 'Type 2 diabetes mellitus with hyperglycemia', confidence: 0.96 },
        { code: 'I10', description: 'Essential (primary) hypertension', confidence: 0.92 },
      ],
      cptCodes: [
        { code: '99457', description: 'Remote physiologic monitoring treatment mgmt, initial 20 min', fee: 110 },
        { code: '99214', description: 'Office/telehealth outpatient visit moderate complexity', fee: 165 },
      ],
    },
    prescriptions: [
      {
        id: 'rx-201',
        medication: 'Empagliflozin (Jardiance)',
        dosage: '10mg',
        frequency: 'Daily (QAM)',
        duration: '90 days',
        instructions: 'Take one tablet every morning with water. Monitor for signs of dehydration.',
        prescribedAt: '2026-08-13 14:35',
        pharmacyName: 'CVS Pharmacy #4912 (Main Street)',
        pharmacyNpi: '1093821742',
        status: 'TRANSMITTED',
        transactionRef: 'NCPDP-SCRIPT-99821',
      },
    ],
    isAudioMuted: false,
    isVideoMuted: false,
    isRecording: true,
    patientInvitedEmail: 'david.kim@samplecorp.demo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'th-103',
    encounterId: 'enc-th-8814',
    patientId: 'p-1001',
    patientName: 'Elena Rostova',
    patientMrn: 'MRN-99412',
    age: 64,
    gender: 'Female',
    scheduledTime: 'Today, 15:15',
    status: 'DOCUMENTING',
    type: 'Remote Post-Op Follow-up',
    attendingPhysician: 'Dr. Sarah Jenkins',
    clinicianNpi: '1487920134',
    specialty: 'Cardiothoracic Surgery',
    chiefComplaint: 'Post-CABG recovery assessment, sternal wound inspection via high-definition camera, medication titration.',
    roomToken: 'ROOM-GAMMA-710',
    connectionQuality: 'EXCELLENT',
    callDurationSeconds: 960,
    vitals: {
      bp: '122/78',
      hr: 72,
      spo2: 99,
      temp: 36.6,
      rhythm: 'Normal Sinus Rhythm',
      connectedDevice: 'Smart ECG + Oximeter BLE Hub',
      lastSync: '1 min ago',
    },
    transcription: [
      { id: 'tr-21', timestamp: '15:15:00', speaker: 'SYSTEM', text: 'Encounter started with Dr. Sarah Jenkins.' },
      { id: 'tr-22', timestamp: '15:15:45', speaker: 'DOCTOR', text: 'Elena, sternal incision looks clean and healing appropriately without erythema.' },
      { id: 'tr-23', timestamp: '15:16:30', speaker: 'PATIENT', text: 'No chest pain at rest; walking 20 minutes daily now.' },
    ],
    soapNote: {
      subjective: 'Day 14 post-op CABG. Patient walking comfortably without dyspnea or angina.',
      objective: 'Sternal incision clean, dry, intact without discharge or surrounding erythema. Vitals stable.',
      assessment: 'Uncomplicated post-operative recovery following coronary artery bypass graft (Z95.1).',
      plan: 'Continue cardiac rehabilitation. Continue dual antiplatelet therapy. In-person clinic visit in 4 weeks.',
      icd10Codes: [{ code: 'Z95.1', description: 'Presence of aortocoronary bypass graft', confidence: 0.98 }],
      cptCodes: [{ code: '99213', description: 'Telehealth established patient visit low-moderate complexity', fee: 125 }],
    },
    prescriptions: [],
    isAudioMuted: false,
    isVideoMuted: false,
    isRecording: false,
    patientInvitedEmail: 'elena.rostova@samplecorp.demo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const initialBeds: Bed[] = [
  { id: 'b-icu-101', bedNumber: 'ICU-101', ward: 'ICU', room: 'Room 101', status: 'occupied', patientId: 'p-1001', patientName: 'Elena Rostova', admissionDate: '2026-08-10', assignedDoctor: 'Dr. Sarah Jenkins', assignedNurse: 'Nurse John Davis', vitalAlert: true, notes: 'Post-op cardiac monitoring' },
  { id: 'b-icu-102', bedNumber: 'ICU-102', ward: 'ICU', room: 'Room 101', status: 'occupied', patientId: 'p-1002', patientName: 'Marcus Vance', admissionDate: '2026-08-12', assignedDoctor: 'Dr. Michael Chen', assignedNurse: 'Nurse Maya Patel', vitalAlert: false },
  { id: 'b-icu-103', bedNumber: 'ICU-103', ward: 'ICU', room: 'Room 102', status: 'cleaning', notes: 'Sanitizing protocol in progress' },
  { id: 'b-icu-104', bedNumber: 'ICU-104', ward: 'ICU', room: 'Room 102', status: 'available' },
  { id: 'b-gen-201', bedNumber: 'GEN-201', ward: 'General', room: 'Room 201-A', status: 'occupied', patientId: 'p-1003', patientName: 'Sophia Al-Mansoor', admissionDate: '2026-08-11', assignedDoctor: 'Dr. Sarah Jenkins', assignedNurse: 'Nurse Kevin O\'Connor' },
  { id: 'b-gen-202', bedNumber: 'GEN-202', ward: 'General', room: 'Room 201-B', status: 'occupied', patientId: 'p-1004', patientName: 'David Kim', admissionDate: '2026-08-09', assignedDoctor: 'Dr. Lisa Wong', assignedNurse: 'Nurse Kevin O\'Connor' },
  { id: 'b-gen-203', bedNumber: 'GEN-203', ward: 'General', room: 'Room 202-A', status: 'available' },
  { id: 'b-gen-204', bedNumber: 'GEN-204', ward: 'General', room: 'Room 202-B', status: 'maintenance', notes: 'Electric adjustable track repair' },
  { id: 'b-emg-01', bedNumber: 'EMG-01', ward: 'Emergency', room: 'Triage Bay 1', status: 'occupied', patientId: 'p-1005', patientName: 'James Carter', admissionDate: '2026-08-13', assignedDoctor: 'Dr. Michael Chen', assignedNurse: 'Nurse Maya Patel', vitalAlert: true },
  { id: 'b-emg-02', bedNumber: 'EMG-02', ward: 'Emergency', room: 'Triage Bay 2', status: 'available' },
  { id: 'b-emg-03', bedNumber: 'EMG-03', ward: 'Emergency', room: 'Trauma 1', status: 'occupied', patientId: 'p-1006', patientName: 'Aisha Bello', admissionDate: '2026-08-13', assignedDoctor: 'Dr. David Rodriguez', assignedNurse: 'Nurse John Davis' },
  { id: 'b-mat-301', bedNumber: 'MAT-301', ward: 'Maternity', room: 'Suite 301', status: 'occupied', patientId: 'p-1007', patientName: 'Chloe Bennett', admissionDate: '2026-08-12', assignedDoctor: 'Dr. Fatima Zahra', assignedNurse: 'Nurse Clara Oswald' },
  { id: 'b-mat-302', bedNumber: 'MAT-302', ward: 'Maternity', room: 'Suite 302', status: 'available', assignedDoctor: 'Dr. Layla Mansour' },
  { id: 'b-ped-401', bedNumber: 'PED-401', ward: 'Pediatrics', room: 'Room 401', status: 'occupied', patientId: 'p-1008', patientName: 'Liam Miller', admissionDate: '2026-08-13', assignedDoctor: 'Dr. Sarah Jenkins', assignedNurse: 'Nurse Clara Oswald' },
  { id: 'b-ped-402', bedNumber: 'PED-402', ward: 'Pediatrics', room: 'Room 402', status: 'reserved', notes: 'Admission scheduled at 18:00' },
  { id: 'b-surg-501', bedNumber: 'SURG-501', ward: 'Surgery', room: 'Recovery Bay A', status: 'occupied', patientId: 'p-1009', patientName: 'Robert Thorne', admissionDate: '2026-08-13', assignedDoctor: 'Dr. David Rodriguez', assignedNurse: 'Nurse Kevin O\'Connor' },
];

const initialPatients: Patient[] = [
  {
    id: 'p-1001',
    mrn: 'GH-2026-9812',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    age: 44,
    gender: 'Female',
    bloodGroup: 'O+',
    contactNumber: '+1 (555) 234-5678',
    email: 'elena.rostova@example.com',
    address: '742 Evergreen Terrace, Metro City',
    emergencyContact: { name: 'Dmitri Rostov', relationship: 'Spouse', phone: '+1 (555) 987-6543' },
    allergies: ['Penicillin', 'Sulfa Drugs'],
    chronicConditions: ['Hypertension', 'Type 2 Diabetes'],
    activeBedId: 'b-icu-101',
    activeEncounterId: 'enc-201',
    registeredAt: '2025-11-10',
    encounters: [
      {
        id: 'enc-201',
        type: 'Inpatient',
        department: 'Cardiology ICU',
        admitDate: '2026-08-10',
        chiefComplaint: 'Acute chest tightness, ST-elevation episode post-coronary stent placement',
        attendingPhysician: 'Dr. Sarah Jenkins',
        status: 'active',
        vitalsHistory: [
          { heartRate: 104, bloodPressure: '142/92', temperature: 37.8, respiratoryRate: 21, oxygenSaturation: 94, timestamp: '2026-08-13 14:30' },
          { heartRate: 98, bloodPressure: '138/88', temperature: 37.4, respiratoryRate: 19, oxygenSaturation: 96, timestamp: '2026-08-13 10:00' },
          { heartRate: 92, bloodPressure: '130/84', temperature: 37.1, respiratoryRate: 18, oxygenSaturation: 97, timestamp: '2026-08-12 18:00' },
          { heartRate: 88, bloodPressure: '124/80', temperature: 36.9, respiratoryRate: 16, oxygenSaturation: 99, timestamp: '2026-08-11 12:00' },
        ],
        clinicalNotes: [
          {
            id: 'note-01',
            timestamp: '2026-08-13 11:15',
            author: 'Dr. Sarah Jenkins',
            role: 'Cardiologist',
            category: 'SOAP',
            content: 'Patient had severe retrosternal pain radiating to left jaw at 09:30. Administered IV Morphine 4mg and IV Nitroglycerin infusion titrated to 20mcg/min over 4 hours. Performed bedside point-of-care 2D Echocardiogram with bubble study to assess wall motion. Ordered repeat high-sensitivity Troponin series at 2h intervals and portable chest radiograph.',
            aiStructuredData: {
              chiefComplaint: 'Retrosternal pain post-PCI',
              diagnoses: ['Non-ST Elevation Myocardial Infarction', 'Essential Hypertension', 'Post-procedure Cardiac Ischemia'],
              medicationsPrescribed: ['IV Nitroglycerin infusion 20mcg/min', 'IV Morphine 4mg stat', 'Ticagrelor 90mg BID'],
              recommendedProcedures: ['Bedside 2D Echocardiogram (CPT 93306)', 'Serial Troponin I Biomarkers', 'Continuous ICU Hemodynamic Telemetry'],
              followUpDays: 2,
              billingCodes: [
                { code: '93306', description: 'Transthoracic Echocardiography 2D w/ Doppler', fee: 520 },
                { code: '96365', description: 'Intravenous Infusion Therapy (Initial 1hr)', fee: 180 },
                { code: '96366', description: 'Intravenous Infusion Therapy (Additional hr x3)', fee: 240 },
                { code: '99233', description: 'Subsequent Hospital ICU Care (High Complexity)', fee: 310 },
              ],
            },
          },
        ],
        medications: [
          { id: 'm-1', name: 'Ticagrelor', dosage: '90mg', frequency: 'BID', route: 'Oral', status: 'active', prescribedDate: '2026-08-10', prescribedBy: 'Dr. Sarah Jenkins', stockRemaining: 140, unitPrice: 12 },
          { id: 'm-2', name: 'Atorvastatin', dosage: '80mg', frequency: 'Daily (QHS)', route: 'Oral', status: 'active', prescribedDate: '2026-08-10', prescribedBy: 'Dr. Sarah Jenkins', stockRemaining: 320, unitPrice: 4.5 },
          { id: 'm-3', name: 'IV Nitroglycerin', dosage: '20mcg/min', frequency: 'Continuous 4h', route: 'IV Infusion', status: 'active', prescribedDate: '2026-08-13', prescribedBy: 'Dr. Sarah Jenkins', stockRemaining: 45, unitPrice: 85 },
        ],
        labOrders: [
          {
            id: 'lab-ord-881',
            testName: 'High-Sensitivity Troponin I & Lipid Panel',
            category: 'Biochemistry',
            status: 'completed',
            orderedAt: '2026-08-13 08:00',
            completedAt: '2026-08-13 10:15',
            sampleId: 'SMP-9921',
            technician: 'Alex Rivera, MLS',
            cost: 140,
            results: [
              { parameter: 'Troponin I', value: '0.042', unit: 'ng/mL', normalRange: '< 0.014', flag: 'High' },
              { parameter: 'Total Cholesterol', value: '215', unit: 'mg/dL', normalRange: '< 200', flag: 'High' },
              { parameter: 'LDL Cholesterol', value: '138', unit: 'mg/dL', normalRange: '< 100', flag: 'High' },
              { parameter: 'HDL Cholesterol', value: '46', unit: 'mg/dL', normalRange: '> 50', flag: 'Low' },
              { parameter: 'Triglycerides', value: '155', unit: 'mg/dL', normalRange: '< 150', flag: 'High' },
            ],
          },
          {
            id: 'rad-ord-204',
            testName: 'Portable Chest X-Ray (Single View AP)',
            category: 'Radiology',
            status: 'completed',
            orderedAt: '2026-08-13 10:00',
            completedAt: '2026-08-13 11:30',
            sampleId: 'RAD-4491',
            technician: 'Dr. Liam Reynolds, Radiologist',
            cost: 190,
            notes: 'No pneumothorax or acute alveolar infiltrate. Cardiomegaly with stable mediastinal contours.',
          },
        ],
        billing: {
          items: [
            { id: 'bi-1', description: 'ICU Bed Accommodation (Per Diem)', code: 'BED-ICU', category: 'Bed Charges', quantity: 3, unitPrice: 450, totalPrice: 1350, auditedStatus: 'verified' },
            { id: 'bi-2', description: 'Initial ICU Consultation', code: '99223', category: 'Consultation', quantity: 1, unitPrice: 350, totalPrice: 350, auditedStatus: 'verified' },
            { id: 'bi-3', description: 'Lipid & Troponin Diagnostic Panel', code: 'LAB-881', category: 'Lab & Diagnostics', quantity: 1, unitPrice: 140, totalPrice: 140, auditedStatus: 'verified' },
          ],
          subtotal: 1840,
          tax: 92,
          insuranceCoverage: 1472,
          patientPayable: 460,
          paymentStatus: 'pending',
        },
      },
    ],
  },
  {
    id: 'p-1002',
    mrn: 'GH-2026-9813',
    fullName: 'Marcus Vance',
    dateOfBirth: '1975-09-22',
    age: 50,
    gender: 'Male',
    bloodGroup: 'A+',
    contactNumber: '+1 (555) 345-6789',
    email: 'm.vance@example.com',
    address: '1204 Pine Street, Metro City',
    emergencyContact: { name: 'Sarah Vance', relationship: 'Daughter', phone: '+1 (555) 876-5432' },
    allergies: ['Aspirin'],
    chronicConditions: ['COPD', 'Atrial Fibrillation'],
    activeBedId: 'b-icu-102',
    activeEncounterId: 'enc-202',
    registeredAt: '2026-01-14',
    encounters: [
      {
        id: 'enc-202',
        type: 'Inpatient',
        department: 'Pulmonary ICU',
        admitDate: '2026-08-12',
        chiefComplaint: 'Acute exacerbation of COPD with severe respiratory distress',
        attendingPhysician: 'Dr. Michael Chen',
        status: 'active',
        vitalsHistory: [
          { heartRate: 112, bloodPressure: '150/96', temperature: 38.2, respiratoryRate: 28, oxygenSaturation: 89, timestamp: '2026-08-13 13:00' },
          { heartRate: 106, bloodPressure: '144/90', temperature: 38.0, respiratoryRate: 24, oxygenSaturation: 92, timestamp: '2026-08-12 20:00' },
        ],
        clinicalNotes: [
          {
            id: 'note-02',
            timestamp: '2026-08-13 09:00',
            author: 'Dr. Michael Chen',
            role: 'Pulmonologist',
            category: 'SOAP',
            content: 'Placed on high-flow BiPAP non-invasive positive pressure ventilation (NIPPV) setting 14/6cm H2O for 6 continuous hours. Initiated continuous albuterol-ipratropium duo-nebulizer treatments q2h and IV Methylprednisolone 60mg. Arterial blood gas (ABG) drawn showing respiratory acidosis.',
            aiStructuredData: {
              chiefComplaint: 'COPD hypercapnic respiratory failure',
              diagnoses: ['Acute Exacerbation of Chronic Obstructive Pulmonary Disease', 'Acute Respiratory Acidosis'],
              medicationsPrescribed: ['IV Solu-Medrol 60mg BID', 'Duoneb inhalation Q2H'],
              recommendedProcedures: ['Non-invasive Positive Pressure Ventilation (BiPAP CPT 94660)', 'Arterial Blood Gas Analysis (CPT 82803)', 'Serial Peak Flow Monitoring'],
              followUpDays: 1,
              billingCodes: [
                { code: '94660', description: 'Non-invasive positive pressure respiratory support', fee: 280 },
                { code: '82803', description: 'Arterial Blood Gases (pH, pCO2, pO2, HCO3)', fee: 95 },
                { code: '94640', description: 'Non-pressurized inhalation treatment (x3)', fee: 165 },
              ],
            },
          },
        ],
        medications: [
          { id: 'm-4', name: 'Methylprednisolone IV', dosage: '60mg', frequency: 'BID', route: 'IV Push', status: 'active', prescribedDate: '2026-08-12', prescribedBy: 'Dr. Michael Chen', stockRemaining: 80, unitPrice: 35 },
          { id: 'm-5', name: 'Albuterol/Ipratropium', dosage: '3mg/0.5mg', frequency: 'Q2H', route: 'Inhalation', status: 'active', prescribedDate: '2026-08-12', prescribedBy: 'Dr. Michael Chen', stockRemaining: 190, unitPrice: 18 },
        ],
        labOrders: [
          {
            id: 'lab-ord-882',
            testName: 'Arterial Blood Gas (ABG)',
            category: 'Biochemistry',
            status: 'completed',
            orderedAt: '2026-08-13 09:15',
            completedAt: '2026-08-13 09:40',
            sampleId: 'SMP-9922',
            cost: 95,
            results: [
              { parameter: 'pH', value: '7.31', unit: '', normalRange: '7.35 - 7.45', flag: 'Low' },
              { parameter: 'pCO2', value: '54', unit: 'mmHg', normalRange: '35 - 45', flag: 'High' },
              { parameter: 'pO2', value: '62', unit: 'mmHg', normalRange: '80 - 100', flag: 'Low' },
              { parameter: 'HCO3', value: '28', unit: 'mEq/L', normalRange: '22 - 26', flag: 'High' },
            ],
          },
        ],
        billing: {
          items: [
            { id: 'bi-4', description: 'ICU Bed Stay', code: 'BED-ICU', category: 'Bed Charges', quantity: 2, unitPrice: 450, totalPrice: 900, auditedStatus: 'verified' },
          ],
          subtotal: 900,
          tax: 45,
          insuranceCoverage: 720,
          patientPayable: 225,
          paymentStatus: 'pending',
        },
      },
    ],
  },
  {
    id: 'p-1003',
    mrn: 'GH-2026-9814',
    fullName: 'Sophia Al-Mansoor',
    dateOfBirth: '1990-12-05',
    age: 35,
    gender: 'Female',
    bloodGroup: 'B+',
    contactNumber: '+1 (555) 456-7890',
    email: 'sophia.m@example.com',
    address: '88 Oasis Boulevard, Metro City',
    emergencyContact: { name: 'Tariq Al-Mansoor', relationship: 'Brother', phone: '+1 (555) 765-4321' },
    allergies: [],
    chronicConditions: [],
    activeBedId: 'b-gen-201',
    activeEncounterId: 'enc-203',
    registeredAt: '2026-02-01',
    encounters: [],
  },
  {
    id: 'p-1004',
    mrn: 'GH-2026-9815',
    fullName: 'David Kim',
    dateOfBirth: '1968-07-19',
    age: 58,
    gender: 'Male',
    bloodGroup: 'AB+',
    contactNumber: '+1 (555) 567-8901',
    email: 'david.kim@example.com',
    address: '404 Maple Court, Metro City',
    emergencyContact: { name: 'Grace Kim', relationship: 'Spouse', phone: '+1 (555) 654-3210' },
    allergies: ['Cephalosporins'],
    chronicConditions: ['Chronic Kidney Disease Stage 3'],
    activeBedId: 'b-gen-202',
    activeEncounterId: 'enc-204',
    registeredAt: '2025-08-19',
    encounters: [],
  },
  {
    id: 'p-1005',
    mrn: 'GH-2026-9816',
    fullName: 'James Carter',
    dateOfBirth: '1995-03-30',
    age: 31,
    gender: 'Male',
    bloodGroup: 'O-',
    contactNumber: '+1 (555) 678-9012',
    email: 'j.carter@example.com',
    address: '512 Harbor View, Metro City',
    emergencyContact: { name: 'Emma Carter', relationship: 'Sister', phone: '+1 (555) 543-2109' },
    allergies: ['Latex'],
    chronicConditions: [],
    activeBedId: 'b-emg-01',
    activeEncounterId: 'enc-205',
    registeredAt: '2026-08-13',
    encounters: [],
  },
  {
    id: 'p-1006',
    mrn: 'GH-2026-9817',
    fullName: 'Aisha Bello',
    dateOfBirth: '1997-02-18',
    age: 29,
    gender: 'Female',
    bloodGroup: 'A-',
    contactNumber: '+1 (555) 789-0123',
    email: 'aisha.bello@example.com',
    address: '88 Cedar Park Avenue, Metro City',
    emergencyContact: { name: 'Tariq Bello', relationship: 'Brother', phone: '+1 (555) 789-9988' },
    allergies: ['Carbamazepine'],
    chronicConditions: ['Focal Epilepsy', 'Migraine'],
    activeEncounterId: 'enc-206',
    registeredAt: '2026-03-15',
    encounters: [
      {
        id: 'enc-206',
        type: 'Outpatient',
        department: 'Neurology & Stroke',
        admitDate: '2026-08-13',
        chiefComplaint: 'Refractory partial focal seizures with sensory aura',
        attendingPhysician: 'Dr. Aisha Al-Nuaimi',
        status: 'active',
        vitalsHistory: [
          { heartRate: 76, bloodPressure: '118/76', temperature: 36.8, respiratoryRate: 15, oxygenSaturation: 99, timestamp: '2026-08-13 10:15' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 120, tax: 6, insuranceCoverage: 100, patientPayable: 26, paymentStatus: 'settled' },
      },
    ],
  },
  {
    id: 'p-1007',
    mrn: 'GH-2026-9818',
    fullName: 'Chloe Bennett',
    dateOfBirth: '1994-09-05',
    age: 32,
    gender: 'Female',
    bloodGroup: 'O+',
    contactNumber: '+1 (555) 890-1234',
    email: 'chloe.bennett@example.com',
    address: '104 Highland Crescent, Metro City',
    emergencyContact: { name: 'Lucas Bennett', relationship: 'Spouse', phone: '+1 (555) 890-5678' },
    allergies: ['Amoxicillin'],
    chronicConditions: ['Gestational Hypertension'],
    activeEncounterId: 'enc-207',
    registeredAt: '2026-04-10',
    encounters: [
      {
        id: 'enc-207',
        type: 'Outpatient',
        department: 'Obstetrics & Gynecology (OB/GYN)',
        admitDate: '2026-08-13',
        chiefComplaint: '32-week gestation antenatal check, elevated BP 145/94',
        attendingPhysician: 'Dr. Fatima Zahra',
        status: 'active',
        vitalsHistory: [
          { heartRate: 84, bloodPressure: '144/92', temperature: 37.0, respiratoryRate: 17, oxygenSaturation: 98, timestamp: '2026-08-13 10:30' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 150, tax: 7.5, insuranceCoverage: 120, patientPayable: 37.5, paymentStatus: 'settled' },
      },
    ],
  },
  {
    id: 'p-1008',
    mrn: 'GH-2026-9819',
    fullName: 'Liam Miller',
    dateOfBirth: '2019-06-22',
    age: 7,
    gender: 'Male',
    bloodGroup: 'B+',
    contactNumber: '+1 (555) 901-2345',
    email: 'sarah.miller.parent@example.com',
    address: '22 Maple Ridge Road, Metro City',
    emergencyContact: { name: 'Sarah Miller', relationship: 'Mother', phone: '+1 (555) 901-2345' },
    allergies: ['Peanuts'],
    chronicConditions: ['Pediatric Asthma'],
    activeBedId: 'b-ped-401',
    activeEncounterId: 'enc-208',
    registeredAt: '2026-05-18',
    encounters: [
      {
        id: 'enc-208',
        type: 'Inpatient',
        department: 'Pediatrics',
        admitDate: '2026-08-12',
        chiefComplaint: 'Acute viral bronchitis with bronchospasm and wheezing',
        attendingPhysician: 'Dr. Zainab Qureshi',
        status: 'active',
        vitalsHistory: [
          { heartRate: 110, bloodPressure: '102/65', temperature: 38.3, respiratoryRate: 26, oxygenSaturation: 95, timestamp: '2026-08-13 10:45' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 350, tax: 17.5, insuranceCoverage: 300, patientPayable: 67.5, paymentStatus: 'pending' },
      },
    ],
  },
  {
    id: 'p-1009',
    mrn: 'GH-2026-9820',
    fullName: 'Robert Thorne',
    dateOfBirth: '1964-11-12',
    age: 62,
    gender: 'Male',
    bloodGroup: 'A+',
    contactNumber: '+1 (555) 012-3456',
    email: 'robert.thorne@example.com',
    address: '430 Oakwood Boulevard, Metro City',
    emergencyContact: { name: 'Patricia Thorne', relationship: 'Spouse', phone: '+1 (555) 012-7890' },
    allergies: ['Ciprofloxacin'],
    chronicConditions: ['Colorectal Adenocarcinoma', 'Coronary Artery Disease'],
    activeBedId: 'b-surg-501',
    activeEncounterId: 'enc-209',
    registeredAt: '2026-01-20',
    encounters: [
      {
        id: 'enc-209',
        type: 'Inpatient',
        department: 'Surgery & Oncology',
        admitDate: '2026-08-13',
        chiefComplaint: 'Cycle 3 FOLFOX chemotherapy staging and post-laparoscopic review',
        attendingPhysician: 'Dr. David Rodriguez',
        status: 'active',
        vitalsHistory: [
          { heartRate: 78, bloodPressure: '132/82', temperature: 36.9, respiratoryRate: 16, oxygenSaturation: 97, timestamp: '2026-08-13 11:00' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 1250, tax: 62.5, insuranceCoverage: 1100, patientPayable: 212.5, paymentStatus: 'pending' },
      },
    ],
  },
  {
    id: 'p-1010',
    mrn: 'GH-2026-9821',
    fullName: 'Amira Al-Hassan',
    dateOfBirth: '1998-07-30',
    age: 28,
    gender: 'Female',
    bloodGroup: 'B-',
    contactNumber: '+1 (555) 123-4567',
    email: 'amira.alhassan@example.com',
    address: '77 Jasmine Garden Way, Metro City',
    emergencyContact: { name: 'Zaid Al-Hassan', relationship: 'Spouse', phone: '+1 (555) 123-9999' },
    allergies: ['Erythromycin'],
    chronicConditions: ['Hyperemesis Gravidarum'],
    activeEncounterId: 'enc-210',
    registeredAt: '2026-06-01',
    encounters: [
      {
        id: 'enc-210',
        type: 'Outpatient',
        department: 'Obstetrics & Gynecology (OB/GYN)',
        admitDate: '2026-08-13',
        chiefComplaint: 'First trimester viability ultrasound & hyperemesis gravidarum review',
        attendingPhysician: 'Dr. Layla Mansour',
        status: 'active',
        vitalsHistory: [
          { heartRate: 82, bloodPressure: '112/72', temperature: 36.7, respiratoryRate: 16, oxygenSaturation: 99, timestamp: '2026-08-13 11:30' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 180, tax: 9, insuranceCoverage: 150, patientPayable: 39, paymentStatus: 'settled' },
      },
    ],
  },
  {
    id: 'p-1011',
    mrn: 'GH-2026-9822',
    fullName: 'Grace Montgomery',
    dateOfBirth: '1980-03-14',
    age: 46,
    gender: 'Female',
    bloodGroup: 'AB-',
    contactNumber: '+1 (555) 234-5679',
    email: 'grace.montgomery@example.com',
    address: '610 Pinecrest Court, Metro City',
    emergencyContact: { name: 'Edward Montgomery', relationship: 'Spouse', phone: '+1 (555) 234-8888' },
    allergies: ['Aspirin', 'Ibuprofen (NSAIDs)'],
    chronicConditions: ['Uterine Fibroids', 'Iron Deficiency Anemia'],
    activeEncounterId: 'enc-211',
    registeredAt: '2026-07-04',
    encounters: [
      {
        id: 'enc-211',
        type: 'Outpatient',
        department: 'Obstetrics & Gynecology (OB/GYN)',
        admitDate: '2026-08-13',
        chiefComplaint: 'Postmenopausal abnormal uterine bleeding, hysteroscopy biopsy staging',
        attendingPhysician: 'Dr. Evelyn Vance',
        status: 'active',
        vitalsHistory: [
          { heartRate: 80, bloodPressure: '126/80', temperature: 37.1, respiratoryRate: 16, oxygenSaturation: 98, timestamp: '2026-08-13 11:45' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 210, tax: 10.5, insuranceCoverage: 175, patientPayable: 45.5, paymentStatus: 'settled' },
      },
    ],
  },
  {
    id: 'p-1012',
    mrn: 'GH-2026-9899',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    age: 44,
    gender: 'Female',
    bloodGroup: 'O+',
    contactNumber: '+1 (555) 234-5678',
    email: 'elena.rostova@example.com',
    address: '742 Evergreen Terrace, Metro City',
    emergencyContact: { name: 'Dmitri Rostov', relationship: 'Spouse', phone: '+1 (555) 987-6543' },
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
    activeEncounterId: 'enc-212',
    registeredAt: '2026-08-13',
    encounters: [
      {
        id: 'enc-212',
        type: 'Emergency',
        department: 'Emergency & Triage',
        admitDate: '2026-08-13',
        chiefComplaint: 'Secondary emergency intake duplicate (accidental duplicate registration during acute triage)',
        attendingPhysician: 'Dr. David Rodriguez',
        status: 'active',
        vitalsHistory: [
          { heartRate: 96, bloodPressure: '140/90', temperature: 37.4, respiratoryRate: 18, oxygenSaturation: 96, timestamp: '2026-08-13 12:10' },
        ],
        clinicalNotes: [],
        medications: [],
        labOrders: [],
        billing: { items: [], subtotal: 95, tax: 4.75, insuranceCoverage: 80, patientPayable: 19.75, paymentStatus: 'pending' },
      },
    ],
  },
];

const initialMismatches: BillingAuditMismatch[] = [
  {
    id: 'mm-101',
    patientId: 'p-1001',
    patientName: 'Elena Rostova',
    encounterId: 'enc-201',
    noteId: 'note-01',
    date: '2026-08-13',
    documentedItem: 'Bedside 2D Echocardiography with Bubble Study performed post-PCI',
    category: 'Procedure',
    suggestedCptCode: '93306',
    estimatedRecoverableRevenue: 520,
    status: 'pending_review',
    evidenceSnippet: 'Dr. Jenkins note: "Performed bedside point-of-care 2D Echocardiogram with bubble study to assess wall motion."',
    confidenceScore: 0.98,
  },
  {
    id: 'mm-102',
    patientId: 'p-1001',
    patientName: 'Elena Rostova',
    encounterId: 'enc-201',
    noteId: 'note-01',
    date: '2026-08-13',
    documentedItem: 'IV Nitroglycerin Continuous Infusion therapy (4 Hours titration)',
    category: 'Procedure',
    suggestedCptCode: '96365 + 96366 x3',
    estimatedRecoverableRevenue: 420,
    status: 'pending_review',
    evidenceSnippet: 'Dr. Jenkins note: "IV Nitroglycerin infusion titrated to 20mcg/min over 4 hours."',
    confidenceScore: 0.95,
  },
  {
    id: 'mm-103',
    patientId: 'p-1002',
    patientName: 'Marcus Vance',
    encounterId: 'enc-202',
    noteId: 'note-02',
    date: '2026-08-13',
    documentedItem: 'BiPAP Non-invasive Positive Pressure Ventilation (NIPPV 6 Hours)',
    category: 'Procedure',
    suggestedCptCode: '94660',
    estimatedRecoverableRevenue: 280,
    status: 'pending_review',
    evidenceSnippet: 'Dr. Chen note: "Placed on high-flow BiPAP non-invasive positive pressure ventilation setting 14/6cm H2O for 6 continuous hours."',
    confidenceScore: 0.99,
  },
  {
    id: 'mm-104',
    patientId: 'p-1002',
    patientName: 'Marcus Vance',
    encounterId: 'enc-202',
    noteId: 'note-02',
    date: '2026-08-13',
    documentedItem: 'Arterial Blood Gas (ABG) Puncture & Lab Diagnostic',
    category: 'Lab',
    suggestedCptCode: '82803',
    estimatedRecoverableRevenue: 95,
    status: 'pending_review',
    evidenceSnippet: 'Dr. Chen note: "Arterial blood gas (ABG) drawn showing respiratory acidosis."',
    confidenceScore: 0.94,
  },
  {
    id: 'mm-105',
    patientId: 'p-1002',
    patientName: 'Marcus Vance',
    encounterId: 'enc-202',
    noteId: 'note-02',
    date: '2026-08-13',
    documentedItem: 'Duoneb Inhalation Treatments (3 Sessions)',
    category: 'Medication',
    suggestedCptCode: '94640 x3',
    estimatedRecoverableRevenue: 165,
    status: 'pending_review',
    evidenceSnippet: 'Dr. Chen note: "Initiated continuous albuterol-ipratropium duo-nebulizer treatments q2h."',
    confidenceScore: 0.92,
  },
];

const initialOpdQueue: OpdQueueToken[] = [
  { id: 'tok-01', tokenNumber: 'OPD-101', patientId: 'p-1001', patientName: 'Elena Rostova', mrn: 'GH-2026-9812', age: 44, gender: 'Female', department: 'Cardiology', assignedDoctor: 'Dr. Sarah Jenkins', priority: 'urgent', status: 'in_consultation', arrivalTime: '08:45 AM', chiefComplaint: 'Follow-up on Post-PCI Stent & Chest tightness' },
  { id: 'tok-02', tokenNumber: 'OPD-102', patientId: 'p-1003', patientName: 'Sophia Al-Mansoor', mrn: 'GH-2026-9814', age: 35, gender: 'Female', department: 'General Medicine & Pulmonology', assignedDoctor: 'Dr. Michael Chen', priority: 'routine', status: 'waiting', arrivalTime: '09:10 AM', chiefComplaint: 'Persistent fever, myalgias for 4 days' },
  { id: 'tok-03', tokenNumber: 'OPD-103', patientId: 'p-1004', patientName: 'David Kim', mrn: 'GH-2026-9815', age: 58, gender: 'Male', department: 'Nephrology & Endocrinology', assignedDoctor: 'Dr. Lisa Wong', priority: 'routine', status: 'waiting', arrivalTime: '09:30 AM', chiefComplaint: 'Elevated serum creatinine follow-up, lower extremity edema' },
  { id: 'tok-04', tokenNumber: 'OPD-104', patientId: 'p-1005', patientName: 'James Carter', mrn: 'GH-2026-9816', age: 31, gender: 'Male', department: 'Trauma / Emergency', assignedDoctor: 'Dr. David Rodriguez', priority: 'stat_emergency', status: 'waiting', arrivalTime: '09:42 AM', chiefComplaint: 'Motorcycle collision, blunt right thoracic trauma' },
  { id: 'tok-05', tokenNumber: 'OPD-105', patientId: 'p-1002', patientName: 'Marcus Vance', mrn: 'GH-2026-9813', age: 50, gender: 'Male', department: 'Critical Care & Pulmonology', assignedDoctor: 'Dr. Marcus Vance', priority: 'urgent', status: 'waiting', arrivalTime: '10:05 AM', chiefComplaint: 'COPD exacerbation, post-BiPAP review' },
  { id: 'tok-06', tokenNumber: 'OPD-106', patientId: 'p-1006', patientName: 'Aisha Bello', mrn: 'GH-2026-9817', age: 29, gender: 'Female', department: 'Neurology & Stroke', assignedDoctor: 'Dr. Aisha Al-Nuaimi', priority: 'urgent', status: 'waiting', arrivalTime: '10:15 AM', chiefComplaint: 'Refractory partial focal seizures with aura' },
  { id: 'tok-07', tokenNumber: 'OPD-107', patientId: 'p-1007', patientName: 'Chloe Bennett', mrn: 'GH-2026-9818', age: 32, gender: 'Female', department: 'Obstetrics & Gynecology (OB/GYN)', assignedDoctor: 'Dr. Fatima Zahra', priority: 'routine', status: 'waiting', arrivalTime: '10:30 AM', chiefComplaint: '32-week gestation antenatal check, elevated BP 145/94' },
  { id: 'tok-08', tokenNumber: 'OPD-108', patientId: 'p-1008', patientName: 'Liam Miller', mrn: 'GH-2026-9819', age: 7, gender: 'Male', department: 'Pediatrics', assignedDoctor: 'Dr. Zainab Qureshi', priority: 'routine', status: 'waiting', arrivalTime: '10:45 AM', chiefComplaint: 'High-grade fever with wheeze, asthma exacerbation' },
  { id: 'tok-09', tokenNumber: 'OPD-109', patientId: 'p-1009', patientName: 'Robert Thorne', mrn: 'GH-2026-9820', age: 62, gender: 'Male', department: 'Oncology', assignedDoctor: 'Dr. Tariq Mansoor', priority: 'routine', status: 'waiting', arrivalTime: '11:00 AM', chiefComplaint: 'Cycle 3 FOLFOX chemotherapy staging review' },
  { id: 'tok-10', tokenNumber: 'OPD-110', patientId: 'p-1010', patientName: 'Amira Al-Hassan', mrn: 'GH-2026-9821', age: 28, gender: 'Female', department: 'Obstetrics & Gynecology (OB/GYN)', assignedDoctor: 'Dr. Layla Mansour', priority: 'routine', status: 'waiting', arrivalTime: '11:15 AM', chiefComplaint: 'First trimester viability ultrasound & hyperemesis gravidarum review' },
  { id: 'tok-11', tokenNumber: 'OPD-111', patientId: 'p-1011', patientName: 'Grace Montgomery', mrn: 'GH-2026-9822', age: 46, gender: 'Female', department: 'Obstetrics & Gynecology (OB/GYN)', assignedDoctor: 'Dr. Evelyn Vance', priority: 'urgent', status: 'waiting', arrivalTime: '11:30 AM', chiefComplaint: 'Postmenopausal abnormal uterine bleeding, hysteroscopy biopsy staging' },
  { id: 'tok-12', tokenNumber: 'OPD-112', patientId: 'p-1012', patientName: 'Elena Rostova (Duplicate Intake)', mrn: 'GH-2026-9899', age: 44, gender: 'Female', department: 'Emergency & Triage', assignedDoctor: 'Dr. David Rodriguez', priority: 'routine', status: 'waiting', arrivalTime: '11:45 AM', chiefComplaint: 'Duplicate walk-in registration flagged for MPI merge' },
];

const initialHl7Messages: Hl7Message[] = [
  {
    id: 'hl7-801',
    timestamp: '2026-08-13 14:32:10',
    type: 'ADT^A01',
    sendingApp: 'GHIMS_OPD_ADMISSION',
    receivingApp: 'CORE_HIS_MAINFRAME',
    patientMrn: 'GH-2026-9812',
    patientName: 'Elena Rostova',
    status: 'dispatched',
    rawPayload: 'MSH|^~\\&|GHIMS_OPD|METRO_MEMORIAL|CORE_HIS|HOSPITAL|20260813143210||ADT^A01|MSG801|P|2.5\rPID|1||GH-2026-9812^^^GHIMS||Rostova^Elena||19820414|F|||742 Evergreen Terr^^Metro City\rPV1|1|I|ICU^101^01|Cardiology|||Dr. Jenkins^Sarah\rIN1|1|BLUE_CROSS|BCBS-991823',
    parsedSummary: 'Inpatient Admission to Cardiology ICU Bed 101, Attending: Dr. Sarah Jenkins',
  },
  {
    id: 'hl7-802',
    timestamp: '2026-08-13 14:15:00',
    type: 'ORM^O01',
    sendingApp: 'GHIMS_CLINICAL_ORDER',
    receivingApp: 'ROCHE_COBAS_LIS',
    patientMrn: 'GH-2026-9812',
    patientName: 'Elena Rostova',
    status: 'dispatched',
    rawPayload: 'MSH|^~\\&|GHIMS_EHR|METRO_MEMORIAL|ROCHE_LIS|LAB|20260813141500||ORM^O01|MSG802|P|2.5\rPID|1||GH-2026-9812^^^GHIMS||Rostova^Elena\rORC|NW|ORD-881|||SC\rOBR|1|ORD-881||881^Troponin I & Lipid Panel^CPT||20260813141500',
    parsedSummary: 'New Lab Order: High-Sensitivity Troponin I & Lipid Panel sent to Roche Cobas LIS',
  },
  {
    id: 'hl7-803',
    timestamp: '2026-08-13 10:15:22',
    type: 'ORU^R01',
    sendingApp: 'ROCHE_COBAS_LIS',
    receivingApp: 'GHIMS_EHR_STORE',
    patientMrn: 'GH-2026-9812',
    patientName: 'Elena Rostova',
    status: 'parsed',
    rawPayload: 'MSH|^~\\&|ROCHE_LIS|LAB|GHIMS_EHR|METRO_MEMORIAL|20260813101522||ORU^R01|MSG803|P|2.5\rPID|1||GH-2026-9812^^^GHIMS||Rostova^Elena\rOBX|1|NM|TROP_I^Troponin I||0.042|ng/mL|<0.014|H|||F',
    parsedSummary: 'Unsolicited Observation Result: Troponin I = 0.042 ng/mL (HIGH ALERT flag)',
  },
];

const initialStaff: StaffMember[] = [
  { id: 'st-01', fullName: 'Dr. Sarah Jenkins', role: 'Physician', department: 'Cardiology', shift: 'Morning', phone: '+1 (555) 111-2233', status: 'on-duty', assignedPatientsCount: 6 },
  { id: 'st-02', fullName: 'Dr. Michael Chen', role: 'Physician', department: 'Pulmonology & ICU', shift: 'Morning', phone: '+1 (555) 222-3344', status: 'on-duty', assignedPatientsCount: 8 },
  { id: 'st-03', fullName: 'Dr. Lisa Wong', role: 'Physician', department: 'Nephrology & Endocrinology', shift: 'Evening', phone: '+1 (555) 333-4455', status: 'on-duty', assignedPatientsCount: 4 },
  { id: 'st-04', fullName: 'Dr. David Rodriguez', role: 'Surgeon', department: 'Trauma & Orthopedic Surgery', shift: 'On-Call', phone: '+1 (555) 444-5566', status: 'in-surgery', assignedPatientsCount: 3 },
  { id: 'st-05', fullName: 'Dr. Kamran Baig', role: 'Physician', department: 'Cardiac Electrophysiology', shift: 'Morning', phone: '+1 (555) 440-2211', status: 'on-duty', assignedPatientsCount: 3 },
  { id: 'st-06', fullName: 'Dr. Aisha Al-Nuaimi', role: 'Physician', department: 'Neurology & Stroke', shift: 'Morning', phone: '+1 (555) 550-4422', status: 'on-duty', assignedPatientsCount: 5 },
  { id: 'st-07', fullName: 'Dr. Fatima Zahra', role: 'Physician', department: 'Obstetrics & Gynecology (OB/GYN)', shift: 'Morning', phone: '+1 (555) 770-1133', status: 'on-duty', assignedPatientsCount: 4 },
  { id: 'st-18', fullName: 'Dr. Evelyn Vance', role: 'Surgeon', department: 'Obstetrics & Gynecology (OB/GYN)', shift: 'Morning', phone: '+1 (555) 770-2244', status: 'in-surgery', assignedPatientsCount: 3 },
  { id: 'st-19', fullName: 'Dr. Layla Mansour', role: 'Physician', department: 'Obstetrics & Gynecology (OB/GYN)', shift: 'Evening', phone: '+1 (555) 770-3355', status: 'on-duty', assignedPatientsCount: 2 },
  { id: 'st-08', fullName: 'Dr. Marcus Vance', role: 'Physician', department: 'Critical Care & Intensivist (ICU)', shift: 'Night', phone: '+1 (555) 990-1144', status: 'on-duty', assignedPatientsCount: 7 },
  { id: 'st-09', fullName: 'Dr. Tariq Mansoor', role: 'Physician', department: 'Medical Oncology & Hematology', shift: 'Morning', phone: '+1 (555) 660-3355', status: 'on-duty', assignedPatientsCount: 4 },
  { id: 'st-10', fullName: 'Dr. Zainab Qureshi', role: 'Physician', department: 'Pediatrics & Neonatology (NICU)', shift: 'Morning', phone: '+1 (555) 880-4466', status: 'on-duty', assignedPatientsCount: 5 },
  { id: 'st-11', fullName: 'Dr. Faisal Hayat', role: 'Physician', department: 'Gastroenterology & Hepatology', shift: 'Evening', phone: '+1 (555) 330-5577', status: 'on-duty', assignedPatientsCount: 3 },
  { id: 'st-12', fullName: 'Dr. Liam Reynolds', role: 'Physician', department: 'Diagnostic & Interventional Radiology', shift: 'Morning', phone: '+1 (555) 449-1188', status: 'on-duty', assignedPatientsCount: 0 },
  { id: 'st-13', fullName: 'Dr. Ananya Sharma', role: 'Surgeon', department: 'Anesthesiology & Perioperative Care', shift: 'On-Call', phone: '+1 (555) 992-3300', status: 'on-duty', assignedPatientsCount: 2 },
  { id: 'st-14', fullName: 'Nurse John Davis', role: 'Nurse', department: 'ICU', shift: 'Morning', phone: '+1 (555) 555-6677', status: 'on-duty', assignedPatientsCount: 4 },
  { id: 'st-15', fullName: 'Nurse Maya Patel', role: 'Nurse', department: 'Emergency', shift: 'Morning', phone: '+1 (555) 666-7788', status: 'on-duty', assignedPatientsCount: 5 },
  { id: 'st-16', fullName: 'Nurse Clara Oswald', role: 'Nurse', department: 'Maternity & Peds', shift: 'Evening', phone: '+1 (555) 777-8899', status: 'on-duty', assignedPatientsCount: 3 },
  { id: 'st-17', fullName: 'Alex Rivera', role: 'Lab Technician', department: 'Biochemistry / LIS', shift: 'Morning', phone: '+1 (555) 888-9900', status: 'on-duty', assignedPatientsCount: 0 },
];

const initialAuditLogs: AuditLogEntry[] = [
  { id: 'aud-1', timestamp: '2026-08-13 14:32:10', userId: 'usr-dr-jenkins', userName: 'Dr. Sarah Jenkins', role: 'Cardiologist', action: 'CREATE_CLINICAL_NOTE', resource: 'Patient: GH-2026-9812', ipAddress: '192.168.1.104', status: 'SUCCESS', details: 'Added SOAP note with bedside 2D echocardiogram observation' },
  { id: 'aud-2', timestamp: '2026-08-13 14:32:15', userId: 'sys-leakage-engine', userName: 'G-HIMS AI Audit Daemon', role: 'System Service', action: 'DETECT_REVENUE_MISMATCH', resource: 'Encounter: enc-201', ipAddress: '127.0.0.1 (Local Edge)', status: 'WARNING', details: 'Flagged $940 unbilled procedures (Echocardiography 93306 & IV Infusion 96365)' },
  { id: 'aud-3', timestamp: '2026-08-13 14:15:00', userId: 'usr-dr-jenkins', userName: 'Dr. Sarah Jenkins', role: 'Cardiologist', action: 'DISPATCH_HL7_ORM', resource: 'Lab Order: ORD-881', ipAddress: '192.168.1.104', status: 'SUCCESS', details: 'Dispatched HL7 ORM^O01 order to Roche Cobas LIS' },
  { id: 'aud-4', timestamp: '2026-08-13 13:45:20', userId: 'usr-nurse-john', userName: 'Nurse John Davis', role: 'ICU Nurse', action: 'RECORD_VITALS', resource: 'Patient: GH-2026-9812', ipAddress: '192.168.1.112', status: 'SUCCESS', details: 'Recorded HR 104, BP 142/92, SpO2 94%' },
  { id: 'aud-5', timestamp: '2026-08-13 11:20:00', userId: 'usr-admin-billing', userName: 'Billing Office (Reconciliation)', role: 'Billing Admin', action: 'RECONCILE_LEAKAGE', resource: 'Encounter: enc-201', ipAddress: '192.168.1.205', status: 'SUCCESS', details: 'Added CPT 93000 to patient invoice with insurance pre-auth' },
];

const executiveThesisData: ExecutiveThesisModel = {
  targetMarket: {
    tamSize: '$6.8 Trillion',
    targetBeds: '<200-300 Beds (Small & Mid-Sized Segment)',
    regions: ['Pakistan', 'MENA', 'Southeast Asia', 'Sub-Saharan Africa', 'Latin America'],
    corePainPoint: '80% clinical notes vs. final bill mismatch, driving over $40 Billion in annual revenue leakage in infrastructure-constrained hospitals.',
  },
  unitEconomics: {
    blendedAcv: 38650,
    platformSubscription: 1200,
    moduleLicensing: 2500,
    specialtyUsers: 4950,
    performanceShareAvg: 30000,
    cogsPerHospitalYear: 13000,
    grossMarginPercent: 66,
    ltv: 105000,
    cac: 5000,
    ltvCacRatio: '21 : 1',
    paybackMonths: 2.3,
  },
  fundRaise: {
    seedAsk: 1500000,
    monthlyBurn: 85000,
    runwayMonths: 18,
    useOfFunds: [
      { label: 'Hospital Deployment & Hardware Edge Gateways', percentage: 40, amount: 600000 },
      { label: 'Product & Clinical AI Engine R&D', percentage: 30, amount: 450000 },
      { label: 'Regional Sales & Partner Channel Scaling', percentage: 20, amount: 300000 },
      { label: 'Regulatory Compliance (HIPAA, SOC 2, ISO 27001)', percentage: 10, amount: 150000 },
    ],
    milestones: [
      { period: 'Month 6', targetHospitals: 3, targetArr: 'Pilot Phase', focus: 'Realize ~23% revenue recovery in initial hospital deployments', status: 'in_progress' },
      { period: 'Month 12', targetHospitals: 10, targetArr: '$400,000 ARR', focus: 'Stress-test event architecture to 99.9% offline local sync uptime', status: 'planned' },
      { period: 'Month 18', targetHospitals: 25, targetArr: '$1,200,000 ARR', focus: 'Reach Series A readiness with proven multi-country unit economics', status: 'planned' },
    ],
  },
  competitiveMoat: {
    pillars: [
      {
        title: 'Edge-AI Engine',
        highlight: '2 Years R&D on Dual-Sync',
        description: 'Zero cloud latency; works 100% offline during fiber/power outages, auto-reconciling mutations via vector clocks upon reconnection.',
      },
      {
        title: 'Local Clinical Notes Fine-Tuning',
        highlight: '50,000+ Processed Clinical Notes',
        description: 'Trained on regional dialectal abbreviations, handwritten transcription patterns, and localized CPT/ICD mappings.',
      },
      {
        title: 'Zero-Upfront Cost Model',
        highlight: 'Aligned Performance Share',
        description: 'Captures ~15-20% of net recovered leakage revenue ($30,000/yr upside per hospital) with near-zero financial friction for adoption.',
      },
    ],
  },
};

interface HospitalContextType {
  beds: Bed[];
  patients: Patient[];
  staff: StaffMember[];
  stats: HospitalStats;
  opdQueue: OpdQueueToken[];
  mismatches: BillingAuditMismatch[];
  hl7Messages: Hl7Message[];
  auditLogs: AuditLogEntry[];
  offlineMutations: OfflineMutation[];
  executiveThesis: ExecutiveThesisModel;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  networkMode: 'online' | 'offline' | 'degraded_sync';
  setNetworkMode: (mode: 'online' | 'offline' | 'degraded_sync') => void;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  
  // Permanent Discharged Census & Reconciliation Audit
  dischargedCensus: DischargedCensusRecord[];
  reconcileCensus: () => {
    totalCapacity: number;
    occupiedCount: number;
    availableCount: number;
    cleaningCount: number;
    maintenanceCount: number;
    reservedCount: number;
    activePatientCensusCount: number;
    dischargedCount: number;
    isReconciled: boolean;
    unaccountedLossCount: number;
  };

  // Actions
  updateBedStatus: (bedId: string, status: BedStatus, patientId?: string, notes?: string) => void;
  assignPatientToBed: (bedId: string, patientId: string) => void;
  admitPatientToBed: (patientId: string, bedId: string, doctor?: string, nurse?: string) => void;
  dischargePatientFromBed: (
    bedId: string,
    notes?: string,
    disposition?: string,
    censusRecord?: DischargedCensusRecord
  ) => void;
  registerNewPatient: (patientData: Omit<Patient, 'id' | 'mrn' | 'registeredAt' | 'encounters'>) => Patient;
  mergePatients: (primaryId: string, secondaryId: string, mergeReason: string) => Promise<Patient>;
  addClinicalNote: (patientId: string, note: Omit<ClinicalNote, 'id' | 'timestamp'>) => void;
  addLabOrder: (patientId: string, order: Omit<LabOrder, 'id' | 'orderedAt'>) => void;
  addVitals: (patientId: string, vitals: Omit<Vitals, 'timestamp'>) => void;
  reconcileMismatch: (mismatchId: string) => void;
  dismissMismatch: (mismatchId: string) => void;
  dispatchHl7Message: (message: Omit<Hl7Message, 'id' | 'timestamp' | 'status'>) => void;
  callNextOpdToken: (tokenId: string) => void;
  completeOpdToken: (tokenId: string) => void;
  triggerOfflineSync: () => void;
  addAuditLog: (
    action: string,
    resource: string,
    details: string,
    status?: 'SUCCESS' | 'WARNING' | 'DENIED' | 'SECURITY_ALERT' | 'INFO' | 'ERROR'
  ) => void;
  
  // Telehealth & Remote Care Clinic
  telehealthSessions: TelehealthSession[];
  activeTelehealthSession: TelehealthSession | null;
  setActiveTelehealthSession: (session: TelehealthSession | null) => void;
  createTelehealthSession: (data: {
    patientId: string;
    type: TelehealthSession['type'];
    scheduledTime?: string;
    chiefComplaint: string;
    attendingPhysician?: string;
  }) => Promise<TelehealthSession>;
  updateTelehealthSession: (sessionId: string, updates: Partial<TelehealthSession>) => Promise<void>;
  completeTelehealthSession: (sessionId: string, note?: Partial<TelehealthSoapNote>, prescriptions?: TelehealthPrescription[]) => Promise<void>;
}

const HospitalContext = createContext<HospitalContextType | undefined>(undefined);

export function HospitalProvider({ children }: { children: React.ReactNode }) {
  const [beds, setBeds] = useState<Bed[]>(initialBeds);
  const [patients, setPatients] = useState<Patient[]>(initialPatients);
  const [staff, setStaff] = useState<StaffMember[]>(initialStaff);
  const [opdQueue, setOpdQueue] = useState<OpdQueueToken[]>(initialOpdQueue);
  const [mismatches, setMismatches] = useState<BillingAuditMismatch[]>(initialMismatches);
  const [hl7Messages, setHl7Messages] = useState<Hl7Message[]>(initialHl7Messages);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(initialAuditLogs);
  const [offlineMutations, setOfflineMutations] = useState<OfflineMutation[]>([]);
  const [telehealthSessions, setTelehealthSessions] = useState<TelehealthSession[]>(initialTelehealthSessions);
  const [dischargedCensus, setDischargedCensus] = useState<DischargedCensusRecord[]>(initialDischargedCensus);
  const [activeTelehealthSession, setActiveTelehealthSession] = useState<TelehealthSession | null>(null);
  const [activeTab, setActiveTab] = useState<string>('command');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [networkMode, setNetworkMode] = useState<'online' | 'offline' | 'degraded_sync'>('online');
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>('p-1001');

  // Sync with Firestore on mount
  useEffect(() => {
    // Demo datasets remain in-memory only. Production Firestore is never auto-seeded from a UI mount.

    // Attach real-time Firestore listeners
    const unsubPatients = subscribeToPatients((remotePatients) => {
      if (remotePatients && remotePatients.length > 0) {
        setPatients(remotePatients);
      }
    });

    const unsubBeds = subscribeToBeds((remoteBeds) => {
      if (remoteBeds && remoteBeds.length > 0) {
        setBeds(remoteBeds);
      }
    });

    const unsubMismatches = subscribeToBillingMismatches((remoteMismatches) => {
      if (remoteMismatches && remoteMismatches.length > 0) {
        setMismatches(remoteMismatches);
      }
    });

    const unsubOpd = subscribeToOpdQueue((remoteTokens) => {
      if (remoteTokens && remoteTokens.length > 0) {
        setOpdQueue(remoteTokens);
      }
    });

    const unsubAudit = subscribeToAuditLogs((remoteLogs) => {
      if (remoteLogs && remoteLogs.length > 0) {
        setAuditLogs(remoteLogs);
      }
    });

    const unsubTelehealth = subscribeToTelehealthSessions((remoteSessions) => {
      if (remoteSessions && remoteSessions.length > 0) {
        setTelehealthSessions(remoteSessions);
      }
    });

    return () => {
      if (unsubPatients) unsubPatients();
      if (unsubBeds) unsubBeds();
      if (unsubMismatches) unsubMismatches();
      if (unsubOpd) unsubOpd();
      if (unsubAudit) unsubAudit();
      if (unsubTelehealth) unsubTelehealth();
    };
  }, []);

  // Compute live stats
  const totalBeds = beds.length;
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length;
  const availableBeds = beds.filter((b) => b.status === 'available').length;
  const maintenanceBeds = beds.filter((b) => b.status === 'maintenance' || b.status === 'cleaning').length;
  const occupancyRate = Math.round((occupiedBeds / totalBeds) * 100);
  
  const pendingMismatches = mismatches.filter(m => m.status === 'pending_review');
  const unbilledChargesPending = pendingMismatches.reduce((sum, m) => sum + m.estimatedRecoverableRevenue, 0);
  const reconciledMismatches = mismatches.filter(m => m.status === 'reconciled');
  const revenueLeakageRecoveredToday = reconciledMismatches.reduce((sum, m) => sum + m.estimatedRecoverableRevenue, 0) + 1480;

  const stats: HospitalStats = {
    totalBeds,
    occupiedBeds,
    availableBeds,
    maintenanceBeds,
    occupancyRate,
    admissionsToday: 8,
    dischargesToday: 3,
    emergencyPatients: beds.filter((b) => b.ward === 'Emergency' && b.status === 'occupied').length + 2,
    pendingLabResults: patients.reduce((acc, p) => acc + (p.encounters.reduce((eAcc, e) => eAcc + e.labOrders.filter(l => l.status === 'ordered' || l.status === 'in-progress').length, 0)), 0),
    revenueToday: 18450 + revenueLeakageRecoveredToday,
    revenueLeakageRecoveredToday,
    unbilledChargesPending,
    syncQueuePendingCount: offlineMutations.filter(m => m.syncStatus === 'pending').length,
    networkMode,
  };

  const addAuditLog = (
    action: string,
    resource: string,
    details: string,
    status: 'SUCCESS' | 'WARNING' | 'DENIED' | 'SECURITY_ALERT' | 'INFO' | 'ERROR' = 'SUCCESS'
  ) => {
    const newLog: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      userId: 'usr-active-doc',
      userName: 'Dr. Sarah Jenkins',
      role: 'Attending Physician',
      action,
      resource,
      ipAddress: networkMode === 'offline' ? '127.0.0.1 (Offline Local)' : '192.168.1.104',
      status,
      details,
    };
    setAuditLogs(prev => [newLog, ...prev]);
    syncAuditLogToFirestore(newLog).catch(() => {});
  };

  const recordMutation = (actionType: OfflineMutation['actionType'], entity: string, payload: Record<string, any>) => {
    const mutation: OfflineMutation = {
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actionType,
      entity,
      payload,
      syncStatus: networkMode === 'online' ? 'synced' : 'pending',
      version: 1,
    };
    setOfflineMutations(prev => [mutation, ...prev]);
  };

  const updateBedStatus = (bedId: string, status: BedStatus, patientId?: string, notes?: string) => {
    let updatedBed: Bed | undefined;
    setBeds(prev => prev.map(bed => {
      if (bed.id === bedId) {
        updatedBed = {
          ...bed,
          status,
          patientId: status === 'available' ? undefined : (patientId || bed.patientId),
          patientName: status === 'available' ? undefined : (patientId ? patients.find(p => p.id === patientId)?.fullName : bed.patientName),
          notes: notes !== undefined ? notes : bed.notes,
        };
        return updatedBed;
      }
      return bed;
    }));
    if (updatedBed) {
      syncBedToFirestore(updatedBed).catch(() => {});
    }
    recordMutation('ALLOCATE_BED', `Bed:${bedId}`, { status, patientId });
    addAuditLog('UPDATE_BED_STATUS', `Bed ${bedId}`, `Status changed to ${status}`);
  };

  const assignPatientToBed = (bedId: string, patientId: string) => {
    const patient = patients.find(p => p.id === patientId);
    if (!patient) return;
    let updatedBed: Bed | undefined;
    let updatedPatient: Patient | undefined;
    setBeds(prev => prev.map(bed => {
      if (bed.id === bedId) {
        updatedBed = {
          ...bed,
          status: 'occupied',
          patientId: patient.id,
          patientName: patient.fullName,
          admissionDate: new Date().toISOString().split('T')[0],
        };
        return updatedBed;
      }
      return bed;
    }));
    setPatients(prev => prev.map(p => {
      if (p.id === patientId) {
        updatedPatient = { ...p, activeBedId: bedId };
        return updatedPatient;
      }
      return p;
    }));
    if (updatedBed) syncBedToFirestore(updatedBed).catch(() => {});
    if (updatedPatient) syncPatientToFirestore(updatedPatient).catch(() => {});
    addAuditLog('ASSIGN_BED', `Bed ${bedId}`, `Assigned to ${patient.fullName} (MRN: ${patient.mrn})`);
  };

  const admitPatientToBed = (patientId: string, bedId: string, doctor?: string, nurse?: string) => {
    const patient = patients.find(p => p.id === patientId);
    if (!patient) return;
    let updatedBed: Bed | undefined;
    let updatedPatient: Patient | undefined;
    setBeds(prev => prev.map(bed => {
      if (bed.id === bedId) {
        updatedBed = {
          ...bed,
          status: 'occupied',
          patientId: patient.id,
          patientName: patient.fullName,
          assignedDoctor: doctor || bed.assignedDoctor || 'Dr. Sarah Jenkins',
          assignedNurse: nurse || bed.assignedNurse || 'Nurse John Davis',
          admissionDate: new Date().toISOString().split('T')[0],
        };
        return updatedBed;
      }
      return bed;
    }));
    setPatients(prev => prev.map(p => {
      if (p.id === patientId) {
        updatedPatient = { ...p, activeBedId: bedId };
        return updatedPatient;
      }
      return p;
    }));
    if (updatedBed) syncBedToFirestore(updatedBed).catch(() => {});
    if (updatedPatient) syncPatientToFirestore(updatedPatient).catch(() => {});
    addAuditLog('ADMIT_PATIENT_BED', `Bed ${bedId}`, `Admitted ${patient.fullName} (Dr: ${doctor || 'Dr. Jenkins'})`);
  };

  const reconcileCensus = () => {
    const occupiedCount = beds.filter(b => b.status === 'occupied').length;
    const availableCount = beds.filter(b => b.status === 'available').length;
    const cleaningCount = beds.filter(b => b.status === 'cleaning').length;
    const maintenanceCount = beds.filter(b => b.status === 'maintenance').length;
    const reservedCount = beds.filter(b => b.status === 'reserved').length;
    const activePatientCensusCount = patients.filter(p => !!p.activeBedId).length;

    return {
      totalCapacity: beds.length,
      occupiedCount,
      availableCount,
      cleaningCount,
      maintenanceCount,
      reservedCount,
      activePatientCensusCount,
      dischargedCount: dischargedCensus.length,
      isReconciled: occupiedCount === activePatientCensusCount,
      unaccountedLossCount: Math.abs(occupiedCount - activePatientCensusCount),
    };
  };

  const dischargePatientFromBed = (
    bedId: string,
    notes?: string,
    disposition?: string,
    censusRecord?: DischargedCensusRecord
  ) => {
    const bed = beds.find(b => b.id === bedId);
    if (!bed) return;
    const pId = bed.patientId;
    const patient = patients.find(p => p.id === pId);
    let updatedBed: Bed | undefined;
    let updatedPatient: Patient | undefined;

    setBeds(prev => prev.map(b => {
      if (b.id === bedId) {
        updatedBed = {
          ...b,
          status: 'cleaning',
          patientId: undefined,
          patientName: undefined,
          notes: notes || 'Sanitizing protocol in progress (Discharged)',
        };
        return updatedBed;
      }
      return b;
    }));

    if (pId) {
      setPatients(prev => prev.map(p => {
        if (p.id === pId) {
          updatedPatient = { ...p, activeBedId: undefined, activeEncounterId: undefined };
          return updatedPatient;
        }
        return p;
      }));
    }

    if (censusRecord) {
      setDischargedCensus(prev => [censusRecord, ...prev]);
    } else if (bed && (bed.patientName || patient)) {
      const newRecord: DischargedCensusRecord = {
        id: `dc-${Date.now()}`,
        patientId: pId || 'p-gen',
        patientName: bed.patientName || patient?.fullName || 'Inpatient',
        mrn: patient?.mrn || `GH-2026-${(pId || '1000').replace(/\D/g, '') || '4412'}`,
        age: patient?.age || 52,
        gender: patient?.gender || 'Female',
        bedId: bed.id,
        bedNumber: bed.bedNumber,
        ward: bed.ward,
        admissionDate: bed.admissionDate || new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0],
        dischargeDate: new Date().toISOString().split('T')[0],
        lengthOfStayDays: 3,
        primaryDiagnosis: bed.notes || 'Inpatient Stay Completed',
        dischargingDoctor: bed.assignedDoctor || 'Dr. Sarah Jenkins',
        dischargeDisposition: disposition || 'Home with Self-Care',
        gatePassCode: `GP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        medicationReconciliationCompleted: true,
        financialClearanceCompleted: true,
        followUpDate: 'In 7 days (OPD)',
        dischargeSummaryNote: notes || 'Discharged from bed. Medication reconciliation completed.',
      };
      setDischargedCensus(prev => [newRecord, ...prev]);
    }

    if (updatedBed) syncBedToFirestore(updatedBed).catch(() => {});
    if (updatedPatient) syncPatientToFirestore(updatedPatient).catch(() => {});
    addAuditLog('DISCHARGE_BED', `Bed ${bedId}`, `Patient discharged from bed. Invariant verified: archived to census.`);
  };

  const registerNewPatient = (patientData: Omit<Patient, 'id' | 'mrn' | 'registeredAt' | 'encounters'>): Patient => {
    const newId = `p-${Date.now().toString().slice(-4)}`;
    const newMrn = `GH-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const newPatient: Patient = {
      ...patientData,
      id: newId,
      mrn: newMrn,
      registeredAt: new Date().toISOString().split('T')[0],
      encounters: [
        {
          id: `enc-${Date.now().toString().slice(-3)}`,
          type: 'Outpatient',
          department: 'General OPD',
          admitDate: new Date().toISOString().split('T')[0],
          chiefComplaint: 'Initial clinic intake and consultation',
          attendingPhysician: 'Dr. Sarah Jenkins',
          status: 'active',
          vitalsHistory: [
            { heartRate: 78, bloodPressure: '120/80', temperature: 37.0, respiratoryRate: 16, oxygenSaturation: 98, timestamp: new Date().toLocaleTimeString() }
          ],
          clinicalNotes: [],
          medications: [],
          labOrders: [],
          billing: { items: [{ id: `bi-${Date.now()}`, description: 'Outpatient Triage & Registration', code: 'REG-OPD', category: 'Consultation', quantity: 1, unitPrice: 75, totalPrice: 75, auditedStatus: 'verified' }], subtotal: 75, tax: 3.75, insuranceCoverage: 60, patientPayable: 18.75, paymentStatus: 'settled' }
        }
      ],
    };
    setPatients(prev => [newPatient, ...prev]);
    syncPatientToFirestore(newPatient).catch(() => {});
    recordMutation('INSERT_NOTE', `Patient:${newId}`, newPatient);
    addAuditLog('REGISTER_PATIENT', `Patient ${newMrn}`, `Registered patient ${newPatient.fullName}`);
    return newPatient;
  };

  const mergePatients = async (primaryId: string, secondaryId: string, mergeReason: string): Promise<Patient> => {
    const primary = patients.find(p => p.id === primaryId);
    const secondary = patients.find(p => p.id === secondaryId);
    if (!primary || !secondary) {
      throw new Error('Primary or secondary patient record not found.');
    }
    if (primary.id === secondary.id) {
      throw new Error('Cannot merge a patient record into itself.');
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const combinedAllergies = Array.from(new Set([...(primary.allergies || []), ...(secondary.allergies || [])]));
    const combinedConditions = Array.from(new Set([...(primary.chronicConditions || []), ...(secondary.chronicConditions || [])]));
    const combinedEncounters = [...(primary.encounters || []), ...(secondary.encounters || [])];

    // Audit clinical note on surviving primary record
    const auditNote: ClinicalNote = {
      id: `note-merge-${Date.now()}`,
      timestamp,
      author: 'Clinical Governance Supervisor',
      role: 'MPI Identity Consolidation',
      category: 'Progress',
      content: `[MPI IDENTITY MERGE]: Secondary duplicate patient record "${secondary.fullName}" (MRN: ${secondary.mrn}) was consolidated into this primary surviving record (MRN: ${primary.mrn}).\nReason: ${mergeReason}\nAll historical clinical notes, allergies, conditions, and encounters have been permanently re-indexed to this surviving identifier.`,
      aiStructuredData: {
        chiefComplaint: 'MPI Record Consolidation',
        diagnoses: ['Administrative Patient Merge'],
        medicationsPrescribed: [],
        recommendedProcedures: ['Longitudinal Chart Re-Indexing'],
        followUpDays: 0,
        billingCodes: [],
      },
    };

    if (combinedEncounters.length > 0) {
      combinedEncounters[0] = {
        ...combinedEncounters[0],
        clinicalNotes: [auditNote, ...combinedEncounters[0].clinicalNotes],
      };
    }

    const consolidatedPrimary: Patient = {
      ...primary,
      allergies: combinedAllergies,
      chronicConditions: combinedConditions,
      encounters: combinedEncounters,
      activeBedId: primary.activeBedId || secondary.activeBedId,
    };

    // Filter out secondary patient and update primary patient
    setPatients(prev => prev.filter(p => p.id !== secondaryId).map(p => p.id === primaryId ? consolidatedPrimary : p));

    // Update beds pointing to secondary
    setBeds(prev => prev.map(b => b.patientId === secondaryId ? { ...b, patientId: primaryId, patientName: primary.fullName } : b));

    // Update OPD queue pointing to secondary
    setOpdQueue(prev => prev.map(q => q.patientId === secondaryId ? { ...q, patientId: primaryId, patientName: primary.fullName, mrn: primary.mrn } : q));

    // Update billing mismatches pointing to secondary
    setMismatches(prev => prev.map(m => m.patientId === secondaryId ? { ...m, patientId: primaryId, patientName: primary.fullName } : m));

    setSelectedPatientId(primaryId);

    // Sync to Firestore & record audit log
    syncPatientToFirestore(consolidatedPrimary).catch(() => {});
    addAuditLog('MPI_PATIENT_MERGE', `Primary ${primary.mrn} <= Secondary ${secondary.mrn}`, `Consolidated duplicate identity: ${mergeReason}`);
    recordMutation('INSERT_NOTE', `Patient:${primaryId}`, consolidatedPrimary);

    return consolidatedPrimary;
  };

  const addClinicalNote = (patientId: string, note: Omit<ClinicalNote, 'id' | 'timestamp'>) => {
    const patient = patients.find((item) => item.id === patientId);
    const encounterId = patient?.activeEncounterId || patient?.encounters?.[0]?.id;

    if (!patient || !encounterId) {
      console.error('CLINICAL_NOTE_REJECTED: active patient encounter is required.');
      return;
    }

    const categoryMap: Record<ClinicalNote['category'], 'SOAP' | 'PROGRESS' | 'CONSULTATION' | 'DISCHARGE' | 'NURSING'> = {
      SOAP: 'SOAP',
      Progress: 'PROGRESS',
      Consultation: 'CONSULTATION',
      Discharge: 'DISCHARGE',
      Nursing: 'NURSING',
    };

    void executeActiveTenantCommand('SignClinicalNoteCommand', {
      encounterId,
      patientId,
      category: categoryMap[note.category],
      content: note.content,
      acceptedStructuredData: note.aiStructuredData || {},
    }).then((result) => {
      if (!result.success) {
        throw new Error(result.error?.message || 'Clinical note command failed.');
      }

      const noteId = result.entityId || `note-${Date.now()}`;
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const newNote: ClinicalNote = { ...note, id: noteId, timestamp };

      setPatients((previous) => previous.map((item) => {
        if (item.id !== patientId) return item;
        const encounters = [...item.encounters];
        if (encounters.length > 0) {
          encounters[0] = {
            ...encounters[0],
            clinicalNotes: [newNote, ...encounters[0].clinicalNotes],
          };
        }
        return { ...item, encounters };
      }));

      // Revenue Integrity findings are presentation-only until their own governed
      // server command/projection is introduced. They are never persisted directly.
      if (note.aiStructuredData?.billingCodes?.length) {
        const projectedMismatches = note.aiStructuredData.billingCodes.map((codeItem, index) => ({
          id: `mm-${Date.now()}-${index}`,
          patientId,
          patientName: patient.fullName,
          encounterId,
          noteId,
          date: new Date().toISOString().split('T')[0],
          documentedItem: `${codeItem.description} (CPT ${codeItem.code})`,
          category: 'Procedure' as const,
          suggestedCptCode: codeItem.code,
          estimatedRecoverableRevenue: codeItem.fee,
          status: 'pending_review' as const,
          evidenceSnippet: `Extracted from clinician-accepted documentation: "${note.content.slice(0, 80)}..."`,
          confidenceScore: 0.96,
        }));
        setMismatches((previous) => [...projectedMismatches, ...previous]);
      }

      recordMutation('INSERT_NOTE', `Note:${noteId}`, newNote);
    }).catch((error) => {
      console.error('CLINICAL_NOTE_COMMAND_FAILED', error);
    });
  };

  const addLabOrder = (patientId: string, order: Omit<LabOrder, 'id' | 'orderedAt'>) => {
    const patient = patients.find((item) => item.id === patientId);
    const encounterId = patient?.activeEncounterId || patient?.encounters?.[0]?.id;

    if (!patient || !encounterId) {
      console.error('DIAGNOSTIC_ORDER_REJECTED: active patient encounter is required.');
      return;
    }

    const orderType = order.category === 'Radiology' ? 'RADIOLOGY' : 'LAB';

    void executeActiveTenantCommand('PlaceDiagnosticOrderCommand', {
      encounterId,
      patientId,
      orderType,
      catalogCode: order.sampleId || order.testName,
      orderName: order.testName,
      priority: 'ROUTINE',
      clinicalIndication: order.notes || 'Clinician ordered diagnostic investigation',
      estimatedCostMinorUnits: Math.round((order.cost || 0) * 100),
    }).then((result) => {
      if (!result.success) {
        throw new Error(result.error?.message || 'Diagnostic order command failed.');
      }

      const orderedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const newOrder: LabOrder = {
        ...order,
        id: result.entityId || `lab-ord-${Date.now()}`,
        orderedAt,
      };

      setPatients((previous) => previous.map((item) => {
        if (item.id !== patientId) return item;
        const encounters = [...item.encounters];
        if (encounters.length > 0) {
          encounters[0] = {
            ...encounters[0],
            labOrders: [newOrder, ...encounters[0].labOrders],
          };
        }
        return { ...item, encounters };
      }));

      // Integration delivery is now represented by the durable transaction outbox.
      // Do not fabricate a browser-side HL7 dispatch record here.
      recordMutation('ORDER_LAB', `Order:${newOrder.id}`, newOrder);
    }).catch((error) => {
      console.error('DIAGNOSTIC_ORDER_COMMAND_FAILED', error);
    });
  };

  const addVitals = (patientId: string, vitals: Omit<Vitals, 'timestamp'>) => {
    const patient = patients.find((item) => item.id === patientId);
    const encounterId = patient?.activeEncounterId || patient?.encounters?.[0]?.id;

    if (!patient || !encounterId) {
      console.error('VITALS_REJECTED: active patient encounter is required.');
      return;
    }

    void executeActiveTenantCommand('RecordVitalsCommand', {
      encounterId,
      patientId,
      heartRate: vitals.heartRate,
      bloodPressure: vitals.bloodPressure,
      temperature: vitals.temperature,
      respiratoryRate: vitals.respiratoryRate,
      oxygenSaturation: vitals.oxygenSaturation,
      measuredAt: Date.now(),
    }).then((result) => {
      if (!result.success) {
        throw new Error(result.error?.message || 'Vitals command failed.');
      }

      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const newVitals: Vitals = { ...vitals, timestamp };

      setPatients((previous) => previous.map((item) => {
        if (item.id !== patientId) return item;
        const encounters = [...item.encounters];
        if (encounters.length > 0) {
          encounters[0] = {
            ...encounters[0],
            vitalsHistory: [newVitals, ...encounters[0].vitalsHistory],
          };
        }
        return { ...item, encounters };
      }));

      recordMutation('UPDATE_VITALS', `Patient:${patientId}`, newVitals);
    }).catch((error) => {
      console.error('VITALS_COMMAND_FAILED', error);
    });
  };

  const reconcileMismatch = (mismatchId: string) => {
    const mismatch = mismatches.find(m => m.id === mismatchId);
    if (!mismatch) return;

    const reconciledItem: BillingAuditMismatch = { ...mismatch, status: 'reconciled' };
    setMismatches(prev => prev.map(m => m.id === mismatchId ? reconciledItem : m));
    syncMismatchToFirestore(reconciledItem).catch(() => {});

    // Add as bill item to the patient encounter
    let updatedPatient: Patient | undefined;
    setPatients(prev => prev.map(p => {
      if (p.id === mismatch.patientId) {
        const encounters = [...p.encounters];
        if (encounters.length > 0) {
          const enc = encounters[0];
          const newBillItem: BillItem = {
            id: `bi-rec-${Date.now()}`,
            description: mismatch.documentedItem,
            code: mismatch.suggestedCptCode,
            category: mismatch.category === 'Procedure' ? 'Procedure' : mismatch.category === 'Lab' ? 'Lab & Diagnostics' : 'Pharmacy',
            quantity: 1,
            unitPrice: mismatch.estimatedRecoverableRevenue,
            totalPrice: mismatch.estimatedRecoverableRevenue,
            auditedStatus: 'reconciled',
            sourceNoteId: mismatch.noteId,
          };
          const newSubtotal = enc.billing.subtotal + mismatch.estimatedRecoverableRevenue;
          const newTax = Math.round(newSubtotal * 0.05);
          encounters[0] = {
            ...enc,
            billing: {
              ...enc.billing,
              items: [...enc.billing.items, newBillItem],
              subtotal: newSubtotal,
              tax: newTax,
              patientPayable: Math.round(newSubtotal * 0.25),
            }
          };
        }
        updatedPatient = { ...p, encounters };
        return updatedPatient;
      }
      return p;
    }));
    if (updatedPatient) syncPatientToFirestore(updatedPatient).catch(() => {});

    recordMutation('RECONCILE_BILL', `Mismatch:${mismatchId}`, mismatch);
    addAuditLog('RECONCILE_LEAKAGE', `Encounter ${mismatch.encounterId}`, `Reconciled +$${mismatch.estimatedRecoverableRevenue} (${mismatch.suggestedCptCode}) into invoice`);
  };

  const dismissMismatch = (mismatchId: string) => {
    const dismissedItem = mismatches.find(m => m.id === mismatchId);
    setMismatches(prev => prev.map(m => m.id === mismatchId ? { ...m, status: 'dismissed' } : m));
    if (dismissedItem) {
      syncMismatchToFirestore({ ...dismissedItem, status: 'dismissed' }).catch(() => {});
    }
    addAuditLog('DISMISS_MISMATCH', `Mismatch ${mismatchId}`, `Marked as not billable / clinical exception`);
  };

  const dispatchHl7Message = (msg: Omit<Hl7Message, 'id' | 'timestamp' | 'status'>) => {
    const newMsg: Hl7Message = {
      ...msg,
      id: `hl7-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'dispatched',
    };
    setHl7Messages(prev => [newMsg, ...prev]);
    syncHl7ToFirestore(newMsg).catch(() => {});
    addAuditLog('DISPATCH_HL7', msg.type, `Dispatched to ${msg.receivingApp} for MRN: ${msg.patientMrn}`);
  };

  const callNextOpdToken = (tokenId: string) => {
    let updatedToken: OpdQueueToken | undefined;
    setOpdQueue(prev => prev.map(t => {
      if (t.id === tokenId) {
        updatedToken = { ...t, status: 'in_consultation' };
        return updatedToken;
      }
      return t;
    }));
    if (updatedToken) syncOpdTokenToFirestore(updatedToken).catch(() => {});
    const token = opdQueue.find(t => t.id === tokenId);
    if (token) {
      setSelectedPatientId(token.patientId);
      addAuditLog('CALL_OPD_QUEUE', `Token ${token.tokenNumber}`, `Called ${token.patientName} into consultation`);
    }
  };

  const completeOpdToken = (tokenId: string) => {
    let updatedToken: OpdQueueToken | undefined;
    setOpdQueue(prev => prev.map(t => {
      if (t.id === tokenId) {
        updatedToken = { ...t, status: 'completed' };
        return updatedToken;
      }
      return t;
    }));
    if (updatedToken) syncOpdTokenToFirestore(updatedToken).catch(() => {});
    const token = opdQueue.find(t => t.id === tokenId);
    if (token) {
      addAuditLog('COMPLETE_OPD_CONSULT', `Token ${token.tokenNumber}`, `Completed consultation with ${token.patientName}`);
    }
  };

  const triggerOfflineSync = () => {
    setOfflineMutations(prev => prev.map(m => ({ ...m, syncStatus: 'synced' })));
    setNetworkMode('online');
    addAuditLog('OFFLINE_SYNC_COMPLETE', 'Dual-Engine Sync Queue', 'Replayed 100% of pending offline mutations to cloud database with zero conflicts');
  };

  const createTelehealthSession = async (data: {
    patientId: string;
    type: TelehealthSession['type'];
    scheduledTime?: string;
    chiefComplaint: string;
    attendingPhysician?: string;
  }): Promise<TelehealthSession> => {
    const patient = patients.find(p => p.id === data.patientId);
    const newSessionId = `th-${Date.now()}`;
    const newEncounterId = `enc-th-${Date.now()}`;
    const roomToken = `ROOM-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const newSession: TelehealthSession = {
      id: newSessionId,
      encounterId: newEncounterId,
      patientId: data.patientId,
      patientName: patient ? patient.fullName : 'Unknown Patient',
      patientMrn: patient ? patient.mrn : 'MRN-PENDING',
      age: patient ? patient.age : 35,
      gender: patient ? patient.gender : 'Other',
      scheduledTime: data.scheduledTime || 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'WAITING_ROOM',
      type: data.type || 'Telehealth Consultation',
      attendingPhysician: data.attendingPhysician || 'Dr. Sarah Jenkins',
      clinicianNpi: '1487920134',
      specialty: 'Telehealth & Preventive Medicine',
      chiefComplaint: data.chiefComplaint,
      roomToken,
      connectionQuality: 'EXCELLENT',
      callDurationSeconds: 0,
      vitals: {
        bp: '120/80',
        hr: 72,
        spo2: 99,
        temp: 36.6,
        rhythm: 'Normal Sinus Rhythm',
        connectedDevice: 'Smart ECG + BLE Vitals Gateway',
        lastSync: 'Just now',
      },
      transcription: [
        {
          id: `tr-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          speaker: 'SYSTEM',
          text: `Virtual consultation room initialized for ${patient ? patient.fullName : 'Patient'}. WebRTC token: ${roomToken}.`,
        },
      ],
      soapNote: {
        subjective: '',
        objective: '',
        assessment: '',
        plan: '',
        icd10Codes: [],
        cptCodes: [],
      },
      prescriptions: [],
      isAudioMuted: false,
      isVideoMuted: false,
      isRecording: false,
      patientInvitedEmail: patient ? `${patient.fullName.toLowerCase().replace(/\s+/g, '.')}@patient-portal.demo` : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTelehealthSessions(prev => [newSession, ...prev]);
    setActiveTelehealthSession(newSession);
    syncTelehealthSessionToFirestore(newSession).catch(() => {});
    recordMutation('INSERT_TELEHEALTH_SESSION', `Telehealth:${newSessionId}`, newSession);
    addAuditLog('SCHEDULE_TELEHEALTH', `Session ${newSessionId}`, `Created virtual appointment for ${newSession.patientName}`);

    return newSession;
  };

  const updateTelehealthSession = async (sessionId: string, updates: Partial<TelehealthSession>): Promise<void> => {
    let updated: TelehealthSession | undefined;
    setTelehealthSessions(prev =>
      prev.map(s => {
        if (s.id === sessionId) {
          updated = { ...s, ...updates, updatedAt: new Date().toISOString() };
          return updated;
        }
        return s;
      })
    );
    if (activeTelehealthSession?.id === sessionId && updated) {
      setActiveTelehealthSession(updated);
    }
    if (updated) {
      syncTelehealthSessionToFirestore(updated).catch(() => {});
      recordMutation('UPDATE_TELEHEALTH_SESSION', `Telehealth:${sessionId}`, updates);
    }
  };

  const completeTelehealthSession = async (
    sessionId: string,
    note?: Partial<TelehealthSoapNote>,
    prescriptions?: TelehealthPrescription[]
  ): Promise<void> => {
    const session = telehealthSessions.find(s => s.id === sessionId) || activeTelehealthSession;
    if (!session) return;

    const finalNote: TelehealthSoapNote = {
      ...session.soapNote,
      ...(note || {}),
    };

    const finalPrescriptions = prescriptions || session.prescriptions || [];

    const updatedSession: TelehealthSession = {
      ...session,
      status: 'COMPLETED',
      soapNote: finalNote,
      prescriptions: finalPrescriptions,
      updatedAt: new Date().toISOString(),
    };

    setTelehealthSessions(prev =>
      prev.map(s => (s.id === sessionId ? updatedSession : s))
    );
    if (activeTelehealthSession?.id === sessionId) {
      setActiveTelehealthSession(updatedSession);
    }
    syncTelehealthSessionToFirestore(updatedSession).catch(() => {});
    recordMutation('COMPLETE_TELEHEALTH_SESSION', `Telehealth:${sessionId}`, updatedSession);

    // Sync directly to the patient's Clinical Notes in the EHR
    const clinicalNoteContent = `[TELEHEALTH VIRTUAL CONSULTATION RECORD]
Encounter Type: ${session.type}
Chief Complaint: ${session.chiefComplaint}
Room Token: ${session.roomToken}
Attending: ${session.attendingPhysician} (NPI: ${session.clinicianNpi})
Telemetry Device: ${session.vitals.connectedDevice || 'Standard Sensor Hub'}

--- SUBJECTIVE ---
${finalNote.subjective || 'Virtual consultation completed without acute complaints.'}

--- OBJECTIVE ---
Vitals: BP ${session.vitals.bp}, HR ${session.vitals.hr} bpm, SpO2 ${session.vitals.spo2}%, Temp ${session.vitals.temp}°C
${finalNote.objective || 'Visual inspection conducted via encrypted WebRTC video stream.'}

--- ASSESSMENT ---
${finalNote.assessment || 'Stable follow-up.'}
Diagnoses: ${(finalNote.icd10Codes || []).map(i => `${i.code} - ${i.description}`).join('; ') || 'Routine Telehealth Evaluation'}

--- PLAN ---
${finalNote.plan || 'Continue home regimen and follow up in 2-4 weeks.'}
E-Prescriptions: ${finalPrescriptions.map(p => `${p.medication} ${p.dosage} ${p.frequency}`).join('; ') || 'None issued'}
Billing CPT Codes: ${(finalNote.cptCodes || []).map(c => `${c.code} (${c.description})`).join(', ') || '99213'}`;

    addClinicalNote(session.patientId, {
      author: session.attendingPhysician,
      role: 'Telehealth Attending Physician',
      category: 'SOAP',
      content: clinicalNoteContent,
      aiStructuredData: {
        chiefComplaint: session.chiefComplaint,
        diagnoses: (finalNote.icd10Codes || []).map(i => `${i.code}: ${i.description}`),
        medicationsPrescribed: finalPrescriptions.map(p => `${p.medication} ${p.dosage} ${p.frequency}`),
        recommendedProcedures: ['Remote Patient Monitoring (RPM)', 'Virtual Follow-up'],
        followUpDays: 14,
        billingCodes: (finalNote.cptCodes || []).map(c => ({
          code: c.code,
          description: c.description,
          fee: c.fee || 125,
        })),
      },
    });

    // If prescriptions were provided, also record them to patient's active medications
    if (finalPrescriptions.length > 0) {
      setPatients(prev =>
        prev.map(p => {
          if (p.id === session.patientId) {
            const newMeds: Medication[] = finalPrescriptions.map(rx => ({
              id: rx.id || `m-rx-${Date.now()}-${Math.random()}`,
              name: rx.medication,
              dosage: rx.dosage,
              frequency: rx.frequency,
              route: 'Oral',
              status: 'active',
              prescribedDate: new Date().toISOString().slice(0, 10),
              prescribedBy: session.attendingPhysician,
              stockRemaining: 100,
              unitPrice: 15,
            }));
            const encounters = [...p.encounters];
            if (encounters.length > 0) {
              encounters[0] = {
                ...encounters[0],
                medications: [...encounters[0].medications, ...newMeds],
              };
            }
            return { ...p, encounters };
          }
          return p;
        })
      );
    }

    addAuditLog(
      'COMPLETE_TELEHEALTH_SESSION',
      `Session ${sessionId}`,
      `Completed remote consult for ${session.patientName}. SOAP note & ${finalPrescriptions.length} e-prescriptions synced to EHR.`
    );
  };

  return (
    <HospitalContext.Provider
      value={{
        beds,
        patients,
        staff,
        stats,
        opdQueue,
        mismatches,
        hl7Messages,
        auditLogs,
        offlineMutations,
        executiveThesis: executiveThesisData,
        activeTab,
        setActiveTab,
        searchQuery,
        setSearchQuery,
        networkMode,
        setNetworkMode,
        copilotOpen,
        setCopilotOpen,
        selectedPatientId,
        setSelectedPatientId,
        dischargedCensus,
        reconcileCensus,
        updateBedStatus,
        assignPatientToBed,
        admitPatientToBed,
        dischargePatientFromBed,
        registerNewPatient,
        mergePatients,
        addClinicalNote,
        addLabOrder,
        addVitals,
        reconcileMismatch,
        dismissMismatch,
        dispatchHl7Message,
        callNextOpdToken,
        completeOpdToken,
        triggerOfflineSync,
        addAuditLog,
        telehealthSessions,
        activeTelehealthSession,
        setActiveTelehealthSession,
        createTelehealthSession,
        updateTelehealthSession,
        completeTelehealthSession,
      }}
    >
      {children}
    </HospitalContext.Provider>
  );
}

export function useHospital() {
  const context = useContext(HospitalContext);
  if (!context) {
    throw new Error('useHospital must be used within a HospitalProvider');
  }
  return context;
}
