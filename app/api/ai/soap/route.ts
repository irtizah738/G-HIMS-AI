import { NextRequest, NextResponse } from 'next/server';
import { draftSoapNoteFlow } from '@/lib/ai/flows/soap-drafter';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || (!body.chiefComplaint && !body.doctorNotes)) {
      return NextResponse.json(
        { error: 'tenantId and chief complaint or doctor clinical notes are required.' },
        { status: 400 }
      );
    }

    await deriveAuthoritativeContext(req, tenantId);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI_UNAVAILABLE' }, { status: 503 });
    }

    const result = await draftSoapNoteFlow.run(
      {
        patientId: body.patientId || 'PT-UNKNOWN',
        chiefComplaint: body.chiefComplaint || '',
        vitals: body.vitals || {},
        doctorNotes: body.doctorNotes || '',
        labResults: Array.isArray(body.labResults) ? body.labResults : [],
      },
      { tenantId }
    );

    return NextResponse.json({
      status: 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate SOAP draft';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
