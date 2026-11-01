/**
 * CI-EXT-03: authorized external clinical-evidence reader.
 *
 * This reader deliberately does NOT implement ClinicalContextReader: that
 * legacy contract requires a native, clinician-authoritative Patient360Projection.
 * External FHIR evidence must never be cast into that type, used as the native
 * event stream, or silently exposed to clinical drafting.
 *
 * Every read is fenced in one Firestore transaction against source heads,
 * immutable receipts/events, live source approval, verified patient links,
 * consent and unresolved reconciliation cases. A read-access audit is written
 * atomically with successful disclosure.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { fhirImportHeadId, fhirPatientLinkId, prepareFhirImport } from './external-fhir-import';
import type { FhirImportActor, FhirPatientLink, FhirSourceRecord } from './external-fhir-import';
import type { ExternalFact, ExternalPatient360Projection } from './external-patient360-projection';

export const EXTERNAL_EVIDENCE_MAX_AGE_MS = 5 * 60_000;
const MAX_HEADS = 64;
const MAX_CASES = 64;
const ID = /^[A-Za-z0-9._-]{1,128}$/;
type ProjectionSource = { sourceId: string; facilityId: string };
type ResourceHead = {
  tenantId: string; patientId: string; sourceId: string;
  resourceType: string; resourceId: string; sourceVersionId: string;
  receiptId: string; sourceLastUpdatedAt: number;
};
type ImportReceipt = {
  tenantId: string; patientId: string; sourceId: string;
  resourceType: string; resourceId: string; sourceVersionId: string;
  sourceLastUpdatedAt: number; resourceHash: string; receiptId: string;
  resourceJson: string;
  provenance: { mappedByVerifiedLink?: string };
};
type ImportEvent = {
  eventId: string; eventType: string;
  tenantId: string; patientId: string; sourceId: string;
  receiptId: string; resourceHash: string; sourceVersionId: string;
};
export type ExternalClinicalEvidenceResult = {
  source: 'EXTERNAL_FHIR';
  tenantId: string;
  patientId: string;
  projectionRevision: number;
  projectionContentHash: string;
  sourceCheckpoint: string;
  reviewedAt: number;
  clinicalUseAuthorized: false;
  status: 'EVIDENCE_ONLY';
  historyCompleteness: 'UNVERIFIED';
  facts: ExternalFact[];
};
function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const data = value as Record<string, unknown>;
  return '{' + Object.keys(data).sort().map(k => JSON.stringify(k) + ':' + canonical(data[k])).join(',') + '}';
}
function assertValidId(value: string, label: string): void {
  if (!ID.test(value) || value === '.' || value === '..') throw new Error(label);
}

/** No implicit administrative or native clinical privilege qualifies. */
export function assertExternalEvidenceReadAuthority(
  actor: FhirImportActor, tenantId: string, patientId: string
): void {
  assertValidId(tenantId, 'CI_EXT03_TENANT_INVALID');
  assertValidId(patientId, 'CI_EXT03_PATIENT_INVALID');
  if (!actor.actorId || !actor.tenantId || actor.tenantId !== tenantId) {
    throw new Error('CI_EXT03_TENANT_ACCESS_DENIED');
  }
  if (!actor.permissions.map(p => p.toUpperCase()).includes('FHIR_EVIDENCE_REVIEW')) {
    throw new Error('CI_EXT03_EVIDENCE_PERMISSION_DENIED');
  }
  if (!Array.isArray(actor.facilityIds) || actor.facilityIds.length === 0) {
    throw new Error('CI_EXT03_FACILITY_ACCESS_DENIED');
  }
}
export function assertExternalEvidenceFreshness(
  projection: ExternalPatient360Projection | null,
  tenantId: string, patientId: string, now: number,
  maxAgeMs = EXTERNAL_EVIDENCE_MAX_AGE_MS
): asserts projection is ExternalPatient360Projection {
  if (!projection || projection.tenantId !== tenantId ||
      projection.patientId !== patientId || projection.projectionVersion !== 1 ||
      !Number.isSafeInteger(projection.revision) || projection.revision < 1) {
    throw new Error('CI_EXT03_PROJECTION_SCOPE_OR_VERSION_INVALID');
  }
  if (projection.status !== 'EVIDENCE_ONLY' || projection.reconciliationIssues.length ||
      projection.dataQuality.externalEvidenceVerifiedByClinician !== false ||
      projection.dataQuality.historyCompleteness !== 'UNVERIFIED') {
    throw new Error('CI_EXT03_RECONCILIATION_OR_POLICY_BLOCK');
  }
  if (!Number.isFinite(now) || !Number.isSafeInteger(projection.projectedAt) ||
      !Number.isFinite(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > EXTERNAL_EVIDENCE_MAX_AGE_MS ||
      projection.projectedAt > now + 30_000 ||
      now - projection.projectedAt > maxAgeMs) {
    throw new Error('CI_EXT03_PROJECTION_EXPIRED');
  }
  if (!projection.contentHash || !projection.sourceCheckpoint || !projection.sourceFingerprint ||
      projection.sourceCheckpoint !== projection.sourceFingerprint ||
      !Array.isArray(projection.facts) || !Array.isArray(projection.sourceRefs) ||
      projection.facts.length === 0 || projection.facts.length > MAX_HEADS) {
    throw new Error('CI_EXT03_PROJECTION_INCOMPLETE');
  }
  // Verify the exact content-hash contract used by the external projector,
  // excluding mutable revision metadata and projectedAt.
  const content = {
    tenantId: projection.tenantId,
    patientId: projection.patientId,
    projectionVersion: projection.projectionVersion,
    status: projection.status,
    sourceFingerprint: projection.sourceFingerprint,
    sourceCheckpoint: projection.sourceCheckpoint,
    facts: projection.facts,
    sourceRefs: projection.sourceRefs,
    reconciliationIssues: projection.reconciliationIssues,
    dataQuality: projection.dataQuality,
  };
  if (hash(canonical(content)) !== projection.contentHash) {
    throw new Error('CI_EXT03_PROJECTION_CONTENT_HASH_INVALID');
  }
}

export async function readExternalClinicalEvidence(args: {
  db: Firestore;
  actor: FhirImportActor;
  tenantId: string;
  patientId: string;
  now?: () => number;
  maxAgeMs?: number;
}): Promise<ExternalClinicalEvidenceResult> {
  const { db, actor, tenantId, patientId } = args;
  assertExternalEvidenceReadAuthority(actor, tenantId, patientId);
  const now = (args.now || Date.now)();
  const tenant = db.collection('tenants').doc(tenantId);
  const auditId = 'cea_' + randomUUID();
  const auditRef = tenant.collection('externalContextAccessAudits').doc(auditId);
  return db.runTransaction(async tx => {
    const [patientSnap, projectionSnap] = await tx.getAll(
      tenant.collection('patients').doc(patientId),
      tenant.collection('externalPatient360Projections').doc(patientId)
    );
    if (!patientSnap.exists || patientSnap.get('mergedIntoPatientId') ||
        (patientSnap.get('tenantId') && patientSnap.get('tenantId') !== tenantId)) {
      throw new Error('CI_EXT03_CANONICAL_PATIENT_UNAVAILABLE');
    }
    const projection = projectionSnap.exists
      ? projectionSnap.data() as ExternalPatient360Projection : null;
    assertExternalEvidenceFreshness(
      projection, tenantId, patientId, now, args.maxAgeMs
    );
    const headDocs = await tx.get(
      tenant.collection('fhirResourceHeads').where('patientId', '==', patientId).limit(MAX_HEADS + 1)
    );
    const caseDocs = await tx.get(
      tenant.collection('fhirReconciliationCases').where('patientId', '==', patientId).limit(MAX_CASES + 1)
    );
    if (headDocs.size > MAX_HEADS || caseDocs.size > MAX_CASES) {
      throw new Error('CI_EXT03_BOUND_EXCEEDED');
    }
    if (caseDocs.docs.some(d => d.data().status !== 'RESOLVED')) {
      throw new Error('CI_EXT03_UNRESOLVED_RECONCILIATION');
    }
    const heads = headDocs.docs.sort((a, b) => a.id.localeCompare(b.id));
    if (heads.length !== projection.facts.length) {
      throw new Error('CI_EXT03_PROJECTION_SOURCE_ADVANCED');
    }
    const sourceIds = [...new Set(heads.map(d => (d.data() as ResourceHead).sourceId))].sort();
    const sourceSnaps = await tx.getAll(...sourceIds.map(id =>
      tenant.collection('fhirSources').doc(id)
    ));
    const sources = new Map<string, FhirSourceRecord | null>();
    sourceIds.forEach((id, i) => sources.set(id,
      sourceSnaps[i].exists ? sourceSnaps[i].data() as FhirSourceRecord : null
    ));
    const receipts = await tx.getAll(...heads.map(d =>
      tenant.collection('fhirImportedVersions').doc((d.data() as ResourceHead).receiptId)
    ));
    const receiptValues = receipts.map(d => d.exists ? d.data() as ImportReceipt : null);
    if (receiptValues.some(r => !r)) throw new Error('CI_EXT03_SOURCE_RECEIPT_MISSING');
    const linkIds = [...new Set(receiptValues.map(r =>
      r?.provenance?.mappedByVerifiedLink || ''
    ))];
    if (linkIds.some(id => !id)) throw new Error('CI_EXT03_PATIENT_LINK_MISSING');
    const linkSnaps = await tx.getAll(...linkIds.map(id =>
      tenant.collection('fhirPatientLinks').doc(id)
    ));
    const links = new Map<string, FhirPatientLink | null>();
    linkIds.forEach((id, i) =>
      links.set(id, linkSnaps[i].exists ? linkSnaps[i].data() as FhirPatientLink : null)
    );
    const eventIds = receiptValues.map(r => 'fev_' + r!.receiptId.slice(4));
    const eventSnaps = await tx.getAll(...eventIds.map(id =>
      tenant.collection('fhirImportEvents').doc(id)
    ));
    const facts: ExternalFact[] = [];
    const liveSources = new Map<string, ProjectionSource>();
    for (let i = 0; i < heads.length; i++) {
      const headDoc = heads[i];
      const head = headDoc.data() as ResourceHead;
      const receipt = receiptValues[i]!;
      const source = sources.get(head.sourceId);
      const link = links.get(receipt.provenance.mappedByVerifiedLink || '');
      const importedEvent = eventSnaps[i].exists ? eventSnaps[i].data() as ImportEvent : null;
      const fact = projection.facts[i];
      // Facility authority is checked before source status/consent; neither
      // source revocation nor errors may disclose another facility's evidence.
      if (!source || source.tenantId !== tenantId || source.sourceId !== head.sourceId ||
          !actor.facilityIds.includes(source.facilityId)) {
        throw new Error('CI_EXT03_FACILITY_OR_SOURCE_ACCESS_DENIED');
      }
      if (source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED' ||
          !source.approvedResourceTypes.includes(head.resourceType)) {
        throw new Error('CI_EXT03_SOURCE_REVOKED');
      }
      if (!link || link.tenantId !== tenantId || link.sourceId !== head.sourceId ||
          link.patientId !== patientId || link.facilityId !== source.facilityId ||
          link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED') {
        throw new Error('CI_EXT03_PATIENT_LINK_OR_CONSENT_REVOKED');
      }
      if (head.tenantId !== tenantId || head.patientId !== patientId ||
          receipt.tenantId !== tenantId || receipt.patientId !== patientId ||
          receipt.sourceId !== head.sourceId || receipt.resourceType !== head.resourceType ||
          receipt.resourceId !== head.resourceId ||
          receipt.receiptId !== head.receiptId ||
          receipt.sourceVersionId !== head.sourceVersionId ||
          receipt.sourceLastUpdatedAt !== head.sourceLastUpdatedAt ||
          fhirImportHeadId(head.sourceId, head.resourceType, head.resourceId) !== headDoc.id ||
          !importedEvent || importedEvent.eventId !== eventIds[i] ||
          importedEvent.tenantId !== tenantId || importedEvent.patientId !== patientId ||
          importedEvent.sourceId !== head.sourceId ||
          importedEvent.receiptId !== receipt.receiptId ||
          importedEvent.resourceHash !== receipt.resourceHash ||
          importedEvent.sourceVersionId !== head.sourceVersionId) {
        throw new Error('CI_EXT03_SOURCE_EVENT_LINEAGE_INVALID');
      }
      let resource: unknown;
      try {
        resource = JSON.parse(receipt.resourceJson);
      } catch {
        throw new Error('CI_EXT03_IMMUTABLE_PAYLOAD_CORRUPT');
      }
      const validated = prepareFhirImport(head.sourceId, resource);
      if (validated.receiptId !== receipt.receiptId ||
          validated.resourceHash !== receipt.resourceHash ||
          validated.resourceType !== head.resourceType ||
          validated.resourceId !== head.resourceId ||
          validated.sourceVersionId !== head.sourceVersionId ||
          validated.sourceLastUpdatedAt !== head.sourceLastUpdatedAt ||
          validated.externalPatientId !== link.externalPatientId ||
          fhirPatientLinkId(head.sourceId, validated.externalPatientId) !==
            receipt.provenance.mappedByVerifiedLink) {
        throw new Error('CI_EXT03_SOURCE_CONTENT_INTEGRITY_INVALID');
      }
      if (!fact || fact.id !== headDoc.id ||
          fact.sourceId !== head.sourceId || fact.resourceId !== head.resourceId ||
          fact.type !== head.resourceType || fact.sourceVersionId !== head.sourceVersionId ||
          fact.sourceLastUpdatedAt !== head.sourceLastUpdatedAt ||
          fact.evidenceReceiptId !== receipt.receiptId ||
          fact.sourceEventId !== importedEvent.eventId ||
          fact.resourceHash !== receipt.resourceHash ||
          fact.clinicalVerification !== 'UNVERIFIED_EXTERNAL') {
        throw new Error('CI_EXT03_PROJECTION_FACT_LINEAGE_INVALID');
      }
      liveSources.set(head.sourceId, { sourceId: head.sourceId, facilityId: source.facilityId });
      facts.push(fact);
    }
    const expectedSources = [...liveSources.values()].sort((a, b) =>
      a.sourceId.localeCompare(b.sourceId)
    );
    if (canonical(expectedSources) !== canonical(projection.sourceRefs)) {
      throw new Error('CI_EXT03_PROJECTION_SOURCE_SCOPE_CHANGED');
    }
    const fingerprint = hash(canonical({
      tenantId, patientId,
      headIds: heads.map(d => {
        const h = d.data() as ResourceHead;
        return [d.id, h.receiptId, h.sourceVersionId];
      }),
      currentEvidence: facts.map(f => [f.id, f.resourceHash]),
      openCases: [],
      issues: [],
    }));
    if (fingerprint !== projection.sourceFingerprint) {
      throw new Error('CI_EXT03_PROJECTION_CHECKPOINT_STALE');
    }
    // All reads have finished: an audit is committed in the same transaction
    // as the authorized disclosure decision, with no raw payload or PHI.
    tx.create(auditRef, {
      auditId, action: 'EXTERNAL_FHIR_EVIDENCE_READ', tenantId, patientId,
      actorId: actor.actorId, evidenceCount: facts.length,
      revision: projection.revision, contentHash: projection.contentHash,
      sourceCheckpoint: projection.sourceCheckpoint, recordedAt: now,
      immutable: true, clinicalUseAuthorized: false,
    });
    return {
      source: 'EXTERNAL_FHIR', tenantId, patientId,
      projectionRevision: projection.revision,
      projectionContentHash: projection.contentHash,
      sourceCheckpoint: projection.sourceCheckpoint, reviewedAt: now,
      clinicalUseAuthorized: false, status: 'EVIDENCE_ONLY',
      historyCompleteness: 'UNVERIFIED', facts,
    };
  });
}
