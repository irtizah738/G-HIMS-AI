import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { assertIntegrationLive } from '@/lib/interop/integration-state';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';
import { approveFhirReconciliation } from '@/lib/clinical/intelligence/external-fhir-reconciliation';

export const runtime = 'nodejs';

/** Operational evidence summary only; this route never exposes the raw FHIR payload. */
export async function POST(req: NextRequest) {
  try {
    if (process.env.GHIMS_CI_EXTERNAL_CONTEXT_REVIEW_ENABLED !== 'true') {
      throw new Error('FHIR_CONTEXT_REVIEW_NOT_ENABLED');
    }
    assertIntegrationLive('FHIR_R4');
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 4096) {
      return NextResponse.json({ success: false, code: 'FHIR_CONTEXT_BODY_TOO_LARGE' }, { status: 413 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(tenantId)) throw new Error('FHIR_CONTEXT_TENANT_INVALID');
    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const db = getAdminFirestore();
    if (!db) throw new Error('FHIR_CONTEXT_FIRESTORE_UNAVAILABLE');
    const actor = {
      actorId: context.actorId, tenantId: context.tenantId,
      permissions: context.permissions, roles: context.roles,
      facilityIds: context.facilityIds || [],
    };
    switch (body.action) {
      case 'REBUILD': {
        const patientId = String(body.patientId || '').trim();
        const { projection, unchanged } = await rebuildExternalPatient360({
          db, actor, tenantId: context.tenantId, patientId,
        });
        return NextResponse.json({
          success: true, tenantId: projection.tenantId,
          status: projection.status, revision: projection.revision,
          sourceCheckpoint: projection.sourceCheckpoint,
          contentHash: projection.contentHash,
          evidenceCount: projection.facts.length,
          reconciliationIssues: projection.reconciliationIssues,
          unchanged,
          clinicallyQualified: false,
        });
      }
      case 'REVIEW_CASE': {
        const outcome = await approveFhirReconciliation({
          db, actor, caseId: String(body.caseId || ''),
          decision: 'SUPPRESS_CONFLICTING_VERSION',
          rationale: String(body.rationale || ''),
        });
        return NextResponse.json({ success: true, ...outcome });
      }
      default:
        throw new Error('FHIR_CONTEXT_ACTION_UNSUPPORTED');
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'FHIR_CONTEXT_UNAVAILABLE';
    const status = /AUTH|TENANT_DENIED|PERMISSION|FACILITY|NOT_ENABLED|INTEGRATION_NOT_LIVE/.test(code)
      ? 403 : /INVALID|REQUIRED|UNSUPPORTED|BODY_TOO_LARGE/.test(code)
        ? 422 : /RECONCILIATION|LINEAGE|INTEGRITY/.test(code) ? 409 : 503;
    return NextResponse.json({
      success: false,
      code: code.startsWith('FHIR_') ? code : 'FHIR_CONTEXT_UNAVAILABLE',
    }, { status });
  }
}
