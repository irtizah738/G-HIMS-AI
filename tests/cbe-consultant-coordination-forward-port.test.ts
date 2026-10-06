import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('CBE consultant blindness forward-port', () => {
  test('current coordination authority remains canonical', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(bus).toContain('ClinicalCoordinationDomainService');
    expect(bus).toContain("case 'RequestConsultationCommand'");
    expect(bus).toContain("case 'AcceptConsultationCommand'");
    expect(bus).toContain("case 'CreateClinicalHandoffCommand'");
    expect(bus).toContain("case 'AcceptClinicalHandoffCommand'");
    expect(bus).not.toContain('ConsultantCoordinationDomainService');

    expect(tx).toContain(
      "CLINICAL_CONSULTATION_REQUEST: 'consultationRequests'"
    );
    expect(tx).toContain("CLINICAL_HANDOFF: 'clinicalHandoffs'");
  });

  test('consultant directory is HCM credential and privilege backed', async () => {
    const directory = await source(
      'lib/clinical/intelligence/consultant-directory-service.ts'
    );
    const route = await source(
      'app/api/clinical/consultant/directory/route.ts'
    );

    expect(directory).toContain("employmentStatus === 'ACTIVE'");
    expect(directory).toContain("credential.verificationStatus === 'VERIFIED'");
    expect(directory).toContain("privilege.status === 'GRANTED'");
    expect(directory).toContain('availabilityFor');
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('ConsultantDirectoryService.listEligible');
  });

  test('production consultant routing contains no fabricated consultant authority', async () => {
    const modal = await source(
      'components/clinical/patient-consultant-routing-modal.tsx'
    );
    const client = await source(
      'lib/clinical/intelligence/consultant-worklist-client.ts'
    );

    expect(modal).toContain('DEMO_CONSULTANT_REGISTRY');
    expect(modal).toContain(
      'IS_DEMO_RUNTIME ? DEMO_CONSULTANT_REGISTRY : []'
    );
    expect(modal).toContain('loadConsultantDirectory');
    expect(modal).toContain('requestClinicalConsultation');
    expect(modal).toContain(
      'Authoritative consultant routing requires tenant, patient and encounter identity.'
    );
    expect(modal).not.toContain("role: 'Automated Routing Dispatcher'");
    expect(client).toContain('/api/clinical/consultant/directory?');
  });

  test('OPD preserves encounter identity into specialist routing', async () => {
    const view = await source('components/views/opd-encounters-view.tsx');
    const types = await source('lib/types/ghims.ts');

    expect(types).toContain('encounterId?: string');
    expect(view).toContain('encounterId: token.encounterId');
    expect(view).toContain('encounterId: selectedToken.encounterId');
    expect(view).toContain('encounterId={routingPatientData.encounterId}');
  });

  test('current command center can accept consultations and handoffs directly', async () => {
    const center = await source(
      'components/clinical/ConsultantCommandCenter.tsx'
    );

    expect(center).toContain('acceptClinicalConsultation');
    expect(center).toContain('acceptClinicalHandoff');
    expect(center).toContain("'CONSULTATION', 'HANDOFF'");
    expect(center).toContain('Accept consult');
    expect(center).toContain('Accept handoff');
  });

  test('consultant authority stores remain server-only', async () => {
    const rules = await source('firestore.rules');
    expect(rules).toContain('match /consultationRequests/{consultationId}');
    expect(rules).toContain('match /clinicalHandoffs/{handoffId}');
    expect(rules).toContain('allow read, write: if false');
  });

  test('worklist stays on the newer authoritative attention projection', async () => {
    const route = await source(
      'app/api/clinical/consultant/worklist/route.ts'
    );
    expect(route).toContain('ConsultantAttentionProjectionService');
    expect(route).not.toContain('ConsultantWorklistService');
  });
});
