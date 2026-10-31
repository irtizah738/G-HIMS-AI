import { describe, expect, test } from 'bun:test';
import {
  MAX_INTAKE_REQUEST_BYTES,
  parseSourceLimitedBrief,
  readBoundedIntakeRequest,
} from '@/lib/clinical/intelligence/source-limited-intake-brief';

const valid = {
  executiveSummary: 'Evidence summary requires clinician review',
  sbar: {
    situation: 'Observed', background: 'Source chart',
    assessment: 'Requires verification', recommendation: 'Clinician review',
  },
  observedRiskSignals: ['Observed finding'],
  missingOrUnverifiedInformation: ['Unconfirmed medication history'],
  sourceLimited: true,
};

describe('Clinical intake fail-closed output contract', () => {
  test('accepts only strict source-limited model drafts', () => {
    expect(parseSourceLimitedBrief(JSON.stringify(valid))).toEqual(valid);
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, sourceLimited: false }))).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, diagnosis: 'Unverified' }))).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, status: 'SIGNED' }))).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, sbar: { ...valid.sbar, prescription: 'Drug' } }))).toBeNull();
  });

  test('rejects wrong types, malformed JSON, and oversize arrays/text', () => {
    expect(parseSourceLimitedBrief('{')).toBeNull();
    expect(parseSourceLimitedBrief('[]')).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, observedRiskSignals: Array(31).fill('risk') }))).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, executiveSummary: 'x'.repeat(4001) }))).toBeNull();
    expect(parseSourceLimitedBrief(JSON.stringify({ ...valid, sbar: { ...valid.sbar, situation: 123 } }))).toBeNull();
    expect(parseSourceLimitedBrief(' '.repeat(40_000))).toBeNull();
  });

  test('reads small request JSON and rejects wrong shapes', async () => {
    const request = new Request('https://example.test/', { method: 'POST', body: '{"tenantId":"hospital-test"}' });
    expect(await readBoundedIntakeRequest(request)).toEqual({ tenantId: 'hospital-test' });
    const array = new Request('https://example.test/', { method: 'POST', body: '[]' });
    await expect(readBoundedIntakeRequest(array)).rejects.toMatchObject({
      code: 'INVALID_INTAKE_JSON', status: 400,
    });
  });

  test('enforces request byte bounds even without honest Content-Length', async () => {
    const tooLarge = new Request('https://example.test/', { method: 'POST', body: JSON.stringify({
      patientContext: 'x'.repeat(MAX_INTAKE_REQUEST_BYTES),
    }) });
    await expect(readBoundedIntakeRequest(tooLarge)).rejects.toMatchObject({
      code: 'INTAKE_PAYLOAD_TOO_LARGE', status: 413,
    });
    const declared = new Request('https://example.test/', {
      method: 'POST', body: '{}',
      headers: { 'content-length': String(MAX_INTAKE_REQUEST_BYTES + 1) },
    });
    await expect(readBoundedIntakeRequest(declared)).rejects.toMatchObject({
      code: 'INTAKE_PAYLOAD_TOO_LARGE', status: 413,
    });
  });
});
