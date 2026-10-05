/**
 * G-HIMS Clinical Documentation Domain Service
 * Server-authoritative encounter evidence for vitals and signed clinical notes.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { RevenueIntegrityFinding } from './revenue-integrity-domain-service';
import { PatientClinicalKnowledgeDomainService } from './patient-clinical-knowledge-domain-service';
import { calculateNEWS2 } from '@/lib/clinical/news2';
import {
  buildCanonicalAllergy,
  buildCanonicalClinicalDocument,
  buildCanonicalCondition,
  buildCanonicalVitalObservations,
} from '@/lib/clinical/canonical-fact-builders';

export interface RecordVitalsPayload {
  encounterId: string;
  patientId: string;
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  spO2Scale?: 1 | 2;
  onSupplementalOxygen?: boolean;
  consciousness?: 'Alert' | 'Voice' | 'Pain' | 'Unresponsive' | 'NewConfusion' | 'A' | 'V' | 'P' | 'U' | 'C';
  gcsScore?: number;
  measuredAt?: number;
}

export interface CompleteMedicationReconciliationPayload {
  encounterId: string;
  patientId: string;
  reconciledMedicationIds: string[];
  discrepancyCount: number;
  unresolvedDiscrepancies?: string[];
  notes?: string;
}

export interface RecordClinicalConditionPayload {
  patientId: string;
  encounterId?: string;
  code: string;
  display: string;
  codingSystem?: string;
  category: 'PROBLEM_LIST' | 'ENCOUNTER_DIAGNOSIS' | 'CHRONIC' | 'ACUTE' | 'OTHER';
  clinicalStatus?: 'ACTIVE' | 'INACTIVE' | 'RESOLVED' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';
  verificationStatus?: 'UNCONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL' | 'CONFIRMED' | 'REFUTED' | 'ENTERED_IN_ERROR';
  onsetAt?: number;
}

export interface RecordClinicalAllergyPayload {
  patientId: string;
  encounterId?: string;
  substanceCode: string;
  substanceDisplay: string;
  codingSystem?: string;
  type?: 'ALLERGY' | 'INTOLERANCE';
  category: 'FOOD' | 'MEDICATION' | 'ENVIRONMENT' | 'BIOLOGIC' | 'OTHER';
  criticality?: 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';
  verificationStatus?: 'UNCONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL' | 'CONFIRMED' | 'REFUTED' | 'ENTERED_IN_ERROR';
  reactionText?: string;
  reactionSeverity?: 'MILD' | 'MODERATE' | 'SEVERE';
}

export interface SignClinicalNotePayload {
  encounterId: string;
  patientId: string;
  category: 'SOAP' | 'PROGRESS' | 'CONSULTATION' | 'DISCHARGE' | 'NURSING';
  content: string;
  sourceDraftId?: string;
  acceptedStructuredData?: Record<string, unknown>;
}

interface SignedStructuredDiagnosis {
  code: string;
  description: string;
  isPrincipal: boolean;
  type: 'PRINCIPAL' | 'SECONDARY' | 'PROVISIONAL' | 'DIFFERENTIAL';
  verificationStatus: 'CONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL' | 'REFUTED';
}

function normalizeSignedDiagnoses(
  structuredData?: Record<string, unknown>
): { ok: true; diagnoses: SignedStructuredDiagnosis[] } | { ok: false; message: string } {
  const raw = structuredData?.diagnoses;
  if (raw === undefined) return { ok: true, diagnoses: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      message: 'acceptedStructuredData.diagnoses must be an array when supplied.',
    };
  }
  if (raw.length > 50) {
    return {
      ok: false,
      message: 'A signed clinical note may contain at most 50 structured diagnoses.',
    };
  }

  const seen = new Set<string>();
  const diagnoses: SignedStructuredDiagnosis[] = [];
  let principalCount = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: 'Each structured diagnosis must be an object.' };
    }
    const record = item as Record<string, unknown>;
    const code = String(record.code || '').trim().toUpperCase();
    const description = String(record.description || record.display || '').trim();
    if (!code || !description) {
      return {
        ok: false,
        message: 'Each structured diagnosis requires a code and description.',
      };
    }
    // This validates the ICD-10 shape only. The current in-process terminology
    // registry is intentionally not a fake complete ICD-10 catalogue.
    if (!/^[A-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/.test(code)) {
      return {
        ok: false,
        message: `Structured diagnosis code '${code}' is not a valid ICD-10-shaped code.`,
      };
    }
    if (code.length > 40 || description.length > 500) {
      return {
        ok: false,
        message: 'Structured diagnosis code or description exceeds allowed length.',
      };
    }
    if (seen.has(code)) {
      return {
        ok: false,
        message: `Duplicate structured diagnosis code '${code}' is not allowed.`,
      };
    }
    seen.add(code);

    const rawType = String(record.type || '').trim().toUpperCase();
    if (
      rawType &&
      !['PRINCIPAL', 'SECONDARY', 'PROVISIONAL', 'DIFFERENTIAL'].includes(rawType)
    ) {
      return {
        ok: false,
        message: `Unsupported structured diagnosis type '${rawType}'.`,
      };
    }

    const rawVerification = String(record.verificationStatus || '')
      .trim()
      .toUpperCase();
    if (
      rawVerification &&
      !['CONFIRMED', 'SUSPECTED', 'REFUTED'].includes(rawVerification)
    ) {
      return {
        ok: false,
        message: `Unsupported diagnosis verification status '${rawVerification}'.`,
      };
    }

    const isPrincipal = record.isPrincipal === true || rawType === 'PRINCIPAL';
    if (isPrincipal) principalCount += 1;

    const type: SignedStructuredDiagnosis['type'] =
      rawType === 'DIFFERENTIAL'
        ? 'DIFFERENTIAL'
        : rawType === 'PROVISIONAL'
          ? 'PROVISIONAL'
          : isPrincipal
            ? 'PRINCIPAL'
            : 'SECONDARY';

    const verificationStatus: SignedStructuredDiagnosis['verificationStatus'] =
      rawVerification === 'REFUTED'
        ? 'REFUTED'
        : type === 'DIFFERENTIAL'
          ? 'DIFFERENTIAL'
          : rawVerification === 'SUSPECTED' || type === 'PROVISIONAL'
            ? 'PROVISIONAL'
            : 'CONFIRMED';

    diagnoses.push({
      code,
      description,
      isPrincipal,
      type,
      verificationStatus,
    });
  }

  if (principalCount > 1) {
    return {
      ok: false,
      message: 'A signed consultation may contain at most one principal diagnosis.',
    };
  }

  return { ok: true, diagnoses };
}

export class ClinicalDocumentationDomainService {
  private static async validatePatientEncounter(
    tenantId: string,
    patientId: string,
    encounterId?: string
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      tenantId,
      'patients',
      patientId
    );
    if (!patient) {
      return { ok: false, code: 'PATIENT_NOT_FOUND', message: 'Patient record was not found.' };
    }
    if (!encounterId) return { ok: true };

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      tenantId,
      'encounters',
      encounterId
    );
    if (!encounter || String(encounter.patientId || '') !== patientId) {
      return {
        ok: false,
        code: 'ENCOUNTER_PATIENT_MISMATCH',
        message: 'Encounter was not found or belongs to a different patient.',
      };
    }
    return { ok: true };
  }

  public static async recordClinicalCondition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordClinicalConditionPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinical condition recording authority required.',
        },
      };
    }

    if (!payload.patientId || !payload.code?.trim() || !payload.display?.trim()) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CLINICAL_CONDITION',
          message: 'Patient, condition code and condition display are required.',
        },
      };
    }

    const lineage = await this.validatePatientEncounter(
      context.tenantId,
      payload.patientId,
      payload.encounterId
    );
    if (!lineage.ok) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: lineage.code, message: lineage.message },
      };
    }

    const conditionId = `cond_${crypto.randomUUID()}`;
    const recordedAt = Date.now();
    const condition = buildCanonicalCondition({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      conditionId,
      actorId: context.actorId,
      code: payload.code.trim(),
      display: payload.display.trim(),
      codingSystem: payload.codingSystem,
      category: payload.category,
      clinicalStatus: payload.clinicalStatus,
      verificationStatus: payload.verificationStatus,
      onsetAt: payload.onsetAt,
      recordedAt,
    });

    const knowledgeRecord =
      PatientClinicalKnowledgeDomainService.buildRecord({
        tenantId: context.tenantId,
        patientId: payload.patientId,
        domain: 'PROBLEM_LIST',
        status: 'KNOWN',
        actorId: context.actorId,
        reviewedAt: recordedAt,
        encounterId: payload.encounterId,
        reason: 'Condition recorded',
      });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CLINICAL_CONDITION',
      aggregateId: conditionId,
      eventType: 'CLINICAL_CONDITION_RECORDED',
      eventPayload: {
        conditionId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        code: payload.code.trim(),
        clinicalStatus: condition.clinicalStatus,
        verificationStatus: condition.verificationStatus,
        problemListKnowledgeStatus: 'KNOWN',
      },
      auditAction: 'RECORD_CLINICAL_CONDITION',
      auditResourceType: 'CLINICAL_CONDITION',
      auditResourceId: conditionId,
      auditReason: `Recorded condition ${payload.display.trim()} for patient ${payload.patientId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: condition,
      additionalStateWrites: [
        {
          entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
          entityId: PatientClinicalKnowledgeDomainService.documentId(
            payload.patientId,
            'PROBLEM_LIST'
          ),
          domainState: knowledgeRecord,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: conditionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: condition,
    };
  }

  public static async recordClinicalAllergy(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordClinicalAllergyPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'PHARMACIST', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinical allergy recording authority required.',
        },
      };
    }

    if (
      !payload.patientId ||
      !payload.substanceCode?.trim() ||
      !payload.substanceDisplay?.trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CLINICAL_ALLERGY',
          message: 'Patient, allergy substance code and display are required.',
        },
      };
    }

    const lineage = await this.validatePatientEncounter(
      context.tenantId,
      payload.patientId,
      payload.encounterId
    );
    if (!lineage.ok) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: lineage.code, message: lineage.message },
      };
    }

    const allergyId = `allergy_${crypto.randomUUID()}`;
    const recordedAt = Date.now();
    const allergy = buildCanonicalAllergy({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      allergyId,
      actorId: context.actorId,
      substanceCode: payload.substanceCode.trim(),
      substanceDisplay: payload.substanceDisplay.trim(),
      codingSystem: payload.codingSystem,
      type: payload.type,
      category: payload.category,
      criticality: payload.criticality,
      verificationStatus: payload.verificationStatus,
      reactionText: payload.reactionText,
      reactionSeverity: payload.reactionSeverity,
      recordedAt,
    });

    const knowledgeRecord =
      PatientClinicalKnowledgeDomainService.buildRecord({
        tenantId: context.tenantId,
        patientId: payload.patientId,
        domain: 'ALLERGIES',
        status: 'KNOWN',
        actorId: context.actorId,
        reviewedAt: recordedAt,
        encounterId: payload.encounterId,
        reason: 'Allergy or intolerance recorded',
      });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CLINICAL_ALLERGY',
      aggregateId: allergyId,
      eventType: 'CLINICAL_ALLERGY_RECORDED',
      eventPayload: {
        allergyId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        substanceCode: payload.substanceCode.trim(),
        criticality: allergy.criticality,
        verificationStatus: allergy.verificationStatus,
        allergyKnowledgeStatus: 'KNOWN',
      },
      auditAction: 'RECORD_CLINICAL_ALLERGY',
      auditResourceType: 'CLINICAL_ALLERGY',
      auditResourceId: allergyId,
      auditReason: `Recorded allergy/intolerance ${payload.substanceDisplay.trim()} for patient ${payload.patientId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: allergy,
      additionalStateWrites: [
        {
          entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
          entityId: PatientClinicalKnowledgeDomainService.documentId(
            payload.patientId,
            'ALLERGIES'
          ),
          domainState: knowledgeRecord,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: allergyId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: allergy,
    };
  }

  public static async recordVitals(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordVitalsPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'RECORD_VITALS',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Active credentialed vitals-recording authority required.',
        },
      };
    }

    const lineage = await this.validatePatientEncounter(
      context.tenantId,
      payload.patientId,
      payload.encounterId
    );
    if (!lineage.ok) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: lineage.code, message: lineage.message },
      };
    }

    const evidenceId = `ev_vitals_${crypto.randomUUID()}`;
    const measuredAt = payload.measuredAt || Date.now();
    const systolicBloodPressure = Number(String(payload.bloodPressure || '').split('/')[0]);
    const canCalculateNews2 =
      Number.isFinite(systolicBloodPressure) &&
      (payload.spO2Scale === 1 || payload.spO2Scale === 2) &&
      typeof payload.onSupplementalOxygen === 'boolean' &&
      (!!payload.consciousness || typeof payload.gcsScore === 'number');

    const news2 = canCalculateNews2
      ? calculateNEWS2({
          respirationRate: payload.respiratoryRate,
          spO2: payload.oxygenSaturation,
          spO2Scale: payload.spO2Scale!,
          onSupplementalOxygen: payload.onSupplementalOxygen!,
          systolicBP: systolicBloodPressure,
          heartRate: payload.heartRate,
          consciousness: payload.consciousness || 'Alert',
          gcsScore: payload.gcsScore,
          temperature: payload.temperature,
        })
      : null;

    const domainState = {
      evidenceId,
      evidenceType: 'VITALS',
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      heartRate: payload.heartRate,
      bloodPressure: payload.bloodPressure,
      temperature: payload.temperature,
      respiratoryRate: payload.respiratoryRate,
      oxygenSaturation: payload.oxygenSaturation,
      spO2Scale: payload.spO2Scale,
      onSupplementalOxygen: payload.onSupplementalOxygen,
      consciousness: payload.consciousness,
      gcsScore: payload.gcsScore,
      news2Score: news2?.score,
      news2Risk: news2?.riskLevel,
      news2RedTriggerParameters: news2?.redTriggerParameters,
      news2Status: news2 ? 'VERIFIED' : 'INCOMPLETE_INPUT',
      measuredAt,
      recordedBy: context.actorId,
      createdAt: Date.now(),
      status: 'FINAL',
    };

    const canonicalObservations = buildCanonicalVitalObservations({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      sourceEvidenceId: evidenceId,
      actorId: context.actorId,
      measuredAt,
      heartRate: payload.heartRate,
      bloodPressure: payload.bloodPressure,
      temperature: payload.temperature,
      respiratoryRate: payload.respiratoryRate,
      oxygenSaturation: payload.oxygenSaturation,
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER_EVIDENCE',
      aggregateId: evidenceId,
      eventType: 'VITALS_RECORDED',
      eventPayload: {
        evidenceId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        measuredAt,
        canonicalObservationIds: canonicalObservations.map((item) => item.observationId),
      },
      auditAction: 'RECORD_VITALS',
      auditResourceType: 'ENCOUNTER_EVIDENCE',
      auditResourceId: evidenceId,
      auditReason: `Recorded vitals for encounter ${payload.encounterId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: canonicalObservations.map((observation) => ({
        entityType: 'CLINICAL_OBSERVATION',
        entityId: observation.observationId,
        domainState: observation,
      })),
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: evidenceId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        ...domainState,
        canonicalObservationIds: canonicalObservations.map((item) => item.observationId),
      },
    };
  }


  public static async completeMedicationReconciliation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteMedicationReconciliationPayload
  ): Promise<CommandResult> {
    const normalizedRoles = new Set(
      context.roles.map((role) => String(role || '').trim().toUpperCase())
    );
    const auth = normalizedRoles.has('PHARMACIST')
      ? AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['PHARMACIST'],
          requiredPrivilege: 'DISPENSE_MEDICATION',
        })
      : AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['DOCTOR', 'CONSULTANT'],
          requiredPrivilege: 'PRESCRIBE',
        });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Medication reconciliation authority required.',
        },
      };
    }

    if (
      !payload.encounterId ||
      !payload.patientId ||
      !Array.isArray(payload.reconciledMedicationIds) ||
      !Number.isInteger(payload.discrepancyCount) ||
      payload.discrepancyCount < 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_MEDICATION_RECONCILIATION',
          message: 'Encounter, patient, reconciled medication list and non-negative discrepancy count are required.',
        },
      };
    }

    const unresolved = (payload.unresolvedDiscrepancies || []).filter(Boolean);
    if (unresolved.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_RECONCILIATION_INCOMPLETE',
          message: 'Unresolved medication discrepancies must be resolved before reconciliation can be finalized.',
          details: unresolved,
        },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter || encounter.patientId !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Encounter was not found or belongs to a different patient.',
        },
      };
    }

    const evidenceId = `ev_medrec_${crypto.randomUUID()}`;
    const completedAt = Date.now();
    const domainState = {
      evidenceId,
      evidenceType: 'MEDICATION_RECONCILIATION',
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      reconciledMedicationIds: payload.reconciledMedicationIds,
      discrepancyCount: payload.discrepancyCount,
      unresolvedDiscrepancies: [],
      notes: payload.notes,
      completedBy: context.actorId,
      completedAt,
      createdAt: completedAt,
      status: 'FINAL',
    };

    const medicationKnowledgeStatus =
      payload.reconciledMedicationIds.length > 0 ? 'KNOWN' : 'KNOWN_NONE';
    const knowledgeRecord =
      PatientClinicalKnowledgeDomainService.buildRecord({
        tenantId: context.tenantId,
        patientId: payload.patientId,
        domain: 'MEDICATIONS',
        status: medicationKnowledgeStatus,
        actorId: context.actorId,
        reviewedAt: completedAt,
        encounterId: payload.encounterId,
        reason: 'Medication reconciliation completed',
      });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER_EVIDENCE',
      aggregateId: evidenceId,
      eventType: 'MEDICATION_RECONCILIATION_COMPLETED',
      eventPayload: {
        evidenceId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        discrepancyCount: payload.discrepancyCount,
        reconciledMedicationCount: payload.reconciledMedicationIds.length,
        medicationKnowledgeStatus,
      },
      auditAction: 'COMPLETE_MEDICATION_RECONCILIATION',
      auditResourceType: 'ENCOUNTER_EVIDENCE',
      auditResourceId: evidenceId,
      auditReason: `Completed medication reconciliation for encounter ${payload.encounterId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
          entityId: PatientClinicalKnowledgeDomainService.documentId(
            payload.patientId,
            'MEDICATIONS'
          ),
          domainState: knowledgeRecord,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: evidenceId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        ...domainState,
        medicationKnowledgeStatus,
      },
    };
  }

  public static async signClinicalNote(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: SignClinicalNotePayload
  ): Promise<CommandResult> {
    const auth = payload.category === 'NURSING'
      ? AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
        })
      : AuthorizationPipeline.evaluate(context, {
          requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
          requiredPrivilege: 'SIGN_CLINICAL_NOTES',
        });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Active clinical-note signing privilege required.',
        },
      };
    }

    if (!payload.content || payload.content.trim().length < 3) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CLINICAL_NOTE',
          message: 'Signed clinical note content is required.',
        },
      };
    }

    const lineage = await this.validatePatientEncounter(
      context.tenantId,
      payload.patientId,
      payload.encounterId
    );
    if (!lineage.ok) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: lineage.code, message: lineage.message },
      };
    }

    const normalizedDiagnoses = normalizeSignedDiagnoses(payload.acceptedStructuredData);
    if (!normalizedDiagnoses.ok) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STRUCTURED_DIAGNOSES',
          message: normalizedDiagnoses.message,
        },
      };
    }

    if (payload.category === 'NURSING' && normalizedDiagnoses.diagnoses.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSIS_AUTHORITY_REQUIRED',
          message:
            'Nursing-note authority cannot create canonical encounter diagnoses. Use an authorized clinician note or diagnosis command.',
        },
      };
    }

    if (payload.sourceDraftId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CI10F_LEGACY_AI_DRAFT_SIGNING_DISABLED',
          message: 'AI-generated clinical content must use the governed CI-10F review, edit, approval, and signature workflow.',
        },
      };
    }

    const evidenceId = `ev_note_${crypto.randomUUID()}`;
    const signedAt = Date.now();
    const canonicalConditions = normalizedDiagnoses.diagnoses.map((diagnosis, index) =>
      buildCanonicalCondition({
        tenantId: context.tenantId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        conditionId: `cond_${evidenceId}_dx_${index + 1}`,
        sourceEvidenceId: evidenceId,
        actorId: context.actorId,
        code: diagnosis.code,
        display: diagnosis.description,
        codingSystem: 'ICD10',
        category: 'ENCOUNTER_DIAGNOSIS',
        clinicalStatus: 'ACTIVE',
        verificationStatus: diagnosis.verificationStatus,
        recordedAt: signedAt,
      })
    );

    const domainState = {
      evidenceId,
      evidenceType: 'SIGNED_CLINICAL_NOTE',
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      category: payload.category,
      content: payload.content,
      sourceDraftId: payload.sourceDraftId,
      acceptedStructuredData: payload.acceptedStructuredData,
      signedBy: context.actorId,
      signedAt,
      createdAt: signedAt,
      status: 'FINAL',
    };

    const canonicalDocument = buildCanonicalClinicalDocument({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      sourceEvidenceId: evidenceId,
      actorId: context.actorId,
      category: payload.category,
      content: payload.content,
      signedAt,
      sourceDraftId: payload.sourceDraftId,
      structuredData: payload.acceptedStructuredData,
    });

    // A signed note may create Revenue Integrity *candidates*, never automatic charges.
    // Only explicitly clinician-accepted structured billing codes are considered.
    const structured = payload.acceptedStructuredData || {};
    const billingCodes = Array.isArray(structured.billingCodes) ? structured.billingCodes : [];
    const revenueIntegrityFindings: RevenueIntegrityFinding[] = billingCodes.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const candidate = raw as Record<string, unknown>;
      const code = String(candidate.code || '').trim();
      const description = String(candidate.description || '').trim();
      const fee = Number(candidate.fee);

      if (!code || !description || !Number.isFinite(fee) || fee <= 0) return [];

      const findingId = `ri_${evidenceId}_${index}`;
      return [{
        id: findingId,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        sourceEvidenceId: evidenceId,
        sourceNoteId: evidenceId,
        documentedItem: description,
        category: 'Procedure' as const,
        suggestedCode: code,
        estimatedRecoverableAmountMinorUnits: Math.round(fee * 100),
        currency: 'USD',
        status: 'PENDING_REVIEW' as const,
        evidenceSnippet: payload.content.slice(0, 240),
        createdAt: signedAt,
        createdBy: context.actorId,
      }];
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER_EVIDENCE',
      aggregateId: evidenceId,
      eventType: 'CLINICAL_NOTE_SIGNED',
      eventPayload: {
        evidenceId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        category: payload.category,
        sourceDraftId: payload.sourceDraftId,
        revenueIntegrityFindingIds: revenueIntegrityFindings.map((finding) => finding.id),
        canonicalConditionIds: canonicalConditions.map((condition) => condition.conditionId),
        structuredDiagnoses: normalizedDiagnoses.diagnoses.map((diagnosis) => ({
          code: diagnosis.code,
          description: diagnosis.description,
          isPrincipal: diagnosis.isPrincipal,
          type: diagnosis.type,
          verificationStatus: diagnosis.verificationStatus,
        })),
      },
      auditAction: 'SIGN_CLINICAL_NOTE',
      auditResourceType: 'ENCOUNTER_EVIDENCE',
      auditResourceId: evidenceId,
      auditReason: `Signed ${payload.category} note for encounter ${payload.encounterId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'CLINICAL_DOCUMENT',
          entityId: canonicalDocument.clinicalDocumentId,
          domainState: canonicalDocument,
        },
        ...canonicalConditions.map((condition) => ({
          entityType: 'CLINICAL_CONDITION',
          entityId: condition.conditionId,
          domainState: condition,
        })),
        ...revenueIntegrityFindings.map((finding) => ({
          entityType: 'REVENUE_INTEGRITY_FINDING',
          entityId: finding.id,
          domainState: finding,
        })),
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: evidenceId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        ...domainState,
        canonicalDocumentId: canonicalDocument.clinicalDocumentId,
        canonicalConditionIds: canonicalConditions.map((condition) => condition.conditionId),
        canonicalConditions,
        revenueIntegrityFindings,
      },
    };
  }
}
