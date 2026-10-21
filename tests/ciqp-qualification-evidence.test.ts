import { describe, expect, test } from 'bun:test';
import {
  assessCiqpQualificationEvidence,
  type CiqpEvidenceRecord,
  type CiqpQualificationEvidence,
} from '@/lib/clinical/patient360/ciqp-qualification-evidence';

const SHA = 'a'.repeat(40);
const link = 'https://github.com/irtizah738/G-HIMS-AI/actions/runs/38301018368';
const receipt: CiqpEvidenceRecord = {
  sha: SHA, evidenceUrl: link,
  approvedBy: 'credentialed-reviewer', observedAtUtc: '2026-10-13T00:00:00Z',
};
const complete = (): CiqpQualificationEvidence => ({
  repository: 'irtizah738/G-HIMS-AI',
  candidateSha: SHA,
  productionProjectId: 'g-hims-ai',
  stagingProjectId: 'ghims-ai-ciqp-staging',
  syntheticOnlyAttestation: receipt,
  fullExactHeadCi: receipt,
  raceCrashRetryEmulator: receipt,
  stagingReadOnlyInventory: receipt,
  stagingDryRun: receipt,
  approvedStagingApply: receipt,
  timelineParity: receipt,
  immutableEventAndOutboxProof: receipt,
  clinicalIntelligenceSnapshotLineage: {
    sourceSnapshotCount: 3, postMigrationSnapshotCount: 3,
    sourceIdentifierHmac: 'd'.repeat(64), postMigrationIdentifierHmac: 'd'.repeat(64),
    sourceProvenanceHmac: 'e'.repeat(64), postMigrationProvenanceHmac: 'e'.repeat(64),
    receipt,
  },
  outboxConsumptionReconciliation: {
    pendingBefore: 2, pendingAfter: 1,
    consumedBefore: 5, consumedAfter: 6,
    duplicateDispatchesObserved: 0, migrationEmittedOutboxRecords: 0,
    receipt,
  },
  restoration: {
    sourceStagingProject: 'ghims-ai-ciqp-staging',
    isolatedRestoreProject: 'ghims-ai-ciqp-restore',
    sourceEventCount: 8,
    restoredEventCount: 8,
    sourceOutboxCount: 4,
    restoredOutboxCount: 4,
    sourceImmutableHmac: 'b'.repeat(64),
    restoredImmutableHmac: 'b'.repeat(64),
    sourceOutboxHmac: 'c'.repeat(64),
    restoredOutboxHmac: 'c'.repeat(64),
    exportOperationId: 'export-operation-1',
    importOperationId: 'import-operation-1',
    observedRpoSeconds: 0,
    observedRtoSeconds: 85,
    receipt,
  },
  namedOperatorApproval: receipt,
  credentialedClinicalReview: receipt,
  institutionalAuthorization: receipt,
  reviewedProductionMigrationPlan: receipt,
});

