import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import { Edi837Generator } from '@/lib/interop/edi-837-generator';
import { emitOperationalEvent, operationalTimer } from '@/lib/observability/server-telemetry';

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const elapsed = operationalTimer();
  const tenantId = String(req.headers.get('x-ghims-tenant-id') || '')
    .trim()
    .toLowerCase();
  const correlationId = req.headers.get('x-correlation-id') || `corr_${crypto.randomUUID()}`;
  const requestId = req.headers.get('x-request-id') || `req_${crypto.randomUUID()}`;

  if (getServerIntegrationState('EDI_X12') !== 'LIVE') {
    return NextResponse.json({ error: 'EDI integration is not LIVE.' }, { status: 503 });
  }
  if (String(process.env.GHIMS_EDI_PROGRAM_ENABLED || '').toLowerCase() !== 'true') {
    return NextResponse.json({ error: 'EDI program is not intentionally enabled.' }, { status: 503 });
  }
  if (
    String(process.env.GHIMS_EDI_EXTERNAL_CONFORMANCE_QUALIFIED || '').toLowerCase() !== 'true'
  ) {
    return NextResponse.json(
      { error: 'External EDI conformance qualification is not recorded.' },
      { status: 503 }
    );
  }

  const expectedKey = String(process.env.GHIMS_EDI_835_INGEST_API_KEY || '').trim();
  const providedKey = String(req.headers.get('x-api-key') || '').trim();
  if (!expectedKey || !providedKey || !safeEqual(providedKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized remittance source.' }, { status: 401 });
  }
  if (!tenantId) {
    return NextResponse.json({ error: 'x-ghims-tenant-id is required.' }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: 'Authoritative integration store unavailable.' }, { status: 503 });
  }

  try {
    const rawBody = (await req.text()).trim();
    if (!rawBody) return NextResponse.json({ error: 'Empty 835 payload.' }, { status: 400 });

    const rawSha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
    const advice = Edi837Generator.parse835(rawBody);
    if (!advice.checkNumber || advice.claims.length === 0) {
      return NextResponse.json({ error: 'EDI_835_REQUIRED_FIELDS_MISSING' }, { status: 422 });
    }

    const documentId = 'edi835_' + rawSha256;
    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('ediRemittanceInbox')
      .doc(documentId);

    const existing = await ref.get();
    if (existing.exists) {
      return NextResponse.json({
        success: true,
        replayed: true,
        remittanceInboxId: documentId,
        status: existing.data()?.status || 'REQUIRES_RECONCILIATION',
      });
    }

    const now = Date.now();
    await ref.create({
      remittanceInboxId: documentId,
      tenantId,
      source: 'EDI_835',
      rawSha256,
      receivedAt: now,
      payerName: advice.payerName,
      checkNumber: advice.checkNumber,
      paymentMethod: advice.paymentMethod,
      totalPaidAmount: advice.totalPaidAmount,
      paymentDate: advice.paymentDate,
      payeeNpi: advice.payeeNpi,
      claims: advice.claims,
      status: 'REQUIRES_RECONCILIATION',
      reconciliationReason: 'EXTERNAL_REMITTANCE_NOT_AUTO_POSTED',
      correlationId,
      requestId,
      ...(process.env.GHIMS_EDI_RETAIN_RAW === 'true'
        ? { raw835: rawBody }
        : {}),
    });

    emitOperationalEvent({
      event: 'interop.edi835_receive',
      outcome: 'SUCCESS',
      tenantId,
      correlationId,
      requestId,
      durationMs: elapsed(),
      attributes: {
        claimCount: advice.claims.length,
        remittanceInboxId: documentId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        replayed: false,
        remittanceInboxId: documentId,
        status: 'REQUIRES_RECONCILIATION',
      },
      { status: 202 }
    );
  } catch (error) {
    emitOperationalEvent({
      event: 'interop.edi835_receive',
      outcome: 'FAILURE',
      tenantId,
      correlationId,
      requestId,
      durationMs: elapsed(),
      errorCode: 'EDI_835_INGEST_FAILURE',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'EDI 835 ingestion failed.' },
      { status: 422 }
    );
  }
}
