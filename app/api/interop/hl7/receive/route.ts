import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseHL7, extractORU_R01, generateACK } from '@/lib/interop/hl7-parser';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import { emitOperationalEvent, operationalTimer } from '@/lib/observability/server-telemetry';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import type { BaseCommand, CommandContext } from '@/lib/backend/types';
import { TerminologyService } from '@/lib/clinical/terminology/terminology-service';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hl7TimestampToMs(value?: string): number {
  const raw = String(value || '').trim();
  if (!raw) return Date.now();

  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = match;
  const parsed = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function hl7ResultStatus(
  value?: string
): 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED' {
  switch (String(value || '').trim().toUpperCase()) {
    case 'P':
      return 'PRELIMINARY';
    case 'C':
      return 'CORRECTED';
    case 'A':
      return 'AMENDED';
    case 'F':
    default:
      return 'FINAL';
  }
}

function reportStatus(
  statuses: string[]
): 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED' {
  const normalized = statuses.map((item) => hl7ResultStatus(item));
  if (normalized.includes('CORRECTED')) return 'CORRECTED';
  if (normalized.includes('AMENDED')) return 'AMENDED';
  if (normalized.some((item) => item === 'PRELIMINARY')) return 'PRELIMINARY';
  return 'FINAL';
}

function unitCodeFor(sourceUnit?: string): string | undefined {
  const raw = String(sourceUnit || '').trim();
  if (!raw) return undefined;
  const direct = TerminologyService.lookup('UCUM', raw);
  if (direct) return direct.code;

  const match = TerminologyService.search(raw, { systems: ['UCUM'], limit: 1 })[0];
  return match?.score >= 90 ? match.concept.code : undefined;
}

function integrationContext(input: {
  tenantId: string;
  sendingApplication: string;
  correlationId?: string;
  requestId?: string;
  req: NextRequest;
}): CommandContext {
  return {
    actorId: `integration:hl7:${input.sendingApplication || 'unknown'}`,
    tenantId: input.tenantId,
    roles: ['INTEGRATION_SERVICE'],
    permissions: ['RECORD_DIAGNOSTIC_RESULT'],
    clinicalPrivileges: [],
    correlationId: input.correlationId || `corr_${crypto.randomUUID()}`,
    requestId: input.requestId || `req_${crypto.randomUUID()}`,
    ipAddress: input.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: input.req.headers.get('user-agent') || 'HL7-INTEGRATION',
  };
}

