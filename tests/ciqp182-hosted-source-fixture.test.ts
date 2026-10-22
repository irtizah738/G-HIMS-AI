import { describe, expect, test } from 'bun:test';
import {
  assertCiqp182HostedSourceScope,
  assertCiqp182SourceKeylessCredential,
  matchesCiqp182SourceTenant,
  CIQP182_SOURCE_PROJECT, CIQP182_WRITER,
} from '@/scripts/ops/ciqp182-hosted-source-fixture';

const SHA = 'a'.repeat(40);
const sampleCredential = {
  type: 'impersonated_service_account',
  service_account_impersonation_url:
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
    CIQP182_WRITER + ':generateAccessToken',
  source_credentials: { type: 'authorized_user' },
};
const valid: NodeJS.ProcessEnv = {
  GHIMS_RUNTIME_MODE: 'STAGING', NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: CIQP182_SOURCE_PROJECT,
  GHIMS_FIREBASE_PROJECT_ID_STAGING: CIQP182_SOURCE_PROJECT,
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
  FIRESTORE_DATABASE_ID: '(default)',
  GHIMS_CIQP_STAGING_TENANT_ID: 'ciqp-synthetic-hospital0',
  CIQP182_HOSTED_SOURCE_CONFIRM_PROJECT: CIQP182_SOURCE_PROJECT,
  CIQP182_HOSTED_SOURCE_CONFIRM_TENANT: 'ciqp-synthetic-hospital0',
  CIQP182_HOSTED_SOURCE_WRITER_EMAIL: CIQP182_WRITER,
  CIQP182_HOSTED_SOURCE_SYNTHETIC_ACK: 'FICTIONAL_DATA_ONLY',
  CIQP182_HOSTED_SOURCE_EXPECTED_SHA: SHA,
  GOOGLE_APPLICATION_CREDENTIALS: '/tmp/ciqp-test-impersonated-adc.json',
};
const credentialReader = () => sampleCredential;
const apply: NodeJS.ProcessEnv = {
  ...valid,
  CIQP182_HOSTED_SOURCE_MODE: 'APPLY',
  CIQP182_HOSTED_SOURCE_APPLY_ACK: 'CREATE_ONE_SYNTHETIC_PATIENT_ONCE',
  CIQP182_HOSTED_SOURCE_APPLY_CONFIRM_SHA: SHA,
  CIQP182_HOSTED_SOURCE_CHANGE_TICKET: 'CIQP-182-20261022-FIXTURE',
  CIQP182_HOSTED_SOURCE_OPERATOR_ID: 'synthetic.operator',
  CIQP182_HOSTED_SOURCE_IAM_RECEIPT_SHA256: 'b'.repeat(64),
  CIQP182_HOSTED_SOURCE_PROVENANCE_SHA256: 'c'.repeat(64),
  CIQP182_HOSTED_SOURCE_EVIDENCE_HMAC_KEY: 'synthetic-only-test-hmac-material-example',
};

