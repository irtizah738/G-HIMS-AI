import { describe, expect, test, spyOn } from 'bun:test';
import {
  assertCiqpRestoreScope,
  runCiqpRestoreRehearsal,
} from '../scripts/ops/ciqp-restore-rehearsal.mjs';

const good = {
  GHIMS_RUNTIME_MODE: 'STAGING',
  GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-ai-ciqp-staging',
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
  GHIMS_CIQP_RESTORE_SOURCE_STAGING: 'ghims-ai-ciqp-staging',
  GHIMS_CIQP_RESTORE_DESTINATION_PROJECT: 'ciqp-ghims-restore',
  GHIMS_CIQP_RESTORE_CONFIRM_DESTINATION: 'ciqp-ghims-restore',
  GHIMS_CIQP_RESTORE_CONFIRM_SOURCE: 'ghims-ai-ciqp-staging',
  GHIMS_CIQP_RESTORE_SYNTHETIC_ACK: 'SYNTHETIC_ONLY_INDEPENDENT_RESTORE',
  GHIMS_CIQP_RESTORE_EXPORT_URI: 'gs://ciqp-test-export/synthetic/20261013',
  GHIMS_CIQP_RESTORE_DATABASE_ID: '(default)',
  GHIMS_CIQP_RESTORE_MODE: 'DRY_RUN',
};

const apply = {
  ...good,
  GHIMS_CIQP_RESTORE_MODE: 'APPLY_RESTORE',
  GHIMS_CIQP_RESTORE_APPLY_ACK: 'AUTHORIZED_RESTORE_TO_EMPTY_SYNTHETIC_PROJECT',
  GHIMS_CIQP_RESTORE_TICKET: 'RESTORE-20261013-TESTED',
  GHIMS_CIQP_RESTORE_OPERATOR_ID: 'qualified.operator',
  GHIMS_CIQP_RESTORE_EMPTY_TARGET_ATTESTATION_SHA256: 'a'.repeat(64),
};

const metadata = JSON.stringify({ name: 'projects/ciqp-ghims-restore/databases/(default)' });

function fakeGcloud(commands: string[], overrides: {
  metadata?: string;
  token?: string;
  importStatus?: number;
} = {}) {
  return (tool: string, args: string[]) => {
    commands.push(tool + ' ' + args.join(' '));
    expect(tool).toBe('gcloud');
    if (args[0] === 'firestore' && args[1] === 'databases') {
      return { status: 0, stdout: overrides.metadata ?? metadata };
    }
    if (args[0] === 'auth') {
      return { status: 0, stdout: overrides.token ?? 'synthetic-token' };
    }
    if (args[0] === 'firestore' && args[1] === 'import') {
      return { status: overrides.importStatus ?? 0, stdout: '' };
    }
    throw new Error('UNEXPECTED_TEST_COMMAND');
  };
}

const emptyInventory = async () => ({
  ok: true,
  json: async () => ({}),
});

