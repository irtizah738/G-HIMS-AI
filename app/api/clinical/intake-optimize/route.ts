import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import {
  IntakePayloadError,
  parseSourceLimitedBrief,
  readBoundedIntakeRequest,
} from '@/lib/clinical/intelligence/source-limited-intake-brief';

export async function POST(req: NextRequest) {
  try {
    const body = await readBoundedIntakeRequest(req);
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    await deriveAuthoritativeContext(req, tenantId);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI_UNAVAILABLE', message: 'Clinical optimization AI is not configured.' },
        { status: 503 }
      );
    }

    const prompt = `You are a clinical information organization assistant. Use only the supplied source data.
Do not invent diagnoses, medications, orders, probabilities, guidelines, or billing codes.
Do not act as an autonomous diagnostic or treatment authority.
Return strict JSON containing:
{
  "executiveSummary": "string",
  "sbar": {"situation":"string","background":"string","assessment":"string","recommendation":"string"},
  "observedRiskSignals": ["string"],
  "missingOrUnverifiedInformation": ["string"],
  "sourceLimited": true
}

Patient context:
${JSON.stringify(body.patientContext || {}, null, 2)}

Guided answers:
${JSON.stringify(body.guidedAnswers || {}, null, 2)}

Specialty history:
${JSON.stringify(body.specialtyHistory || {}, null, 2)}

Risk signals supplied by G-HIMS:
${JSON.stringify(body.riskSignals || {}, null, 2)}`;

    for (const modelName of ['gemini-3.6-flash', 'gemini-3.7-flash']) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { responseMimeType: 'application/json', temperature: 0 },
        });

        const result = parseSourceLimitedBrief(response.text || '');
        if (!result) continue; // No unchecked model JSON may reach clinicians.
        return NextResponse.json({
          status: 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
          model: modelName,
          ...result,
        });
      } catch {
        // Try next model.
      }
    }

    return NextResponse.json(
      { error: 'AI_UNAVAILABLE', message: 'No fallback clinical recommendations were generated.' },
      { status: 503 }
    );
  } catch (error) {
    if (error instanceof IntakePayloadError)
      return NextResponse.json({ error: error.code }, { status: error.status });
    const unauthorized = error instanceof Error && /AUTH|TENANT|UNAUTH/i.test(error.message);
    return NextResponse.json(
      { error: unauthorized ? 'CLINICAL_INTAKE_ACCESS_DENIED' : 'CLINICAL_INTAKE_UNAVAILABLE' },
      { status: unauthorized ? 403 : 500 },
    );
  }
}
