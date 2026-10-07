import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import type { EmergencyPrearrivalTelemetryRecord } from '@/types/emergency-prearrival';

const EMERGENCY_READ_ROLES = new Set([
  'SYSTEM_ADMIN',
  'ADMIN',
  'ADMINISTRATOR',
  'DOCTOR',
  'PHYSICIAN',
  'CONSULTANT',
  'ATTENDING_PHYSICIAN',
  'NURSE',
  'HEAD_NURSE',
]);

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    const patientId = String(req.nextUrl.searchParams.get('patientId') || '').trim();
    const encounterId = String(req.nextUrl.searchParams.get('encounterId') || '').trim();

    if (!tenantId || !patientId || !encounterId) {
      return NextResponse.json({ error: 'tenantId, patientId and encounterId are required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const roles = context.roles.map((role) => String(role || '').trim().toUpperCase());
    if (!roles.some((role) => EMERGENCY_READ_ROLES.has(role))) {
      return NextResponse.json({ error: 'EMERGENCY_TELEMETRY_READ_DENIED' }, { status: 403 });
    }

    const [patient, encounter] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(tenantId, 'patients', patientId),
      DomainStateRepository.getById<Record<string, unknown>>(tenantId, 'encounters', encounterId),
    ]);
    if (!patient || !encounter || String(encounter.patientId || '') !== patientId) {
      return NextResponse.json({ error: 'Patient encounter scope not found.' }, { status: 404 });
    }
    assertPatient360PatientAccess(context, patient, encounter);

    const records = await DomainStateRepository.queryEqual<EmergencyPrearrivalTelemetryRecord>(
      tenantId,
      'preArrivalTelemetryRecords',
      'encounterId',
      encounterId,
      101
    );
    if (records.length > 100) {
      return NextResponse.json({ error: 'EMERGENCY_TELEMETRY_READ_LIMIT_EXCEEDED' }, { status: 409 });
    }

    return NextResponse.json({
      tenantId,
      patientId,
      encounterId,
      generatedAt: Date.now(),
      records: records
        .filter((record) => record.patientId === patientId)
        .sort((a, b) => b.deviceTimestamp - a.deviceTimestamp),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Emergency telemetry read failed.';
    return NextResponse.json(
      { error: message },
      { status: /ACCESS|DENIED|AUTH|TENANT|SESSION/i.test(message) ? 403 : 500 }
    );
  }
}
