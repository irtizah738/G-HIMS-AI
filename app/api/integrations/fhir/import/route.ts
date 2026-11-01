import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { assertIntegrationLive } from '@/lib/interop/integration-state';
import { FhirR4Adapter } from '@/lib/interop/fhir-r4-adapter';
import {
  EXTERNAL_FHIR_IMPORT_TYPES,
  assertFhirIdentifier,
  ingestExternalFhirResource,
  preflightExternalFhirSource,
  type ExternalFhirImportType,
} from '@/lib/clinical/intelligence/external-fhir-import';

export const runtime = 'nodejs';

/**
 * Authenticated, deliberately narrow pull of one FHIR R4 resource revision.
 *
 * The body only selects a registered source and resource ID. It cannot supply
 * an endpoint, token, patient mapping, actor, or imported clinical payload.
 *
 * Initial deployment contract: one explicitly pinned FHIR source per runtime.
 * A tenant-aware OAuth broker and hospital-specific qualification are required
 * before deploying many independent sources from a shared runtime.
 */
export async function POST(req: NextRequest) {
  try {
    if (process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'true') {
      throw new Error('FHIR_IMPORT_NOT_ENABLED');
    }
    assertIntegrationLive('FHIR_R4');
    const bytes = Number(req.headers.get('content-length') || 0);
    if (!Number.isFinite(bytes) || bytes > 4096) {
      return NextResponse.json({ success: false, code: 'FHIR_IMPORT_REQUEST_TOO_LARGE' }, { status: 413 });
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096) {
      return NextResponse.json({ success: false, code: 'FHIR_IMPORT_REQUEST_TOO_LARGE' }, { status: 413 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const requestedTenant = assertFhirIdentifier(body.tenantId, 'FHIR_IMPORT_TENANT_INVALID');
    const sourceId = assertFhirIdentifier(body.sourceId, 'FHIR_IMPORT_SOURCE_ID_INVALID');
    const resourceType = String(body.resourceType || '') as ExternalFhirImportType;
    const resourceId = assertFhirIdentifier(body.resourceId, 'FHIR_IMPORT_RESOURCE_ID_REQUIRED');
    if (!(EXTERNAL_FHIR_IMPORT_TYPES as readonly string[]).includes(resourceType)) {
      throw new Error('FHIR_IMPORT_RESOURCE_TYPE_UNSUPPORTED');
    }

    const { context } = await deriveAuthoritativeContext(req, requestedTenant);
    const db = getAdminFirestore();
    if (!db) throw new Error('FHIR_IMPORT_FIRESTORE_UNAVAILABLE');

    // Pinned server-side configuration: never use a client-selected FHIR URL.
    const pinnedTenant = process.env.GHIMS_CI_FHIR_SOURCE_TENANT || '';
    const pinnedSource = process.env.GHIMS_CI_FHIR_SOURCE_ID || '';
    const rawBaseUrl = process.env.GHIMS_CI_FHIR_BASE_URL || '';
    const token = process.env.GHIMS_CI_FHIR_ACCESS_TOKEN || '';
    const baseUrl = rawBaseUrl.replace(/\/$/, '');
    const url = new URL(baseUrl);
    if (context.tenantId !== pinnedTenant || sourceId !== pinnedSource ||
        !token.trim() || url.protocol !== 'https:' || url.username || url.password ||
        url.search || url.hash || !url.hostname) {
      throw new Error('FHIR_IMPORT_SOURCE_RUNTIME_BINDING_DENIED');
    }

    const actor = {
      actorId: context.actorId,
      tenantId: context.tenantId,
      roles: context.roles,
      permissions: context.permissions,
      facilityIds: context.facilityIds || [],
    };
    await preflightExternalFhirSource({
      db, actor, sourceId, resourceType, expectedBaseUrl: baseUrl,
    });

    // HTTP retrieval happens outside the Firestore transaction. The adapter
    // will not retry writes and requires the LIVE activation state.
    const adapter = new FhirR4Adapter({
      baseUrl, state: 'LIVE', accessToken: token,
      approvedResourceTypes: [...EXTERNAL_FHIR_IMPORT_TYPES],
      writableResourceTypes: [],
      timeoutMs: 12000,
      maxReadRetries: 1,
      requireHttpsInProduction: true,
    });
    const resource = await adapter.readResource(resourceType, resourceId);
    if (resource.id !== resourceId || resource.resourceType !== resourceType) {
      throw new Error('FHIR_IMPORT_REMOTE_RESOURCE_MISMATCH');
    }
    const result = await ingestExternalFhirResource({
      db, actor, sourceId, resource, expectedBaseUrl: baseUrl,
    });
    // Receipt only. Never return PHI or the raw imported resource to caller.
    return NextResponse.json({ success: true, ...result }, { status: result.replay ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'FHIR_IMPORT_FAILED';
    const status =
      /AUTH|TENANT|SESSION|DEVICE|PERMISSION|FACILITY|NOT_AUTHORIZED|BINDING_DENIED|CONSENT|SOURCE_NOT|INTEGRATION_NOT_LIVE|NOT_ENABLED/.test(code) ? 403
      : /REPLAY|RELINK|RECONCILIATION|ENDPOINT_CHANGED/.test(code) ? 409
      : /INVALID|REQUIRED|UNSUPPORTED|MISMATCH|MULTIPLE_VALUES|TOO_LARGE/.test(code) ? 422
      : 503;
    // FHIR OperationOutcome may include sensitive vendor diagnostics. Do not
    // return upstream bodies, bearer tokens or untrusted error strings.
    return NextResponse.json({ success: false, code: code.startsWith('FHIR_') ? code : 'FHIR_IMPORT_FAILED' }, { status });
  }
}
