import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pointerBlockers } from '@/lib/clinical/mpi/removal-care-pointer-blockers';

const source = (p: string) => readFile(path.join(process.cwd(), p), 'utf8');

describe('MPI authoritative care blockers for audited patient removal', () => {
  test('reports all active OPD/telehealth/IPD/emergency and legacy references', () => {
    const result = pointerBlockers({
      activeBedId: 'bed-7', activeEncounterId: 'old-encounter',
      activeCareContexts: {
        activeIpdEncounterId: 'ipd-1',
        activeEmergencyEncounterId: 'er-2',
        activeOpdEncounterIds: ['opd-3'],
        activeTelehealthEncounterIds: ['th-4'],
      },
    });
    expect(result.map(b => b.domain)).toEqual([
      'IPD', 'LEGACY', 'IPD', 'EMERGENCY', 'OPD', 'TELEHEALTH',
    ]);
    expect(result.find(b => b.domain === 'TELEHEALTH')?.encounterId).toBe('th-4');
    expect(result.find(b => b.source === 'ACTIVE_BED')?.status).toBe('BED_ASSIGNED');
  });

  test('unknown and malformed pointers fail closed', () => {
    const result = pointerBlockers({
      activeEncounterId: ['not-valid'],
      activeCareContexts: {
        activeIpdEncounterId: { id: 'bad' },
        activeTelehealthEncounterIds: ['valid', 8, '', null],
        activeOpdEncounterIds: 'not-an-array',
      },
    });
    expect(result.filter(b => b.status === 'POINTER_MALFORMED').length).toBe(6);
    expect(result.find(b => b.encounterId === 'valid')?.domain).toBe('TELEHEALTH');
  });

  test('empty active contexts contain no pointer blockers', () => {
    expect(pointerBlockers({
      activeCareContexts: { activeOpdEncounterIds: [], activeTelehealthEncounterIds: [] },
    })).toEqual([]);
  });

  test('readiness API requires verified admin and authoritative tenant Firestore', async () => {
    const route = await source('app/api/clinical/mpi/removal-readiness/route.ts');
    expect(route).toContain('deriveAuthoritativeContext(req, tenantId)');
    expect(route).toContain('AuthorizationPipeline.evaluate(context');
    expect(route).toContain("'ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'");
    expect(route).toContain("tenant.collection('patients').doc(patientId)");
    expect(route).toContain(".where('patientId', '==', patientId).limit(501)");
    expect(route).toContain('MPI_REMOVAL_READINESS_TOO_MANY_ENCOUNTERS');
    expect(route).toContain('pointerBlockers(patient)');
    expect(route).toContain('unresolvedRemovalEncounter(');
    expect(route).toContain('readyForRemoval: blockers.length === 0');
    expect(route).not.toContain('.delete(');
    expect(route).not.toContain('transaction.set(');
    expect(route).not.toContain('doc.ref.set(');
    expect(route).not.toContain('.add(');
    expect(route).not.toContain('.update(');

  });

  test('blocked submit never bypasses server and provides an actionable review button', async () => {
    const modal = await source('components/mpi/patient-record-removal-modal.tsx');
    expect(modal).toContain('mpi-removal-readiness-panel');
    expect(modal).toContain('mpi-removal-care-blockers');
    expect(modal).toContain('mpi-removal-refresh-blockers');
    expect(modal).toContain('Review clinical blockers');
    expect(modal).toContain('const canAttemptOrdinaryRemoval = valid && !removalBlocked && !inspectPending');
    expect(modal).toContain('if (!canAttemptOrdinaryRemoval)');
    expect(modal).toContain("type={canAttemptOrdinaryRemoval ? 'submit' : 'button'}");
    expect(modal).toContain("'RemovePatientRecordCommand'");
  });

  test('not allowlisting arbitrary mock-labelled patient for special retirement', async () => {
    const modal = await source('components/mpi/patient-record-removal-modal.tsx');
    expect(modal).toContain("patient.mrn === 'MRN-20260820-8790'");
    expect(modal).toContain("patient.mrn === 'MRN-20260930-3611'");
    expect(modal).not.toContain("patient.mrn === 'GH-2026-9812'");
    expect(modal).toContain('RetireConfirmedMockPatientCommand');
  });
});
