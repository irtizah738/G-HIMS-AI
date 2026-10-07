import type { ClinicalCareSetting, ConsultantChangeSeverity } from '@/types/consultant-visibility';

export type ClinicalConsultationStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'ACKNOWLEDGED'
  | 'ACCEPTED'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ClinicalConsultationRequest {
  consultationId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  requestedSpecialty: string;
  requestedConsultantId?: string;
  assignedConsultantId?: string;
  clinicalQuestion: string;
  priority: 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'STAT';
  acknowledgementSlaMinutes?: number;
  acknowledgementDueAt?: number;
  acceptanceSlaMinutes?: number;
  acceptanceDueAt?: number;
  /** @deprecated Use acknowledgementSlaMinutes. */
  responseSlaMinutes?: number;
  /** @deprecated Use acknowledgementDueAt. */
  responseDueAt?: number;
  status: ClinicalConsultationStatus;
  sourceRefs: string[];
  requestedBy: string;
  requestedAt: number;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  acknowledgementSlaBreached?: boolean;
  acceptedBy?: string;
  acceptedAt?: number;
  acceptanceSlaBreached?: boolean;
  completedBy?: string;
  completedAt?: number;
  assessment?: string;
  recommendations?: string[];
  followUpRequired?: boolean;
  primaryTeamReviewRequired?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ClinicalHandoffStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'CANCELLED';

export interface ClinicalHandoff {
  handoffId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  sourceEncounterId?: string;
  episodeId?: string;
  careSetting: ClinicalCareSetting;
  fromClinicianId: string;
  fromDepartmentId?: string;
  toClinicianId?: string;
  toDepartmentId?: string;
  toRole?: string;
  currentProblemSummary: string;
  activeRisks: string[];
  pendingDiagnostics: string[];
  pendingProcedures: string[];
  pendingConsultations: string[];
  medicationConcerns: string[];
  unresolvedItems: string[];
  expectedActions: string[];
  sourceRefs?: string[];
  patient360Revision?: number;
  patient360SourceCheckpoint?: string;
  sourceArtifactId?: string;
  sourceArtifactType?: 'DISEASE_INTAKE' | 'CLINICAL_DOCUMENT' | 'CONSULTATION' | 'OTHER';
  status: ClinicalHandoffStatus;
  createdAt: number;
  acceptedAt?: number;
  acceptedBy?: string;
  updatedAt: number;
}

export type ClinicalEscalationState =
  | 'DETECTED'
  | 'ASSIGNED'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'ACTIONED'
  | 'RESOLVED';

export interface ClinicalEscalationProjection {
  escalationId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  severity: 'ACTION_REQUIRED' | 'CRITICAL_REVIEW_REQUIRED';
  state: ClinicalEscalationState;
  ownerType: 'CONSULTANT' | 'CARE_TEAM' | 'DEPARTMENT' | 'ROLE';
  ownerId?: string;
  sourceRefs: string[];
  detectedAt: number;
  dueAt?: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  actionedAt?: number;
  resolvedAt?: number;
  note?: string;
  updatedAt: number;
}

export interface ConsultantWorklistItem {
  openItemId: string;
  patientId: string;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  category: string;
  description: string;
  clinicalPriority: ConsultantChangeSeverity;
  ownerType: string;
  ownerId?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: number;
  dueAt?: number;
  slaPhase?: 'ACKNOWLEDGEMENT' | 'ACCEPTANCE' | 'COMPLETE';
  slaState?: 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'COMPLETE';
  acknowledgedAt?: number;
  sourceRefs: string[];
}

export interface ConsultantWorklist {
  tenantId: string;
  consultantId: string;
  generatedAt: number;
  counts: {
    total: number;
    critical: number;
    actionRequired: number;
    diagnostics: number;
    consultations: number;
    handoffs: number;
    deterioration: number;
  };
  items: ConsultantWorklistItem[];
}
