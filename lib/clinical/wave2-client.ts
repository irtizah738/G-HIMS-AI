'use client';

import { executeCommand } from '@/lib/api/command-client';
import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import type {
  EmarScheduleSlot,
  RehabilitationPlan,
  RehabilitationSession,
  RenalDialysisOrder,
  RenalDialysisSession,
  ObstetricEpisode,
  ObstetricPartogramEntry,
  OncologyCase,
  OncologyRegimen,
  OncologyToxicityAssessment,
  TumorBoardRecommendation,
  NursingCarePlanRecord,
} from '@/types/wave2-clinical-domains';

export interface Wave2WorkspaceSnapshot {
  tenantId: string;
  patientId: string;
  encounterId: string;
  generatedAt: number;
  encounter: Record<string, unknown>;
  activeMedicationOrders: Record<string, unknown>[];
  emarScheduleSlots: Record<string, unknown>[];
  overdueMedicationSlots: Record<string, unknown>[];
  medicationAdministrations: Record<string, unknown>[];
  nursingCarePlans: Record<string, unknown>[];
  renalDialysisOrders: Record<string, unknown>[];
  renalDialysisSessions: Record<string, unknown>[];
  obstetricEpisodes: Record<string, unknown>[];
  obstetricPartogramEntries: Record<string, unknown>[];
  oncologyCases: Record<string, unknown>[];
  oncologyTumorBoardRecommendations: Record<string, unknown>[];
  oncologyRegimens: Record<string, unknown>[];
  oncologyChemotherapyLinks: Record<string, unknown>[];
  oncologyToxicityAssessments: Record<string, unknown>[];
  rehabilitationPlans: Record<string, unknown>[];
  rehabilitationSessions: Record<string, unknown>[];
  acceptedClinicalHandoffs: Record<string, unknown>[];
  oncologyEvidenceSources: Array<{
    evidenceId: string;
    evidenceType: string;
    label: string;
  }>;
}

type CommandPayload = Record<string, unknown>;

