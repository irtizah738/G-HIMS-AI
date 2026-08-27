/**
 * Stage Transition Resolver
 * Validates clinical prerequisites, role permissions, and guard assertions before advancing encounter stages.
 */

import {
  ClinicalStageType,
  CompiledWorkflowGraph,
  StageTransitionRequest,
  StageTransitionResult,
  WorkflowGuard,
} from '@/types/clinical-workflow';
import { CompiledGeneralOpdWorkflow, WorkflowCompiler } from './compiler';

export class StageTransitionResolver {
  private compiledGraph: CompiledWorkflowGraph;

  constructor(compiledGraph: CompiledWorkflowGraph = CompiledGeneralOpdWorkflow) {
    this.compiledGraph = compiledGraph;
  }

  /**
   * Resolves whether a transition request is permissible and returns detailed diagnostic outcomes.
   */
  public resolve(request: StageTransitionRequest): StageTransitionResult {
    const timestamp = new Date().toISOString();
    const unmetPrerequisites: string[] = [];
    const failedGuards: { guardId: string; name: string; message: string }[] = [];
    const warnings: string[] = [];

    const { currentStage, targetStage, initiatorUserRole, transitionData = {}, vitals, overrideEmergency } = request;

    // 1. Structural Graph Transition Validation
    const isStructurallyAllowed = WorkflowCompiler.isDirectTransitionAllowed(
      this.compiledGraph,
      currentStage,
      targetStage
    );

    if (!isStructurallyAllowed && !overrideEmergency) {
      return {
        allowed: false,
        currentStage,
        targetStage,
        timestamp,
        unmetPrerequisites,
        failedGuards: [
          {
            guardId: 'guard-dag-transition-invalid',
            name: 'Invalid DAG Transition',
            message: `Transition from '${currentStage}' to '${targetStage}' is not permitted by the clinical care pathway.`,
          },
        ],
        warnings,
        error: `Illegal stage transition path from ${currentStage} to ${targetStage}`,
      };
    }

    const targetNode = this.compiledGraph.stageNodes[targetStage];
    if (!targetNode) {
      return {
        allowed: false,
        currentStage,
        targetStage,
        timestamp,
        unmetPrerequisites,
        failedGuards: [],
        warnings,
        error: `Target stage '${targetStage}' is not recognized in compiled workflow.`,
      };
    }

    // 2. Role Authorization Gate
    if (targetNode.requiredRoles && targetNode.requiredRoles.length > 0) {
      const normalizedInitiatorRole = (initiatorUserRole || '').toLowerCase();
      const hasAuthorizedRole =
        normalizedInitiatorRole.includes('admin') ||
        targetNode.requiredRoles.some((role) => normalizedInitiatorRole.includes(role.toLowerCase()));

      if (!hasAuthorizedRole && !overrideEmergency) {
        failedGuards.push({
          guardId: 'guard-role-unauthorized',
          name: 'Clinical Role Gate',
          message: `User role '${initiatorUserRole}' is not authorized to initiate '${targetStage}'. Requires: ${targetNode.requiredRoles.join(', ')}`,
        });
      }
    }

    // 3. Prerequisite Fields Evaluation
    if (targetNode.prerequisiteFieldList && targetNode.prerequisiteFieldList.length > 0) {
      for (const field of targetNode.prerequisiteFieldList) {
        const val = transitionData[field];
        const isMissing = val === undefined || val === null || val === '';
        if (isMissing && !overrideEmergency) {
          unmetPrerequisites.push(field);
        }
      }
    }

    // 4. Guard Assertions Evaluation
    for (const guard of targetNode.guardList) {
      const evaluation = this.evaluateGuard(guard, request);
      if (!evaluation.passed) {
        if (overrideEmergency && guard.guardType !== 'ROLE_PERMISSION') {
          warnings.push(`EMERGENCY OVERRIDE applied for guard: ${guard.name} (${evaluation.message})`);
        } else {
          failedGuards.push({
            guardId: guard.id,
            name: guard.name,
            message: evaluation.message || guard.blockingMessage,
          });
        }
      } else if (evaluation.warning) {
        warnings.push(evaluation.warning);
      }
    }

    // 5. Special Clinical Rule: NEWS2 Deterioration Alert
    if (vitals && typeof vitals.news2Score === 'number' && vitals.news2Score >= 5) {
      if (targetStage === 'DISCHARGE_OR_REFERRAL' && !overrideEmergency) {
        failedGuards.push({
          guardId: 'guard-news2-critical-discharge',
          name: 'Critical NEWS2 Score Block',
          message: `Patient has high deterioration risk (NEWS2 = ${vitals.news2Score}). Routine discharge is blocked. Emergency escalation or inpatient admission required.`,
        });
      } else {
        warnings.push(`CRITICAL CLINICAL ALERT: NEWS2 Score is ${vitals.news2Score}. Immediate clinician review advised.`);
      }
    }

    const allowed = unmetPrerequisites.length === 0 && failedGuards.length === 0;

    return {
      allowed,
      currentStage,
      targetStage,
      timestamp,
      unmetPrerequisites,
      failedGuards,
      warnings,
    };
  }

  /**
   * Internal guard evaluator dispatcher.
   */
  private evaluateGuard(
    guard: WorkflowGuard,
    request: StageTransitionRequest
  ): { passed: boolean; message?: string; warning?: string } {
    const { vitals, soapSigned, billingCleared, transitionData = {} } = request;

    switch (guard.guardType) {
      case 'VITALS_REQUIRED':
        if (!vitals) {
          return { passed: false, message: 'Vital signs have not been recorded.' };
        }
        if (!vitals.heartRate || !vitals.bloodPressure || !vitals.respiratoryRate || !vitals.oxygenSaturation) {
          return { passed: false, message: 'Core vital sign parameters (HR, BP, RR, SpO2) are incomplete.' };
        }
        return { passed: true };

      case 'NEWS2_CHECK':
        if (vitals && typeof vitals.news2Score === 'number' && vitals.news2Score >= 7) {
          return {
            passed: false,
            message: `Emergency NEWS2 score of ${vitals.news2Score} triggered. Protocol requires stat escalation.`,
          };
        }
        return { passed: true };

      case 'SOAP_COMPLETED':
        if (!soapSigned && !transitionData.soapSigned) {
          return { passed: false, message: 'Attending clinician SOAP note sign-off is required.' };
        }
        return { passed: true };

      case 'BILLING_CLEARED':
        if (billingCleared === false || transitionData.billingCleared === false) {
          return { passed: false, message: 'Outstanding patient balance must be cleared or insured before completion.' };
        }
        return { passed: true };

      case 'ROLE_PERMISSION':
        return { passed: true };

      case 'CUSTOM':
      default:
        return { passed: true };
    }
  }
}

export const GlobalStageTransitionResolver = new StageTransitionResolver();
