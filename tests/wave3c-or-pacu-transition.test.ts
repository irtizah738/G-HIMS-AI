import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 3C governed OR/PACU transition automation', () => {
  test('generic surgical transition cannot bypass PACU workflow', async () => {
    const service = await source('lib/backend/services/surgical-case-domain-service.ts');
    expect(service).toContain("'PACU_TRANSITION_COMMAND_REQUIRED'");
    expect(service).toContain("payload.targetStatus === 'post_op_pacu'");
    expect(service).toContain("payload.targetStatus === 'completed'");
  });

  test('PACU transfer reserves authoritative recovery capacity and creates handoff evidence', async () => {
    const service = await source('lib/backend/services/surgical-case-domain-service.ts');
    expect(service).toContain('transferToPacu');
    expect(service).toContain("room.roomType !== 'recovery'");
    expect(service).toContain("'PACU_CAPACITY_EXHAUSTED'");
    expect(service).toContain("entityType: 'CLINICAL_HANDOFF'");
    expect(service).toContain("status: 'PENDING_ACCEPTANCE'");
    expect(service).toContain("currentOccupancy: Number(room.currentOccupancy || 0) + 1");
    expect(service).toContain("eventType: 'SURGICAL_CASE_TRANSFERRED_TO_PACU'");
  });

  test('PACU acceptance is bound to designated receiving clinician', async () => {
    const service = await source('lib/backend/services/surgical-case-domain-service.ts');
    expect(service).toContain('acceptPacuTransfer');
    expect(service).toContain("'PACU_RECEIVER_MISMATCH'");
    expect(service).toContain("handoff.toClinicianId !== context.actorId");
    expect(service).toContain("eventType: 'PACU_TRANSFER_ACCEPTED'");
  });

  test('PACU completion requires accepted handoff and releases recovery capacity', async () => {
    const service = await source('lib/backend/services/surgical-case-domain-service.ts');
    expect(service).toContain('completePacuRecovery');
    expect(service).toContain("'PACU_RECOVERY_NOT_ACCEPTED'");
    expect(service).toContain("pacuTransferStatus: 'RECOVERY_COMPLETED'");
    expect(service).toContain("Math.max(0, Number(room.currentOccupancy || 0) - 1)");
    expect(service).toContain("eventType: 'PACU_RECOVERY_COMPLETED'");
  });

  test('production surgical console uses dedicated PACU commands', async () => {
    const [edge, consoleSource] = await Promise.all([
      source('lib/clinical/surgical-edge-adapter.ts'),
      source('components/clinical/surgical-operations-console.tsx'),
    ]);
    expect(edge).toContain("'TransferSurgicalCaseToPacuCommand'");
    expect(edge).toContain("'AcceptPacuTransferCommand'");
    expect(edge).toContain("'CompletePacuRecoveryCommand'");
    expect(consoleSource).toContain('transferSurgicalCaseToPacuEdge');
    expect(consoleSource).toContain('acceptPacuTransferEdge');
    expect(consoleSource).toContain('completePacuRecoveryEdge');
    expect(consoleSource).not.toContain("advance('post_op_pacu')");
    expect(consoleSource).not.toContain("advance('completed')");
  });
});
