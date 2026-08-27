import { NextRequest, NextResponse } from 'next/server';
import { draftSoapNoteFlow } from '@/lib/ai/flows/soap-drafter';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patientId, chiefComplaint, vitals, doctorNotes, labResults, tenantId } = body;

    if (!chiefComplaint && !doctorNotes) {
      return NextResponse.json(
        { error: 'Chief complaint or doctor clinical notes are required.' },
        { status: 400 }
      );
    }

    const result = await draftSoapNoteFlow.run(
      {
        patientId: patientId || 'PT-UNKNOWN',
        chiefComplaint: chiefComplaint || 'Clinical evaluation',
        vitals: vitals || {},
        doctorNotes: doctorNotes || '',
        labResults: Array.isArray(labResults) ? labResults : [],
      },
      { tenantId }
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in SOAP Drafter route:', error);
    return NextResponse.json(
      { error: 'Failed to generate SOAP note', message: error?.message },
      { status: 500 }
    );
  }
}
