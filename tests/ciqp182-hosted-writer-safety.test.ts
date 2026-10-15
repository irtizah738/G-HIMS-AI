import { describe, expect, test } from 'bun:test';
import {
  assertCiqp182HostedWriterScope,
  matchesCiqp182HostedTenantMetadata,
} from '@/scripts/ops/ciqp182-hospital0-hosted-writer';

const sha = 'a'.repeat(40);
const stage = 'studio-1130431360-48a05';
const writer = 'ciqp182-writer@studio-1130431360-48a05.iam.gserviceaccount.com';
function allowed(): NodeJS.ProcessEnv {
  return {
    GHIMS_RUNTIME_MODE: 'STAGING', NODE_ENV: 'test',
    FIREBASE_PROJECT_ID: stage,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: stage,
    GHIMS_FIREBASE_PROJECT_ID_STAGING: stage,
    GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
    FIRESTORE_DATABASE_ID: '(default)',
    GHIMS_CIQP_STAGING_TENANT_ID: 'ciqp-synthetic-hospital0',
    CIQP182_HOSPITAL0_CONFIRM_PROJECT: stage,
    CIQP182_HOSPITAL0_CONFIRM_TENANT: 'ciqp-synthetic-hospital0',
    CIQP182_HOSPITAL0_SOURCE_SHA: sha,
    FIREBASE_CLIENT_EMAIL: writer, CIQP182_HOSPITAL0_WRITER_EMAIL: writer,
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nsynthetic-not-valid\\n-----END PRIVATE KEY-----',
    CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY: 'emulator-only-fixture-hmac-placeholder-value',
  };
}

describe('CIQP182 hosted writer authority / no production boundary', () => {
  test('defaults to read-only DRY_RUN with exact isolated scope', () => {
    expect(assertCiqp182HostedWriterScope(allowed(), sha)).toBe('DRY_RUN');
    expect(assertCiqp182HostedWriterScope({
      ...allowed(), CIQP182_HOSPITAL0_WRITE_MODE: 'DRY_RUN',
    }, sha)).toBe('DRY_RUN');
  });

  test('rejects wrong projects, tenants, credentials, emulators and modified source', () => {
    const scenarios: NodeJS.ProcessEnv[] = [
      { FIREBASE_PROJECT_ID: 'g-hims-ai' },
      { GHIMS_FIREBASE_PROJECT_ID_STAGING: 'g-hims-ai' },
      { GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: stage },
      { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'g-hims-ai' },
      { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
      { NODE_ENV: 'production' },
      { VERCEL: '1' },
      { FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
      { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
      { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
      { FIRESTORE_DATABASE_ID: 'prod' },
      { GHIMS_CIQP_STAGING_TENANT_ID: 't2' },
      { GHIMS_CIQP_STAGING_TENANT_ID: 'ciqp-synthetic-other' },
      { CIQP182_HOSPITAL0_CONFIRM_TENANT: 't2' },
      { CIQP182_HOSPITAL0_CONFIRM_PROJECT: 'g-hims-ai' },
      { FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk-xx@' + stage + '.iam.gserviceaccount.com' },
      { FIREBASE_CLIENT_EMAIL: 'ciqp182-readonly@' + stage + '.iam.gserviceaccount.com' },
      { CIQP182_HOSPITAL0_WRITER_EMAIL: 'ciqp182-readonly@' + stage + '.iam.gserviceaccount.com' },
      { FIREBASE_PRIVATE_KEY: undefined },
      { CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY: 'weak' },
      { CIQP182_HOSPITAL0_SOURCE_SHA: 'b'.repeat(40) },
    ];
    for (const changes of scenarios) {
      expect(() => assertCiqp182HostedWriterScope({ ...allowed(), ...changes }, sha))
        .toThrow('CIQP182_HOSPITAL0_STAGING_WRITER_SCOPE_DENIED');
    }
  });

  test('write requires explicit independent review digests and exact source pin', () => {
    expect(() => assertCiqp182HostedWriterScope({
      ...allowed(), CIQP182_HOSPITAL0_WRITE_MODE: 'APPLY',
    }, sha)).toThrow('CIQP182_HOSPITAL0_INDEPENDENT_WRITE_APPROVAL_REQUIRED');
    expect(assertCiqp182HostedWriterScope({
      ...allowed(),
      CIQP182_HOSPITAL0_WRITE_MODE: 'APPLY',
      CIQP182_HOSPITAL0_WRITE_ACK: 'AUTHORIZE_CREATE_ONLY_SYNTHETIC_HOSPITAL0',
      CIQP182_HOSPITAL0_SOURCE_REVIEWED: 'REVIEWED_EXACT_SOURCE',
      CIQP182_HOSPITAL0_IAM_REVIEW_SHA256: 'b'.repeat(64),
      CIQP182_HOSPITAL0_FIXTURE_REVIEW_SHA256: 'c'.repeat(64),
      CIQP182_HOSPITAL0_APPROVED_SHA: sha,
    }, sha)).toBe('APPLY');
  });

  test('only original six pre-created tenant metadata fields pass the equality guard', () => {
    const metadata = {
      name: 'CIQP182 Synthetic Hospital 0',
      environment: 'STAGING',
      syntheticOnly: true,
      clinicalUseAllowed: false,
      provenanceStatus: 'PENDING_REVIEW',
      qualificationPurpose: 'CIQP182_PATIENT360',
    };
    expect(matchesCiqp182HostedTenantMetadata(metadata)).toBe(true);
    expect(matchesCiqp182HostedTenantMetadata({ ...metadata, extra: 'any' })).toBe(false);
    expect(matchesCiqp182HostedTenantMetadata({ ...metadata, syntheticOnly: 'true' })).toBe(false);
    expect(matchesCiqp182HostedTenantMetadata({ ...metadata, provenanceStatus: 'APPROVED' })).toBe(false);
    expect(matchesCiqp182HostedTenantMetadata(undefined)).toBe(false);
  });

  test('source does not use destructive writes, cross-tenant writes, imports or exports', async () => {
    const source = await Bun.file('scripts/ops/ciqp182-hospital0-hosted-writer.ts').text();
    expect(source).toContain("tenant.collection('clinicalIntelligenceEvidenceSnapshots')");
    expect(source).toContain('await tenant.listCollections()');
    expect(source).toContain('CIQP182_HOSPITAL0_EXISTING_TENANT_ROWS');
    expect(source).not.toMatch(/\.set\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toContain('firebase deploy');
    expect(source).not.toContain('exportDocuments(');
    expect(source).not.toContain('importDocuments(');
    expect(source).not.toContain('migratePatient360');
  });
});
