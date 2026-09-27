import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { ClinicalNoteParseInputSchema } from '@/schemas/clinical-billing';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedInput = ClinicalNoteParseInputSchema.safeParse(body);

    if (!parsedInput.success) {
      return NextResponse.json({ error: 'Invalid input format', details: parsedInput.error }, { status: 400 });
    }

    const tenantId = String((body as any).tenantId || '').trim().toLowerCase();
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    await deriveAuthoritativeContext(req, tenantId);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI_UNAVAILABLE', message: 'Clinical note extraction is not configured in this environment.' },
        { status: 503 }
      );
    }

    const { rawNote } = parsedInput.data;
    const candidateModels = ['gemini-3.6-flash', 'gemini-3.7-flash'];

    for (const modelName of candidateModels) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Extract structured clinical information from the clinician-authored note below.
Return JSON only:
{
  "chiefComplaint": "string",
  "diagnoses": ["string"],
  "medicationsPrescribed": ["string"],
  "recommendedProcedures": ["string"],
  "followUpDays": number,
  "billingCodes": [{"code":"string","description":"string","fee":number,"category":"string"}],
  "summary": "string"
}

Do not invent facts that are absent from the source note. Use empty arrays/null-like omissions where information is unsupported.

Clinical note:
${rawNote}`;

        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { responseMimeType: 'application/json', temperature: 0 },
        });

        const cleaned = (response.text || '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const structured = JSON.parse(cleaned);

        return NextResponse.json({
          status: 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
          structured,
          model: modelName,
        });
      } catch {
        // Try the next configured provider model.
      }
    }

    return NextResponse.json(
      { error: 'AI_UNAVAILABLE', message: 'Clinical note extraction failed. No fallback clinical content was generated.' },
      { status: 503 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clinical note extraction failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
