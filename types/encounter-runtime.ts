/**
 * Clinical Workflow Runtime Planning & Stage State Interfaces
 */

import type {
  ClinicalEncounterState,
  FinancialClearanceState,
  OperationalQueueState,
  ResourceAssignmentState,
} from './clinical-state';

export type EncounterType = 'OPD' | 'IPD' | 'EMERGENCY';

export type StageStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED' | 'FAILED';

export interface WorkflowStage {
  id: string;
  name: string;
  order: number;
  status: StageStatus;
  requiredRoles: string[];
  enteredAt?: number;
  completedAt?: number;
  actorId?: string;
  actorRole?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
  slaTargetMinutes?: number;
  durationMinutes?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  type: EncounterType;
  stages: {
    id: string;
    name: string;
    order: number;
    requiredRoles: string[];
    slaTargetMinutes?: number;
    description?: string;
  }[];
}

export interface WorkflowSnapshot {
  id: string;
  encounterId: string;
  workflowDefinitionId: string;
  currentStageId: string;
  stages: WorkflowStage[];
  initializedAt: number;
  updatedAt: number;
  totalDurationMinutes?: number;
  isCompleted?: boolean;
}

export interface EncounterRuntime {
  id: string;
  /** Canonical alias used by server domain services. */
  encounterId?: string;
  tenantId: string;
  patientId: string;
  type: EncounterType;
  encounterType?: EncounterType;
  status: 'PLANNED' | 'IN_PROGRESS' | 'ACTIVE' | 'COMPLETED' | 'DISCHARGED' | 'TRANSFERRED' | 'CANCELLED';
  currentStageId: string;
  currentStage?: string;
  clinicalState?: ClinicalEncounterState;
  operationalState?: OperationalQueueState;
  financialClearanceState?: FinancialClearanceState;
  resourceAssignmentState?: ResourceAssignmentState;
  workflowSnapshotId: string;
  startedAt: number;
  endedAt?: number;
  facilityId?: string;
  departmentId?: string;
  department?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  chiefComplaint?: string;
  assignedDoctor?: string;
  tokenNumber?: string;
  disposition?: string;
  sourceEncounterId?: string;
  linkedEncounterId?: string;
  completedAt?: number;
  dischargedAt?: number;
}
