import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { z } from 'zod';

const sourceLimitedBriefSchema = z.object({
  executiveSummary: z.string().min(1).max(4000),
  sbar: z.object({
    situation: z.string().min(1).max(2000),
    background: z.string().min(1).max(3000),
    assessment: z.string().min(1).max(3000),
    recommendation: z.string().min(1).max(3000),
  }).strict(),
  observedRiskSignals: z.array(z.string().min(1).max(1000)).max(30),
  missingOrUnverifiedInformation: z.array(z.string().min(1).max(1000)).max(30),
  sourceLimited: z.literal(true),
}).strict();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

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

        const result = JSON.parse((response.text || '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
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
    const message = error instanceof Error ? error.message : 'Clinical intelligence request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
