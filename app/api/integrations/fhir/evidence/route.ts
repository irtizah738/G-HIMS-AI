import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { assertIntegrationLive } from '@/lib/interop/integration-state';
import { readExternalClinicalEvidence } from '@/lib/clinical/intelligence/external-clinical-evidence-reader';

export const runtime = 'nodejs';

/**
 * CI-EXT-03: server-authorized external evidence review.
 * Does not write into native Patient360, promote source facts, or permit drafts.
 * Explicit FHIR_EVIDENCE_REVIEW membership permission is mandatory.
 */
export async function POST(req: NextRequest) {
  try {
    if (process.env.GHIMS_CI_EXTERNAL_EVIDENCE_READER_ENABLED !== 'true') {
      throw new Error('CI_EXT03_READER_NOT_ENABLED');
    }
    assertIntegrationLive('FHIR_R4');
    const bodyText = await req.text();
    if (Buffer.byteLength(bodyText, 'utf8') > 4096) {
      return NextResponse.json({ success: false, code: 'CI_EXT03_REQUEST_TOO_LARGE' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } });
    }
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const patientId = String(body.patientId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(tenantId) ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(patientId)) {
      throw new Error('CI_EXT03_REQUEST_SCOPE_INVALID');
    }
    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const db = getAdminFirestore();
    if (!db) throw new Error('CI_EXT03_FIRESTORE_UNAVAILABLE');
    const read = await readExternalClinicalEvidence({
      db, tenantId: context.tenantId, patientId,
      actor: {
        tenantId: context.tenantId,
        actorId: context.actorId,
        roles: context.roles,
        permissions: context.permissions,
        facilityIds: context.facilityIds || [],
      },
    });
    return NextResponse.json(
      {
        success: true,
        ...read,
        evidenceOnly: true,
        aiDraftingEligible: false,
        clinicianVerified: false,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : '';
    const status = /TENANT|FACILITY|PERMISSION|SOURCE_REVOKED|CONSENT|NOT_ENABLED|INTEGRATION_NOT_LIVE/.test(code)
      ? 403 : /REQUEST_SCOPE_INVALID|REQUEST_TOO_LARGE/.test(code)
        ? 422 : /EXPIRED|CHECKPOINT|RECONCILIATION|INVALID|INCOMPLETE|ADVANCED|MISSING|INTEGRITY/.test(code)
          ? 409 : 503;
    // No upstream PHI, source URLs, credentials, or patient identifiers in errors.
    return NextResponse.json({
      success: false, code: code.startsWith('CI_EXT03_') ? code : 'CI_EXT03_EVIDENCE_READ_UNAVAILABLE',
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
