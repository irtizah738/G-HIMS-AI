export type EmergencyTelemetryDeviceType =
  | 'ALS_MONITOR_DEFIBRILLATOR'
  | 'TRANSPORT_PULSE_OXIMETER';

export interface EmergencyTelemetryDeviceProfile {
  deviceId: string;
  tenantId: string;
  resourceId: string;
  sourceUnitId: string;
  deviceType: EmergencyTelemetryDeviceType;
  deviceModel: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  certificationStatus: 'CERTIFIED' | 'PENDING' | 'EXPIRED';
  calibrationStatus: 'VALID' | 'DUE' | 'FAILED';
  calibrationValidUntil: number;
  allowedFirmwareVersions: string[];
  credentialSha256: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmergencyPrearrivalTelemetryRecord {
  telemetryId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  patientMrn: string;
  deviceId: string;
  sourceUnitId: string;
  deviceType: EmergencyTelemetryDeviceType;
  deviceModel: string;
  firmwareVersion: string;
  packetSequenceNumber: number;
  deviceTimestamp: number;
  receivedAt: number;
  qualityFlag: 'GOOD' | 'SIGNAL_DEGRADED';
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
  reviewStatus: 'RECEIVED' | 'REVIEWED';
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  source: 'CERTIFIED_DEVICE_TELEMETRY';
  createdAt: number;
  updatedAt: number;
  _serverVersion?: number;
}

export interface EmergencyTelemetryDeviceCheckpoint {
  deviceId: string;
  tenantId: string;
  lastPacketSequenceNumber: number;
  lastDeviceTimestamp: number;
  lastTelemetryId: string;
  updatedAt: number;
  _serverVersion?: number;
}
