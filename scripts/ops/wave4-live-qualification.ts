import { getServerIntegrationState } from '@/lib/interop/integration-state';
import {
  FhirR4Adapter,
  DEFAULT_APPROVED_FHIR_R4_RESOURCES,
  DEFAULT_WRITABLE_FHIR_R4_RESOURCES,
  type FhirResourceCapabilityRequirement,
} from '@/lib/interop/fhir-r4-adapter';
import { DicomWebClient } from '@/lib/interop/dicomweb-client';
import { validateHl7MllpConfig, type MllpTenantRoute } from '@/server/interop/hl7-mllp-server';
import { EdiClearinghouseClient } from '@/lib/interop/edi-clearinghouse-client';
import { assertBiomedicalInteropReady } from '@/lib/interop/biomedical-device-authority';

function csv(value: string | undefined, fallback: readonly string[]): string[] {
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...fallback];
}

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required for Wave 4 live qualification.');
  return value;
}

function bool(value: string | undefined): boolean {
  return String(value || '').trim().toLowerCase() === 'true';
}

function jsonRoutes(value: string | undefined): MllpTenantRoute[] {
  const parsed = JSON.parse(String(value || '[]'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('GHIMS_HL7_MLLP_SOURCE_ROUTES_JSON must contain at least one source route.');
  }
  return parsed as MllpTenantRoute[];
}

const evidence: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  runtimeMode: process.env.GHIMS_RUNTIME_MODE || process.env.NODE_ENV || 'unknown',
  checks: {},
};

const checks = evidence.checks as Record<string, unknown>;

async function qualifyHl7() {
  const state = getServerIntegrationState('HL7');
  if (state !== 'LIVE') {
    checks.hl7 = { state, qualified: false, reason: 'NOT_LIVE' };
    return;
  }

  const tlsEnabled = bool(process.env.GHIMS_HL7_MLLP_TLS_ENABLED);
  validateHl7MllpConfig({
    host: process.env.GHIMS_HL7_MLLP_HOST || '0.0.0.0',
    port: Number(process.env.GHIMS_HL7_MLLP_PORT || 2575),
    ingestUrl: required('GHIMS_HL7_INTERNAL_INGEST_URL'),
    ingestApiKey: required('GHIMS_HL7_INGEST_API_KEY'),
    sourceRoutes: jsonRoutes(process.env.GHIMS_HL7_MLLP_SOURCE_ROUTES_JSON),
    tls: tlsEnabled
      ? {
          certPath: required('GHIMS_HL7_MLLP_TLS_CERT_PATH'),
          keyPath: required('GHIMS_HL7_MLLP_TLS_KEY_PATH'),
          caPath: required('GHIMS_HL7_MLLP_TLS_CA_PATH'),
          requestClientCertificate: true,
          rejectUnauthorized: true,
        }
      : undefined,
  });
  checks.hl7 = {
    state,
    qualified: true,
    transport: 'MLLP',
    note: 'Configuration-qualified. Partner message/ACK smoke evidence must be captured in deployment evidence.',
  };
}

async function qualifyFhir() {
  const state = getServerIntegrationState('FHIR_R4');
  if (state !== 'LIVE') {
    checks.fhir = { state, qualified: false, reason: 'NOT_LIVE' };
    return;
  }

  const approved = csv(
    process.env.GHIMS_FHIR_APPROVED_RESOURCES,
    DEFAULT_APPROVED_FHIR_R4_RESOURCES
  );
  const writable = csv(
    process.env.GHIMS_FHIR_WRITABLE_RESOURCES,
    DEFAULT_WRITABLE_FHIR_R4_RESOURCES
  );

  const adapter = new FhirR4Adapter({
    baseUrl: required('GHIMS_FHIR_BASE_URL'),
    state,
    accessToken: required('GHIMS_FHIR_ACCESS_TOKEN'),
    approvedResourceTypes: approved,
    writableResourceTypes: writable,
  });

  const requirements: FhirResourceCapabilityRequirement[] = approved.map((resourceType) => ({
    resourceType,
    read: true,
    search: true,
    create: writable.includes(resourceType),
    update: writable.includes(resourceType),
  }));
  const report = await adapter.qualifyApprovedResources(requirements);
  if (!report.valid) {
    throw new Error('FHIR_R4_CONFORMANCE_FAILED:' + report.errors.join('|'));
  }
  checks.fhir = { state, qualified: true, report };
}

