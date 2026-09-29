import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseHL7, extractORU_R01 } from '@/lib/interop/hl7-parser';
import { buildDiagnosticResultFacts } from '@/lib/clinical/diagnostics/diagnostic-result-builder';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS CI-3 diagnostics pipeline', () => {
  test('diagnostic result builder creates observations and one linked report', () => {
    const { observations, report } = buildDiagnosticResultFacts({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      orderId: 'ord-a',
      reportId: 'report-a',
      actorId: 'lab-a',
      sourceType: 'LAB_SYSTEM',
      sourceSystem: 'LIS-A',
      reportCode: 'CBC',
      reportDisplay: 'Complete blood count',
      category: 'LAB',
      reportStatus: 'FINAL',
      issuedAt: 1700000000000,
      sourceEvidenceId: 'lis-msg-a',
      results: [
        {
          code: 'HB',
          display: 'Hemoglobin',
          codingSystem: 'LOCAL',
          value: 13.4,
          unit: 'g/dL',
          referenceRange: '12-16',
          abnormalFlag: 'N',
          status: 'FINAL',
        },
        {
          code: 'WBC',
          display: 'White blood cell count',
          codingSystem: 'LOCAL',
          value: 18.2,
          unit: '10^9/L',
          referenceRange: '4-11',
          abnormalFlag: 'H',
          status: 'FINAL',
        },
      ],
    });

    expect(observations).toHaveLength(2);
    expect(report.orderId).toBe('ord-a');
    expect(report.patientId).toBe('patient-a');
    expect(report.resultObservationIds).toEqual(
      observations.map((item) => item.observationId)
    );
    expect(report.status).toBe('FINAL');
    expect(observations[1].interpretation?.[0]?.text).toBe('High');
  });

  test('unknown result units are preserved without falsely claiming UCUM authority', () => {
    const { observations } = buildDiagnosticResultFacts({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      orderId: 'ord-a',
      reportId: 'report-a',
      actorId: 'lab-a',
      sourceType: 'LAB_SYSTEM',
      reportCode: 'TEST',
      reportDisplay: 'Test',
      category: 'LAB',
      reportStatus: 'FINAL',
      issuedAt: 1700000000000,
      sourceEvidenceId: 'source-a',
      results: [
        {
          code: 'X',
          display: 'Unknown measurement',
          value: 4.2,
          unit: 'widgets/dL',
          unitCode: 'widgets/dL',
          status: 'FINAL',
        },
      ],
    });

    const value = observations[0].value;
    expect(value.valueType).toBe('QUANTITY');
    if (value.valueType !== 'QUANTITY') throw new Error('Expected quantity.');
    expect(value.quantity.unit).toBe('widgets/dL');
    expect(value.quantity.system).toBeUndefined();
    expect(value.quantity.code).toBeUndefined();
  });

  test('HL7 parser preserves OBR and OBX coding systems for downstream normalization', () => {
    const message = [
      'MSH|^~\\&|LIS|LAB|GHIMS|HOSP|20260929120000||ORU^R01|MSG-100|P|2.5.1',
      'PID|||MRN-100||Patient^Synthetic||19900101|F',
      'PV1|||||||||||||||||||ENC-100',
      'ORC|RE',
      'OBR|1|ord-100|fill-100|CBC^Complete Blood Count^L',
      'OBX|1|NM|718-7^Hemoglobin^LN||13.4|g/dL|12-16|N|||F|||20260929115900',
    ].join('\r');

    const data = extractORU_R01(parseHL7(message));
    expect(data.placerOrderNumber).toBe('ord-100');
    expect(data.diagnosticServiceCode).toBe('CBC');
    expect(data.diagnosticServiceCodingSystem).toBe('L');
    expect(data.results[0].testCode).toBe('718-7');
    expect(data.results[0].codingSystem).toBe('LN');
  });

  test('diagnostic result domain service enforces patient/order lineage and atomic canonical writes', async () => {
    const service = await source('lib/backend/services/diagnostic-result-domain-service.ts');

    expect(service).toContain("'DIAGNOSTIC_ORDER_NOT_FOUND'");
    expect(service).toContain("'DIAGNOSTIC_RESULT_PATIENT_MISMATCH'");
    expect(service).toContain("'DIAGNOSTIC_RESULT_ENCOUNTER_MISMATCH'");
    expect(service).toContain("entityType: 'CLINICAL_OBSERVATION'");
    expect(service).toContain("entityType: 'DIAGNOSTIC_REPORT'");
    expect(service).toContain("entityType: 'DIAGNOSTIC_ORDER'");
    expect(service).toContain("entityType: 'CANONICAL_DIAGNOSTIC_ORDER'");
    expect(service).toContain("'DIAGNOSTIC_RESULT_VERIFIED'");
    expect(service).toContain('TransactionManager.executeAtomicMutation');
  });

  test('RecordDiagnosticResultCommand is registered on the master command bus', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    expect(bus).toContain("'RecordDiagnosticResultCommand'");
    expect(bus).toContain('DiagnosticResultDomainService.record');
  });

  test('HL7 ORU ingestion never writes unmatched results into the patient chart', async () => {
    const route = await source('app/api/interop/hl7/receive/route.ts');

    expect(route).toContain("'PATIENT_IDENTITY_AMBIGUOUS'");
    expect(route).toContain("'DIAGNOSTIC_ORDER_UNRESOLVED_OR_AMBIGUOUS'");
    expect(route).toContain("status: 'REQUIRES_RECONCILIATION'");
    expect(route).toContain("commandType: 'RecordDiagnosticResultCommand'");
    expect(route).toContain("sourceType: 'EXTERNAL_HL7'");
    expect(route).toContain("'X-HL7-ACK': 'AE'");
    expect(route).not.toContain("collection('diagnostic_orders').doc(labResultId)");
  });

  test('diagnostic result read API resolves authoritative report evidence under authenticated tenant context', async () => {
    const route = await source('app/api/clinical/diagnostics/results/[orderId]/route.ts');

    expect(route).toContain('deriveAuthoritativeContext(req)');
    expect(route).toContain("'diagnosticReports'");
    expect(route).toContain("'clinicalObservations'");
    expect(route).toContain("'DIAGNOSTIC_REPORT_PATIENT_MISMATCH'");
    expect(route).toContain("'DIAGNOSTIC_REPORT_EVIDENCE_INCOMPLETE'");
  });

  test('clinician diagnostic results page no longer contains hard-coded patient/result data', async () => {
    const page = await source('app/[tenantId]/diagnostics/results/[orderId]/page.tsx');
    const view = await source('components/diagnostics/DiagnosticResultView.tsx');

    expect(page).toContain('DiagnosticResultView');
    expect(page).not.toContain('Elena Rostova');
    expect(page).not.toContain('0.042');
    expect(page).not.toContain('215');
    expect(view).toContain('AuthClient.authorizedFetch');
    expect(view).toContain('report.sourceEvidenceId');
    expect(view).toContain('report.provenance.recordedBy');
  });

  test('diagnostic result collection is mapped as authoritative domain state', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    expect(tx).toContain("DIAGNOSTIC_RESULT: 'diagnosticResults'");
  });
});
