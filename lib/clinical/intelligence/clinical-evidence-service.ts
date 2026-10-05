import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import type {
  Patient360AllergySummary,
  Patient360ConditionSummary,
  Patient360DocumentSummary,
  Patient360EncounterSummary,
  Patient360MedicationSummary,
  Patient360ObservationSummary,
  Patient360Projection,
  Patient360ResultSummary,
} from '@/types/patient360-projection';
import type {
  ClaimGroundingResult,
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
  ClinicalEvidenceSourceType,
  ClinicalIntelligencePurpose,
  CopilotClaim,
  GovernedClinicalIntelligenceResult,
} from '@/types/clinical-intelligence-evidence';

type SourceEvent = Awaited<
  ReturnType<typeof Patient360ProjectionService.loadPatientEvents>
>[number];

type EvidenceCandidate = {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  content: unknown;
};

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalStringify(record[key]))
    .join(',') + '}';
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function eventReferencesEntity(event: SourceEvent, entityId: string): boolean {
  if (!entityId) return false;
  if (String(event.aggregateId || '') === entityId) return true;

  const payload = event.payload || {};
  return Object.values(payload).some((value) => {
    if (String(value || '') === entityId) return true;
    if (Array.isArray(value)) {
      return value.some((item) => String(item || '') === entityId);
    }
    return false;
  });
}

function provenanceFor(
  events: SourceEvent[],
  entityId: string,
  patientId: string,
  sourceType: ClinicalEvidenceSourceType
) {
  const matches = events.filter((event) => {
    if (eventReferencesEntity(event, entityId)) return true;
    if (sourceType === 'PATIENT_IDENTITY') {
      return (
        String(event.aggregateId || '') === patientId &&
        ['PATIENT', 'PATIENT_MPI'].includes(
          String(event.aggregateType || '').toUpperCase()
        )
      );
    }
    if (sourceType === 'KNOWLEDGE_STATUS') {
      return (
        String(event.payload?.patientId || '') === patientId &&
        /KNOWLEDGE|RECONCILIATION|ALLERGY|PROBLEM|MEDICATION/i.test(
          String(event.eventType || '')
        )
      );
    }
    return false;
  });

  const sourceEventIds = matches.map((event) => event.eventId).sort();
  const latest = [...matches].sort(
    (left, right) =>
      Number(right.recordedAt || right.occurredAt || 0) -
        Number(left.recordedAt || left.occurredAt || 0) ||
      String(right.eventId).localeCompare(String(left.eventId))
  )[0];

  return {
    sourceEventIds,
    sourceEventCount: sourceEventIds.length,
    sourceEventSetHash: hash(sourceEventIds),
    latestSourceEventId: latest?.eventId,
    recordedAt: asNumber(latest?.recordedAt),
  };
}

function candidateFromEncounter(item: Patient360EncounterSummary): EvidenceCandidate {
  return {
    sourceType: 'ENCOUNTER',
    sourceEntityId: item.encounterId,
    label: `${item.careSetting} encounter`,
    status: item.status,
    occurredAt:
      typeof item.startedAt === 'number' ? item.startedAt : undefined,
    content: item,
  };
}

function candidateFromCondition(item: Patient360ConditionSummary): EvidenceCandidate {
  return {
    sourceType: 'CONDITION',
    sourceEntityId: item.conditionId,
    label: item.display,
    status: `${item.clinicalStatus}/${item.verificationStatus}`,
    occurredAt: item.onsetAt,
    content: item,
  };
}

function candidateFromAllergy(item: Patient360AllergySummary): EvidenceCandidate {
  return {
    sourceType: 'ALLERGY',
    sourceEntityId: item.allergyId,
    label: item.substance,
    status: `${item.criticality}/${item.verificationStatus}`,
    content: item,
  };
}

function candidateFromMedication(item: Patient360MedicationSummary): EvidenceCandidate {
  return {
    sourceType: 'MEDICATION',
    sourceEntityId: item.medicationOrderId,
    label: item.medication,
    status: item.status,
    occurredAt: item.authoredAt,
    content: item,
  };
}

function candidateFromObservation(item: Patient360ObservationSummary): EvidenceCandidate {
  return {
    sourceType: 'OBSERVATION',
    sourceEntityId: item.observationId,
    label: item.display,
    status: item.status,
    occurredAt: item.effectiveAt,
    content: item,
  };
}

