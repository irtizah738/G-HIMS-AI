/**
 * Clinical Event Envelope Model & Event Factory
 * Universal, HIPAA-compliant domain event envelope for clinical event sourcing and telemetry.
 */

import {
  ClinicalEventEnvelope,
  ClinicalEventType,
  ConfidentialityLevel,
  EventProducer,
} from '@/types/clinical-workflow';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates a normalized Clinical Event Envelope.
 */
export function createClinicalEventEnvelope<T = Record<string, any>>(params: {
  tenantId: string;
  eventType: ClinicalEventType;
  aggregateType: 'PATIENT' | 'ENCOUNTER' | 'WORKFLOW_STAGE' | 'ORDER' | 'INVOICE';
  aggregateId: string;
  payload: T;
  producer: Partial<EventProducer>;
  correlationId?: string;
  causationId?: string;
  confidentiality?: ConfidentialityLevel;
  schemaVersion?: string;
}): ClinicalEventEnvelope<T> {
  const timestamp = new Date().toISOString();
  const id = generateUuid();
  const correlationId = params.correlationId || `corr_${generateUuid()}`;

  const fullProducer: EventProducer = {
    service: params.producer.service || 'ghims-clinical-runtime',
    userId: params.producer.userId || 'sys-service',
    userName: params.producer.userName || 'System Runtime',
    userRole: params.producer.userRole || 'practitioner',
    ipAddress: params.producer.ipAddress || '127.0.0.1',
    facilityCode: params.producer.facilityCode || 'METRO',
  };

  // Simple deterministic signature/checksum for event integrity
  const checksum = `${id}|${params.tenantId}|${params.eventType}|${params.aggregateId}|${timestamp}`;

  return {
    id,
    specVersion: '1.0',
    tenantId: params.tenantId,
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    timestamp,
    producer: fullProducer,
    correlationId,
    causationId: params.causationId,
    schemaVersion: params.schemaVersion || '1.0.0',
    payload: params.payload,
    metadata: {
      tenantId: params.tenantId,
      confidentiality: params.confidentiality || 'NORMAL',
      checksum,
      environment: process.env.NODE_ENV || 'production',
      sourceModule: 'clinical-runtime-v1',
    },
  };
}

// ==========================================
// Specialized Clinical Event Creators
// ==========================================

export function createPatientRegisteredEvent(params: {
  tenantId: string;
  patientId: string;
  mrn: string;
  fullName: string;
  dob: string;
  gender: string;
  contactNumber: string;
  producer: Partial<EventProducer>;
}): ClinicalEventEnvelope {
  return createClinicalEventEnvelope({
    tenantId: params.tenantId,
    eventType: 'clinical.patient.registered',
    aggregateType: 'PATIENT',
    aggregateId: params.patientId,
    producer: params.producer,
    payload: {
      patientId: params.patientId,
      mrn: params.mrn,
      fullName: params.fullName,
      dateOfBirth: params.dob,
      gender: params.gender,
      contactNumber: params.contactNumber,
      registeredAt: new Date().toISOString(),
    },
  });
}

export function createEncounterCreatedEvent(params: {
  tenantId: string;
  encounterId: string;
  patientId: string;
  patientMrn: string;
  encounterType: string;
  department: string;
  chiefComplaint: string;
  assignedDoctor: string;
  tokenNumber: string;
  producer: Partial<EventProducer>;
}): ClinicalEventEnvelope {
  return createClinicalEventEnvelope({
    tenantId: params.tenantId,
    eventType: 'clinical.encounter.created',
    aggregateType: 'ENCOUNTER',
    aggregateId: params.encounterId,
    producer: params.producer,
    payload: {
      encounterId: params.encounterId,
      patientId: params.patientId,
      patientMrn: params.patientMrn,
      encounterType: params.encounterType,
      department: params.department,
      chiefComplaint: params.chiefComplaint,
      assignedDoctor: params.assignedDoctor,
      tokenNumber: params.tokenNumber,
      createdAt: new Date().toISOString(),
    },
  });
}

export function createStageTransitionedEvent(params: {
  tenantId: string;
  encounterId: string;
  patientId: string;
  fromStage: string;
  toStage: string;
  dwellDurationSeconds?: number;
  producer: Partial<EventProducer>;
  notes?: string;
}): ClinicalEventEnvelope {
  return createClinicalEventEnvelope({
    tenantId: params.tenantId,
    eventType: 'clinical.encounter.stage_transitioned',
    aggregateType: 'ENCOUNTER',
    aggregateId: params.encounterId,
    producer: params.producer,
    payload: {
      encounterId: params.encounterId,
      patientId: params.patientId,
      fromStage: params.fromStage,
      toStage: params.toStage,
      dwellDurationSeconds: params.dwellDurationSeconds || 0,
      transitionedAt: new Date().toISOString(),
      notes: params.notes,
    },
  });
}

export function createVitalsRecordedEvent(params: {
  tenantId: string;
  encounterId: string;
  patientId: string;
  heartRate: number;
  bloodPressure: string;
  respiratoryRate: number;
  oxygenSaturation: number;
  temperature: number;
  news2Score: number;
  producer: Partial<EventProducer>;
}): ClinicalEventEnvelope {
  return createClinicalEventEnvelope({
    tenantId: params.tenantId,
    eventType: 'clinical.vitals.recorded',
    aggregateType: 'ENCOUNTER',
    aggregateId: params.encounterId,
    producer: params.producer,
    payload: {
      encounterId: params.encounterId,
      patientId: params.patientId,
      heartRate: params.heartRate,
      bloodPressure: params.bloodPressure,
      respiratoryRate: params.respiratoryRate,
      oxygenSaturation: params.oxygenSaturation,
      temperature: params.temperature,
      news2Score: params.news2Score,
      recordedAt: new Date().toISOString(),
    },
  });
}
