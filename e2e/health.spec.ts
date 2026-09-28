import { test, expect } from '@playwright/test';

test('liveness endpoint exposes no infrastructure secrets', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(body.service).toBe('g-hims');
  expect(body.runtime).toBe('TEST');

  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('privateKey');
  expect(serialized).not.toContain('clientEmail');
  expect(serialized).not.toContain('projectId');
});
