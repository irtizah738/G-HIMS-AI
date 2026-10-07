import crypto from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { DeviceTelemetryAdapter, type RawTelemetryPacket } from '@/lib/interop/device-telemetry-adapter';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import { assertBiomedicalInteropReady } from '@/lib/interop/biomedical-device-authority';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import type {
  EmergencyPrearrivalTelemetryRecord,
  EmergencyTelemetryDeviceCheckpoint,
  EmergencyTelemetryDeviceProfile,
} from '@/types/emergency-prearrival';

export interface EmergencyTelemetryIntegrationContext {
  tenantId: string;
  actorId: string;
  correlationId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AcknowledgeEmergencyPrearrivalTelemetryPayload {
  patientId: string;
  encounterId: string;
  telemetryId: string;
  note?: string;
}

function failure(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message },
  };
}

function credentialHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encounterIsOpen(encounter: Record<string, unknown>): boolean {
  return !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED', 'CLOSED'].includes(
    String(encounter.status || '').trim().toUpperCase()
  );
}

export class EmergencyPrearrivalDomainService {
  public static async ingestProductionTelemetry(
    context: EmergencyTelemetryIntegrationContext,
    rawPacket: RawTelemetryPacket,
    deviceCredential: string
  ): Promise<{
    success: boolean;
    telemetry?: EmergencyPrearrivalTelemetryRecord;
    replayed?: boolean;
    error?: { code: string; message: string };
  }> {
    if (getServerIntegrationState('DEVICE_TELEMETRY') !== 'LIVE') {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_INTEGRATION_NOT_LIVE',
          message: 'Production device telemetry is blocked until the integration state is LIVE.',
        },
      };
    }

    if (!context.tenantId || !rawPacket?.deviceId || !deviceCredential) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_AUTH_CONTEXT_REQUIRED',
          message: 'Tenant, device identity and device credential are required.',
        },
      };
    }

    const profile = await DomainStateRepository.getById<EmergencyTelemetryDeviceProfile>(
      context.tenantId,
      'telemetryDevices',
      rawPacket.deviceId
    );
    if (
      !profile ||
      profile.tenantId !== context.tenantId ||
      profile.deviceId !== rawPacket.deviceId ||
      profile.status !== 'ACTIVE' ||
      profile.certificationStatus !== 'CERTIFIED' ||
      profile.calibrationStatus !== 'VALID' ||
      profile.calibrationValidUntil <= Date.now()
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_DEVICE_NOT_CERTIFIED',
          message: 'Telemetry source is not an active, certified and currently calibrated hospital device.',
        },
      };
    }

    try {
      await assertBiomedicalInteropReady({
        tenantId: context.tenantId,
        resourceId: profile.resourceId,
        expectedModel: profile.deviceModel,
        requiredThroughMs: rawPacket.deviceTimestamp,
      });
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_BIOMEDICAL_LOCKOUT',
          message:
            error instanceof Error
              ? error.message
              : 'Canonical biomedical resource authority rejected the telemetry source.',
        },
      };
    }

    if (
      profile.deviceType !== rawPacket.deviceType ||
      profile.deviceModel !== rawPacket.deviceModel ||
      !profile.allowedFirmwareVersions.includes(rawPacket.firmwareVersion)
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_DEVICE_PROFILE_MISMATCH',
          message: 'Device type, model or firmware does not match the certified profile.',
        },
      };
    }

    if (
      !constantTimeHexEqual(
        credentialHash(deviceCredential),
        String(profile.credentialSha256 || '').toLowerCase()
      )
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_DEVICE_CREDENTIAL_REJECTED',
          message: 'Telemetry device credential was rejected.',
        },
      };
    }

    const encounterId = String(rawPacket.patientBinding?.encounterId || '').trim();
    const patientMrn = String(rawPacket.patientBinding?.mrn || '').trim().toUpperCase();
    if (!encounterId || !patientMrn) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_PATIENT_BINDING_REQUIRED',
          message: 'Production pre-arrival telemetry requires both encounterId and MRN binding.',
        },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      encounterId
    );
    if (
      !encounter ||
      String(encounter.encounterType || encounter.type || '').trim().toUpperCase() !== 'EMERGENCY' ||
      !encounterIsOpen(encounter)
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_EMERGENCY_ENCOUNTER_REQUIRED',
          message: 'Telemetry must bind to an active emergency encounter.',
        },
      };
    }

    const patientId = String(encounter.patientId || '').trim();
    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      patientId
    );
    if (!patient || String(patient.mrn || '').trim().toUpperCase() !== patientMrn) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_PATIENT_BINDING_MISMATCH',
          message: 'Telemetry MRN does not match the patient bound to the emergency encounter.',
        },
      };
    }

    const normalized = await DeviceTelemetryAdapter.ingestPacket(
      context,
      rawPacket,
      'PRODUCTION_MODE'
    );
    if (!normalized.success || !normalized.record) {
      return {
        success: false,
        error: normalized.error || {
          code: 'TELEMETRY_PACKET_REJECTED',
          message: 'Telemetry packet failed validation.',
        },
      };
    }

    const telemetryId = `prearrival_${rawPacket.deviceId}_${rawPacket.packetSequenceNumber}`;
    const existing = await DomainStateRepository.getById<EmergencyPrearrivalTelemetryRecord>(
      context.tenantId,
      'preArrivalTelemetryRecords',
      telemetryId
    );
    if (existing) {
      if (
        existing.deviceTimestamp === rawPacket.deviceTimestamp &&
        existing.encounterId === encounterId &&
        existing.patientId === patientId
      ) {
        return { success: true, telemetry: existing, replayed: true };
      }
      return {
        success: false,
        error: {
          code: 'TELEMETRY_PACKET_ID_CONFLICT',
          message: 'Device sequence number was reused for a different telemetry packet.',
        },
      };
    }

    const checkpoint = await DomainStateRepository.getById<EmergencyTelemetryDeviceCheckpoint>(
      context.tenantId,
      'telemetryDeviceCheckpoints',
      rawPacket.deviceId
    );
    if (
      checkpoint &&
      (
        rawPacket.packetSequenceNumber <= checkpoint.lastPacketSequenceNumber ||
        rawPacket.deviceTimestamp < checkpoint.lastDeviceTimestamp
      )
    ) {
      return {
        success: false,
        error: {
          code: 'TELEMETRY_PACKET_REPLAY',
          message: 'Out-of-order or replayed telemetry packet was rejected.',
        },
      };
    }

    const now = Date.now();
    const telemetry: EmergencyPrearrivalTelemetryRecord = {
      telemetryId,
      tenantId: context.tenantId,
      patientId,
      encounterId,
      patientMrn,
      deviceId: rawPacket.deviceId,
      sourceUnitId: profile.sourceUnitId,
      deviceType: profile.deviceType,
      deviceModel: profile.deviceModel,
      firmwareVersion: rawPacket.firmwareVersion,
      packetSequenceNumber: rawPacket.packetSequenceNumber,
      deviceTimestamp: rawPacket.deviceTimestamp,
      receivedAt: now,
      qualityFlag: normalized.record.qualityFlag,
      metrics: normalized.record.metrics,
      waveform: normalized.record.waveform,
      reviewStatus: 'RECEIVED',
      source: 'CERTIFIED_DEVICE_TELEMETRY',
      createdAt: now,
      updatedAt: now,
    };

    const nextCheckpoint: EmergencyTelemetryDeviceCheckpoint = {
      deviceId: rawPacket.deviceId,
      tenantId: context.tenantId,
      lastPacketSequenceNumber: rawPacket.packetSequenceNumber,
      lastDeviceTimestamp: rawPacket.deviceTimestamp,
      lastTelemetryId: telemetryId,
      updatedAt: now,
    };

    try {
      await TransactionManager.executeAtomicMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: 'INTEGRATION_SERVICE',
        aggregateType: 'EMERGENCY_PREARRIVAL_TELEMETRY',
        aggregateId: telemetryId,
        eventType: 'EMERGENCY_PREARRIVAL_TELEMETRY_INGESTED',
        eventPayload: {
          telemetryId,
          patientId,
          encounterId,
          deviceId: rawPacket.deviceId,
          sourceUnitId: profile.sourceUnitId,
          packetSequenceNumber: rawPacket.packetSequenceNumber,
          deviceTimestamp: rawPacket.deviceTimestamp,
          qualityFlag: telemetry.qualityFlag,
          metrics: telemetry.metrics,
          waveform: telemetry.waveform,
        },
        auditAction: 'INGEST_EMERGENCY_PREARRIVAL_TELEMETRY',
        auditResourceType: 'ENCOUNTER',
        auditResourceId: encounterId,
        auditReason: `Certified pre-arrival telemetry received from ${profile.sourceUnitId}.`,
        auditMetadata: {
          deviceId: rawPacket.deviceId,
          requestId: context.requestId,
          sourceUnitId: profile.sourceUnitId,
        },
        outboxTopic: 'g-hims-clinical-events',
        correlationId: context.correlationId,
        domainState: telemetry,
        expectedPrimaryServerVersion: 0,
        additionalStateWrites: [{
          entityType: 'TELEMETRY_DEVICE_CHECKPOINT',
          entityId: rawPacket.deviceId,
          domainState: nextCheckpoint,
          expectedServerVersion: Number(checkpoint?._serverVersion || 0),
        }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telemetry commit failed.';
      return {
        success: false,
        error: {
          code: /VERSION|CONFLICT|PRECONDITION/i.test(message)
            ? 'TELEMETRY_CONCURRENT_PACKET_CONFLICT'
            : 'TELEMETRY_COMMIT_FAILED',
          message,
        },
      };
    }

    return { success: true, telemetry };
  }

  public static async acknowledge(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcknowledgeEmergencyPrearrivalTelemetryPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'NURSE',
        'HEAD_NURSE',
        'DOCTOR',
        'CONSULTANT',
        'ATTENDING_PHYSICIAN',
        'SYSTEM_ADMIN',
      ],
      allowBreakGlass: true,
    });
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Emergency telemetry review authority is required.'
      );
    }

    const [patient, encounter, telemetry] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        payload.patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        payload.encounterId
      ),
      DomainStateRepository.getById<EmergencyPrearrivalTelemetryRecord>(
        context.tenantId,
        'preArrivalTelemetryRecords',
        payload.telemetryId
      ),
    ]);

    if (!patient || !encounter || String(encounter.patientId || '') !== payload.patientId) {
      return failure(commandId, idempotencyKey, 'TELEMETRY_REVIEW_SCOPE_INVALID', 'Patient encounter scope could not be validated.');
    }
    assertPatient360PatientAccess(context, patient, encounter);

    if (
      !telemetry ||
      telemetry.patientId !== payload.patientId ||
      telemetry.encounterId !== payload.encounterId
    ) {
      return failure(commandId, idempotencyKey, 'TELEMETRY_RECORD_SCOPE_MISMATCH', 'Telemetry record is outside the supplied patient encounter.');
    }
    if (telemetry.reviewStatus === 'REVIEWED') {
      return failure(commandId, idempotencyKey, 'TELEMETRY_ALREADY_REVIEWED', 'Telemetry record was already reviewed.');
    }

    const now = Date.now();
    const next: EmergencyPrearrivalTelemetryRecord = {
      ...telemetry,
      reviewStatus: 'REVIEWED',
      reviewedAt: now,
      reviewedBy: context.actorId,
      reviewNote: String(payload.note || '').trim() || undefined,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'EMERGENCY_PREARRIVAL_TELEMETRY',
      aggregateId: telemetry.telemetryId,
      eventType: 'EMERGENCY_PREARRIVAL_TELEMETRY_REVIEWED',
      eventPayload: {
        telemetryId: telemetry.telemetryId,
        patientId: telemetry.patientId,
        encounterId: telemetry.encounterId,
        reviewedBy: context.actorId,
        reviewedAt: now,
      },
      auditAction: 'REVIEW_EMERGENCY_PREARRIVAL_TELEMETRY',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: telemetry.encounterId,
      auditReason: 'Reviewed certified pre-arrival telemetry evidence.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
      expectedPrimaryServerVersion: Number(telemetry._serverVersion || 0),
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: telemetry.telemetryId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }
}
