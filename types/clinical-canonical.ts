/**
 * G-HIMS canonical clinical fact model.
 *
 * These types are the internal longitudinal semantics used by Patient 360.
 * They are not raw FHIR resources; interoperability adapters map them to/from
 * FHIR/HL7 without making external wire formats the database authority.
 */

export type CanonicalCodingSystem =
  | 'LOINC'
  | 'SNOMED_CT'
  | 'ICD10'
  | 'UCUM'
  | 'RXNORM'
  | 'LOCAL';

export interface Coding {
  system: CanonicalCodingSystem | string;
  code: string;
  display: string;
  version?: string;
  userSelected?: boolean;
}

export interface CodeableConcept {
  codings: Coding[];
  text?: string;
}

export interface Quantity {
  value: number;
  unit: string;
  system?: 'UCUM' | string;
  code?: string;
}

export interface ReferenceRange {
  low?: Quantity;
  high?: Quantity;
  text?: string;
}

export type ClinicalVerificationStatus =
  | 'UNCONFIRMED'
  | 'PROVISIONAL'
  | 'DIFFERENTIAL'
  | 'CONFIRMED'
  | 'REFUTED'
  | 'ENTERED_IN_ERROR';

export type ClinicalLifecycleStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'RESOLVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

export type KnownStatus =
  | 'KNOWN'
  | 'KNOWN_NONE'
  | 'UNKNOWN'
  | 'NOT_ASSESSED'
  | 'PATIENT_UNABLE_TO_REPORT';

export interface ClinicalProvenance {
  provenanceId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  sourceEvidenceId: string;
  sourceType:
    | 'CLINICIAN'
    | 'NURSE'
    | 'PHARMACIST'
    | 'LAB_SYSTEM'
    | 'RADIOLOGY_SYSTEM'
    | 'DEVICE'
    | 'PATIENT_REPORTED'
    | 'EXTERNAL_FHIR'
    | 'EXTERNAL_HL7'
    | 'AI_EXTRACTED'
    | 'SYSTEM_DERIVED';
  sourceSystem?: string;
  recordedBy: string;
  recordedAt: number;
  effectiveAt?: number;
  verifiedBy?: string;
  verifiedAt?: number;
  aiDraftId?: string;
  confidence?: number;
  correctedFromId?: string;
  supersedesId?: string;
  integrityHash?: string;
}

