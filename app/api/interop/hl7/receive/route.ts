import { NextRequest, NextResponse } from 'next/server';
import { parseHL7, extractORU_R01, generateACK } from '@/lib/interop/hl7-parser';
import { db, cleanFirestoreData } from '@/lib/firebase/config';
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

export async function POST(req: NextRequest) {
  let rawBody = '';
  let tenantId = req.nextUrl.searchParams.get('tenantId') || req.headers.get('x-tenant-id') || 'default';
  const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization');

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await req.json();
      rawBody = json.hl7Message || json.rawMessage || json.payload || '';
      if (json.tenantId) tenantId = json.tenantId;
    } else {
      rawBody = await req.text();
    }

    // Strip MLLP framing characters if present (0x0B start-block, 0x1C 0x0D end-block)
    rawBody = rawBody.replace(/^\x0B/, '').replace(/\x1C\x0D$/, '').trim();

    if (!rawBody) {
      return new NextResponse('MSH|^~\\&|GHIMS|HOSPITAL|LIS|LAB|||ACK^R01|ERR|P|2.3.1\rMSA|AE|ERR|Empty HL7 payload received\r', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // 1. Parse HL7 Message
    const parsedHL7 = parseHL7(rawBody);
    const oruData = extractORU_R01(parsedHL7);

    // 2. Resolve Patient in Firestore by MRN
    let matchedPatientId: string | null = null;
    let activeEncounterId: string | null = null;

    try {
      if (oruData.patientMrn) {
        const patientsQuery = query(
          collection(db, 'tenants', tenantId, 'patients'),
          where('mrn', '==', oruData.patientMrn)
        );
        const patientSnap = await getDocs(patientsQuery);

        if (!patientSnap.empty) {
          const patientDoc = patientSnap.docs[0];
          matchedPatientId = patientDoc.id;
          const pData = patientDoc.data();
          activeEncounterId = pData.currentEncounterId || null;
        }
      }

      // 3. Ingest and Persist Laboratory Observations in Firestore
      const labResultId = `lab_${Date.now()}_${oruData.fillerOrderNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
      const labDocRef = doc(db, 'tenants', tenantId, 'diagnostic_orders', labResultId);

      const labPayload = {
        id: labResultId,
        tenantId,
        patientId: matchedPatientId || 'UNKNOWN',
        patientMrn: oruData.patientMrn,
        patientName: oruData.patientName,
        encounterId: activeEncounterId || oruData.visitNumber || 'ENC-UNSPECIFIED',
        orderNumber: oruData.fillerOrderNumber,
        placerOrderNumber: oruData.placerOrderNumber || '',
        testCategory: oruData.diagnosticService,
        observationDateTime: oruData.observationDateTime,
        status: 'completed',
        results: oruData.results,
        source: 'HL7_LIS_INGESTION',
        messageControlId: oruData.messageControlId,
        receivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(labDocRef, cleanFirestoreData(labPayload), { merge: true });

      // If active encounter exists, also log under encounter lab results
      if (activeEncounterId && matchedPatientId) {
        const encLabRef = doc(
          db,
          'tenants',
          tenantId,
          'encounters',
          activeEncounterId,
          'lab_results',
          labResultId
        );
        await setDoc(encLabRef, cleanFirestoreData(labPayload), { merge: true });
      }
    } catch (dbErr) {
      console.warn('Non-blocking Firestore ingestion warning in HL7 route:', dbErr);
    }

    // 4. Return standard HL7 ACK message
    const ackResponse = generateACK(parsedHL7, 'AA', `Observation Results Ingested (${oruData.results.length} items parsed)`);

    return new NextResponse(ackResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-HL7-ACK': 'AA',
        'X-Message-Control-ID': oruData.messageControlId,
      },
    });
  } catch (error: any) {
    console.error('HL7 Interoperability Ingestion Error:', error);

    const fallbackAck = `MSH|^~\\&|GHIMS|HOSPITAL|LIS|LAB|${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}||ACK^R01|ERR|P|2.3.1\rMSA|AE|ERR|${error?.message || 'HL7 Parsing Error'}\r`;

    return new NextResponse(fallbackAck, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
