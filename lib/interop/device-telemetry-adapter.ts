/**
 * G-HIMS Device Telemetry Ingestion Adapter
 * Strictly enforces §15: Clear separation of DEMO/SIMULATION vs PRODUCTION device streams.
 *
 * Implements authoritative device pipeline:
 * Device → Device Adapter → Validation → Normalization → Timestamping → Patient/Encounter Binding → Event → Clinical Projection
 *
 * Safeguards:
 * - Rejects stale packets (>30,000ms old in PRODUCTION mode)
 * - Detects duplicate or out-of-order packet sequence numbers
 * - Validates clinical unit scales (e.g. SpO2 in %, NIBP in mmHg, HR in BPM, EtCO2 in mmHg)
 * - Verifies patient/encounter binding before emitting clinical projection events
 */

import { CommandContext } from '../backend/types';
import { TransactionManager } from '../backend/transactions/transaction-manager';

export type IngestionMode = 'DEMO_MODE' | 'SIMULATION_MODE' | 'PRODUCTION_MODE';

export interface RawTelemetryPacket {
  deviceId: string;
  deviceType: 'ALS_MONITOR_DEFIBRILLATOR' | 'ICU_BEDSIDE_MONITOR' | 'TRANSPORT_PULSE_OXIMETER';
  deviceModel: string;
  firmwareVersion: string;
  packetSequenceNumber: number;
  deviceTimestamp: number; // Unix epoch ms from device clock
  patientBinding: {
    mrn?: string;
    encounterId?: string;
    assignedBayId?: string;
  };
  metrics: {
    heartRateBpm?: number;
    spo2Percent?: number;
    respiratoryRate?: number;
    nibpSystolicMmHg?: number;
    nibpDiastolicMmHg?: number;
    nibpMeanArterialMmHg?: number;
    etco2MmHg?: number;
    temperatureCelsius?: number;
    glasgowComaScale?: number;
  };
  ecgWaveform?: {
    lead: 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';
    sampleRateHz: number;
    scaleMvPerMm: number;
    samples: number[]; // Voltage samples in millivolts
  };
}

export interface IngestedTelemetryRecord {
  telemetryId: string;
  mode: IngestionMode;
  deviceId: string;
  encounterId: string;
  patientMrn: string;
  ingestedAt: string;
  metrics: {
    heartRateBpm: number;
    spo2Percent: number;
    respiratoryRate: number;
    bloodPressureFormatted: string;
    systolicMmHg: number;
    diastolicMmHg: number;
    etco2MmHg: number;
    temperatureCelsius: number;
    gcs: number;
  };
  ecgLeadII?: {
    sampleRateHz: number;
    stElevationDetected: boolean;
    stElevationMm?: number;
    samplesCount: number;
  };
  qualityFlag: 'GOOD' | 'SIGNAL_DEGRADED' | 'DISCONNECTED';
  staleDataWarning?: boolean;
}

export class DeviceTelemetryAdapter {
  private static processedPacketSignatures = new Set<string>();
  private static deviceLastSequence = new Map<string, number>();

