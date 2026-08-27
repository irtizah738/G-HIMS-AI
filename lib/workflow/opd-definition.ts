import { WorkflowDefinition } from '@/types/encounter-runtime';

/**
 * General OPD Runtime Workflow Cycle Definition
 * 5-Stage deterministic progression model
 */
export const OPD_WORKFLOW_DEFINITION: WorkflowDefinition = {
  id: 'wf_general_opd_v1',
  name: 'General OPD Clinical Cycle',
  type: 'OPD',
  stages: [
    {
      id: 'REGISTRATION',
      name: '1. Registration',
      order: 1,
      requiredRoles: ['receptionist', 'frontdesk_clerk', 'practitioner', 'admin'],
      slaTargetMinutes: 5,
      description: 'Front desk intake, MPI record lookup/creation, token assignment & outbox emission',
    },
    {
      id: 'TRIAGE',
      name: '2. Triage',
      order: 2,
      requiredRoles: ['nurse', 'triage_officer', 'practitioner'],
      slaTargetMinutes: 10,
      description: 'Vital signs entry, EWS/ESI early warning score calculation & live clinic routing',
    },
    {
      id: 'CONSULTATION',
      name: '3. Consultation',
      order: 3,
      requiredRoles: ['doctor', 'practitioner', 'consultant'],
      slaTargetMinutes: 20,
      description: 'Physician SOAP notes, lab orders, prescription entry & parallel track unlocking',
    },
    {
      id: 'DIAGNOSTICS_PHARMACY',
      name: '4. Diagnostics & Pharmacy',
      order: 4,
      requiredRoles: ['lab_technician', 'radiologist', 'pharmacist', 'practitioner'],
      slaTargetMinutes: 25,
      description: 'LIS/RIS HL7 v2 result sync and FEFO stock reservation & dispensing',
    },
    {
      id: 'BILLING_DISCHARGE',
      name: '5. Billing & Discharge',
      order: 5,
      requiredRoles: ['biller', 'cashier', 'finance_officer', 'admin'],
      slaTargetMinutes: 10,
      description: 'Copay split calculation, balanced GL journal ledger posting & encounter closure',
    },
  ],
};
