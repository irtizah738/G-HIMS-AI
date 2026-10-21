/**
 * CIQP-05 evidence completeness check. This does NOT validate signatures,
 * Firestore backups, deployments, or hospital authority by itself.
 * It can never return a production release authorization.
 */
export interface CiqpEvidenceRecord {
  sha: string;
  evidenceUrl: string;
  approvedBy?: string;
  observedAtUtc?: string;
}

export interface CiqpRestoreEvidence {
  sourceStagingProject: string;
  isolatedRestoreProject: string;
  sourceEventCount: number;
  restoredEventCount: number;
  sourceOutboxCount: number;
  restoredOutboxCount: number;
  sourceImmutableHmac: string;
  restoredImmutableHmac: string;
  sourceOutboxHmac: string;
  restoredOutboxHmac: string;
  exportOperationId: string;
  importOperationId: string;
  observedRpoSeconds: number;
  observedRtoSeconds: number;
  receipt: CiqpEvidenceRecord;
}

/**
 * The migration must not silently rewrite the identity/provenance of existing
 * clinical-intelligence snapshots. These HMACs represent a separately
 * recorded read-only inventory, not the individual snapshot identifiers.
 */
export interface CiqpSnapshotLineageEvidence {
  sourceSnapshotCount: number;
  postMigrationSnapshotCount: number;
  sourceIdentifierHmac: string;
  postMigrationIdentifierHmac: string;
  sourceProvenanceHmac: string;
  postMigrationProvenanceHmac: string;
  receipt: CiqpEvidenceRecord;
}

/**
 * Evidence of the outbox consumer's before/after counters, separate from
 * immutable event/outbox fingerprints. The migration itself has no authority
 * to enqueue, consume or replay canonical clinical messages.
 */
export interface CiqpOutboxConsumptionEvidence {
  pendingBefore: number;
  pendingAfter: number;
  consumedBefore: number;
  consumedAfter: number;
  duplicateDispatchesObserved: number;
  migrationEmittedOutboxRecords: number;
  receipt: CiqpEvidenceRecord;
}

export interface CiqpQualificationEvidence {
  repository: 'irtizah738/G-HIMS-AI';
  candidateSha: string;
  productionProjectId: string;
  stagingProjectId: string;
  syntheticOnlyAttestation?: CiqpEvidenceRecord;
  fullExactHeadCi?: CiqpEvidenceRecord;
  raceCrashRetryEmulator?: CiqpEvidenceRecord;
  stagingReadOnlyInventory?: CiqpEvidenceRecord;
  stagingDryRun?: CiqpEvidenceRecord;
  approvedStagingApply?: CiqpEvidenceRecord;
  timelineParity?: CiqpEvidenceRecord;
  immutableEventAndOutboxProof?: CiqpEvidenceRecord;
  clinicalIntelligenceSnapshotLineage?: CiqpSnapshotLineageEvidence;
  outboxConsumptionReconciliation?: CiqpOutboxConsumptionEvidence;
  restoration?: CiqpRestoreEvidence;
  namedOperatorApproval?: CiqpEvidenceRecord;
  credentialedClinicalReview?: CiqpEvidenceRecord;
  institutionalAuthorization?: CiqpEvidenceRecord;
  reviewedProductionMigrationPlan?: CiqpEvidenceRecord;
}

export interface CiqpEvidenceAssessment {
  missing: string[];
  documentationStatus:
    'INCOMPLETE' | 'DOCUMENTATION_READY_FOR_INDEPENDENT_VERIFICATION';
  clinicalReleaseAuthority: 'NOT_ESTABLISHED';
  productionDeploymentAuthority: 'NOT_ESTABLISHED';
}

