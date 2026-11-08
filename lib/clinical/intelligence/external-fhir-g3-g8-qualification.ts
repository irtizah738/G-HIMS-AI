/**
 * Helixis G3–G8: source-only, fail-closed qualification contracts.
 *
 * This module evaluates evidence and plans a migration. It is deliberately
 * incapable of mutating Firestore, enabling flags, granting IAM or issuing a
 * production GO. No user-provided evidence should be treated as trusted until
 * independently verified against its signed artifact and deployed digest.
 */
import { createHash } from 'node:crypto';

export const G3_G8_REQUIRED_CONTROLS = {
  G3: [
    'SOURCE_BASELINE_FINGERPRINT', 'MIGRATION_PLAN_DUAL_REVIEW',
    'SYNTHETIC_ORCHESTRATOR_E2E', 'ONE_OFF_IMPORT_FAILS_CLOSED',
    'SOURCE_REVISION_PRECONDITION', 'STAGING_REHEARSAL_AND_RECOVERY',
  ],
  G4: [
    'DEDICATED_WORKLOAD_IDENTITY', 'SOURCE_SCOPED_SECRET_ACCESS',
    'NO_BROWSER_LEASE_EVENT_OUTBOX_ACCESS', 'HOSPITAL_SITE_CONTRACT_APPROVED',
    'APPROVED_READ_ONLY_FHIR_SCOPES', 'PATIENT_LINK_AND_CONSENT_AT_COMMIT',
    'MFA_AND_DUAL_CLINICAL_REVIEW',
  ],
  G5: [
    'TWO_WORKER_LEASE_CONTENTION', 'EXPIRATION_TAKEOVER_STALE_EPOCH',
    'CLOCK_SKEW_AND_RESTART', 'HTTP_401_403_429_5XX',
    'REGIONAL_OUTAGE_AND_OFFLINE_BACKFILL', 'STALLED_HEAD_DELETE_TOMBSTONE',
    'CONSENT_REVOCATION_AND_SOURCE_SUSPENSION', 'DUPLICATE_AND_REPLAY',
    'RECEIPT_BEFORE_CHECKPOINT_CRASH', 'ROLLBACK_AND_RESTORE_PARITY',
    'IMMUTABLE_RECEIPT_AUDIT_OUTBOX_PARITY',
  ],
  G6: [
    'SOURCE_VERSION_PROVENANCE', 'HELD_EVENTS_UNDISPATCHED',
    'RECONCILIATION_FENCE', 'NO_NATIVE_PATIENT360_PROMOTION',
    'NO_EXTERNAL_AI_DRAFTING_AUTHORITY', 'BLINDED_SYNTHETIC_CLINICAL_EVALUATION',
    'CLINICAL_LEADERSHIP_EMERGENCY_DISCLOSURE',
  ],
  G7: [
    'ARCHITECTURE_SECURITY_CLINICAL_SIGNOFF', 'EXACT_GIT_SHA_AND_IMAGE_DIGEST',
    'CI_AND_SUPPLY_CHAIN_ATTESTATION', 'IAM_MINIMUM_PRIVILEGE_PROOF',
    'PHI_FREE_EGRESS_LOG_EVIDENCE', 'ALERTS_SLOS_AND_QUOTAS',
    'BUDGET_AND_CAPACITY_BOUNDARIES', 'BACKUP_RESTORE_RPO_RTO',
    'ROLLBACK_REHEARSAL', 'INDEPENDENT_CHANGE_AUTHORIZATION',
  ],
  G8: [
    'NAMED_TENANT_FACILITY_SOURCE', 'CLOSED_G1_G2_DEPENDENCIES',
    'SIGNED_NARROW_CANARY_WINDOW', 'FLAGS_DISABLED_BY_DEFAULT',
    'SIGNED_STOP_AND_ROLLBACK_CONDITIONS', 'INDEPENDENT_FINAL_REVIEW',
  ],
} as const;

