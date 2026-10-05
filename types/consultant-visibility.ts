import type { Patient360EncounterSummary } from '@/types/patient360-projection';

export type ClinicalCareSetting = 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH' | 'UNKNOWN';

export type ConsultantRelationship =
  | 'ATTENDING'
  | 'PRIMARY_CONSULTANT'
  | 'CONSULTING'
  | 'COVERING'
  | 'ON_CALL'
  | 'REVIEWER';

export type ConsultantChangeSeverity =
  | 'INFORMATION'
  | 'REVIEW_REQUIRED'
  | 'ACTION_REQUIRED'
  | 'CRITICAL_REVIEW_REQUIRED';

export type ConsultantChangeCategory =
  | 'CLINICAL_CONDITION'
  | 'VITALS'
  | 'DIAGNOSTICS'
  | 'MEDICATIONS'
  | 'ORDERS'
  | 'PROCEDURES'
  | 'NURSING'
  | 'CONSULTATIONS'
  | 'HANDOFFS'
  | 'DISPOSITION'
  | 'DISCHARGE'
  | 'DOCUMENTS'
  | 'DATA_QUALITY'
  | 'CARE_CONTEXT'
  | 'OTHER';

export interface ConsultantReviewCheckpoint {
  checkpointId: string;
  tenantId: string;
  consultantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  reviewedAt: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  lastEventId?: string;
  lastEventRecordedAt?: number;
  reviewedChangeIds: string[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConsultantChangeItem {
  changeId: string;
  patientId: string;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  eventId: string;
  eventType: string;
  occurredAt: number;
  recordedAt?: number;
  category: ConsultantChangeCategory;
  severity: ConsultantChangeSeverity;
  statement: string;
  sourceEventIds: string[];
  requiresAcknowledgment: boolean;
  requiresAction: boolean;
}

export type ClinicalOpenItemCategory =
  | 'DIAGNOSTIC'
  | 'DETERIORATION'
  | 'DISCHARGE'
  | 'DATA_QUALITY'
  | 'CONSULTATION'
  | 'HANDOFF'
  | 'MEDICATION'
  | 'ORDER'
  | 'FOLLOW_UP'
  | 'OTHER';

export interface ClinicalOpenItemProjection {
  openItemId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  category: ClinicalOpenItemCategory;
  description: string;
  clinicalPriority: ConsultantChangeSeverity;
  ownerType: 'CONSULTANT' | 'CARE_TEAM' | 'DEPARTMENT' | 'ROLE';
  ownerId?: string;
  ownerDepartmentId?: string;
  ownerRole?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  resolutionMode?: 'SOURCE_STATE' | 'MANUAL';
  createdAt: number;
  dueAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  acknowledgementNote?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionReason?: string;
  resolutionRef?: string;
  generatedBy?: string;
  lastSourceEventId?: string;
  updatedAt?: number;
  sourceRefs: string[];
}

export interface ConsultantPatientStateProjection {
  tenantId: string;
  consultantId: string;
  patientId: string;
  encounter?: Patient360EncounterSummary;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  relationship: ConsultantRelationship;
  lastReviewedAt?: number;
  lastReviewedRevision?: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  unreadClinicalChanges: number;
  unresolvedItemsCount: number;
  criticalItemsCount: number;
  pendingDiagnosticCount: number;
  unacknowledgedResultCount: number;
  medicationChangesCount: number;
  dataQualityState: 'COMPLETE' | 'REVIEW_REQUIRED';
  changes: ConsultantChangeItem[];
  openItems: ClinicalOpenItemProjection[];
  generatedAt: number;
}
