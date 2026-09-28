import { NextRequest, NextResponse } from 'next/server';
import { crosswalkIcd10Flow } from '@/lib/ai/flows/icn10-crosswalk';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AIDraftRepository } from '@/server/ai/ai-draft-repository';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId || (!body.clinicalSummary && !body.primaryDiagnosis)) {
      return NextResponse.json({ error: 'tenantId and clinical summary or primary diagnosis are required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const input = {
      clinicalSummary: String(body.clinicalSummary || ''),
      primaryDiagnosis: String(body.primaryDiagnosis || ''),
    };

    const result = await crosswalkIcd10Flow.run(input);
    const draft = await AIDraftRepository.create(context, {
      purpose: 'ICD10_CODING_DRAFT',
      patientId: body.patientId ? String(body.patientId) : undefined,
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
    const message = error instanceof Error ? error.message : 'Failed to crosswalk ICD-10 codes';
    const unauthorized = /AUTH|TENANT|UNAUTH|SESSION|DEVICE/i.test(message);
    const unavailable = /AI_|DRAFT_STORE/i.test(message);
    return NextResponse.json(
      { error: unavailable ? 'AI_UNAVAILABLE' : message, message },
      { status: unauthorized ? 403 : unavailable ? 503 : 500 }
    );
  }
}
