import { NextRequest, NextResponse } from 'next/server';
import { registerPatientAndEncounter, RegisterPatientEncounterParams } from '@/lib/runtime/registration-orchestrator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support both formats (direct RegisterPatientEncounterParams and legacy form payload)
    const fullName =
      body.fullName ||
      (body.firstName && body.lastName ? `${body.firstName} ${body.lastName}`.trim() : body.firstName || 'Anonymous Patient');

    const gender = (body.gender?.toLowerCase() === 'male' || body.gender === 'male'
      ? 'male'
      : body.gender?.toLowerCase() === 'female' || body.gender === 'female'
      ? 'female'
      : 'other') as 'male' | 'female' | 'other' | 'unknown';

    const identifiers = body.identifiers || [];
    if (body.nationalId && !identifiers.some((i: any) => i.value === body.nationalId)) {
      identifiers.push({ type: 'CNIC', value: body.nationalId, issuer: 'National Registry' });
    }
    if (body.phone && !identifiers.some((i: any) => i.value === body.phone)) {
      identifiers.push({ type: 'PHONE', value: body.phone, issuer: 'Telecom' });
    }

    const normalizedParams: RegisterPatientEncounterParams = {
      tenantId: body.tenantId || 'metro_general',
      patientId: body.patientId,
      fullName,
      gender,
      dateOfBirth: body.dateOfBirth || body.dob || '1990-01-01',
      identifiers,
      contactPhone: body.contactPhone || body.phone || '+1 (555) 000-0000',
      address: body.address || 'Central District, Metropolitan City',
      encounterType: body.encounterType || 'OPD',
      department: body.department || 'General Medicine',
      priority: body.priority || 'ROUTINE',
      chiefComplaint: body.chiefComplaint || 'Consultation intake',
      assignedDoctor: body.assignedDoctor || body.attendingPhysicianName || 'Dr. Sarah Al-Mansoor, MD',
      actorId: body.actorId || body.initiatorUserId || 'staff-registrar-01',
      actorRole: body.actorRole || body.initiatorUserRole || 'receptionist',
      actorName: body.actorName || body.initiatorUserName || 'Front Desk Staff',
      bloodGroup: body.bloodGroup || 'O+',
      allergies: body.allergies || [],
      chronicConditions: body.chronicConditions || [],
    };

    const result = await registerPatientAndEncounter(normalizedParams);

    // Return data bundled with queueToken & patient aliases for backwards-compatibility
    const responsePayload = {
      ...result,
      initialStage: {
        id: result.workflowSnapshot?.currentStageId || 'REGISTRATION',
        stageType: result.workflowSnapshot?.currentStageId || 'REGISTRATION',
        status: 'ACTIVE',
      },
      outboxEventsCount: result.outboxEvent ? 1 : 0,
      queueToken: {
        tokenNumber: result.encounter.tokenNumber || 'OPD-101',
        department: result.encounter.department,
        patientMrn: result.patient.mrn,
        patientName: result.patient.fullName,
      },
    };

    return NextResponse.json({ success: true, data: responsePayload });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('API /api/clinical/encounter/create Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
