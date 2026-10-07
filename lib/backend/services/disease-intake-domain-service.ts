import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import type {
  DiseaseIntakeArtifact,
  SaveDiseaseIntakeArtifactPayload,
} from '@/types/disease-intake-artifact';
import { INTAKE_TEMPLATES } from '@/lib/clinical/intake-templates-data';
import {
  allowedDiseaseIntakeHistoryKeys,
  allowedDiseaseIntakeQuestionIds,
  allowedDiseaseIntakeTreeNodeIds,
  computeGovernedDiseaseIntakeRisk,
  missingRequiredDiseaseIntakeQuestions,
} from '@/lib/clinical/disease-intake/governed-risk-engine';

function failure(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message },
  };
}

function uniqueStrings(values: string[], max: number): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean))
  ).slice(0, max);
}

export class DiseaseIntakeDomainService {
  public static async finalize(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: SaveDiseaseIntakeArtifactPayload
  ): Promise<CommandResult<DiseaseIntakeArtifact>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'DOCTOR',
        'CONSULTANT',
        'ATTENDING_PHYSICIAN',
        'SYSTEM_ADMIN',
      ],
      requiredPrivilege: 'SIGN_CLINICAL_NOTES',
      allowBreakGlass: true,
    });
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed clinician authority is required.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const [patient, encounter] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        payload.patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        payload.encounterId
      ),
    ]);

    if (!patient) {
      return failure(
        commandId,
        idempotencyKey,
        'PATIENT_NOT_FOUND',
        'Patient does not exist.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return failure(
        commandId,
        idempotencyKey,
        'ENCOUNTER_PATIENT_MISMATCH',
        'Encounter does not belong to the supplied patient.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    assertPatient360PatientAccess(context, patient, encounter);

    if (payload.clinicianAttestation !== true) {
      return failure(
        commandId,
        idempotencyKey,
        'DISEASE_INTAKE_ATTESTATION_REQUIRED',
        'Clinician attestation is required before finalizing an intake artifact.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const patient360 =
      await Patient360ProjectionService.getOrRebuildProjection(
        context.tenantId,
        payload.patientId
      );
    if (!patient360) {
      return failure(
        commandId,
        idempotencyKey,
        'PATIENT360_UNAVAILABLE',
        'Patient 360 could not be loaded for intake finalization.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    if (
      patient360.revision !== payload.patient360Revision ||
      patient360.sourceCheckpoint !== payload.patient360SourceCheckpoint
    ) {
      return failure(
        commandId,
        idempotencyKey,
        'PATIENT360_REVIEW_STALE',
        'Patient 360 changed after this intake was reviewed. Refresh the chart and review the intake again before finalizing.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const templateId = String(payload.templateId || '').trim();
    const template = INTAKE_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) {
      return failure(
        commandId,
        idempotencyKey,
        'DISEASE_INTAKE_TEMPLATE_UNKNOWN',
        'Disease intake template is not registered in the governed template catalog.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    if (
      payload.templateName !== template.name ||
      payload.clinicalGuidelines !== template.clinicalGuidelines
    ) {
      return failure(
        commandId,
        idempotencyKey,
        'DISEASE_INTAKE_TEMPLATE_PROVENANCE_MISMATCH',
        'Client template metadata does not match the governed server template.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const allowedQuestions = allowedDiseaseIntakeQuestionIds(template);
    const unknownQuestions = Object.keys(payload.guidedAnswers || {}).filter(
      (key) => !allowedQuestions.has(key)
    );
    const allowedHistory = allowedDiseaseIntakeHistoryKeys(template);
    const unknownHistory = Object.keys(payload.specialtyHistory || {}).filter(
      (key) => !allowedHistory.has(key)
    );
    const allowedNodes = allowedDiseaseIntakeTreeNodeIds(template);
    const unknownNodes = (payload.selectedTreeNodeIds || []).filter(
      (nodeId) => !allowedNodes.has(nodeId)
    );
    if (unknownQuestions.length || unknownHistory.length || unknownNodes.length) {
      return failure(
        commandId,
        idempotencyKey,
        'DISEASE_INTAKE_UNGOVERNED_FIELD',
        'Intake contains fields or symptom-tree nodes outside the governed template.'
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const missingRequired = missingRequiredDiseaseIntakeQuestions(
      template,
      payload.guidedAnswers || {}
    );
    if (missingRequired.length > 0) {
      return failure(
        commandId,
        idempotencyKey,
        'DISEASE_INTAKE_INCOMPLETE',
        `Required intake questions are missing: ${missingRequired.join(', ')}.`
      ) as CommandResult<DiseaseIntakeArtifact>;
    }

    const governedRisk = computeGovernedDiseaseIntakeRisk(
      template,
      payload.guidedAnswers || {},
      payload.specialtyHistory || {},
      payload.selectedTreeNodeIds || []
    );

    const now = Date.now();
    const intakeArtifactId = `intake_${crypto.randomUUID()}`;
    const artifact: DiseaseIntakeArtifact = {
      intakeArtifactId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      templateId,
      templateName: template.name,
      templateVersion: payload.templateVersion?.trim() || undefined,
      clinicalGuidelines: template.clinicalGuidelines,
      guidedAnswers: payload.guidedAnswers || {},
      specialtyHistory: payload.specialtyHistory || {},
      selectedTreeNodeIds: uniqueStrings(payload.selectedTreeNodeIds || [], 500),
      risk: {
        score: governedRisk.score,
        severity: governedRisk.severity,
        signalIds: governedRisk.signalIds,
        signalTitles: governedRisk.signalTitles,
      },
      specialistTargets: [...template.typicalSpecialists],
      sourceRefs: uniqueStrings(payload.sourceRefs || [], 200),
      patient360Revision: payload.patient360Revision,
      patient360SourceCheckpoint: payload.patient360SourceCheckpoint,
      authoredBy: context.actorId,
      authoredAt: now,
      status: 'FINAL',
      schemaVersion: 1,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'DISEASE_INTAKE_ARTIFACT',
      aggregateId: intakeArtifactId,
      eventType: 'DISEASE_INTAKE_FINALIZED',
      eventPayload: {
        intakeArtifactId,
        patientId: artifact.patientId,
        encounterId: artifact.encounterId,
        templateId: artifact.templateId,
        templateName: artifact.templateName,
        riskSeverity: artifact.risk.severity,
        riskScore: artifact.risk.score,
        specialistTargets: artifact.specialistTargets,
        sourceRefs: artifact.sourceRefs,
        patient360Revision: artifact.patient360Revision,
        patient360SourceCheckpoint: artifact.patient360SourceCheckpoint,
      },
      auditAction: 'FINALIZE_DISEASE_INTAKE',
      auditResourceType: 'DISEASE_INTAKE_ARTIFACT',
      auditResourceId: intakeArtifactId,
      auditReason: `Finalized clinician-reviewed ${template.name} intake for patient ${payload.patientId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: artifact,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: intakeArtifactId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: artifact,
    };
  }
}
