import { NextRequest, NextResponse } from 'next/server';
import { crosswalkIcd10Flow } from '@/lib/ai/flows/icn10-crosswalk';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clinicalSummary, primaryDiagnosis, tenantId } = body;

    if (!clinicalSummary && !primaryDiagnosis) {
      return NextResponse.json(
        { error: 'Clinical summary or primary diagnosis required for ICD-10 crosswalk.' },
        { status: 400 }
      );
    }

    const result = await crosswalkIcd10Flow.run(
      {
        clinicalSummary: clinicalSummary || '',
        primaryDiagnosis: primaryDiagnosis || 'Medical Condition',
      },
      { tenantId }
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in ICD-10 Crosswalk route:', error);
    return NextResponse.json(
      { error: 'Failed to crosswalk ICD-10 codes', message: error?.message },
      { status: 500 }
    );
  }
}
