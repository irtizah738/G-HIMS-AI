import {
  DEFAULT_DATA_RETENTION_POLICY,
  readDeploymentRetentionConfiguration,
  validateDataRetentionPolicy,
} from '@/lib/governance/data-retention-policy';

const errors = validateDataRetentionPolicy(DEFAULT_DATA_RETENTION_POLICY);
if (errors.length > 0) {
  throw new Error('RETENTION_POLICY_INVALID:' + errors.join('|'));
}

const configuration = readDeploymentRetentionConfiguration();

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime: String(process.env.GHIMS_RUNTIME_MODE || '').toUpperCase(),
      policyClasses: DEFAULT_DATA_RETENTION_POLICY.map((rule) => ({
        retentionClass: rule.retentionClass,
        authoritative: rule.authoritative,
        immutable: rule.immutable,
        retainByDefault: rule.retainByDefault,
        defaultRetentionDays: rule.defaultRetentionDays,
        deploymentPolicyRequired: rule.deploymentPolicyRequired,
      })),
      deployment: configuration,
      checkedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
