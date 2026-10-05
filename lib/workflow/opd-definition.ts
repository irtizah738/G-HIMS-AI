import type { WorkflowDefinition } from '@/types/encounter-runtime';
import { GeneralOpdWorkflowDefinition } from '@/lib/clinical/workflow/definitions/opd';

/**
 * Canonical OPD runtime snapshot definition.
 *
 * There is deliberately only one OPD workflow authority:
 * GeneralOpdWorkflowDefinition (the governed v1.2 DAG).
 *
 * This adapter exists because the persisted encounter snapshot uses the older
 * array-shaped WorkflowDefinition contract. It must never define stages on its
 * own. Any change to the governed DAG is therefore reflected automatically in
 * newly-created runtime snapshots.
 */
export const OPD_WORKFLOW_DEFINITION: WorkflowDefinition = {
  id: GeneralOpdWorkflowDefinition.id,
  name: GeneralOpdWorkflowDefinition.name,
  type: 'OPD',
  stages: Object.values(GeneralOpdWorkflowDefinition.stages)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .map((stage) => ({
      id: stage.id,
      name: stage.title,
      order: stage.sequenceOrder,
      requiredRoles: [...stage.requiredRoles],
      slaTargetMinutes: stage.targetSlaMinutes,
      description: stage.description,
    })),
};
