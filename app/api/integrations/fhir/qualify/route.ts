/**
 * CI-EXT-04 — controlled protocol-only sandbox qualification.
 *
 * This endpoint MAY contact a preapproved synthetic hospital/vendor sandbox
 * in STAGING only. It never reads a Patient record, and cannot activate a
 * source or mark a hospital clinically qualified.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { checkSmartBackendSource, SmartBackendTokenBroker } from '@/lib/interop/fhir-smart-backend-oauth';
import { createGcpFhirPrivateKeyAccessor } from '@/lib/interop/fhir-smart-secret-manager';
import { qualifySmartFhirSandbox } from '@/lib/interop/fhir-smart-sandbox-qualification';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    if (process.env.GHIMS_CI_FHIR_SANDBOX_QUALIFICATION_ENABLED !== 'true' ||
        process.env.GHIMS_CI_FHIR_AUTH_MODE !== 'SMART_BACKEND' ||
        process.env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
        getServerIntegrationState('FHIR_R4') !== 'INTEGRATION_READY') {
      throw new Error('CI_EXT04_SANDBOX_QUALIFICATION_DISABLED');
    }
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (!Number.isFinite(contentLength) || contentLength > 1024) {
      throw new Error('CI_EXT04_REQUEST_TOO_LARGE');
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 1024) throw new Error('CI_EXT04_REQUEST_TOO_LARGE');
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const tenantId = String(payload.tenantId || '').trim().toLowerCase();
    const sourceId = String(payload.sourceId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(tenantId) ||
        !/^[A-Za-z0-9._-]{1,64}$/.test(sourceId)) {
      throw new Error('CI_EXT04_REQUEST_INVALID');
    }
    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!context.permissions.includes('FHIR_INTEGRATION_QUALIFY')) {
      throw new Error('CI_EXT04_PERMISSION_DENIED');
    }
    const db = getAdminFirestore();
    if (!db) throw new Error('CI_EXT04_FIRESTORE_UNAVAILABLE');
    const tenant = db.collection('tenants').doc(context.tenantId);
    const sourceRef = tenant.collection('fhirSources').doc(sourceId);
    const sourceSnap = await sourceRef.get();
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source || source.tenantId !== context.tenantId ||
        source.sourceId !== sourceId ||
        !(context.facilityIds || []).includes(source.facilityId)) {
      throw new Error('CI_EXT04_SOURCE_OR_FACILITY_DENIED');
    }
    const allowedTokenHosts = (process.env.GHIMS_CI_FHIR_OAUTH_ALLOWED_TOKEN_HOSTS || '')
      .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const allowedFhirHosts = (process.env.GHIMS_CI_FHIR_OAUTH_ALLOWED_FHIR_HOSTS || '')
      .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const config = checkSmartBackendSource(source, context.tenantId, sourceId, {
      allowedTokenHosts, allowedFhirHosts,
    });
    const broker = new SmartBackendTokenBroker({
      allowedTokenHosts, allowedFhirHosts,
      getSecret: createGcpFhirPrivateKeyAccessor({
        projectId: process.env.GHIMS_CI_FHIR_SECRET_PROJECT_ID || '',
      }),
    });
    const report = await qualifySmartFhirSandbox({
      source, tenantId: context.tenantId, sourceId, broker,
      allowedTokenHosts, allowedFhirHosts,
    });
    const protocolPassed = report.smartDiscoveryVerified &&
      report.fhirR4CapabilityVerified &&
      report.canReadPatient && report.canReadEncounter &&
      report.canReadObservation && report.errors.length === 0;
    const qualificationId = 'fsq_' + randomUUID();
    // Revalidate source registration and key rotation after remote requests;
    // an obsolete client/key cannot produce an accepted qualification record.
    await db.runTransaction(async tx => {
      const live = await tx.get(sourceRef);
      const current = live.exists ? live.data() as FhirSourceRecord : null;
      if (!current || current.status !== 'ACTIVE' ||
          current.securityReviewStatus !== 'APPROVED' ||
          current.tenantId !== context.tenantId ||
          current.sourceId !== sourceId || current.baseUrl !== source.baseUrl ||
          current.facilityId !== source.facilityId ||
          current.oauth?.credentialRevision !== config.credentialRevision ||
          current.oauth?.secretVersion !== config.secretVersion ||
          current.oauth?.tokenUrl !== config.tokenUrl ||
          current.oauth?.clientId !== config.clientId ||
          current.oauth?.keyId !== config.keyId) {
        throw new Error('CI_EXT04_SOURCE_CONFIG_CHANGED');
      }
      tx.create(tenant.collection('fhirSandboxQualifications').doc(qualificationId), {
        qualificationId, tenantId: context.tenantId, sourceId,
        facilityId: source.facilityId, actorId: context.actorId,
        credentialRevision: config.credentialRevision,
        checkedAt: report.checkedAt,
        protocolOutcome: protocolPassed ? 'PROTOCOL_PASSED_SITE_PENDING' : 'FAILED',
        smartDiscoveryVerified: report.smartDiscoveryVerified,
        fhirR4CapabilityVerified: report.fhirR4CapabilityVerified,
        capabilities: {
          Patient: report.canReadPatient,
          Encounter: report.canReadEncounter,
          Observation: report.canReadObservation,
        },
        errors: report.errors, immutable: true,
        qualifiedForPatientData: false, qualifiedForProduction: false,
      });
    });
    return NextResponse.json({
      success: true, qualificationId, ...report,
      protocolOutcome: protocolPassed ? 'PROTOCOL_PASSED_SITE_PENDING' : 'FAILED',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (e) {
    const raw = e instanceof Error ? e.message : '';
    const status = /DENIED|DISABLED|NOT_AUTHORIZED/.test(raw) ? 403 :
      /REQUEST_INVALID|REQUEST_TOO_LARGE/.test(raw) ? 422 :
      /CONFIG_CHANGED/.test(raw) ? 409 : 503;
    return NextResponse.json({
      success: false,
      code: raw.startsWith('CI_EXT04_') ? raw : 'CI_EXT04_SANDBOX_UNAVAILABLE',
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
