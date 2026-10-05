import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { MedicationReconciliationCopilotEngine } from '@/lib/clinical/intelligence/medication-reconciliation-copilot-engine';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { ClinicalEvidenceSnapshot } from '@/types/clinical-intelligence-evidence';
import type {
  MedicationReconciliationCopilotArtifact,
  MedicationReconciliationCopilotResponse,
  MedicationReconciliationEvidenceIndexItem,
} from '@/types/medication-reconciliation-copilot';

const POLICY_VERSION = 'ci10e-medication-reconciliation-v1' as const;

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
      .map((key) => JSON.stringify(key) + ':' + canonicalStringify(item[key]))
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
): MedicationReconciliationEvidenceIndexItem[] {
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

export class MedicationReconciliationCopilotService {
  public static build(
    snapshot: ClinicalEvidenceSnapshot,
    encounterId: string,
    careSetting: ClinicalCareSetting,
    actorId: string,
    generatedAt = Date.now()
  ): MedicationReconciliationCopilotArtifact {
    const findings = MedicationReconciliationCopilotEngine.compute(
      snapshot,
      encounterId
    );

    const counts = {
      total: findings.length,
      critical: findings.filter(
        (item) => item.severity === 'CRITICAL_REVIEW_REQUIRED'
      ).length,
      actionRequired: findings.filter(
        (item) => item.severity === 'ACTION_REQUIRED'
      ).length,
      reviewRequired: findings.filter(
        (item) => item.severity === 'REVIEW_REQUIRED'
      ).length,
      information: findings.filter(
        (item) => item.severity === 'INFORMATION'
      ).length,
    };

    const coverage = {
      orders:
        snapshot.coverage?.medicationOrders?.recordCount || 0,
      dispenses:
        snapshot.coverage?.medicationDispenses?.recordCount || 0,
      administrations:
        snapshot.coverage?.medicationAdministrations?.recordCount || 0,
      reconciliationRecords:
        snapshot.coverage?.medicationReconciliations?.recordCount || 0,
      allergies:
        snapshot.coverage?.medicationAllergies?.recordCount || 0,
      ci9Findings:
        snapshot.coverage?.medicationSafety?.recordCount || 0,
    };

    const warnings = Array.from(
      new Set([
        ...snapshot.limitations,
        'CI-10E identifies evidence-backed medication reconciliation discrepancies and coverage gaps for clinician/pharmacist review.',
        'CI-10E cannot start, stop, resume, substitute, prescribe, dose-adjust, administer, dispense, complete reconciliation, or sign medication therapy.',
        'Pre-encounter active medication evidence is not automatically a verified home-medication list.',
        'Absence of dispense or administration evidence is not proof that medication was not obtained or administered.',
        ...(snapshot.coverage?.medicationSafety?.status === 'NOT_INCLUDED'
          ? [
              'A current CI-9 medication-safety projection was not included; allergy/duplicate safety coverage may be incomplete.',
            ]
          : []),
      ])
    );

    const body = {
      encounterId,
      careSetting,
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint:
        snapshot.patient360SourceCheckpoint,
      policyVersion: POLICY_VERSION,
      generationMode:
        'DETERMINISTIC_MEDICATION_RECONCILIATION' as const,
      findings,
      counts,
      coverage,
      warnings,
      safety: {
        sourceLinked: true as const,
        clinicianReviewRequired: true as const,
        canStartMedication: false as const,
        canStopMedication: false as const,
        canResumeMedication: false as const,
        canChangeDose: false as const,
        canCompleteReconciliation: false as const,
        canSignMedicationOrder: false as const,
        directClinicalMutationAllowed: false as const,
      },
    };

    const contentHash = hash(body);
    const artifactId = stableId('medrecartifact', [
      snapshot.tenantId,
      snapshot.patientId,
      encounterId,
      snapshot.snapshotId,
      POLICY_VERSION,
      contentHash,
    ]);

    const artifact: MedicationReconciliationCopilotArtifact = {
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
      throw new Error(`CI10E_ARTIFACT_TOO_LARGE:${bytes}`);
    }

    return artifact;
  }

  public static async generateAuthoritatively(
    context: CommandContext,
    patientId: string,
    encounterId: string,
    careSetting: ClinicalCareSetting
  ): Promise<MedicationReconciliationCopilotResponse> {
    const snapshot =
      await ClinicalEvidenceService.createAuthoritativeSnapshot(
        context,
        patientId,
        'MEDICATION_RECONCILIATION',
        { encounterId, careSetting }
      );

    const proposed = this.build(
      snapshot,
      encounterId,
      careSetting,
      context.actorId
    );

    const db = getAdminFirestore();
    if (!db) throw new Error('CI10E_ARTIFACT_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const artifactRef = tenantRef
      .collection('medicationReconciliationCopilotArtifacts')
      .doc(proposed.artifactId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(artifactRef);
      if (existing.exists) {
        const persisted =
          existing.data() as MedicationReconciliationCopilotArtifact;
        if (
          persisted.contentHash !== proposed.contentHash ||
          persisted.evidenceSnapshotId !== snapshot.snapshotId ||
          persisted.patientId !== patientId ||
          persisted.encounterId !== encounterId ||
          persisted.tenantId !== context.tenantId
        ) {
          throw new Error('CI10E_ARTIFACT_IMMUTABILITY_VIOLATION');
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
        aggregateType: 'MEDICATION_RECONCILIATION_COPILOT',
        aggregateId: proposed.artifactId,
        eventType: 'MEDICATION_RECONCILIATION_COPILOT_GENERATED',
        eventVersion: 1,
        payload: {
          artifactId: proposed.artifactId,
          patientId,
          encounterId,
          careSetting,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          patient360Revision: snapshot.patient360Revision,
          findingCount: proposed.counts.total,
          criticalCount: proposed.counts.critical,
          actionRequiredCount: proposed.counts.actionRequired,
          contentHash: proposed.contentHash,
          policyVersion: proposed.policyVersion,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10e-medrec:${proposed.artifactId}`,
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
          action: 'GENERATE_MEDICATION_RECONCILIATION_COPILOT',
          resourceType: 'MEDICATION_RECONCILIATION_COPILOT',
          resourceId: proposed.artifactId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Generated evidence-grounded medication reconciliation review for encounter ${encounterId}`,
          metadata: {
            patientId,
            encounterId,
            careSetting,
            evidenceSnapshotId: snapshot.snapshotId,
            evidenceSnapshotHash: snapshot.snapshotHash,
            findingCount: proposed.counts.total,
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
      throw new Error('CI10E_ARTIFACT_PERSISTENCE_FAILED');
    }

    return {
      artifact:
        persisted.data() as MedicationReconciliationCopilotArtifact,
      evidenceIndex: evidenceIndex(snapshot),
    };
  }

  public static async get(
    tenantId: string,
    artifactId: string
  ): Promise<MedicationReconciliationCopilotArtifact | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10E_ARTIFACT_STORE_UNAVAILABLE');

    const document = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('medicationReconciliationCopilotArtifacts')
      .doc(artifactId)
      .get();

    return document.exists
      ? (document.data() as MedicationReconciliationCopilotArtifact)
      : null;
  }
}
