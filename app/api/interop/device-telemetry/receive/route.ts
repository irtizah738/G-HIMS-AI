import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import type { RawTelemetryPacket } from '@/lib/interop/device-telemetry-adapter';
import { EmergencyPrearrivalDomainService } from '@/lib/backend/services/emergency-prearrival-domain-service';
import { emitOperationalEvent, operationalTimer } from '@/lib/observability/server-telemetry';

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const elapsed = operationalTimer();
  const correlationId = req.headers.get('x-correlation-id') || `corr_${crypto.randomUUID()}`;
  const requestId = req.headers.get('x-request-id') || `req_${crypto.randomUUID()}`;
  const tenantId = String(req.headers.get('x-ghims-tenant-id') || '').trim().toLowerCase();
  const expectedKey = String(process.env.GHIMS_DEVICE_TELEMETRY_INGEST_API_KEY || '').trim();
  const providedKey = String(req.headers.get('x-api-key') || '').trim();
  const deviceCredential = String(req.headers.get('x-device-key') || '').trim();
  const declaredDeviceId = String(req.headers.get('x-device-id') || '').trim();

  if (getServerIntegrationState('DEVICE_TELEMETRY') !== 'LIVE') {
    return NextResponse.json({ error: 'Device telemetry integration is not LIVE.' }, { status: 503 });
  }
  if (!expectedKey) {
    return NextResponse.json({ error: 'Device telemetry ingestion credential is not configured.' }, { status: 503 });
  }
  if (!providedKey || !safeEqual(providedKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized integration source.' }, { status: 401 });
  }
  if (!tenantId || !deviceCredential || !declaredDeviceId) {
    return NextResponse.json(
      { error: 'x-ghims-tenant-id, x-device-id and x-device-key are required.' },
      { status: 400 }
    );
  }

  try {
    const rawPacket = (await req.json()) as RawTelemetryPacket;
    if (String(rawPacket?.deviceId || '').trim() !== declaredDeviceId) {
      return NextResponse.json({ error: 'Device identity header/body mismatch.' }, { status: 400 });
    }

    const result = await EmergencyPrearrivalDomainService.ingestProductionTelemetry(
      {
        tenantId,
        actorId: `integration:device-telemetry:${declaredDeviceId}`,
        correlationId,
        requestId,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
        userAgent: req.headers.get('user-agent') || 'DEVICE-TELEMETRY-INTEGRATION',
      },
      rawPacket,
      deviceCredential
    );

    emitOperationalEvent({
      event: 'interop.device_telemetry_receive',
      outcome: result.success ? 'SUCCESS' : 'REJECTED',
      tenantId,
      correlationId,
      requestId,
      durationMs: elapsed(),
      errorCode: result.error?.code,
      attributes: {
        deviceId: declaredDeviceId,
        replayed: Boolean(result.replayed),
      },
    });

    if (!result.success) {
      const code = result.error?.code || 'TELEMETRY_REJECTED';
      const status =
        /CREDENTIAL|AUTH/.test(code) ? 401 :
        /NOT_LIVE|STORE|COMMIT/.test(code) ? 503 :
        /CONFLICT|REPLAY/.test(code) ? 409 : 422;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(
      {
        success: true,
        replayed: Boolean(result.replayed),
        telemetryId: result.telemetry?.telemetryId,
        encounterId: result.telemetry?.encounterId,
        reviewStatus: result.telemetry?.reviewStatus,
      },
      { status: result.replayed ? 200 : 202 }
    );
  } catch (error) {
    emitOperationalEvent({
      event: 'interop.device_telemetry_receive',
      outcome: 'FAILURE',
      tenantId,
      correlationId,
      requestId,
      durationMs: elapsed(),
      errorCode: 'TELEMETRY_REQUEST_FAILURE',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Telemetry request failed.' },
      { status: 500 }
    );
  }
}
