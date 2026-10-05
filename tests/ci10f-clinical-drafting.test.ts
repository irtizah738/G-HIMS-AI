import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ClinicalDraftLifecycle,
  clinicalDraftContentHash,
} from '@/lib/clinical/intelligence/clinical-draft-lifecycle';
import type { GovernedClinicalDraft } from '@/types/clinical-draft';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function draft(): GovernedClinicalDraft {
  const title = 'SOAP draft';
  const content = 'Subjective\nEvidence-backed draft statement.';
  const contentHash = clinicalDraftContentHash(title, content);
  return {
    draftId: 'cdraft-ci10f',
    tenantId: 'tenant-ci10f',
    patientId: 'patient-ci10f',
    encounterId: 'enc-ci10f',
    careSetting: 'OPD',
    draftType: 'SOAP',
    status: 'GENERATED_REQUIRES_REVIEW',
    evidenceSnapshotId: 'cisnap-ci10f',
    evidenceSnapshotHash: 'snapshot-hash-ci10f',
    patient360Revision: 50,
    patient360SourceCheckpoint: '10000:evt-ci10f',
    generationPolicyVersion: 'ci10f-clinical-drafting-v1',
    generationProvenance: {
      provider: 'test-provider',
      model: 'test-model',
      purpose: 'CLINICAL_GOVERNED_DRAFT',
      generatedAt: 1_000,
    },
    generatedBy: 'doctor-generator',
    generatedAt: 1_000,
    currentRevisionId: 'cdraft-ci10f_r1',
    currentRevisionNumber: 1,
    currentTitle: title,
    currentContent: content,
    currentContentHash: contentHash,
    generatedContentHash: contentHash,
    warnings: [],
    claimCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    safety: {
      nonAuthoritativeUntilSigned: true,
      qualifiedClinicianReviewRequired: true,
      clinicianEditRequiredBeforeApproval: true,
      explicitApprovalRequired: true,
      signatureRequiredForAuthority: true,
      directClinicalMutationAllowed: false,
    },
  };
}

