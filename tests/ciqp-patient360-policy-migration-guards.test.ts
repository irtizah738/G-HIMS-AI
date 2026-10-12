import { describe, expect, test } from 'bun:test';
import { assertEmulatorPolicyMigrationScope } from '@/lib/clinical/patient360/ciqp-policy-migration';

describe('CIQP-05 migration authority: no hosted data path', () => {
  const good = {
    GHIMS_RUNTIME_MODE: 'TEST',
    NODE_ENV: 'test',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    GHIMS_CIQP_MIGRATION_ACK: 'SYNTHETIC_EMULATOR_POLICY_MIGRATION_ONLY',
    GHIMS_CIQP_MIGRATION_TENANT_ID: 'synthetic-tenant',
  };
  test('allows only explicit synthetic loopback emulators and exact tenant scope', () => {
    expect(() => assertEmulatorPolicyMigrationScope(good, 'synthetic-tenant')).not.toThrow();
    expect(() => assertEmulatorPolicyMigrationScope(
      { ...good, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, 'synthetic-tenant'
    )).not.toThrow();
  });
  test('fails closed for production, staging, remote hosts, and missing acknowledgements', () => {
    for (const changes of [
      { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
      { GHIMS_RUNTIME_MODE: 'STAGING' },
      { GHIMS_RUNTIME_MODE: 'DEMO' },
      { NODE_ENV: 'production' },
      { FIRESTORE_EMULATOR_HOST: 'production.firestore.googleapis.com:443' },
      { FIRESTORE_EMULATOR_HOST: '192.168.1.2:8080' },
      { FIRESTORE_EMULATOR_HOST: '' },
      { GHIMS_CIQP_MIGRATION_ACK: '' },
      { GHIMS_CIQP_MIGRATION_TENANT_ID: 'other-tenant' },
    ]) {
      expect(() => assertEmulatorPolicyMigrationScope(
        { ...good, ...changes }, 'synthetic-tenant'
      )).toThrow('CIQP_POLICY_MIGRATION_EMULATOR_ONLY');
    }
    expect(() => assertEmulatorPolicyMigrationScope(good, '../other'))
      .toThrow('CIQP_POLICY_MIGRATION_EMULATOR_ONLY');
  });
});
