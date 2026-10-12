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
  if (!evidence.stagingProjectId ||
      !evidence.productionProjectId ||
      evidence.stagingProjectId === evidence.productionProjectId ||
      evidence.stagingProjectId === 'g-hims-ai') {
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

  const restore = evidence.restoration;
  if (!restore ||
      restore.sourceStagingProject !== evidence.stagingProjectId ||
      !restore.isolatedRestoreProject ||
      restore.isolatedRestoreProject === evidence.stagingProjectId ||
      restore.isolatedRestoreProject === evidence.productionProjectId ||
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
