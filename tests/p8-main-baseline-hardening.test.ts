import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('P8 main baseline hardening', () => {
  test('cash receipts read and mutate the authoritative invoice atomically', async () => {
    const service = await source(
      'lib/backend/services/cash-receipt-domain-service.ts'
    );
    const tx = await source(
      'lib/backend/transactions/transaction-manager.ts'
    );

    expect(tx).toContain("INVOICE: 'invoices'");
    expect(service).toContain("key: 'invoice'");
    expect(service).toContain("entityType: 'INVOICE'");
    expect(service).toContain('required: true');
    expect(service).toContain("'INVOICE_PATIENT_MISMATCH'");
    expect(service).toContain("'INVOICE_ENCOUNTER_MISMATCH'");
    expect(service).toContain("'INVOICE_CURRENCY_MISMATCH'");
    expect(service).toContain("'PAYMENT_EXCEEDS_OUTSTANDING_BALANCE'");
    expect(service).toContain("paymentStatus: newBalanceMinorUnits === 0 ? 'paid' : 'partially_paid'");
  });

  test('journal semantics reject malformed or negative accounting lines', async () => {
    const ledger = await source(
      'lib/backend/services/financial-ledger-domain-service.ts'
    );

    expect(ledger).toContain("'INVALID_JOURNAL_LINE'");
    expect(ledger).toContain('Number.isSafeInteger(debit)');
    expect(ledger).toContain('debit < 0');
    expect(ledger).toContain('(debit > 0 && credit > 0)');
    expect(ledger).toContain("'UNSUPPORTED_JOURNAL_CURRENCY'");
    expect(ledger).toContain("'INVALID_JOURNAL_PERIOD'");
  });

  test('high-risk commands use versioned payload schemas before idempotency reservation', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const registry = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );

    expect(bus.indexOf('validateCommandPayload(command)')).toBeLessThan(
      bus.indexOf('IdempotencyService.acquireExecution')
    );
    expect(registry).toContain('RecordCashReceiptCommand');
    expect(registry).toContain('PostJournalCommand');
    expect(registry).toContain('DischargeInpatientEncounterCommand');
    expect(registry).toContain('COMMAND_SCHEMA_VERSION_UNSUPPORTED');
  });

  test('command registry fails malformed cash receipt payloads closed', () => {
    const result = validateCommandPayload({
      commandId: 'cmd-p8-invalid-receipt',
      idempotencyKey: 'idem-p8-invalid-receipt',
      tenantId: 'tenant-a',
      commandType: 'RecordCashReceiptCommand',
      schemaVersion: 1,
      payload: {
        receiptId: 'receipt-1',
        invoiceId: 'invoice-1',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        amountMinorUnits: -1,
        referenceNumber: 'ref',
        collectedAt: Date.now(),
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_PAYLOAD_INVALID');
  });

  test('Patient 360 no longer grants ancillary roles implicit full-chart access', async () => {
    const access = await source(
      'lib/clinical/patient360/patient360-access.ts'
    );
    const roleBlock = access.slice(
      access.indexOf('const FULL_CHART_ROLES'),
      access.indexOf('const ADMIN_ROLES')
    );

    expect(roleBlock).not.toContain("'PHARMACIST'");
    expect(roleBlock).not.toContain("'LAB_TECH'");
    expect(roleBlock).not.toContain("'RADIOLOGIST'");
    expect(access).toContain('facility is outside the actor scope');
    expect(access).toContain('department is outside the actor scope');
  });

  test('offline clinical hydration is reduced to authoritative care scope', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(bootstrap).toContain('scopeOfflineCollections');
    expect(bootstrap).toContain('context.facilityIds');
    expect(bootstrap).toContain('context.departmentIds');
    expect(bootstrap).toContain('Legacy encounters without any server-verifiable care scope');
    expect(bootstrap).toContain('scopedCollections');
  });

  test('offline identity and audit caches use encrypted edge envelopes', async () => {
    const authStorage = await source('lib/offline/auth-storage.ts');

    expect(authStorage).toContain('encryptedPayload: EncryptedEdgeEnvelope');
    expect(authStorage).toContain('encryptEdgeJson');
    expect(authStorage).toContain('decryptEdgeJson');
    expect(authStorage).toContain('never downgrade PHI/security context to plaintext');
  });

  test('caller-supplied clinical outbox dispatch remains retired', async () => {
    const legacy = await source('app/api/clinical/outbox/process/route.ts');

    expect(legacy).toContain('LEGACY_OUTBOX_ROUTE_RETIRED');
    expect(legacy).not.toContain('dispatchOutboxEvent');
    expect(legacy).not.toContain('body.events');
  });

  test('break-glass requires post-event governance review', async () => {
    const route = await source('app/api/auth/break-glass/route.ts');
    const authTypes = await source('lib/auth/auth-types.ts');

    expect(route).toContain('PENDING_REVIEW');
    expect(route).toContain('REVIEW_ROLES');
    expect(route).toContain("'APPROVED', 'INAPPROPRIATE', 'ESCALATED'");
    expect(route).toContain("eventType: 'BREAK_GLASS_REVIEWED'");
    expect(authTypes).toContain("'BREAK_GLASS_REVIEWED'");
  });

  test('authentication never auto-creates tenant or clinical authority', async () => {
    const sessionRoute = await source('app/api/auth/session/route.ts');
    const membership = await source('server/auth/tenant-membership.ts');
    const provisioning = await source('server/auth/user-provisioning-service.ts');
    const authorization = await source(
      'lib/backend/auth/authorization-pipeline.ts'
    );

    expect(sessionRoute).toContain('Authentication never creates authorization');
    expect(sessionRoute).not.toContain("email.includes('admin')");
    expect(sessionRoute).not.toContain("credentialStatus: 'VERIFIED'");
    expect(membership).toContain(": 'UNVERIFIED'");
    expect(membership).toContain("credentialStatus === 'VERIFIED'");
    expect(provisioning).toContain("? 'UNVERIFIED'");
    expect(authorization).not.toContain(
      "context.roles.includes('MEDICAL_DIRECTOR');"
    );
  });

  test('credential and PHI artifacts are excluded from git', async () => {
    const gitignore = await source('.gitignore');

    expect(gitignore).toContain('.env.*');
    expect(gitignore).toContain('service-account*.json');
    expect(gitignore).toContain('firebase-adminsdk*.json');
    expect(gitignore).toContain('artifacts/');
    expect(gitignore).toContain('backups/');
  });
  test('clinical privileges require canonical HCM employee credential authority', async () => {
    const authorization = await source('server/auth/authorization-context.ts');
    expect(authorization).toContain('Clinical authority has exactly one source of truth');
    expect(authorization).not.toContain("tenantRef.collection('users').doc(params.userId)");
    expect(authorization).toContain('credentialsValid(credentials, Date.now())');
    expect(authorization).toContain("privilege.status!=='GRANTED'");
  });

  test('staging and production sessions cannot opt out of device binding', async () => {
    const sessionRoute = await source('app/api/auth/session/route.ts');
    expect(sessionRoute).toContain("runtimeMode === 'STAGING' || runtimeMode === 'PRODUCTION'");
    expect(sessionRoute).toContain('deviceBindingRequired && !String(deviceData.deviceId');
    expect(sessionRoute).toContain('(deviceBindingRequired || rememberDevice)');
  });

  test('tenant routing never invents a fallback tenant and browser responses carry CSP', async () => {
    const proxy = await source('proxy.ts');
    expect(proxy).not.toContain("extractedTenantId || 'central-metro-hospital'");
    expect(proxy).toContain("requestHeaders.delete('x-ghims-tenant-id')");
    expect(proxy).toContain("'nonce-");
    expect(proxy).toContain("'strict-dynamic'");
    expect(proxy).toContain('Strict-Transport-Security');
    expect(proxy).not.toContain('picsum.photos');
    expect(proxy).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(proxy).toContain('style-src-attr');
  });

  test('Patient 360 recovery uses the same monotonic projection commit primitive', async () => {
    const patient360 = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );
    expect(patient360).toContain('commitProjectionMonotonically');
    expect(patient360).not.toContain(
      ".collection('patient360Projections')\n        .doc(patientId)\n        .set(sanitizeForFirestore(projected.projection))"
    );
    expect(patient360).toContain("message.startsWith('PATIENT360_PATIENT_NOT_FOUND:')");
    expect(patient360).toContain('throw error;');
  });

});
