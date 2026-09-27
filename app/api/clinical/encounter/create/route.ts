import { NextRequest, NextResponse } from 'next/server';
import { registerPatientAndEncounter, RegisterPatientEncounterParams } from '@/server/runtime/registration-orchestrator';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || !body.dateOfBirth && !body.dob || !body.contactPhone && !body.phone || !body.address) {
      return NextResponse.json(
        { success: false, error: 'tenantId, dateOfBirth, contactPhone and address are required.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const registrationAuth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['RECEPTIONIST', 'REGISTRAR', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!registrationAuth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: registrationAuth.reason || 'Front-desk registration authority required.',
          code: registrationAuth.code || 'INSUFFICIENT_ROLE',
        },
        { status: 403 }
      );
    }

    const fullName =
      body.fullName ||
      (body.firstName && body.lastName
        ? `${body.firstName} ${body.lastName}`.trim()
        : body.firstName || '');

    if (!fullName) {
      return NextResponse.json({ success: false, error: 'Patient full name is required.' }, { status: 400 });
    }

    const gender = (
      body.gender?.toLowerCase() === 'male'
        ? 'male'
        : body.gender?.toLowerCase() === 'female'
          ? 'female'
          : body.gender?.toLowerCase() === 'unknown'
            ? 'unknown'
            : 'other'
    ) as 'male' | 'female' | 'other' | 'unknown';

    const identifiers = Array.isArray(body.identifiers) ? [...body.identifiers] : [];
    if (body.nationalId && !identifiers.some((i: any) => i.value === body.nationalId)) {
      identifiers.push({ type: 'CNIC', value: body.nationalId, issuer: 'National Registry' });
    }
    if (body.phone && !identifiers.some((i: any) => i.value === body.phone)) {
      identifiers.push({ type: 'PHONE', value: body.phone, issuer: 'Telecom' });
    }

    const normalizedParams: RegisterPatientEncounterParams = {
      tenantId: context.tenantId,
      commandId: String(body.commandId || `cmd_${crypto.randomUUID()}`),
      idempotencyKey: String(body.idempotencyKey || `idem_${crypto.randomUUID()}`),
      patientId: body.patientId,
      fullName,
      gender,
      dateOfBirth: String(body.dateOfBirth || body.dob),
      identifiers,
      contactPhone: String(body.contactPhone || body.phone),
      address: String(body.address),
      encounterType: body.encounterType || 'OPD',
      department: body.department || 'General Medicine',
      priority: body.priority || 'ROUTINE',
      chiefComplaint: body.chiefComplaint || '',
      assignedDoctor: body.assignedDoctor || body.attendingPhysicianName || '',
      actorId: context.actorId,
      actorRole: context.roles[0] || 'AUTHENTICATED_USER',
      actorName: context.actorId,
      bloodGroup: body.bloodGroup,
      allergies: Array.isArray(body.allergies) ? body.allergies : [],
      chronicConditions: Array.isArray(body.chronicConditions) ? body.chronicConditions : [],
    };

    const result = await registerPatientAndEncounter(normalizedParams);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        initialStage: {
          id: result.workflowSnapshot?.currentStageId || 'REGISTRATION',
          stageType: result.workflowSnapshot?.currentStageId || 'REGISTRATION',
          status: 'ACTIVE',
        },
        outboxEventsCount: result.outboxEvent ? 1 : 0,
        queueToken: {
          tokenNumber: result.encounter.tokenNumber,
          department: result.encounter.department,
          patientMrn: result.patient.mrn,
          patientName: result.patient.fullName,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Encounter creation failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json(
      { success: false, error: message },
      { status: unauthorized ? 403 : 400 }
    );
  }
}
