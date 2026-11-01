/**
 * CI-EXT-06: controlled read-only vendor FHIR sandbox probe.
 *
 * Returns technical observations ONLY. It never creates fhirSyntheticQualifications,
 * never issues a clinical "PASS", and never imports a resource into Patient 360.
 * The fixture manifest is separately provisioned by trusted hospital operators.
 */
import { createHash } from 'node:crypto';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { FhirR4Adapter, type FhirResource } from './fhir-r4-adapter';
import { checkSmartBackendSource, type SmartBackendTokenBroker } from './fhir-smart-backend-oauth';

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const HOUR = 3_600_000;
const MAX_BYTES = 128 * 1024;
type Kind = 'Patient' | 'Encounter' | 'Observation';

export type VendorFixtureManifest = {
  tenantId: string;
  sourceId: string;
  facilityId: string;
  manifestRevision: number;
  status: 'APPROVED' | 'REVOKED';
  syntheticOnly: true;
  credentialRevision: number;
  fhirBaseUrl: string;
  tokenUrl: string;
  approvedBy: string;
  vendorAuthorizationId: string;
  approvedAt: number;
  expiresAt: number;
  fixtures: {
    patientId: string;
    encounterId: string;
    observationId: string;
    observationCodeSystem: string;
    observationCode: string;
  };
};
export type VendorSandboxProbeReport = {
  tenantId: string;
  sourceId: string;
  facilityId: string;
  manifestRevision: number;
  credentialRevision: number;
  checkedAt: number;
  outcome: 'OBSERVED_PENDING_INDEPENDENT_REVIEW' | 'FAILED';
  checks: {
    patientRead: boolean;
    encounterPatientReference: boolean;
    observationPatientReference: boolean;
    observationCode: boolean;
    versionMetadata: boolean;
    stableReplay: boolean;
  };
  evidenceHash: string | null;
  // These are deliberately hardcoded; transport evidence != clinical signoff.
  qualifiedForPatientData: false;
  qualifiedForProduction: false;
  errors: string[];
};
const digest = (v: unknown): string => createHash('sha256')
  .update(JSON.stringify(v)).digest('hex');

export function validateVendorFixtureManifest(
  source: FhirSourceRecord, manifest: VendorFixtureManifest,
  now: number
): VendorFixtureManifest {
  if (!manifest || source.status !== 'ACTIVE' ||
      source.securityReviewStatus !== 'APPROVED' ||
      source.tenantId !== manifest.tenantId ||
      source.sourceId !== manifest.sourceId ||
      source.facilityId !== manifest.facilityId ||
      manifest.status !== 'APPROVED' || manifest.syntheticOnly !== true ||
      !source.oauth ||
      manifest.credentialRevision !== source.oauth.credentialRevision ||
      manifest.fhirBaseUrl !== source.baseUrl ||
      manifest.tokenUrl !== source.oauth.tokenUrl ||
      !Number.isSafeInteger(manifest.manifestRevision) ||
      manifest.manifestRevision < 1 ||
      !Number.isFinite(manifest.approvedAt) ||
      !Number.isFinite(manifest.expiresAt) ||
      !Number.isFinite(now) ||
      now < manifest.approvedAt || now >= manifest.expiresAt ||
      manifest.expiresAt - manifest.approvedAt > 30 * 24 * HOUR ||
      !ID.test(manifest.approvedBy || '') ||
      !/^[A-Za-z0-9._-]{8,128}$/.test(manifest.vendorAuthorizationId || '')) {
    throw new Error('CI_EXT06_MANIFEST_NOT_AUTHORIZED');
  }
  const fixtures = manifest.fixtures;
  if (!fixtures || ![fixtures.patientId, fixtures.encounterId,
      fixtures.observationId].every(v => ID.test(v) && v !== '.' && v !== '..') ||
      !/^https?:\/\/[A-Za-z0-9./_-]{4,200}$/.test(fixtures.observationCodeSystem) ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(fixtures.observationCode)) {
    throw new Error('CI_EXT06_FIXTURE_INVALID');
  }
  for (const t of ['Patient', 'Encounter', 'Observation'] as const) {
    if (!source.approvedResourceTypes.includes(t) ||
        !source.oauth.scopes.includes('system/' + t + '.rs')) {
      throw new Error('CI_EXT06_SOURCE_SCOPE_INCOMPLETE');
    }
  }
  return manifest;
}

/** Bound vendor response bytes before allowing JSON parsing or memory growth. */
async function boundedResponse(
  response: Response,
  byteLimit = MAX_BYTES
): Promise<Response> {
  const stated = Number(response.headers.get('content-length') || 0);
  if (stated > byteLimit) throw new Error('CI_EXT06_RESPONSE_TOO_LARGE');
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > byteLimit) throw new Error('CI_EXT06_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const data = Buffer.concat(chunks.map(c => Buffer.from(c)));
  return new Response(data, {
    status: response.status, statusText: response.statusText,
    headers: new Headers({
      'content-type': response.headers.get('content-type') || 'application/fhir+json',
    }),
  });
}
function version(resource: FhirResource, id: string, kind: Kind): string {
  if (resource.resourceType !== kind || resource.id !== id ||
      typeof resource.meta?.versionId !== 'string' ||
      !resource.meta.versionId.trim() ||
      typeof resource.meta?.lastUpdated !== 'string' ||
      !Number.isFinite(Date.parse(resource.meta.lastUpdated))) {
    throw new Error('CI_EXT06_VERSION_OR_ID_MISMATCH');
  }
  return resource.meta.versionId + '@' + resource.meta.lastUpdated;
}
function subject(resource: FhirResource): string {
  const ref = (resource.subject as { reference?: unknown } | undefined)?.reference;
  return typeof ref === 'string' ? ref : '';
}
function codeMatches(resource: FhirResource, system: string, code: string): boolean {
  const coding = (resource.code as { coding?: unknown } | undefined)?.coding;
  return Array.isArray(coding) && coding.some(c =>
    c && typeof c === 'object' &&
    (c as { system?: unknown }).system === system &&
    (c as { code?: unknown }).code === code
  );
}