export type OfflineGate = keyof typeof G3_G8_REQUIRED_CONTROLS;
export type EvidenceStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED' | 'SKIPPED_COST';
export type Environment = 'LOCAL_SYNTHETIC' | 'STAGING_SYNTHETIC' | 'LIVE';
export type GateScope = Readonly<{
  tenantId: string;
  facilityId: string;
  sourceId: string;
  environment: Environment;
}>;
export type GateEvidence = Readonly<{
  gate: OfflineGate;
  control: string;
  status: EvidenceStatus;
  scope: GateScope;
  /** SHA-256 of an independently retained artifact, not a claim of its validity. */
  artifactSha256: string | null;
  artifactRef: string | null;
  reviewerId: string | null;
  assessedAtUtc: string | null;
}>;
export type SignoffRole = 'ARCHITECTURE' | 'SECURITY' | 'CLINICAL' | 'HOSPITAL_AUTHORITY' | 'RELEASE_MANAGER';
export type IndependentSignoff = Readonly<{
  role: SignoffRole;
  signerId: string;
  sourceId: string;
  facilityId: string;
  tenantId: string;
  artifactSha256: string;
  signedAtUtc: string;
  /** Verification requires an external trusted signature authority. */
  independentlyVerified: boolean;
}>;
export type OfflineDossier = Readonly<{
  scope: GateScope;
  evidence: readonly GateEvidence[];
  signoffs: readonly IndependentSignoff[];
  gitSha: string | null;
  imageDigest: string | null;
  changeRequestId: string | null;
  canaryStartUtc: string | null;
  canaryEndUtc: string | null;
  flags: Readonly<{
    externalFhirImport: boolean;
    externalPatient360Promotion: boolean;
    externalClinicalAiDrafting: boolean;
  }>;
  /** These gates need separately verified real workload/egress evidence. */
  externalG1Status: EvidenceStatus;
  externalG2Status: EvidenceStatus;
}>;

export type OfflineGateResult = Readonly<{
  gate: OfflineGate;
  status: 'OFFLINE_EVIDENCE_COMPLETE' | 'BLOCKED';
  blockers: readonly string[];
  passedControls: number;
  requiredControls: number;
}>;
export type OfflineQualificationResult = Readonly<{
  scope: GateScope;
  gates: readonly OfflineGateResult[];
  status: 'OFFLINE_REVIEW_CANDIDATE' | 'BLOCKED';
  productionDecision: 'NO_GO';
  blockers: readonly string[];
  evidenceFingerprint: string;
}>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const IMAGE = /^sha256:[a-f0-9]{64}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GATES = Object.keys(G3_G8_REQUIRED_CONTROLS) as OfflineGate[];

export function assertGateScope(scope: GateScope): void {
  if (!scope || !IDENTIFIER.test(scope.tenantId) ||
      !IDENTIFIER.test(scope.facilityId) || !IDENTIFIER.test(scope.sourceId) ||
      !['LOCAL_SYNTHETIC','STAGING_SYNTHETIC','LIVE'].includes(scope.environment)) {
    throw new Error('G3_G8_SCOPE_INVALID');
  }
}
function scopeMatches(a: GateScope, b: GateScope): boolean {
  return a.tenantId === b.tenantId && a.facilityId === b.facilityId &&
    a.sourceId === b.sourceId && a.environment === b.environment;
}
function validUtc(value: string | null): boolean {
  return value !== null && UTC.test(value) && Number.isFinite(Date.parse(value));
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}
export function offlineDossierFingerprint(dossier: OfflineDossier): string {
  return createHash('sha256').update(canonical(dossier)).digest('hex');
}

/**
 * Evidence assessment is intentionally read-only. A PASS row without a
 * digest, reviewer, matching scope and UTC timestamp is never accepted.
 * Even a fully populated dossier never authorizes production deployment.
 */
