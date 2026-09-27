import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseHL7, extractORU_R01, generateACK } from '@/lib/interop/hl7-parser';
import { getAdminFirestore } from '@/server/firebase/admin';

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.GHIMS_HL7_INGEST_API_KEY;
  const providedKey = String(req.headers.get('x-api-key') || '').trim();
  const tenantId = String(req.headers.get('x-ghims-tenant-id') || req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();

  if (!expectedKey) {
    return NextResponse.json(
      { error: 'HL7 ingestion is disabled until an integration credential is configured.' },
      { status: 503 }
    );
  }

  if (!providedKey || !safeEqual(providedKey, expectedKey)) {
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
    const oruData = extractORU_R01(parsedHL7);

    if (!oruData.messageControlId) {
      return NextResponse.json({ error: 'MSH-10 message control ID is required.' }, { status: 422 });
    }

    const inboxRef = db.collection('tenants').doc(tenantId).collection('integration_inbox').doc(`hl7_${oruData.messageControlId}`);
    const existing = await inboxRef.get();

    if (existing.exists) {
      const ack = generateACK(parsedHL7, 'AA', 'Duplicate message already processed');
      return new NextResponse(ack, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'X-HL7-ACK': 'AA' },
      });
    }

    let matchedPatientId: string | null = null;
    let activeEncounterId: string | null = null;

    if (oruData.patientMrn) {
      const patientSnapshot = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('patients')
        .where('mrn', '==', oruData.patientMrn)
        .limit(2)
        .get();

      if (patientSnapshot.size === 1) {
        const patientDoc = patientSnapshot.docs[0];
        matchedPatientId = patientDoc.id;
        activeEncounterId = String(patientDoc.data().currentEncounterId || '') || null;
      }
    }

    const labResultId = `lab_${crypto.randomUUID()}`;
    const labPayload = {
      id: labResultId,
      tenantId,
      patientId: matchedPatientId,
      patientMrn: oruData.patientMrn,
      patientName: oruData.patientName,
      encounterId: activeEncounterId || oruData.visitNumber || null,
      orderNumber: oruData.fillerOrderNumber,
      placerOrderNumber: oruData.placerOrderNumber || '',
      testCategory: oruData.diagnosticService,
      observationDateTime: oruData.observationDateTime,
      status: matchedPatientId ? 'completed' : 'requires_patient_reconciliation',
      results: oruData.results,
      source: 'HL7_LIS_INGESTION',
      messageControlId: oruData.messageControlId,
      receivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const batch = db.batch();
    batch.create(inboxRef, {
      messageControlId: oruData.messageControlId,
      tenantId,
      messageType: [
        parsedHL7.getFieldValue('MSH', 9, 0),
        parsedHL7.getFieldValue('MSH', 9, 1),
      ].filter(Boolean).join('^'),
      receivedAt: new Date().toISOString(),
      rawMessage: rawBody,
      status: matchedPatientId ? 'PROCESSED' : 'REQUIRES_RECONCILIATION',
    });

    batch.create(
      db.collection('tenants').doc(tenantId).collection('diagnostic_orders').doc(labResultId),
      labPayload
    );

    if (activeEncounterId && matchedPatientId) {
      batch.create(
        db.collection('tenants').doc(tenantId).collection('encounters').doc(activeEncounterId).collection('lab_results').doc(labResultId),
        labPayload
      );
    }

    await batch.commit();

    const ack = generateACK(parsedHL7, 'AA', `Observation Results Ingested (${oruData.results.length} items parsed)`);
    return new NextResponse(ack, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-HL7-ACK': 'AA',
        'X-Message-Control-ID': oruData.messageControlId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HL7 ingestion error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
