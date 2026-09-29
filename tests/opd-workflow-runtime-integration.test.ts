import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('OPD clinical workflow runtime integration', () => {
  test('workflow runtime is not exposed as a clinician-facing OPD module', async () => {
    const opdView = await source('components/views/opd-encounters-view.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const directory = await source('components/views/all-modules-directory.tsx');

    expect(opdView).not.toContain('Clinical Workflow Runtime Studio');
    expect(opdView).not.toContain('Backend Workflow DAG Engine');
    expect(opdView).not.toContain('dag_backend');
    expect(opdView).not.toContain('WorkflowRuntimeView');

    expect(workspace).not.toContain('DAG_ENGINE');
    expect(workspace).not.toContain('WorkflowRuntimeView');
    expect(directory).not.toContain("id: 'workflow-runtime'");
  });

  test('OPD stage changes remain governed by the server-owned compiled DAG', async () => {
    const runtime = await source(
      'lib/backend/services/opd-workflow-runtime-service.ts'
    );
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );

    expect(runtime).toContain('CompiledGeneralOpdWorkflow');
    expect(runtime).toContain('WorkflowCompiler.isDirectTransitionAllowed');
    expect(runtime).toContain('OPD_DAG_TRANSITION_BLOCKED');
    expect(runtime).toContain('OPD_TRANSITION_EVIDENCE_REQUIRED');

    expect(encounter).toContain('OpdWorkflowRuntimeService.validateTransition');
    expect(encounter).toContain("encounter.encounterType === 'OPD'");
  });

  test('OPD UI fails closed when authoritative workflow transition is rejected', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain(
      'Clinical workflow runtime blocked transition from triage to consultation.'
    );
    expect(workspace).toContain(
      'Clinical workflow runtime blocked transition from consultation to diagnostics.'
    );
    expect(workspace).not.toContain('Non-blocking stage advance notice');
    expect(workspace).not.toContain('Non-blocking consultation stage transition notice');
  });

  test('MPI, transaction and outbox orchestration remain backend concerns', async () => {
    const commandBus = await source('lib/backend/commands/command-bus.ts');
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );
    const registration = await source('lib/runtime/registration-orchestrator.ts');

    expect(commandBus).toContain("'AdvanceStageCommand'");
    expect(encounter).toContain('TransactionManager.executeAtomicMutation');
    expect(encounter).toContain("outboxTopic: 'g-hims-clinical-events'");
    expect(registration).toContain('register');
  });
});
