/**
 * External FHIR Patient 360 evidence projection, deliberately NOT native Patient360.
 *
 * Builds a versioned, tenant-scoped read model from approved FHIR resource heads.
 * Every build re-checks the source, verified patient mapping and current consent.
 * No absent resource category is interpreted as KNOWN_NONE. No auto-promotion to
 * clinician-authoritative or AI-draft context is permitted.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  fhirImportHeadId,
  fhirPatientLinkId,
  prepareFhirImport,
  type FhirImportActor,
  type FhirPatientLink,
  type FhirSourceRecord,
} from './external-fhir-import';

export type ExternalContextStatus = 'EVIDENCE_ONLY' | 'RECONCILIATION_REQUIRED';
export type ExternalFact = {
  type: 'Patient' | 'Encounter' | 'Observation';
  id: string;
  sourceId: string;
  resourceId: string;
  sourceVersionId: string;
  sourceLastUpdatedAt: number;
  evidenceReceiptId: string;
  sourceEventId: string;
  resourceHash: string;
  summary: Record<string, unknown>;
  clinicalVerification: 'UNVERIFIED_EXTERNAL';
};
export type ExternalPatient360Projection = {
  tenantId: string;
  patientId: string;
  projectionVersion: 1;
  revision: number;
  status: ExternalContextStatus;
  sourceFingerprint: string;
  sourceCheckpoint: string;
  contentHash: string;
  projectedAt: number;
  sourceRefs: Array<{ sourceId: string; facilityId: string }>;
  facts: ExternalFact[];
  reconciliationIssues: string[];
  /** Empty sets mean unassessed, not negative. */
  dataQuality: {
    allergyKnowledge: 'UNKNOWN';
    medicationKnowledge: 'UNKNOWN';
    problemListKnowledge: 'UNKNOWN';
    externalEvidenceVerifiedByClinician: false;
    historyCompleteness: 'UNVERIFIED';
  };
};
const MAX_HEADS = 64;
const MAX_CASES = 64;
function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function stringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stringify).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(k => JSON.stringify(k) + ':' + stringify(record[k])).join(',') + '}';
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function observationEvidence(resource: Record<string, unknown>): Record<string, unknown> {
  const code = obj(resource.code);
  const coding = Array.isArray(code.coding) ? code.coding.map(c => ({
    system: str(obj(c).system), code: str(obj(c).code), display: str(obj(c).display),
  })) : [];
  const quantity = obj(resource.valueQuantity);
  const hasQuantity = Object.hasOwn(resource, 'valueQuantity');
  const validQuantity = hasQuantity &&
    typeof quantity.value === 'number' && Number.isFinite(quantity.value) &&
    quantity.system === 'http://unitsofmeasure.org' &&
    str(quantity.code).length > 0;
  return {
    kind: 'OBSERVATION',
    status: str(resource.status),
    coding,
    effectiveAt: typeof resource.effectiveDateTime === 'string' &&
      Number.isFinite(Date.parse(resource.effectiveDateTime))
      ? Date.parse(resource.effectiveDateTime) : null,
    valueState: validQuantity ? 'PRESENT_UNVERIFIED' : 'UNKNOWN_OR_UNSUPPORTED',
    value: validQuantity
      ? { type: 'QUANTITY', value: quantity.value, system: 'http://unitsofmeasure.org', code: str(quantity.code) }
      : null,
    interpretation: 'NOT_CLINICALLY_VERIFIED',
  };
}
function evidenceSummary(resource: Record<string, unknown>): Record<string, unknown> {
  if (resource.resourceType === 'Patient') return { kind: 'EXTERNAL_PATIENT_IDENTITY', verifiedDemographics: false };
  if (resource.resourceType === 'Observation') return observationEvidence(resource);
  const period = obj(resource.period);
  return {
    kind: 'ENCOUNTER', status: str(resource.status) || 'UNKNOWN',
    classCode: str(obj(resource.class).code) || null,
    start: typeof period.start === 'string' ? period.start : null,
    end: typeof period.end === 'string' ? period.end : null,
    clinicalVerification: 'UNVERIFIED_EXTERNAL',
  };
}
function assertOperator(actor: FhirImportActor, tenantId: string): void {
  if (!actor.actorId || !actor.tenantId || actor.tenantId !== tenantId) {
    throw new Error('FHIR_CONTEXT_TENANT_DENIED');
  }
  if (!actor.permissions.map(x => x.toUpperCase()).some(x =>
    x === 'FHIR_IMPORT' || x === 'FHIR_RECONCILE')) {
    throw new Error('FHIR_CONTEXT_PERMISSION_DENIED');
  }
}
function safePatientId(patientId: string): string {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(patientId) ||
      patientId === '.' || patientId === '..') {
    throw new Error('FHIR_CONTEXT_PATIENT_INVALID');
  }
  return patientId;
}
type Head = {
  tenantId: string;
  patientId: string;
  sourceId: string;
  resourceId: string;
  resourceType: string;
  sourceVersionId: string;
  receiptId: string;
  sourceLastUpdatedAt: number;
};
type Receipt = {
  tenantId: string;
  patientId: string;
  sourceId: string;
  receiptId: string;
  resourceHash: string;
  resourceJson: string;
  sourceVersionId: string;
  provenance: { mappedByVerifiedLink?: string };
};
type Case = { patientId: string; tenantId: string; status: string; caseId?: string; reason: string };

