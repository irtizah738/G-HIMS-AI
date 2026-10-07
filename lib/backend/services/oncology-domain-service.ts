import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  OncologyCase,
  OncologyRegimen,
  OncologyToxicityAssessment,
  TumorBoardRecommendation,
} from '@/types/wave2-clinical-domains';
import {
  clinicianAuthorization,
  ensureSameScope,
  loadWave2ScopedEncounter,
  nurseAuthorization,
  uniqueWave2Strings,
  wave2Failure,
} from './wave2-clinical-common';

export interface OpenOncologyCasePayload {
  patientId: string;
  encounterId: string;
  primaryDiagnosis: string;
  diagnosisCode?: string;
  stagingSystem?: string;
  stage?: string;
  evidenceRefs: string[];
}

export interface RecordTumorBoardRecommendationPayload {
  patientId: string;
  encounterId: string;
  oncologyCaseId: string;
  attendees: string[];
  recommendation: string;
  evidenceRefs: string[];
}

export interface ApproveOncologyRegimenPayload {
  patientId: string;
  encounterId: string;
  oncologyCaseId: string;
  recommendationId: string;
  name: string;
  cycleCount: number;
  medicationOrderIds: string[];
}

export interface LinkChemotherapyAdministrationPayload {
  patientId: string;
  encounterId: string;
  oncologyCaseId: string;
  regimenId: string;
  medicationAdministrationId: string;
  cycleNumber: number;
}

export interface RecordOncologyToxicityPayload {
  patientId: string;
  encounterId: string;
  oncologyCaseId: string;
  regimenId?: string;
  grade: 0 | 1 | 2 | 3 | 4 | 5;
  findings: string[];
  action: OncologyToxicityAssessment['action'];
}

export class OncologyDomainService {
  public static async openCase(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: OpenOncologyCasePayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Oncology case authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const diagnosis = String(payload.primaryDiagnosis || '').trim();
    const evidenceRefs = uniqueWave2Strings(payload.evidenceRefs, 200);
    if (!diagnosis || evidenceRefs.length === 0) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_CASE_EVIDENCE_REQUIRED', 'Oncology case creation requires a diagnosis statement and source evidence.');
    }

    const oncologyCaseId = `onc_case_${crypto.randomUUID()}`;
    const now = Date.now();
    const record: OncologyCase = {
      oncologyCaseId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      primaryDiagnosis: diagnosis,
      diagnosisCode: String(payload.diagnosisCode || '').trim() || undefined,
      stagingSystem: String(payload.stagingSystem || '').trim() || undefined,
      stage: String(payload.stage || '').trim() || undefined,
      evidenceRefs,
      status: 'OPEN',
      openedBy: context.actorId,
      openedAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ONCOLOGY_CASE',
      aggregateId: oncologyCaseId,
      eventType: 'ONCOLOGY_CASE_OPENED',
      eventPayload: {
        oncologyCaseId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        primaryDiagnosis: diagnosis,
        diagnosisCode: record.diagnosisCode,
        stagingSystem: record.stagingSystem,
        stage: record.stage,
        evidenceRefs,
      },
      auditAction: 'OPEN_ONCOLOGY_CASE',
      auditResourceType: 'ONCOLOGY_CASE',
      auditResourceId: oncologyCaseId,
      auditReason: 'Opened evidence-linked oncology case.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: record,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: oncologyCaseId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: record };
  }