describe('CIQP-182 isolated synthetic Firestore restore rehearsal', () => {
  test('read-only default does not execute gcloud or Firestore requests', async () => {
    expect(assertCiqpRestoreScope(good).mode).toBe('DRY_RUN');
    let called = false;
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runCiqpRestoreRehearsal(good, () => {
        called = true;
        return { status: 0 };
      }, async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      });
      expect(called).toBe(false);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toContain('"writesToSource":0');
      expect(log.mock.calls[0]?.[0]).toContain('"productionReleaseAuthority":"NOT_GRANTED"');
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
    { GHIMS_CIQP_RESTORE_SOURCE_STAGING: 'g-hims-ai',
      GHIMS_FIREBASE_PROJECT_ID_STAGING: 'g-hims-ai',
      GHIMS_CIQP_RESTORE_CONFIRM_SOURCE: 'g-hims-ai' },
    { GHIMS_CIQP_RESTORE_DESTINATION_PROJECT: 'g-hims-ai',
      GHIMS_CIQP_RESTORE_CONFIRM_DESTINATION: 'g-hims-ai' },
    { GHIMS_CIQP_RESTORE_DESTINATION_PROJECT: 'ghims-ai-ciqp-staging',
      GHIMS_CIQP_RESTORE_CONFIRM_DESTINATION: 'ghims-ai-ciqp-staging' },
    { GHIMS_CIQP_RESTORE_CONFIRM_DESTINATION: '' },
    { GHIMS_CIQP_RESTORE_EXPORT_URI: 'gs://bucket/../production' },
    { GHIMS_CIQP_RESTORE_EXPORT_URI: 'https://example.com/foo' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { VERCEL: '1' },
  ])('fail closes unsafe project or source %j', changes => {
    expect(() => assertCiqpRestoreScope({ ...good, ...changes }))
      .toThrow('CIQP_RESTORE_ISOLATION_DENIED');
  });

  test('restore cannot use G-HIMS-OS staging or a forged production comparator', () => {
    const os = 'studio-1130431360-48a05';
    expect(() => assertCiqpRestoreScope({
      ...good,
      GHIMS_CIQP_RESTORE_SOURCE_STAGING: os,
      GHIMS_FIREBASE_PROJECT_ID_STAGING: os,
      GHIMS_CIQP_RESTORE_CONFIRM_SOURCE: os,
    })).toThrow('CIQP_RESTORE_ISOLATION_DENIED');
    expect(() => assertCiqpRestoreScope({
      ...good, GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'fabricated-production',
    })).toThrow('CIQP_RESTORE_ISOLATION_DENIED');
  });

  test('apply requires ticket, named operator and separate attestation', () => {
    expect(() => assertCiqpRestoreScope({ ...apply, GHIMS_CIQP_RESTORE_TICKET: '' }))
      .toThrow('CIQP_RESTORE_APPROVAL_NOT_PRESENT');
    expect(() => assertCiqpRestoreScope({
      ...apply, GHIMS_CIQP_RESTORE_EMPTY_TARGET_ATTESTATION_SHA256: '',
    })).toThrow('CIQP_RESTORE_APPROVAL_NOT_PRESENT');
    expect(() => assertCiqpRestoreScope({
      ...apply, GHIMS_CIQP_RESTORE_OPERATOR_ID: '',
    })).toThrow('CIQP_RESTORE_APPROVAL_NOT_PRESENT');
  });

  test('empty verified target can invoke import only after metadata and inventory', async () => {
    const commands: string[] = [];
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    const requests: string[] = [];
    try {
      await runCiqpRestoreRehearsal(
        apply,
        fakeGcloud(commands),
        async (url: string, options: { method: string; headers: Record<string, string> }) => {
          requests.push(url);
          expect(options.method).toBe('POST');
          expect(options.headers.Authorization).toBe('Bearer synthetic-token');
          return emptyInventory();
        },
      );
    } finally {
      log.mockRestore();
    }
    expect(commands).toHaveLength(3);
    expect(commands[0]).toContain('firestore databases describe');
    expect(commands[1]).toContain('auth print-access-token');
    expect(commands[2]).toContain('firestore import');
    expect(commands[2]).toContain('--project=ciqp-ghims-restore');
    expect(commands[2]).not.toContain('--project=g-hims-ai');
    expect(requests).toEqual([
      'https://firestore.googleapis.com/v1/projects/ciqp-ghims-restore/databases/(default)/documents:listCollectionIds',
    ]);
  });

  test.each([
    { label: 'existing collection', body: { collectionIds: ['tenants'] } },
    { label: 'pagination', body: { nextPageToken: 'more' } },
    { label: 'invalid schema', body: { collectionIds: 'invalid' } },
  ])('never imports if read-only inventory contains $label', async ({ body }) => {
    const commands: string[] = [];
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runCiqpRestoreRehearsal(
        apply, fakeGcloud(commands),
        async () => ({ ok: true, json: async () => body }),
      )).rejects.toThrow('CIQP_RESTORE_EMPTY_DESTINATION_PROOF_REQUIRED');
    } finally {
      log.mockRestore();
    }
    expect(commands).toHaveLength(2);
    expect(commands.every(command => !command.includes('firestore import'))).toBe(true);
  });

  test('fails closed on wrong database, missing credentials, and failed Firestore inspection', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runCiqpRestoreRehearsal(
        apply, fakeGcloud([], { metadata: JSON.stringify({ name: 'projects/g-hims-ai/databases/(default)' }) }),
        emptyInventory,
      )).rejects.toThrow('CIQP_RESTORE_DESTINATION_UNVERIFIED');

      await expect(runCiqpRestoreRehearsal(
        apply, fakeGcloud([], { token: '' }), emptyInventory,
      )).rejects.toThrow('CIQP_RESTORE_INVENTORY_UNAUTHORIZED');

      const commands: string[] = [];
      await expect(runCiqpRestoreRehearsal(
        apply, fakeGcloud(commands),
        async () => ({ ok: false, json: async () => ({}) }),
      )).rejects.toThrow('CIQP_RESTORE_EMPTY_DESTINATION_PROOF_REQUIRED');
      expect(commands.every(command => !command.includes('firestore import'))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  test('gcloud import failure remains a denied restore, never a release approval', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runCiqpRestoreRehearsal(
        apply, fakeGcloud([], { importStatus: 1 }), emptyInventory,
      )).rejects.toThrow('CIQP_SYNTHETIC_RESTORE_EXECUTION_FAILED');
    } finally {
      log.mockRestore();
    }
  });
});