async function qualifyDicom() {
  const state = getServerIntegrationState('DICOMWEB');
  if (state !== 'LIVE') {
    checks.dicomweb = { state, qualified: false, reason: 'NOT_LIVE' };
    return;
  }

  const client = new DicomWebClient({
    baseUrl: required('GHIMS_DICOMWEB_BASE_URL'),
    authToken: required('GHIMS_DICOMWEB_AUTH_TOKEN'),
    state,
    allowedHosts: csv(process.env.GHIMS_DICOMWEB_ALLOWED_HOSTS, []),
  });
  const report = await client.qualifyLiveEnvironment();
  if (!report.valid) {
    throw new Error('DICOMWEB_QUALIFICATION_FAILED:' + report.errors.join('|'));
  }
  checks.dicomweb = { state, qualified: true, report };
}

async function qualifyBiomedical() {
  const state = getServerIntegrationState('DEVICE_TELEMETRY');
  if (state !== 'LIVE') {
    checks.biomedical = { state, qualified: false, reason: 'NOT_LIVE' };
    return;
  }

  const tenantId = required('GHIMS_WAVE4_QUALIFY_TENANT_ID').toLowerCase();
  const resourceId = required('GHIMS_WAVE4_QUALIFY_BIOMEDICAL_RESOURCE_ID');
  const resource = await assertBiomedicalInteropReady({ tenantId, resourceId });
  checks.biomedical = {
    state,
    qualified: true,
    resourceId: resource.resourceId,
    calibrationStatus: resource.calibrationStatus,
    nextCalibrationDate: resource.nextCalibrationDate,
  };
}

async function qualifyEdi() {
  const state = getServerIntegrationState('EDI_X12');
  if (state !== 'LIVE') {
    checks.edi = { state, qualified: false, reason: 'NOT_LIVE' };
    return;
  }

  const programEnabled = bool(process.env.GHIMS_EDI_PROGRAM_ENABLED);
  const externalConformanceQualified = bool(
    process.env.GHIMS_EDI_EXTERNAL_CONFORMANCE_QUALIFIED
  );
  new EdiClearinghouseClient({
    baseUrl: required('GHIMS_EDI_CLEARINGHOUSE_BASE_URL'),
    state,
    programEnabled,
    externalConformanceQualified,
    apiKey: required('GHIMS_EDI_CLEARINGHOUSE_API_KEY'),
  });
  if (!programEnabled || !externalConformanceQualified) {
    throw new Error('EDI_LIVE_STATE_REQUIRES_INTENTIONAL_PROGRAM_AND_EXTERNAL_CONFORMANCE');
  }
  checks.edi = {
    state,
    qualified: true,
    note: 'Configuration gate qualified. No claim is transmitted by this preflight.',
  };
}

await qualifyHl7();
await qualifyFhir();
await qualifyDicom();
await qualifyBiomedical();
await qualifyEdi();

const liveStates = ['HL7', 'FHIR_R4', 'DICOMWEB', 'DEVICE_TELEMETRY', 'EDI_X12']
  .filter((name) => getServerIntegrationState(name as any) === 'LIVE');

if (liveStates.length === 0) {
  throw new Error('WAVE4_LIVE_QUALIFICATION_REQUIRES_AT_LEAST_ONE_LIVE_INTEGRATION');
}

console.log(JSON.stringify(evidence, null, 2));
