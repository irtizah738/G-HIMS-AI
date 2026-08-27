/**
 * Patient Timeline Projection Model
 * Projects clinical event envelopes into a cohesive, chronological patient journey with dwell analysis.
 */

import {
  ClinicalEventEnvelope,
  ClinicalStageType,
  PatientTimelineProjection,
  TimelineCategory,
  TimelineMilestone,
  TimelineStageDwellMetric,
} from '@/types/clinical-workflow';
import { CompiledGeneralOpdWorkflow } from '../workflow/compiler';

export class TimelineProjector {
  /**
   * Projects a raw stream of clinical events into a high-level clinical timeline projection.
   */
  public static project(params: {
    patientId: string;
    patientMrn: string;
    patientName: string;
    encounterId: string;
    encounterType?: any;
    admitDate?: string;
    currentStage?: ClinicalStageType;
    events: ClinicalEventEnvelope[];
  }): PatientTimelineProjection {
    const sortedEvents = [...params.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const milestones: TimelineMilestone[] = [];
    let criticalAlertCount = 0;

    // Track stage dwell times
    const stageStartTimes: Partial<Record<ClinicalStageType, string>> = {};
    const stageEndTimes: Partial<Record<ClinicalStageType, string>> = {};

    for (const evt of sortedEvents) {
      const milestone = this.mapEventToMilestone(evt);
      if (milestone) {
        milestones.push(milestone);
        if (milestone.severity === 'CRITICAL') {
          criticalAlertCount++;
        }
      }

      // Track stage transitions
      if (evt.eventType === 'clinical.encounter.stage_transitioned') {
        const fromStage = evt.payload?.fromStage as ClinicalStageType;
        const toStage = evt.payload?.toStage as ClinicalStageType;
        if (fromStage) stageEndTimes[fromStage] = evt.timestamp;
        if (toStage) stageStartTimes[toStage] = evt.timestamp;
      } else if (evt.eventType === 'clinical.encounter.created') {
        stageStartTimes['REGISTRATION'] = evt.timestamp;
      }
    }

    // Build Dwell Metrics
    const dwellMetrics: TimelineStageDwellMetric[] = [];
    const stageKeys: ClinicalStageType[] = [
      'REGISTRATION',
      'TRIAGE',
      'CONSULTATION',
      'DIAGNOSTICS_LAB_RAD',
      'PHARMACY_DISPENSARY',
      'BILLING_SETTLEMENT',
      'DISCHARGE_OR_REFERRAL',
    ];

    let totalDurationMinutes = 0;

    for (const stage of stageKeys) {
      const started = stageStartTimes[stage];
      if (!started) continue;

      const ended = stageEndTimes[stage];
      const targetSla = CompiledGeneralOpdWorkflow.stageNodes[stage]?.targetSlaMinutes || 15;

      const durationMs = ended
        ? new Date(ended).getTime() - new Date(started).getTime()
        : Date.now() - new Date(started).getTime();

      const durationMinutes = Math.max(1, Math.round(durationMs / (1000 * 60)));
      totalDurationMinutes += durationMinutes;

      dwellMetrics.push({
        stage,
        startedAt: started,
        completedAt: ended,
        durationMinutes,
        slaTargetMinutes: targetSla,
        withinSla: durationMinutes <= targetSla,
      });
    }

    const firstEventTime = sortedEvents[0]?.timestamp || params.admitDate || new Date().toISOString();
    const currentStage =
      params.currentStage ||
      (sortedEvents[sortedEvents.length - 1]?.payload?.toStage as ClinicalStageType) ||
      'REGISTRATION';

    return {
      patientId: params.patientId,
      patientMrn: params.patientMrn,
      patientName: params.patientName,
      encounterId: params.encounterId,
      encounterType: params.encounterType || 'OPD_GENERAL',
      admitDate: firstEventTime,
      currentStage,
      totalDurationMinutes,
      milestones,
      dwellMetrics,
      criticalAlertCount,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Transforms a single clinical event envelope into a timeline milestone.
   */
  private static mapEventToMilestone(evt: ClinicalEventEnvelope): TimelineMilestone | null {
    const id = `ms_${evt.id}`;
    const timestamp = evt.timestamp;
    const authorName = evt.producer.userName;
    const authorRole = evt.producer.userRole;

    switch (evt.eventType) {
      case 'clinical.patient.registered':
        return {
          id,
          timestamp,
          category: 'REGISTRATION',
          title: 'Patient Registered in Master Index',
          summary: `Demographics verified. Assigned institutional MRN ${evt.payload?.mrn}`,
          severity: 'NORMAL',
          stage: 'REGISTRATION',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.encounter.created':
        return {
          id,
          timestamp,
          category: 'REGISTRATION',
          title: 'OPD Encounter Initiated',
          summary: `Queue Token #${evt.payload?.tokenNumber} issued for ${evt.payload?.department}. Complaint: "${evt.payload?.chiefComplaint || 'Routine consult'}"`,
          severity: 'NORMAL',
          stage: 'REGISTRATION',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.vitals.recorded': {
        const news2 = evt.payload?.news2Score ?? 0;
        const isCritical = news2 >= 5;
        return {
          id,
          timestamp,
          category: 'TRIAGE',
          title: isCritical ? `Critical Triage Alert (NEWS2: ${news2})` : `Vital Signs Recorded (NEWS2: ${news2})`,
          summary: `BP: ${evt.payload?.bloodPressure || '--'}, HR: ${evt.payload?.heartRate || '--'} bpm, SpO2: ${evt.payload?.oxygenSaturation || '--'}%, RR: ${evt.payload?.respiratoryRate || '--'}/m, Temp: ${evt.payload?.temperature || '--'}°C`,
          severity: isCritical ? 'CRITICAL' : news2 >= 3 ? 'WARNING' : 'NORMAL',
          stage: 'TRIAGE',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };
      }

      case 'clinical.consultation.soap_signed':
        return {
          id,
          timestamp,
          category: 'CLINICAL_NOTE',
          title: 'Physician Consultation & SOAP Note Signed',
          summary: `Assessment: ${evt.payload?.assessment || 'Completed clinical assessment'}. Primary Dx: ${evt.payload?.primaryDiagnosis || 'Under investigation'}`,
          severity: 'NORMAL',
          stage: 'CONSULTATION',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.diagnostics.ordered':
        return {
          id,
          timestamp,
          category: 'DIAGNOSTIC',
          title: 'Diagnostic Requisitions Placed',
          summary: `Tests ordered: ${Array.isArray(evt.payload?.tests) ? evt.payload.tests.join(', ') : 'Lab & Imaging panels'}`,
          severity: 'NORMAL',
          stage: 'DIAGNOSTICS_LAB_RAD',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.medication.dispensed':
        return {
          id,
          timestamp,
          category: 'MEDICATION',
          title: 'Prescriptions Dispensed & Verified',
          summary: `Medications fulfilled and patient counseling completed by pharmacy.`,
          severity: 'NORMAL',
          stage: 'PHARMACY_DISPENSARY',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.billing.settled':
        return {
          id,
          timestamp,
          category: 'BILLING',
          title: 'Encounter Invoice & Copay Settled',
          summary: `Invoice #${evt.payload?.invoiceNumber || 'INV-SETTLED'}. Total Copay Paid: $${evt.payload?.paidAmount || 0}`,
          severity: 'NORMAL',
          stage: 'BILLING_SETTLEMENT',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.encounter.discharged':
        return {
          id,
          timestamp,
          category: 'DISCHARGE',
          title: 'Patient Discharged & Encounter Closed',
          summary: `Formal exit completed. Follow-up: ${evt.payload?.followUp || 'As scheduled'}.`,
          severity: 'NORMAL',
          stage: 'DISCHARGE_OR_REFERRAL',
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      case 'clinical.encounter.stage_transitioned':
        return {
          id,
          timestamp,
          category: 'TRIAGE',
          title: `Stage Advanced: ${evt.payload?.fromStage} ➔ ${evt.payload?.toStage}`,
          summary: evt.payload?.notes || `Workflow advanced to ${evt.payload?.toStage}`,
          severity: 'NORMAL',
          stage: evt.payload?.toStage as ClinicalStageType,
          authorName,
          authorRole,
          dataPayload: evt.payload,
          rawEventId: evt.id,
        };

      default:
        return null;
    }
  }
}
