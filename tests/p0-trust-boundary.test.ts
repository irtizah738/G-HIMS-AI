/**
 * G-HIMS P0 Core Trust Boundary Regression Suite
 *
 * These tests are intentionally source-level guardrails around defects found in the
 * independent security audit. They complement domain/unit tests; they do not replace
 * Firebase Emulator integration tests.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('G-HIMS P0 Core Trust Boundary regression guards', () => {
  test('Firestore production rules contain no fail-open "|| true" clauses', async () => {
    const rules = await source('firestore.rules');

    expect(rules).not.toContain('|| true');
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  test('browser cannot directly write security/event authority collections', async () => {
    const rules = await source('firestore.rules');

    for (const matcher of [
      'match /sessions/{sessionId}',
      'match /events/{id}',
      'match /outbox/{id}',
      'match /idempotency/{id}',
      'match /financialIdempotency/{id}',
      'match /sso_config/{id}',
    ]) {
      expect(rules).toContain(matcher);
    }
  });

  test('server password login route cannot read or mutate passwords', async () => {
    const route = await source('app/api/auth/login/route.ts');

    expect(route).not.toContain('updateUser(');
    expect(route).not.toContain('getUserByEmail(');
    expect(route).not.toContain('rawPassword');
    expect(route).not.toContain('password:');
    expect(route).toContain('status: 410');
  });

  test('client authentication uses Firebase password authentication before session exchange', async () => {
    const client = await source('lib/auth/auth-client.ts');

    expect(client).toContain('signInWithEmailAndPassword');
    expect(client).toContain("fetch('/api/auth/session'");
    expect(client).not.toContain("fetch('/api/auth/login'");
  });

  test('tenant membership resolution is explicit and fail-closed', async () => {
    const membership = await source('server/auth/tenant-membership.ts');

    expect(membership).not.toContain('createDefaultMembership');
    expect(membership).not.toContain('Auto-register membership');
    expect(membership).not.toContain('inMemoryMembershipStore');
    expect(membership).toContain('TENANT_ACCESS_DENIED');
    expect(membership).toContain('Authoritative tenant membership store is unavailable');
  });

  test('session validation never creates a replacement session', async () => {
    const session = await source('server/auth/session-service.ts');
    const validateStart = session.indexOf('export async function validateSession(');
    const revokeStart = session.indexOf('export async function revokeSession(');

    expect(validateStart).toBeGreaterThanOrEqual(0);
    expect(revokeStart).toBeGreaterThan(validateStart);

    const validateBody = session.slice(validateStart, revokeStart);
    expect(validateBody).not.toContain('createSession(');
    expect(validateBody).toContain('SESSION_NOT_FOUND');
    expect(validateBody).toContain('SESSION_EXPIRED');
  });

  test('authoritative command context requires verified Firebase identity', async () => {
    const authority = await source('lib/backend/security/authoritative-context.ts');

    expect(authority).toContain('verifyFirebaseToken');
    expect(authority).toContain('resolveAuthorizationContext');
    expect(authority).not.toContain('STAFF_DIRECTORY');
    expect(authority).not.toContain('x-actor-id');
    expect(authority).not.toContain('usr_default');
    expect(authority).not.toContain('default clinician');
  });

  test('legacy direct stage mutation endpoints remain retired', async () => {
    for (const routePath of [
      'app/api/clinical/stage/transition/route.ts',
      'app/api/clinical/workflow/transition/route.ts',
    ]) {
      const route = await source(routePath);

      expect(route).toContain('LEGACY_MUTATION_ROUTE_RETIRED');
      expect(route).not.toContain("from 'firebase/firestore'");
      expect(route).not.toContain('@/lib/firebase/client');
      expect(route).not.toContain('writeBatch(');
      expect(route).not.toContain('runTransaction(');
    }
  });

  test('HL7 ingestion requires configured integration identity and server persistence', async () => {
    const route = await source('app/api/interop/hl7/receive/route.ts');

    expect(route).toContain('GHIMS_HL7_INGEST_API_KEY');
    expect(route).toContain('x-api-key');
    expect(route).toContain('getAdminFirestore');
    expect(route).toContain('integration_inbox');
    expect(route).not.toContain('@/lib/firebase/client');
    expect(route).not.toContain('@/lib/firebase/config');
    expect(route).not.toContain("from 'firebase/firestore'");
  });

  test('synthetic SSO cannot authenticate outside DEMO runtime', async () => {
    const login = await source('app/api/auth/sso/login/route.ts');
    const config = await source('app/api/auth/sso/config/route.ts');
    const testRoute = await source('app/api/auth/sso/test/route.ts');

    for (const route of [login, config, testRoute]) {
      expect(route).toContain('isDemoRuntime');
    }

    expect(login).toContain('status: 501');
    expect(login).not.toContain("role || 'physician'");
  });

  test('UI mount no longer seeds Firestore with demo clinical data', async () => {
    const context = await source('lib/context/hospital-context.tsx');

    expect(context).not.toContain('seedInitialFirestoreData(');
    expect(context).not.toContain('seedInitialFirestoreData,');
  });

  test('clinical AI endpoints fail visibly instead of returning fabricated clinical fallback content', async () => {
    const paths = [
      'app/api/genkit/parse-note/route.ts',
      'app/api/gemini/copilot/route.ts',
      'app/api/clinical/intake-optimize/route.ts',
    ];

    for (const path of paths) {
      const route = await source(path);
      expect(route).toContain('AI_UNAVAILABLE');
      expect(route).toContain('deriveAuthoritativeContext');
    }

    const noteParser = await source('app/api/genkit/parse-note/route.ts');
    expect(noteParser).not.toContain("'99214'");
    expect(noteParser).not.toContain("'99213'");

    const copilot = await source('app/api/gemini/copilot/route.ts');
    expect(copilot).not.toContain("'Ticagrelor 90mg PO BID'");
    expect(copilot).not.toContain("'Clinical Follow-up (ICD-10 Z09)'");
  });

  test('Cloud Function authorization has no default admin identity', async () => {
    const functions = await source('functions/src/index.ts');

    expect(functions).toContain('Authentication Required');
    expect(functions).not.toContain("context?.auth?.uid || 'usr_clinical_auth'");
    expect(functions).not.toContain("context?.auth?.token?.role || 'admin'");
  });
});