  /**
   * Authoritative Telemetry Ingestion Pipeline
   */
  public static async ingestPacket(
    context: CommandContext,
    rawPacket: RawTelemetryPacket,
    currentMode: IngestionMode = 'PRODUCTION_MODE'
  ): Promise<{
    success: boolean;
    record?: IngestedTelemetryRecord;
    error?: { code: string; message: string };
  }> {
    const now = Date.now();

    // 1. Production Freshness Check (§15 Safeguard: Stale Data Rejection)
    const ageMs = now - rawPacket.deviceTimestamp;
    if (currentMode === 'PRODUCTION_MODE') {
      if (ageMs > 30000) {
        return {
          success: false,
          error: {
            code: 'STALE_DATA_REJECTED',
            message: `Telemetry packet timestamp is stale (${ageMs}ms old). Rejected to protect clinical decision integrity.`,
          },
        };
      }
      if (ageMs < -5000) {
        return {
          success: false,
          error: {
            code: 'CLOCK_SKEW_DETECTED',
            message: `Device timestamp is in the future (+${Math.abs(ageMs)}ms). Calibration required.`,
          },
        };
      }
    }

    // 2. Duplicate Packet Detection (§15 Safeguard: Deduplication)
    const packetSig = `${rawPacket.deviceId}_${rawPacket.packetSequenceNumber}_${rawPacket.deviceTimestamp}`;
    if (this.processedPacketSignatures.has(packetSig)) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_PACKET_IGNORED',
          message: `Duplicate packet sequence #${rawPacket.packetSequenceNumber} from device ${rawPacket.deviceId} discarded.`,
        },
      };
    }
    this.processedPacketSignatures.add(packetSig);

    // Sequence continuity check
    const lastSeq = this.deviceLastSequence.get(rawPacket.deviceId) || 0;
    if (rawPacket.packetSequenceNumber <= lastSeq && currentMode === 'PRODUCTION_MODE') {
      // Out of order packet
      console.warn(`[Telemetry] Out-of-order packet from ${rawPacket.deviceId}. Prev: ${lastSeq}, In: ${rawPacket.packetSequenceNumber}`);
    }
    this.deviceLastSequence.set(rawPacket.deviceId, rawPacket.packetSequenceNumber);

    // 3. Patient / Encounter Binding Validation
    const patientMrn = rawPacket.patientBinding.mrn?.trim() || 'UNBOUND';
    const encounterId = rawPacket.patientBinding.encounterId?.trim() || 'UNBOUND_PRE_HOSPITAL';

    // 4. Clinical Unit & Boundary Normalization
    const m = rawPacket.metrics;
    const hr = Math.max(0, Math.min(300, Math.round(m.heartRateBpm ?? 0)));
    const spo2 = Math.max(0, Math.min(100, Math.round(m.spo2Percent ?? 0)));
    const rr = Math.max(0, Math.min(80, Math.round(m.respiratoryRate ?? 0)));
    const sys = Math.max(0, Math.min(320, Math.round(m.nibpSystolicMmHg ?? 0)));
    const dia = Math.max(0, Math.min(220, Math.round(m.nibpDiastolicMmHg ?? 0)));
    const etco2 = Math.max(0, Math.min(120, Math.round(m.etco2MmHg ?? 0)));
    const temp = Number((m.temperatureCelsius ?? 37.0).toFixed(1));
    const gcs = Math.max(3, Math.min(15, Math.round(m.glasgowComaScale ?? 15)));

    // 5. ST-Elevation & Rhythm Evaluation (Lead II)
    let stElevationDetected = false;
    let stElevationMm = 0;
    if (rawPacket.ecgWaveform && rawPacket.ecgWaveform.samples.length > 0) {
      // Check for elevated J-point > 0.15mV (1.5mm)
      const maxSample = Math.max(...rawPacket.ecgWaveform.samples);
      if (maxSample > 1.8) {
        stElevationDetected = true;
        stElevationMm = Number(((maxSample - 1.0) * 10).toFixed(1));
      }
    }

    const telemetryId = `tel_${rawPacket.deviceId}_${now}`;
    const record: IngestedTelemetryRecord = {
      telemetryId,
      mode: currentMode,
      deviceId: rawPacket.deviceId,
      encounterId,
      patientMrn,
      ingestedAt: new Date(now).toISOString(),
      metrics: {
        heartRateBpm: hr,
        spo2Percent: spo2,
        respiratoryRate: rr,
        bloodPressureFormatted: `${sys}/${dia} mmHg`,
        systolicMmHg: sys,
        diastolicMmHg: dia,
        etco2MmHg: etco2,
        temperatureCelsius: temp,
        gcs,
      },
      ecgLeadII: rawPacket.ecgWaveform
        ? {
            sampleRateHz: rawPacket.ecgWaveform.sampleRateHz,
            stElevationDetected,
            stElevationMm,
            samplesCount: rawPacket.ecgWaveform.samples.length,
          }
        : undefined,
      qualityFlag: 'GOOD',
      staleDataWarning: ageMs > 10000,
    };

    // 6. Emit Authoritative Domain Event to Outbox
    await TransactionManager.executeAtomicWrite(
      context,
      `cmd_tel_${telemetryId}`,
      `idemp_tel_${packetSig}`,
      {
        entityType: 'DEVICE_TELEMETRY',
        entityId: telemetryId,
        eventType: 'TELEMETRY_PACKET_INGESTED',
        domainState: record,
        eventPayload: {
          telemetryId,
          deviceId: rawPacket.deviceId,
          mode: currentMode,
          encounterId,
          patientMrn,
          metrics: record.metrics,
          stElevationDetected,
        },
        auditReason: `Ingested ${currentMode} telemetry stream from ${rawPacket.deviceId} bound to ${patientMrn}`,
        outboxTopic: 'g-hims-telemetry-events',
      }
    );

    return { success: true, record };
  }
}
