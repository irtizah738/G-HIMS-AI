import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import type { TelehealthSession } from '@/lib/types/ghims';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store, private' };
function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

/**
 * Recover after a successful signature followed by a failed session completion
 * or browser reload. Read-only: this endpoint cannot sign or alter care state.
 * Only the current author can reuse an exact-content signed SOAP note.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!/^[a-z0-9_-]{3,128}$/.test(tenantId) || !sessionId ||
        sessionId.length > 150 || content.length < 3 || content.length > 100_000) {
      return fail('TELEHEALTH_COMPLETION_PREFLIGHT_INVALID', 400);
    }
    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const roles = context.roles.map(role => String(role).toUpperCase());
    const privileges = (context.clinicalPrivileges || []).map(p => String(p).toUpperCase());
    if (!roles.some(role => role === 'DOCTOR' || role === 'CONSULTANT') ||
        !privileges.some(p => p === 'SIGN_CLINICAL_NOTES' || p === 'UNRESTRICTED_CLINICAL_CHIEF')) {
      return fail('TELEHEALTH_SIGNING_PRIVILEGE_REQUIRED', 403);
    }
    const db = getAdminFirestore();
    if (!db) return fail('TELEHEALTH_COMPLETION_PREFLIGHT_STORE_UNAVAILABLE', 503);
    const tenant = db.collection('tenants').doc(tenantId);
    const snapshot = await tenant.collection('telehealthSessions').doc(sessionId).get();
    const session = snapshot.data() as TelehealthSession | undefined;
    if (!session || !session.encounterId || !session.patientId ||
        (session.tenantId && session.tenantId !== tenantId)) {
      return fail('TELEHEALTH_SESSION_NOT_FOUND', 404);
    }
    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return fail('TELEHEALTH_SESSION_FINAL', 409);
    }
    const encounter = await tenant.collection('encounters').doc(session.encounterId).get();
    if (!encounter.exists || encounter.data()?.patientId !== session.patientId ||
        String(encounter.data()?.encounterType || encounter.data()?.type || '').toUpperCase() !== 'TELEHEALTH') {
      return fail('TELEHEALTH_ENCOUNTER_SCOPE_INVALID', 409);
    }
    const assigned = String(encounter.data()?.assignedProviderId || '');
    if (!assigned || assigned !== context.actorId) {
      return fail('TELEHEALTH_SIGNING_ASSIGNMENT_MISMATCH', 403);
    }
    // Bounded single-field query avoids requiring an unregistered composite
    // Firestore index. Never treat a truncated scan as proof of no evidence.
    const evidence = await tenant.collection('encounterEvidence')
      .where('encounterId', '==', session.encounterId).limit(101).get();
    if (evidence.size > 100) {
      return fail('TELEHEALTH_SIGNED_EVIDENCE_REVIEW_REQUIRED', 409);
    }
    const signed = evidence.docs.filter(doc => {
      const v = doc.data();
      return v.evidenceType === 'SIGNED_CLINICAL_NOTE' &&
        v.status === 'FINAL' && v.category === 'SOAP' &&
        typeof v.content === 'string' &&
        v.content.startsWith('[TELEHEALTH VIRTUAL CONSULTATION RECORD]') &&
        v.patientId === session.patientId;
    });
    // A note from a different signer, or a changed note after partial commit,
    // requires governed clinician review, never an automatic second signature.
    if (signed.some(doc => doc.data().signedBy !== context.actorId ||
        doc.data().content !== content) || signed.length > 1) {
      return fail('TELEHEALTH_SIGNED_EVIDENCE_REVIEW_REQUIRED', 409);
    }
    return NextResponse.json({
      signedEvidenceId: signed.length === 1 ? signed[0].data().evidenceId || signed[0].id : null,
    }, { headers: HEADERS });
  } catch {
    return fail('TELEHEALTH_COMPLETION_PREFLIGHT_FAILED', 403);
  }
}
