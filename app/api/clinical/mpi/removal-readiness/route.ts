import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { unresolvedRemovalEncounter } from '@/lib/backend/services/patient-record-removal-domain-service';

export const dynamic = 'force-dynamic';

type RemovalBlocker = {
  source: 'ENCOUNTER' | 'ACTIVE_CARE_POINTER' | 'ACTIVE_BED';
  domain: string;
  encounterId?: string;
  status: string;
  detail: string;
};

const HEADERS = { 'Cache-Control': 'private, no-store' };

function responseError(code: string, status: number) {
  return NextResponse.json({ success: false, error: code }, { status, headers: HEADERS });
}

function pointerBlockers(patient: Record<string, unknown>): RemovalBlocker[] {
  const c = patient.activeCareContexts && typeof patient.activeCareContexts === 'object' &&
    !Array.isArray(patient.activeCareContexts)
    ? patient.activeCareContexts as Record<string, unknown> : {};
  const blockers: RemovalBlocker[] = [];
  const add = (domain: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    blockers.push({
      source: 'ACTIVE_CARE_POINTER', domain, encounterId: value.trim(),
      status: 'UNRESOLVED_POINTER',
      detail: 'Patient still references this encounter. Confirm its authoritative status and reconcile through the responsible clinical workflow.',
    });
  };
  if (patient.activeBedId) {
    blockers.push({
      source: 'ACTIVE_BED', domain: 'IPD', status: 'BED_ASSIGNED',
      detail: 'An active bed assignment is recorded. Verify census and clinical disposition before removal.',
    });
  }
  add('LEGACY', patient.activeEncounterId);
  add('IPD', c.activeIpdEncounterId);
  add('EMERGENCY', c.activeEmergencyEncounterId);
  const arrays: Array<[string, unknown]> = [
    ['OPD', c.activeOpdEncounterIds], ['TELEHEALTH', c.activeTelehealthEncounterIds],
  ];
  for (const [domain, value] of arrays) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      blockers.push({
        source: 'ACTIVE_CARE_POINTER', domain, status: 'POINTER_MALFORMED',
        detail: 'Care pointer is malformed. Authoritative reconciliation is required.',
      });
      continue;
    }
    for (const id of value) {
      if (typeof id === 'string' && id.trim()) add(domain, id);
      else blockers.push({
        source: 'ACTIVE_CARE_POINTER', domain, status: 'POINTER_MALFORMED',
        detail: 'Encounter pointer is not a valid string. Authoritative reconciliation is required.',
      });
    }
  }
  return blockers;
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
    if ((patient.tenantId && patient.tenantId !== context.tenantId) ||
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
    const byEncounter = new Map(encounters.map(e => [e.encounterId, e]));
    // Do not hide stale pointers: even a terminal encounter is still blocked
    // if the patient's active-care reference was not safely reconciled.
    const blockers = [
      ...encounters,
      ...pointers.map(p => {
        const matched = p.encounterId ? byEncounter.get(p.encounterId) : undefined;
        return matched ? {
          ...p, status: matched.status,
          detail: 'Unresolved encounter and active patient pointer. Complete the governed clinical disposition.',
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
