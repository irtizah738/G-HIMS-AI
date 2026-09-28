import { NextRequest, NextResponse } from 'next/server';
import { draftSoapNoteFlow } from '@/lib/ai/flows/soap-drafter';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AIDraftRepository } from '@/server/ai/ai-draft-repository';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId || (!body.chiefComplaint && !body.doctorNotes)) {
      return NextResponse.json({ error: 'tenantId and chief complaint or doctor clinical notes are required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const input = {
      patientId: String(body.patientId || 'PT-UNKNOWN'),
      chiefComplaint: String(body.chiefComplaint || ''),
      vitals: body.vitals && typeof body.vitals === 'object' ? body.vitals : {},
      doctorNotes: String(body.doctorNotes || ''),
      labResults: Array.isArray(body.labResults) ? body.labResults.map(String) : [],
    };

    const result = await draftSoapNoteFlow.run(input);
    const draft = await AIDraftRepository.create(context, {
      purpose: 'CLINICAL_SOAP_DRAFT',
      patientId: input.patientId !== 'PT-UNKNOWN' ? input.patientId : undefined,
      encounterId: body.encounterId ? String(body.encounterId) : undefined,
      sourceEvidenceIds: Array.isArray(body.sourceEvidenceIds) ? body.sourceEvidenceIds.map(String) : [],
      input,
      output: result,
      provenance: result.aiProvenance,
    });

    return NextResponse.json({
      status: draft.status,
      draftId: draft.draftId,
      result: { ...result, draftId: draft.draftId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate SOAP draft';
    const unauthorized = /AUTH|TENANT|UNAUTH|SESSION|DEVICE/i.test(message);
    const unavailable = /AI_|DRAFT_STORE/i.test(message);
    return NextResponse.json(
      { error: unavailable ? 'AI_UNAVAILABLE' : message, message },
      { status: unauthorized ? 403 : unavailable ? 503 : 500 }
    );
  }
}
