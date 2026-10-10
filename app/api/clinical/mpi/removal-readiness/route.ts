import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { unresolvedRemovalEncounter } from '@/lib/backend/services/patient-record-removal-domain-service';
import { pointerBlockers } from '@/lib/clinical/mpi/removal-care-pointer-blockers';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, no-store' };

function responseError(code: string, status: number) {
  return NextResponse.json({ success: false, error: code }, { status, headers: HEADERS });
}

/**
 * Read-only diagnostic, not an approval for removal.
 * Every removal request is independently revalidated by RemovePatientRecordCommand.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';
    const patientId = typeof body?.patientId === 'string' ? body.patientId.trim() : '';
    const expectedMrn = typeof body?.expectedMrn === 'string' ? body.expectedMrn.trim().toUpperCase() : '';
    if (!/^[a-z0-9_-]{3,128}$/.test(tenantId) || !patientId || patientId.length > 150 ||
        !expectedMrn || expectedMrn.length > 150) {
      return responseError('MPI_REMOVAL_READINESS_REQUEST_INVALID', 400);
    }
    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const decision = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'],
    });
    if (!decision.authorized) return responseError('MPI_REMOVAL_READINESS_FORBIDDEN', 403);

    const db = getAdminFirestore();
    if (!db) return responseError('MPI_REMOVAL_READINESS_STORE_UNAVAILABLE', 503);
    const tenant = db.collection('tenants').doc(context.tenantId);
    const patientDoc = await tenant.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) return responseError('PATIENT_NOT_FOUND', 404);
    const patient = patientDoc.data() as Record<string, unknown>;
    if (patient.tenantId !== context.tenantId ||
        String(patient.mrn || '').trim().toUpperCase() !== expectedMrn) {
      return responseError('PATIENT_IDENTITY_MISMATCH', 409);
    }

    // The same patientId predicate used by the authoritative removal domain.
    // A truncated result is NOT interpreted as no active encounters.
    const found = await tenant.collection('encounters')
      .where('patientId', '==', patientId).limit(501).get();
    if (found.size > 500) return responseError('MPI_REMOVAL_READINESS_TOO_MANY_ENCOUNTERS', 409);
    const encounters = found.docs.flatMap(doc => {
      const value = doc.data();
      const unresolved = unresolvedRemovalEncounter({
        ...value, encounterId: value.encounterId || value.id || doc.id,
      });
      return unresolved ? [{
        source: 'ENCOUNTER' as const,
        domain: unresolved.encounterType,
        encounterId: unresolved.encounterId,
        status: unresolved.status,
        detail: 'Authoritative encounter remains unresolved. Complete or cancel via its governed clinical workflow.',
      }] : [];
    });
    const pointers = pointerBlockers(patient);
    const lifecycleById = new Map<string, string>();
    for (const doc of found.docs) {
      const data = doc.data();
      const status = String(data.status || '').trim().toUpperCase() || 'UNKNOWN';
      const authoritativeId = String(data.encounterId || data.id || doc.id);
      lifecycleById.set(authoritativeId, status);
      lifecycleById.set(doc.id, status);
    }
    const byEncounter = new Map(encounters.map(e => [e.encounterId, e]));
    // Do not hide stale pointers: even a terminal encounter is still blocked
    // if the patient's active-care reference was not safely reconciled.
    const blockers = [
      ...encounters,
      ...pointers.map(p => {
        const matched = p.encounterId ? byEncounter.get(p.encounterId) : undefined;
        if (matched) return {
          ...p, status: matched.status,
          detail: 'Unresolved encounter and active patient pointer. Complete the governed clinical disposition.',
        };
        const status = p.encounterId ? lifecycleById.get(p.encounterId) : undefined;
        if (status && ['COMPLETED','CLOSED','DISCHARGED','CANCELLED','CANCELED','TRANSFERRED'].includes(status)) {
          return {
            ...p, status: 'STALE_POINTER_TERMINAL_ENCOUNTER',
            detail: `Encounter is ${status}, but the patient's active-care pointer remains. An authorized clinical reconciliation must clear it atomically.`,
          };
        }
        return p.encounterId && !status ? {
          ...p, status: 'POINTER_ENCOUNTER_NOT_FOUND',
          detail: 'No matching encounter was found under this patient. Verify identity and reconcile the orphaned pointer through an audited command.',
        } : p;
      }),
    ];
    const recordStatus = String(patient.status || 'ACTIVE').toUpperCase();
    if (recordStatus === 'MERGED' || recordStatus === 'REMOVED') {
      return responseError('MPI_REMOVAL_READINESS_RECORD_NOT_ELIGIBLE', 409);
    }
    return NextResponse.json({
      success: true, readyForRemoval: blockers.length === 0,
      patientId, mrn: expectedMrn,
      checkedAt: Date.now(), source: 'AUTHORITATIVE_FIRESTORE',
      blockers,
      notice: 'Read-only diagnosis. Actual removal rechecks encounter and patient state atomically.',
    }, { headers: HEADERS });
  } catch {
    return responseError('MPI_REMOVAL_READINESS_CHECK_FAILED', 503);
  }
}