export function evaluateG3G8Offline(dossier: OfflineDossier): OfflineQualificationResult {
  assertGateScope(dossier.scope);
  const global: string[] = [];
  const unique = new Map<string, GateEvidence>();
  for (const entry of dossier.evidence) {
    if (!GATES.includes(entry.gate)) {
      global.push('UNKNOWN_GATE');
      continue;
    }
    const key = `${entry.gate}:${entry.control}`;
    if (unique.has(key)) global.push(`DUPLICATE_EVIDENCE:${key}`);
    else unique.set(key, entry);
  }

  const gates: OfflineGateResult[] = GATES.map(gate => {
    const required = G3_G8_REQUIRED_CONTROLS[gate] as readonly string[];
    const blockers: string[] = [];
    let passed = 0;
    for (const control of required) {
      const row = unique.get(`${gate}:${control}`);
      if (!row || row.status !== 'PASS') {
        blockers.push(`${gate}:${control}:${row?.status ?? 'MISSING'}`);
        continue;
      }
      if (!scopeMatches(row.scope, dossier.scope) ||
          !row.artifactSha256 || !SHA.test(row.artifactSha256) ||
          !row.artifactRef || !row.reviewerId ||
          !validUtc(row.assessedAtUtc)) {
        blockers.push(`${gate}:${control}:UNVERIFIABLE_EVIDENCE`);
        continue;
      }
      passed++;
    }
    for (const row of dossier.evidence.filter(e => e.gate === gate)) {
      if (!required.includes(row.control)) blockers.push(`${gate}:UNKNOWN_CONTROL:${row.control}`);
    }
    return { gate, status: blockers.length ? 'BLOCKED' : 'OFFLINE_EVIDENCE_COMPLETE',
      blockers, passedControls: passed, requiredControls: required.length };
  });

  if (!dossier.gitSha || !GIT_SHA.test(dossier.gitSha)) global.push('MISSING_EXACT_GIT_SHA');
  if (!dossier.imageDigest || !IMAGE.test(dossier.imageDigest)) global.push('MISSING_IMAGE_DIGEST');
  if (dossier.flags.externalFhirImport || dossier.flags.externalPatient360Promotion ||
      dossier.flags.externalClinicalAiDrafting) global.push('FLAGS_NOT_DISABLED');
  if (!dossier.changeRequestId || !IDENTIFIER.test(dossier.changeRequestId)) {
    global.push('CHANGE_REQUEST_NOT_APPROVED');
  }
  if (!validUtc(dossier.canaryStartUtc) || !validUtc(dossier.canaryEndUtc) ||
      Date.parse(dossier.canaryStartUtc ?? '') >= Date.parse(dossier.canaryEndUtc ?? '')) {
    global.push('CANARY_WINDOW_INVALID');
  }
  if (dossier.externalG1Status !== 'PASS') global.push(`G1_EGRESS_NO_GO:${dossier.externalG1Status}`);
  if (dossier.externalG2Status !== 'PASS') global.push(`G2_ORCHESTRATOR_NO_GO:${dossier.externalG2Status}`);

  const requiredRoles: SignoffRole[] = [
    'ARCHITECTURE', 'SECURITY', 'CLINICAL', 'HOSPITAL_AUTHORITY', 'RELEASE_MANAGER',
  ];
  const byRole = new Map<SignoffRole, IndependentSignoff>();
  for (const signoff of dossier.signoffs) {
    if (byRole.has(signoff.role)) global.push(`DUPLICATE_SIGNOFF:${signoff.role}`);
    if (!byRole.has(signoff.role)) byRole.set(signoff.role, signoff);
  }
  for (const role of requiredRoles) {
    const s = byRole.get(role);
    if (!s || !s.independentlyVerified || !s.signerId ||
        s.tenantId !== dossier.scope.tenantId ||
        s.facilityId !== dossier.scope.facilityId ||
        s.sourceId !== dossier.scope.sourceId ||
        !SHA.test(s.artifactSha256) || !validUtc(s.signedAtUtc)) {
      global.push(`SIGNOFF_INVALID:${role}`);
    }
  }
  const clinical = byRole.get('CLINICAL')?.signerId;
  const security = byRole.get('SECURITY')?.signerId;
  const hospital = byRole.get('HOSPITAL_AUTHORITY')?.signerId;
  if (clinical && security && hospital && new Set([clinical,security,hospital]).size !== 3) {
    global.push('CLINICAL_SECURITY_HOSPITAL_REVIEW_NOT_INDEPENDENT');
  }
  // No GO status is available from this offline-only module. A future trusted
  // release authority must independently validate evidence signatures and
  // deployed state, then issue the separately authorized change.
  const blockers = [...new Set([...global, ...gates.flatMap(g => g.blockers)])].sort();
  return {
    scope: dossier.scope, gates,
    status: blockers.length ? 'BLOCKED' : 'OFFLINE_REVIEW_CANDIDATE',
    productionDecision: 'NO_GO', blockers,
    evidenceFingerprint: offlineDossierFingerprint(dossier),
  };
}

export type FencedMigrationPlanInput = Readonly<{
  scope: GateScope;
  source: Readonly<{
    tenantId: string; facilityId: string; sourceId: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    securityReviewStatus: 'APPROVED' | 'PENDING' | 'REVOKED';
    syncMode?: 'FENCED';
    sourceRevision: string;
    fixtureOnly: boolean;
  }>;
  orchestratorEndToEndPass: boolean;
  oneOffWriterDisarmed: boolean;
  exactSourceRevisionReadback: boolean;
  twoIndependentReviewerIds: readonly string[];
}>;
export type FencedMigrationPlanResult = Readonly<{
  status: 'PLAN_READY_NO_MUTATION' | 'BLOCKED';
  blockers: readonly string[];
  proposedPatch: Readonly<{ syncMode: 'FENCED' }> | null;
  mutationExecuted: false;
}>;

