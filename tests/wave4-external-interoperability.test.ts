import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MllpFrameDecoder,
  frameMllpMessage,
  sourceIdentityFromHl7,
} from '@/lib/interop/hl7-mllp-framing';
import {
  FhirR4Adapter,
  type FhirResource,
} from '@/lib/interop/fhir-r4-adapter';
import { DicomWebClient } from '@/lib/interop/dicomweb-client';
import {
  EdiClearinghouseClient,
} from '@/lib/interop/edi-clearinghouse-client';
import type { Edi837ClaimPayload } from '@/lib/interop/edi-837-generator';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const sampleHl7 = [
  'MSH|^~\\&|LIS_ROCHE|CENTRAL_LAB|GHIMS|METRO_HOSPITAL|20261007120000||ORU^R01|MSG-W4-001|P|2.5.1',
  'PID|1||MRN-W4-001||DOE^JANE',
  'OBR|1|ORD-W4-001|FIL-W4-001|CBC^Complete Blood Count',
  'OBX|1|NM|WBC^White Blood Cell Count||7.2|10*3/uL|4.5-11.0|N|||F',
].join('\r') + '\r';

const sampleClaim: Edi837ClaimPayload = {
  controlNumber: '101',
  claimId: 'CLM-W4-001',
  totalBilledAmount: 100,
  payer: { payerId: 'PAYER01', name: 'Qualified Payer' },
  billingProvider: {
    npi: '1982736450',
    taxId: '123456789',
    lastName: 'Provider',
    firstName: 'Test',
    facilityName: 'G-HIMS Hospital',
    facilityAddress: '1 Hospital Road',
    city: 'Lahore',
    state: 'PB',
    zip: '54000',
  },
  patient: {
    mrn: 'MRN-W4-001',
    lastName: 'Doe',
    firstName: 'Jane',
    gender: 'F',
    dob: '19900101',
    address: '1 Main Road',
    city: 'Lahore',
    state: 'PB',
    zip: '54000',
    memberId: 'MEMBER001',
    relationshipToInsured: '18',
  },
  icd10Codes: ['Z00.00'],
  serviceLines: [{
    lineItemNumber: 1,
    cptCode: '99213',
    chargeAmount: 100,
    unitCount: 1,
    serviceDate: '20261007',
    diagnosisPointers: [1],
  }],
};

