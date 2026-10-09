/**
 * G-HIMS Domain Manifest — ORC-6
 *
 * Authoritative map of all 56 G-HIMS operational domains to their:
 *   - Edge hydration surface
 *   - Required Firestore collections
 *   - Required command types (from command-schema-registry.ts)
 *   - Minimum required roles
 *   - 7-dimension qualification status scorecard
 *   - Evidence references (test files / CI SHA pins / sign-off IDs)
 *
 * IMPORTANT RULES:
 *   1. This manifest MUST NOT contain hardcoded percentages.
 *      Status is per-domain per-dimension, derived from actual test evidence.
 *   2. Every entry added here requires a corresponding test in ORC-8.
 *   3. A domain is RELEASED only when all 7 dimensions are green AND clinical,
 *      security, and financial sign-off is recorded in evidenceRefs.
 *   4. ORC fixes already merged are reflected below with their gate number.
 *
 * Baseline: main + PR #132 merged + ORC-1 through ORC-5 applied
 * Verified domain count: 56 (spec stated "52 enterprise domains"; actual
 * enumeration from command-schema-registry.ts + app/api routes yields 56).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeHydrationSurface =
  | 'PATIENT_REGISTRY'
  | 'CLINICAL_ENCOUNTER'
  | 'DIAGNOSTICS'
  | 'PHARMACY'
  | 'FINANCE'
  | 'HCM'
  | 'ADMIN_OPERATIONS'
  | 'INTEROP_DEVICE';

export type ImplementationStatus = 'PRESENT' | 'PARTIAL' | 'MISSING';
export type AuthorizationStatus  = 'TESTED'  | 'UNTESTED' | 'FAILING';
export type HydrationStatus      =
  | 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNHYDRATED'
  | 'DENIED'  | 'FAILED' | 'NOT_APPLICABLE';
export type RuntimeStatus  = 'QUALIFIED' | 'UNQUALIFIED';
export type OfflineStatus  = 'QUALIFIED' | 'UNQUALIFIED' | 'NOT_APPLICABLE';
export type StagingStatus  = 'PASSED' | 'FAILED' | 'PENDING';
export type ReleaseStatus  = 'SIGNED_OFF' | 'PENDING';

export interface DomainQualificationStatus {
  /** Backend command handlers, service methods, and API routes are present. */
  implementation: ImplementationStatus;
  /** Authorization pipeline tests for all listed roles are passing. */
  authorization: AuthorizationStatus;
  /** Edge snapshot includes all required collections for authorized roles. */
  hydration: HydrationStatus;
  /** Full command -> event -> projection round-trip passes in emulator. */
  runtime: RuntimeStatus;
  /** Offline capture -> sync -> reconciliation passes in emulator. */
  offline: OfflineStatus;
  /** Staging run with 2-tenant, 2-facility, cross-role fixture passed. */
  staging: StagingStatus;
  /** Clinical / security / financial sign-off recorded. */
  release: ReleaseStatus;
}

export interface DomainManifestEntry {
  /** Stable identifier matching the UI domain registry key. */
  domainId: string;
  /** Human-readable label. */
  label: string;
  /** Owning API area (maps to app/api/<area>). */
  apiArea: string;
  /** Edge hydration surface. Null = server-only query, no offline hydration. */
  hydrationSurface: EdgeHydrationSurface | null;
  /** Firestore sub-collections required by this domain (tenant-scoped paths). */
  requiredCollections: string[];
  /** Command types registered in command-schema-registry.ts. Empty = read-only. */
  requiredCommands: string[];
  /** Minimum role set that must pass AuthorizationPipeline.evaluate(). */
  requiredRoles: string[];
  /** ORC gate that fixed / introduced this domain entry. */
  orcGate: string;
  qualificationStatus: DomainQualificationStatus;
  /** Immutable evidence pointers: test file paths, CI run IDs, sign-off refs. */
  evidenceRefs: string[];
}

