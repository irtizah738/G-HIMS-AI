import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  ClinicalObservation,
  DiagnosticReport,
} from '@/types/clinical-canonical';

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) {
      return NextResponse.json(
        { success: false, error: 'orderId is required.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req);
    const order = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'orders',
      normalizedOrderId
    );

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'DIAGNOSTIC_ORDER_NOT_FOUND' },
        { status: 404 }
      );
    }

    const patientId = String(order.patientId || '');
    if (!patientId) {
      return NextResponse.json(
        { success: false, error: 'DIAGNOSTIC_ORDER_PATIENT_LINK_MISSING' },
        { status: 409 }
      );
    }

    const reports = await DomainStateRepository.queryEqual<DiagnosticReport>(
      context.tenantId,
      'diagnosticReports',
      'orderId',
      normalizedOrderId,
      50
    );

    const report = reports
      .sort((left, right) => Number(right.issuedAt || right.updatedAt) - Number(left.issuedAt || left.updatedAt))[0];

    if (!report) {
      return NextResponse.json(
        {
          success: true,
          order,
          patient: null,
          report: null,
          observations: [],
          status: 'RESULT_PENDING',
        },
        { status: 200 }
      );
    }

    if (report.patientId !== patientId) {
      return NextResponse.json(
        { success: false, error: 'DIAGNOSTIC_REPORT_PATIENT_MISMATCH' },
        { status: 409 }
      );
    }

    const [patient, observations] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        patientId
      ),
      Promise.all(
        report.resultObservationIds.map((observationId) =>
          DomainStateRepository.getById<ClinicalObservation>(
            context.tenantId,
            'clinicalObservations',
            observationId
          )
        )
      ),
    ]);

    const missingObservationIds = report.resultObservationIds.filter(
      (_id, index) => !observations[index]
    );
    if (missingObservationIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'DIAGNOSTIC_REPORT_EVIDENCE_INCOMPLETE',
          missingObservationIds,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      status: report.status,
      order,
      patient: patient
        ? {
            patientId,
            mrn: patient.mrn,
            fullName: patient.fullName,
            dateOfBirth: patient.dateOfBirth,
            gender: patient.gender,
          }
        : { patientId },
      report,
      observations: observations.filter(Boolean),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diagnostic result read failed';
    const unauthorized = /AUTH|TENANT|SESSION|UNAUTH|DEVICE/i.test(message);
    return NextResponse.json(
      { success: false, error: message },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
