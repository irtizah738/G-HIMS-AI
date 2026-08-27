/**
 * Clinical Workflow Runtime Planning & Stage State Interfaces
 */

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
  tenantId: string;
  patientId: string;
  type: EncounterType;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  currentStageId: string;
  workflowSnapshotId: string;
  startedAt: number;
  endedAt?: number;
  department?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  chiefComplaint?: string;
  assignedDoctor?: string;
  tokenNumber?: string;
}