  public static async recordTumorBoardRecommendation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordTumorBoardRecommendationPayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context, { privilege: 'SIGN_CLINICAL_NOTES' });
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Tumor board recording authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const oncologyCase = await DomainStateRepository.getById<OncologyCase>(
      context.tenantId,
      'oncologyCases',
      payload.oncologyCaseId
    );
    if (!ensureSameScope(oncologyCase as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !oncologyCase || oncologyCase.status === 'CLOSED') {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_CASE_NOT_ACTIVE', 'An active oncology case for this patient encounter is required.');
    }

    const attendees = uniqueWave2Strings(payload.attendees, 50);
    const evidenceRefs = uniqueWave2Strings(payload.evidenceRefs, 200);
    const recommendationText = String(payload.recommendation || '').trim();
    if (attendees.length < 2 || evidenceRefs.length === 0 || recommendationText.length < 10) {
      return wave2Failure(commandId, idempotencyKey, 'TUMOR_BOARD_RECOMMENDATION_INCOMPLETE', 'Tumor board recommendation requires at least two attendees, evidence, and a substantive recommendation.');
    }

    const recommendationId = `tumor_board_${crypto.randomUUID()}`;
    const now = Date.now();
    const recommendation: TumorBoardRecommendation = {
      recommendationId,
      oncologyCaseId: oncologyCase.oncologyCaseId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      attendees,
      recommendation: recommendationText,
      evidenceRefs,
      recordedBy: context.actorId,
      recordedAt: now,
    };
    const nextCase: OncologyCase = { ...oncologyCase, status: 'BOARD_REVIEWED', updatedAt: now };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ONCOLOGY_TUMOR_BOARD_RECOMMENDATION',
      aggregateId: recommendationId,
      eventType: 'ONCOLOGY_TUMOR_BOARD_RECOMMENDATION_RECORDED',
      eventPayload: {
        recommendationId,
        oncologyCaseId: oncologyCase.oncologyCaseId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        attendees,
        evidenceRefs,
      },
      auditAction: 'RECORD_TUMOR_BOARD_RECOMMENDATION',
      auditResourceType: 'ONCOLOGY_CASE',
      auditResourceId: oncologyCase.oncologyCaseId,
      auditReason: 'Recorded multidisciplinary tumor board recommendation.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: recommendation,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites: [{
        entityType: 'ONCOLOGY_CASE',
        entityId: oncologyCase.oncologyCaseId,
        domainState: nextCase,
        expectedServerVersion: Number((oncologyCase as unknown as Record<string, unknown>)._serverVersion || 0),
      }],
    });

    return { success: true, commandId, idempotencyKey, entityId: recommendationId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: recommendation };
  }

  public static async approveRegimen(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveOncologyRegimenPayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context, { privilege: 'SIGN_CLINICAL_NOTES' });
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Regimen approval authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const [oncologyCase, recommendation] = await Promise.all([
      DomainStateRepository.getById<OncologyCase>(context.tenantId, 'oncologyCases', payload.oncologyCaseId),
      DomainStateRepository.getById<TumorBoardRecommendation>(context.tenantId, 'oncologyTumorBoardRecommendations', payload.recommendationId),
    ]);
    if (!ensureSameScope(oncologyCase as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !oncologyCase || oncologyCase.status !== 'BOARD_REVIEWED') {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_BOARD_REVIEW_REQUIRED', 'Regimen approval requires an oncology case that completed tumor board review.');
    }
    if (!recommendation || recommendation.oncologyCaseId !== oncologyCase.oncologyCaseId) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_RECOMMENDATION_MISMATCH', 'Regimen must reference the authoritative tumor board recommendation for this case.');
    }

    const medicationOrderIds = uniqueWave2Strings(payload.medicationOrderIds, 100);
    if (!String(payload.name || '').trim() || !Number.isInteger(payload.cycleCount) || payload.cycleCount < 1 || payload.cycleCount > 100 || medicationOrderIds.length === 0) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_REGIMEN_INVALID', 'Regimen name, bounded cycle count, and medication orders are required.');
    }

    for (const medicationOrderId of medicationOrderIds) {
      const medication = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'medicationOrders',
        medicationOrderId
      );
      if (!medication || String(medication.patientId || '') !== payload.patientId || !['ACTIVE', 'ON_HOLD'].includes(String(medication.status || ''))) {
        return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_MEDICATION_ORDER_INVALID', `Medication order ${medicationOrderId} is not an active order for this patient.`);
      }
    }

    const regimenId = `onc_reg_${crypto.randomUUID()}`;
    const now = Date.now();
    const regimen: OncologyRegimen = {
      regimenId,
      oncologyCaseId: oncologyCase.oncologyCaseId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      name: String(payload.name).trim(),
      cycleCount: payload.cycleCount,
      medicationOrderIds,
      recommendationId: recommendation.recommendationId,
      status: 'APPROVED',
      approvedBy: context.actorId,
      approvedAt: now,
      updatedAt: now,
    };
    const nextCase: OncologyCase = { ...oncologyCase, status: 'REGIMEN_APPROVED', updatedAt: now };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ONCOLOGY_REGIMEN',
      aggregateId: regimenId,
      eventType: 'ONCOLOGY_REGIMEN_APPROVED',
      eventPayload: {
        regimenId,
        oncologyCaseId: oncologyCase.oncologyCaseId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        cycleCount: payload.cycleCount,
        medicationOrderIds,
        recommendationId: recommendation.recommendationId,
      },
      auditAction: 'APPROVE_ONCOLOGY_REGIMEN',
      auditResourceType: 'ONCOLOGY_CASE',
      auditResourceId: oncologyCase.oncologyCaseId,
      auditReason: `Approved oncology regimen ${regimen.name}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: regimen,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites: [{
        entityType: 'ONCOLOGY_CASE',
        entityId: oncologyCase.oncologyCaseId,
        domainState: nextCase,
        expectedServerVersion: Number((oncologyCase as unknown as Record<string, unknown>)._serverVersion || 0),
      }],
    });

    return { success: true, commandId, idempotencyKey, entityId: regimenId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: regimen };
  }

  public static async linkChemotherapyAdministration(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: LinkChemotherapyAdministrationPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Chemotherapy administration linkage authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const [oncologyCase, regimen, administration] = await Promise.all([
      DomainStateRepository.getById<OncologyCase>(context.tenantId, 'oncologyCases', payload.oncologyCaseId),
      DomainStateRepository.getById<OncologyRegimen>(context.tenantId, 'oncologyRegimens', payload.regimenId),
      DomainStateRepository.getById<Record<string, unknown>>(context.tenantId, 'medicationAdministrations', payload.medicationAdministrationId),
    ]);
    if (!ensureSameScope(oncologyCase as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !oncologyCase || !regimen || regimen.oncologyCaseId !== oncologyCase.oncologyCaseId) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_REGIMEN_SCOPE_MISMATCH', 'Oncology regimen does not belong to the supplied case and patient encounter.');
    }
    if (!administration || String(administration.patientId || '') !== payload.patientId || String(administration.encounterId || '') !== payload.encounterId || String(administration.status || '') !== 'GIVEN') {
      return wave2Failure(commandId, idempotencyKey, 'CHEMOTHERAPY_ADMINISTRATION_INVALID', 'Chemotherapy linkage requires an authoritative GIVEN medication administration for this encounter.');
    }
    if (!regimen.medicationOrderIds.includes(String(administration.medicationOrderId || administration.medicationId || ''))) {
      return wave2Failure(commandId, idempotencyKey, 'CHEMOTHERAPY_ORDER_NOT_IN_REGIMEN', 'Medication administration is not part of the approved oncology regimen.');
    }
    if (!Number.isInteger(payload.cycleNumber) || payload.cycleNumber < 1 || payload.cycleNumber > regimen.cycleCount) {
      return wave2Failure(commandId, idempotencyKey, 'CHEMOTHERAPY_CYCLE_INVALID', 'Chemotherapy cycle number is outside the approved regimen.');
    }

    const linkId = `chemo_link_${regimen.regimenId}_${payload.cycleNumber}_${payload.medicationAdministrationId}`;
    const existing = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'oncologyChemotherapyLinks',
      linkId
    );
    if (existing) {
      return wave2Failure(commandId, idempotencyKey, 'CHEMOTHERAPY_LINK_ALREADY_EXISTS', 'This chemotherapy administration is already linked to the regimen cycle.');
    }

    const now = Date.now();
    const link = {
      linkId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      oncologyCaseId: oncologyCase.oncologyCaseId,
      regimenId: regimen.regimenId,
      medicationAdministrationId: payload.medicationAdministrationId,
      medicationOrderId: String(administration.medicationOrderId || administration.medicationId || ''),
      cycleNumber: payload.cycleNumber,
      linkedBy: context.actorId,
      linkedAt: now,
    };
    const nextRegimen: OncologyRegimen = { ...regimen, status: 'ACTIVE', updatedAt: now };
    const nextCase: OncologyCase = { ...oncologyCase, status: 'ACTIVE_TREATMENT', updatedAt: now };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ONCOLOGY_CHEMOTHERAPY_LINK',
      aggregateId: linkId,
      eventType: 'ONCOLOGY_CHEMOTHERAPY_ADMINISTRATION_LINKED',
      eventPayload: {
        linkId,
        oncologyCaseId: oncologyCase.oncologyCaseId,
        regimenId: regimen.regimenId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        medicationAdministrationId: payload.medicationAdministrationId,
        cycleNumber: payload.cycleNumber,
      },
      auditAction: 'LINK_CHEMOTHERAPY_ADMINISTRATION',
      auditResourceType: 'ONCOLOGY_REGIMEN',
      auditResourceId: regimen.regimenId,
      auditReason: 'Linked authoritative medication administration to approved regimen cycle.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: link,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites: [
        {
          entityType: 'ONCOLOGY_REGIMEN',
          entityId: regimen.regimenId,
          domainState: nextRegimen,
          expectedServerVersion: Number((regimen as unknown as Record<string, unknown>)._serverVersion || 0),
        },
        {
          entityType: 'ONCOLOGY_CASE',
          entityId: oncologyCase.oncologyCaseId,
          domainState: nextCase,
          expectedServerVersion: Number((oncologyCase as unknown as Record<string, unknown>)._serverVersion || 0),
        },
      ],
    });
    return { success: true, commandId, idempotencyKey, entityId: linkId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: link };
  }

  public static async recordToxicity(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordOncologyToxicityPayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Oncology toxicity assessment authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const oncologyCase = await DomainStateRepository.getById<OncologyCase>(
      context.tenantId,
      'oncologyCases',
      payload.oncologyCaseId
    );
    if (!ensureSameScope(oncologyCase as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || !oncologyCase) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_CASE_SCOPE_MISMATCH', 'Toxicity assessment requires the matching oncology case.');
    }
    if (payload.grade >= 3 && payload.action === 'CONTINUE') {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_HIGH_GRADE_TOXICITY_REVIEW_REQUIRED', 'Grade 3 or higher toxicity cannot be recorded with an unconditional continue action.');
    }

    const toxicityAssessmentId = `onc_tox_${crypto.randomUUID()}`;
    const now = Date.now();
    const assessment: OncologyToxicityAssessment = {
      toxicityAssessmentId,
      oncologyCaseId: oncologyCase.oncologyCaseId,
      regimenId: String(payload.regimenId || '').trim() || undefined,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      grade: payload.grade,
      findings: uniqueWave2Strings(payload.findings, 100),
      action: payload.action,
      assessedBy: context.actorId,
      assessedAt: now,
    };
    if (assessment.findings.length === 0) {
      return wave2Failure(commandId, idempotencyKey, 'ONCOLOGY_TOXICITY_FINDINGS_REQUIRED', 'At least one toxicity finding is required.');
    }

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ONCOLOGY_TOXICITY_ASSESSMENT',
      aggregateId: toxicityAssessmentId,
      eventType: payload.grade >= 3 ? 'ONCOLOGY_HIGH_GRADE_TOXICITY_RECORDED' : 'ONCOLOGY_TOXICITY_RECORDED',
      eventPayload: {
        toxicityAssessmentId,
        oncologyCaseId: oncologyCase.oncologyCaseId,
        regimenId: assessment.regimenId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        grade: payload.grade,
        action: payload.action,
        findings: assessment.findings,
      },
      auditAction: 'RECORD_ONCOLOGY_TOXICITY',
      auditResourceType: 'ONCOLOGY_CASE',
      auditResourceId: oncologyCase.oncologyCaseId,
      auditReason: `Recorded oncology toxicity grade ${payload.grade} with action ${payload.action}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: assessment,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: toxicityAssessmentId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: assessment };
  }
}
