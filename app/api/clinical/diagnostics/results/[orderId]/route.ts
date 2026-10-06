import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { assertDiagnosticResultReadAccess } from '@/lib/clinical/diagnostics/diagnostic-result-access';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  ClinicalObservation,
  DiagnosticReport,
} from '@/types/clinical-canonical';

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

function presentDiagnosticOrder(
  order: Record<string, unknown>
): Record<string, unknown> {
  return {
    orderId: order.orderId || order.id,
    patientId: order.patientId,
    encounterId: order.encounterId,
    orderType: order.orderType,
    catalogCode: order.catalogCode,
    orderName: order.orderName,
    priority: order.priority,
    clinicalIndication: order.clinicalIndication,
    specimenType: order.specimenType,
    specimenBarcode: order.specimenBarcode,
    status: order.status,
    worklistStatus: order.worklistStatus,
    orderedBy: order.orderedBy,
    orderedAt: order.orderedAt || order.createdAt,
  };
}

function presentPatientIdentity(
  patientId: string,
  patient: Record<string, unknown>
): Record<string, unknown> {
  return {
    patientId,
    mrn: patient.mrn,
    fullName: patient.fullName,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender,
  };
}

function json(
  body: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) {
      return json(
        { success: false, error: 'DIAGNOSTIC_ORDER_ID_REQUIRED' },
        400
      );
    }

    const { context } = await deriveAuthoritativeContext(req);
    const order = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'orders',
      normalizedOrderId
    );
    if (!order) {
      return json(
        { success: false, error: 'DIAGNOSTIC_ORDER_NOT_FOUND' },
        404
      );
    }

    const patientId = String(order.patientId || '').trim();
    const encounterId = String(order.encounterId || '').trim();
    if (!patientId || !encounterId) {
      return json(
        {
          success: false,
          error: 'DIAGNOSTIC_ORDER_CLINICAL_LINK_MISSING',
        },
        409
      );
    }

    const [encounter, patient] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        encounterId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        patientId
      ),
    ]);

    if (
      !encounter ||
      !patient ||
      String(encounter.patientId || '').trim() !== patientId ||
      String(encounter.encounterId || encounter.id || '').trim() !== encounterId ||
      String(patient.id || patient.patientId || '').trim() !== patientId
    ) {
      return json(
        { success: false, error: 'DIAGNOSTIC_ORDER_LINEAGE_MISMATCH' },
        409
      );
    }

    // Authorization must happen before report/observation PHI is loaded.
    assertDiagnosticResultReadAccess(context, order, encounter, patient);

    const reports = await DomainStateRepository.queryEqual<DiagnosticReport>(
      context.tenantId,
      'diagnosticReports',
      'orderId',
      normalizedOrderId,
      50
    );

    const report = reports
      .filter(
        (candidate) =>
          candidate.tenantId === context.tenantId &&
          candidate.patientId === patientId &&
          (!candidate.encounterId || candidate.encounterId === encounterId)
      )
      .sort(
        (left, right) =>
          Number(right.issuedAt || right.updatedAt) -
          Number(left.issuedAt || left.updatedAt)
      )[0];

    if (!report) {
      return json(
        {
          success: true,
          status: 'RESULT_PENDING',
          order: presentDiagnosticOrder(order),
          patient: presentPatientIdentity(patientId, patient),
          report: null,
          observations: [],
        },
        200
      );
    }

    const observations = await Promise.all(
      report.resultObservationIds.map((observationId) =>
        DomainStateRepository.getById<ClinicalObservation>(
          context.tenantId,
          'clinicalObservations',
          observationId
        )
      )
    );

    const missingObservationIds = report.resultObservationIds.filter(
      (_id, index) => !observations[index]
    );
    if (missingObservationIds.length > 0) {
      return json(
        {
          success: false,
          error: 'DIAGNOSTIC_REPORT_EVIDENCE_INCOMPLETE',
          missingObservationIds,
        },
        409
      );
    }

    const invalidObservationIds = observations
      .filter(
        (observation): observation is ClinicalObservation =>
          Boolean(observation) &&
          (
            observation!.tenantId !== context.tenantId ||
            observation!.patientId !== patientId ||
            (observation!.encounterId &&
              observation!.encounterId !== encounterId)
          )
      )
      .map((observation) => observation.observationId);

    if (invalidObservationIds.length > 0) {
      return json(
        {
          success: false,
          error: 'DIAGNOSTIC_REPORT_OBSERVATION_LINEAGE_MISMATCH',
          invalidObservationIds,
        },
        409
      );
    }

    return json(
      {
        success: true,
        status: report.status,
        order: presentDiagnosticOrder(order),
        patient: presentPatientIdentity(patientId, patient),
        report,
        observations: observations.filter(Boolean),
      },
      200
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Diagnostic result read failed';
    const unauthorized =
      /AUTH|TENANT|SESSION|UNAUTH|DEVICE|ACCESS|PERMISSION|FORBIDDEN|DENIED/i.test(
        message
      );

    return json(
      {
        success: false,
        error: unauthorized
          ? 'DIAGNOSTIC_RESULT_ACCESS_DENIED'
          : 'DIAGNOSTIC_RESULT_READ_FAILED',
      },
      unauthorized ? 403 : 500
    );
  }
}
