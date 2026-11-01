/**
 * Helixis CI — external FHIR R4 import boundary.
 *
 * A hospital FHIR server remains the source of truth. This module imports
 * immutable, provenance-rich evidence only; it never writes back to the HIS,
 * invents patient matches, or publishes unqualified data to native Patient 360.
 *
 * Firestore Admin SDK only. All authorization is rechecked in the same
 * transaction that creates the imported version, event, audit and held outbox.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { FhirResource } from '@/lib/interop/fhir-r4-adapter';

export const EXTERNAL_FHIR_IMPORT_TYPES = ['Patient', 'Encounter', 'Observation'] as const;
export type ExternalFhirImportType = typeof EXTERNAL_FHIR_IMPORT_TYPES[number];
export type ExternalFhirImportStatus = 'CURRENT' | 'HISTORICAL' | 'RECONCILIATION_REQUIRED';
export type ExternalFhirImportResult = {
  receiptId: string;
  eventId: string;
  tenantId: string;
  patientId: string;
  sourceId: string;
  resourceType: ExternalFhirImportType;
  resourceId: string;
  sourceVersionId: string;
  status: ExternalFhirImportStatus;
  replay: boolean;
};

export type FhirImportActor = {
  actorId: string;
  tenantId: string;
  permissions: string[];
  roles: string[];
  facilityIds: string[];
};
export type FhirSourceRecord = {
  tenantId: string;
  sourceId: string;
  facilityId: string;
  baseUrl: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  securityReviewStatus: 'APPROVED' | 'PENDING' | 'REVOKED';
  approvedResourceTypes: string[];
  oauth?: {
    mode: 'SMART_BACKEND';
    clientId: string;
    tokenUrl: string;
    keyId: string;
    secretVersion: number;
    credentialRevision: number;
    scopes: string[];
  };
};
export type FhirPatientLink = {
  tenantId: string;
  sourceId: string;
  externalPatientId: string;
  patientId: string;
  facilityId: string;
  matchStatus: 'VERIFIED' | 'PENDING' | 'REVOKED';
  consentStatus: 'GRANTED' | 'WITHDRAWN' | 'UNVERIFIED';
};
export type PreparedFhirImport = {
  resource: FhirResource;
  resourceJson: string;
  resourceHash: string;
  sourceVersionId: string;
  sourceLastUpdatedAt: number;
  resourceType: ExternalFhirImportType;
  resourceId: string;
  externalPatientId: string;
  receiptId: string;
  headId: string;
  linkId: string;
  summary: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const data = value as Record<string, unknown>;
  return '{' + Object.keys(data).sort().map(k => JSON.stringify(k) + ':' + canonical(data[k])).join(',') + '}';
}
function traceFhirStage(stage: string): void {
  if (process.env.GHIMS_FHIR_EMULATOR_TRACE === 'true' &&
      process.env.FIRESTORE_EMULATOR_HOST) {
    // Only static stage labels; no PHI, resource IDs, credentials or patient data.
    console.info('[FHIR_EMULATOR_TRACE] ' + stage);
  }
}
function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function fhirPatientLinkId(sourceId: string, patientId: string): string {
  return 'fpl_' + sha(JSON.stringify([sourceId, patientId]));
}
export function fhirImportHeadId(sourceId: string, type: string, id: string): string {
  return 'fhd_' + sha(JSON.stringify([sourceId, type, id]));
}
export function assertFhirIdentifier(value: unknown, code: string): string {
  const id = nonEmpty(value);
  if (!/^[A-Za-z0-9.\-_]{1,64}$/.test(id) || id === '.' || id === '..') throw new Error(code);
  return id;
}
export function assertFhirImportActor(actor: FhirImportActor, tenantId: string, facilityId: string): void {
  if (!actor.actorId || !actor.tenantId || actor.tenantId !== tenantId) {
    throw new Error('FHIR_IMPORT_TENANT_ACCESS_DENIED');
  }
  const grants = actor.permissions.map(p => p.toUpperCase());
  // Importing protected patient data requires a distinct explicit grant.
  // Being an administrator or managing configuration is not sufficient.
  if (!grants.includes('FHIR_IMPORT')) {
    throw new Error('FHIR_IMPORT_PERMISSION_DENIED');
  }
  if (!actor.facilityIds.includes(facilityId)) {
    throw new Error('FHIR_IMPORT_FACILITY_ACCESS_DENIED');
  }
}
export function assertFhirSource(
  source: FhirSourceRecord | null | undefined,
  tenantId: string,
  sourceId: string,
  actor: FhirImportActor,
  resourceType: string,
  expectedBaseUrl?: string
): FhirSourceRecord {
  if (!source || source.tenantId !== tenantId || source.sourceId !== sourceId ||
      source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED') {
    throw new Error('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');
  }
  assertFhirImportActor(actor, tenantId, source.facilityId);
  if (!source.approvedResourceTypes?.includes(resourceType) ||
      !(EXTERNAL_FHIR_IMPORT_TYPES as readonly string[]).includes(resourceType)) {
    throw new Error('FHIR_IMPORT_RESOURCE_NOT_APPROVED');
  }
  if (expectedBaseUrl && source.baseUrl !== expectedBaseUrl) {
    throw new Error('FHIR_IMPORT_SOURCE_ENDPOINT_CHANGED');
  }
  return source;
}
function externalPatientReference(resource: FhirResource): string {
  if (resource.resourceType === 'Patient') {
    return assertFhirIdentifier(resource.id, 'FHIR_IMPORT_PATIENT_ID_REQUIRED');
  }
  const subject = object(resource.subject);
  const reference = nonEmpty(subject?.reference);
  const match = /^Patient\/([A-Za-z0-9.\-_]{1,64})$/.exec(reference);
  if (!match) throw new Error('FHIR_IMPORT_EXPLICIT_PATIENT_REFERENCE_REQUIRED');
  return match[1];
}
function normalizedSummary(resource: FhirResource): Record<string, unknown> {
  const resourceObj = resource as Record<string, unknown>;
  if (resource.resourceType === 'Patient') {
    return { kind: 'IDENTITY_EVIDENCE_ONLY', matchInferred: false };
  }
  if (resource.resourceType === 'Encounter') {
    const period = object(resourceObj.period);
    return {
      kind: 'ENCOUNTER_EVIDENCE',
      status: nonEmpty(resourceObj.status) || 'UNKNOWN',
      classCode: nonEmpty(object(resourceObj.class)?.code) || null,
      start: nonEmpty(period?.start) || null,
      end: nonEmpty(period?.end) || null,
    };
  }
  const code = object(resourceObj.code);
  const coding = Array.isArray(code?.coding) ? code.coding : [];
  if (!coding.length || !coding.some(item => {
    const c = object(item);
    return nonEmpty(c?.system) && nonEmpty(c?.code);
  })) throw new Error('FHIR_IMPORT_OBSERVATION_CODING_REQUIRED');
  const valueKeys = Object.keys(resourceObj).filter(k => /^value[A-Z]/.test(k));
  if (valueKeys.length > 1) throw new Error('FHIR_IMPORT_OBSERVATION_MULTIPLE_VALUES');
  const status = nonEmpty(resourceObj.status);
  if (!status) throw new Error('FHIR_IMPORT_OBSERVATION_STATUS_REQUIRED');
  // Preserve "not supplied" as UNKNOWN; never infer normal/negative.
  return {
    kind: 'OBSERVATION_EVIDENCE',
    status,
    coding: coding.map(item => {
      const c = object(item);
      return { system: nonEmpty(c?.system), code: nonEmpty(c?.code), display: nonEmpty(c?.display) };
    }),
    effectiveAt: nonEmpty(resourceObj.effectiveDateTime) || null,
    valueState: valueKeys.length ? 'PRESENT' : 'UNKNOWN',
    valueType: valueKeys[0] || null,
    interpretationUnverified: true,
  };
}
export function prepareFhirImport(sourceId: string, value: unknown): PreparedFhirImport {
  const source = assertFhirIdentifier(sourceId, 'FHIR_IMPORT_SOURCE_ID_INVALID');
  const resource = object(value) as FhirResource | null;
  if (!resource || !(EXTERNAL_FHIR_IMPORT_TYPES as readonly string[]).includes(nonEmpty(resource.resourceType))) {
    throw new Error('FHIR_IMPORT_RESOURCE_TYPE_UNSUPPORTED');
  }
  const resourceType = resource.resourceType as ExternalFhirImportType;
  const resourceId = assertFhirIdentifier(resource.id, 'FHIR_IMPORT_RESOURCE_ID_REQUIRED');
  const meta = object(resource.meta);
  // FHIR permits missing metadata; Helixis' versioned ingestion contract does not.
  const sourceVersionId = assertFhirIdentifier(meta?.versionId, 'FHIR_IMPORT_VERSION_REQUIRED');
  const updated = nonEmpty(meta?.lastUpdated);
  const sourceLastUpdatedAt = Date.parse(updated);
  if (!updated || !Number.isFinite(sourceLastUpdatedAt) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(updated)) {
    throw new Error('FHIR_IMPORT_LAST_UPDATED_REQUIRED');
  }
  const externalPatientId = externalPatientReference(resource);
  const resourceJson = canonical(resource);
  if (Buffer.byteLength(resourceJson, 'utf8') > 120_000) {
    throw new Error('FHIR_IMPORT_RESOURCE_TOO_LARGE');
  }
  const resourceHash = sha(resourceJson);
  return {
    resource, resourceJson, resourceHash,
    resourceType, resourceId, sourceVersionId, sourceLastUpdatedAt, externalPatientId,
    receiptId: 'fir_' + sha(JSON.stringify([source, resourceType, resourceId, sourceVersionId])),
    headId: fhirImportHeadId(source, resourceType, resourceId),
    linkId: fhirPatientLinkId(source, externalPatientId),
    summary: normalizedSummary(resource),
  };
}

export function classifyFhirVersion(
  previous: { sourceLastUpdatedAt: number; sourceVersionId: string } | null,
  next: { sourceLastUpdatedAt: number; sourceVersionId: string }
): ExternalFhirImportStatus {
  if (!previous) return 'CURRENT';
  if (next.sourceLastUpdatedAt < previous.sourceLastUpdatedAt) return 'HISTORICAL';
  if (next.sourceLastUpdatedAt === previous.sourceLastUpdatedAt &&
      next.sourceVersionId !== previous.sourceVersionId) return 'RECONCILIATION_REQUIRED';
  // FHIR version IDs are opaque; timestamp order is not proof of source-history
  // completeness. A later version can advance the head only after import.
  return 'CURRENT';
}
function sourcePath(db: Firestore, tenantId: string, sourceId: string) {
  return db.collection('tenants').doc(tenantId).collection('fhirSources').doc(sourceId);
}
export async function preflightExternalFhirSource(args: {
  db: Firestore; actor: FhirImportActor; sourceId: string;
  resourceType: string; expectedBaseUrl?: string;
}): Promise<FhirSourceRecord> {
  const { db, actor, resourceType, expectedBaseUrl } = args;
  const sourceId = assertFhirIdentifier(args.sourceId, 'FHIR_IMPORT_SOURCE_ID_INVALID');
  const snap = await sourcePath(db, actor.tenantId, sourceId).get();
  return assertFhirSource(snap.exists ? snap.data() as FhirSourceRecord : null,
    actor.tenantId, sourceId, actor, resourceType, expectedBaseUrl);
}
function requireLink(
  link: FhirPatientLink | null,
  source: FhirSourceRecord,
  prepared: PreparedFhirImport
): string {
  if (!link || link.tenantId !== source.tenantId || link.sourceId !== source.sourceId ||
      link.externalPatientId !== prepared.externalPatientId ||
      link.facilityId !== source.facilityId ||
      link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED' ||
      !link.patientId || !/^[A-Za-z0-9._-]{1,128}$/.test(link.patientId)) {
    throw new Error('FHIR_IMPORT_PATIENT_LINK_UNVERIFIED_OR_CONSENT_WITHDRAWN');
  }
  return link.patientId;
}
export async function ingestExternalFhirResource(args: {
  db: Firestore;
  actor: FhirImportActor;
  sourceId: string;
  resource: unknown;
  expectedBaseUrl?: string;
  expectedCredentialRevision?: number;
  now?: () => number;
}): Promise<ExternalFhirImportResult> {
  const { db, actor } = args;
  const sourceId = assertFhirIdentifier(args.sourceId, 'FHIR_IMPORT_SOURCE_ID_INVALID');
  const tenantId = assertFhirIdentifier(actor.tenantId, 'FHIR_IMPORT_TENANT_INVALID');
  const prepared = prepareFhirImport(sourceId, args.resource);
  const tenantRef = db.collection('tenants').doc(tenantId);
  const sourceRef = tenantRef.collection('fhirSources').doc(sourceId);
  const linkRef = tenantRef.collection('fhirPatientLinks').doc(prepared.linkId);
  const receiptRef = tenantRef.collection('fhirImportedVersions').doc(prepared.receiptId);
  const headRef = tenantRef.collection('fhirResourceHeads').doc(prepared.headId);
  const eventId = 'fev_' + prepared.receiptId.slice(4);
  const eventRef = tenantRef.collection('fhirImportEvents').doc(eventId);
  const auditRef = tenantRef.collection('auditLogs').doc('fau_' + prepared.receiptId.slice(4));
  const outboxRef = tenantRef.collection('fhirImportOutbox').doc('fob_' + prepared.receiptId.slice(4));
  // The payload is untrusted. No FHIR HTTP request occurs inside a retryable
  // Firestore transaction; transaction retries only repeat local validation.
  traceFhirStage('BEFORE_TRANSACTION');
  return db.runTransaction(async (tx: Transaction) => {
    traceFhirStage('TRANSACTION_CALLBACK_STARTED');
    // All reads precede all writes (Firestore transaction requirement).
    traceFhirStage('BEFORE_SOURCE_LINK_RECEIPT_HEAD_READS');
    // One BatchGetDocuments RPC is safer than concurrent Transaction.get calls:
    // each read sees the same transaction snapshot and avoids conflicting
    // simultaneous transaction-read streams in the Firestore emulator.
    const [sourceSnap, linkSnap, receiptSnap, headSnap] =
      await tx.getAll(sourceRef, linkRef, receiptRef, headRef);
    traceFhirStage('AFTER_SOURCE_LINK_RECEIPT_HEAD_READS');
    const source = assertFhirSource(
      sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null,
      tenantId, sourceId, actor, prepared.resourceType, args.expectedBaseUrl
    );
    // A key rotation or OAuth policy edit during remote HTTP retrieval
    // invalidates that import. The next attempt must obtain a fresh token.
    if (args.expectedCredentialRevision !== undefined &&
        source.oauth?.credentialRevision !== args.expectedCredentialRevision) {
      throw new Error('FHIR_IMPORT_OAUTH_CONFIG_CHANGED');
    }
    const patientId = requireLink(
      linkSnap.exists ? linkSnap.data() as FhirPatientLink : null, source, prepared
    );
    const patientRef = tenantRef.collection('patients').doc(patientId);
    traceFhirStage('BEFORE_PATIENT_READ');
    const patientSnap = await tx.get(patientRef);
    traceFhirStage('AFTER_PATIENT_READ');
    if (!patientSnap.exists || patientSnap.get('mergedIntoPatientId')) {
      throw new Error('FHIR_IMPORT_CANONICAL_PATIENT_NOT_ACTIVE');
    }
    if (receiptSnap.exists) {
      const old = receiptSnap.data() as Record<string, unknown>;
      if (old.resourceHash !== prepared.resourceHash || old.patientId !== patientId ||
          old.tenantId !== tenantId || old.sourceId !== sourceId) {
        throw new Error('FHIR_IMPORT_REPLAY_PAYLOAD_OR_IDENTITY_CONFLICT');
      }
      return {
        receiptId: prepared.receiptId, eventId, tenantId, patientId, sourceId,
        resourceType: prepared.resourceType, resourceId: prepared.resourceId,
        sourceVersionId: prepared.sourceVersionId,
        status: old.status as ExternalFhirImportStatus, replay: true,
      };
    }
    const previous = headSnap.exists ? headSnap.data() as {
      sourceLastUpdatedAt: number; sourceVersionId: string; patientId: string; receiptId: string;
    } : null;
    if (previous && previous.patientId !== patientId) {
      throw new Error('FHIR_IMPORT_RESOURCE_PATIENT_RELINK_REQUIRES_RECONCILIATION');
    }
    const status = classifyFhirVersion(previous, prepared);
    const recordedAt = (args.now || Date.now)();
    const provenance = {
      sourceType: 'EXTERNAL_FHIR',
      sourceId,
      sourceFacilityId: source.facilityId,
      sourceBaseUrl: source.baseUrl,
      sourceResourceType: prepared.resourceType,
      sourceResourceId: prepared.resourceId,
      sourceVersionId: prepared.sourceVersionId,
      sourceLastUpdatedAt: prepared.sourceLastUpdatedAt,
      contentSha256: prepared.resourceHash,
      mappedByVerifiedLink: prepared.linkId,
      ingestedBy: actor.actorId,
      recordedAt,
    };
    const common = {
      tenantId, patientId, sourceId,
      resourceType: prepared.resourceType, resourceId: prepared.resourceId,
      sourceVersionId: prepared.sourceVersionId,
      sourceLastUpdatedAt: prepared.sourceLastUpdatedAt,
      resourceHash: prepared.resourceHash, receiptId: prepared.receiptId,
      status, provenance, recordedAt,
    };
    traceFhirStage('BEFORE_ATOMIC_WRITES');
    tx.create(receiptRef, {
      ...common, schemaVersion: 1, resourceJson: prepared.resourceJson,
      normalizedEvidence: prepared.summary, immutable: true,
      projectionAuthority: 'UNVERIFIED_EXTERNAL_EVIDENCE',
    });
    tx.create(eventRef, {
      ...common, eventId,
      eventType: status === 'RECONCILIATION_REQUIRED'
        ? 'EXTERNAL_FHIR_VERSION_QUARANTINED' : 'EXTERNAL_FHIR_VERSION_IMPORTED',
      aggregateType: 'EXTERNAL_FHIR_EVIDENCE',
      aggregateId: patientId,
      payload: { ...prepared.summary, sourceVersionId: prepared.sourceVersionId },
      occurredAt: prepared.sourceLastUpdatedAt,
    });
    tx.create(auditRef, {
      tenantId, patientId, actorId: actor.actorId, sourceId,
      action: 'EXTERNAL_FHIR_IMPORT', targetId: prepared.receiptId,
      eventId, recordedAt, resourceHash: prepared.resourceHash,
      result: status, immutable: true,
    });
    tx.create(outboxRef, {
      ...common, eventId, status: 'HELD',
      destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
      reason: 'Independent external context projection and clinical review not yet qualified',
    });
    // Version collisions never silently replace current clinical evidence.
    // Each conflicting version becomes a durable, reviewable case.
    if (status === 'RECONCILIATION_REQUIRED') {
      const caseId = 'frc_' + prepared.receiptId.slice(4);
      tx.create(tenantRef.collection('fhirReconciliationCases').doc(caseId), {
        caseId, tenantId, patientId, sourceId,
        facilityId: source.facilityId,
        resourceType: prepared.resourceType,
        resourceId: prepared.resourceId,
        conflictingReceiptId: prepared.receiptId,
        currentReceiptId: previous?.receiptId || null,
        reason: 'SOURCE_VERSION_TIE',
        status: 'OPEN',
        recordedAt,
        approvals: [],
        resolution: null,
        immutableSourceVersion: true,
      });
    }
    if (status === 'CURRENT') {
      tx.set(headRef, {
        tenantId, patientId, sourceId,
        resourceType: prepared.resourceType, resourceId: prepared.resourceId,
        sourceVersionId: prepared.sourceVersionId,
        sourceLastUpdatedAt: prepared.sourceLastUpdatedAt,
        receiptId: prepared.receiptId, recordedAt,
      });
    }
    traceFhirStage('TRANSACTION_CALLBACK_DONE_BEFORE_COMMIT');
    return {
      receiptId: prepared.receiptId, eventId, tenantId, patientId, sourceId,
      resourceType: prepared.resourceType, resourceId: prepared.resourceId,
      sourceVersionId: prepared.sourceVersionId, status, replay: false,
    };
  }).then(result => {
    traceFhirStage('TRANSACTION_COMMITTED');
    return result;
  });
}