export interface ClinicalFactBase {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  sourceEvidenceId: string;
  provenance: ClinicalProvenance;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export type ObservationValue =
  | { valueType: 'QUANTITY'; quantity: Quantity }
  | { valueType: 'STRING'; value: string }
  | { valueType: 'CODED'; value: CodeableConcept }
  | { valueType: 'BOOLEAN'; value: boolean }
  | {
      valueType: 'COMPONENTS';
      components: Array<{
        code: CodeableConcept;
        value: Exclude<ObservationValue, { valueType: 'COMPONENTS' }>;
      }>;
    };

export interface ClinicalObservation extends ClinicalFactBase {
  observationId: string;
  category:
    | 'VITAL_SIGNS'
    | 'LABORATORY'
    | 'IMAGING'
    | 'EXAM'
    | 'SOCIAL_HISTORY'
    | 'ASSESSMENT'
    | 'DEVICE'
    | 'OTHER';
  code: CodeableConcept;
  value: ObservationValue;
  effectiveAt: number;
  issuedAt?: number;
  interpretation?: CodeableConcept[];
  referenceRange?: ReferenceRange[];
  status: 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  method?: CodeableConcept;
  specimenId?: string;
  deviceId?: string;
  performerIds: string[];
}

export interface ClinicalCondition extends ClinicalFactBase {
  conditionId: string;
  code: CodeableConcept;
  category: 'PROBLEM_LIST' | 'ENCOUNTER_DIAGNOSIS' | 'CHRONIC' | 'ACUTE' | 'OTHER';
  clinicalStatus: ClinicalLifecycleStatus;
  verificationStatus: ClinicalVerificationStatus;
  severity?: CodeableConcept;
  onsetAt?: number;
  abatementAt?: number;
  recordedAt: number;
  recordedBy: string;
  assertedBy?: string;
}

export interface AllergyReaction {
  manifestation: CodeableConcept[];
  severity?: 'MILD' | 'MODERATE' | 'SEVERE';
  onsetAt?: number;
  description?: string;
}

export interface ClinicalAllergy extends ClinicalFactBase {
  allergyId: string;
  substance: CodeableConcept;
  type: 'ALLERGY' | 'INTOLERANCE';
  category: 'FOOD' | 'MEDICATION' | 'ENVIRONMENT' | 'BIOLOGIC' | 'OTHER';
  clinicalStatus: 'ACTIVE' | 'INACTIVE' | 'RESOLVED';
  verificationStatus: ClinicalVerificationStatus;
  criticality: 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';
  reactions: AllergyReaction[];
  onsetAt?: number;
  recordedAt: number;
  recorderId: string;
  asserterId?: string;
}

export interface MedicationOrder extends ClinicalFactBase {
  medicationOrderId: string;
  medication: CodeableConcept;
  status: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'STOPPED' | 'ENTERED_IN_ERROR';
  intent: 'ORDER';
  dosageText: string;
  route?: CodeableConcept;
  frequency?: string;
  durationDays?: number;
  quantity?: Quantity;
  instructions?: string;
  prescribedBy: string;
  authoredAt: number;
}

export interface MedicationDispense extends ClinicalFactBase {
  medicationDispenseId: string;
  medicationOrderId: string;
  medication: CodeableConcept;
  status: 'PREPARATION' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  quantity: Quantity;
  batchNumber?: string;
  expiryDate?: string;
  dispensedBy: string;
  dispensedAt: number;
}

export interface MedicationAdministration extends ClinicalFactBase {
  medicationAdministrationId: string;
  medicationOrderId?: string;
  medication: CodeableConcept;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'NOT_DONE' | 'STOPPED' | 'ENTERED_IN_ERROR';
  dose?: Quantity;
  doseText?: string;
  route?: CodeableConcept;
  administeredBy: string;
  administeredAt: number;
  notDoneReason?: string;
}

export interface ClinicalProcedure extends ClinicalFactBase {
  procedureId: string;
  code: CodeableConcept;
  status: 'PREPARATION' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_DONE' | 'STOPPED' | 'ENTERED_IN_ERROR';
  performedAt?: number;
  performerIds: string[];
  bodySite?: CodeableConcept[];
  outcome?: CodeableConcept;
  notes?: string;
}

export interface DiagnosticOrder extends ClinicalFactBase {
  diagnosticOrderId: string;
  service: CodeableConcept;
  orderType: 'LAB' | 'RADIOLOGY' | 'PROCEDURE';
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  status: 'PLACED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  clinicalIndication?: CodeableConcept | string;
  orderedBy: string;
  orderedAt: number;
}

export interface DiagnosticReport extends ClinicalFactBase {
  diagnosticReportId: string;
  orderId?: string;
  code: CodeableConcept;
  category: 'LAB' | 'RADIOLOGY' | 'PATHOLOGY' | 'OTHER';
  status: 'REGISTERED' | 'PARTIAL' | 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  resultObservationIds: string[];
  conclusion?: string;
  conclusionCodes?: CodeableConcept[];
  issuedAt?: number;
  verifiedBy?: string;
  verifiedAt?: number;
}

export interface ClinicalDocument extends ClinicalFactBase {
  clinicalDocumentId: string;
  documentType: 'SOAP' | 'PROGRESS' | 'CONSULTATION' | 'DISCHARGE' | 'NURSING' | 'OTHER';
  status: 'FINAL' | 'AMENDED' | 'ENTERED_IN_ERROR';
  title?: string;
  content: string;
  structuredData?: Record<string, unknown>;
  signedBy: string;
  signedAt: number;
  sourceDraftId?: string;
}

export interface CarePlanActivity {
  activityId: string;
  description: string;
  status: 'NOT_STARTED' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  scheduledAt?: number;
  completedAt?: number;
  responsibleRole?: string;
}

export interface CarePlan extends ClinicalFactBase {
  carePlanId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  intent: 'PLAN';
  title: string;
  description?: string;
  addressesConditionIds: string[];
  activities: CarePlanActivity[];
  authoredBy: string;
  authoredAt: number;
}

export interface PatientClinicalKnowledgeStatus {
  patientId: string;
  tenantId: string;
  allergyStatus: KnownStatus;
  medicationStatus: KnownStatus;
  problemListStatus: KnownStatus;
  lastMedicationReconciliationAt?: number;
  lastProblemListReviewAt?: number;
  lastAllergyReviewAt?: number;
  updatedAt: number;
}
