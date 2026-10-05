import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('CI-10G clinician-facing copilot workspace', () => {
  test('Patient 360 exposes one canonical CI-10 workspace instead of separate intelligence islands', async () => {
    const patient360 = await source('components/patient360/Patient360View.tsx');

    expect(patient360).toContain('ClinicalCopilotWorkspace');
    expect(patient360).toContain('currentSourceCheckpoint={freshness.sourceCheckpoint}');
    expect(patient360).not.toContain('ClinicalLongitudinalSummaryPanel');
    expect(patient360).not.toContain('ClinicalTrendIntelligencePanel');
    expect(patient360).not.toContain('MedicationReconciliationCopilotPanel');
  });

  test('workspace composes CI-10B/C/D/E and CI-10F without creating a new clinical authority backend', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );

    for (const boundary of [
      'generateLongitudinalClinicalSummary',
      'generateEncounterPreparationBrief',
      'generateClinicalTrendIntelligence',
      'generateMedicationReconciliationCopilot',
      'GovernedClinicalDraftPanel',
      'ClinicalCopilotEvidencePanel',
    ]) {
      expect(workspace).toContain(boundary);
    }

    expect(workspace).not.toContain("from 'firebase/firestore'");
    expect(workspace).not.toContain("from 'firebase-admin");
    expect(workspace).not.toContain('/api/gemini/copilot');
    expect(workspace).not.toContain('/api/ai/soap');
    expect(workspace).not.toContain('SignClinicalNoteCommand');
    expect(workspace).not.toContain('PrescribeMedicationCommand');
    expect(workspace).not.toContain('PlaceDiagnosticOrderCommand');
  });

  test('workspace never auto-generates intelligence on mount and explicitly blocks offline generation', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );

    expect(workspace).toContain('if (offline)');
    expect(workspace).toContain(
      'Fresh clinical intelligence requires authoritative server connectivity.'
    );
    expect(workspace).toContain(
      'CI-10G will not generate new summaries, trends'
    );
    expect(workspace).not.toContain('void refreshAll();');
    expect(workspace).toContain(
      "useEffect(() => {\n    setArtifacts(EMPTY_ARTIFACTS);"
    );
  });

  test('artifact freshness is bound to both Patient 360 revision and source checkpoint', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );

    expect(workspace).toContain('revision !== currentRevision');
    expect(workspace).toContain(
      'artifactCheckpoint(key) !== currentSourceCheckpoint'
    );
    expect(workspace).toContain("return 'STALE'");
  });

  test('drafting UI preserves explicit clinician edit, approval and signature attestations', async () => {
    const panel = await source(
      'components/patient360/GovernedClinicalDraftPanel.tsx'
    );

    for (const operation of [
      'generateGovernedClinicalDraft',
      'reviewGovernedClinicalDraft',
      'approveGovernedClinicalDraft',
      'signGovernedClinicalDraft',
      'rejectGovernedClinicalDraft',
    ]) {
      expect(panel).toContain(operation);
    }

    expect(panel).toContain('approvalAttestation');
    expect(panel).toContain('signatureAttestation');
    expect(panel).toContain("draft.status === 'REVIEWED_EDITED'");
    expect(panel).toContain("draft.status === 'APPROVED_FOR_SIGNATURE'");
    expect(panel).toContain(
      'Approval is intentionally unavailable until the clinician makes'
    );
    expect(panel).toContain(
      'accept clinical responsibility for its'
    );
  });

  test('draft mutations route through the authoritative command client and are not offline-queued', async () => {
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );

    for (const command of [
      'ReviewClinicalDraftCommand',
      'ApproveClinicalDraftCommand',
      'SignClinicalDraftCommand',
      'RejectClinicalDraftCommand',
    ]) {
      expect(client).toContain(command);
    }

    expect(client).toContain("import { executeCommand } from '@/lib/api/command-client'");
    expect(client).toContain('/api/clinical/intelligence/drafts');
    expect(client).not.toContain("offlineQueue: {");
  });

  test('workspace exposes traceable provenance without treating evidence as authority', async () => {
    const evidence = await source(
      'components/patient360/ClinicalCopilotEvidencePanel.tsx'
    );
    const workspaceTypes = await source(
      'types/clinical-copilot-workspace.ts'
    );

    expect(evidence).toContain('EVENT_VERIFIED');
    expect(evidence).toContain('Content hash');
    expect(evidence).toContain('Source events');
    expect(evidence).toContain('review-only');
    expect(workspaceTypes).toContain("'EVIDENCE'");
    expect(workspaceTypes).toContain("'STALE'");
    expect(workspaceTypes).toContain("'UNAVAILABLE_OFFLINE'");
  });

  test('legacy contextless copilot drawers are no longer mounted by primary tenant surfaces', async () => {
    const dashboard = await source('components/tenant-dashboard.tsx');
    const shell = await source('components/tenant/tenant-shell-header.tsx');

    for (const legacy of [
      'AiCopilotDrawer',
      'ClinicalCopilotDrawer',
      'FloatingCopilotBot',
    ]) {
      expect(dashboard).not.toContain(legacy);
      expect(shell).not.toContain(legacy);
    }

    expect(dashboard).not.toContain('Cmd/Ctrl + J -> AI Copilot');
  });

  test('workspace refresh never includes clinical drafting in bulk generation', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );

    expect(workspace).toContain(
      "const keys: Array<Exclude<ClinicalCopilotArtifactKey, 'DRAFT'>>"
    );
    expect(workspace).toContain(
      'The only path to authoritative'
    );
  });
});