describe('Wave 4 external interoperability', () => {
  test('MLLP decoder handles split frames and multiple messages without losing boundaries', () => {
    const decoder = new MllpFrameDecoder(1024 * 1024);
    const first = frameMllpMessage(sampleHl7);
    const secondMessage = sampleHl7.replace('MSG-W4-001', 'MSG-W4-002');
    const second = frameMllpMessage(secondMessage);
    const combined = Buffer.concat([first, second]);

    const midpoint = Math.floor(combined.length / 2);
    const before = decoder.push(combined.subarray(0, midpoint));
    const after = decoder.push(combined.subarray(midpoint));
    const decoded = [...before, ...after];

    expect(decoded.length).toBe(2);
    expect(sourceIdentityFromHl7(decoded[0]).messageControlId).toBe('MSG-W4-001');
    expect(sourceIdentityFromHl7(decoded[1]).messageControlId).toBe('MSG-W4-002');
  });

  test('MLLP bridge is tenant-mapped, TLS-governed, bounded and terminates into governed HL7 ingestion', async () => {
    const server = await source('server/interop/hl7-mllp-server.ts');
    expect(server).toContain('HL7_MLLP_TLS_REQUIRED_IN_PRODUCTION');
    expect(server).toContain('HL7_MLLP_MTLS_VERIFICATION_REQUIRED_IN_PRODUCTION');
    expect(server).toContain('HL7_MLLP_SOURCE_ROUTES_REQUIRED');
    expect(server).toContain('MllpFrameDecoder');
    expect(server).toContain("'x-ghims-tenant-id': tenantId");
    expect(server).toContain("'x-api-key': config.ingestApiKey");
    expect(server).toContain('[502, 503, 504]');
    expect(server).toContain('messageControlId');
  });

  test('FHIR allows only approved resource types and separately governs writes', async () => {
    let lastHeaders: HeadersInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      lastHeaders = init?.headers;
      const url = String(input);
      if (url.endsWith('/metadata')) {
        return new Response(JSON.stringify({
          resourceType: 'CapabilityStatement',
          fhirVersion: '4.0.1',
          rest: [{
            mode: 'server',
            resource: [
              { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }] },
              { type: 'Observation', interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }, { code: 'update' }] },
            ],
          }],
        }), { status: 200, headers: { 'content-type': 'application/fhir+json' } });
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ resourceType: 'Observation', id: 'obs-1', meta: { versionId: '1' } }), { status: 201 });
      }
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ resourceType: 'Observation', id: 'obs-1', meta: { versionId: '2' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ resourceType: 'Patient', id: 'pat-1' }), { status: 200 });
    };

    const adapter = new FhirR4Adapter({
      baseUrl: 'https://fhir.example.test/r4',
      state: 'LIVE',
      fetchImpl,
      approvedResourceTypes: ['Patient', 'Observation'],
      writableResourceTypes: ['Observation'],
    });

    await expect(adapter.readResource('Claim', '1')).rejects.toThrow('FHIR_RESOURCE_NOT_APPROVED');
    await expect(adapter.createResource({ resourceType: 'Patient' })).rejects.toThrow('FHIR_RESOURCE_WRITE_NOT_APPROVED');

    const report = await adapter.qualifyApprovedResources([
      { resourceType: 'Patient', read: true, search: true },
      { resourceType: 'Observation', read: true, search: true, create: true, update: true },
    ]);
    expect(report.valid).toBe(true);
    expect(report.fhirVersion).toBe('4.0.1');

    const created = await adapter.createResource<FhirResource>({ resourceType: 'Observation', status: 'final' });
    expect(created.resourceType).toBe('Observation');

    await adapter.updateResource<FhirResource>({
      resourceType: 'Observation',
      id: 'obs-1',
      meta: { versionId: '1' },
      status: 'amended',
    });
    expect(JSON.stringify(lastHeaders)).toContain('If-Match');
  });

  test('DICOMweb LIVE access is bounded to identified patient/accession queries and can run a QIDO qualification probe', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/dicom+json' },
      });

    const client = new DicomWebClient({
      baseUrl: 'https://pacs.example.test/dicom-web',
      state: 'LIVE',
      fetchImpl,
      allowedHosts: ['pacs.example.test'],
    });

    await expect(client.searchStudies({})).rejects.toThrow('DICOM_BOUNDED_QUERY_REQUIRED');
    const qualification = await client.qualifyLiveEnvironment();
    expect(qualification.valid).toBe(true);
    expect(qualification.qidoReachable).toBe(true);
  });

  test('biomedical device integration is bound to canonical ResourceMaster calibration authority', async () => {
    const [guard, telemetry, types] = await Promise.all([
      source('lib/interop/biomedical-device-authority.ts'),
      source('lib/backend/services/emergency-prearrival-domain-service.ts'),
      source('types/emergency-prearrival.ts'),
    ]);

    expect(types).toContain('resourceId: string');
    expect(guard).toContain("'resources'");
    expect(guard).toContain("resource.calibrationStatus !== 'VALID'");
    expect(guard).toContain('BIOMEDICAL_CALIBRATION_EXPIRED');
    expect(guard).toContain("resource.lifecycleState !== 'IN_SERVICE'");
    expect(telemetry).toContain('assertBiomedicalInteropReady');
    expect(telemetry).toContain("'TELEMETRY_BIOMEDICAL_LOCKOUT'");
  });

  test('EDI transport remains disabled without intentional program and external conformance gates', async () => {
    const disabled = new EdiClearinghouseClient({
      baseUrl: 'https://clearinghouse.example.test',
      state: 'LIVE',
      programEnabled: false,
      externalConformanceQualified: true,
      apiKey: 'test',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    await expect(disabled.submit837P(sampleClaim)).rejects.toThrow('EDI_PROGRAM_NOT_ENABLED');

    const unqualified = new EdiClearinghouseClient({
      baseUrl: 'https://clearinghouse.example.test',
      state: 'LIVE',
      programEnabled: true,
      externalConformanceQualified: false,
      apiKey: 'test',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    await expect(unqualified.submit837P(sampleClaim)).rejects.toThrow('EDI_EXTERNAL_CONFORMANCE_NOT_QUALIFIED');

    const live = new EdiClearinghouseClient({
      baseUrl: 'https://clearinghouse.example.test',
      state: 'LIVE',
      programEnabled: true,
      externalConformanceQualified: true,
      apiKey: 'test',
      fetchImpl: async () => new Response(
        JSON.stringify({ submissionId: 'sub-1', receivedAt: '2026-10-07T00:00:00Z' }),
        { status: 202 }
      ),
    });
    const result = await live.submit837P(sampleClaim);
    expect(result.acceptedForTransport).toBe(true);
    expect(result.clearinghouseSubmissionId).toBe('sub-1');
  });

  test('835 ingestion is deduplicated evidence and never auto-posts the ledger', async () => {
    const route = await source('app/api/interop/edi/835/receive/route.ts');
    expect(route).toContain('GHIMS_EDI_PROGRAM_ENABLED');
    expect(route).toContain('GHIMS_EDI_EXTERNAL_CONFORMANCE_QUALIFIED');
    expect(route).toContain("collection('ediRemittanceInbox')");
    expect(route).toContain("status: 'REQUIRES_RECONCILIATION'");
    expect(route).toContain('EXTERNAL_REMITTANCE_NOT_AUTO_POSTED');
    expect(route).not.toContain('FinanceGlDomainService');
    expect(route).not.toContain('PostJournal');
  });

  test('Wave 4 integration persistence remains server-only in Firestore', async () => {
    const rules = await source('firestore.rules');
    expect(rules).toContain('match /integration_inbox/{id} { allow read, write: if false; }');
    expect(rules).toContain('match /ediRemittanceInbox/{id} { allow read, write: if false; }');
  });
});
