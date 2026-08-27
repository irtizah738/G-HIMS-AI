/**
 * Clinical Workflow Compiler
 * Validates, optimizes, and compiles workflow definition DAGs into executable runtime graphs.
 */

import {
  WorkflowDefinition,
  CompiledWorkflowGraph,
  CompiledStageNode,
  ClinicalStageType,
  WorkflowGuard,
} from '@/types/clinical-workflow';
import { GeneralOpdWorkflowDefinition } from './definitions/opd';

export class WorkflowCompiler {
  /**
   * Compiles a declarative WorkflowDefinition into an indexed, validated runtime graph.
   */
  public static compile(definition: WorkflowDefinition = GeneralOpdWorkflowDefinition): CompiledWorkflowGraph {
    const stageKeys = Object.keys(definition.stages) as ClinicalStageType[];
    const stageNodes: Record<ClinicalStageType, CompiledStageNode> = {} as any;
    const transitionMatrix: Record<ClinicalStageType, ClinicalStageType[]> = {} as any;
    let totalEstimatedSlaMinutes = 0;

    // Validate that initial stage exists in definition
    if (!definition.stages[definition.initialStage]) {
      throw new Error(`Initial stage '${definition.initialStage}' is not defined in workflow '${definition.id}'`);
    }

    // Process and index each stage node
    for (const stageKey of stageKeys) {
      const stageDef = definition.stages[stageKey];
      totalEstimatedSlaMinutes += stageDef.targetSlaMinutes;

      // Validate allowedNextStages point to real stages
      for (const nextStage of stageDef.allowedNextStages) {
        if (!definition.stages[nextStage]) {
          throw new Error(
            `Stage '${stageKey}' references non-existent allowedNextStage '${nextStage}' in workflow '${definition.id}'`
          );
        }
      }

      const autoTransitionsMap = new Map<ClinicalStageType, string>();
      if (stageDef.autoTransitions) {
        for (const auto of stageDef.autoTransitions) {
          autoTransitionsMap.set(auto.targetStage, auto.conditionFnName);
        }
      }

      // Build compiled next transitions
      const nextStageTransitions = stageDef.allowedNextStages.map((targetStage) => {
        const targetDef = definition.stages[targetStage];
        const requiredGuards = (targetDef?.guards || []).map((g) => g.id);
        return {
          targetStage,
          requiredGuards,
          isAutoTrigger: autoTransitionsMap.has(targetStage),
        };
      });

      // Combine local guards with global guards
      const combinedGuards: WorkflowGuard[] = [...definition.globalGuards, ...stageDef.guards];

      stageNodes[stageKey] = {
        id: stageDef.id,
        title: stageDef.title,
        sequenceOrder: stageDef.sequenceOrder,
        targetSlaMinutes: stageDef.targetSlaMinutes,
        requiredRoles: stageDef.requiredRoles,
        nextStageTransitions,
        prerequisiteFieldList: stageDef.prerequisites.map((p) => p.field),
        guardList: combinedGuards,
        isTerminal: !!stageDef.isTerminal,
      };

      transitionMatrix[stageKey] = [...stageDef.allowedNextStages];
    }

    return {
      workflowId: definition.id,
      version: definition.version,
      initialStage: definition.initialStage,
      stageNodes,
      transitionMatrix,
      totalEstimatedSlaMinutes,
      compiledAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to check if a direct transition is structurally allowed in the compiled graph.
   */
  public static isDirectTransitionAllowed(
    graph: CompiledWorkflowGraph,
    fromStage: ClinicalStageType,
    toStage: ClinicalStageType
  ): boolean {
    const allowed = graph.transitionMatrix[fromStage];
    return Array.isArray(allowed) && allowed.includes(toStage);
  }

  /**
   * Calculates the remaining SLA target from a given stage to terminal.
   */
  public static calculateRemainingSla(graph: CompiledWorkflowGraph, currentStage: ClinicalStageType): number {
    let remainingMinutes = 0;
    const currentNode = graph.stageNodes[currentStage];
    if (!currentNode) return 0;

    const currentOrder = currentNode.sequenceOrder;
    for (const node of Object.values(graph.stageNodes)) {
      if (node.sequenceOrder >= currentOrder) {
        remainingMinutes += node.targetSlaMinutes;
      }
    }
    return remainingMinutes;
  }
}

// Pre-compiled singleton for default General OPD workflow
export const CompiledGeneralOpdWorkflow = WorkflowCompiler.compile(GeneralOpdWorkflowDefinition);
