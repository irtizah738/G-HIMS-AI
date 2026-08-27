import {
  WorkflowDefinition,
  WorkflowSnapshot,
  WorkflowStage,
} from '@/types/encounter-runtime';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';

/**
 * Compiles a static clinical workflow definition into an active runtime snapshot
 */
export function compileWorkflow(
  definition: WorkflowDefinition,
  encounterId: string
): WorkflowSnapshot {
  const now = Date.now();
  const sortedStages = [...definition.stages].sort((a, b) => a.order - b.order);

  const stages: WorkflowStage[] = sortedStages.map((stg, index) => {
    const isFirst = index === 0;
    const stage: WorkflowStage = {
      id: stg.id,
      name: stg.name,
      order: stg.order,
      status: isFirst ? 'ACTIVE' : 'PENDING',
      requiredRoles: [...stg.requiredRoles],
    };

    if (stg.slaTargetMinutes !== undefined && stg.slaTargetMinutes !== null) {
      stage.slaTargetMinutes = stg.slaTargetMinutes;
    }
    if (isFirst) {
      stage.enteredAt = now;
    }

    return stage;
  });

  const firstStageId = stages[0]?.id || 'REGISTRATION';

  const snapshot: WorkflowSnapshot = {
    id: `snap_${encounterId}_${now}`,
    encounterId,
    workflowDefinitionId: definition.id,
    currentStageId: firstStageId,
    stages,
    initializedAt: now,
    updatedAt: now,
    isCompleted: false,
  };

  return sanitizeForFirestore(snapshot);
}