function candidateFromResult(item: Patient360ResultSummary): EvidenceCandidate {
  return {
    sourceType: 'DIAGNOSTIC_REPORT',
    sourceEntityId: item.diagnosticReportId,
    label: item.display,
    status: item.status,
    occurredAt: item.issuedAt,
    content: item,
  };
}

function candidateFromDocument(item: Patient360DocumentSummary): EvidenceCandidate {
  return {
    sourceType: 'CLINICAL_DOCUMENT',
    sourceEntityId: item.clinicalDocumentId,
    label: item.title || item.documentType,
    status: item.status,
    occurredAt: item.signedAt,
    content: item,
  };
}

function candidatesFromProjection(projection: Patient360Projection): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [
    {
      sourceType: 'PATIENT_IDENTITY',
      sourceEntityId: projection.patientId,
      label: projection.identity.fullName || projection.patientId,
      status: projection.identity.status,
      content: projection.identity,
    },
    ...projection.recentEncounters.map(candidateFromEncounter),
    ...projection.activeProblems.map(candidateFromCondition),
    ...projection.resolvedProblems.map(candidateFromCondition),
    ...projection.allergies.map(candidateFromAllergy),
    ...projection.currentMedications.map(candidateFromMedication),
    ...projection.latestVitals.map(candidateFromObservation),
    ...projection.recentResults.map(candidateFromResult),
    ...projection.recentDocuments.map(candidateFromDocument),
    {
      sourceType: 'KNOWLEDGE_STATUS',
      sourceEntityId: `${projection.patientId}:knowledge-status`,
      label: 'Patient clinical knowledge status',
      occurredAt: Math.max(
        Number(projection.dataQuality.lastAllergyReviewAt || 0),
        Number(projection.dataQuality.lastProblemListReviewAt || 0),
        Number(projection.dataQuality.lastMedicationReconciliationAt || 0)
      ) || undefined,
      content: projection.dataQuality,
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceType}:${candidate.sourceEntityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toEvidenceRef(
  projection: Patient360Projection,
  candidate: EvidenceCandidate,
  events: SourceEvent[]
): ClinicalEvidenceRef {
  const provenance = provenanceFor(
    events,
    candidate.sourceEntityId,
    projection.patientId,
    candidate.sourceType
  );
  const contentHash = hash(candidate.content);

  return {
    evidenceId: stableId('evidence', [
      projection.tenantId,
      projection.patientId,
      candidate.sourceType,
      candidate.sourceEntityId,
      contentHash,
      provenance.sourceEventSetHash,
    ]),
    tenantId: projection.tenantId,
    patientId: projection.patientId,
    sourceType: candidate.sourceType,
    sourceEntityId: candidate.sourceEntityId,
    label: candidate.label,
    status: candidate.status,
    occurredAt: candidate.occurredAt,
    recordedAt: provenance.recordedAt,
    patient360Revision: projection.revision,
    patient360SourceCheckpoint: projection.sourceCheckpoint,
    sourceEventIds: provenance.sourceEventIds,
    sourceEventCount: provenance.sourceEventCount,
    sourceEventSetHash: provenance.sourceEventSetHash,
    latestSourceEventId: provenance.latestSourceEventId,
    contentHash,
  };
}

export class ClinicalEvidenceService {
  public static buildSnapshot(
    projection: Patient360Projection,
    events: SourceEvent[],
    purpose: ClinicalIntelligencePurpose,
    actorId: string,
    createdAt = Date.now()
  ): ClinicalEvidenceSnapshot {
    if (!projection.tenantId || !projection.patientId) {
      throw new Error('CI10_EVIDENCE_SCOPE_INVALID');
    }

    const evidenceRefs = candidatesFromProjection(projection)
      .map((candidate) => toEvidenceRef(projection, candidate, events))
      .sort(
        (left, right) =>
          left.sourceType.localeCompare(right.sourceType) ||
          left.sourceEntityId.localeCompare(right.sourceEntityId)
      );

    if (evidenceRefs.some(
      (item) =>
        item.tenantId !== projection.tenantId ||
        item.patientId !== projection.patientId
    )) {
      throw new Error('CI10_EVIDENCE_SCOPE_MISMATCH');
    }

    const occurredTimes = evidenceRefs
      .map((item) => item.occurredAt)
      .filter((value): value is number => typeof value === 'number');

    const immutableBasis = {
      tenantId: projection.tenantId,
      patientId: projection.patientId,
      purpose,
      projectionVersion: projection.projectionVersion,
      revision: projection.revision,
      sourceCheckpoint: projection.sourceCheckpoint,
      patient360ContentHash: projection.contentHash,
      evidence: evidenceRefs.map((item) => ({
        evidenceId: item.evidenceId,
        contentHash: item.contentHash,
        sourceEventSetHash: item.sourceEventSetHash,
      })),
    };

    const snapshotHash = hash(immutableBasis);
    const snapshotId = stableId('cisnap', [
      projection.tenantId,
      projection.patientId,
      purpose,
      String(projection.projectionVersion),
      String(projection.revision),
      projection.sourceCheckpoint,
      projection.contentHash,
      snapshotHash,
    ]);

    return {
      snapshotId,
      tenantId: projection.tenantId,
      patientId: projection.patientId,
      purpose,
      createdAt,
      createdBy: actorId,
      immutable: true,
      schemaVersion: 1,
      patient360ProjectionVersion: projection.projectionVersion,
      patient360Revision: projection.revision,
      patient360SourceCheckpoint: projection.sourceCheckpoint,
      patient360ContentHash: projection.contentHash,
      evidenceRefs,
      evidenceCount: evidenceRefs.length,
      sourceEventCount: new Set(
        evidenceRefs.flatMap((item) => item.sourceEventIds)
      ).size,
      dateRange: {
        from: occurredTimes.length ? Math.min(...occurredTimes) : undefined,
        to: occurredTimes.length ? Math.max(...occurredTimes) : undefined,
      },
      snapshotHash,
      limitations: [
        'This snapshot contains only evidence represented in the current Patient 360 projection contract.',
        'Missing or incomplete source data must not be interpreted as clinical absence.',
        'The snapshot is evidence for clinician review and is not an autonomous diagnosis or treatment decision.',
      ],
    };
  }

  public static validateClaims(
    snapshot: ClinicalEvidenceSnapshot,
    claims: CopilotClaim[]
  ): ClaimGroundingResult {
    const errors: string[] = [];
    const evidenceIds = new Set(snapshot.evidenceRefs.map((item) => item.evidenceId));
    const claimIds = new Set<string>();

    for (const claim of claims) {
      if (!claim.claimId?.trim()) {
        errors.push('CLAIM_ID_REQUIRED');
      } else if (claimIds.has(claim.claimId)) {
        errors.push(`DUPLICATE_CLAIM_ID:${claim.claimId}`);
      } else {
        claimIds.add(claim.claimId);
      }

      if (!claim.text?.trim()) {
        errors.push(`CLAIM_TEXT_REQUIRED:${claim.claimId || 'unknown'}`);
      }

      if (
        claim.classification !== 'UNCERTAIN' &&
        claim.classification !== 'DRAFT' &&
        claim.evidenceRefs.length === 0
      ) {
        errors.push(`CLAIM_EVIDENCE_REQUIRED:${claim.claimId}`);
      }

      for (const evidenceId of claim.evidenceRefs) {
        if (!evidenceIds.has(evidenceId)) {
          errors.push(`CLAIM_EVIDENCE_OUTSIDE_SNAPSHOT:${claim.claimId}:${evidenceId}`);
        }
      }

      if (
        claim.confidence !== undefined &&
        (!Number.isFinite(claim.confidence) ||
          claim.confidence < 0 ||
          claim.confidence > 1)
      ) {
        errors.push(`CLAIM_CONFIDENCE_INVALID:${claim.claimId}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  public static validateGeneratedResult(
    snapshot: ClinicalEvidenceSnapshot,
    result: GovernedClinicalIntelligenceResult
  ): ClaimGroundingResult {
    const grounding = this.validateClaims(snapshot, result.claims);
    const errors = [...grounding.errors];

    if (result.proposedClinicalActions?.length) {
      errors.push('AUTONOMOUS_CLINICAL_ACTIONS_NOT_ALLOWED');
    }
    if (result.promptPolicyVersion.trim() === '') {
      errors.push('PROMPT_POLICY_VERSION_REQUIRED');
    }
    if (!result.provider.trim() || !result.model.trim()) {
      errors.push('MODEL_PROVENANCE_REQUIRED');
    }

    return { valid: errors.length === 0, errors };
  }

  public static async createAuthoritativeSnapshot(
    context: CommandContext,
    patientId: string,
    purpose: ClinicalIntelligencePurpose
  ): Promise<ClinicalEvidenceSnapshot> {
    const [projection, events] = await Promise.all([
      Patient360ProjectionService.getProjection(context.tenantId, patientId),
      Patient360ProjectionService.loadPatientEvents(context.tenantId, patientId),
    ]);

    if (!projection) {
      throw new Error('CI10_PATIENT360_PROJECTION_NOT_READY');
    }
    if (
      projection.tenantId !== context.tenantId ||
      projection.patientId !== patientId
    ) {
      throw new Error('CI10_PATIENT360_SCOPE_MISMATCH');
    }

    const snapshot = this.buildSnapshot(
      projection,
      events,
      purpose,
      context.actorId
    );

    const db = getAdminFirestore();
    if (!db) {
      throw new Error('CI10_EVIDENCE_STORE_UNAVAILABLE');
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const snapshotRef = tenantRef
      .collection('clinicalIntelligenceEvidenceSnapshots')
      .doc(snapshot.snapshotId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(snapshotRef);
      if (existing.exists) {
        const persisted = existing.data() as ClinicalEvidenceSnapshot;
        if (
          persisted.snapshotHash !== snapshot.snapshotHash ||
          persisted.patientId !== patientId ||
          persisted.tenantId !== context.tenantId
        ) {
          throw new Error('CI10_EVIDENCE_IMMUTABILITY_VIOLATION');
        }
        return;
      }

      const now = Date.now();
      const eventId = `evt_${crypto.randomUUID()}`;
      const auditId = `aud_${crypto.randomUUID()}`;
      const outboxId = `obx_${crypto.randomUUID()}`;

      const event: DomainEventEnvelope = {
        eventId,
        tenantId: context.tenantId,
        aggregateType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT',
        aggregateId: snapshot.snapshotId,
        eventType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
        eventVersion: 1,
        payload: {
          snapshotId: snapshot.snapshotId,
          patientId,
          purpose,
          patient360Revision: snapshot.patient360Revision,
          patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
          snapshotHash: snapshot.snapshotHash,
          evidenceCount: snapshot.evidenceCount,
          sourceEventCount: snapshot.sourceEventCount,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10-snapshot:${snapshot.snapshotId}`,
        idempotencyKey: snapshot.snapshotId,
        source: 'system',
        schemaVersion: 1,
      };

      transaction.create(snapshotRef, sanitizeForFirestore(snapshot));
      transaction.create(
        tenantRef.collection('events').doc(eventId),
        sanitizeForFirestore(event)
      );
      transaction.create(
        tenantRef.collection('audit_logs').doc(auditId),
        sanitizeForFirestore({
          auditId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          actorRole: context.roles[0] || 'CLINICIAN',
          action: 'CREATE_CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT',
          resourceType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT',
          resourceId: snapshot.snapshotId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Created immutable ${purpose} evidence snapshot for patient ${patientId}`,
          metadata: {
            patientId,
            purpose,
            snapshotHash: snapshot.snapshotHash,
            patient360Revision: snapshot.patient360Revision,
            patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
          },
        })
      );
      transaction.create(
        tenantRef.collection('outbox').doc(outboxId),
        sanitizeForFirestore({
          outboxId,
          tenantId: context.tenantId,
          eventId,
          eventType: event.eventType,
          topic: 'g-hims-clinical-intelligence-events',
          payload: event.payload,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: now,
          createdAt: now,
        })
      );
    });

    const persisted = await snapshotRef.get();
    if (!persisted.exists) {
      throw new Error('CI10_EVIDENCE_PERSISTENCE_FAILED');
    }
    return persisted.data() as ClinicalEvidenceSnapshot;
  }

  public static async getSnapshot(
    tenantId: string,
    snapshotId: string
  ): Promise<ClinicalEvidenceSnapshot | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10_EVIDENCE_STORE_UNAVAILABLE');

    const document = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('clinicalIntelligenceEvidenceSnapshots')
      .doc(snapshotId)
      .get();

    return document.exists
      ? (document.data() as ClinicalEvidenceSnapshot)
      : null;
  }
}