describe('CIQP-182 hosted G-HIMS AI synthetic-only fixture perimeter', () => {
  test('only the existing six-field fictional tenant is accepted', () => {
    const metadata = {
      name: 'CIQP182 Synthetic Hospital 0',
      environment: 'STAGING',
      syntheticOnly: true,
      clinicalUseAllowed: false,
      provenanceStatus: 'PENDING_REVIEW',
      qualificationPurpose: 'CIQP182_PATIENT360',
    };
    expect(matchesCiqp182SourceTenant(metadata)).toBe(true);
    for (const changed of [
      { ...metadata, syntheticOnly: false },
      { ...metadata, clinicalUseAllowed: true },
      { ...metadata, extra: 'unreviewed' },
      { ...metadata, provenanceStatus: 'APPROVED' },
    ]) expect(matchesCiqp182SourceTenant(changed)).toBe(false);
  });

  test('default is no-write DRY_RUN; explicit APPLY needs independent receipts', () => {
    expect(assertCiqp182HostedSourceScope(valid, SHA, credentialReader)).toBe('DRY_RUN');
    expect(() => assertCiqp182HostedSourceScope({
      ...valid, CIQP182_HOSTED_SOURCE_MODE: 'APPLY',
    }, SHA, credentialReader)).toThrow('CIQP182_HOSTED_SOURCE_APPLY_APPROVAL_MISSING');
    expect(assertCiqp182HostedSourceScope(apply, SHA, credentialReader)).toBe('APPLY');
  });

  test.each([
    { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { GITHUB_ACTIONS: 'true' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIREBASE_PROJECT_ID: 'g-hims-ai' },
    { FIREBASE_PROJECT_ID: 'studio-1130431360-48a05' },
    { FIREBASE_PROJECT_ID: 'ciqp-ghims-restore-20261022' },
    { GHIMS_FIREBASE_PROJECT_ID_STAGING: 'studio-1130431360-48a05' },
    { GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'fake-production' },
    { FIRESTORE_DATABASE_ID: 'wrong' },
    { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'g-hims-ai' },
    { GHIMS_CIQP_STAGING_TENANT_ID: 'central-metro-hospital' },
    { CIQP182_HOSTED_SOURCE_CONFIRM_PROJECT: 'g-hims-ai' },
    { CIQP182_HOSTED_SOURCE_CONFIRM_TENANT: 'other-tenant' },
    { CIQP182_HOSTED_SOURCE_WRITER_EMAIL: 'different-writer@example.com' },
    { CIQP182_HOSTED_SOURCE_SYNTHETIC_ACK: '' },
    { CIQP182_HOSTED_SOURCE_EXPECTED_SHA: 'b'.repeat(40) },
    { FIREBASE_PRIVATE_KEY: 'some-key' },
    { FIREBASE_CLIENT_EMAIL: 'production-admin@example.com' },
    { GOOGLE_APPLICATION_CREDENTIALS: '' },
  ])('rejects unsafe run scope %j before Firebase initialization', changes => {
    expect(() => assertCiqp182HostedSourceScope(
      { ...valid, ...changes }, SHA, credentialReader
    )).toThrow('CIQP182_HOSTED_SOURCE_SCOPE_DENIED');
  });

  test('rejects missing real approval inputs and SHA mismatches on APPLY', () => {
    for (const change of [
      { CIQP182_HOSTED_SOURCE_APPLY_ACK: '' },
      { CIQP182_HOSTED_SOURCE_APPLY_CONFIRM_SHA: 'b'.repeat(40) },
      { CIQP182_HOSTED_SOURCE_CHANGE_TICKET: '' },
      { CIQP182_HOSTED_SOURCE_OPERATOR_ID: '' },
      { CIQP182_HOSTED_SOURCE_IAM_RECEIPT_SHA256: '' },
      { CIQP182_HOSTED_SOURCE_PROVENANCE_SHA256: '' },
      { CIQP182_HOSTED_SOURCE_EVIDENCE_HMAC_KEY: 'weak' },
    ]) expect(() => assertCiqp182HostedSourceScope(
      { ...apply, ...change }, SHA, credentialReader
    )).toThrow('CIQP182_HOSTED_SOURCE_APPLY_APPROVAL_MISSING');
  });

  test('requires service account impersonation credential, never a JSON key', () => {
    expect(() => assertCiqp182SourceKeylessCredential(sampleCredential)).not.toThrow();
    for (const invalid of [
      null, {}, { type: 'service_account', private_key: 'forbidden' },
      { ...sampleCredential, type: 'authorized_user' },
      { ...sampleCredential, service_account_impersonation_url: sampleCredential.service_account_impersonation_url.replace(
        CIQP182_WRITER, 'different@bad.iam.gserviceaccount.com'
      ) },
      { ...sampleCredential, source_credentials: { type: 'service_account' } },
      { ...sampleCredential, private_key: 'forbidden' },
    ]) expect(() => assertCiqp182SourceKeylessCredential(invalid))
      .toThrow('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
  });

  test('guard blocks missing/malformed ADC files', () => {
    expect(() => assertCiqp182HostedSourceScope(valid, SHA, () => { throw Error('no adc'); }))
      .toThrow('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
    expect(() => assertCiqp182HostedSourceScope(valid, SHA, () => ({type:'service_account'})))
      .toThrow('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
  });

  test('only canonical writer creates evidence, never directly patches patient records', async () => {
    const source = await Bun.file('scripts/ops/ciqp182-hosted-source-fixture.ts').text();
    expect(source).toContain('registerPatientAndEncounter(');
    expect(source).toContain('Patient360ProjectionService.rebuildPatient(');
    expect(source).toContain('inspectCiqpSnapshotOutboxEvidence(');
    expect(source).toContain('fingerprintCiqpImmutableTenant(');
    expect(source).toContain("tenant.listCollections()");
    expect(source).toContain(".doc('one-time-20261022').create(");
    expect(source).not.toContain('firebase deploy');
    expect(source).not.toContain('importDocuments(');
    expect(source).not.toContain('exportDocuments(');
    expect(source).not.toMatch(/\.set\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toContain('ciqp182-writer@studio-1130431360-48a05');
  });
});
