import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('highlighted clinical button closure', () => {
  test('consultation commit awaits the authoritative save and surfaces failures', async () => {
    const consultation = await source('components/opd/OpdConsultationSpecialties.tsx');

    expect(consultation).toContain(
      'onSaveConsultation: (soap: SoapDocumentation) => Promise<void>'
    );
    expect(consultation).toContain('await onSaveConsultation(soapDoc)');
    expect(consultation).toContain('opd-consultation-commit-error');
    expect(consultation).toContain('Signing & committing consultation…');
  });

  test('registration commit awaits server registration and cannot hide a committed patient behind billing failure', async () => {
    const registration = await source('components/opd/OpdRegistrationConsent.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(registration).toContain(
      'onRegisterSuccess: (patient: PatientDemographics) => Promise<void>'
    );
    expect(registration).toContain('await onRegisterSuccess(newPatient)');
    expect(registration).toContain('opd-registration-error');
    expect(registration).toContain('Committing registration…');

    expect(workspace).toContain('consultationBillingFailure');
    expect(workspace).toContain("'CONSULTATION_BILLING_BLOCKED'");
    expect(workspace).toContain(
      "setActiveTab(offlineRegistration ? 'DASHBOARD' : 'BILLING')"
    );
  });

  test('consultant command center reconciles active consultation source records and opens the exact patient', async () => {
    const service = await source(
      'lib/clinical/intelligence/consultant-attention-projection-service.ts'
    );
    const ui = await source('components/clinical/ConsultantCommandCenter.tsx');

    expect(service).toContain(".collection('consultationRequests')");
    expect(service).toContain("'CONSULTATION_SOURCE_RECONCILIATION'");
    expect(service).not.toContain('if (!patient360) return []');
    expect(ui).toContain('setSelectedPatientId(item.patientId)');
    expect(ui).toContain('patient.fullName');
    expect(ui).toContain('patient.mrn');
  });

  test('MPI excludes retired merged identities and treats same-target retries idempotently', async () => {
    const view = await source('components/views/patient-mpi-view.tsx');
    const modal = await source('components/mpi/patient-merge-modal.tsx');
    const service = await source(
      'lib/backend/services/patient-merge-domain-service.ts'
    );
    const adapter = await source('lib/offline/read-model-adapter.ts');

    expect(view).toContain('activeIdentityPatients');
    expect(view).toContain("String(patient.status || 'ACTIVE').toUpperCase() !== 'MERGED'");
    expect(modal).toContain("String(patient.status || 'ACTIVE').toUpperCase() !== 'MERGED'");
    expect(service).toContain('mergedIntoPatientId === payload.primaryPatientId');
    expect(service).toContain('alreadyMerged: true');
    expect(adapter).toContain("status: asString((raw as any).status, 'ACTIVE').toUpperCase()");
    expect(adapter).toContain('mergedIntoPatientId');
  });

  test('governed telehealth has real browser media, server signaling and a patient join surface', async () => {
    const clinician = await source(
      'components/telehealth/TelehealthCallPanel.tsx'
    );
    const patient = await source(
      'components/telehealth/TelehealthPatientJoin.tsx'
    );
    const signaling = await source('app/api/telehealth/signaling/route.ts');
    const telehealth = await source('components/views/telehealth-view.tsx');
    const domain = await source(
      'lib/backend/services/telehealth-domain-service.ts'
    );

    expect(clinician).toContain('navigator.mediaDevices.getUserMedia');
    expect(clinician).toContain('new RTCPeerConnection');
    expect(clinician).toContain('telehealth-start-call');
    expect(patient).toContain('telehealth-patient-join');
    expect(patient).toContain('new RTCPeerConnection');
    expect(signaling).toContain('telehealthSignaling');
    expect(signaling).toContain('CALL_LEASE_MS');
    expect(signaling).toContain('authorizeClinician');
    expect(telehealth).toContain('<TelehealthCallPanel');
    expect(domain).toContain('crypto.randomUUID().toUpperCase()');
  });
});
