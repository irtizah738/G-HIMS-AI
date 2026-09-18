/**
 * G-HIMS EMS Radio & Clinical Intercom Gateway Adapter
 * Strictly enforces §16: Authoritative logging and physician order transmission over pre-hospital channels.
 *
 * Implements:
 * - Communication adapter interface
 * - DEMO vs PRODUCTION execution modes
 * - Medical order verbal authorization with readback acknowledgement
 * - Tamper-evident communication audit trails
 */

import { CommandContext } from '../backend/types';
import { TransactionManager } from '../backend/transactions/transaction-manager';

export type ChannelType = 'HEAR_RADIO' | 'MED_NET_TACTICAL' | 'SAT_PHONE' | 'SECURE_VOIP_BRIDGE';

export interface RadioTransmission {
  transmissionId: string;
  channel: ChannelType;
  direction: 'INBOUND_TO_HOSPITAL' | 'OUTBOUND_TO_AMBULANCE';
  sender: {
    unitId: string;
    callsign: string;
    operatorRole: 'PARAMEDIC' | 'EMT' | 'ATTENDING_PHYSICIAN' | 'TRIAGE_NURSE';
    operatorName: string;
  };
  recipient: {
    stationId: string;
    operatorRole: string;
    operatorName: string;
  };
  timestamp: string;
  patientBinding?: {
    mrn?: string;
    encounterId?: string;
  };
  contentSummary: string;
  verbalMedicalOrder?: {
    orderType: 'MEDICATION_ADMINISTRATION' | 'PROCEDURE_AUTHORIZATION' | 'DESTINATION_DIVERSION';
    details: string;
    authorizingPhysicianId: string;
    authorizingPhysicianName: string;
    readbackConfirmed: boolean;
    acknowledgedAt: string;
  };
  audioRecordingUri?: string;
  audioDurationSeconds: number;
}

export class RadioIntercomAdapter {
  private static transmissions = new Map<string, RadioTransmission>();

  /**
   * Logs an incoming or outgoing pre-hospital radio transmission with medical order verification.
   */
  public static async logTransmission(
    context: CommandContext,
    transmission: Omit<RadioTransmission, 'transmissionId' | 'timestamp'>,
    mode: 'DEMO_MODE' | 'PRODUCTION_MODE' = 'PRODUCTION_MODE'
  ): Promise<{
    success: boolean;
    transmission?: RadioTransmission;
    error?: { code: string; message: string };
  }> {
    const timestamp = new Date().toISOString();
    const transmissionId = `rad_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Order verification rule: Medical orders must have readback confirmation
    if (transmission.verbalMedicalOrder && !transmission.verbalMedicalOrder.readbackConfirmed) {
      return {
        success: false,
        error: {
          code: 'READBACK_CONFIRMATION_REQUIRED',
          message: 'Clinical orders given via pre-hospital radio require verbal readback confirmation by the receiving crew.',
        },
      };
    }

    const record: RadioTransmission = {
      ...transmission,
      transmissionId,
      timestamp,
    };

    this.transmissions.set(transmissionId, record);

    // Record immutable audit event
    await TransactionManager.executeAtomicWrite(
      context,
      `cmd_${transmissionId}`,
      `idemp_${transmissionId}`,
      {
        entityType: 'RADIO_TRANSMISSION',
        entityId: transmissionId,
        eventType: 'EMS_RADIO_ORDER_TRANSMITTED',
        domainState: record,
        eventPayload: {
          transmissionId,
          channel: record.channel,
          direction: record.direction,
          sender: record.sender,
          recipient: record.recipient,
          patientBinding: record.patientBinding,
          hasMedicalOrder: !!record.verbalMedicalOrder,
          mode,
        },
        auditReason: `Pre-hospital transmission logged on ${record.channel} from ${record.sender.callsign}`,
        outboxTopic: 'g-hims-intercom-events',
      }
    );

    return { success: true, transmission: record };
  }

  public static getTransmissions(): RadioTransmission[] {
    return Array.from(this.transmissions.values());
  }
}
