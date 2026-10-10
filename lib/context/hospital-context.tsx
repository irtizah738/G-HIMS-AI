'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import { DischargedCensusRecord, initialDischargedCensus } from '@/lib/clinical/ipd-service';
import { executeActiveTenantCommand, registerActiveTenantPatient } from '@/lib/api/command-client';
import { syncEngine } from '@/lib/offline/sync-engine';
import { useAuth } from '@/lib/auth/auth-context';
import { hydrateEdgeSnapshot, loadLocalEdgeSnapshot } from '@/lib/offline/hydration';
import { adaptEdgeSnapshot } from '@/lib/offline/read-model-adapter';

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

export interface ClinicalContextBinding {
  tenantId: string;
  encounterId: string;
  patientId: string;
  patientMrn: string;
  patientName: string;
  status: 'VERIFIED' | 'UNRESOLVED' | 'MISMATCH';
  contextRevision: number;
  source:
    | 'OPD_MASTER'
    | 'OPD_CONSULTATION_DESK'
    | 'OPD_QUEUE'
    | 'REGISTRATION'
    | 'OTHER';
  boundAt: number;
}

interface BindClinicalEncounterInput {
  tenantId?: string;
  encounterId: string;
  patientId: string;
  patientMrn: string;
  patientName: string;
  source: ClinicalContextBinding['source'];
}

interface HospitalContextType {
  beds: Bed[];
  patients: Patient[];
  /** Authoritative tenant-scoped MPI directory hydration; no zero-count claim before load. */
  mpiDirectoryReadiness: 'DEMO' | 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNHYDRATED' | 'DENIED' | 'FAILED';
  mpiDirectoryTenantId: string | null;
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
  clinicalContext: ClinicalContextBinding | null;
  bindClinicalEncounter: (input: BindClinicalEncounterInput) => ClinicalContextBinding;
  clearClinicalContext: () => void;
  
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
  updateBedStatus: (bedId: string, status: BedStatus, patientId?: string, notes?: string) => Promise<void>;
  assignPatientToBed: (bedId: string, patientId: string) => Promise<void>;
  admitPatientToBed: (patientId: string, bedId: string, doctor?: string, nurse?: string) => Promise<void>;
  dischargePatientFromBed: (
    bedId: string,
    notes?: string,
    disposition?: string,
    censusRecord?: DischargedCensusRecord
  ) => Promise<void>;
  registerNewPatient: (patientData: Omit<Patient, 'id' | 'mrn' | 'registeredAt' | 'encounters'>) => Promise<Patient>;
  mergePatients: (primaryId: string, secondaryId: string, mergeReason: string) => Promise<Patient>;
  addClinicalNote: (patientId: string, note: Omit<ClinicalNote, 'id' | 'timestamp'>) => Promise<void>;
  addLabOrder: (patientId: string, order: Omit<LabOrder, 'id' | 'orderedAt'>) => Promise<void>;
  addVitals: (patientId: string, vitals: Omit<Vitals, 'timestamp'>) => Promise<void>;
  reconcileMismatch: (mismatchId: string) => void;
  dismissMismatch: (mismatchId: string) => void;
  dispatchHl7Message: (message: Omit<Hl7Message, 'id' | 'timestamp' | 'status'>) => void;
  callNextOpdToken: (tokenId: string) => Promise<void>;
  completeOpdToken: (tokenId: string) => Promise<void>;
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
  const { user, activeTenant, loading: authLoading } = useAuth();
  const runtimeMode = String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
  const isDemoRuntime = runtimeMode === 'DEMO';

