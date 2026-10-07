import { getServerIntegrationState } from './integration-state';

export type IngestionMode = 'SIMULATION_MODE' | 'PRODUCTION_MODE';

export interface RawTelemetryPacket {
  deviceId: string;
  deviceType:
    | 'ALS_MONITOR_DEFIBRILLATOR'
    | 'ICU_BEDSIDE_MONITOR'
    | 'TRANSPORT_PULSE_OXIMETER';
  deviceModel: string;
  firmwareVersion: string;
  packetSequenceNumber: number;
  deviceTimestamp: number;
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
    lead:
      | 'I' | 'II' | 'III'
      | 'aVR' | 'aVL' | 'aVF'
      | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';
    sampleRateHz: number;
    scaleMvPerMm: number;
    samples: number[];
  };
}

export interface IngestedTelemetryRecord {
  telemetryId: string;
  mode: IngestionMode;
  deviceId: string;
  encounterId: string;
  patientMrn: string;
  ingestedAt: string;
  deviceTimestamp: number;
  metrics: {
    heartRateBpm?: number;
    spo2Percent?: number;
    respiratoryRate?: number;
    systolicMmHg?: number;
    diastolicMmHg?: number;
    etco2MmHg?: number;
    temperatureCelsius?: number;
    gcs?: number;
  };
  waveform?: {
    lead: string;
    sampleRateHz: number;
    scaleMvPerMm: number;
    samplesCount: number;
    interpretationStatus: 'NOT_EVALUATED';
  };
  qualityFlag: 'GOOD' | 'SIGNAL_DEGRADED';
  persistence: 'SIMULATION_ONLY_NOT_COMMITTED' | 'ELIGIBLE_FOR_AUTHORITATIVE_COMMIT';
}

type TelemetryError = { code: string; message: string };

function finiteInRange(
  value: number | undefined,
  min: number,
  max: number,
  field: string
): TelemetryError | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < min || value > max) {
    return {
      code: 'TELEMETRY_VALUE_OUT_OF_RANGE',
      message: field + ' is outside the accepted device validation range.',
    };
  }
  return null;
}

/**
 * P2 safety boundary for telemetry.
 *
 * Real device traffic remains blocked until the physical device profile, transport,
 * identity, durable deduplication, calibration and clinical validation package are
 * certified. Simulation packets may be normalized for UI/testing, but are never
 * committed as authoritative clinical observations.
 */
