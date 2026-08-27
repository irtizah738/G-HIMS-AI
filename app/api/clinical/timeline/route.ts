import { NextRequest, NextResponse } from 'next/server';
import { TimelineProjector } from '@/lib/clinical/projections/timeline';
import { createClinicalEventEnvelope } from '@/lib/clinical/events/envelope';
import { ClinicalEventEnvelope } from '@/types/clinical-workflow';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patientId, patientMrn, patientName, encounterId, encounterType, events = [] } = body;

    if (!patientId || !encounterId) {
      return NextResponse.json(
        { success: false, error: 'patientId and encounterId are required.' },
        { status: 400 }
      );
    }

    const projection = TimelineProjector.project({
      patientId,
      patientMrn: patientMrn || 'MRN-PENDING',
      patientName: patientName || 'Patient',
      encounterId,
      encounterType: encounterType || 'OPD_GENERAL',
      events: events as ClinicalEventEnvelope[],
    });

    return NextResponse.json({
      success: true,
      projection,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