/** No network traffic occurs until the source and trusted manifest pass. */
export async function probeVendorFhirSandbox(args: {
  source: FhirSourceRecord;
  tenantId: string;
  sourceId: string;
  manifest: VendorFixtureManifest;
  broker: Pick<SmartBackendTokenBroker, 'getAccessToken'>;
  allowedTokenHosts: readonly string[];
  allowedFhirHosts: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<VendorSandboxProbeReport> {
  const now = (args.now || Date.now)();
  checkSmartBackendSource(args.source, args.tenantId, args.sourceId, args);
  validateVendorFixtureManifest(args.source, args.manifest, now);
  const source = args.source;
  const manifest = args.manifest;
  const checks: VendorSandboxProbeReport['checks'] = {
    patientRead: false, encounterPatientReference: false,
    observationPatientReference: false, observationCode: false,
    versionMetadata: false, stableReplay: false,
  };
  const report: VendorSandboxProbeReport = {
    tenantId: args.tenantId, sourceId: args.sourceId,
    facilityId: source.facilityId,
    manifestRevision: manifest.manifestRevision,
    credentialRevision: source.oauth!.credentialRevision,
    checkedAt: now, outcome: 'FAILED', checks, evidenceHash: null,
    qualifiedForPatientData: false, qualifiedForProduction: false, errors: [],
  };
  // FHIR library's request path is GET-only; no search or mutation methods
  // are available to this runner. Client cannot supply resource IDs.
  const baseFetch = args.fetchImpl || fetch;
  const boundedFetch: typeof fetch = async (input, init) =>
    boundedResponse(await baseFetch(input, init));
  const adapter = (type: Kind) => new FhirR4Adapter({
    baseUrl: source.baseUrl, state: 'LIVE',
    approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
    writableResourceTypes: [],
    getAccessToken: () => args.broker.getAccessToken({
      source, tenantId: args.tenantId, sourceId: args.sourceId,
      resourceType: type,
    }),
    timeoutMs: 12_000, maxReadRetries: 0, fetchImpl: boundedFetch,
  });
  try {
    const p = await adapter('Patient').readResource('Patient', manifest.fixtures.patientId);
    const e = await adapter('Encounter').readResource('Encounter', manifest.fixtures.encounterId);
    const o = await adapter('Observation').readResource('Observation', manifest.fixtures.observationId);
    const patientVer = version(p, manifest.fixtures.patientId, 'Patient');
    const encounterVer = version(e, manifest.fixtures.encounterId, 'Encounter');
    const observationVer = version(o, manifest.fixtures.observationId, 'Observation');
    checks.versionMetadata = true;
    checks.patientRead = true;
    checks.encounterPatientReference =
      subject(e) === 'Patient/' + manifest.fixtures.patientId;
    checks.observationPatientReference =
      subject(o) === 'Patient/' + manifest.fixtures.patientId;
    checks.observationCode = codeMatches(o,
      manifest.fixtures.observationCodeSystem, manifest.fixtures.observationCode);
    if (Object.values(checks).slice(0,5).some(x => !x)) {
      report.errors.push('CI_EXT06_FIXTURE_CROSS_PATIENT_OR_CODE_MISMATCH');
      return report;
    }
    // Repeat the exact remote observation read. This proves the vendor API
    // returned a stable version on the observed run, NOT import idempotency.
    const again = await adapter('Observation').readResource(
      'Observation', manifest.fixtures.observationId
    );
    checks.stableReplay = observationVer ===
      version(again, manifest.fixtures.observationId, 'Observation');
    if (!checks.stableReplay) {
      report.errors.push('CI_EXT06_SOURCE_VERSION_CHANGED_DURING_PROBE');
      return report;
    }
    // Only resource type, fixture key hashes and source version metadata are
    // fingerprinted; raw payloads, patient names, DOB and clinical values are
    // neither logged, returned, nor persisted.
    report.evidenceHash = digest([
      source.tenantId, source.sourceId, source.facilityId,
      source.oauth!.credentialRevision, manifest.manifestRevision,
      ['Patient', digest(manifest.fixtures.patientId), patientVer],
      ['Encounter', digest(manifest.fixtures.encounterId), encounterVer],
      ['Observation', digest(manifest.fixtures.observationId), observationVer],
    ]);
    report.outcome = 'OBSERVED_PENDING_INDEPENDENT_REVIEW';
    return report;
  } catch (error) {
    // Remote server OperationOutcome diagnostics may contain PHI.
    report.errors.push(error instanceof Error && error.message.startsWith('CI_EXT06_')
      ? error.message : 'CI_EXT06_VENDOR_READ_UNAVAILABLE');
    return report;
  }
}