const sha40 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const hmac64 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const evidenceUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      url.username === '' && url.password === '' &&
      !['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};

/** A SHA-matched URL is a pointer, never independent proof the content is valid. */
function recordPresent(
  record: CiqpEvidenceRecord | undefined, sha: string, needApprover: boolean
): boolean {
  return Boolean(record &&
    sha40(record.sha) && record.sha.toLowerCase() === sha.toLowerCase() &&
    evidenceUrl(record.evidenceUrl) &&
    (!needApprover || (
      typeof record.approvedBy === 'string' &&
      record.approvedBy.trim().length >= 3 &&
      typeof record.observedAtUtc === 'string' &&
      Number.isFinite(Date.parse(record.observedAtUtc))
    )));
}

export function assessCiqpQualificationEvidence(
  evidence: CiqpQualificationEvidence
): CiqpEvidenceAssessment {
  const missing: string[] = [];
  const sha = String(evidence.candidateSha || '');
  if (evidence.repository !== 'irtizah738/G-HIMS-AI' || !sha40(sha)) {
    missing.push('EXACT_GHIMS_AI_CANDIDATE');
  }
  // Exact canonical project trust anchors, not caller-provided comparators.
  // A syntactically complete evidence manifest for G-HIMS-OS is NOT a
  // G-HIMS-AI hosted recovery qualification.
  if (evidence.productionProjectId !== 'g-hims-ai' ||
      !evidence.stagingProjectId ||
      !/^[a-z][a-z0-9-]{4,62}$/.test(evidence.stagingProjectId) ||
      evidence.stagingProjectId === evidence.productionProjectId ||
      evidence.stagingProjectId === 'studio-1130431360-48a05') {
    missing.push('INDEPENDENT_STAGING_PROJECT');
  }
  const required: Array<[keyof CiqpQualificationEvidence, boolean]> = [
    ['syntheticOnlyAttestation', true],
    ['fullExactHeadCi', false],
    ['raceCrashRetryEmulator', false],
    ['stagingReadOnlyInventory', false],
    ['stagingDryRun', false],
    ['approvedStagingApply', true],
    ['timelineParity', false],
    ['immutableEventAndOutboxProof', false],
    ['namedOperatorApproval', true],
    ['credentialedClinicalReview', true],
    ['institutionalAuthorization', true],
    ['reviewedProductionMigrationPlan', true],
  ];
  for (const [key, needsApprover] of required) {
    const record = evidence[key] as CiqpEvidenceRecord | undefined;
    if (!recordPresent(record, sha, needsApprover)) missing.push(String(key));
  }

  // Distinct from event/outbox immutability: unsigned AI evidence snapshots
  // must preserve their original immutable identities and provenance links.
  // Missing/empty collections cannot be treated as a completed lineage drill.
  const snapshot = evidence.clinicalIntelligenceSnapshotLineage;
  if (!snapshot ||
      !Number.isSafeInteger(snapshot.sourceSnapshotCount) ||
      snapshot.sourceSnapshotCount <= 0 ||
      snapshot.postMigrationSnapshotCount !== snapshot.sourceSnapshotCount ||
      !hmac64(snapshot.sourceIdentifierHmac) ||
      snapshot.sourceIdentifierHmac !== snapshot.postMigrationIdentifierHmac ||
      !hmac64(snapshot.sourceProvenanceHmac) ||
      snapshot.sourceProvenanceHmac !== snapshot.postMigrationProvenanceHmac ||
      !recordPresent(snapshot.receipt, sha, false)) {
    missing.push('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
  }

  // Do not confuse an unmodified outbox collection with proof that messages
  // were processed safely. Consumer counters need a separate verified receipt.
  const outbox = evidence.outboxConsumptionReconciliation;
  if (!outbox ||
      !Number.isSafeInteger(outbox.pendingBefore) || outbox.pendingBefore < 0 ||
      !Number.isSafeInteger(outbox.pendingAfter) || outbox.pendingAfter < 0 ||
      !Number.isSafeInteger(outbox.consumedBefore) || outbox.consumedBefore < 0 ||
      !Number.isSafeInteger(outbox.consumedAfter) ||
      outbox.consumedAfter < outbox.consumedBefore ||
      !Number.isSafeInteger(outbox.duplicateDispatchesObserved) ||
      outbox.duplicateDispatchesObserved !== 0 ||
      outbox.migrationEmittedOutboxRecords !== 0 ||
      outbox.pendingAfter > outbox.pendingBefore ||
      !recordPresent(outbox.receipt, sha, false)) {
    missing.push('OUTBOX_CONSUMPTION_RECONCILIATION');
  }

  const restore = evidence.restoration;
  if (!restore ||
      restore.sourceStagingProject !== evidence.stagingProjectId ||
      !restore.isolatedRestoreProject ||
      restore.isolatedRestoreProject === evidence.stagingProjectId ||
      restore.isolatedRestoreProject === evidence.productionProjectId ||
      restore.isolatedRestoreProject === 'studio-1130431360-48a05' ||
      restore.isolatedRestoreProject === 'g-hims-ai' ||
      !Number.isSafeInteger(restore.sourceEventCount) || restore.sourceEventCount <= 0 ||
      restore.sourceEventCount !== restore.restoredEventCount ||
      !Number.isSafeInteger(restore.sourceOutboxCount) || restore.sourceOutboxCount <= 0 ||
      restore.sourceOutboxCount !== restore.restoredOutboxCount ||
      !hmac64(restore.sourceImmutableHmac) ||
      restore.sourceImmutableHmac !== restore.restoredImmutableHmac ||
      !hmac64(restore.sourceOutboxHmac) ||
      restore.sourceOutboxHmac !== restore.restoredOutboxHmac ||
      !restore.exportOperationId?.trim() ||
      !restore.importOperationId?.trim() ||
      !Number.isFinite(restore.observedRpoSeconds) ||
      restore.observedRpoSeconds < 0 ||
      !Number.isFinite(restore.observedRtoSeconds) ||
      restore.observedRtoSeconds < 0 ||
      !recordPresent(restore.receipt, sha, false)) {
    missing.push('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
  }
  return {
    missing,
    documentationStatus: missing.length
      ? 'INCOMPLETE' : 'DOCUMENTATION_READY_FOR_INDEPENDENT_VERIFICATION',
    clinicalReleaseAuthority: 'NOT_ESTABLISHED',
    productionDeploymentAuthority: 'NOT_ESTABLISHED',
  };
}
