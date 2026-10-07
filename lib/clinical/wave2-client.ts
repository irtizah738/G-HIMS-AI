'use client';

import { executeCommand } from '@/lib/api/command-client';
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

type CommandPayload = Record<string, unknown>;

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
