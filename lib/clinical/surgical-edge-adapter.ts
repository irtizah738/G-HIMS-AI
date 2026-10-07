'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
  type EdgeSnapshot,
} from '@/lib/offline/hydration';
import type { SurgicalCase } from '@/types/inpatient-or';
import type { HospitalRoom } from '@/types/resource-management';
import type { PatientMPI } from '@/types/mpi';
import type { EncounterRuntime } from '@/types/encounter-runtime';
import type { StaffMember } from '@/lib/types/ghims';

export type GovernedSurgicalCase = SurgicalCase & {
  facilityId?: string;
  departmentId?: string;
  encounterId?: string;
  safetyChecklistEvidence?: {
    signIn?: { completed: boolean; evidenceSummary: string; verifiedByActorId: string; verifiedAt: string };
    timeOut?: { completed: boolean; evidenceSummary: string; verifiedByActorId: string; verifiedAt: string };
    signOut?: { completed: boolean; evidenceSummary: string; verifiedByActorId: string; verifiedAt: string };
  };
  pacuRoomId?: string;
  pacuHandoffId?: string;
  pacuTransferStatus?: 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'RECOVERY_COMPLETED';
  pacuAcceptedBy?: string;
  pacuRecoveryAssessment?: string;
  pacuDisposition?: 'WARD' | 'ICU' | 'DISCHARGE';
};

export interface SurgicalEdgeProjection {
  cases: GovernedSurgicalCase[];
  rooms: HospitalRoom[];
  patients: PatientMPI[];
  encounters: EncounterRuntime[];
  staff: StaffMember[];
  source: 'LOCAL' | 'SERVER';
}

function rows<T>(snapshot: EdgeSnapshot, collection: string): T[] {
  return (snapshot.collections?.[collection] || []) as unknown as T[];
}

function adapt(snapshot: EdgeSnapshot): SurgicalEdgeProjection {
  return {
    cases: rows<GovernedSurgicalCase>(snapshot, 'surgicalCases'),
    rooms: rows<HospitalRoom>(snapshot, 'rooms').filter((room) =>
      ['operating_room', 'procedure', 'recovery'].includes(String(room.roomType || ''))
    ),
    patients: rows<PatientMPI>(snapshot, 'patients'),
    encounters: rows<EncounterRuntime>(snapshot, 'encounters'),
    staff: rows<StaffMember>(snapshot, 'staff'),
    source: snapshot.source,
  };
}

export async function loadLocalSurgicalProjection(
  tenantId: string
): Promise<SurgicalEdgeProjection> {
  return adapt(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateSurgicalProjection(
  tenantId: string
): Promise<SurgicalEdgeProjection> {
  return adapt(await hydrateEdgeSnapshot(tenantId));
}

async function run<T>(
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const result = await executeActiveTenantCommand<T>(commandType, payload, {
    idempotencyKey,
    schemaVersion: 1,
  });

  if (!result.success) {
    throw new Error(result.error?.message || `${commandType} failed.`);
  }
  return result.data as T;
}

export const scheduleSurgicalCaseEdge = (
  payload: {
    patientId: string;
    encounterId: string;
    roomId: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
    procedureName: string;
    urgency: 'elective' | 'urgent' | 'emergency';
    anesthesiaType?: 'general' | 'regional' | 'local' | 'mac' | 'sedation';
    surgeonEmployeeId?: string;
    notes?: string;
  },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('ScheduleSurgicalCaseCommand', payload, idempotencyKey);

export const recordSurgicalChecklistEdge = (
  payload: {
    caseId: string;
    phase: 'SIGN_IN' | 'TIME_OUT' | 'SIGN_OUT';
    completed: boolean;
    evidenceSummary: string;
  },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('RecordSurgicalSafetyChecklistCommand', payload, idempotencyKey);

export const advanceSurgicalCaseEdge = (
  payload: {
    caseId: string;
    targetStatus: 'pre_op' | 'intra_op' | 'post_op_pacu' | 'completed';
  },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('AdvanceSurgicalCaseCommand', payload, idempotencyKey);

export const transferSurgicalCaseToPacuEdge = (
  payload: {
    caseId: string;
    pacuRoomId: string;
    receivingClinicianId: string;
    handoffSummary: string;
    activeRisks?: string[];
    medicationConcerns?: string[];
    expectedActions?: string[];
  },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('TransferSurgicalCaseToPacuCommand', payload, idempotencyKey);

export const acceptPacuTransferEdge = (
  payload: { caseId: string; handoffId: string },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('AcceptPacuTransferCommand', payload, idempotencyKey);

export const completePacuRecoveryEdge = (
  payload: {
    caseId: string;
    recoveryAssessment: string;
    disposition: 'WARD' | 'ICU' | 'DISCHARGE';
  },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('CompletePacuRecoveryCommand', payload, idempotencyKey);

export const cancelSurgicalCaseEdge = (
  payload: { caseId: string; reason: string },
  idempotencyKey?: string
) => run<GovernedSurgicalCase>('CancelSurgicalCaseCommand', payload, idempotencyKey);
