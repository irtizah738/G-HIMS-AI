/**
 * G-HIMS authoritative telehealth session domain service.
 * Telehealth state is a governed clinical encounter adjunct; it does not directly
 * mint diagnoses, prescriptions, or signed notes.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { TelehealthSession } from '@/lib/types/ghims';
import { PatientMPI } from '@/types/mpi';

export interface CreateTelehealthSessionPayload {
  patientId: string;
  type: TelehealthSession['type'];
  scheduledTime?: string;
  chiefComplaint: string;
  attendingPhysician?: string;
}

export interface UpdateTelehealthSessionPayload {
  sessionId: string;
  updates: Partial<Pick<
    TelehealthSession,
    'status' | 'connectionQuality' | 'callDurationSeconds' | 'vitals' |
    'transcription' | 'soapNote' | 'isAudioMuted' | 'isVideoMuted' | 'isRecording'
  >>;
}

export interface TransitionTelehealthConnectivityPayload {
  sessionId: string;
  targetMode: 'VIDEO' | 'AUDIO_ONLY' | 'TEXT_ONLY' | 'PAUSED_OFFLINE';
  reason: string;
}

export interface ResumeTelehealthSessionPayload {
  sessionId: string;
  expectedServerVersion: number;
}

export interface CompleteTelehealthSessionPayload {
  sessionId: string;
  signedEvidenceId: string;
}

export class TelehealthDomainService {
  public static async create(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateTelehealthSessionPayload
  ): Promise<CommandResult<TelehealthSession>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'NURSE', 'SCHEDULER', 'RECEPTIONIST'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Telehealth scheduling authority required.' } };
    }
    if (!payload.patientId || !payload.chiefComplaint?.trim()) {
      return { success:false, commandId, idempotencyKey, error:{ code:'INVALID_TELEHEALTH_REQUEST', message:'patientId and chiefComplaint are required.' } };
    }

    const patient = await DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.patientId);
    if (!patient) {
      return { success:false, commandId, idempotencyKey, error:{ code:'PATIENT_NOT_FOUND', message:'Telehealth patient does not exist in this tenant.' } };
    }
    if (patient.status === 'MERGED') {
      return { success:false, commandId, idempotencyKey, error:{ code:'STALE_MERGED_PATIENT_CONTEXT', message:'Telehealth cannot start from a merged patient identity.' } };
    }

    const now = new Date().toISOString();
    const sessionId = `th_${crypto.randomUUID()}`;
    const encounterId = `enc_th_${crypto.randomUUID()}`;
    const roomToken = `ROOM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const session: TelehealthSession = {
      id: sessionId,
      tenantId: context.tenantId,
      encounterId,
      patientId: patient.id,
      patientName: patient.fullName,
      patientMrn: patient.mrn,
      age: Math.max(
        0,
        new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()
      ),
      gender:
        patient.gender === 'male'
          ? 'Male'
          : patient.gender === 'female'
            ? 'Female'
            : 'Other',
      scheduledTime: payload.scheduledTime || now,
      status: 'WAITING_ROOM',
      type: payload.type || 'Telehealth Consultation',
      attendingPhysician: payload.attendingPhysician || '',
      clinicianNpi: '',
      specialty: 'Telehealth',
      chiefComplaint: payload.chiefComplaint.trim(),
      roomToken,
      connectionQuality: 'GOOD',
      connectionMode: 'VIDEO',
      recoveryState: 'ACTIVE',
      recoveryCount: 0,
      lastConnectivityChangeAt: now,
      callDurationSeconds: 0,
      vitals: {
        bp: '',
        hr: 0,
        spo2: 0,
        temp: 0,
        lastSync: 'Not yet captured',
      },
      transcription: [],
      soapNote: {
        subjective: '',
        objective: '',
        assessment: '',
        plan: '',
        icd10Codes: [],
        cptCodes: [],
      },
      prescriptions: [],
      isAudioMuted: false,
      isVideoMuted: false,
      isRecording: false,
      createdAt: now,
      updatedAt: now,
    };

    const encounterState = {
      encounterId,
      tenantId: context.tenantId,
      patientId: patient.id,
      encounterType: 'TELEHEALTH',
      chiefComplaint: payload.chiefComplaint.trim(),
      departmentId: 'TELEHEALTH',
      status: 'ACTIVE',
      currentStage: 'CONSULTATION',
      priority: 'ROUTINE',
      assignedProviderId: context.actorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'TELEHEALTH_SESSION',
      aggregateId: sessionId,
      eventType: 'TELEHEALTH_SESSION_CREATED',
      eventPayload: {
        sessionId,
        encounterId,
        patientId: patient.id,
        type: session.type,
        scheduledTime: session.scheduledTime,
      },
      auditAction: 'TELEHEALTH_SESSION_CREATED',
      auditResourceType: 'TELEHEALTH_SESSION',
      auditResourceId: sessionId,
      auditReason: `Telehealth session scheduled for patient ${patient.mrn}.`,
      outboxTopic: 'g-hims-telehealth-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: session,
      additionalStateWrites: [{
        entityType: 'ENCOUNTER',
        entityId: encounterId,
        domainState: encounterState,
      }],
    });

    return {
      success:true,
      commandId,
      idempotencyKey,
      entityId:sessionId,
      eventId:tx.eventId,
      auditId:tx.auditId,
      outboxId:tx.outboxId,
      data:session,
    };
  }

  public static async update(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpdateTelehealthSessionPayload
  ): Promise<CommandResult<TelehealthSession>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles:['DOCTOR','CONSULTANT','NURSE'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Telehealth clinical authority required.' } };
    }

    const session = await DomainStateRepository.getById<TelehealthSession>(context.tenantId, 'telehealthSessions', payload.sessionId);
    if (!session) return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_NOT_FOUND', message:'Telehealth session does not exist.' } };
    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_FINAL', message:'Final telehealth sessions cannot be edited.' } };
    }

    const next: TelehealthSession = {
      ...session,
      ...payload.updates,
      id:session.id,
      tenantId:context.tenantId,
      patientId:session.patientId,
      patientMrn:session.patientMrn,
      encounterId:session.encounterId,
      roomToken:session.roomToken,
      updatedAt:new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType:'TELEHEALTH_SESSION',
      entityId:session.id,
      eventType:'TELEHEALTH_SESSION_UPDATED',
      domainState:next,
      eventPayload:{ sessionId:session.id, status:next.status },
      auditReason:`Telehealth session ${session.id} updated.`,
      outboxTopic:'g-hims-telehealth-events',
    });

    return { success:true, commandId, idempotencyKey, entityId:session.id, eventId:tx.event.eventId, auditId:tx.audit.auditId, outboxId:tx.outbox.outboxId, data:next };
  }


  public static async transitionConnectivity(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransitionTelehealthConnectivityPayload
  ): Promise<CommandResult<TelehealthSession>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'NURSE'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Telehealth connectivity authority required.' } };
    }
    if (payload.reason.trim().length < 5) {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_CONNECTIVITY_REASON_REQUIRED', message:'Connectivity changes require a substantive reason.' } };
    }

    const session = await DomainStateRepository.getById<TelehealthSession>(context.tenantId, 'telehealthSessions', payload.sessionId);
    if (!session) return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_NOT_FOUND', message:'Telehealth session does not exist.' } };
    if (['COMPLETED','CANCELLED'].includes(session.status)) {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_FINAL', message:'Final telehealth sessions cannot change connectivity mode.' } };
    }

    const now = new Date().toISOString();
    const next: TelehealthSession = {
      ...session,
      connectionMode: payload.targetMode,
      connectionQuality: payload.targetMode === 'VIDEO' ? session.connectionQuality : 'DEGRADED',
      recoveryState: payload.targetMode === 'PAUSED_OFFLINE' ? 'INTERRUPTED' : 'ACTIVE',
      status: payload.targetMode === 'PAUSED_OFFLINE' ? 'DOCUMENTING' : 'IN_CONSULTATION',
      lastConnectivityChangeAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType:'TELEHEALTH_SESSION',
      entityId:session.id,
      eventType:'TELEHEALTH_CONNECTIVITY_MODE_CHANGED',
      domainState:next,
      eventPayload:{
        sessionId:session.id,
        encounterId:session.encounterId,
        previousMode:session.connectionMode || 'VIDEO',
        targetMode:payload.targetMode,
        reason:payload.reason.trim(),
      },
      auditReason:`Telehealth connectivity changed to ${payload.targetMode}: ${payload.reason.trim()}`,
      outboxTopic:'g-hims-telehealth-events',
    });

    return { success:true, commandId, idempotencyKey, entityId:session.id, eventId:tx.event.eventId, auditId:tx.audit.auditId, outboxId:tx.outbox.outboxId, data:next };
  }

  public static async resume(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ResumeTelehealthSessionPayload
  ): Promise<CommandResult<TelehealthSession>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'NURSE'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Telehealth recovery authority required.' } };
    }

    const session = await DomainStateRepository.getById<TelehealthSession & { _serverVersion?: number }>(
      context.tenantId,
      'telehealthSessions',
      payload.sessionId
    );
    if (!session) return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_NOT_FOUND', message:'Telehealth session does not exist.' } };
    if (['COMPLETED','CANCELLED'].includes(session.status)) {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_FINAL', message:'Final telehealth sessions cannot be resumed.' } };
    }
    if (Number(session._serverVersion || 0) !== payload.expectedServerVersion) {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_RECOVERY_VERSION_CONFLICT', message:'Telehealth session changed while disconnected. Refresh before resuming.' } };
    }

    const now = new Date().toISOString();
    const next: TelehealthSession = {
      ...session,
      status:'IN_CONSULTATION',
      connectionMode: session.connectionMode === 'PAUSED_OFFLINE' ? 'AUDIO_ONLY' : (session.connectionMode || 'VIDEO'),
      recoveryState:'RECOVERED',
      recoveryCount:Number(session.recoveryCount || 0) + 1,
      lastConnectivityChangeAt:now,
      updatedAt:now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId:context.tenantId,
      actorId:context.actorId,
      actorRole:context.roles[0] || 'CLINICIAN',
      aggregateType:'TELEHEALTH_SESSION',
      aggregateId:session.id,
      eventType:'TELEHEALTH_SESSION_RECOVERED',
      eventPayload:{
        sessionId:session.id,
        encounterId:session.encounterId,
        recoveryCount:next.recoveryCount,
        connectionMode:next.connectionMode,
      },
      auditAction:'TELEHEALTH_SESSION_RECOVERED',
      auditResourceType:'TELEHEALTH_SESSION',
      auditResourceId:session.id,
      auditReason:`Recovered interrupted telehealth session ${session.id}.`,
      outboxTopic:'g-hims-telehealth-events',
      idempotencyKey,
      commandId,
      correlationId:context.correlationId,
      domainState:next,
      expectedPrimaryServerVersion:payload.expectedServerVersion,
    });

    return { success:true, commandId, idempotencyKey, entityId:session.id, eventId:tx.eventId, auditId:tx.auditId, outboxId:tx.outboxId, data:next };
  }

  public static async complete(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteTelehealthSessionPayload
  ): Promise<CommandResult<TelehealthSession>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles:['DOCTOR','CONSULTANT'],
      requiredPrivilege:'SIGN_CLINICAL_NOTES',
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Telehealth completion requires signing authority.' } };
    }

    const session = await DomainStateRepository.getById<TelehealthSession>(context.tenantId, 'telehealthSessions', payload.sessionId);
    if (!session) return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_NOT_FOUND', message:'Telehealth session does not exist.' } };
    if (session.status === 'CANCELLED') return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SESSION_CANCELLED', message:'Cancelled telehealth sessions cannot be completed.' } };

    const signedEvidence = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounterEvidence',
      payload.signedEvidenceId
    );
    if (
      !signedEvidence ||
      String(signedEvidence.patientId || '') !== session.patientId ||
      String(signedEvidence.encounterId || '') !== session.encounterId ||
      String(signedEvidence.status || '').toUpperCase() !== 'FINAL' ||
      String(signedEvidence.evidenceType || '') !== 'SIGNED_CLINICAL_NOTE'
    ) {
      return { success:false, commandId, idempotencyKey, error:{ code:'TELEHEALTH_SIGNED_EVIDENCE_REQUIRED', message:'Telehealth completion requires a final signed clinical note from the same patient encounter.' } };
    }

    const next: TelehealthSession = {
      ...session,
      status:'COMPLETED',
      signedEvidenceId:payload.signedEvidenceId,
      recoveryState:session.recoveryState === 'INTERRUPTED' ? 'RECOVERED' : session.recoveryState,
      updatedAt:new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType:'TELEHEALTH_SESSION',
      entityId:session.id,
      eventType:'TELEHEALTH_SESSION_COMPLETED',
      domainState:next,
      eventPayload:{
        sessionId:session.id,
        patientId:session.patientId,
        encounterId:session.encounterId,
        signedEvidenceId:payload.signedEvidenceId,
      },
      auditReason:`Telehealth session ${session.id} completed from signed evidence ${payload.signedEvidenceId}.`,
      outboxTopic:'g-hims-telehealth-events',
    });

    return { success:true, commandId, idempotencyKey, entityId:session.id, eventId:tx.event.eventId, auditId:tx.audit.auditId, outboxId:tx.outbox.outboxId, data:next };
  }

}