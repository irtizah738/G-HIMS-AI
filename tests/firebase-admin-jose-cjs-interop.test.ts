import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type LockedPackage = { version?: string; dependencies?: Record<string, string> };
type Lock = { lockfileVersion: number; packages: Record<string, LockedPackage> };
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
  overrides: Record<string, unknown>;
};
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lock;

describe('Firebase Admin App Check CJS/ESM interoperability', () => {
  test('scope workaround to the jwks-rsa dependency, preserving other consumers', () => {
    expect(manifest.dependencies['firebase-admin']).toBe('14.5.0');
    expect(manifest.overrides['jwks-rsa']).toEqual({ jose: '4.15.9' });
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/jwks-rsa']?.version).toBe('4.1.0');
    expect(lock.packages['node_modules/jwks-rsa/node_modules/jose']?.version).toBe('4.15.9');
  });

  test('Node.js CommonJS loads Firebase Admin Auth and Firestore without ESM failure', () => {
    const result = execFileSync('node', [
      '-e',
      "require('firebase-admin/auth');require('firebase-admin/firestore');process.stdout.write('OK')",
    ], { cwd: process.cwd(), timeout: 15000, encoding: 'utf8' });
    expect(result).toBe('OK');
  });
});
