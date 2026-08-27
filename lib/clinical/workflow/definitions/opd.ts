/**
 * General Outpatient Department (OPD) Clinical Workflow Definition
 * DAG-based Clinical Pathway with SLAs, Role Authorization, and Guard Evaluators
 */

import { WorkflowDefinition } from '@/types/clinical-workflow';

export const GeneralOpdWorkflowDefinition: WorkflowDefinition = {
  id: 'wf-opd-general-standard',
  version: '1.2.0',
  name: 'Standard General Outpatient (OPD) Care Pathway',
  department: 'General Outpatient Department',
  encounterType: 'OPD_GENERAL',
  description:
    'Standard ambulatory clinical pathway encompassing registration, nursing triage, physician consultation, point-of-care diagnostics, pharmacy dispensation, split-billing settlement, and formal discharge.',
  initialStage: 'REGISTRATION',
  metadata: {
    author: 'Clinical Governance Committee & Chief Medical Officer',
    approvedAt: '2026-01-15T08:00:00.000Z',
    clinicalProtocolCode: 'AMB-OPD-PROTO-2026-A',
  },
  globalGuards: [
    {
      id: 'guard-tenant-active',
      name: 'Active Tenant Context',
      description: 'Encounter must execute within a valid, licensed hospital tenant context.',
      guardType: 'ROLE_PERMISSION',
      evaluatorFnName: 'evaluateTenantActive',
      blockingMessage: 'Hospital tenant account is suspended or invalid.',
    },
    {
      id: 'guard-patient-active',
      name: 'Active Patient Record',
      description: 'Patient must have an active, non-archived MPI profile.',
      guardType: 'CUSTOM',
      evaluatorFnName: 'evaluatePatientActive',
      blockingMessage: 'Patient MPI record is merged or inactive.',
    },
  ],
  stages: {
    REGISTRATION: {
      id: 'REGISTRATION',
      title: 'Patient Intake & MPI Registration',
      description:
        'Patient demographics verification, Master Patient Index deduplication, institutional MRN assignment, tariff package selection, and clinic queue token generation.',
      sequenceOrder: 1,
      targetSlaMinutes: 8,
      requiredRoles: ['Registration Clerk', 'Admissions Officer', 'Receptionist', 'Admin', 'practitioner'],
      allowedNextStages: ['TRIAGE', 'CONSULTATION'],
      prerequisites: [
        { field: 'patientId', type: 'STRING', required: true, description: 'Master Patient ID reference' },
        { field: 'mrn', type: 'STRING', required: true, description: 'Institutional Medical Record Number' },
        { field: 'fullName', type: 'STRING', required: true, description: 'Patient Legal Full Name' },
        { field: 'dateOfBirth', type: 'STRING', required: true, description: 'Patient Date of Birth' },
        { field: 'contactNumber', type: 'STRING', required: true, description: 'Primary Contact Phone' },
        { field: 'department', type: 'STRING', required: true, description: 'Target Specialty or General OPD' },
        { field: 'chiefComplaint', type: 'STRING', required: true, description: 'Presenting primary complaint' },
      ],
      guards: [
        {
          id: 'guard-mrn-valid',
          name: 'Valid MRN Format',
          description: 'Institutional MRN must match standard prefix format.',
          guardType: 'CUSTOM',
          evaluatorFnName: 'evaluateMrnFormat',
          blockingMessage: 'MRN format is invalid or corrupted.',
        },
      ],
      autoTransitions: [
        {
          conditionFnName: 'isStandardRoutineAmbulatory',
          targetStage: 'TRIAGE',
        },
      ],
    },

    TRIAGE: {
      id: 'TRIAGE',
      title: 'Nursing Triage & Acuity Evaluation',
      description:
        'Vital signs collection (BP, HR, SpO2, RR, Temp), National Early Warning Score 2 (NEWS2) calculation, Emergency Severity Index (ESI 1-5) acuity scoring, and allergy verification.',
      sequenceOrder: 2,
      targetSlaMinutes: 12,
      requiredRoles: ['Triage Nurse', 'Registered Nurse', 'Nurse', 'Physician', 'Admin'],
      allowedNextStages: ['CONSULTATION', 'DIAGNOSTICS_LAB_RAD', 'DISCHARGE_OR_REFERRAL'],
      prerequisites: [
        { field: 'heartRate', type: 'NUMBER', required: true, description: 'Pulse / Heart Rate (bpm)' },
        { field: 'bloodPressure', type: 'STRING', required: true, description: 'Systolic/Diastolic BP (mmHg)' },
        { field: 'respiratoryRate', type: 'NUMBER', required: true, description: 'Respiratory Rate (breaths/min)' },
        { field: 'oxygenSaturation', type: 'NUMBER', required: true, description: 'Pulse Oximetry SpO2 (%)' },
        { field: 'temperature', type: 'NUMBER', required: true, description: 'Body Temperature (°C)' },
      ],
      guards: [
        {
          id: 'guard-vitals-complete',
          name: 'Mandatory Baseline Vitals',
          description: 'All 5 core physiological vital parameters must be measured and recorded.',
          guardType: 'VITALS_REQUIRED',
          evaluatorFnName: 'evaluateVitalsCompleteness',
          blockingMessage: 'Incomplete vital sign measurements recorded.',
        },
        {
          id: 'guard-news2-evaluated',
          name: 'NEWS2 Risk Stratification',
          description: 'NEWS2 clinical deterioration score must be calculated before consultation.',
          guardType: 'NEWS2_CHECK',
          evaluatorFnName: 'evaluateNews2Calculated',
          blockingMessage: 'NEWS2 score calculation has not been computed.',
        },
      ],
    },

    CONSULTATION: {
      id: 'CONSULTATION',
      title: 'Physician Clinical Consultation & Orders',
      description:
        'Attending physician clinical evaluation, structured SOAP note generation, primary ICD-10 diagnostic coding, diagnostic order requisition, and e-prescription issuance.',
      sequenceOrder: 3,
      targetSlaMinutes: 25,
      requiredRoles: ['Attending Physician', 'Consultant', 'Medical Officer', 'Doctor', 'Physician', 'Admin'],
      allowedNextStages: ['DIAGNOSTICS_LAB_RAD', 'PHARMACY_DISPENSARY', 'BILLING_SETTLEMENT', 'DISCHARGE_OR_REFERRAL'],
      prerequisites: [
        { field: 'soapSubjective', type: 'STRING', required: true, description: 'SOAP Subjective clinical history' },
        { field: 'soapObjective', type: 'STRING', required: true, description: 'SOAP Objective examination findings' },
        { field: 'soapAssessment', type: 'STRING', required: true, description: 'SOAP Assessment & ICD-10 diagnoses' },
        { field: 'soapPlan', type: 'STRING', required: true, description: 'SOAP Care Plan & orders' },
        { field: 'primaryDiagnosis', type: 'STRING', required: true, description: 'Primary ICD-10 diagnostic code' },
      ],
      guards: [
        {
          id: 'guard-soap-signed',
          name: 'Physician Sign-Off',
          description: 'SOAP note and diagnostic plan must be digitally signed by a licensed practitioner.',
          guardType: 'SOAP_COMPLETED',
          evaluatorFnName: 'evaluateSoapSigned',
          blockingMessage: 'Clinical SOAP note requires attending physician signature before advancing.',
        },
      ],
    },

    DIAGNOSTICS_LAB_RAD: {
      id: 'DIAGNOSTICS_LAB_RAD',
      title: 'Point-of-Care Diagnostics & Imaging',
      description:
        'Phlebotomy specimen accessioning, pathology analyzer execution, radiology imaging verification, and automated HL7/FHIR diagnostic report integration.',
      sequenceOrder: 4,
      targetSlaMinutes: 40,
      requiredRoles: ['Lab Technician', 'Pathologist', 'Radiologist', 'Nurse', 'Admin'],
      allowedNextStages: ['CONSULTATION', 'PHARMACY_DISPENSARY', 'BILLING_SETTLEMENT'],
      prerequisites: [
        { field: 'labOrders', type: 'ARRAY', required: false, description: 'Ordered laboratory or radiology test items' },
      ],
      guards: [
        {
          id: 'guard-critical-results-acknowledged',
          name: 'Critical Panic Values Acknowledgment',
          description: 'Any panic critical diagnostic values must be acknowledged by attending clinician.',
          guardType: 'CUSTOM',
          evaluatorFnName: 'evaluatePanicValuesAcknowledged',
          blockingMessage: 'Critical diagnostic alert pending physician review.',
        },
      ],
    },

    PHARMACY_DISPENSARY: {
      id: 'PHARMACY_DISPENSARY',
      title: 'Pharmacy Dispensation & Medication Counseling',
      description:
        'Licensed pharmacist prescription review, drug-drug interaction and allergy cross-check, medication fulfillment, and patient dosage instructions.',
      sequenceOrder: 5,
      targetSlaMinutes: 15,
      requiredRoles: ['Pharmacist', 'Pharmacy Technician', 'Admin'],
      allowedNextStages: ['BILLING_SETTLEMENT', 'DISCHARGE_OR_REFERRAL'],
      prerequisites: [
        { field: 'medications', type: 'ARRAY', required: true, description: 'List of prescribed medications' },
      ],
      guards: [
        {
          id: 'guard-allergy-contraindication',
          name: 'Allergy & Contraindication Check',
          description: 'Verified no known active patient allergy contraindications with dispensed drugs.',
          guardType: 'CUSTOM',
          evaluatorFnName: 'evaluateAllergyContraindications',
          blockingMessage: 'Drug-allergy conflict flagged by safety engine.',
        },
      ],
    },

    BILLING_SETTLEMENT: {
      id: 'BILLING_SETTLEMENT',
      title: 'Split-Billing Reconciliation & Settlement',
      description:
        'Itemized charge reconciliation across consult, diagnostics, and medications; tariff discount & copay cap application; point-of-care payment collection; and claim generation.',
      sequenceOrder: 6,
      targetSlaMinutes: 10,
      requiredRoles: ['Billing Officer', 'Cashier', 'Finance Officer', 'Admin'],
      allowedNextStages: ['DISCHARGE_OR_REFERRAL'],
      prerequisites: [
        { field: 'invoiceId', type: 'STRING', required: true, description: 'Encounter invoice reference ID' },
        { field: 'totalGross', type: 'NUMBER', required: true, description: 'Total gross charges' },
        { field: 'patientPayable', type: 'NUMBER', required: true, description: 'Patient copay amount due' },
      ],
      guards: [
        {
          id: 'guard-billing-cleared',
          name: 'Payment Clearance',
          description: 'Encounter invoice must be settled or approved for institutional credit/insurance guarantee.',
          guardType: 'BILLING_CLEARED',
          evaluatorFnName: 'evaluateBillingCleared',
          blockingMessage: 'Patient balance remains unsettled without approved payment guarantee.',
        },
      ],
    },

    DISCHARGE_OR_REFERRAL: {
      id: 'DISCHARGE_OR_REFERRAL',
      title: 'Formal Encounter Discharge & Follow-up',
      description:
        'Discharge summary packaging, follow-up appointment booking, patient discharge counseling, and closing of clinical ambulatory encounter.',
      sequenceOrder: 7,
      targetSlaMinutes: 8,
      requiredRoles: ['Attending Physician', 'Registered Nurse', 'Care Coordinator', 'Admin'],
      allowedNextStages: [],
      prerequisites: [
        { field: 'dischargeSummary', type: 'STRING', required: true, description: 'Clinical exit summary' },
        { field: 'followUpInstructions', type: 'STRING', required: true, description: 'Patient care instructions' },
      ],
      guards: [
        {
          id: 'guard-news2-safe-discharge',
          name: 'Safe Discharge Vitals',
          description: 'Patient must not have an active uncontrolled critical NEWS2 score (>= 5) unless transferred to Inpatient.',
          guardType: 'NEWS2_CHECK',
          evaluatorFnName: 'evaluateSafeDischargeNews2',
          blockingMessage: 'High NEWS2 score (>= 5) prohibits routine home discharge without escalation.',
        },
      ],
      isTerminal: true,
    },
  },
};
