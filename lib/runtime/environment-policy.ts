import type { GhimsRuntimeMode } from './runtime-mode';

export type ReadinessSeverity = 'BLOCKER' | 'WARNING';

export interface ReadinessFinding {
  code: string;
  severity: ReadinessSeverity;
  message: string;
}

export interface EnvironmentPolicyInput {
  runtimeMode?: string;
  nodeEnv?: string;
  firebaseProjectId?: string;
  publicFirebaseProjectId?: string;
  firestoreEmulatorHost?: string;
  backupBucket?: string;
  backupProjectId?: string;
  backupRetentionDays?: string;
  lastRestoreDrillAt?: string;
  rpoTargetMinutes?: string;
  rtoTargetMinutes?: string;
  alertingDestination?: string;
}

export interface EnvironmentPolicyResult {
  mode: GhimsRuntimeMode;
  productionLike: boolean;
  ready: boolean;
  findings: ReadinessFinding[];
}

const MODES = new Set<GhimsRuntimeMode>(['DEMO', 'TEST', 'STAGING', 'PRODUCTION']);

function normalizedMode(input: EnvironmentPolicyInput): GhimsRuntimeMode {
  const raw = String(input.runtimeMode || '').trim().toUpperCase();
  if (MODES.has(raw as GhimsRuntimeMode)) return raw as GhimsRuntimeMode;
  if (input.nodeEnv === 'test') return 'TEST';
  return 'PRODUCTION';
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

function isNonProductionProject(projectId: string): boolean {
  return /(^|[-_])(dev|demo|test|sandbox|emulator|local)([-_]|$)/i.test(projectId);
}

export function evaluateEnvironmentPolicy(
  input: EnvironmentPolicyInput,
  now = Date.now()
): EnvironmentPolicyResult {
  const mode = normalizedMode(input);
  const productionLike = mode === 'STAGING' || mode === 'PRODUCTION';
  const findings: ReadinessFinding[] = [];
  const blocker = (code: string, message: string) =>
    findings.push({ code, severity: 'BLOCKER', message });
  const warning = (code: string, message: string) =>
    findings.push({ code, severity: 'WARNING', message });

  if (!input.runtimeMode?.trim() && productionLike) {
    blocker('RUNTIME_MODE_NOT_EXPLICIT', 'GHIMS_RUNTIME_MODE must be explicit for deployed environments.');
  }

  if (productionLike) {
    const projectId = String(input.firebaseProjectId || '').trim();
    const publicProjectId = String(input.publicFirebaseProjectId || '').trim();

    if (!projectId) blocker('FIREBASE_PROJECT_REQUIRED', 'FIREBASE_PROJECT_ID is required.');
    if (!publicProjectId) blocker('PUBLIC_FIREBASE_PROJECT_REQUIRED', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID is required.');
    if (projectId && publicProjectId && projectId !== publicProjectId) {
      blocker('FIREBASE_PROJECT_MISMATCH', 'Server and browser Firebase project IDs must match within one deployment.');
    }
    if (mode === 'PRODUCTION' && projectId && isNonProductionProject(projectId)) {
      blocker('PRODUCTION_PROJECT_LOOKS_NON_PRODUCTION', 'Production may not use a project ID labeled dev/demo/test/sandbox/emulator/local.');
    }
    if (input.firestoreEmulatorHost) {
      blocker('EMULATOR_FORBIDDEN', 'Firestore emulator configuration is forbidden in staging/production.');
    }

    if (!input.backupBucket?.trim()) {
      blocker('BACKUP_BUCKET_REQUIRED', 'A dedicated Firestore export bucket must be configured.');
    }
    if (!input.backupProjectId?.trim()) {
      blocker('BACKUP_PROJECT_REQUIRED', 'GHIMS_BACKUP_PROJECT_ID must be configured.');
    } else if (projectId && input.backupProjectId.trim() !== projectId) {
      blocker('BACKUP_PROJECT_MISMATCH', 'Backup project must match the deployed Firestore project.');
    }

    const retention = positiveInteger(input.backupRetentionDays);
    if (!retention) blocker('BACKUP_RETENTION_INVALID', 'GHIMS_BACKUP_RETENTION_DAYS must be a positive integer.');

    const rpo = positiveInteger(input.rpoTargetMinutes);
    const rto = positiveInteger(input.rtoTargetMinutes);
    if (!rpo) blocker('RPO_TARGET_REQUIRED', 'GHIMS_RPO_TARGET_MINUTES must be a positive target.');
    if (!rto) blocker('RTO_TARGET_REQUIRED', 'GHIMS_RTO_TARGET_MINUTES must be a positive target.');

    if (!input.alertingDestination?.trim()) {
      blocker('ALERTING_DESTINATION_REQUIRED', 'A production alerting destination must be configured.');
    }

    if (!input.lastRestoreDrillAt?.trim()) {
      blocker('RESTORE_DRILL_EVIDENCE_REQUIRED', 'A dated successful restore drill is required before production readiness.');
    } else {
      const drilledAt = Date.parse(input.lastRestoreDrillAt);
      if (!Number.isFinite(drilledAt) || drilledAt > now) {
        blocker('RESTORE_DRILL_DATE_INVALID', 'GHIMS_LAST_RESTORE_DRILL_AT must be a valid past timestamp.');
      } else {
        const ageDays = (now - drilledAt) / 86_400_000;
        if (ageDays > 90) {
          blocker('RESTORE_DRILL_STALE', 'The most recent successful restore drill is older than 90 days.');
        } else if (ageDays > 60) {
          warning('RESTORE_DRILL_AGING', 'The restore drill is older than 60 days; schedule the next drill.');
        }
      }
    }
  }

  return {
    mode,
    productionLike,
    ready: !findings.some((finding) => finding.severity === 'BLOCKER'),
    findings,
  };
}

export function evaluateCurrentEnvironment(now = Date.now()): EnvironmentPolicyResult {
  return evaluateEnvironmentPolicy(
    {
      runtimeMode: process.env.GHIMS_RUNTIME_MODE,
      nodeEnv: process.env.NODE_ENV,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      publicFirebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      backupBucket: process.env.GHIMS_BACKUP_BUCKET,
      backupProjectId: process.env.GHIMS_BACKUP_PROJECT_ID,
      backupRetentionDays: process.env.GHIMS_BACKUP_RETENTION_DAYS,
      lastRestoreDrillAt: process.env.GHIMS_LAST_RESTORE_DRILL_AT,
      rpoTargetMinutes: process.env.GHIMS_RPO_TARGET_MINUTES,
      rtoTargetMinutes: process.env.GHIMS_RTO_TARGET_MINUTES,
      alertingDestination: process.env.GHIMS_ALERTING_DESTINATION,
    },
    now
  );
}
