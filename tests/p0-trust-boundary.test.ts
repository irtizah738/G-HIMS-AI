/**
 * G-HIMS P0 Core Trust Boundary Regression Suite
 *
 * These tests are intentionally source-level guardrails around defects found in the
 * independent security audit. They complement domain/unit tests; they do not replace
 * Firebase Emulator integration tests.
 */

import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

async function routeFiles(dir = join(process.cwd(), 'app', 'api')): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await routeFiles(absolute));
    } else if (entry.name === 'route.ts') {
      paths.push(absolute.replace(process.cwd() + '/', ''));
    }
  }

  return paths;
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

  test('authorization context never fabricates tenant or session authority', async () => {
    const resolver = await source('server/auth/authorization-context.ts');

    expect(resolver).not.toContain("'central-metro-hospital'");
    expect(resolver).not.toContain('Math.random()');
    expect(resolver).not.toContain('Date.now().toString(36)');
    expect(resolver).toContain("sessionId: sessionId || ''");
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
    expect(authority).toContain('validateSession');
    expect(authority).toContain('x-ghims-session-id');
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

    const denialFlow = await source('lib/ai/flows/denial-appeal.ts');
    expect(denialFlow).toContain('AI_UNAVAILABLE');
    expect(denialFlow).not.toContain('generateFallbackDenialAppeal');
    expect(denialFlow).not.toContain('MCG Health Inpatient & Surgical Care 28th Edition Guidelines');
  });

  test('unverified credentials cannot receive derived clinical privileges', async () => {
    const membership = await source('server/auth/tenant-membership.ts');

    expect(membership).toContain("credentialStatus === 'VERIFIED'");
    expect(membership).not.toContain("return ['*']");
  });

  test('device registration fails closed outside DEMO/TEST runtime', async () => {
    const device = await source('server/auth/device-service.ts');

    expect(device).toContain('canUseEphemeralDeviceState');
    expect(device).toContain('Authoritative device registry is unavailable');
    expect(device).toContain('Unable to validate or persist clinical device registration');
  });

  test('every state-changing API route declares an explicit trust boundary', async () => {
    const intentionallyPublicOrPureRoutes = new Set([
      'app/api/auth/password-reset/route.ts',
      'app/api/clinical/timeline/route.ts',
      'app/api/clinical/workflow/compile/route.ts',
    ]);

    const acceptedBoundaryMarkers = [
      'deriveAuthoritativeContext',
      'verifyFirebaseToken',
      'GHIMS_HL7_INGEST_API_KEY',
      'GHIMS_INTERNAL_WORKER_KEY',
      'isDemoRuntime',
      'LEGACY_MUTATION_ROUTE_RETIRED',
      'status: 410',
    ];

    const unprotected: string[] = [];

    for (const path of await routeFiles()) {
      const route = await source(path);
      const changesState = [
        'export async function POST',
        'export async function PUT',
        'export async function PATCH',
        'export async function DELETE',
      ].some((signature) => route.includes(signature));

      if (!changesState || intentionallyPublicOrPureRoutes.has(path)) continue;

      const hasBoundary = acceptedBoundaryMarkers.some((marker) => route.includes(marker));
      if (!hasBoundary) unprotected.push(path);
    }

    expect(unprotected).toEqual([]);
  });

  test('legacy browser Firestore adapter cannot touch denied root collections', async () => {
    const legacy = await source('lib/firebase/firestore-service.ts');
    const config = await source('lib/firebase/config.ts');
    const sso = await source('lib/auth/sso-service.ts');

    expect(legacy).not.toContain("from 'firebase/firestore'");
    expect(legacy).not.toContain('collection(');
    expect(legacy).not.toContain('onSnapshot(');
    expect(legacy).not.toContain('setDoc(');
    expect(legacy).toContain('LEGACY_CLIENT_FIRESTORE_RETIRED');

    expect(config).not.toContain('getDocFromServer');
    expect(config).not.toContain("doc(db, 'test', 'connection')");
    expect(config).toContain('/api/health/ready');

    expect(sso).not.toContain("from 'firebase/firestore'");
    expect(sso).not.toContain('getDoc(');
  });

  test('deprecated Cloud Functions authority path remains removed', async () => {
    const fs = await import('node:fs/promises');

    await expect(
      fs.access(join(process.cwd(), 'functions/src/index.ts'))
    ).rejects.toThrow();
    await expect(
      fs.access(
        join(process.cwd(), 'functions/src/registerPatientAndEncounter.ts')
      )
    ).rejects.toThrow();
  });
});