describe('CIQP-05 migration qualification evidence stays fail-closed', () => {
  test('empty or partially completed evidence never implies release', () => {
    const e: CiqpQualificationEvidence = {
      repository: 'irtizah738/G-HIMS-AI',
      candidateSha: SHA,
      stagingProjectId: 'ghims-ai-ciqp-staging',
      productionProjectId: 'g-hims-ai',
      fullExactHeadCi: receipt,
    };
    const result = assessCiqpQualificationEvidence(e);
    expect(result.documentationStatus).toBe('INCOMPLETE');
    expect(result.missing).toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
    expect(result.missing).toContain('institutionalAuthorization');
    expect(result.missing).toContain('credentialedClinicalReview');
    expect(result.clinicalReleaseAuthority).toBe('NOT_ESTABLISHED');
    expect(result.productionDeploymentAuthority).toBe('NOT_ESTABLISHED');
  });

  test('bad SHA, HTTP link, missing signer and improper project boundaries fail', () => {
    const e = complete();
    e.fullExactHeadCi = { sha: 'b'.repeat(40), evidenceUrl: link };
    e.credentialedClinicalReview = { sha: SHA, evidenceUrl: 'http://example.org/untrusted' };
    e.stagingProjectId = e.productionProjectId;
    const report = assessCiqpQualificationEvidence(e);
    expect(report.missing).toContain('INDEPENDENT_STAGING_PROJECT');
    expect(report.missing).toContain('fullExactHeadCi');
    expect(report.missing).toContain('credentialedClinicalReview');
    expect(report.documentationStatus).toBe('INCOMPLETE');
  });

  test('canonical production cannot be spoofed and G-HIMS-OS staging cannot qualify this product', () => {
    const spoofed = complete();
    spoofed.productionProjectId = 'fabricated-production';
    expect(assessCiqpQualificationEvidence(spoofed).missing)
      .toContain('INDEPENDENT_STAGING_PROJECT');
    const wrongStaging = complete();
    wrongStaging.stagingProjectId = 'studio-1130431360-48a05';
    wrongStaging.restoration!.sourceStagingProject = 'studio-1130431360-48a05';
    expect(assessCiqpQualificationEvidence(wrongStaging).missing)
      .toContain('INDEPENDENT_STAGING_PROJECT');
    const wrongRestore = complete();
    wrongRestore.restoration!.isolatedRestoreProject = 'studio-1130431360-48a05';
    expect(assessCiqpQualificationEvidence(wrongRestore).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
    expect(assessCiqpQualificationEvidence(wrongRestore).clinicalReleaseAuthority)
      .toBe('NOT_ESTABLISHED');
  });

  test('mismatched event or outbox fingerprints and a same-project restore are rejected', () => {
    const e = complete();
    if (!e.restoration) throw new Error('fixture');
    e.restoration.restoredImmutableHmac = 'd'.repeat(64);
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
    e.restoration.restoredImmutableHmac = e.restoration.sourceImmutableHmac;
    e.restoration.isolatedRestoreProject = e.stagingProjectId;
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
  });

  test('missing historic clinical intelligence snapshot identity/provenance evidence blocks documentation', () => {
    const evidence = complete();
    delete evidence.clinicalIntelligenceSnapshotLineage;
    expect(assessCiqpQualificationEvidence(evidence).missing)
      .toContain('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
  });

  test('snapshot identity or provenance drift blocks qualification even when counts agree', () => {
    const evidence = complete();
    const snapshot = evidence.clinicalIntelligenceSnapshotLineage!;
    snapshot.postMigrationIdentifierHmac = 'f'.repeat(64);
    expect(assessCiqpQualificationEvidence(evidence).missing)
      .toContain('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
    snapshot.postMigrationIdentifierHmac = snapshot.sourceIdentifierHmac;
    snapshot.postMigrationProvenanceHmac = 'f'.repeat(64);
    expect(assessCiqpQualificationEvidence(evidence).missing)
      .toContain('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
    snapshot.postMigrationProvenanceHmac = snapshot.sourceProvenanceHmac;
    snapshot.postMigrationSnapshotCount += 1;
    expect(assessCiqpQualificationEvidence(evidence).missing)
      .toContain('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
    snapshot.postMigrationSnapshotCount = snapshot.sourceSnapshotCount;
    snapshot.receipt = { sha: 'f'.repeat(40), evidenceUrl: link };
    expect(assessCiqpQualificationEvidence(evidence).missing)
      .toContain('CLINICAL_INTELLIGENCE_SNAPSHOT_LINEAGE');
  });

  test('missing, duplicated, unobserved or regressing outbox consumption blocks qualification', () => {
    const e = complete();
    delete e.outboxConsumptionReconciliation;
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('OUTBOX_CONSUMPTION_RECONCILIATION');
    const base = complete();
    const o = base.outboxConsumptionReconciliation!;
    o.duplicateDispatchesObserved = 1;
    expect(assessCiqpQualificationEvidence(base).missing)
      .toContain('OUTBOX_CONSUMPTION_RECONCILIATION');
    o.duplicateDispatchesObserved = 0;
    o.migrationEmittedOutboxRecords = 1;
    expect(assessCiqpQualificationEvidence(base).missing)
      .toContain('OUTBOX_CONSUMPTION_RECONCILIATION');
    o.migrationEmittedOutboxRecords = 0;
    o.consumedAfter = o.consumedBefore - 1;
    expect(assessCiqpQualificationEvidence(base).missing)
      .toContain('OUTBOX_CONSUMPTION_RECONCILIATION');
    o.consumedAfter = o.consumedBefore;
    o.pendingAfter = o.pendingBefore + 1;
    expect(assessCiqpQualificationEvidence(base).missing)
      .toContain('OUTBOX_CONSUMPTION_RECONCILIATION');
  });

  test('even a syntactically complete manifest is not independent clinical or production approval', () => {
    const report = assessCiqpQualificationEvidence(complete());
    expect(report.missing).toEqual([]);
    expect(report.documentationStatus)
      .toBe('DOCUMENTATION_READY_FOR_INDEPENDENT_VERIFICATION');
    expect(report.clinicalReleaseAuthority).toBe('NOT_ESTABLISHED');
    expect(report.productionDeploymentAuthority).toBe('NOT_ESTABLISHED');
  });

  test('approval record must be SHA-bound, HTTPS and dated with named signer', () => {
    const e = complete();
    e.namedOperatorApproval = {
      sha: SHA, evidenceUrl: link, approvedBy: '', observedAtUtc: '',
    };
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('namedOperatorApproval');
  });
  test('zero-row or count-mismatched restore cannot qualify as integrity evidence', () => {
    const e = complete();
    if (!e.restoration) throw new Error('fixture');
    e.restoration.sourceEventCount = 0;
    e.restoration.restoredEventCount = 0;
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
    e.restoration.sourceEventCount = 8;
    e.restoration.restoredEventCount = 7;
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
    e.restoration.restoredEventCount = 8;
    e.restoration.sourceOutboxCount = 0;
    e.restoration.restoredOutboxCount = 0;
    expect(assessCiqpQualificationEvidence(e).missing)
      .toContain('INDEPENDENT_BACKUP_RESTORE_AND_INTEGRITY');
  });

});