export async function fetchWave2Workspace(
  tenantId: string,
  patientId: string,
  encounterId: string
): Promise<Wave2WorkspaceSnapshot> {
  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();
  if (!currentUser || !cached) {
    throw new Error('AUTHENTICATION_REQUIRED: active G-HIMS session is required.');
  }
  if (cached.user.tenantId !== tenantId) {
    throw new Error('TENANT_MISMATCH: active session does not match requested tenant.');
  }

  const idToken = await currentUser.getIdToken(false);
  const query = new URLSearchParams({ tenantId, patientId, encounterId });
  const response = await fetch(`/api/clinical/wave2/workspace?${query.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'x-ghims-tenant-id': tenantId,
      'x-ghims-session-id': cached.session.sessionId,
      ...(cached.session.deviceId
        ? { 'x-ghims-device-id': cached.session.deviceId }
        : {}),
    },
  });
  const body = (await response.json()) as Wave2WorkspaceSnapshot & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || 'Wave 2 workspace could not be loaded.');
  }
  return body;
}

async function run<T>(
  tenantId: string,
  commandType: string,
  payload: CommandPayload,
  options?: {
    offlineCollection?: string;
    offlineResourceId?: string;
  }
) {
  return executeCommand<T>({
    tenantId,
    commandType,
    payload,
    ...(options?.offlineCollection && options.offlineResourceId
      ? {
          offlineQueue: {
            enabled: true,
            collection: options.offlineCollection,
            resourceId: options.offlineResourceId,
            action: 'CREATE',
            optimisticCache: false,
          },
        }
      : {}),
  });
}

export const wave2Client = {
  scheduleMedication(
    tenantId: string,
    payload: {
      patientId: string;
      encounterId: string;
      medicationOrderId: string;
      scheduledFor: number;
      toleranceMinutes?: number;
    }
  ) {
    return run<EmarScheduleSlot>(
      tenantId,
      'ScheduleMedicationAdministrationCommand',
      payload
    );
  },

  administerMedication(
    tenantId: string,
    payload: {
      patientId: string;
      encounterId: string;
      emarSlotId: string;
      outcome: 'GIVEN' | 'HELD' | 'REFUSED' | 'MISSED' | 'DELAYED';
      administeredAt?: number;
      reason?: string;
      expectedMedicationOrderVersion?: number;
    }
  ) {
    const deterministicAdministrationId = `medadm_${payload.emarSlotId}`;
    return run<Record<string, unknown>>(
      tenantId,
      'AdministerScheduledMedicationCommand',
      payload,
      {
        offlineCollection: 'medicationAdministrations',
        offlineResourceId: deterministicAdministrationId,
      }
    );
  },

  createNursingCarePlan(
    tenantId: string,
    payload: {
      patientId: string;
      encounterId: string;
      title: string;
      problems?: string[];
      goals: string[];
      interventions: Array<{ description: string; scheduledAt?: number }>;
    }
  ) {
    return run<NursingCarePlanRecord>(
      tenantId,
      'CreateNursingCarePlanCommand',
      payload
    );
  },

  updateNursingIntervention(
    tenantId: string,
    payload: {
      patientId: string;
      encounterId: string;
      carePlanId: string;
      interventionId: string;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    }
  ) {
    return run<NursingCarePlanRecord>(
      tenantId,
      'UpdateNursingCarePlanInterventionCommand',
      payload
    );
  },

  createDialysisOrder(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RenalDialysisOrder>(
      tenantId,
      'CreateDialysisOrderCommand',
      payload
    );
  },

  startDialysisSession(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RenalDialysisSession>(
      tenantId,
      'StartDialysisSessionCommand',
      payload
    );
  },

  completeDialysisSession(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RenalDialysisSession>(
      tenantId,
      'CompleteDialysisSessionCommand',
      payload
    );
  },

  createObstetricEpisode(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<ObstetricEpisode>(
      tenantId,
      'CreateObstetricEpisodeCommand',
      payload
    );
  },

  recordPartogramObservation(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<ObstetricPartogramEntry>(
      tenantId,
      'RecordPartogramObservationCommand',
      payload
    );
  },

  transitionObstetricEpisode(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<ObstetricEpisode>(
      tenantId,
      'TransitionObstetricEpisodeCommand',
      payload
    );
  },

  recordDeliveryOutcome(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<ObstetricEpisode>(
      tenantId,
      'RecordDeliveryOutcomeCommand',
      payload
    );
  },

  openOncologyCase(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<OncologyCase>(
      tenantId,
      'OpenOncologyCaseCommand',
      payload
    );
  },

  recordTumorBoardRecommendation(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<TumorBoardRecommendation>(
      tenantId,
      'RecordTumorBoardRecommendationCommand',
      payload
    );
  },

  approveOncologyRegimen(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<OncologyRegimen>(
      tenantId,
      'ApproveOncologyRegimenCommand',
      payload
    );
  },

  linkChemotherapyAdministration(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<Record<string, unknown>>(
      tenantId,
      'LinkChemotherapyAdministrationCommand',
      payload
    );
  },

  recordOncologyToxicity(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<OncologyToxicityAssessment>(
      tenantId,
      'RecordOncologyToxicityCommand',
      payload
    );
  },

  createRehabilitationPlan(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RehabilitationPlan>(
      tenantId,
      'CreateRehabilitationPlanCommand',
      payload
    );
  },

  recordRehabilitationSession(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RehabilitationSession>(
      tenantId,
      'RecordRehabilitationSessionCommand',
      payload
    );
  },

  updateRehabilitationGoal(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RehabilitationPlan>(
      tenantId,
      'UpdateRehabilitationGoalCommand',
      payload
    );
  },

  completeRehabilitationPlan(
    tenantId: string,
    payload: CommandPayload
  ) {
    return run<RehabilitationPlan>(
      tenantId,
      'CompleteRehabilitationPlanCommand',
      payload
    );
  },
};
