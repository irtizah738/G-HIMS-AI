import { WorkflowSnapshot, WorkflowStage } from '@/types/encounter-runtime';

export interface TransitionResult {
  updatedSnapshot: WorkflowSnapshot;
  isCompleted: boolean;
  nextStage?: WorkflowStage;
}

export class StageTransitionError extends Error {
  constructor(message: string, public code: 'INVALID_STAGE' | 'UNAUTHORIZED_ROLE' | 'ALREADY_COMPLETED') {
    super(message);
    this.name = 'StageTransitionError';
  }
}

/**
 * Resolves deterministic stage transitions with strict role gating and SLA timestamp calculation
 */
export function resolveNextStage(
  snapshot: WorkflowSnapshot,
  completedStageId: string,
  actorId: string,
  actorRole: string,
  actorName?: string,
  stageMetadata?: Record<string, unknown>
): TransitionResult {
  if (snapshot.isCompleted) {
    throw new StageTransitionError(
      'Workflow is already completed; cannot execute further transitions.',
      'ALREADY_COMPLETED'
    );
  }

  if (snapshot.currentStageId !== completedStageId) {
    throw new StageTransitionError(
      `Transition rejected: active stage is '${snapshot.currentStageId}', but received completion for '${completedStageId}'.`,
      'INVALID_STAGE'
    );
  }

  const now = Date.now();
  const currentStageIndex = snapshot.stages.findIndex((s) => s.id === completedStageId);

  if (currentStageIndex === -1) {
    throw new StageTransitionError(`Stage '${completedStageId}' does not exist in workflow definition.`, 'INVALID_STAGE');
  }

  const currentStage = snapshot.stages[currentStageIndex];

  // RBAC validation: Check if actorRole is permitted (or is SuperAdmin/Practitioner)
  const normalizedRole = actorRole.toLowerCase().trim();
  const roleAllowed =
    normalizedRole === 'superadmin' ||
    normalizedRole === 'admin' ||
    normalizedRole === 'practitioner' ||
    currentStage.requiredRoles.some((r) => r.toLowerCase() === normalizedRole);

  if (!roleAllowed) {
    throw new StageTransitionError(
      `Role '${actorRole}' is unauthorized for stage '${currentStage.name}'. Required: [${currentStage.requiredRoles.join(', ')}].`,
      'UNAUTHORIZED_ROLE'
    );
  }

  // Calculate dwell duration
  const enteredAt = currentStage.enteredAt || snapshot.initializedAt;
  const durationMinutes = Math.max(1, Math.round((now - enteredAt) / (1000 * 60)));

  // Update current stage to COMPLETED
  const updatedStages: WorkflowStage[] = [...snapshot.stages];
  updatedStages[currentStageIndex] = {
    ...currentStage,
    status: 'COMPLETED',
    completedAt: now,
    actorId,
    actorRole,
    actorName: actorName || actorRole,
    durationMinutes,
    metadata: stageMetadata || currentStage.metadata,
  };

  // Find next sequential stage
  const nextStageIndex = currentStageIndex + 1;
  const hasNextStage = nextStageIndex < updatedStages.length;

  if (hasNextStage) {
    const nextStage = updatedStages[nextStageIndex];
    updatedStages[nextStageIndex] = {
      ...nextStage,
      status: 'ACTIVE',
      enteredAt: now,
    };

    const updatedSnapshot: WorkflowSnapshot = {
      ...snapshot,
      currentStageId: nextStage.id,
      stages: updatedStages,
      updatedAt: now,
      isCompleted: false,
    };

    return {
      updatedSnapshot,
      isCompleted: false,
      nextStage: updatedStages[nextStageIndex],
    };
  } else {
    // Terminal stage reached - workflow completes
    const totalDuration = Math.round((now - snapshot.initializedAt) / (1000 * 60));

    const updatedSnapshot: WorkflowSnapshot = {
      ...snapshot,
      currentStageId: 'COMPLETED',
      stages: updatedStages,
      updatedAt: now,
      isCompleted: true,
      totalDurationMinutes: totalDuration,
    };

    return {
      updatedSnapshot,
      isCompleted: true,
    };
  }
}