/** Never toggles LIVE or STAGING sources; the result is a reviewed plan only. */
export function planSyntheticFencedMigration(input: FencedMigrationPlanInput): FencedMigrationPlanResult {
  assertGateScope(input.scope);
  const blockers: string[] = [];
  const s = input.source;
  if (input.scope.environment !== 'STAGING_SYNTHETIC') blockers.push('STAGING_SYNTHETIC_ONLY');
  if (s.tenantId !== input.scope.tenantId || s.facilityId !== input.scope.facilityId ||
      s.sourceId !== input.scope.sourceId) blockers.push('SOURCE_SCOPE_MISMATCH');
  if (s.status !== 'ACTIVE' || s.securityReviewStatus !== 'APPROVED') blockers.push('SOURCE_NOT_APPROVED');
  if (s.syncMode) blockers.push('SOURCE_SYNC_MODE_ALREADY_SET');
  if (!IDENTIFIER.test(s.sourceRevision)) blockers.push('SOURCE_REVISION_INVALID');
  if (!s.fixtureOnly) blockers.push('NOT_SYNTHETIC_SOURCE');
  if (!input.orchestratorEndToEndPass) blockers.push('G2_ORCHESTRATOR_NOT_QUALIFIED');
  if (!input.oneOffWriterDisarmed) blockers.push('LEGACY_IMPORT_WRITER_STILL_ACTIVE');
  if (!input.exactSourceRevisionReadback) blockers.push('SOURCE_REVISION_NOT_FRESH');
  if (input.twoIndependentReviewerIds.length !== 2 ||
      input.twoIndependentReviewerIds.some(id => !IDENTIFIER.test(id)) ||
      new Set(input.twoIndependentReviewerIds).size !== 2) blockers.push('INDEPENDENT_REVIEW_MISSING');
  return {
    status: blockers.length ? 'BLOCKED' : 'PLAN_READY_NO_MUTATION', blockers,
    proposedPatch: blockers.length ? null : { syncMode: 'FENCED' },
    mutationExecuted: false,
  };
}

export type CheckpointPreconditions = Readonly<{
  httpStatus: number;
  operationReservedBeforeHttp: boolean;
  activeFenceAtCommit: boolean;
  sourceActiveAtCommit: boolean;
  verifiedPatientLinkAtCommit: boolean;
  consentGrantedAtCommit: boolean;
  immutableReceiptCommitted: boolean;
  immutableAuditCommitted: boolean;
  heldOutboxCommitted: boolean;
  availabilityReconciled: boolean;
  headCurrent: boolean;
  reconciliationRequired: boolean;
  clinicalResourceEnteredInError: boolean;
}>;
export type CheckpointAssessment = Readonly<{
  checkpointAllowed: boolean;
  disposition: 'CHECKPOINT_CANDIDATE' | 'HELD_RECONCILIATION' | 'RETRY_LATER' | 'BLOCKED_AUTHORITY';
  blockers: readonly string[];
}>;

/** This predicate is not a checkpoint writer; the Firestore transaction still fences it. */
export function assessFhirCheckpoint(input: CheckpointPreconditions): CheckpointAssessment {
  const blockers: string[] = [];
  if (!input.operationReservedBeforeHttp) blockers.push('OPERATION_NOT_RESERVED');
  if (!input.activeFenceAtCommit) blockers.push('STALE_OR_EXPIRED_FENCE');
  if (!input.sourceActiveAtCommit) blockers.push('SOURCE_SUSPENDED');
  if (!input.verifiedPatientLinkAtCommit) blockers.push('PATIENT_LINK_NOT_VERIFIED');
  if (!input.consentGrantedAtCommit) blockers.push('CONSENT_NOT_CURRENT');
  if (!input.immutableReceiptCommitted) blockers.push('RECEIPT_NOT_COMMITTED');
  if (!input.immutableAuditCommitted) blockers.push('AUDIT_NOT_COMMITTED');
  if (!input.heldOutboxCommitted) blockers.push('HELD_OUTBOX_NOT_COMMITTED');
  if (!input.availabilityReconciled) blockers.push('AVAILABILITY_NOT_RECONCILED');
  if (!input.headCurrent) blockers.push('SOURCE_HEAD_NOT_CURRENT');
  if (input.reconciliationRequired) blockers.push('RECONCILIATION_REQUIRED');
  if (input.clinicalResourceEnteredInError) blockers.push('ENTERED_IN_ERROR');
  if (input.httpStatus !== 200) blockers.push(`HTTP_STATUS_${input.httpStatus}`);
  let disposition: CheckpointAssessment['disposition'];
  if (input.httpStatus === 401 || input.httpStatus === 403 ||
      !input.sourceActiveAtCommit || !input.consentGrantedAtCommit ||
      !input.verifiedPatientLinkAtCommit) disposition = 'BLOCKED_AUTHORITY';
  else if (input.httpStatus === 429 || input.httpStatus >= 500) disposition = 'RETRY_LATER';
  else if (blockers.length) disposition = 'HELD_RECONCILIATION';
  else disposition = 'CHECKPOINT_CANDIDATE';
  return { checkpointAllowed: blockers.length === 0, disposition, blockers };
}
