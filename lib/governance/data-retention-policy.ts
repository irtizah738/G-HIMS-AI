export type RetentionClass =
  | 'CLINICAL_AUTHORITY'
  | 'FINANCIAL_AUTHORITY'
  | 'SECURITY_AUDIT'
  | 'DISPOSABLE_PROJECTION'
  | 'OPERATIONAL_TELEMETRY'
  | 'INTEGRATION_RAW'
  | 'SYNTHETIC_QUALIFICATION';

export interface RetentionRule {
  retentionClass: RetentionClass;
  authoritative: boolean;
  immutable: boolean;
  applicationDeletionAllowed: boolean;
  operationalRebuildAllowed: boolean;
  containsPhi: boolean;
  retainByDefault: boolean;
  defaultRetentionDays: number | null;
  deploymentPolicyRequired: boolean;
  notes: string;
}

export const DEFAULT_DATA_RETENTION_POLICY: ReadonlyArray<RetentionRule> = [
  {
    retentionClass: 'CLINICAL_AUTHORITY',
    authoritative: true,
    immutable: true,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: true,
    retainByDefault: true,
    defaultRetentionDays: null,
    deploymentPolicyRequired: true,
    notes:
      'Clinical events, signed notes, orders, administrations and encounter authority are append-only. Retention duration is a deployment/legal policy, not an application default.',
  },
  {
    retentionClass: 'FINANCIAL_AUTHORITY',
    authoritative: true,
    immutable: true,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: true,
    retainByDefault: true,
    defaultRetentionDays: null,
    deploymentPolicyRequired: true,
    notes:
      'Financial journals, invoices, receipts and reconciliation evidence remain authoritative and are never TTL-deleted by application code.',
  },
  {
    retentionClass: 'SECURITY_AUDIT',
    authoritative: true,
    immutable: true,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: false,
    retainByDefault: true,
    defaultRetentionDays: null,
    deploymentPolicyRequired: true,
    notes:
      'Audit/security evidence is server-owned and append-only. Deployment policy must set the institutional/legal retention period.',
  },
  {
    retentionClass: 'DISPOSABLE_PROJECTION',
    authoritative: false,
    immutable: false,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: true,
    containsPhi: true,
    retainByDefault: true,
    defaultRetentionDays: null,
    deploymentPolicyRequired: false,
    notes:
      'Read models may be destroyed only by guarded operational recovery and rebuilt from immutable authority.',
  },
  {
    retentionClass: 'OPERATIONAL_TELEMETRY',
    authoritative: false,
    immutable: false,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: false,
    retainByDefault: true,
    defaultRetentionDays: 30,
    deploymentPolicyRequired: true,
    notes:
      'Operational telemetry must remain PHI-free and may use infrastructure TTL/lifecycle rules.',
  },
  {
    retentionClass: 'INTEGRATION_RAW',
    authoritative: false,
    immutable: false,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: true,
    retainByDefault: false,
    defaultRetentionDays: 0,
    deploymentPolicyRequired: true,
    notes:
      'Raw HL7/EDI/integration payload retention is disabled by default and requires an explicit deployment policy when enabled.',
  },
  {
    retentionClass: 'SYNTHETIC_QUALIFICATION',
    authoritative: false,
    immutable: false,
    applicationDeletionAllowed: false,
    operationalRebuildAllowed: false,
    containsPhi: false,
    retainByDefault: true,
    defaultRetentionDays: 90,
    deploymentPolicyRequired: false,
    notes:
      'Synthetic qualification evidence may be lifecycle-managed separately from patient authority.',
  },
] as const;

export function validateDataRetentionPolicy(
  policy: ReadonlyArray<RetentionRule> = DEFAULT_DATA_RETENTION_POLICY
): string[] {
  const errors: string[] = [];
  const byClass = new Map<RetentionClass, RetentionRule>();

  for (const rule of policy) {
    if (byClass.has(rule.retentionClass)) {
      errors.push('RETENTION_CLASS_DUPLICATE:' + rule.retentionClass);
      continue;
    }
    byClass.set(rule.retentionClass, rule);

    if (rule.authoritative && !rule.immutable) {
      errors.push('AUTHORITATIVE_RETENTION_MUST_BE_IMMUTABLE:' + rule.retentionClass);
    }
    if (rule.authoritative && rule.applicationDeletionAllowed) {
      errors.push('AUTHORITATIVE_APPLICATION_DELETION_FORBIDDEN:' + rule.retentionClass);
    }
    if (
      rule.defaultRetentionDays !== null &&
      (!Number.isInteger(rule.defaultRetentionDays) || rule.defaultRetentionDays < 0)
    ) {
      errors.push('RETENTION_DAYS_INVALID:' + rule.retentionClass);
    }
  }

  const telemetry = byClass.get('OPERATIONAL_TELEMETRY');
  if (!telemetry || telemetry.containsPhi) {
    errors.push('OPERATIONAL_TELEMETRY_MUST_BE_PHI_FREE');
  }

  const raw = byClass.get('INTEGRATION_RAW');
  if (!raw || raw.retainByDefault || raw.defaultRetentionDays !== 0) {
    errors.push('INTEGRATION_RAW_MUST_DEFAULT_TO_NOT_RETAINED');
  }

  const projection = byClass.get('DISPOSABLE_PROJECTION');
  if (!projection || !projection.operationalRebuildAllowed || projection.authoritative) {
    errors.push('PROJECTION_RETENTION_CONTRACT_INVALID');
  }

  return errors;
}

export interface DeploymentRetentionConfiguration {
  operationalDays: number;
  auditPolicy: string;
  clinicalAuthorityPolicy: string;
  financialAuthorityPolicy: string;
  integrationRawPolicy: string;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(name + '_INVALID');
  }
  return parsed;
}

export function readDeploymentRetentionConfiguration(
  env: NodeJS.ProcessEnv = process.env
): DeploymentRetentionConfiguration {
  const runtime = String(env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
  if (!['STAGING', 'PRODUCTION'].includes(runtime)) {
    throw new Error('RETENTION_PREFLIGHT_DEPLOYED_RUNTIME_REQUIRED');
  }

  const requiredText = (name: string): string => {
    const value = String(env[name] || '').trim();
    if (!value) throw new Error(name + '_REQUIRED');
    return value;
  };

  return {
    operationalDays: positiveInteger(
      env.GHIMS_RETENTION_OPERATIONAL_DAYS,
      'GHIMS_RETENTION_OPERATIONAL_DAYS'
    ),
    auditPolicy: requiredText('GHIMS_RETENTION_AUDIT_POLICY'),
    clinicalAuthorityPolicy: requiredText('GHIMS_RETENTION_CLINICAL_AUTHORITY_POLICY'),
    financialAuthorityPolicy: requiredText('GHIMS_RETENTION_FINANCIAL_AUTHORITY_POLICY'),
    integrationRawPolicy: requiredText('GHIMS_RETENTION_INTEGRATION_RAW_POLICY'),
  };
}
