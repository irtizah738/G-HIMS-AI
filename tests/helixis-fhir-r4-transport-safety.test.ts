import { describe, expect, test } from 'bun:test';
import { FhirR4Adapter } from '@/lib/interop/fhir-r4-adapter';

const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
const patient = (id = 'synthetic-p1') => ({
  resourceType: 'Patient', id, meta: { versionId: 'v1' },
});
const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/fhir+json' },
  });
const adapter = (fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) =>
  new FhirR4Adapter({
    baseUrl, state: 'LIVE', fetchImpl,
    approvedResourceTypes: ['Patient', 'Observation'],
    writableResourceTypes: ['Observation'],
    timeoutMs: 2000, maxReadRetries: 2, maxResponseBytes: 1024,
    ...overrides,
  });

describe('Helixis FHIR R4 transport safety — synthetic-only', () => {
  test('accepts a bounded streamed FHIR response split across UTF-8 boundaries', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      ...patient(), name: [{ text: 'Zürich synthetic patient' }],
    }));
    const split = bytes.indexOf(0xc3) + 1; // split inside the UTF-8 ü
    expect(split).toBeGreaterThan(0);
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls++;
      expect(init?.redirect).toBe('error');
      expect(init?.method).toBe('GET');
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      }), { status: 200 });
    };
    const result = await adapter(fetchImpl).readResource('Patient', 'synthetic-p1');
    expect(result.resourceType).toBe('Patient');
    expect(result.name).toEqual([{ text: 'Zürich synthetic patient' }]);
    expect(calls).toBe(1);
  });

  test('rejects a declared oversized FHIR response without retries', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response('{"resourceType":"Patient"}', {
        status: 200,
        headers: { 'content-length': '2048' },
      });
    };
    await expect(adapter(fetchImpl).readResource('Patient', 'synthetic-p1'))
      .rejects.toThrow('FHIR_RESPONSE_TOO_LARGE');
    expect(calls).toBe(1);
  });

  test('rejects oversized streaming bodies even when content-length is absent', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(700));
          controller.enqueue(new Uint8Array(700));
          controller.close();
        },
      }), { status: 200 });
    };
    await expect(adapter(fetchImpl).readResource('Patient', 'synthetic-p1'))
      .rejects.toThrow('FHIR_RESPONSE_TOO_LARGE');
    expect(calls).toBe(1);
  });

  test('does not retry authentication, missing resources, invalid JSON or wrong resource types', async () => {
    for (const status of [401, 403, 404]) {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls++;
        return jsonResponse({
          resourceType: 'OperationOutcome',
          issue: [{ code: 'forbidden' }],
        }, status);
      };
      await expect(adapter(fetchImpl).readResource('Patient', 'synthetic-p1'))
        .rejects.toThrow('FHIR_HTTP_' + status);
      expect(calls).toBe(1);
    }
    for (const failure of ['invalid-json', 'wrong-resource']) {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls++;
        return failure === 'invalid-json'
          ? new Response('{malformed', { status: 200 })
          : jsonResponse({ resourceType: 'Observation', id: 'synthetic-o1' });
      };
      await expect(adapter(fetchImpl).readResource('Patient', 'synthetic-p1'))
        .rejects.toThrow(failure === 'invalid-json'
          ? 'FHIR_INVALID_JSON_RESPONSE' : 'FHIR_RESOURCE_TYPE_MISMATCH');
      expect(calls).toBe(1);
    }
  });

  test('never retries policy errors thrown by a protective fetch wrapper', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      throw new Error('CI_EXT06_RESPONSE_TOO_LARGE');
    };
    await expect(adapter(fetchImpl).readResource('Patient', 'synthetic-p1'))
      .rejects.toThrow('CI_EXT06_RESPONSE_TOO_LARGE');
    expect(calls).toBe(1);
  });

  test('retries only configured transient HTTP statuses on safe GETs', async () => {
    for (const transient of [429, 502, 503, 504]) {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls++;
        return calls === 1
          ? jsonResponse({ resourceType: 'OperationOutcome' }, transient)
          : jsonResponse(patient());
      };
      const result = await adapter(fetchImpl).readResource('Patient', 'synthetic-p1');
      expect(result.id).toBe('synthetic-p1');
      expect(calls).toBe(2);
    }
  });

  test('GET transport failures may retry, but writes never retry automatically', async () => {
    let readCalls = 0;
    const readFetch: typeof fetch = async () => {
      readCalls++;
      if (readCalls === 1) throw new TypeError('synthetic network interruption');
      return jsonResponse(patient());
    };
    await adapter(readFetch).readResource('Patient', 'synthetic-p1');
    expect(readCalls).toBe(2);

    let writeCalls = 0;
    const writeFetch: typeof fetch = async (_input, init) => {
      writeCalls++;
      expect(init?.method).toBe('POST');
      throw new TypeError('synthetic ambiguous write outcome');
    };
    await expect(adapter(writeFetch).createResource({
      resourceType: 'Observation', status: 'final',
    })).rejects.toThrow('synthetic ambiguous write outcome');
    expect(writeCalls).toBe(1);
  });

  test('reads only a bounded, approved FHIR history page with redirect protection', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(String(input));
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      return jsonResponse({
        resourceType: 'Bundle', type: 'history', entry: [{
          request: { method: 'PUT', url: 'Patient/synthetic-p1' },
          resource: { ...patient(), meta: {
            versionId: 'v1', lastUpdated: '2026-10-20T09:00:00Z',
          } },
        }],
      });
    };
    const result = await adapter(fetchImpl).readResourceHistory('Patient', 'synthetic-p1', 4);
    expect(result.type).toBe('history');
    expect(result.entry?.length).toBe(1);
    expect(seen).toEqual([baseUrl + '/Patient/synthetic-p1/_history?_count=4']);
  });

  test('history transport rejects cross-type inputs, invalid ids, count and wrong bundle kind', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [] });
    };
    const transport = adapter(fetchImpl);
    await expect(transport.readResourceHistory('Patient', 'path/escape'))
      .rejects.toThrow('FHIR_HISTORY_REQUEST_INVALID');
    await expect(transport.readResourceHistory('Patient', 'synthetic-p1', 65))
      .rejects.toThrow('FHIR_HISTORY_REQUEST_INVALID');
    await expect(transport.readResourceHistory('Condition', 'synthetic-p1'))
      .rejects.toThrow('FHIR_RESOURCE_NOT_APPROVED');
    expect(calls).toBe(0);
    await expect(transport.readResourceHistory('Patient', 'synthetic-p1'))
      .rejects.toThrow('FHIR_HISTORY_RESPONSE_INVALID');
    expect(calls).toBe(1);
  });

  test('rejects an unsafe response-size configuration before any network call', () => {
    const neverFetch: typeof fetch = async () => { throw Error('NETWORK_MUST_NOT_RUN'); };
    expect(() => adapter(neverFetch, { maxResponseBytes: 99999999 }))
      .toThrow('FHIR_CONFIG_INVALID');
    expect(() => adapter(neverFetch, { maxResponseBytes: 0 }))
      .toThrow('FHIR_CONFIG_INVALID');
  });
});
