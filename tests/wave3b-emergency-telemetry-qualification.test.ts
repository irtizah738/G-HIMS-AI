import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeviceTelemetryAdapter,
  type RawTelemetryPacket,
} from '@/lib/interop/device-telemetry-adapter';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const originalTelemetryState = process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE;
const originalRuntimeMode = process.env.GHIMS_RUNTIME_MODE;

afterEach(() => {
  if (originalTelemetryState === undefined) {
    delete process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE;
  } else {
    process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE = originalTelemetryState;
  }
  if (originalRuntimeMode === undefined) {
    delete process.env.GHIMS_RUNTIME_MODE;
  } else {
    process.env.GHIMS_RUNTIME_MODE = originalRuntimeMode;
  }
});

function packet(now = Date.now()): RawTelemetryPacket {
  return {
    deviceId: 'als-monitor-01',
    deviceType: 'ALS_MONITOR_DEFIBRILLATOR',
    deviceModel: 'Qualified ALS Monitor',
    firmwareVersion: '1.0.0',
    packetSequenceNumber: 42,
    deviceTimestamp: now,
    patientBinding: {
      mrn: 'MRN-20261007-000001',
      encounterId: 'enc-emergency-1',
    },
    metrics: {
      heartRateBpm: 112,
      spo2Percent: 94,
      respiratoryRate: 22,
      nibpSystolicMmHg: 104,
      nibpDiastolicMmHg: 68,
      etco2MmHg: 36,
      temperatureCelsius: 37.2,
      glasgowComaScale: 15,
    },
    ecgWaveform: {
      lead: 'II',
      sampleRateHz: 250,
      scaleMvPerMm: 1,
      samples: [0, 0.1, 0.8, -0.2, 0],
    },
  };
}

describe('Wave 3B emergency pre-arrival telemetry qualification', () => {
  test('production normalization remains fail-closed unless integration is LIVE', async () => {
    process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE = 'INTEGRATION_READY';
    const blocked = await DeviceTelemetryAdapter.ingestPacket({}, packet(), 'PRODUCTION_MODE');
    expect(blocked.success).toBe(false);
    expect(blocked.error?.code).toBe('TELEMETRY_INTEGRATION_NOT_LIVE');

    process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE = 'LIVE';
    const accepted = await DeviceTelemetryAdapter.ingestPacket({}, packet(), 'PRODUCTION_MODE');
    expect(accepted.success).toBe(true);
    expect(accepted.record?.persistence).toBe('ELIGIBLE_FOR_AUTHORITATIVE_COMMIT');
    expect(accepted.record?.waveform?.interpretationStatus).toBe('NOT_EVALUATED');
  });

  test('production adapter rejects stale, out-of-range and invalid waveform packets', async () => {
    process.env.GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE = 'LIVE';
    const stale = packet(Date.now() - 31_000);
    expect((await DeviceTelemetryAdapter.ingestPacket({}, stale, 'PRODUCTION_MODE')).error?.code).toBe('STALE_DATA_REJECTED');

    const invalidVitals = packet();
    invalidVitals.metrics.spo2Percent = 120;
    expect((await DeviceTelemetryAdapter.ingestPacket({}, invalidVitals, 'PRODUCTION_MODE')).error?.code).toBe('TELEMETRY_VALUE_OUT_OF_RANGE');

    const invalidWaveform = packet();
    invalidWaveform.ecgWaveform!.samples = [0, Number.NaN];
    expect((await DeviceTelemetryAdapter.ingestPacket({}, invalidWaveform, 'PRODUCTION_MODE')).error?.code).toBe('TELEMETRY_WAVEFORM_INVALID');
  });

  test('server authority validates device certification, patient binding and replay protection', async () => {
    const service = await source('lib/backend/services/emergency-prearrival-domain-service.ts');
    expect(service).toContain("'telemetryDevices'");
    expect(service).toContain("profile.certificationStatus !== 'CERTIFIED'");
    expect(service).toContain("profile.calibrationStatus !== 'VALID'");
    expect(service).toContain('profile.calibrationValidUntil <= Date.now()');
    expect(service).toContain("'TELEMETRY_DEVICE_CREDENTIAL_REJECTED'");
    expect(service).toContain("'TELEMETRY_PATIENT_BINDING_REQUIRED'");
    expect(service).toContain("'TELEMETRY_PATIENT_BINDING_MISMATCH'");
    expect(service).toContain("'TELEMETRY_EMERGENCY_ENCOUNTER_REQUIRED'");
    expect(service).toContain("'telemetryDeviceCheckpoints'");
    expect(service).toContain("'TELEMETRY_PACKET_REPLAY'");
    expect(service).toContain('expectedServerVersion: Number(checkpoint?._serverVersion || 0)');
  });

  test('telemetry persists as evidence and requires explicit clinician review', async () => {
    const [service, bus, schemas, types] = await Promise.all([
      source('lib/backend/services/emergency-prearrival-domain-service.ts'),
      source('lib/backend/commands/command-bus.ts'),
      source('lib/backend/commands/command-schema-registry.ts'),
      source('types/emergency-prearrival.ts'),
    ]);
    expect(service).toContain("eventType: 'EMERGENCY_PREARRIVAL_TELEMETRY_INGESTED'");
    expect(service).toContain("reviewStatus: 'RECEIVED'");
    expect(service).toContain("eventType: 'EMERGENCY_PREARRIVAL_TELEMETRY_REVIEWED'");
    expect(service).not.toContain('RecordVitalsCommand');
    expect(types).toContain("interpretationStatus: 'NOT_EVALUATED'");
    expect(bus).toContain("case 'AcknowledgeEmergencyPrearrivalTelemetryCommand'");
    expect(schemas).toContain('AcknowledgeEmergencyPrearrivalTelemetryCommand');
  });

  test('integration endpoint requires platform and per-device credentials', async () => {
    const route = await source('app/api/interop/device-telemetry/receive/route.ts');
    expect(route).toContain('GHIMS_DEVICE_TELEMETRY_INGEST_API_KEY');
    expect(route).toContain("req.headers.get('x-device-key')");
    expect(route).toContain("req.headers.get('x-device-id')");
    expect(route).toContain("req.headers.get('x-ghims-tenant-id')");
    expect(route).toContain('safeEqual(providedKey, expectedKey)');
    expect(route).toContain('Device identity header/body mismatch');
  });

  test('pre-arrival telemetry collections are inaccessible to hostile clients', async () => {
    const rules = await source('firestore.rules');
    for (const collection of ['telemetryDevices','telemetryDeviceCheckpoints','preArrivalTelemetryRecords']) {
      expect(rules).toContain(`match /${collection}/{id} { allow read, write: if false; }`);
    }
  });

  test('legacy EMS simulation is not an authority path', async () => {
    const [legacy, consoleSource] = await Promise.all([
      source('components/clinical/ems-telemetry-ingestion-modal.tsx'),
      source('components/emergency/governed-emergency-console.tsx'),
    ]);
    expect(legacy).toContain('onDirectIntake');
    expect(legacy).toContain('setTimeout');
    expect(consoleSource).not.toContain('EMSTelemetryIngestionModal');
    expect(consoleSource).not.toContain('InboundTelemetryData');
  });
});