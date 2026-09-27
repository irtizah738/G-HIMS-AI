import { NextRequest, NextResponse } from 'next/server';
import { crosswalkIcd10Flow } from '@/lib/ai/flows/icn10-crosswalk';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || (!body.clinicalSummary && !body.primaryDiagnosis)) {
      return NextResponse.json(
        { error: 'tenantId and clinical summary or primary diagnosis are required.' },
        { status: 400 }
      );
    }

    await deriveAuthoritativeContext(req, tenantId);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI_UNAVAILABLE' }, { status: 503 });
    }

    const result = await crosswalkIcd10Flow.run(
      {
        clinicalSummary: body.clinicalSummary || '',
        primaryDiagnosis: body.primaryDiagnosis || '',
      },
      { tenantId }
    );

    return NextResponse.json({
      status: 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to crosswalk ICD-10 codes';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