// ---------------------------------------------------------------------------
// Shared role constants (DRY)
// ---------------------------------------------------------------------------

const CLINICAL_ROLES   = ['DOCTOR', 'CONSULTANT', 'NURSE', 'ATTENDING_PHYSICIAN'];
const FRONT_DESK_ROLES = ['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'];
const BILLING_ROLES    = ['BILLING_CLERK', 'BILLING_ADMIN', 'CASHIER', 'BILLING_CASHIER', 'FINANCE_MANAGER'];
const ER_ROLES         = ['EMERGENCY_NURSE', 'EMERGENCY_DOCTOR', 'ER_NURSE', 'TRIAGE_NURSE', 'ER_DOCTOR'];
const HCM_ROLES        = ['HR_MANAGER', 'HR_OFFICER', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN'];
const ADMIN_ROLES      = ['SYSTEM_ADMIN', 'ADMINISTRATOR', 'ADMIN'];
const FINANCE_ROLES    = ['ACCOUNTANT', 'FINANCE_MANAGER', 'TREASURY_MANAGER', 'AUDITOR'];
const PHARMACY_ROLES   = ['PHARMACIST', 'PHARMACY_TECH'];
const LAB_ROLES        = ['LAB_TECH', 'LAB_MANAGER', 'PATHOLOGIST'];
const RADIOLOGY_ROLES  = ['RADIOLOGIST', 'RADIOLOGY_TECH'];

// ---------------------------------------------------------------------------
// Pending qualification template (reused for unqualified domains)
// ---------------------------------------------------------------------------

const PENDING: DomainQualificationStatus = {
  implementation: 'PRESENT',
  authorization:  'UNTESTED',
  hydration:      'UNHYDRATED',
  runtime:        'UNQUALIFIED',
  offline:        'UNQUALIFIED',
  staging:        'PENDING',
  release:        'PENDING',
};

// ---------------------------------------------------------------------------
// DOMAIN_MANIFEST — 52 entries
// ---------------------------------------------------------------------------

export const DOMAIN_MANIFEST: DomainManifestEntry[] = [

  // 1. Patient Management & MPI -----------------------------------------------
  {
    domainId: 'patient-registration',
    label: 'Patient Registration & MPI',
    apiArea: 'clinical',
    hydrationSurface: 'PATIENT_REGISTRY',
    requiredCollections: ['patients', 'patientIdentityIndex'],
    requiredCommands: [],
    requiredRoles: [...FRONT_DESK_ROLES, ...CLINICAL_ROLES, ...ADMIN_ROLES],
    orcGate: 'ORC-3A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },
  {
    domainId: 'patient-identity-index',
    label: 'Master Patient Index (MPI)',
    apiArea: 'clinical',
    hydrationSurface: 'PATIENT_REGISTRY',
    requiredCollections: ['patientIdentityIndex'],
    requiredCommands: [],
    requiredRoles: [...FRONT_DESK_ROLES, ...ADMIN_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'patient360',
    label: 'Patient 360 Longitudinal Intelligence',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['patients', 'encounters', 'encounterEvents', 'timelineProjections'],
    requiredCommands: ['RecordConsultantPatientReviewCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'ORC-4A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },

  // 2. OPD -----------------------------------------------
  {
    domainId: 'opd-encounter',
    label: 'OPD Encounter Lifecycle',
    apiArea: 'opd',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'opd_queue', 'patients'],
    requiredCommands: ['CreateOpdEncounterCommand', 'CommitEncounterDispositionCommand'],
    requiredRoles: [...FRONT_DESK_ROLES, ...CLINICAL_ROLES],
    orcGate: 'ORC-3A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-3A: facilityId now written to encounter state; facility-scoped queries work'],
  },
  {
    domainId: 'opd-appointment',
    label: 'OPD Appointment Scheduling',
    apiArea: 'opd',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['opdAppointments', 'patients'],
    requiredCommands: [
      'BookOpdAppointmentCommand', 'CancelOpdAppointmentCommand',
      'RescheduleOpdAppointmentCommand', 'CheckInOpdAppointmentCommand',
      'MarkOpdAppointmentNoShowCommand',
    ],
    requiredRoles: [...FRONT_DESK_ROLES, ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'opd-queue',
    label: 'OPD Queue Management',
    apiArea: 'opd',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['opd_queue'],
    requiredCommands: ['UpdateOpdQueueStatusCommand', 'StartOpdServiceCommand'],
    requiredRoles: [...FRONT_DESK_ROLES, ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'opd-waitlist',
    label: 'OPD Waitlist',
    apiArea: 'opd',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['opdWaitlist'],
    requiredCommands: [
      'AddOpdWaitlistEntryCommand', 'OfferOpdWaitlistSlotCommand',
      'AcceptOpdWaitlistOfferCommand', 'CancelOpdWaitlistEntryCommand',
    ],
    requiredRoles: [...FRONT_DESK_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'opd-billing',
    label: 'OPD Billing & Financial Clearance',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['invoices', 'arOpenItems', 'paymentTransactions'],
    requiredCommands: [
      'ConfigureOpdConsultationBillingCommand',
      'CreateOpdConsultationInvoiceCommand',
      'RecordCashReceiptCommand',
      'ReconcileOpdBillingCommand',
    ],
    requiredRoles: [...BILLING_ROLES],
    orcGate: 'ORC-5A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'PARTIAL',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-5A: cash receipt atomically advances encounter to BILLING_SETTLEMENT'],
  },

  // 3. Emergency Department -----------------------------------------------
  {
    domainId: 'er-encounter',
    label: 'Emergency Department — Direct Admission',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'beds', 'rooms', 'resourceReservations', 'patients'],
    requiredCommands: ['CreateEncounterCommand'],
    requiredRoles: [...ER_ROLES, ...CLINICAL_ROLES],
    orcGate: 'ORC-3A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [
      'ORC-3A: facilityId written to encounter state',
      'ORC-1B: ER roles now hydrate beds, rooms, resourceReservations',
    ],
  },
  {
    domainId: 'er-triage',
    label: 'Emergency Triage & Acuity',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'beds', 'rooms'],
    requiredCommands: [],
    requiredRoles: [...ER_ROLES],
    orcGate: 'ORC-1B',
    qualificationStatus: {
      implementation: 'PARTIAL', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },
  {
    domainId: 'er-telemetry',
    label: 'Emergency Pre-Arrival Telemetry',
    apiArea: 'interop',
    hydrationSurface: 'INTEROP_DEVICE',
    requiredCollections: ['telemetryDevices'],
    requiredCommands: ['AcknowledgeEmergencyPrearrivalTelemetryCommand'],
    requiredRoles: [...ER_ROLES],
    orcGate: 'baseline',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },

  // 4. Inpatient (IPD) -----------------------------------------------
  {
    domainId: 'ipd-admission',
    label: 'Inpatient Admission & Bed Assignment',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'beds', 'rooms', 'patients'],
    requiredCommands: ['AdmitPatientToInpatientCareCommand'],
    requiredRoles: [...CLINICAL_ROLES, ...FRONT_DESK_ROLES],
    orcGate: 'ORC-1B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-1B: clinical roles now receive rooms collection'],
  },
  {
    domainId: 'ipd-orders',
    label: 'Inpatient Clinical Orders',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'orders'],
    requiredCommands: ['PlaceInpatientOrderCommand', 'ResolveInpatientOrderCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'ipd-nursing-care-plan',
    label: 'Nursing Care Plan',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'clinicalTasks'],
    requiredCommands: ['CreateNursingCarePlanCommand', 'UpdateNursingCarePlanInterventionCommand'],
    requiredRoles: ['NURSE', ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'ipd-bed-transfer',
    label: 'Inpatient Bed Transfer',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'beds', 'rooms'],
    requiredCommands: ['TransferInpatientBedCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'ORC-1B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },

  // 5. Clinical Documentation -----------------------------------------------
  {
    domainId: 'clinical-notes',
    label: 'Clinical Notes & SOAP Documentation',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'encounterEvidence'],
    requiredCommands: [
      'SignClinicalNoteCommand', 'ReviewClinicalDraftCommand',
      'ApproveClinicalDraftCommand', 'SignClinicalDraftCommand', 'RejectClinicalDraftCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'record-vitals',
    label: 'Vital Signs Recording & NEWS2',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'encounterEvidence'],
    requiredCommands: ['RecordVitalsCommand'],
    requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT'],
    orcGate: 'ORC-2A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [
      'ORC-2A: RECORD_VITALS added to doctor/physician role-derived privileges',
      'ORC-4A: news2Status CALCULATED|INCOMPLETE_INPUTS now committed with every record',
    ],
  },
  {
    domainId: 'clinical-conditions',
    label: 'Problem List & Encounter Diagnoses',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'encounterEvidence'],
    requiredCommands: ['RecordClinicalConditionCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'clinical-allergies',
    label: 'Allergy & Intolerance Registry',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'encounterEvidence'],
    requiredCommands: ['RecordClinicalAllergyCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'clinical-handoff',
    label: 'Clinical Handoff & I-PASS',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'clinicalTasks'],
    requiredCommands: ['CreateClinicalHandoffCommand', 'AcceptClinicalHandoffCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'medication-reconciliation',
    label: 'Medication Reconciliation',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'prescriptions'],
    requiredCommands: ['CompleteMedicationReconciliationCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 6. Diagnostics -----------------------------------------------
  {
    domainId: 'lab-orders',
    label: 'Laboratory Orders',
    apiArea: 'clinical',
    hydrationSurface: 'DIAGNOSTICS',
    requiredCollections: ['orders', 'labResults'],
    requiredCommands: ['PlaceDiagnosticOrderCommand', 'AdvanceDiagnosticWorklistCommand'],
    requiredRoles: [...CLINICAL_ROLES, ...LAB_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'lab-results',
    label: 'Lab Results & Critical Value Acknowledgement',
    apiArea: 'clinical',
    hydrationSurface: 'DIAGNOSTICS',
    requiredCollections: ['labResults'],
    requiredCommands: ['RecordDiagnosticResultCommand', 'AcknowledgeCriticalDiagnosticResultCommand'],
    requiredRoles: [...LAB_ROLES, ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'radiology-orders',
    label: 'Radiology Orders & RIS',
    apiArea: 'clinical',
    hydrationSurface: 'DIAGNOSTICS',
    requiredCollections: ['orders', 'radiologyResults'],
    requiredCommands: ['PlaceDiagnosticOrderCommand'],
    requiredRoles: [...CLINICAL_ROLES, ...RADIOLOGY_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'radiology-results',
    label: 'Radiology Results & PACS',
    apiArea: 'clinical',
    hydrationSurface: 'DIAGNOSTICS',
    requiredCollections: ['radiologyResults'],
    requiredCommands: ['RecordDiagnosticResultCommand'],
    requiredRoles: [...RADIOLOGY_ROLES, ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 7. Pharmacy -----------------------------------------------
  {
    domainId: 'pharmacy-dispense',
    label: 'Pharmacy Dispensing',
    apiArea: 'pharmacy',
    hydrationSurface: 'PHARMACY',
    requiredCollections: ['prescriptions'],
    requiredCommands: ['DispensePrescriptionCommand'],
    requiredRoles: [...PHARMACY_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'emar',
    label: 'eMAR — Electronic Medication Administration',
    apiArea: 'clinical',
    hydrationSurface: 'PHARMACY',
    requiredCollections: ['prescriptions', 'encounters'],
    requiredCommands: [
      'ScheduleMedicationAdministrationCommand',
      'AdministerScheduledMedicationCommand',
      'RecordMedicationAdministrationCommand',
    ],
    requiredRoles: ['NURSE', ...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 8. Consultation & Referral -----------------------------------------------
  {
    domainId: 'consultation-request',
    label: 'Consultation Request & Routing',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'clinicalTasks', 'clinicalPrivileges', 'rosterAssignments'],
    requiredCommands: [
      'RequestConsultationCommand', 'AcknowledgeConsultationCommand',
      'AcceptConsultationCommand', 'CompleteConsultationCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'ORC-2B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'PARTIAL',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-2B: assertConsultantEligibility() predicate added; listEligible() facility-scoped'],
  },
  {
    domainId: 'consultant-directory',
    label: 'Consultant Directory & Availability',
    apiArea: 'clinical',
    hydrationSurface: null,
    requiredCollections: ['employees', 'clinicalCredentials', 'clinicalPrivileges', 'rosterAssignments'],
    requiredCommands: [],
    requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN', 'SYSTEM_ADMIN'],
    orcGate: 'ORC-2B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-2B: cross-facility directory exposure blocked by facilityId scope filter'],
  },

  // 9. Disease Intake & AI Copilot -----------------------------------------------
  {
    domainId: 'disease-intake',
    label: 'AI Disease Intake & Clinical Decision Support',
    apiArea: 'ai',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: ['SaveDiseaseIntakeArtifactCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'discharge-readiness',
    label: 'Discharge Readiness Evaluation',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: ['RecordDischargeReadinessReviewCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'clinical-deterioration',
    label: 'Clinical Deterioration Detection',
    apiArea: 'ai',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters', 'encounterEvidence'],
    requiredCommands: ['AcknowledgeClinicalEscalationCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'ORC-4A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'UNQUALIFIED', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-4A: news2Status INCOMPLETE_INPUTS surfaces to deterioration engine'],
  },

  // 10. Specialized Clinical Programs -----------------------------------------------
  {
    domainId: 'dialysis',
    label: 'Dialysis Program Management',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: [
      'CreateDialysisOrderCommand', 'StartDialysisSessionCommand', 'CompleteDialysisSessionCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'obstetrics',
    label: 'Obstetrics & Labour Ward (Partogram)',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: [
      'CreateObstetricEpisodeCommand', 'RecordPartogramObservationCommand',
      'TransitionObstetricEpisodeCommand', 'RecordDeliveryOutcomeCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'oncology',
    label: 'Oncology & Tumor Board',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: [
      'OpenOncologyCaseCommand', 'RecordTumorBoardRecommendationCommand',
      'ApproveOncologyRegimenCommand', 'LinkChemotherapyAdministrationCommand',
      'RecordOncologyToxicityCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'rehabilitation',
    label: 'Rehabilitation & Physiotherapy',
    apiArea: 'clinical',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: [
      'CreateRehabilitationPlanCommand', 'RecordRehabilitationSessionCommand',
      'UpdateRehabilitationGoalCommand', 'CompleteRehabilitationPlanCommand',
    ],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 11. Finance -----------------------------------------------
  {
    domainId: 'general-ledger',
    label: 'General Ledger & Journal Entries',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['journalEntries', 'journalLines', 'accounts'],
    requiredCommands: [],
    requiredRoles: [...FINANCE_ROLES, ...ADMIN_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'accounts-receivable',
    label: 'Accounts Receivable & Open Items',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['arOpenItems', 'invoices', 'patientInvoices'],
    requiredCommands: [],
    requiredRoles: [...BILLING_ROLES, ...FINANCE_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'cash-receipts',
    label: 'Cash Receipts & Payment Processing',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['paymentTransactions', 'arOpenItems', 'invoices'],
    requiredCommands: ['RecordCashReceiptCommand'],
    requiredRoles: [...BILLING_ROLES],
    orcGate: 'ORC-5A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'PARTIAL',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [
      'ORC-5A: encounter currentStage atomically advanced to BILLING_SETTLEMENT on full settlement',
      'ORC-5A: billingSettlementAdvanced flag in outbox event for projectors',
    ],
  },
  {
    domainId: 'billing-reconciliation',
    label: 'Billing Reconciliation & Financial Clearance',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['invoices', 'arOpenItems', 'encounters'],
    requiredCommands: ['ReconcileOpdBillingCommand'],
    requiredRoles: [...BILLING_ROLES, ...FINANCE_ROLES],
    orcGate: 'ORC-5A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'PARTIAL',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-5A: BILLING_SETTLEMENT stage pre-condition now satisfied after cash receipt'],
  },
  {
    domainId: 'finance-period',
    label: 'Finance Period & Posting Control',
    apiArea: 'finance',
    hydrationSurface: 'FINANCE',
    requiredCollections: ['financePeriods', 'accounts'],
    requiredCommands: [],
    requiredRoles: [...FINANCE_ROLES, ...ADMIN_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 12. HCM -----------------------------------------------
  {
    domainId: 'employee-master',
    label: 'Employee Master & HCM Identity',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['employees', 'employeeIdentityIndex'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES],
    orcGate: 'PR-133',
    qualificationStatus: { ...PENDING },
    evidenceRefs: ['PR #133 open draft — HCM identity correction pending merge'],
  },
  {
    domainId: 'clinical-credentials',
    label: 'Clinical Credentials & Licence Verification',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['clinicalCredentials', 'employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES, ...ADMIN_ROLES],
    orcGate: 'ORC-2B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'UNHYDRATED',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-2B: credentialsValid() used in assertConsultantEligibility()'],
  },
  {
    domainId: 'clinical-privileges',
    label: 'Clinical Privileges & Facility Scope',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['clinicalPrivileges', 'employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES, ...ADMIN_ROLES],
    orcGate: 'ORC-2B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'UNHYDRATED',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-2B: privilege.facilityId now required; cross-facility transfer blocked'],
  },
  {
    domainId: 'roster-scheduling',
    label: 'Staff Roster & Shift Scheduling',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['rosterAssignments', 'employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'attendance',
    label: 'Attendance & Time Tracking',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['attendanceRecords', 'employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'leave-management',
    label: 'Leave Management & Balances',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'payroll',
    label: 'Payroll Processing & Results',
    apiArea: 'hcm',
    hydrationSurface: 'HCM',
    requiredCollections: ['payrollResults', 'employees'],
    requiredCommands: [],
    requiredRoles: [...HCM_ROLES, ...FINANCE_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },

  // 13. Admin & Facility Ops -----------------------------------------------
  {
    domainId: 'facility-management',
    label: 'Facility, Beds & Room Management',
    apiArea: 'admin',
    hydrationSurface: 'ADMIN_OPERATIONS',
    requiredCollections: ['beds', 'rooms'],
    requiredCommands: [],
    requiredRoles: [...ADMIN_ROLES],
    orcGate: 'ORC-1B',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: ['ORC-1B: beds and rooms served to clinical + front-desk + ER roles'],
  },
  {
    domainId: 'tenant-hydration',
    label: 'Tenant Hydration & Edge Snapshot',
    apiArea: 'offline',
    hydrationSurface: null,
    requiredCollections: [],
    requiredCommands: [],
    requiredRoles: [],
    orcGate: 'ORC-1A',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'CURRENT',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [
      'ORC-1A: SWITCHING/VERIFYING state machine blocks commands during tenant switch',
      'ORC-1A: prior tenant context restored on switch failure',
      'ORC-1C: DENIED freshness state surfaces auth failures instead of STALE',
    ],
  },
  {
    domainId: 'audit-log',
    label: 'Audit Log & Immutable Event Store',
    apiArea: 'audit',
    hydrationSurface: null,
    requiredCollections: ['auditLogs', 'outbox'],
    requiredCommands: [],
    requiredRoles: [...ADMIN_ROLES, ...FINANCE_ROLES],
    orcGate: 'baseline',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },
  {
    domainId: 'outbox-dispatcher',
    label: 'Transactional Outbox & Pub/Sub Dispatch',
    apiArea: 'outbox',
    hydrationSurface: null,
    requiredCollections: ['outbox'],
    requiredCommands: [],
    requiredRoles: [...ADMIN_ROLES],
    orcGate: 'baseline',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },
  {
    domainId: 'notifications',
    label: 'Clinical & Administrative Notifications',
    apiArea: 'notifications',
    hydrationSurface: null,
    requiredCollections: [],
    requiredCommands: [],
    requiredRoles: [],
    orcGate: 'baseline',
    qualificationStatus: {
      ...PENDING, hydration: 'NOT_APPLICABLE', offline: 'NOT_APPLICABLE',
    },
    evidenceRefs: [],
  },

  // 14. Interop & Telehealth -----------------------------------------------
  {
    domainId: 'telehealth',
    label: 'Telehealth Consultations',
    apiArea: 'telehealth',
    hydrationSurface: 'CLINICAL_ENCOUNTER',
    requiredCollections: ['encounters'],
    requiredCommands: ['CreateEncounterCommand'],
    requiredRoles: [...CLINICAL_ROLES],
    orcGate: 'baseline',
    qualificationStatus: { ...PENDING },
    evidenceRefs: [],
  },
  {
    domainId: 'device-interop',
    label: 'Biomedical Device Integration',
    apiArea: 'interop',
    hydrationSurface: 'INTEROP_DEVICE',
    requiredCollections: ['telemetryDevices'],
    requiredCommands: [],
    requiredRoles: [...ADMIN_ROLES],
    orcGate: 'baseline',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [],
  },
  {
    domainId: 'mock-patient-retirement',
    label: 'Confirmed Mock Patient Retirement',
    apiArea: 'admin',
    hydrationSurface: null,
    requiredCollections: ['patients'],
    requiredCommands: ['RetireConfirmedMockPatientCommand'],
    requiredRoles: [...ADMIN_ROLES],
    orcGate: 'MOCK_CLEANUP_FIX',
    qualificationStatus: {
      implementation: 'PRESENT', authorization: 'UNTESTED', hydration: 'NOT_APPLICABLE',
      runtime: 'UNQUALIFIED', offline: 'NOT_APPLICABLE', staging: 'PENDING', release: 'PENDING',
    },
    evidenceRefs: [
      '.env: GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP=true and GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT set',
    ],
  },
];

// ---------------------------------------------------------------------------
// Utilities — computed from manifest, never hardcoded
// ---------------------------------------------------------------------------

/** Total declared domains. */
export const TOTAL_DOMAINS = DOMAIN_MANIFEST.length;

/** Domains where release === SIGNED_OFF. */
export function countReleasedDomains(): number {
  return DOMAIN_MANIFEST.filter((d) => d.qualificationStatus.release === 'SIGNED_OFF').length;
}

/** Domains blocking release: MISSING implementation, FAILING auth, or FAILED staging. */
export function listBlockingDomains(): DomainManifestEntry[] {
  return DOMAIN_MANIFEST.filter(
    (d) =>
      d.qualificationStatus.implementation === 'MISSING' ||
      d.qualificationStatus.authorization   === 'FAILING' ||
      d.qualificationStatus.staging         === 'FAILED'
  );
}

/** Domains with ORC fixes applied that have not yet been staging-tested. */
export function listOrcPendingValidation(): DomainManifestEntry[] {
  return DOMAIN_MANIFEST.filter(
    (d) => d.orcGate.startsWith('ORC-') && d.qualificationStatus.staging === 'PENDING'
  );
}

/**
 * Asserts the manifest contains exactly the expected number of domains.
 * Call this in a CI smoke test to prevent silent manifest drift.
 */
export function assertDomainCount(expected: number): void {
  if (DOMAIN_MANIFEST.length !== expected) {
    throw new Error(
      `Domain manifest has ${DOMAIN_MANIFEST.length} domains; expected ${expected}. ` +
      'Update the manifest or the expected count.'
    );
  }
}