async function resolveOrder(input: {
  db: Firestore;
  tenantId: string;
  patientId: string;
  placerOrderNumber?: string;
  fillerOrderNumber?: string;
  diagnosticServiceCode?: string;
}) {
  const tenantRef = input.db.collection('tenants').doc(input.tenantId);
  const ordersRef = tenantRef.collection('orders');
  const directIds = [
    input.placerOrderNumber,
    input.fillerOrderNumber,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  for (const orderId of directIds) {
    const snapshot = await ordersRef.doc(orderId).get();
    if (snapshot.exists) {
      const data = snapshot.data() || {};
      if (String(data.patientId || '') === input.patientId) {
        return { orderId: snapshot.id, data };
      }
      return null;
    }
  }

  const patientOrders = await ordersRef
    .where('patientId', '==', input.patientId)
    .limit(100)
    .get();

  const serviceCode = String(input.diagnosticServiceCode || '').trim();
  const candidates = patientOrders.docs.filter((document) => {
    const data = document.data();
    const status = String(data.status || '').toUpperCase();
    if (['COMPLETED', 'CANCELLED'].includes(status)) return false;
    if (!serviceCode) return true;
    return String(data.catalogCode || '').trim() === serviceCode;
  });

  return candidates.length === 1
    ? { orderId: candidates[0].id, data: candidates[0].data() }
    : null;
}

async function writeReconciliationInbox(input: {
  inboxRef: DocumentReference;
  tenantId: string;
  messageType: string;
  sendingApplication: string;
  sendingFacility: string;
  messageControlId: string;
  rawBody: string;
  reason: string;
  patientMrn?: string;
  placerOrderNumber?: string;
  fillerOrderNumber?: string;
}) {
  await input.inboxRef.set({
    messageControlId: input.messageControlId,
    tenantId: input.tenantId,
    messageType: input.messageType,
    sendingApplication: input.sendingApplication,
    sendingFacility: input.sendingFacility,
    receivedAt: new Date().toISOString(),
    rawMessageSha256: crypto.createHash('sha256').update(input.rawBody).digest('hex'),
    ...(process.env.GHIMS_HL7_RETAIN_RAW === 'true' ? { rawMessage: input.rawBody } : {}),
    status: 'REQUIRES_RECONCILIATION',
    reconciliationReason: input.reason,
    patientMrn: input.patientMrn || '',
    placerOrderNumber: input.placerOrderNumber || '',
    fillerOrderNumber: input.fillerOrderNumber || '',
  });
}

export async function POST(req: NextRequest) {
  const elapsed = operationalTimer();
  const correlationId = req.headers.get('x-correlation-id') || undefined;
  const requestId = req.headers.get('x-request-id') || undefined;
  const integrationState = getServerIntegrationState('HL7');

  if (integrationState !== 'LIVE') {
    emitOperationalEvent({
      event: 'interop.hl7_receive',
      outcome: 'REJECTED',
      correlationId,
      requestId,
      durationMs: elapsed(),
      errorCode: 'HL7_NOT_LIVE',
      attributes: { integrationState },
    });
    return NextResponse.json(
      { error: 'HL7 integration is not LIVE.', integrationState },
      { status: 503 }
    );
  }

  const expectedKey = process.env.GHIMS_HL7_INGEST_API_KEY;
  const providedKey = String(req.headers.get('x-api-key') || '').trim();
  const tenantId = String(
    req.headers.get('x-ghims-tenant-id') ||
      req.nextUrl.searchParams.get('tenantId') ||
      ''
  ).trim().toLowerCase();

  if (!expectedKey) {
    return NextResponse.json(
      { error: 'HL7 ingestion is disabled until an integration credential is configured.' },
      { status: 503 }
    );
  }

  if (!providedKey || !safeEqual(providedKey, expectedKey)) {
    emitOperationalEvent({
      event: 'interop.hl7_receive',
      outcome: 'REJECTED',
      correlationId,
      requestId,
      tenantId,
      durationMs: elapsed(),
      errorCode: 'HL7_AUTH_REJECTED',
    });
    return NextResponse.json({ error: 'Unauthorized integration source.' }, { status: 401 });
  }

  if (!tenantId) {
    return NextResponse.json({ error: 'x-ghims-tenant-id is required.' }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: 'Authoritative clinical store unavailable.' }, { status: 503 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let rawBody = '';

    if (contentType.includes('application/json')) {
      const json = await req.json();
      rawBody = String(json.hl7Message || json.rawMessage || json.payload || '');
    } else {
      rawBody = await req.text();
    }

    rawBody = rawBody.replace(/^\x0B/, '').replace(/\x1C\x0D$/, '').trim();
    if (!rawBody) {
      return NextResponse.json({ error: 'Empty HL7 payload.' }, { status: 400 });
    }

    const parsedHL7 = parseHL7(rawBody);
    const messageType = [
      parsedHL7.getFieldValue('MSH', 9, 0),
      parsedHL7.getFieldValue('MSH', 9, 1),
    ].filter(Boolean).join('^');

    if (messageType !== 'ORU^R01') {
      return NextResponse.json(
        { error: 'Unsupported HL7 message type.', messageType },
        { status: 422 }
      );
    }

    const oruData = extractORU_R01(parsedHL7);
    const allowedApps = String(process.env.GHIMS_HL7_ALLOWED_SENDING_APPS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (allowedApps.length > 0 && !allowedApps.includes(oruData.sendingApplication)) {
      return NextResponse.json(
        { error: 'HL7 sending application is not allowlisted.' },
        { status: 403 }
      );
    }

    if (!oruData.messageControlId) {
      return NextResponse.json({ error: 'MSH-10 message control ID is required.' }, { status: 422 });
    }

    const inboxRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('integration_inbox')
      .doc(`hl7_${oruData.messageControlId}`);

    const existing = await inboxRef.get();
    if (existing.exists && existing.data()?.status === 'PROCESSED') {
      const ack = generateACK(parsedHL7, 'AA', 'Duplicate message already processed');
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AA' },
      });
    }

    if (!oruData.patientMrn) {
      await writeReconciliationInbox({
        inboxRef,
        tenantId,
        messageType,
        sendingApplication: oruData.sendingApplication,
        sendingFacility: oruData.sendingFacility,
        messageControlId: oruData.messageControlId,
        rawBody,
        reason: 'PATIENT_MRN_REQUIRED',
        placerOrderNumber: oruData.placerOrderNumber,
        fillerOrderNumber: oruData.fillerOrderNumber,
      });
      const ack = generateACK(parsedHL7, 'AE', 'Patient MRN could not be resolved');
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AE' },
      });
    }

    const patientSnapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('patients')
      .where('mrn', '==', oruData.patientMrn)
      .limit(2)
      .get();

    if (patientSnapshot.size !== 1) {
      await writeReconciliationInbox({
        inboxRef,
        tenantId,
        messageType,
        sendingApplication: oruData.sendingApplication,
        sendingFacility: oruData.sendingFacility,
        messageControlId: oruData.messageControlId,
        rawBody,
        reason:
          patientSnapshot.size === 0
            ? 'PATIENT_NOT_FOUND'
            : 'PATIENT_IDENTITY_AMBIGUOUS',
        patientMrn: oruData.patientMrn,
        placerOrderNumber: oruData.placerOrderNumber,
        fillerOrderNumber: oruData.fillerOrderNumber,
      });
      const ack = generateACK(parsedHL7, 'AE', 'Patient identity requires reconciliation');
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AE' },
      });
    }

    const patientDoc = patientSnapshot.docs[0];
    const matchedPatientId = patientDoc.id;
    const matchedOrder = await resolveOrder({
      db,
      tenantId,
      patientId: matchedPatientId,
      placerOrderNumber: oruData.placerOrderNumber,
      fillerOrderNumber: oruData.fillerOrderNumber,
      diagnosticServiceCode: oruData.diagnosticServiceCode,
    });

    if (!matchedOrder) {
      await writeReconciliationInbox({
        inboxRef,
        tenantId,
        messageType,
        sendingApplication: oruData.sendingApplication,
        sendingFacility: oruData.sendingFacility,
        messageControlId: oruData.messageControlId,
        rawBody,
        reason: 'DIAGNOSTIC_ORDER_UNRESOLVED_OR_AMBIGUOUS',
        patientMrn: oruData.patientMrn,
        placerOrderNumber: oruData.placerOrderNumber,
        fillerOrderNumber: oruData.fillerOrderNumber,
      });
      const ack = generateACK(parsedHL7, 'AE', 'Diagnostic order requires reconciliation');
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AE' },
      });
    }

    const context = integrationContext({
      tenantId,
      sendingApplication: oruData.sendingApplication,
      correlationId,
      requestId,
      req,
    });

    const command: BaseCommand = {
      commandId: `cmd_hl7_${oruData.messageControlId}`,
      idempotencyKey: `hl7-oru:${oruData.sendingApplication}:${oruData.messageControlId}`,
      tenantId,
      commandType: 'RecordDiagnosticResultCommand',
      schemaVersion: 1,
      payload: {
        orderId: matchedOrder.orderId,
        patientId: matchedPatientId,
        encounterId: String(matchedOrder.data.encounterId || ''),
        reportCode: oruData.diagnosticServiceCode || matchedOrder.data.catalogCode || 'HL7_ORU',
        reportDisplay: oruData.diagnosticService || matchedOrder.data.orderName || 'Diagnostic report',
        category: String(matchedOrder.data.orderType || '').toUpperCase() === 'RADIOLOGY'
          ? 'RADIOLOGY'
          : 'LAB',
        reportStatus: reportStatus(oruData.results.map((item) => item.status)),
        issuedAt: hl7TimestampToMs(oruData.observationDateTime),
        sourceType: 'EXTERNAL_HL7',
        sourceSystem: oruData.sendingApplication,
        sourceMessageControlId: oruData.messageControlId,
        results: oruData.results.map((item) => {
          const unitCode = unitCodeFor(item.units);
          return {
            code: item.testCode,
            display: item.testName,
            codingSystem: item.codingSystem || 'LOCAL',
            value: item.resultValue,
            unit: item.units,
            unitCode,
            referenceRange: item.referenceRange,
            abnormalFlag: item.abnormalFlags,
            status: hl7ResultStatus(item.status),
            observedAt: hl7TimestampToMs(item.observationDateTime),
          };
        }),
      },
    };

    const result = await CommandBus.dispatch(context, command);
    if (!result.success) {
      await writeReconciliationInbox({
        inboxRef,
        tenantId,
        messageType,
        sendingApplication: oruData.sendingApplication,
        sendingFacility: oruData.sendingFacility,
        messageControlId: oruData.messageControlId,
        rawBody,
        reason: result.error?.code || 'DIAGNOSTIC_RESULT_REJECTED',
        patientMrn: oruData.patientMrn,
        placerOrderNumber: oruData.placerOrderNumber,
        fillerOrderNumber: oruData.fillerOrderNumber,
      });
      const ack = generateACK(
        parsedHL7,
        'AE',
        result.error?.message || 'Diagnostic result rejected'
      );
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AE' },
      });
    }

    await inboxRef.set({
      messageControlId: oruData.messageControlId,
      tenantId,
      messageType,
      sendingApplication: oruData.sendingApplication,
      sendingFacility: oruData.sendingFacility,
      receivedAt: new Date().toISOString(),
      rawMessageSha256: crypto.createHash('sha256').update(rawBody).digest('hex'),
      ...(process.env.GHIMS_HL7_RETAIN_RAW === 'true' ? { rawMessage: rawBody } : {}),
      status: 'PROCESSED',
      patientId: matchedPatientId,
      orderId: matchedOrder.orderId,
      diagnosticReportId: result.entityId,
    });

    emitOperationalEvent({
      event: 'interop.hl7_receive',
      outcome: 'SUCCESS',
      correlationId,
      requestId,
      tenantId,
      durationMs: elapsed(),
      attributes: {
        resultCount: oruData.results.length,
        patientMatched: true,
        orderMatched: true,
        sendingApplication: oruData.sendingApplication || 'unknown',
        diagnosticReportId: result.entityId || 'unknown',
      },
    });

    const ack = generateACK(
      parsedHL7,
      'AA',
      `Observation Results Ingested (${oruData.results.length} items parsed)`
    );
    return new NextResponse(ack, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-HL7-ACK': 'AA',
        'X-Message-Control-ID': oruData.messageControlId,
        ...(result.entityId ? { 'X-GHIMS-Diagnostic-Report-ID': result.entityId } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HL7 ingestion error';
    emitOperationalEvent({
      event: 'interop.hl7_receive',
      outcome: 'FAILURE',
      correlationId,
      requestId,
      tenantId,
      durationMs: elapsed(),
      errorCode: 'HL7_INGEST_ERROR',
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
