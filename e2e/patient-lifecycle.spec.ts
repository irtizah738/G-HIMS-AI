import { test, expect } from '@playwright/test';

const tenantId = 'tenant-e2e-untrusted';

/**
 * Deployment-level trust-boundary smoke.
 *
 * This suite intentionally does not fake a logged-in clinician, AI provider, PACS,
 * payer, or financial posting. Full clinical journeys require a seeded isolated
 * integration environment with real authenticated identities. In generic CI, the
 * production-safe expectation is that protected clinical mutations fail closed.
 */
test.describe('G-HIMS deployment trust-boundary smoke', () => {
  test('anonymous clinical AI requests are rejected before generation', async ({ request }) => {
    const soap = await request.post('/api/ai/soap', {
      data: {
        tenantId,
        patientId: 'patient-untrusted',
        chiefComplaint: 'test-only complaint',
        doctorNotes: 'test-only note',
      },
    });

    expect(soap.status()).toBe(403);

    const icd = await request.post('/api/ai/icd10', {
      data: {
        tenantId,
        primaryDiagnosis: 'test-only diagnosis',
        clinicalSummary: 'test-only summary',
      },
    });

    expect(icd.status()).toBe(403);
  });

  test('anonymous offline replay is rejected rather than accepting client-authored state', async ({
    request,
  }) => {
    const response = await request.post('/api/sync/batch', {
      data: {
        batch: {
          deviceId: 'untrusted-device',
          tenantId,
          actorId: 'forged-actor',
          batchId: 'batch-untrusted',
          submittedAt: Date.now(),
          mutations: [
            {
              mutationId: 'mutation-untrusted',
              occurredAt: Date.now(),
              commandType: 'RecordVitalsCommand',
              idempotencyKey: 'untrusted-key',
              schemaVersion: 1,
              payload: {
                encounterId: 'enc-untrusted',
                patientId: 'pat-untrusted',
                heartRate: 70,
              },
            },
          ],
        },
      },
    });

    expect(response.status()).toBe(403);
  });

  test('readiness fails closed when durable server dependencies are unavailable', async ({
    request,
  }) => {
    const response = await request.get('/api/health/ready');
    expect(response.status()).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body).not.toHaveProperty('projectId');
    expect(body).not.toHaveProperty('credentials');
  });
});
