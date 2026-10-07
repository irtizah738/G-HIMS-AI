import { z } from 'zod';

export const HOSPITAL0_EVIDENCE_FILES = [
  'staging-deployment-evidence.json',
  'staging-smoke.json',
  'hospital0-identity-provisioning.json',
  'hospital0-credential-scope-review.json',
  'hospital0-physical-offline.json',
  'hospital0-cross-role-rehearsal.json',
  'hospital0-opd-browser-e2e.json',
  'hospital0-backup-restore.json',
  'hospital0-rollback.json',
  'hospital0-projection-recovery.json',
  'hospital0-authenticated-load.json',
  'hospital0-independent-security.json',
  'hospital0-alert-routing.json',
  'hospital0-consent.json',
  'hospital0-training-signoff.json',
  'hospital0-daily-log.json',
  'hospital0-site-signoff.json',
] as const;

export type Hospital0EvidenceFile = typeof HOSPITAL0_EVIDENCE_FILES[number];

export interface Hospital0QualificationContext {
  qualificationRunId: string;
  gitCommitSha: string;
}

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i, '40-character Git commit SHA required');
const httpsUrlSchema = z.string().url().refine((value) => value.startsWith('https://'), {
  message: 'remote HTTPS URL required',
});

const baseEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  qualificationRunId: z.string().min(8),
  gitCommitSha: shaSchema,
  deploymentId: z.string().min(1),
  firebaseProjectId: z.string().min(1),
  deploymentUrl: httpsUrlSchema,
  runtime: z.literal('STAGING'),
  success: z.literal(true),
  recordedAt: z.string().datetime(),
}).passthrough();

const stagingDeploymentSchema = baseEvidenceSchema.extend({
  mainSha: shaSchema,
  dedicatedProject: z.literal(true),
  demoProjectId: z.string().optional(),
  productionProjectId: z.string().optional(),
}).superRefine((body, ctx) => {
  if (body.mainSha !== body.gitCommitSha) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mainSha must equal gitCommitSha' });
  }
  if (body.demoProjectId && body.demoProjectId === body.firebaseProjectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Firebase STAGING project collides with DEMO' });
  }
  if (body.productionProjectId && body.productionProjectId === body.firebaseProjectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Firebase STAGING project collides with PRODUCTION' });
  }
});

const smokeSchema = baseEvidenceSchema.extend({
  expectedRuntime: z.literal('STAGING'),
  checks: z.array(z.object({
    check: z.string().min(1),
    status: z.number().int(),
  }).passthrough()).min(4),
});

const identitySchema = baseEvidenceSchema.extend({
  tenantId: z.string().min(1),
  syntheticOnly: z.literal(true),
  roles: z.array(z.string().min(1)).min(7),
  canonicalMembershipsProvisioned: z.literal(true),
});

const credentialScopeSchema = baseEvidenceSchema.extend({
  reviewed: z.literal(true),
  allClinicalIdentitiesBackedByEmployee: z.literal(true),
  mandatoryCredentialsVerified: z.literal(true),
  privilegeFacilityScopeVerified: z.literal(true),
  privilegeDepartmentScopeVerified: z.literal(true),
});

const physicalOfflineSchema = baseEvidenceSchema.extend({
  devices: z.array(z.object({
    deviceId: z.string().min(1),
    physical: z.literal(true),
  }).passthrough()).min(2),
  syntheticToggleOnly: z.literal(false),
  zeroDuplicateReplay: z.literal(true),
  sharedWorkstationActorIsolation: z.literal(true),
  encryptedPhiAtRestVerified: z.literal(true),
  reconnectReplayVerified: z.literal(true),
});

const crossRoleSchema = baseEvidenceSchema.extend({
  requiredRoles: z.array(z.string().min(1)).min(7),
  summary: z.object({
    failed: z.literal(0),
    passed: z.number().int().positive(),
  }).passthrough(),
});

const browserE2eSchema = baseEvidenceSchema.extend({
  browser: z.string().min(1),
  summary: z.object({
    failed: z.literal(0),
    passed: z.number().int().positive(),
  }).passthrough(),
});

const backupRestoreSchema = baseEvidenceSchema.extend({
  restoreTargetProjectId: z.string().min(1),
  rpoSeconds: z.number().nonnegative(),
  rtoSeconds: z.number().positive(),
  sourceEventCount: z.number().int().nonnegative(),
  restoredEventCount: z.number().int().nonnegative(),
}).superRefine((body, ctx) => {
  if (body.restoreTargetProjectId === body.firebaseProjectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'restore target must be isolated from STAGING authority' });
  }
  if (body.sourceEventCount !== body.restoredEventCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'restored event count must match source event count' });
  }
});

