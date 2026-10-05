import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalTrendEngine } from '@/lib/clinical/intelligence/clinical-trend-engine';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import type { ClinicalEvidenceSnapshot } from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalTrendEvidenceIndexItem,
  ClinicalTrendIntelligenceArtifact,
  ClinicalTrendIntelligenceResponse,
} from '@/types/clinical-trend-intelligence';

const POLICY_VERSION = 'ci10d-clinical-trend-v1' as const;

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const item = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(item)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) + ':' + canonicalStringify(item[key])
      )
      .join(',') +
    '}'
  );
}

function hash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(canonicalStringify(value))
    .digest('hex');
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function evidenceIndex(
  snapshot: ClinicalEvidenceSnapshot
): ClinicalTrendEvidenceIndexItem[] {
  return snapshot.evidenceRefs.map((item) => ({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    sourceEntityId: item.sourceEntityId,
    label: item.label,
    status: item.status,
    occurredAt: item.occurredAt,
    provenanceStatus: item.provenanceStatus,
    sourceEventIds: item.sourceEventIds,
    contentHash: item.contentHash,
    content: item.content,
  }));
}

export class ClinicalTrendIntelligenceService {
  public static build(
    snapshot: ClinicalEvidenceSnapshot,
    actorId: string,
    generatedAt = Date.now()
  ): ClinicalTrendIntelligenceArtifact {
    if (snapshot.purpose !== 'TREND_EXPLANATION') {
      throw new Error('CI10D_EVIDENCE_PURPOSE_MISMATCH');
    }

    const computed = ClinicalTrendEngine.compute(snapshot);
    const explanationClaims = computed.metrics
      .map((item) => item.explanation)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const grounding = ClinicalEvidenceService.validateClaims(
      snapshot,
      explanationClaims
    );
    if (!grounding.valid) {
      throw new Error(
        `CI10D_GROUNDING_VALIDATION_FAILED:${grounding.errors.join(',')}`
      );
    }

    const projectionOnly = snapshot.evidenceRefs.filter(
      (item) => item.provenanceStatus === 'PROJECTION_ONLY'
    ).length;
    const computedMetricCount = computed.metrics.filter(
      (item) => item.status === 'COMPUTED'
    ).length;
    const nonComputableMetricCount =
      computed.metrics.length - computedMetricCount;

    const warnings = Array.from(
      new Set([
        ...snapshot.limitations,
        'Trend output is descriptive only. Direction, magnitude, slope and source abnormality markers require clinician interpretation.',
        'CI-10D does not perform implicit unit conversion. Mixed explicit units suppress trend computation until a governed conversion rule exists.',
        'CI-10D does not infer diagnosis, causality, severity or treatment from a numeric trajectory.',
        ...(projectionOnly > 0
          ? [
              `${projectionOnly} evidence item(s) have projection-only provenance and should be checked against source records when material to a clinical decision.`,
            ]
          : []),
        ...(computed.excludedEvidence.length > 0
          ? [
              `${computed.excludedEvidence.length} observation evidence item(s) were excluded from trend computation by deterministic safety rules.`,
            ]
          : []),
      ])
    );

    const body = {
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
      policyVersion: POLICY_VERSION,
      generationMode: 'DETERMINISTIC_TREND_ENGINE' as const,
      metrics: computed.metrics,
      excludedEvidence: computed.excludedEvidence,
      computedMetricCount,
      nonComputableMetricCount,
      warnings,
      safety: {
        sourceLinked: true as const,
        deterministicComputation: true as const,
        clinicianInterpretationRequired: true as const,
        autonomousDiagnosisAllowed: false as const,
        autonomousTreatmentAllowed: false as const,
        autonomousOrdersAllowed: false as const,
        directClinicalMutationAllowed: false as const,
      },
    };

    const contentHash = hash(body);
    const artifactId = stableId('citrend', [
      snapshot.tenantId,
      snapshot.patientId,
      snapshot.snapshotId,
      POLICY_VERSION,
      contentHash,
    ]);

    const artifact: ClinicalTrendIntelligenceArtifact = {
      artifactId,
      tenantId: snapshot.tenantId,
      patientId: snapshot.patientId,
      generatedAt,
      generatedBy: actorId,
      immutable: true,
      schemaVersion: 1,
      ...body,
      contentHash,
    };

    const bytes = Buffer.byteLength(
      JSON.stringify(sanitizeForFirestore(artifact)),
      'utf8'
    );
    if (bytes > 700_000) {
      throw new Error(`CI10D_ARTIFACT_TOO_LARGE:${bytes}`);
    }

    return artifact;
  }

  public static async generateAuthoritatively(
    context: CommandContext,
    patientId: string
  ): Promise<ClinicalTrendIntelligenceResponse> {
    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      'TREND_EXPLANATION'
    );

    const proposed = this.build(snapshot, context.actorId);
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10D_TREND_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const artifactRef = tenantRef
      .collection('clinicalTrendIntelligence')
      .doc(proposed.artifactId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(artifactRef);
      if (existing.exists) {
        const persisted =
          existing.data() as ClinicalTrendIntelligenceArtifact;
        if (
          persisted.contentHash !== proposed.contentHash ||
          persisted.evidenceSnapshotId !== snapshot.snapshotId ||
          persisted.patientId !== patientId ||
          persisted.tenantId !== context.tenantId
        ) {
          throw new Error('CI10D_TREND_IMMUTABILITY_VIOLATION');
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
        aggregateType: 'CLINICAL_TREND_INTELLIGENCE',
        aggregateId: proposed.artifactId,
        eventType: 'CLINICAL_TREND_INTELLIGENCE_GENERATED',
        eventVersion: 1,
        payload: {
          artifactId: proposed.artifactId,
          patientId,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          patient360Revision: snapshot.patient360Revision,
          computedMetricCount: proposed.computedMetricCount,
          nonComputableMetricCount: proposed.nonComputableMetricCount,
          contentHash: proposed.contentHash,
          policyVersion: proposed.policyVersion,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10d-trend:${proposed.artifactId}`,
        idempotencyKey: proposed.artifactId,
        source: 'system',
        schemaVersion: 1,
      };

      transaction.create(
        artifactRef,
        sanitizeForFirestore(proposed)
      );
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
          action: 'GENERATE_CLINICAL_TREND_INTELLIGENCE',
          resourceType: 'CLINICAL_TREND_INTELLIGENCE',
          resourceId: proposed.artifactId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Generated deterministic clinical trend intelligence for patient ${patientId}`,
          metadata: {
            patientId,
            evidenceSnapshotId: snapshot.snapshotId,
            evidenceSnapshotHash: snapshot.snapshotHash,
            computedMetricCount: proposed.computedMetricCount,
            nonComputableMetricCount:
              proposed.nonComputableMetricCount,
            contentHash: proposed.contentHash,
            policyVersion: proposed.policyVersion,
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

    const persisted = await artifactRef.get();
    if (!persisted.exists) {
      throw new Error('CI10D_TREND_PERSISTENCE_FAILED');
    }

    return {
      artifact:
        persisted.data() as ClinicalTrendIntelligenceArtifact,
      evidenceIndex: evidenceIndex(snapshot),
    };
  }

  public static async get(
    tenantId: string,
    artifactId: string
  ): Promise<ClinicalTrendIntelligenceArtifact | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10D_TREND_STORE_UNAVAILABLE');

    const document = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('clinicalTrendIntelligence')
      .doc(artifactId)
      .get();

    return document.exists
      ? (document.data() as ClinicalTrendIntelligenceArtifact)
      : null;
  }
}
