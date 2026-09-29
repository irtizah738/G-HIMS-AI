/**
 * G-HIMS authoritative inpatient bed/census domain service.
 * Bed occupancy and patient active-bed state are committed atomically.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Bed, BedStatus } from '@/lib/types/ghims';
import { PatientMPI } from '@/types/mpi';

export interface AdmitPatientToBedPayload {
  bedId: string;
  patientId: string;
  assignedDoctor?: string;
  assignedNurse?: string;
}

export interface UpdateBedStatusPayload {
  bedId: string;
  status: Exclude<BedStatus, 'occupied'>;
  notes?: string;
}

export interface DischargePatientFromBedPayload {
  bedId: string;
  notes?: string;
  disposition?: string;
}

export class InpatientBedDomainService {
  public static async admit(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AdmitPatientToBedPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'ADMISSION_OFFICER'],
      requiredPrivilege: 'ADMIT_INPATIENT',
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Inpatient admission authority required.' } };
    }

    const [bed, patient] = await Promise.all([
      DomainStateRepository.getById<Bed>(context.tenantId, 'beds', payload.bedId),
      DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.patientId),
    ]);

    if (!bed) return { success:false, commandId, idempotencyKey, error:{ code:'BED_NOT_FOUND', message:'Target bed does not exist.' } };
    if (!patient) return { success:false, commandId, idempotencyKey, error:{ code:'PATIENT_NOT_FOUND', message:'Patient does not exist.' } };
    if (bed.status !== 'available' && bed.patientId !== payload.patientId) {
      return { success:false, commandId, idempotencyKey, error:{ code:'BED_UNAVAILABLE', message:`Bed ${bed.bedNumber || bed.id} is currently ${bed.status}.` } };
    }
    if (patient.activeBedId && patient.activeBedId !== payload.bedId) {
      return { success:false, commandId, idempotencyKey, error:{ code:'PATIENT_ALREADY_ADMITTED', message:`Patient is already assigned to bed ${patient.activeBedId}.` } };
    }

    const admissionDate = new Date().toISOString().split('T')[0];
    const bedState: Bed = {
      ...bed,
      status:'occupied',
      patientId:patient.id,
      patientName:patient.fullName,
      admissionDate,
      assignedDoctor:payload.assignedDoctor || bed.assignedDoctor,
      assignedNurse:payload.assignedNurse || bed.assignedNurse,
    };
    const patientState: PatientMPI = { ...patient, activeBedId: payload.bedId };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId:context.tenantId,
      actorId:context.actorId,
      actorRole:context.roles[0] || 'DOCTOR',
      aggregateType:'HOSPITAL_BED',
      aggregateId:payload.bedId,
      eventType:'PATIENT_ADMITTED_TO_BED',
      eventPayload:{ bedId:payload.bedId, patientId:payload.patientId, admissionDate },
      auditAction:'ADMIT_PATIENT_BED',
      auditResourceType:'BED',
      auditResourceId:payload.bedId,
      auditReason:`Patient ${patient.mrn} admitted to bed ${bed.bedNumber || bed.id}.`,
      outboxTopic:'g-hims-inpatient-events',
      idempotencyKey,
      commandId,
      correlationId:context.correlationId,
      domainState:bedState,
      additionalStateWrites:[{ entityType:'PATIENT_MPI', entityId:patient.id, domainState:patientState }],
    });

    return { success:true, commandId, idempotencyKey, entityId:payload.bedId, eventId:tx.eventId, auditId:tx.auditId, outboxId:tx.outboxId, data:{ bed:bedState, patient:patientState } };
  }

  public static async updateStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpdateBedStatusPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles:['NURSE','FACILITIES_ADMIN','SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Bed-status authority required.' } };
    }

    const bed = await DomainStateRepository.getById<Bed>(context.tenantId, 'beds', payload.bedId);
    if (!bed) return { success:false, commandId, idempotencyKey, error:{ code:'BED_NOT_FOUND', message:'Target bed does not exist.' } };
    if (bed.status === 'occupied' || bed.patientId) {
      return { success:false, commandId, idempotencyKey, error:{ code:'BED_OCCUPIED', message:'Occupied beds must be discharged or transferred through an inpatient command.' } };
    }

    const bedState: Bed = {
      ...bed,
      status:payload.status,
      patientId:undefined,
      patientName:undefined,
      ...(payload.notes !== undefined ? { notes:payload.notes } : {}),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'NURSE',
      aggregateType: 'HOSPITAL_BED',
      aggregateId: payload.bedId,
      eventType: 'BED_STATUS_UPDATED',
      eventPayload: {
        bedId: payload.bedId,
        previousStatus: bed.status,
        status: payload.status,
      },
      auditAction: 'UPDATE_BED_STATUS',
      auditResourceType: 'BED',
      auditResourceId: payload.bedId,
      auditReason: `Bed ${bed.bedNumber || bed.id} status changed from ${bed.status} to ${payload.status}.`,
      outboxTopic: 'g-hims-inpatient-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: bedState,
      expectedPrimaryServerVersion: Number(
        (bed as Bed & { _serverVersion?: number })._serverVersion || 0
      ),
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.bedId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { bed: bedState },
    };
  }

  public static async discharge(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DischargePatientFromBedPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles:['DOCTOR','CONSULTANT'],
      requiredPrivilege:'DISCHARGE_INPATIENT',
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Inpatient discharge authority required.' } };
    }

    const bed = await DomainStateRepository.getById<Bed>(context.tenantId, 'beds', payload.bedId);
    if (!bed) return { success:false, commandId, idempotencyKey, error:{ code:'BED_NOT_FOUND', message:'Target bed does not exist.' } };
    if (bed.status !== 'occupied' || !bed.patientId) {
      return { success:false, commandId, idempotencyKey, error:{ code:'BED_NOT_OCCUPIED', message:'Only an occupied bed can be discharged.' } };
    }

    const patient = await DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', bed.patientId);
    if (!patient) return { success:false, commandId, idempotencyKey, error:{ code:'PATIENT_NOT_FOUND', message:'Assigned patient record does not exist.' } };
    if (patient.activeBedId && patient.activeBedId !== payload.bedId) {
      return { success:false, commandId, idempotencyKey, error:{ code:'CENSUS_STATE_CONFLICT', message:'Patient active-bed state does not match the bed being discharged.' } };
    }

    const bedState: Bed = {
      ...bed,
      status:'cleaning',
      patientId:undefined,
      patientName:undefined,
      notes:payload.notes || 'Sanitizing protocol in progress (Discharged)',
    };
    const patientState: PatientMPI = { ...patient, activeBedId:undefined };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId:context.tenantId,
      actorId:context.actorId,
      actorRole:context.roles[0] || 'DOCTOR',
      aggregateType:'HOSPITAL_BED',
      aggregateId:payload.bedId,
      eventType:'PATIENT_DISCHARGED_FROM_BED',
      eventPayload:{ bedId:payload.bedId, patientId:patient.id, disposition:payload.disposition || 'UNSPECIFIED' },
      auditAction:'DISCHARGE_PATIENT_BED',
      auditResourceType:'BED',
      auditResourceId:payload.bedId,
      auditReason:payload.notes || `Patient ${patient.mrn} discharged from bed ${bed.bedNumber || bed.id}.`,
      outboxTopic:'g-hims-inpatient-events',
      idempotencyKey,
      commandId,
      correlationId:context.correlationId,
      domainState:bedState,
      additionalStateWrites:[{ entityType:'PATIENT_MPI', entityId:patient.id, domainState:patientState }],
    });

    return { success:true, commandId, idempotencyKey, entityId:payload.bedId, eventId:tx.eventId, auditId:tx.auditId, outboxId:tx.outboxId, data:{ bed:bedState, patient:patientState, disposition:payload.disposition } };
  }
}
