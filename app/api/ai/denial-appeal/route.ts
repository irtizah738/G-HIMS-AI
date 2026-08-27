import { NextRequest, NextResponse } from 'next/server';
import { generateDenialAppealFlow } from '@/lib/ai/flows/denial-appeal';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      claimId,
      denialReasonCode,
      denialDescription,
      patientDemographics,
      clinicalProcedure,
      doctorAttestation,
      tenantId,
    } = body;

    if (!claimId || !denialReasonCode) {
      return NextResponse.json(
        { error: 'Claim ID and Denial Reason Code are required.' },
        { status: 400 }
      );
    }

    const result = await generateDenialAppealFlow.run(
      {
        claimId,
        denialReasonCode,
        denialDescription: denialDescription || 'Medical Necessity Denial',
        patientDemographics: patientDemographics || {},
        clinicalProcedure: clinicalProcedure || 'Inpatient Hospital Services',
        doctorAttestation: doctorAttestation || 'Attending physician confirms clinical necessity.',
      },
      { tenantId }
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in Denial Appeal route:', error);
    return NextResponse.json(
      { error: 'Failed to generate denial appeal letter', message: error?.message },
      { status: 500 }
    );
  }
}
