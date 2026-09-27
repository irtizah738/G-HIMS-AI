import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const noteText = String(body.noteText || '');
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || !noteText.trim()) {
      return NextResponse.json({ error: 'tenantId and clinical note text are required' }, { status: 400 });
    }

    await deriveAuthoritativeContext(req, tenantId);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI_UNAVAILABLE' }, { status: 503 });
    }

    for (const modelName of ['gemini-3.6-flash', 'gemini-3.7-flash']) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: modelName,
          contents: `Analyze only the supplied clinician-authored note and context. Do not invent unsupported diagnoses, orders, medications, or codes.
Patient context: ${JSON.stringify(body.patientContext || {})}
Clinical note: ${noteText}
Return JSON with chiefComplaint, diagnoses, medicationsPrescribed, recommendedProcedures, billingCodes, followUpDays, clinicalAlerts.`,
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
      { error: 'AI_UNAVAILABLE', message: 'No clinical fallback content was generated.' },
      { status: 503 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI copilot failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