describe('CI-10F governed clinical drafting', () => {
  test('supports all six governed clinical draft types', async () => {
    const types = await source('types/clinical-draft.ts');
    for (const type of [
      'SOAP',
      'ENCOUNTER_SUMMARY',
      'HANDOVER',
      'DISCHARGE_SUMMARY',
      'REFERRAL',
      'PATIENT_INSTRUCTIONS',
    ]) {
      expect(types).toContain(`'${type}'`);
    }
  });

  test('generation cannot be approved without explicit clinician editing', () => {
    expect(() =>
      ClinicalDraftLifecycle.approve(
        draft(),
        { expectedRevisionNumber: 1, approvalAttestation: true },
        'doctor-reviewer',
        2_000
      )
    ).toThrow('CI10F_REVIEW_AND_EDIT_REQUIRED_BEFORE_APPROVAL');
  });

  test('review creates a new immutable revision and requires an actual edit', () => {
    const current = draft();

    expect(() =>
      ClinicalDraftLifecycle.reviewAndRevise(
        current,
        {
          expectedRevisionNumber: 1,
          content: current.currentContent,
        },
        'doctor-reviewer',
        2_000
      )
    ).toThrow('CI10F_CLINICIAN_EDIT_REQUIRED');

    const next = ClinicalDraftLifecycle.reviewAndRevise(
      current,
      {
        expectedRevisionNumber: 1,
        content: current.currentContent + '\nClinician confirmed history source.',
        reviewNote: 'Reviewed against encounter evidence.',
      },
      'doctor-reviewer',
      2_000
    );

    expect(next.draft.status).toBe('REVIEWED_EDITED');
    expect(next.draft.currentRevisionNumber).toBe(2);
    expect(next.revision.immutable).toBe(true);
    expect(next.revision.source).toBe('CLINICIAN_EDITED');
    expect(next.revision.createdBy).toBe('doctor-reviewer');
  });

  test('stale revision editing and approval fail closed', () => {
    const current = draft();
    expect(() =>
      ClinicalDraftLifecycle.reviewAndRevise(
        current,
        {
          expectedRevisionNumber: 0,
          content: 'edited',
        },
        'doctor-reviewer'
      )
    ).toThrow('CI10F_STALE_DRAFT_REVISION');
  });

  test('signature requires exact approved revision and explicit signature attestation', () => {
    const reviewed = ClinicalDraftLifecycle.reviewAndRevise(
      draft(),
      {
        expectedRevisionNumber: 1,
        content: 'Subjective\nClinician edited and verified this draft.',
      },
      'doctor-reviewer',
      2_000
    ).draft;

    const approved = ClinicalDraftLifecycle.approve(
      reviewed,
      { expectedRevisionNumber: 2, approvalAttestation: true },
      'doctor-approver',
      3_000
    );

    expect(() =>
      ClinicalDraftLifecycle.sign(
        approved,
        {
          expectedRevisionNumber: 2,
          signatureAttestation: false,
          evidenceId: 'ev-note',
          clinicalDocumentId: 'doc-note',
        },
        'doctor-signer',
        4_000
      )
    ).toThrow('CI10F_EXPLICIT_SIGNATURE_ATTESTATION_REQUIRED');

    const signed = ClinicalDraftLifecycle.sign(
      approved,
      {
        expectedRevisionNumber: 2,
        signatureAttestation: true,
        evidenceId: 'ev-note',
        clinicalDocumentId: 'doc-note',
      },
      'doctor-signer',
      4_000
    );

    expect(signed.status).toBe('SIGNED');
    expect(signed.signedEvidenceId).toBe('ev-note');
    expect(signed.signedClinicalDocumentId).toBe('doc-note');
  });

  test('an edit after approval invalidates approval and forces re-approval', () => {
    const reviewed = ClinicalDraftLifecycle.reviewAndRevise(
      draft(),
      {
        expectedRevisionNumber: 1,
        content: 'Clinician edited revision two.',
      },
      'doctor-reviewer',
      2_000
    ).draft;
    const approved = ClinicalDraftLifecycle.approve(
      reviewed,
      { expectedRevisionNumber: 2, approvalAttestation: true },
      'doctor-reviewer',
      3_000
    );
    const editedAgain = ClinicalDraftLifecycle.reviewAndRevise(
      approved,
      {
        expectedRevisionNumber: 2,
        content: 'Clinician edited revision three.',
      },
      'doctor-reviewer',
      4_000
    ).draft;

    expect(editedAgain.status).toBe('REVIEWED_EDITED');
    expect(editedAgain.approvedBy).toBeUndefined();
    expect(editedAgain.approvedContentHash).toBeUndefined();
    expect(() =>
      ClinicalDraftLifecycle.sign(
        editedAgain,
        {
          expectedRevisionNumber: 3,
          signatureAttestation: true,
          evidenceId: 'ev',
          clinicalDocumentId: 'doc',
        },
        'doctor-reviewer'
      )
    ).toThrow('CI10F_CURRENT_REVISION_NOT_APPROVED_FOR_SIGNATURE');
  });

  test('draft evidence uses authoritative encounter preparation plus consultations and handoffs', async () => {
    const loader = await source(
      'lib/clinical/intelligence/clinical-draft-evidence-loader.ts'
    );
    const evidence = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    expect(loader).toContain('EncounterPreparationEvidenceLoader.load');
    expect(loader).toContain("'consultationRequests'");
    expect(loader).toContain("'clinicalHandoffs'");
    expect(loader).toContain("'CLINICAL_CONSULTATION'");
    expect(loader).toContain("'CLINICAL_HANDOFF'");
    expect(evidence).toContain("purpose === 'CLINICAL_DRAFT'");
    expect(evidence).toContain('ClinicalDraftEvidenceLoader.load');
  });

  test('clinical generation fails closed and contains no fabricated clinical fallback', async () => {
    const gateway = await source('lib/ai/gateway.ts');

    expect(gateway).toContain('AI_PROVIDER_FAILURE_NO_SAFE_FALLBACK');
    expect(gateway).toContain("request.purpose !== 'SUPPLY_CHAIN_ANALYSIS'");
    for (const forbidden of [
      'Amlodipine 5mg oral daily',
      'Lisinopril 10mg oral daily',
      'Vitals stable.',
      'Schedule follow-up in 2 weeks.',
      "code: 'I10'",
      "code: 'E11.9'",
    ]) {
      expect(gateway).not.toContain(forbidden);
    }
  });

  test('draft generation is snapshot-grounded, claim-validated and replay-safe', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-draft-service.ts'
    );

    expect(service).toContain("'CLINICAL_DRAFT'");
    expect(service).toContain("'CLINICAL_GOVERNED_DRAFT'");
    expect(service).toContain('ClinicalEvidenceService.validateClaims');
    expect(service).toContain('CI10F_GROUNDING_REJECTED');
    expect(service).toContain('normalizedIdempotencyKey');
    expect(service).toContain('CI10F_IDEMPOTENCY_SCOPE_CONFLICT');
    expect(service).toContain("collection('clinicalDrafts')");
    expect(service).toContain("collection('clinicalDraftRevisions')");
    expect(service).toContain("eventType: 'CLINICAL_DRAFT_GENERATED'");
    expect(service).toContain("action: 'GENERATE_GOVERNED_CLINICAL_DRAFT'");
  });

  test('server command authority requires qualified clinician privilege and exact revision transitions', async () => {
    const domain = await source(
      'lib/backend/services/clinical-draft-domain-service.ts'
    );
    const schemas = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(domain).toContain("requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN']");
    expect(domain).not.toContain("requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN', 'SYSTEM_ADMIN']");
    expect(domain).toContain("requiredPrivilege: 'SIGN_CLINICAL_NOTES'");
    expect(domain).toContain('executeAtomicReadModifyMutation');
    expect(domain).toContain('CLINICAL_DRAFT_REVISION');
    expect(domain).toContain('CLINICAL_DOCUMENT');
    expect(domain).toContain('ENCOUNTER_EVIDENCE');

    for (const command of [
      'ReviewClinicalDraftCommand',
      'ApproveClinicalDraftCommand',
      'SignClinicalDraftCommand',
      'RejectClinicalDraftCommand',
    ]) {
      expect(schemas).toContain(command);
      expect(bus).toContain(command);
    }
  });

  test('legacy AI drafts cannot bypass CI-10F review/approval and client Firestore access stays denied', async () => {
    const documentation = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(documentation).toContain('CI10F_LEGACY_AI_DRAFT_SIGNING_DISABLED');
    expect(documentation).not.toContain('AIDraftRepository.buildAcceptedState');

    for (const collection of ['clinicalDrafts', 'clinicalDraftRevisions']) {
      const index = rules.indexOf(`match /${collection}/{`);
      expect(index).toBeGreaterThan(-1);
      expect(rules.slice(index, index + 170)).toContain(
        'allow read, write: if false'
      );
    }
  });

  test('governed signing creates authoritative evidence/document only at signature', async () => {
    const service = await source(
      'lib/backend/services/clinical-draft-domain-service.ts'
    );

    expect(service).toContain("eventType: 'CLINICAL_DRAFT_SIGNED'");
    expect(service).toContain("status: 'FINAL'");
    expect(service).toContain('buildCanonicalClinicalDocument');
    expect(service).toContain('evidenceSnapshotHash');
    expect(service).toContain('approvedContentHash');
    expect(service).not.toContain('prescribeMedication(');
    expect(service).not.toContain('dispenseMedication(');
    expect(service).not.toContain('PlaceDiagnosticOrderCommand');
  });
});