  const [beds, setBeds] = useState<Bed[]>(() => isDemoRuntime ? initialBeds : []);
  const [patients, setPatients] = useState<Patient[]>(() => isDemoRuntime ? initialPatients : []);
  const [mpiDirectoryReadiness, setMpiDirectoryReadiness] = useState<HospitalContextType['mpiDirectoryReadiness']>(
    isDemoRuntime ? 'DEMO' : 'UNHYDRATED'
  );
  const [mpiDirectoryTenantId, setMpiDirectoryTenantId] = useState<string | null>(
    isDemoRuntime ? 'DEMO' : null
  );
  const [staff, setStaff] = useState<StaffMember[]>(() => isDemoRuntime ? initialStaff : []);
  const [opdQueue, setOpdQueue] = useState<OpdQueueToken[]>(() => isDemoRuntime ? initialOpdQueue : []);
  const [mismatches, setMismatches] = useState<BillingAuditMismatch[]>(() => isDemoRuntime ? initialMismatches : []);
  const [hl7Messages, setHl7Messages] = useState<Hl7Message[]>(() => isDemoRuntime ? initialHl7Messages : []);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => isDemoRuntime ? initialAuditLogs : []);
  const [offlineMutations, setOfflineMutations] = useState<OfflineMutation[]>([]);
  const [telehealthSessions, setTelehealthSessions] = useState<TelehealthSession[]>(() => isDemoRuntime ? initialTelehealthSessions : []);
  const [dischargedCensus, setDischargedCensus] = useState<DischargedCensusRecord[]>(() => isDemoRuntime ? initialDischargedCensus : []);
  const [activeTelehealthSession, setActiveTelehealthSession] = useState<TelehealthSession | null>(null);
  const [activeTab, setActiveTab] = useState<string>('command');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [networkMode, setNetworkMode] = useState<'online' | 'offline' | 'degraded_sync'>('online');
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(() => isDemoRuntime ? 'p-1001' : null);
  const [clinicalContext, setClinicalContext] = useState<ClinicalContextBinding | null>(null);
  const clinicalContextRevisionRef = useRef(0);

  const bindClinicalEncounter = useCallback((input: BindClinicalEncounterInput): ClinicalContextBinding => {
    const authoritativeTenantId = String(
      activeTenant?.tenantId || user?.tenantId || ''
    ).trim().toLowerCase();
    const requestedTenantId = String(input.tenantId || authoritativeTenantId)
      .trim()
      .toLowerCase();
    const encounterId = String(input.encounterId || '').trim();
    const patientId = String(input.patientId || '').trim();
    const patientMrn = String(input.patientMrn || '').trim();
    const patientName = String(input.patientName || '').trim();

    if (!authoritativeTenantId || !encounterId || !patientId || !patientMrn || !patientName) {
      throw new Error('CLINICAL_CONTEXT_INVALID: tenant, encounter, patient, MRN and patient name are required.');
    }
    if (requestedTenantId !== authoritativeTenantId) {
      throw new Error('CLINICAL_CONTEXT_TENANT_MISMATCH');
    }

    const shellPatient = patients.find((patient) => patient.id === patientId);
    const status: ClinicalContextBinding['status'] =
      !shellPatient
        ? 'UNRESOLVED'
        : shellPatient.mrn !== patientMrn ||
            String(shellPatient.fullName || '').trim() !== patientName
          ? 'MISMATCH'
          : 'VERIFIED';

    clinicalContextRevisionRef.current += 1;
    const next: ClinicalContextBinding = {
      tenantId: authoritativeTenantId,
      encounterId,
      patientId,
      patientMrn,
      patientName,
      status,
      contextRevision: clinicalContextRevisionRef.current,
      source: input.source,
      boundAt: Date.now(),
    };

    // One state transition binds the shell patient to the active encounter.
    // The patient identifier is never independently inferred from display data.
    setClinicalContext(next);
    setSelectedPatientId(patientId);
    return next;
  }, [activeTenant?.tenantId, patients, user?.tenantId]);

  const clearClinicalContext = useCallback(() => {
    clinicalContextRevisionRef.current += 1;
    setClinicalContext(null);
  }, []);

  useEffect(() => {
    if (!clinicalContext) return;

    const shellPatient = patients.find(
      (patient) => patient.id === clinicalContext.patientId
    );
    const nextStatus: ClinicalContextBinding['status'] =
      !shellPatient
        ? 'UNRESOLVED'
        : shellPatient.mrn !== clinicalContext.patientMrn ||
            String(shellPatient.fullName || '').trim() !==
              clinicalContext.patientName
          ? 'MISMATCH'
          : 'VERIFIED';

    if (nextStatus === clinicalContext.status) return;

    // Revalidation changes readiness only. It does not create a new clinical
    // selection and therefore preserves the context revision.
    setClinicalContext((current) =>
      current &&
      current.contextRevision === clinicalContext.contextRevision
        ? { ...current, status: nextStatus }
        : current
    );
  }, [
    clinicalContext?.contextRevision,
    clinicalContext?.patientId,
    clinicalContext?.patientMrn,
    clinicalContext?.patientName,
    clinicalContext?.status,
    patients,
  ]);

  useEffect(() => {
    if (isDemoRuntime || authLoading) return;

    const tenantId = String(activeTenant?.tenantId || user?.tenantId || '').trim().toLowerCase();
    if (!tenantId) {
      setBeds([]);
      setPatients([]);
      setMpiDirectoryReadiness('UNHYDRATED');
      setMpiDirectoryTenantId(null);
      setOpdQueue([]);
      setMismatches([]);
      setTelehealthSessions([]);
      setSelectedPatientId(null);
      setClinicalContext(null);
      clinicalContextRevisionRef.current += 1;
      return;
    }

    let cancelled = false;

    const applySnapshot = (snapshot: Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>) => {
      if (cancelled || snapshot.tenantId !== tenantId) return;
      const models = adaptEdgeSnapshot(snapshot);
      setBeds(models.beds);
      setPatients(models.patients);
      setMpiDirectoryReadiness(
        snapshot.freshness === 'CURRENT' ? 'CURRENT' :
        snapshot.freshness === 'STALE' ? 'STALE' :
        snapshot.freshness === 'DENIED' ? 'DENIED' :
        snapshot.freshness === 'PARTIAL' ? 'PARTIAL' :
        snapshot.freshness === 'FAILED' ? 'FAILED' : 'UNHYDRATED'
      );
      setMpiDirectoryTenantId(tenantId);
      setOpdQueue(models.opdQueue);
      setMismatches(models.mismatches);
      setTelehealthSessions(models.telehealthSessions);
      setSelectedPatientId((current) =>
        current && models.patients.some((patient) => patient.id === current)
          ? current
          : null
      );
    };

    void loadLocalEdgeSnapshot(tenantId, 'HOSPITAL_SHELL')
      .then(applySnapshot)
      .catch((error) => console.warn('EDGE_LOCAL_READ_MODEL_LOAD_FAILED', error));

    const refreshAuthoritativeSnapshot = () => {
      if (!user) return;
      void hydrateEdgeSnapshot(tenantId, { surface: 'HOSPITAL_SHELL' })
        .then(applySnapshot)
        .catch((error) => console.warn('EDGE_SERVER_HYDRATION_FAILED', error));
    };

    refreshAuthoritativeSnapshot();

    const handleSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string }>).detail;
      if (String(detail?.tenantId || '').trim().toLowerCase() !== tenantId) return;
      refreshAuthoritativeSnapshot();
    };

    const handleMpiRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string }>).detail;
      if (String(detail?.tenantId || '').trim().toLowerCase() !== tenantId) return;
      refreshAuthoritativeSnapshot();
    };
    window.addEventListener('ghims:edge-sync-complete', handleSyncComplete);
    window.addEventListener('ghims:mpi-directory-refresh', handleMpiRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener('ghims:edge-sync-complete', handleSyncComplete);
      window.removeEventListener('ghims:mpi-directory-refresh', handleMpiRefresh);
    };
  }, [
    activeTenant?.tenantId,
    user?.tenantId,
    user?.uid,
    authLoading,
    isDemoRuntime,
  ]);

  // Legacy root-level Firestore listeners were retired at the P0/P5C trust boundary.
  // Those collections are intentionally denied by firestore.rules. Authoritative
  // mutations flow through server commands, while browser read models must use
  // tenant-scoped projections as they are introduced. Mounting forbidden listeners
  // before authentication caused repeated permission-denied exceptions on /login.

  // Compute live stats
  const totalBeds = beds.length;
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length;
  const availableBeds = beds.filter((b) => b.status === 'available').length;
  const maintenanceBeds = beds.filter((b) => b.status === 'maintenance' || b.status === 'cleaning').length;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  
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

  const updateBedStatus = async (bedId: string, status: BedStatus, _patientId?: string, notes?: string) => {
    if (status === 'occupied') {
      throw new Error('BED_STATUS_REJECTED: use the governed care-transition workflow for occupied beds.');
    }
    if (status === 'reserved') {
      throw new Error(
        'BED_RESERVATION_WORKFLOW_REQUIRED: bed holds must be created by a governed admission/capacity reservation workflow.'
      );
    }

    const existingBed = beds.find((bed) => bed.id === bedId);
    if (!existingBed) {
      throw new Error('BED_NOT_FOUND: target bed is not present in the local read model.');
    }
    if (existingBed.status === 'occupied' || existingBed.patientId) {
      throw new Error('BED_OCCUPIED: occupied beds must use the inpatient discharge/transfer workflow.');
    }

    const result = await executeActiveTenantCommand<{ bed: Bed }>(
      'UpdateBedStatusCommand',
      {
        bedId,
        status,
        notes,
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'beds',
          resourceId: bedId,
          action: 'UPDATE',
          // Bed availability is admission-safety state. Never make an offline
          // intent look authoritative before server-side conflict checks pass.
          optimisticCache: false,
        },
      }
    );

    if (result.queuedOffline) {
      // The command is durable in the offline outbox, but the local bed read
      // model remains unchanged until authoritative replay succeeds.
      return;
    }

    if (!result.success || !result.data?.bed) {
      throw new Error(result.error?.message || 'Bed-status command failed.');
    }

    const authoritativeBed = result.data.bed;
    setBeds((previous) => previous.map((bed) => bed.id === bedId ? authoritativeBed : bed));
  };

  const assignPatientToBed = async (bedId: string, patientId: string) => {
    await admitPatientToBed(patientId, bedId);
  };

  const admitPatientToBed = async (patientId: string, bedId: string, doctor?: string, nurse?: string) => {
    if (!isDemoRuntime) {
      throw new Error(
        'CARE_TRANSITION_COMMAND_REQUIRED: production inpatient admission must use AdmitPatientToInpatientCareCommand.'
      );
    }

    const existingBed = beds.find((bed) => bed.id === bedId);
    const existingPatient = patients.find((patient) => patient.id === patientId);

    if (!existingBed) throw new Error('BED_NOT_FOUND: target bed is not present in the local read model.');
    if (!existingPatient) throw new Error('PATIENT_NOT_FOUND: patient is not present in the local read model.');
    if (existingBed.status !== 'available' && existingBed.patientId !== patientId) {
      throw new Error(`BED_UNAVAILABLE: bed ${existingBed.bedNumber || bedId} is currently ${existingBed.status}.`);
    }
    if (existingPatient.activeBedId && existingPatient.activeBedId !== bedId) {
      throw new Error(`PATIENT_ALREADY_ADMITTED: patient is already assigned to bed ${existingPatient.activeBedId}.`);
    }

    const result = await executeActiveTenantCommand<{ bed: Bed; patient: Patient }>(
      'AdmitPatientToBedCommand',
      {
        patientId,
        bedId,
        assignedDoctor: doctor,
        assignedNurse: nurse,
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'beds',
          resourceId: bedId,
          action: 'UPDATE',
          optimisticCache: false,
        },
      }
    );

    if (result.queuedOffline) {
      const admissionDate = new Date().toISOString().split('T')[0];
      const optimisticBed: Bed = {
        ...existingBed,
        status: 'occupied',
        patientId,
        patientName: existingPatient.fullName,
        admissionDate,
        assignedDoctor: doctor || existingBed.assignedDoctor,
        assignedNurse: nurse || existingBed.assignedNurse,
      };
      const optimisticPatient: Patient = {
        ...existingPatient,
        activeBedId: bedId,
      };

      setBeds((previous) => previous.map((bed) => bed.id === bedId ? optimisticBed : bed));
      setPatients((previous) => previous.map((patient) => patient.id === patientId ? optimisticPatient : patient));
      return;
    }

    if (!result.success || !result.data?.bed || !result.data?.patient) {
      throw new Error(result.error?.message || 'Inpatient admission command failed.');
    }

    setBeds((previous) => previous.map((bed) => bed.id === bedId ? result.data!.bed : bed));
    setPatients((previous) => previous.map((patient) => patient.id === patientId ? result.data!.patient : patient));
  };

  const dischargePatientFromBed = async (
    bedId: string,
    notes?: string,
    disposition?: string,
    censusRecord?: DischargedCensusRecord
  ) => {
    if (!isDemoRuntime) {
      throw new Error(
        'CARE_TRANSITION_COMMAND_REQUIRED: production inpatient discharge must use DischargeInpatientEncounterCommand.'
      );
    }

    const existingBed = beds.find((bed) => bed.id === bedId);
    if (!existingBed || existingBed.status !== 'occupied' || !existingBed.patientId) {
      throw new Error('BED_NOT_OCCUPIED: only an occupied bed can be discharged.');
    }
    const existingPatient = patients.find((patient) => patient.id === existingBed.patientId);
    if (!existingPatient) {
      throw new Error('PATIENT_NOT_FOUND: assigned patient is not present in the local read model.');
    }

    const result = await executeActiveTenantCommand<{ bed: Bed; patient: Patient; disposition?: string }>(
      'DischargePatientFromBedCommand',
      { bedId, notes, disposition },
      {
        offlineQueue: {
          enabled: true,
          collection: 'beds',
          resourceId: bedId,
          action: 'UPDATE',
          optimisticCache: false,
        },
      }
    );

    if (result.queuedOffline) {
      const optimisticBed: Bed = {
        ...existingBed,
        status: 'cleaning',
        patientId: undefined,
        patientName: undefined,
        notes: notes || 'Sanitizing protocol in progress (Discharged)',
      };
      const optimisticPatient: Patient = {
        ...existingPatient,
        activeBedId: undefined,
      };
      setBeds((previous) => previous.map((bed) => bed.id === bedId ? optimisticBed : bed));
      setPatients((previous) => previous.map((patient) =>
        patient.id === existingPatient.id ? optimisticPatient : patient
      ));
      if (censusRecord) {
        setDischargedCensus((previous) => [censusRecord, ...previous]);
      }
      return;
    }

    if (!result.success || !result.data?.bed || !result.data?.patient) {
      throw new Error(result.error?.message || 'Inpatient discharge command failed.');
    }

    setBeds((previous) => previous.map((bed) => bed.id === bedId ? result.data!.bed : bed));
    setPatients((previous) => previous.map((patient) =>
      patient.id === result.data!.patient.id ? result.data!.patient : patient
    ));

    if (censusRecord) {
      setDischargedCensus((previous) => [censusRecord, ...previous]);
    }
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

  const registerNewPatient = async (
    patientData: Omit<Patient, 'id' | 'mrn' | 'registeredAt' | 'encounters'>
  ): Promise<Patient> => {
    const registration = await registerActiveTenantPatient<{
      patient: {
        id: string;
        mrn: string;
        fullName: string;
        dateOfBirth: string;
      };
      encounter: {
        id: string;
        department: string;
        chiefComplaint: string;
      };
      queueToken: {
        id: string;
        tokenNumber: string;
        department: string;
        priority: string;
        status: 'waiting';
        arrivalTime: string;
      };
    }>({
      fullName: patientData.fullName,
      dateOfBirth: patientData.dateOfBirth,
      gender: patientData.gender,
      contactPhone: patientData.contactNumber,
      address: patientData.address,
      bloodGroup: patientData.bloodGroup,
      identifiers: patientData.contactNumber
        ? [{ type: 'PHONE', value: patientData.contactNumber, issuer: 'Patient Registration' }]
        : [],
      allergies: patientData.allergies,
      chronicConditions: patientData.chronicConditions,
      encounterType: 'OPD',
      department: 'General OPD',
      priority: 'ROUTINE',
      chiefComplaint: 'Initial clinic intake and consultation',
    });

    const newPatient: Patient = {
      ...patientData,
      id: registration.patient.id,
      mrn: registration.patient.mrn,
      activeEncounterId: registration.encounter.id,
      registeredAt: new Date().toISOString().split('T')[0],
      encounters: [
        {
          id: registration.encounter.id,
          type: 'Outpatient',
          department: registration.encounter.department || 'General OPD',
          admitDate: new Date().toISOString().split('T')[0],
          chiefComplaint: registration.encounter.chiefComplaint || 'Initial clinic intake and consultation',
          attendingPhysician: '',
          status: 'active',
          vitalsHistory: [],
          clinicalNotes: [],
          medications: [],
          labOrders: [],
          billing: {
            items: [],
            subtotal: 0,
            tax: 0,
            insuranceCoverage: 0,
            patientPayable: 0,
            paymentStatus: 'pending',
          },
        },
      ],
    };

    setPatients((previous) => [newPatient, ...previous.filter((item) => item.id !== newPatient.id)]);
    setOpdQueue((previous) => [
      {
        id: registration.queueToken.id,
        encounterId: registration.encounter.id,
        tokenNumber: registration.queueToken.tokenNumber,
        patientId: newPatient.id,
        patientName: newPatient.fullName,
        mrn: newPatient.mrn,
        age: newPatient.age,
        gender: newPatient.gender,
        department: registration.queueToken.department,
        assignedDoctor: '',
        priority:
          registration.queueToken.priority === 'urgent'
            ? 'urgent'
            : registration.queueToken.priority === 'emergency'
              ? 'stat_emergency'
              : 'routine',
        status: 'waiting',
        arrivalTime: registration.queueToken.arrivalTime,
        chiefComplaint: registration.encounter.chiefComplaint || 'Initial clinic intake and consultation',
      },
      ...previous.filter((token) => token.id !== registration.queueToken.id),
    ]);
    bindClinicalEncounter({
      encounterId: registration.encounter.id,
      patientId: newPatient.id,
      patientMrn: newPatient.mrn,
      patientName: newPatient.fullName,
      source: 'REGISTRATION',
    });
    recordMutation('REGISTER_PATIENT', `Patient:${newPatient.id}`, {
      patientId: newPatient.id,
      mrn: newPatient.mrn,
      encounterId: registration.encounter.id,
      queueTokenId: registration.queueToken.id,
    });

    return newPatient;
  };

  const mergePatients = async (
    primaryId: string,
    secondaryId: string,
    mergeReason: string
  ): Promise<Patient> => {
    const primary = patients.find((patient) => patient.id === primaryId);
    const secondary = patients.find((patient) => patient.id === secondaryId);

    if (!primary || !secondary) {
      throw new Error('Primary or secondary patient record not found.');
    }
    if (primary.id === secondary.id) {
      throw new Error('Cannot merge a patient record into itself.');
    }
    if (['MERGED', 'REMOVED'].includes(String(primary.status || 'ACTIVE').toUpperCase())) {
      throw new Error(primary.mergedIntoPatientId
        ? `This primary MRN has been merged. Review the surviving record ${primary.mergedIntoPatientId} before continuing.`
        : 'This primary MRN is retired. Refresh MPI and contact the Records Officer.');
    }
    if (['MERGED', 'REMOVED'].includes(String(secondary.status || 'ACTIVE').toUpperCase())) {
      throw new Error('The secondary record is retired. Refresh MPI and inspect the existing merge history.');
    }
    if (!mergeReason.trim()) {
      throw new Error('A governed patient-merge reason is required.');
    }

    const result = await executeActiveTenantCommand<{
      primaryPatientId: string;
      secondaryPatientId: string;
      status: 'MERGED';
      allergies: string[];
      chronicConditions: string[];
    }>('MergePatientCommand', {
      primaryPatientId: primaryId,
      secondaryPatientId: secondaryId,
      mergeReason: mergeReason.trim(),
    });

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Authoritative patient merge failed.');
    }

    // P1 keeps the legacy UI projection synchronized only with state that the
    // authoritative merge command actually committed. Dependent encounter/queue/
    // bed re-indexing is not fabricated client-side.
    const consolidatedPrimary: Patient = {
      ...primary,
      allergies: result.data.allergies || primary.allergies,
      chronicConditions: result.data.chronicConditions || primary.chronicConditions,
    };

    setPatients((previous) =>
      previous
        .filter((patient) => patient.id !== secondaryId)
        .map((patient) => patient.id === primaryId ? consolidatedPrimary : patient)
    );
    setSelectedPatientId(primaryId);

    addAuditLog(
      'MPI_PATIENT_MERGE',
      `Primary ${primary.mrn} <= Secondary ${secondary.mrn}`,
      `Authoritative merge committed. Secondary identity is marked MERGED into the primary record. Reason: ${mergeReason.trim()}`
    );

    return consolidatedPrimary;
  };

  const requireVerifiedClinicalContextForPatient = (
    patientId: string,
    operation: string
  ): { patient: Patient; encounterId: string } => {
    const normalizedPatientId = String(patientId || '').trim();
    const patient = patients.find((item) => item.id === normalizedPatientId);

    if (
      !patient ||
      !clinicalContext ||
      clinicalContext.status !== 'VERIFIED' ||
      clinicalContext.patientId !== normalizedPatientId ||
      patient.mrn !== clinicalContext.patientMrn ||
      String(patient.fullName || '').trim() !== clinicalContext.patientName
    ) {
      throw new Error(
        `PATIENT_CONTEXT_MISMATCH: ${operation} requires a verified encounter-bound patient context.`
      );
    }

    return {
      patient,
      encounterId: clinicalContext.encounterId,
    };
  };

  const addClinicalNote = async (
    patientId: string,
    note: Omit<ClinicalNote, 'id' | 'timestamp'>
  ): Promise<void> => {
    const { patient, encounterId } =
      requireVerifiedClinicalContextForPatient(
        patientId,
        'Clinical note signing'
      );

    const categoryMap: Record<
      ClinicalNote['category'],
      'SOAP' | 'PROGRESS' | 'CONSULTATION' | 'DISCHARGE' | 'NURSING'
    > = {
      SOAP: 'SOAP',
      Progress: 'PROGRESS',
      Consultation: 'CONSULTATION',
      Discharge: 'DISCHARGE',
      Nursing: 'NURSING',
    };

    const offlineNoteId = `offline-note-${crypto.randomUUID()}`;
    const result = await executeActiveTenantCommand<{
      evidenceId: string;
      revenueIntegrityFindings?: Array<{
        id: string;
        patientId: string;
        encounterId: string;
        sourceEvidenceId: string;
        documentedItem: string;
        category: 'Procedure' | 'Medication' | 'Lab' | 'Supply / Consumable' | 'Bed Tier';
        suggestedCode: string;
        estimatedRecoverableAmountMinorUnits: number;
        status: 'PENDING_REVIEW' | 'RECONCILED' | 'DISMISSED';
        evidenceSnippet: string;
        confidenceScore?: number;
      }>;
    }>(
      'SignClinicalNoteCommand',
      {
        encounterId,
        patientId,
        category: categoryMap[note.category],
        content: note.content,
        acceptedStructuredData: note.aiStructuredData || {},
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'clinical_notes',
          resourceId: offlineNoteId,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Clinical note command failed.');
    }

    const noteId = result.entityId || offlineNoteId;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const newNote: ClinicalNote = { ...note, id: noteId, timestamp };

    setPatients((previous) => previous.map((item) => {
      if (item.id !== patientId) return item;
      const encounters = [...item.encounters];
      const encounterIndex = encounters.findIndex(
        (encounter) => encounter.id === encounterId
      );
      if (encounterIndex >= 0) {
        encounters[encounterIndex] = {
          ...encounters[encounterIndex],
          clinicalNotes: [
            newNote,
            ...encounters[encounterIndex].clinicalNotes,
          ],
        };
      }
      return { ...item, encounters };
    }));

    const authoritativeFindings = result.data?.revenueIntegrityFindings || [];
    if (authoritativeFindings.length > 0) {
      const projectedMismatches: BillingAuditMismatch[] =
        authoritativeFindings.map((finding) => ({
          id: finding.id,
          patientId: finding.patientId,
          patientName: patient.fullName,
          encounterId: finding.encounterId,
          noteId: finding.sourceEvidenceId,
          date: new Date().toISOString().split('T')[0],
          documentedItem: finding.documentedItem,
          category: finding.category,
          suggestedCptCode: finding.suggestedCode,
          estimatedRecoverableRevenue:
            finding.estimatedRecoverableAmountMinorUnits / 100,
          status:
            finding.status === 'RECONCILED'
              ? 'reconciled'
              : finding.status === 'DISMISSED'
                ? 'dismissed'
                : 'pending_review',
          evidenceSnippet: finding.evidenceSnippet,
          confidenceScore: finding.confidenceScore ?? 1,
        }));

      setMismatches((previous) => [
        ...projectedMismatches,
        ...previous.filter(
          (existing) =>
            !projectedMismatches.some((item) => item.id === existing.id)
        ),
      ]);
    }

    recordMutation('INSERT_NOTE', `Note:${noteId}`, newNote);
  };

  const addLabOrder = async (
    patientId: string,
    order: Omit<LabOrder, 'id' | 'orderedAt'>
  ): Promise<void> => {
    const { encounterId } =
      requireVerifiedClinicalContextForPatient(
        patientId,
        'Diagnostic ordering'
      );

    const orderType = order.category === 'Radiology' ? 'RADIOLOGY' : 'LAB';
    const offlineOrderId = `offline-order-${crypto.randomUUID()}`;

    const result = await executeActiveTenantCommand(
      'PlaceDiagnosticOrderCommand',
      {
        encounterId,
        patientId,
        orderType,
        catalogCode: order.sampleId || order.testName,
        orderName: order.testName,
        priority: 'ROUTINE',
        clinicalIndication:
          order.notes || 'Clinician ordered diagnostic investigation',
        estimatedCostMinorUnits: Math.round((order.cost || 0) * 100),
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'clinical_orders',
          resourceId: offlineOrderId,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Diagnostic order command failed.');
    }

    const orderedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const newOrder: LabOrder = {
      ...order,
      id: result.entityId || offlineOrderId,
      orderedAt,
    };

    setPatients((previous) => previous.map((item) => {
      if (item.id !== patientId) return item;
      const encounters = [...item.encounters];
      const encounterIndex = encounters.findIndex(
        (encounter) => encounter.id === encounterId
      );
      if (encounterIndex >= 0) {
        encounters[encounterIndex] = {
          ...encounters[encounterIndex],
          labOrders: [
            newOrder,
            ...encounters[encounterIndex].labOrders,
          ],
        };
      }
      return { ...item, encounters };
    }));

    recordMutation('ORDER_LAB', `Order:${newOrder.id}`, newOrder);
  };

  const addVitals = async (
    patientId: string,
    vitals: Omit<Vitals, 'timestamp'>
  ): Promise<void> => {
    const { encounterId } =
      requireVerifiedClinicalContextForPatient(
        patientId,
        'Vitals recording'
      );

    const offlineVitalsId = `offline-vitals-${crypto.randomUUID()}`;
    const result = await executeActiveTenantCommand(
      'RecordVitalsCommand',
      {
        encounterId,
        patientId,
        heartRate: vitals.heartRate,
        bloodPressure: vitals.bloodPressure,
        temperature: vitals.temperature,
        respiratoryRate: vitals.respiratoryRate,
        oxygenSaturation: vitals.oxygenSaturation,
        measuredAt: Date.now(),
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'vitals',
          resourceId: offlineVitalsId,
          action: 'CREATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Vitals command failed.');
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const newVitals: Vitals = { ...vitals, timestamp };

    setPatients((previous) => previous.map((item) => {
      if (item.id !== patientId) return item;
      const encounters = [...item.encounters];
      const encounterIndex = encounters.findIndex(
        (encounter) => encounter.id === encounterId
      );
      if (encounterIndex >= 0) {
        encounters[encounterIndex] = {
          ...encounters[encounterIndex],
          vitalsHistory: [
            newVitals,
            ...encounters[encounterIndex].vitalsHistory,
          ],
        };
      }
      return { ...item, encounters };
    }));

    recordMutation('UPDATE_VITALS', `Patient:${patientId}`, newVitals);
  };

  const reconcileMismatch = async (mismatchId: string) => {
    const mismatch = mismatches.find((item) => item.id === mismatchId);
    if (!mismatch) return;

    const result = await executeActiveTenantCommand<{
      finding: {
        id: string;
        status: 'RECONCILED';
      };
      charge: {
        id: string;
        code: string;
        description: string;
        category: 'Procedure' | 'Medication' | 'Lab' | 'Supply / Consumable' | 'Bed Tier';
        quantity: number;
        unitAmountMinorUnits: number;
        netAmountMinorUnits: number;
      };
    }>('ReconcileRevenueIntegrityFindingCommand', { findingId: mismatchId });

    if (!result.success || !result.data?.charge) {
      throw new Error(result.error?.message || 'Revenue Integrity reconciliation failed.');
    }

    const charge = result.data.charge;
    setMismatches((previous) =>
      previous.map((item) => item.id === mismatchId ? { ...item, status: 'reconciled' } : item)
    );

    // Billing inside HospitalContext is a transitional UI projection. The durable
    // source of truth is now tenants/{tenantId}/encounterCharges/{chargeId}.
    setPatients((previous) => previous.map((patientItem) => {
      if (patientItem.id !== mismatch.patientId) return patientItem;

      const encounters = [...patientItem.encounters];
      const encounterIndex = encounters.findIndex((encounter) => encounter.id === mismatch.encounterId);
      if (encounterIndex < 0) return patientItem;

      const encounter = encounters[encounterIndex];
      const amount = charge.netAmountMinorUnits / 100;
      const existingItem = encounter.billing.items.find((item) => item.id === charge.id);
      if (existingItem) return patientItem;

      const newBillItem: BillItem = {
        id: charge.id,
        description: charge.description,
        code: charge.code,
        category:
          charge.category === 'Lab'
            ? 'Lab & Diagnostics'
            : charge.category === 'Medication' || charge.category === 'Supply / Consumable'
              ? 'Pharmacy'
              : 'Procedure',
        quantity: charge.quantity,
        unitPrice: charge.unitAmountMinorUnits / 100,
        totalPrice: amount,
        auditedStatus: 'reconciled',
        sourceNoteId: mismatch.noteId,
      };

      const newSubtotal = encounter.billing.subtotal + amount;
      const newTax = Math.round(newSubtotal * 0.05 * 100) / 100;

      encounters[encounterIndex] = {
        ...encounter,
        billing: {
          ...encounter.billing,
          items: [...encounter.billing.items, newBillItem],
          subtotal: newSubtotal,
          tax: newTax,
        },
      };

      return { ...patientItem, encounters };
    }));

    recordMutation('RECONCILE_BILL', `Mismatch:${mismatchId}`, {
      findingId: mismatchId,
      chargeId: charge.id,
    });
    addAuditLog(
      'RECONCILE_LEAKAGE',
      `Encounter ${mismatch.encounterId}`,
      `Authoritative charge ${charge.code} accepted for ${(charge.netAmountMinorUnits / 100).toFixed(2)}.`
    );
  };

  const dismissMismatch = async (mismatchId: string) => {
    const dismissedItem = mismatches.find((item) => item.id === mismatchId);
    if (!dismissedItem) return;

    const result = await executeActiveTenantCommand<{
      finding: { id: string; status: 'DISMISSED' };
    }>(
      'DismissRevenueIntegrityFindingCommand',
      {
        findingId: mismatchId,
        reason: 'Reviewed by revenue-cycle staff and marked not billable / clinical exception.',
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'billingMismatches',
          resourceId: mismatchId,
          action: 'UPDATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Revenue Integrity dismissal failed.');
    }

    setMismatches((previous) =>
      previous.map((item) => item.id === mismatchId ? { ...item, status: 'dismissed' } : item)
    );
    addAuditLog(
      'DISMISS_MISMATCH',
      `Mismatch ${mismatchId}`,
      'Authoritative Revenue Integrity finding dismissed after human review.'
    );
  };

  const dispatchHl7Message = (msg: Omit<Hl7Message, 'id' | 'timestamp' | 'status'>) => {
    const newMsg: Hl7Message = {
      ...msg,
      id: `hl7-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'dispatched',
    };
    setHl7Messages(prev => [newMsg, ...prev]);
    addAuditLog('DISPATCH_HL7', msg.type, `Dispatched to ${msg.receivingApp} for MRN: ${msg.patientMrn}`);
  };

  const callNextOpdToken = async (tokenId: string): Promise<void> => {
    const token = opdQueue.find((item) => item.id === tokenId);
    if (!token) {
      throw new Error('OPD_TOKEN_NOT_FOUND');
    }

    const result = await executeActiveTenantCommand(
      'UpdateOpdQueueStatusCommand',
      {
        tokenId,
        targetStatus: 'in_consultation',
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'opd_queue',
          resourceId: tokenId,
          action: 'UPDATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Unable to call OPD patient.');
    }

    setOpdQueue((previous) => previous.map((item) =>
      item.id === tokenId ? { ...item, status: 'in_consultation' } : item
    ));
    if (token.encounterId) {
      bindClinicalEncounter({
        encounterId: token.encounterId,
        patientId: token.patientId,
        patientMrn: token.mrn,
        patientName: token.patientName,
        source: 'OPD_QUEUE',
      });
    }
  };

  const completeOpdToken = async (tokenId: string): Promise<void> => {
    const token = opdQueue.find((item) => item.id === tokenId);
    if (!token) {
      throw new Error('OPD_TOKEN_NOT_FOUND');
    }

    const result = await executeActiveTenantCommand(
      'UpdateOpdQueueStatusCommand',
      {
        tokenId,
        targetStatus: 'completed',
      },
      {
        offlineQueue: {
          enabled: true,
          collection: 'opd_queue',
          resourceId: tokenId,
          action: 'UPDATE',
          optimisticCache: true,
        },
      }
    );

    if (!result.success) {
      throw new Error(
        result.error?.message || 'Unable to complete OPD consultation.'
      );
    }

    setOpdQueue((previous) => previous.map((item) =>
      item.id === tokenId ? { ...item, status: 'completed' } : item
    ));
  };

  const triggerOfflineSync = () => {
    setNetworkMode('online');

    if (!syncEngine) {
      addAuditLog('OFFLINE_SYNC_ERROR', 'Command Sync Queue', 'Offline sync engine is unavailable in this runtime.', 'ERROR');
      return;
    }

    void syncEngine.processSyncQueue().then(({ syncedCount, conflictCount }) => {
      addAuditLog(
        conflictCount > 0 ? 'OFFLINE_SYNC_REVIEW_REQUIRED' : 'OFFLINE_SYNC_COMPLETE',
        'Command Sync Queue',
        `Server replay completed: ${syncedCount} accepted, ${conflictCount} requiring review.`,
        conflictCount > 0 ? 'WARNING' : 'SUCCESS'
      );
    }).catch((error) => {
      addAuditLog(
        'OFFLINE_SYNC_ERROR',
        'Command Sync Queue',
        error instanceof Error ? error.message : 'Offline sync failed.',
        'ERROR'
      );
    });
  };

  const createTelehealthSession = async (data: {
    patientId: string;
    type: TelehealthSession['type'];
    scheduledTime?: string;
    chiefComplaint: string;
    attendingPhysician?: string;
  }): Promise<TelehealthSession> => {
    const result = await executeActiveTenantCommand<TelehealthSession>('CreateTelehealthSessionCommand', {
      patientId: data.patientId,
      type: data.type,
      scheduledTime: data.scheduledTime,
      chiefComplaint: data.chiefComplaint,
      attendingPhysician: data.attendingPhysician,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Telehealth session creation failed.');
    }

    const session = result.data;
    setTelehealthSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
    setActiveTelehealthSession(session);
    return session;
  };

  const updateTelehealthSession = async (
    sessionId: string,
    updates: Partial<TelehealthSession>
  ): Promise<void> => {
    const allowedUpdates = {
      connectionQuality: updates.connectionQuality,
      callDurationSeconds: updates.callDurationSeconds,
      isAudioMuted: updates.isAudioMuted,
      isVideoMuted: updates.isVideoMuted,
    };

    const result = await executeActiveTenantCommand<TelehealthSession>('UpdateTelehealthSessionCommand', {
      sessionId,
      updates: allowedUpdates,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Telehealth session update failed.');
    }

    const authoritative = result.data;
    setTelehealthSessions((previous) =>
      previous.map((session) => session.id === sessionId ? authoritative : session)
    );
    if (activeTelehealthSession?.id === sessionId) {
      setActiveTelehealthSession(authoritative);
    }
  };

  const completeTelehealthSession = async (
    sessionId: string,
    note?: Partial<TelehealthSoapNote>,
    prescriptions?: TelehealthPrescription[]
  ): Promise<void> => {
    const session = telehealthSessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('TELEHEALTH_SESSION_NOT_FOUND');
    if ((prescriptions || []).length > 0) {
      throw new Error(
        'TELEHEALTH_ERX_INTEGRATION_NOT_LIVE: use the governed medication-order workflow.'
      );
    }

    const content = [
      '[TELEHEALTH VIRTUAL CONSULTATION RECORD]',
      'Encounter Type: ' + session.type,
      'Chief Complaint: ' + session.chiefComplaint,
      '',
      '--- SUBJECTIVE ---',
      note?.subjective || '',
      '',
      '--- OBJECTIVE ---',
      note?.objective || '',
      '',
      '--- ASSESSMENT ---',
      note?.assessment || '',
      '',
      '--- PLAN ---',
      note?.plan || '',
    ].join('\n');

    const signed = await executeActiveTenantCommand<{
      evidenceId: string;
      canonicalDocumentId?: string;
    }>('SignClinicalNoteCommand', {
      encounterId: session.encounterId,
      patientId: session.patientId,
      category: 'SOAP',
      content,
      acceptedStructuredData: {
        diagnoses: (note?.icd10Codes || []).map((item) => ({
          code: item.code,
          description: item.description,
          verificationStatus: 'CONFIRMED',
        })),
      },
    });

    if (!signed.success || !signed.entityId) {
      throw new Error(signed.error?.message || 'Telehealth clinical note signing failed.');
    }

    const result = await executeActiveTenantCommand<TelehealthSession>(
      'CompleteTelehealthSessionCommand',
      { sessionId, signedEvidenceId: signed.entityId }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Telehealth completion failed.');
    }

    const authoritative = result.data;
    setTelehealthSessions((previous) =>
      previous.map((item) => item.id === sessionId ? authoritative : item)
    );
    if (activeTelehealthSession?.id === sessionId) {
      setActiveTelehealthSession(authoritative);
    }
    // Successful Telehealth completion also changes patient care pointers and
    // encounter lifecycle in the canonical aggregate. Never leave other MPI
    // workspaces on an obsolete pre-completion snapshot.
    const tenantId = String(activeTenant?.tenantId || user?.tenantId || '').trim().toLowerCase();
    if (tenantId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ghims:edge-sync-complete', {
        detail: { tenantId },
      }));
    }
  };

  return (
    <HospitalContext.Provider
      value={{
        beds,
        patients,
        mpiDirectoryReadiness,
        mpiDirectoryTenantId,
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
        clinicalContext,
        bindClinicalEncounter,
        clearClinicalContext,
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