export async function rebuildExternalPatient360(args: {
  db: Firestore; tenantId: string; patientId: string; actor: FhirImportActor;
  now?: () => number;
}): Promise<{ projection: ExternalPatient360Projection; unchanged: boolean }> {
  const { db, actor, tenantId } = args;
  const patientId = safePatientId(args.patientId);
  assertOperator(actor, tenantId);
  const tenant = db.collection('tenants').doc(tenantId);
  const projectionRef = tenant.collection('externalPatient360Projections').doc(patientId);
  return db.runTransaction(async (tx: Transaction) => {
    const [patient, current] = await tx.getAll(
      tenant.collection('patients').doc(patientId), projectionRef
    );
    // Reads are deliberately sequential within one transaction, not parallel
    // independent transaction streams (emulator and server parity).
    const headPage = await tx.get(
      tenant.collection('fhirResourceHeads').where('patientId', '==', patientId).limit(MAX_HEADS + 1)
    );
    const casePage = await tx.get(
      tenant.collection('fhirReconciliationCases').where('patientId', '==', patientId).limit(MAX_CASES + 1)
    );
    if (!patient.exists || patient.get('mergedIntoPatientId')) {
      throw new Error('FHIR_CONTEXT_CANONICAL_PATIENT_UNAVAILABLE');
    }
    if (headPage.size > MAX_HEADS || casePage.size > MAX_CASES) {
      throw new Error('FHIR_CONTEXT_BOUNDED_REBUILD_REQUIRED');
    }
    const heads = headPage.docs.map(d => ({ ref: d.ref, value: d.data() as Head }))
      .sort((a,b) => a.ref.id.localeCompare(b.ref.id));
    const cases = casePage.docs.map(d => ({ ...d.data() as Case, caseId: d.id }));
    // Reads are gathered before any writes, including the immutable snapshot.
    const sources = new Map<string, FhirSourceRecord | null>();
    const sourceIds = [...new Set(heads.map(h => h.value.sourceId))];
    const sourceSnaps = sourceIds.length
      ? await tx.getAll(...sourceIds.map(id => tenant.collection('fhirSources').doc(id)))
      : [];
    sourceIds.forEach((id, i) => sources.set(id, sourceSnaps[i].exists ? sourceSnaps[i].data() as FhirSourceRecord : null));
    const receiptSnaps = heads.length
      ? await tx.getAll(...heads.map(h => tenant.collection('fhirImportedVersions').doc(h.value.receiptId)))
      : [];
    const receiptRows = receiptSnaps.map(s => s.exists ? s.data() as Receipt : null);
    const linkIds = [...new Set(receiptRows
      .map(r => r?.provenance?.mappedByVerifiedLink || '')
      .filter(Boolean))];
    const linkDocs = linkIds.length
      ? await tx.getAll(...linkIds.map(id => tenant.collection('fhirPatientLinks').doc(id)))
      : [];
    const links = new Map<string, FhirPatientLink | null>();
    linkIds.forEach((id, i) => links.set(id, linkDocs[i].exists ? linkDocs[i].data() as FhirPatientLink : null));
    const problems: string[] = [];
    const facts: ExternalFact[] = [];
    const sourceRefs = new Map<string, { sourceId: string; facilityId: string }>();
    for (let i = 0; i < heads.length; i++) {
      const { value: head, ref } = heads[i];
      const receipt = receiptRows[i];
      const source = sources.get(head.sourceId);
      const link = links.get(receipt?.provenance?.mappedByVerifiedLink || '') || null;
      const prefix = ref.id;
      if (!receipt || head.tenantId !== tenantId || head.patientId !== patientId ||
          head.receiptId !== receipt.receiptId || receipt.tenantId !== tenantId ||
          receipt.patientId !== patientId || receipt.sourceId !== head.sourceId ||
          receipt.sourceVersionId !== head.sourceVersionId) {
        throw new Error('FHIR_CONTEXT_IMMUTABLE_LINEAGE_MISMATCH');
      }
      if (!source || source.tenantId !== tenantId || source.sourceId !== head.sourceId ||
          source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED') {
        problems.push('SOURCE_NOT_ACTIVE:' + prefix);
        continue;
      }
      if (!actor.facilityIds.includes(source.facilityId)) {
        throw new Error('FHIR_CONTEXT_FACILITY_DENIED');
      }
      if (!link || link.tenantId !== tenantId || link.patientId !== patientId ||
          link.sourceId !== head.sourceId || link.facilityId !== source.facilityId ||
          link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED') {
        problems.push('PATIENT_LINK_OR_CONSENT_INVALID:' + prefix);
        continue;
      }
      // Check the imported immutable record against its canonical, hashed FHIR
      // payload. Compromised evidence must never turn into a read projection.
      let parsed: unknown;
      try { parsed = JSON.parse(receipt.resourceJson); } catch { throw new Error('FHIR_CONTEXT_RESOURCE_JSON_CORRUPT'); }
      const prepared = prepareFhirImport(head.sourceId, parsed);
      if (prepared.receiptId !== head.receiptId || prepared.resourceHash !== receipt.resourceHash ||
          prepared.resourceId !== head.resourceId ||
          prepared.sourceVersionId !== head.sourceVersionId ||
          prepared.resourceType !== head.resourceType ||
          prepared.externalPatientId !== link.externalPatientId ||
          fhirPatientLinkId(head.sourceId, prepared.externalPatientId) !== receipt.provenance.mappedByVerifiedLink ||
          fhirImportHeadId(head.sourceId, head.resourceType, head.resourceId) !== ref.id) {
        throw new Error('FHIR_CONTEXT_RESOURCE_INTEGRITY_FAILURE');
      }
      sourceRefs.set(head.sourceId, { sourceId: head.sourceId, facilityId: source.facilityId });
      facts.push({
        type: prepared.resourceType,
        id: ref.id, sourceId: head.sourceId, resourceId: head.resourceId,
        sourceVersionId: head.sourceVersionId,
        sourceLastUpdatedAt: head.sourceLastUpdatedAt,
        evidenceReceiptId: receipt.receiptId,
        sourceEventId: 'fev_' + receipt.receiptId.slice(4),
        resourceHash: receipt.resourceHash,
        summary: evidenceSummary(obj(parsed)),
        clinicalVerification: 'UNVERIFIED_EXTERNAL',
      });
    }
    const activeCases = cases.filter(c => c.status === 'OPEN');
    for (const c of activeCases) problems.push('OPEN_RECONCILIATION:' + c.caseId);
    if (!heads.length) problems.push('NO_IMPORTED_FHIR_EVIDENCE');
    const sortedIssues = [...new Set(problems)].sort();
    const inputs = {
      tenantId, patientId,
      headIds: heads.map(h => [h.ref.id,h.value.receiptId,h.value.sourceVersionId]),
      currentEvidence: facts.map(f => [f.id,f.resourceHash]),
      openCases: activeCases.map(c => c.caseId).sort(),
      issues: sortedIssues,
    };
    const sourceFingerprint = sha(stringify(inputs));
    const status: ExternalContextStatus = sortedIssues.length ? 'RECONCILIATION_REQUIRED' : 'EVIDENCE_ONLY';
    const data = {
      tenantId, patientId, projectionVersion: 1 as const, status,
      sourceFingerprint, sourceCheckpoint: sourceFingerprint,
      facts, sourceRefs: [...sourceRefs.values()].sort((a,b) => a.sourceId.localeCompare(b.sourceId)),
      reconciliationIssues: sortedIssues,
      dataQuality: {
        allergyKnowledge: 'UNKNOWN' as const,
        medicationKnowledge: 'UNKNOWN' as const,
        problemListKnowledge: 'UNKNOWN' as const,
        externalEvidenceVerifiedByClinician: false as const,
        historyCompleteness: 'UNVERIFIED' as const,
      },
    };
    const contentHash = sha(stringify(data));
    const prior = current.exists ? current.data() as ExternalPatient360Projection : null;
    if (prior && prior.contentHash === contentHash) {
      return { projection: prior, unchanged: true };
    }
    const revision = (prior?.revision || 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('FHIR_CONTEXT_REVISION_OVERFLOW');
    const projection: ExternalPatient360Projection = {
      ...data, contentHash, revision, projectedAt: (args.now || Date.now)(),
    };
    const revisionId = 'fpr_' + sha(JSON.stringify([patientId, revision, contentHash]));
    tx.create(tenant.collection('externalPatient360Revisions').doc(revisionId), {
      ...projection, revisionId, immutable: true,
      publicationState: 'STAGED_NOT_CLINICALLY_QUALIFIED',
    });
    tx.set(projectionRef, projection);
    return { projection, unchanged: false };
  });
}