const rollbackSchema = baseEvidenceSchema.extend({
  rollbackSucceeded: z.literal(true),
  originalDeploymentId: z.string().min(1),
  rollbackDeploymentId: z.string().min(1),
});

const projectionRecoverySchema = baseEvidenceSchema.extend({
  injectedFailureObserved: z.literal(true),
  deterministicRebuild: z.literal(true),
  fingerprintMatch: z.literal(true),
  immutableEventsPreserved: z.literal(true),
});

const loadSchema = baseEvidenceSchema.extend({
  requests: z.number().int().min(10),
  concurrency: z.number().int().min(1),
  results: z.object({
    errorRate: z.number().min(0).max(1),
    latencyMs: z.object({ p95: z.number().nonnegative() }).passthrough(),
  }).passthrough(),
  thresholds: z.object({
    maxErrorRate: z.number().min(0).max(1),
    p95LimitMs: z.number().positive(),
  }).passthrough(),
}).superRefine((body, ctx) => {
  if (body.results.errorRate > body.thresholds.maxErrorRate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'load error rate exceeds threshold' });
  }
  if (body.results.latencyMs.p95 > body.thresholds.p95LimitMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'load p95 exceeds threshold' });
  }
});

const independentSecuritySchema = baseEvidenceSchema.extend({
  assessor: z.string().min(1),
  testedCommitSha: shaSchema,
  unresolvedCritical: z.literal(0),
  unresolvedHigh: z.literal(0),
  retestCompleted: z.literal(true),
}).superRefine((body, ctx) => {
  if (body.testedCommitSha !== body.gitCommitSha) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'security assessment commit must equal qualification commit' });
  }
});

const alertSchema = baseEvidenceSchema.extend({
  alertRoute: z.string().min(1),
  delivered: z.literal(true),
  acknowledged: z.literal(true),
});

const consentSchema = baseEvidenceSchema.extend({
  status: z.literal('SIGNED'),
  livePilotUseApproved: z.literal(true),
  approvingInstitution: z.string().min(1),
  signedAt: z.string().datetime(),
});

const trainingSchema = baseEvidenceSchema.extend({
  participants: z.array(z.object({
    participantId: z.string().min(1),
    acknowledged: z.literal(true),
  }).passthrough()).min(1),
});

const dailyLogSchema = baseEvidenceSchema.extend({
  pilotDate: z.string().min(10),
  operatorId: z.string().min(1),
  incidents: z.array(z.unknown()),
  completed: z.literal(true),
});

const siteSignoffSchema = baseEvidenceSchema.extend({
  status: z.literal('SIGNED'),
  unresolvedCriticalIssues: z.literal(0),
  unresolvedHighIssues: z.literal(0),
  signedBy: z.string().min(1),
  signedAt: z.string().datetime(),
});

const schemas: Record<Hospital0EvidenceFile, z.ZodTypeAny> = {
  'staging-deployment-evidence.json': stagingDeploymentSchema,
  'staging-smoke.json': smokeSchema,
  'hospital0-identity-provisioning.json': identitySchema,
  'hospital0-credential-scope-review.json': credentialScopeSchema,
  'hospital0-physical-offline.json': physicalOfflineSchema,
  'hospital0-cross-role-rehearsal.json': crossRoleSchema,
  'hospital0-opd-browser-e2e.json': browserE2eSchema,
  'hospital0-backup-restore.json': backupRestoreSchema,
  'hospital0-rollback.json': rollbackSchema,
  'hospital0-projection-recovery.json': projectionRecoverySchema,
  'hospital0-authenticated-load.json': loadSchema,
  'hospital0-independent-security.json': independentSecuritySchema,
  'hospital0-alert-routing.json': alertSchema,
  'hospital0-consent.json': consentSchema,
  'hospital0-training-signoff.json': trainingSchema,
  'hospital0-daily-log.json': dailyLogSchema,
  'hospital0-site-signoff.json': siteSignoffSchema,
};

export function validateHospital0Evidence(
  file: Hospital0EvidenceFile,
  body: unknown,
  context: Hospital0QualificationContext
): string[] {
  const parsed = schemas[file].safeParse(body);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}:${issue.message}`);

  if (parsed.success) {
    const value = parsed.data as {
      qualificationRunId: string;
      gitCommitSha: string;
    };
    if (value.qualificationRunId !== context.qualificationRunId) {
      issues.push('QUALIFICATION_RUN_ID_MISMATCH');
    }
    if (value.gitCommitSha.toLowerCase() !== context.gitCommitSha.toLowerCase()) {
      issues.push('QUALIFICATION_COMMIT_SHA_MISMATCH');
    }
  }

  return issues;
}