export class DeviceTelemetryAdapter {
  public static async ingestPacket(
    _context: unknown,
    rawPacket: RawTelemetryPacket,
    currentMode: IngestionMode
  ): Promise<{
    success: boolean;
    record?: IngestedTelemetryRecord;
    error?: TelemetryError;
  }> {
    if (!currentMode) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_MODE_REQUIRED',
          message: 'Telemetry mode must be explicit.',
        },
      };
    }

    const state = getServerIntegrationState('DEVICE_TELEMETRY');
    if (currentMode === 'PRODUCTION_MODE' && state !== 'LIVE') {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_INTEGRATION_NOT_LIVE',
          message: 'Production device telemetry is blocked until the integration state is LIVE.',
        },
      };
    }

    const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
    if (
      currentMode === 'SIMULATION_MODE' &&
      state !== 'SIMULATION' &&
      runtime !== 'TEST' &&
      runtime !== 'DEMO'
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_SIMULATION_DISABLED',
          message: 'Simulation telemetry is not enabled in this environment.',
        },
      };
    }

    if (!rawPacket?.deviceId || !Number.isInteger(rawPacket.packetSequenceNumber)) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_PACKET_INVALID',
          message: 'deviceId and integer packetSequenceNumber are required.',
        },
      };
    }

    const ageMs = Date.now() - rawPacket.deviceTimestamp;
    if (!Number.isFinite(rawPacket.deviceTimestamp) || ageMs > 30000 || ageMs < -5000) {
      return {
        success: false,
        error: {
          code: ageMs < -5000 ? 'CLOCK_SKEW_DETECTED' : 'STALE_DATA_REJECTED',
          message: 'Telemetry timestamp is outside the accepted freshness window.',
        },
      };
    }

    const checks = [
      finiteInRange(rawPacket.metrics.heartRateBpm, 0, 300, 'heartRateBpm'),
      finiteInRange(rawPacket.metrics.spo2Percent, 0, 100, 'spo2Percent'),
      finiteInRange(rawPacket.metrics.respiratoryRate, 0, 80, 'respiratoryRate'),
      finiteInRange(rawPacket.metrics.nibpSystolicMmHg, 0, 320, 'nibpSystolicMmHg'),
      finiteInRange(rawPacket.metrics.nibpDiastolicMmHg, 0, 220, 'nibpDiastolicMmHg'),
      finiteInRange(rawPacket.metrics.etco2MmHg, 0, 120, 'etco2MmHg'),
      finiteInRange(rawPacket.metrics.temperatureCelsius, 20, 45, 'temperatureCelsius'),
      finiteInRange(rawPacket.metrics.glasgowComaScale, 3, 15, 'glasgowComaScale'),
    ].filter(Boolean) as TelemetryError[];

    if (checks.length > 0) {
      return { success: false, error: checks[0] };
    }

    if (
      rawPacket.ecgWaveform &&
      (
        !Number.isFinite(rawPacket.ecgWaveform.sampleRateHz) ||
        rawPacket.ecgWaveform.sampleRateHz <= 0 ||
        rawPacket.ecgWaveform.samples.length > 10000 ||
        rawPacket.ecgWaveform.samples.some((sample) => !Number.isFinite(sample))
      )
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_WAVEFORM_INVALID',
          message: 'Waveform metadata or samples are invalid.',
        },
      };
    }

    const record: IngestedTelemetryRecord = {
      telemetryId:
        (currentMode === 'PRODUCTION_MODE' ? 'tel_' : 'sim_tel_') +
        rawPacket.deviceId + '_' + rawPacket.packetSequenceNumber + '_' + rawPacket.deviceTimestamp,
      mode: currentMode,
      deviceId: rawPacket.deviceId,
      encounterId: String(rawPacket.patientBinding.encounterId || 'UNBOUND_SIMULATION'),
      patientMrn: String(rawPacket.patientBinding.mrn || 'UNBOUND_SIMULATION'),
      ingestedAt: new Date().toISOString(),
      deviceTimestamp: rawPacket.deviceTimestamp,
      metrics: {
        heartRateBpm: rawPacket.metrics.heartRateBpm,
        spo2Percent: rawPacket.metrics.spo2Percent,
        respiratoryRate: rawPacket.metrics.respiratoryRate,
        systolicMmHg: rawPacket.metrics.nibpSystolicMmHg,
        diastolicMmHg: rawPacket.metrics.nibpDiastolicMmHg,
        etco2MmHg: rawPacket.metrics.etco2MmHg,
        temperatureCelsius: rawPacket.metrics.temperatureCelsius,
        gcs: rawPacket.metrics.glasgowComaScale,
      },
      waveform: rawPacket.ecgWaveform
        ? {
            lead: rawPacket.ecgWaveform.lead,
            sampleRateHz: rawPacket.ecgWaveform.sampleRateHz,
            scaleMvPerMm: rawPacket.ecgWaveform.scaleMvPerMm,
            samplesCount: rawPacket.ecgWaveform.samples.length,
            interpretationStatus: 'NOT_EVALUATED',
          }
        : undefined,
      qualityFlag: ageMs > 10000 ? 'SIGNAL_DEGRADED' : 'GOOD',
      persistence:
        currentMode === 'PRODUCTION_MODE'
          ? 'ELIGIBLE_FOR_AUTHORITATIVE_COMMIT'
          : 'SIMULATION_ONLY_NOT_COMMITTED',
    };

    return { success: true, record };
  }
}
