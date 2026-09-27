/**
 * G-HIMS authoritative telehealth session domain service.
 * Telehealth state is a governed clinical encounter adjunct; it does not directly
 * mint diagnoses, prescriptions, or signed notes.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Patient, TelehealthSession, TelehealthSoapNote, TelehealthPrescription } from '@/lib/types/ghims';

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

export interface CompleteTelehealthSessionPayload {
  sessionId: string;
  soapNote?: Partial<TelehealthSoapNote>;
  prescriptions?: TelehealthPrescription[];
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

    const patient = await DomainStateRepository.getById<Patient>(context.tenantId, 'patients', payload.patientId);
    if (!patient) {
      return { success:false, commandId, idempotencyKey, error:{ code:'PATIENT_NOT_FOUND', message:'Telehealth patient does not exist in this tenant.' } };
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
      age: patient.age,
      gender: patient.gender,
      scheduledTime: payload.scheduledTime || now,
      status: 'WAITING_ROOM',
      type: payload.type || 'Telehealth Consultation',
      attendingPhysician: payload.attendingPhysician || '',
      clinicianNpi: '',
      specialty: 'Telehealth',
      chiefComplaint: payload.chiefComplaint.trim(),
      roomToken,
      connectionQuality: 'GOOD',
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

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType:'TELEHEALTH_SESSION',
      entityId:sessionId,
      eventType:'TELEHEALTH_SESSION_CREATED',
      domainState:session,
      eventPayload:{ sessionId, encounterId, patientId:patient.id, type:session.type, scheduledTime:session.scheduledTime },
      auditReason:`Telehealth session scheduled for patient ${patient.mrn}.`,
      outboxTopic:'g-hims-telehealth-events',
    });

    return {
      success:true,
      commandId,
      idempotencyKey,
      entityId:sessionId,
      eventId:tx.event.eventId,
      auditId:tx.audit.auditId,
      outboxId:tx.outbox.outboxId,
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

    const next: TelehealthSession = {
      ...session,
      status:'COMPLETED',
      soapNote:{ ...session.soapNote, ...(payload.soapNote || {}) },
      prescriptions:Array.isArray(payload.prescriptions) ? payload.prescriptions : session.prescriptions,
      updatedAt:new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType:'TELEHEALTH_SESSION',
      entityId:session.id,
      eventType:'TELEHEALTH_SESSION_COMPLETED',
      domainState:next,
      eventPayload:{ sessionId:session.id, patientId:session.patientId, encounterId:session.encounterId },
      auditReason:`Telehealth session ${session.id} completed by ${context.actorId}.`,
      outboxTopic:'g-hims-telehealth-events',
    });

    return { success:true, commandId, idempotencyKey, entityId:session.id, eventId:tx.event.eventId, auditId:tx.audit.auditId, outboxId:tx.outbox.outboxId, data:next };
  }
}
