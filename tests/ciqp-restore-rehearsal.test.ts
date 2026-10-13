import { describe, expect, test, spyOn } from 'bun:test';
import {
  assertCiqpRestoreScope, runCiqpRestoreRehearsal,
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

describe('CIQP-182 isolated synthetic Firestore restore rehearsal', () => {
  test('read-only default does not execute gcloud', () => {
    expect(assertCiqpRestoreScope(good).mode).toBe('DRY_RUN');
    let called = false;
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      runCiqpRestoreRehearsal(good, () => {
        called = true;
        return { status: 0 };
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
    { VERCEL: '1' },
  ])('fail closes unsafe project or source %j', changes => {
    expect(() => assertCiqpRestoreScope({ ...good, ...changes }))
      .toThrow('CIQP_RESTORE_ISOLATION_DENIED');
  });

  test('write requires second explicit change control and a separate destination', () => {
    const apply = {
      ...good,
      GHIMS_CIQP_RESTORE_MODE: 'APPLY_RESTORE',
      GHIMS_CIQP_RESTORE_APPLY_ACK: 'AUTHORIZED_RESTORE_TO_EMPTY_SYNTHETIC_PROJECT',
      GHIMS_CIQP_RESTORE_TICKET: 'RESTORE-20261013-TESTED',
      GHIMS_CIQP_RESTORE_OPERATOR_ID: 'qualified.operator',
    };
    expect(() => assertCiqpRestoreScope({
      ...apply, GHIMS_CIQP_RESTORE_TICKET: '',
    })).toThrow('CIQP_RESTORE_APPROVAL_NOT_PRESENT');
    const commands: string[] = [];
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(() => runCiqpRestoreRehearsal(apply, (tool: string, args: string[]) => {
        commands.push(tool + ' ' + args.join(' '));
        return {
          status: 0,
          stdout: JSON.stringify({ name: 'projects/ciqp-ghims-restore/databases/(default)' }),
        };
      })).toThrow('CIQP_RESTORE_EMPTY_DESTINATION_PROOF_REQUIRED');
    } finally {
      log.mockRestore();
    }
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('firestore databases describe');
    expect(commands[0]).toContain('--project=ciqp-ghims-restore');
    expect(commands[0]).not.toContain('firestore import');
  });
});
