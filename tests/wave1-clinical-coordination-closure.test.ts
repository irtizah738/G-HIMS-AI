import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getConsultationSla,
  getConsultationSlaState,
} from '@/lib/clinical/coordination/consultation-sla';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 1 clinical coordination closure', () => {
  test('consultation SLA policy separates acknowledgement and acceptance', () => {
    expect(getConsultationSla('STAT')).toEqual({
      acknowledgementMinutes: 10,
      acceptanceMinutes: 15,
    });
    expect(getConsultationSla('URGENT')).toEqual({
      acknowledgementMinutes: 30,
      acceptanceMinutes: 60,
    });
    expect(getConsultationSla('PRIORITY')).toEqual({
      acknowledgementMinutes: 60,
      acceptanceMinutes: 120,
    });
    expect(getConsultationSla('ROUTINE')).toEqual({
      acknowledgementMinutes: 240,
      acceptanceMinutes: 480,
    });

    expect(getConsultationSlaState(101, 100, 'ACKNOWLEDGEMENT')).toBe('BREACHED');
    expect(getConsultationSlaState(100, undefined, 'COMPLETE')).toBe('COMPLETE');
  });

  test('consultation lifecycle has authoritative acknowledgement before acceptance', async () => {
    const service = await source(
      'lib/backend/services/clinical-coordination-domain-service.ts'
    );
    const schemas = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(schemas).toContain('AcknowledgeConsultationCommand');
    expect(bus).toContain('ClinicalCoordinationDomainService.acknowledgeConsultation');
    expect(service).toContain("eventType: 'CLINICAL_CONSULTATION_ACKNOWLEDGED'");
    expect(service).toContain("status: 'ACKNOWLEDGED'");
    expect(service).toContain('acknowledgementSlaBreached');
    expect(service).toContain('acceptanceSlaBreached');
  });

  test('consultant worklist uses lifecycle SLA and preserves evidence refs', async () => {
    const projector = await source(
      'lib/clinical/intelligence/consultant-attention-projection-service.ts'
    );
    const types = await source('types/clinical-coordination.ts');

    expect(projector).toContain("'ACKNOWLEDGEMENT' as const");
    expect(projector).toContain("'ACCEPTANCE' as const");
    expect(projector).toContain('getConsultationSlaState');
    expect(projector).toContain('...(consultation.sourceRefs || [])');
    expect(projector).toContain('...(handoff.sourceRefs || [])');
    expect(types).toContain("slaPhase?: 'ACKNOWLEDGEMENT' | 'ACCEPTANCE' | 'COMPLETE'");
  });

  test('disease intake finalizes as an immutable authority artifact', async () => {
    const service = await source(
      'lib/backend/services/disease-intake-domain-service.ts'
    );
    const transaction = await source(
      'lib/backend/transactions/transaction-manager.ts'
    );
    const schemas = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );

    expect(transaction).toContain(
      "DISEASE_INTAKE_ARTIFACT: 'diseaseIntakeArtifacts'"
    );
    expect(schemas).toContain('SaveDiseaseIntakeArtifactCommand');
    expect(service).toContain("eventType: 'DISEASE_INTAKE_FINALIZED'");
    expect(service).toContain("'PATIENT360_REVIEW_STALE'");
    expect(service).toContain("status: 'FINAL'");
    expect(service).toContain('clinicianAttestation');
  });

  test('Patient 360 includes finalized disease intake provenance', async () => {
    const projectionService = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );
    const projector = await source(
      'lib/clinical/patient360/patient360-projector.ts'
    );
    const types = await source('types/patient360-projection.ts');

    expect(projectionService).toContain("collection('diseaseIntakeArtifacts')");
    expect(projector).toContain('recentDiseaseIntakes');
    expect(projector).toContain("case 'DISEASE_INTAKE_FINALIZED'");
    expect(projector).toContain('diseaseIntakeArtifacts: diseaseIntakeArtifacts');
    expect(types).toContain('Patient360DiseaseIntakeSummary');
  });

  test('routing creates source-linked consultation and Patient 360 handoff', async () => {
    const routing = await source(
      'components/clinical/patient-consultant-routing-modal.tsx'
    );
    const intake = await source(
      'components/views/disease-centric-intake-view.tsx'
    );

    expect(routing).toContain('priority: routingUrgency');
    expect(routing).toContain('createClinicalHandoff');
    expect(routing).toContain('patient360Revision');
    expect(routing).toContain('patient360SourceCheckpoint');
    expect(routing).toContain('sourceArtifactId');
    expect(intake).toContain('saveDiseaseIntakeArtifact');
    expect(intake).toContain('sourceArtifactType={savedIntakeArtifact ?');
    expect(intake).toContain("'DISEASE_INTAKE'");
    expect(intake).toContain('Finalize Intake First');
  });
});
