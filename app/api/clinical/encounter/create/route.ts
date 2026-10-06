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

    const idempotencyKey = String(
      req.headers.get('idempotency-key') || body.idempotencyKey || ''
    ).trim();

    if (!idempotencyKey) {
      return NextResponse.json(
        {
          success: false,
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          error:
            'Patient registration requires a stable idempotency key. Reuse the same key when retrying the same registration request.',
        },
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

    const allowedConsentTypes = new Set(['GENERAL_OUTPATIENT', 'DATA_SHARING_HIE']);
    const consentDecisions = Array.isArray(body.consentDecisions)
      ? body.consentDecisions.map((raw: any) => ({
          consentType: String(raw?.consentType || '').trim().toUpperCase(),
          status: String(raw?.status || '').trim().toUpperCase(),
          method: String(raw?.method || '').trim().toUpperCase(),
        }))
      : [];

    for (const decision of consentDecisions) {
      if (
        !allowedConsentTypes.has(decision.consentType) ||
        !['GRANTED', 'WITHHELD'].includes(decision.status) ||
        decision.method !== 'DIGITAL_ATTESTATION'
      ) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_REGISTRATION_CONSENT',
            error: 'Registration consent decisions must use supported consent types, explicit status and DIGITAL_ATTESTATION.',
          },
          { status: 400 }
        );
      }
    }

    const generalConsent = consentDecisions.find(
      (decision: any) => decision.consentType === 'GENERAL_OUTPATIENT'
    );
    if (!generalConsent) {
      return NextResponse.json(
        {
          success: false,
          code: 'GENERAL_OPD_CONSENT_DECISION_REQUIRED',
          error: 'An explicit General OPD Care consent decision is required at registration.',
        },
        { status: 400 }
      );
    }

    if (generalConsent.status !== 'GRANTED') {
      return NextResponse.json(
        {
          success: false,
          code: 'GENERAL_OPD_CONSENT_REQUIRED',
          error:
            'This command creates an OPD encounter and queue token; General OPD Care consent must be granted before that care workflow can be opened.',
        },
        { status: 409 }
      );
    }

    const requestedEncounterType = String(body.encounterType || 'OPD').trim().toUpperCase();
    const requestedTariffPlan = String(body.tariffPlan || '').trim().toUpperCase();
    const allowedTariffPlans = new Set([
      'OUT_OF_POCKET',
      'CORPORATE_PPO',
      'SEHAT_CARD_UNIVERSAL',
      'STATE_INSURANCE',
    ]);

    if (!allowedTariffPlans.has(requestedTariffPlan)) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_TARIFF_PLAN',
          error: 'A supported tariff plan is required for OPD encounter registration.',
        },
        { status: 400 }
      );
    }

    if (requestedEncounterType === 'OPD' && requestedTariffPlan !== 'OUT_OF_POCKET') {
      return NextResponse.json(
        {
          success: false,
          code: 'OPD_PILOT_PAYER_NOT_SUPPORTED',
          error:
            'The controlled OPD pilot currently supports OUT_OF_POCKET cash billing only.',
        },
        { status: 409 }
      );
    }

    const authorizedFacilityIds = Array.from(
      new Set(
        (context.facilityIds || [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
    const requestedFacilityId = String(body.facilityId || '').trim();
    let facilityId = requestedFacilityId;

    if (requestedFacilityId) {
      if (!authorizedFacilityIds.includes(requestedFacilityId)) {
        return NextResponse.json(
          {
            success: false,
            code: 'FACILITY_ACCESS_DENIED',
            error:
              'Requested registration facility is outside the authenticated staff facility scope.',
          },
          { status: 403 }
        );
      }
    } else if (authorizedFacilityIds.length === 1) {
      facilityId = authorizedFacilityIds[0];
    } else {
      return NextResponse.json(
        {
          success: false,
          code: 'FACILITY_SELECTION_REQUIRED',
          error:
            'OPD registration requires one authoritative facility. Select an authorized facility when the staff account spans multiple facilities.',
        },
        { status: 400 }
      );
    }

    const departmentId = String(
      body.departmentId || body.department || 'General Medicine'
    ).trim();
    if (!departmentId) {
      return NextResponse.json(
        {
          success: false,
          code: 'DEPARTMENT_REQUIRED',
          error: 'A target clinical department is required for OPD registration.',
        },
        { status: 400 }
      );
    }

    const normalizedParams: RegisterPatientEncounterParams = {
      tenantId: context.tenantId,
      commandId: String(body.commandId || `cmd_${crypto.randomUUID()}`),
      idempotencyKey,
      patientId: body.patientId,
      fullName,
      gender,
      dateOfBirth: String(body.dateOfBirth || body.dob),
      identifiers,
      contactPhone: String(body.contactPhone || body.phone),
      address: String(body.address),
      encounterType: body.encounterType || 'OPD',
      facilityId,
      departmentId,
      department: body.department || departmentId,
      priority: body.priority || 'ROUTINE',
      chiefComplaint: body.chiefComplaint || '',
      assignedDoctor: body.assignedDoctor || body.attendingPhysicianName || '',
      actorId: context.actorId,
      actorRole: context.roles[0] || 'AUTHENTICATED_USER',
      actorName: context.actorId,
      bloodGroup: body.bloodGroup,
      allergies: Array.isArray(body.allergies) ? body.allergies : [],
      chronicConditions: Array.isArray(body.chronicConditions) ? body.chronicConditions : undefined,
      tariffPlan: body.tariffPlan,
      insuranceDetails:
        body.insuranceDetails && typeof body.insuranceDetails === 'object'
          ? {
              payerName: body.insuranceDetails.payerName
                ? String(body.insuranceDetails.payerName).trim()
                : undefined,
              policyNumber: body.insuranceDetails.policyNumber
                ? String(body.insuranceDetails.policyNumber).trim()
                : undefined,
              memberId: body.insuranceDetails.memberId
                ? String(body.insuranceDetails.memberId).trim()
                : undefined,
            }
          : undefined,
      consentDecisions: consentDecisions as RegisterPatientEncounterParams['consentDecisions'],
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
        queueToken: result.queueToken,
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
