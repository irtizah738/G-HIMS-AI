/**
 * G-HIMS Master HR & Workforce Management Domain Service
 * Production-grade hospital workforce management with server-authoritative validation,
 * credential verification, privilege gates, rostering, attendance, leave & audit.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
import { createHash, randomUUID } from 'node:crypto';
import {
  EmployeeMaster,
  EmployeeAssignmentHistory,
  EmployeeCredential,
  ClinicalPrivilege,
  RosterShiftEntry,
  StaffingGapAnalysis,
  AttendanceRecord,
  LeaveRequest,
  EmployeeLeaveBalance,
  CompensationStructure,
  PerformanceReview,
  DisciplinaryRecord,
  EmployeeTrainingRecord,
} from '@/types/hcm-advanced';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

type CreateEmployeePayload = Omit<
  EmployeeMaster,
  | 'employeeId'
  | 'employeeNumber'
  | 'userId'
  | 'tenantId'
  | 'employmentStatus'
  | 'terminationDate'
  | 'onboardingStage'
  | 'offboardingStage'
  | 'compensation'
  | 'currentAssignmentId'
  | 'createdAt'
  | 'updatedAt'
  | 'schemaVersion'
>;

function workforceIdentityId(kind:'EMAIL'|'NATIONAL_ID', value:string):string{
  const normalized=value.trim().toLowerCase();
  const digest=createHash('sha256').update(`${kind}\u0000${normalized}`).digest('hex').slice(0,40);
  return `wid_${kind.toLowerCase()}_${digest}`;
function credentialIdentityId(
  credentialType:EmployeeCredential['credentialType'],
  credentialNumber:string
):string{
  const normalized=credentialNumber.trim().toUpperCase().replace(/\s+/g,' ');
  return 'cred_ident_'+createHash('sha256')
    .update(`${credentialType}\u0000${normalized}`)
    .digest('hex')
    .slice(0,40);
}

function privilegeSlotId(params:{
  employeeId:string;
  privilegeType:ClinicalPrivilege['privilegeType'];
  facilityId:string;
  departmentId:string;
}):string{
  return 'prv_slot_'+createHash('sha256')
    .update([
      params.employeeId,
      params.privilegeType,
      params.facilityId,
      params.departmentId,
    ].map(v=>v.trim().toLowerCase()).join('\u0000'))
    .digest('hex')
    .slice(0,40);
}

}

function workforceReject<T>(
  commandId:string,
  idempotencyKey:string,
  code:string,
  message:string,
  details?:unknown
):CommandResult<T>{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function assertWorkforceFacilityScope(
  context:CommandContext,
  facilityIds:string[]
):void{
  const privileged=context.roles.some(role=>
    ['SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'].includes(role)
  );
  const actorFacilities=new Set(context.facilityIds||[]);
  if(
    !privileged &&
    actorFacilities.size>0 &&
    facilityIds.some(facilityId=>!actorFacilities.has(facilityId))
  ){
    throw new AtomicMutationRejectedError(
      'HCM_FACILITY_SCOPE_MISMATCH',
      'Workforce mutation references a facility outside the actor scope.',
      {facilityIds}
    );
  }
}

function assertEmployeeStructure(payload:CreateEmployeePayload):void{
  const facilities=[...new Set(payload.facilityIds)];
  const departments=[...new Set(payload.departmentIds)];
  if(!facilities.length||!facilities.includes(payload.primaryFacilityId)){
    throw new AtomicMutationRejectedError(
      'INVALID_EMPLOYEE_FACILITY_ASSIGNMENT',
      'Primary facility must be included in the employee facility assignments.'
    );
  }
  if(!departments.length||!departments.includes(payload.primaryDepartmentId)){
    throw new AtomicMutationRejectedError(
      'INVALID_EMPLOYEE_DEPARTMENT_ASSIGNMENT',
      'Primary department must be included in the employee department assignments.'
    );
  }
  const hireMs=Date.parse(`${payload.hireDate}T00:00:00.000Z`);
  const birthMs=Date.parse(`${payload.personalInfo.dateOfBirth}T00:00:00.000Z`);
  if(!Number.isFinite(hireMs)){
    throw new AtomicMutationRejectedError('INVALID_EMPLOYEE_HIRE_DATE','Hire date is invalid.');
  }
  if(!Number.isFinite(birthMs)||birthMs>=hireMs||birthMs>Date.now()){
    throw new AtomicMutationRejectedError(
      'INVALID_EMPLOYEE_DATE_OF_BIRTH',
      'Date of birth must be valid, in the past, and precede the hire date.'
    );
  }
}

function allowedEmploymentTransition(
  from:EmployeeMaster['employmentStatus'],
  to:EmployeeMaster['employmentStatus']
):boolean{
  const allowed:Record<EmployeeMaster['employmentStatus'],EmployeeMaster['employmentStatus'][]>={
    APPLICANT:['ONBOARDING','INACTIVE'],
    ONBOARDING:['ACTIVE','SUSPENDED','TERMINATED','INACTIVE'],
    ACTIVE:['ON_LEAVE','SUSPENDED','NOTICE_PERIOD','TERMINATED','RETIRED','INACTIVE'],
    ON_LEAVE:['ACTIVE','SUSPENDED','NOTICE_PERIOD','TERMINATED','INACTIVE'],
    SUSPENDED:['ACTIVE','NOTICE_PERIOD','TERMINATED','INACTIVE'],
    NOTICE_PERIOD:['ACTIVE','SUSPENDED','TERMINATED','RETIRED'],
    TERMINATED:[],
    RETIRED:[],
    INACTIVE:[],
  };
  return allowed[from].includes(to);
}

export class HrWorkforceDomainService {
  // In-memory CQRS cache stores for instant simulation and persistence sync
  private static employees: Map<string, EmployeeMaster> = new Map();
  private static credentials: Map<string, EmployeeCredential> = new Map();
  private static privileges: Map<string, ClinicalPrivilege> = new Map();
  private static shifts: Map<string, RosterShiftEntry> = new Map();
  private static attendanceRecords: Map<string, AttendanceRecord> = new Map();
  private static leaveRequests: Map<string, LeaveRequest> = new Map();
  private static leaveBalances: Map<string, EmployeeLeaveBalance[]> = new Map();
  private static compensationRecords: Map<string, CompensationStructure> = new Map();
  private static performanceReviews: Map<string, PerformanceReview> = new Map();
  private static disciplinaryRecords: Map<string, DisciplinaryRecord> = new Map();
  private static trainingRecords: Map<string, EmployeeTrainingRecord[]> = new Map();

  private static async loadEmployee(
    tenantId: string,
    employeeId: string
  ): Promise<EmployeeMaster | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<EmployeeMaster>(
        tenantId,
        'employees',
        employeeId
      );
      if (persisted) this.employees.set(employeeId, persisted);
      else this.employees.delete(employeeId);
      return persisted;
    }
    return this.employees.get(employeeId) || null;
  }

  private static async loadCredential(
    tenantId: string,
    credentialId: string
  ): Promise<EmployeeCredential | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<EmployeeCredential>(
        tenantId,
        'clinicalCredentials',
        credentialId
      );
      if (persisted) this.credentials.set(credentialId, persisted);
      else this.credentials.delete(credentialId);
      return persisted;
    }
    return this.credentials.get(credentialId) || null;
  }

  private static async loadAttendance(
    tenantId: string,
    attendanceId: string
  ): Promise<AttendanceRecord | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<AttendanceRecord>(
        tenantId,
        'attendanceRecords',
        attendanceId
      );
      if (persisted) this.attendanceRecords.set(attendanceId, persisted);
      else this.attendanceRecords.delete(attendanceId);
      return persisted;
    }
    return this.attendanceRecords.get(attendanceId) || null;
  }

  private static async loadLeave(
    tenantId: string,
    leaveId: string
  ): Promise<LeaveRequest | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<LeaveRequest>(
        tenantId,
        'leaveRequests',
        leaveId
      );
      if (persisted) this.leaveRequests.set(leaveId, persisted);
      else this.leaveRequests.delete(leaveId);
      return persisted;
    }
    return this.leaveRequests.get(leaveId) || null;
  }

  private static async hydrateClinicalEligibility(
    tenantId: string,
    employeeId: string
  ): Promise<void> {
    const [credentials, privileges] = await Promise.all([
      DomainStateRepository.queryEqual<EmployeeCredential>(
        tenantId,
        'clinicalCredentials',
        'employeeId',
        employeeId
      ),
      DomainStateRepository.queryEqual<ClinicalPrivilege>(
        tenantId,
        'clinicalPrivileges',
        'employeeId',
        employeeId
      ),
    ]);

    for (const credential of credentials) {
      this.credentials.set(credential.credentialId, credential);
    }
    for (const privilege of privileges) {
      this.privileges.set(privilege.privilegeId, privilege);
    }
  }

  private static async loadShiftsForEmployee(
    tenantId: string,
    employeeId: string
  ): Promise<RosterShiftEntry[]> {
    const byId = new Map<string, RosterShiftEntry>();

    for (const shift of this.shifts.values()) {
      if (shift.employeeId === employeeId) byId.set(shift.rosterId, shift);
    }

    const persisted = await DomainStateRepository.queryEqual<RosterShiftEntry>(
      tenantId,
      'rosterAssignments',
      'employeeId',
      employeeId
    );

    for (const shift of persisted) {
      this.shifts.set(shift.rosterId, shift);
      byId.set(shift.rosterId, shift);
    }

    return Array.from(byId.values());
  }

  // ============================================================================
  // 1. EMPLOYEE MASTER & LIFECYCLE
  // ============================================================================

  public static async createEmployee(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateEmployeePayload
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'],
    });
    if(!auth.authorized){
      return workforceReject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'HR Admin authority required.');
    }

    try{
      assertEmployeeStructure(payload);
      assertWorkforceFacilityScope(context,payload.facilityIds);

      const normalizedEmail=payload.personalInfo.contactEmail.trim().toLowerCase();
      const normalizedNationalId=payload.personalInfo.nationalIdNumber?.trim();
      const emailIdentityId=workforceIdentityId('EMAIL',normalizedEmail);
      const nationalIdentityId=normalizedNationalId
        ? workforceIdentityId('NATIONAL_ID',normalizedNationalId)
        : undefined;
      const employeeUuid=randomUUID();
      const employeeId=`emp_${employeeUuid}`;
      const employeeNumber=`EMP-${new Date().getUTCFullYear()}-${employeeUuid.replaceAll('-','').slice(0,10).toUpperCase()}`;
      const assignmentId=`asg_${randomUUID()}`;
      const now=new Date().toISOString();
      const employee:EmployeeMaster={
        ...payload,
        employeeId,
        employeeNumber,
        tenantId:context.tenantId,
        personalInfo:{
          ...payload.personalInfo,
          contactEmail:normalizedEmail,
          ...(normalizedNationalId?{nationalIdNumber:normalizedNationalId}:{}),
        },
        facilityIds:[...new Set(payload.facilityIds)],
        departmentIds:[...new Set(payload.departmentIds)],
        employmentStatus:'ONBOARDING',
        onboardingStage:'OFFER_ACCEPTED',
        currentAssignmentId:assignmentId,
        createdAt:now,
        updatedAt:now,
        schemaVersion:1,
      };
      const assignment:EmployeeAssignmentHistory={
        assignmentId,
        employeeId,
        employeeName:`${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName}`,
        facilityId:employee.primaryFacilityId,
        facilityName:employee.primaryFacilityId,
        departmentId:employee.primaryDepartmentId,
        departmentName:employee.primaryDepartmentName,
        positionId:employee.positionId,
        positionTitle:employee.positionTitle,
        managerId:employee.managerId,
        startDate:employee.hireDate,
        status:'ACTIVE',
        createdAt:now,
      };

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'EMPLOYEE_MASTER',
        aggregateId:employeeId,
        eventType:'EMPLOYEE_CREATED',
        auditAction:'EMPLOYEE_CREATED',
        auditResourceType:'EMPLOYEE_MASTER',
        auditResourceId:employeeId,
        outboxTopic:'g-hims-workforce-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'emailIdentity',entityType:'WORKFORCE_IDENTITY',entityId:emailIdentityId,required:false},
          ...(nationalIdentityId
            ? [{key:'nationalIdentity',entityType:'WORKFORCE_IDENTITY',entityId:nationalIdentityId,required:false}]
            : []),
        ],
        prepare:(current)=>{
          if(current.emailIdentity){
            throw new AtomicMutationRejectedError(
              'EMPLOYEE_EMAIL_ALREADY_REGISTERED',
              'An employee already exists with this normalized contact email.'
            );
          }
          if(nationalIdentityId&&current.nationalIdentity){
            throw new AtomicMutationRejectedError(
              'EMPLOYEE_NATIONAL_ID_ALREADY_REGISTERED',
              'An employee already exists with this national identifier.'
            );
          }
          const identityWrites:Array<{entityType:string;entityId:string;domainState:unknown}>=[
            {
              entityType:'WORKFORCE_IDENTITY',
              entityId:emailIdentityId,
              domainState:{
                identityId:emailIdentityId,tenantId:context.tenantId,type:'EMAIL',
                employeeId,createdAt:now,
              },
            },
          ];
          if(nationalIdentityId&&normalizedNationalId){
            identityWrites.push({
              entityType:'WORKFORCE_IDENTITY',
              entityId:nationalIdentityId,
              domainState:{
                identityId:nationalIdentityId,tenantId:context.tenantId,type:'NATIONAL_ID',
                employeeId,createdAt:now,
              },
            });
          }
          return {
          domainState:employee,
          additionalStateWrites:[
            ...identityWrites,
            {
              entityType:'EMPLOYEE_ASSIGNMENT',
              entityId:assignmentId,
              domainState:assignment,
            },
          ],
          eventPayload:{
            employeeId,employeeNumber,
            fullName:assignment.employeeName,
            facilityId:employee.primaryFacilityId,
            departmentId:employee.primaryDepartmentId,
            positionTitle:employee.positionTitle,
            employmentType:employee.employmentType,
            employmentStatus:employee.employmentStatus,
          },
          auditReason:`Created employee ${employeeNumber} in ONBOARDING under tenant-authoritative workforce master.`,
          resultData:employee,
          };
        },
      });
      this.employees.set(employeeId,employee);
      return {
        success:true,commandId,idempotencyKey,entityId:employeeId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:employee,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async updateEmployeeStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      newStatus: EmployeeMaster['employmentStatus'];
      reason: string;
    }
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'],
    });
    if(!auth.authorized){
      return workforceReject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Unauthorized.');
    }

    const preflight=await this.loadEmployee(context.tenantId,payload.employeeId);
    if(!preflight){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND',`Employee ${payload.employeeId} does not exist.`);
    }

    try{
      assertWorkforceFacilityScope(context,preflight.facilityIds);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'EMPLOYEE_MASTER',aggregateId:payload.employeeId,
        eventType:'EMPLOYEE_STATUS_TRANSITIONED',
        auditAction:'EMPLOYEE_STATUS_TRANSITIONED',
        auditResourceType:'EMPLOYEE_MASTER',auditResourceId:payload.employeeId,
        outboxTopic:'g-hims-workforce-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {
            key:'employee',entityType:'EMPLOYEE_MASTER',
            entityId:payload.employeeId,required:true,
          },
          ...(preflight.currentAssignmentId
            ? [{
                key:'currentAssignment',
                entityType:'EMPLOYEE_ASSIGNMENT',
                entityId:preflight.currentAssignmentId,
                required:false,
              }]
            : []),
        ],
        prepare:(current)=>{
          const employee=(current.employee as unknown as EmployeeMaster | null)||preflight;
          if(!allowedEmploymentTransition(employee.employmentStatus,payload.newStatus)){
            throw new AtomicMutationRejectedError(
              'INVALID_EMPLOYMENT_STATUS_TRANSITION',
              `Employment status cannot transition from ${employee.employmentStatus} to ${payload.newStatus}.`
            );
          }
          const now=new Date().toISOString();
          const next:EmployeeMaster={
            ...employee,
            employmentStatus:payload.newStatus,
            updatedAt:now,
            ...(payload.newStatus==='ACTIVE'?{onboardingStage:'ACTIVE' as const}:{}),
            ...(['TERMINATED','RETIRED'].includes(payload.newStatus)
              ? {terminationDate:now.slice(0,10)}
              : {}),
          };
          const terminal=['TERMINATED','RETIRED','INACTIVE'].includes(payload.newStatus);
          const currentAssignment=current.currentAssignment as unknown as EmployeeAssignmentHistory|null;
          const additionalStateWrites:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          if(terminal&&currentAssignment){
            additionalStateWrites.push({
              entityType:'EMPLOYEE_ASSIGNMENT',
              entityId:currentAssignment.assignmentId,
              domainState:{
                ...currentAssignment,
                endDate:now.slice(0,10),
                status:'CONCLUDED',
              },
            });
          }
          const finalState:EmployeeMaster=terminal
            ? {...next,currentAssignmentId:undefined}
            : next;
          return {
            domainState:finalState,
            additionalStateWrites,
            eventPayload:{
              employeeId:finalState.employeeId,
              previousStatus:employee.employmentStatus,
              newStatus:payload.newStatus,
              reason:payload.reason,
              assignmentConcluded:terminal&&Boolean(currentAssignment),
            },
            auditReason:`Status of ${finalState.employeeNumber} changed from ${employee.employmentStatus} to ${payload.newStatus}: ${payload.reason}`,
            resultData:finalState,
          };
        },
      });
      const next=tx.resultData as EmployeeMaster;
      this.employees.set(payload.employeeId,next);
      return {
        success:true,commandId,idempotencyKey,entityId:payload.employeeId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:next,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async transferEmployee(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      toFacilityId?: string;
      toDepartmentId: string;
      toDepartmentName: string;
      toPositionId: string;
      toPositionTitle: string;
      reason: string;
      effectiveDate: string;
    }
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'],
    });
    if(!auth.authorized){
      return workforceReject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'HR Admin authority required.');
    }

    const preflight=await this.loadEmployee(context.tenantId,payload.employeeId);
    if(!preflight){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND',`Employee ${payload.employeeId} does not exist.`);
    }
    if(['TERMINATED','RETIRED','INACTIVE'].includes(preflight.employmentStatus)){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_TRANSFERABLE','Inactive/terminal employees cannot be transferred.');
    }

    const targetFacilityId=payload.toFacilityId||preflight.primaryFacilityId;
    try{
      assertWorkforceFacilityScope(context,[targetFacilityId]);
      const effectiveMs=Date.parse(`${payload.effectiveDate}T00:00:00.000Z`);
      const hireMs=Date.parse(`${preflight.hireDate}T00:00:00.000Z`);
      const todayUtc=Date.parse(`${new Date().toISOString().slice(0,10)}T00:00:00.000Z`);
      if(!Number.isFinite(effectiveMs)||effectiveMs<hireMs){
        throw new AtomicMutationRejectedError(
          'INVALID_TRANSFER_EFFECTIVE_DATE',
          'Transfer effective date must be valid and not precede hire date.'
        );
      }
      if(effectiveMs>todayUtc){
        throw new AtomicMutationRejectedError(
          'FUTURE_TRANSFER_REQUIRES_SCHEDULING',
          'Future-dated transfers cannot mutate the current assignment. Use a scheduled workforce action when that capability is enabled.'
        );
      }
      const nextAssignmentId=`asg_${randomUUID()}`;
      const readTargets:Array<{key:string;entityType:string;entityId:string;required:boolean}>=[
        {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:payload.employeeId,required:true},
      ];
      if(preflight.currentAssignmentId){
        readTargets.push({
          key:'currentAssignment',entityType:'EMPLOYEE_ASSIGNMENT',
          entityId:preflight.currentAssignmentId,required:false,
        });
      }

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'EMPLOYEE_MASTER',aggregateId:payload.employeeId,
        eventType:'EMPLOYEE_TRANSFERRED',auditAction:'EMPLOYEE_TRANSFERRED',
        auditResourceType:'EMPLOYEE_MASTER',auditResourceId:payload.employeeId,
        outboxTopic:'g-hims-workforce-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets,
        prepare:(current)=>{
          const employee=(current.employee as unknown as EmployeeMaster | null)||preflight;
          if(['TERMINATED','RETIRED','INACTIVE'].includes(employee.employmentStatus)){
            throw new AtomicMutationRejectedError('EMPLOYEE_NOT_TRANSFERABLE','Inactive/terminal employees cannot be transferred.');
          }
          const previousDept={id:employee.primaryDepartmentId,name:employee.primaryDepartmentName};
          const previousPosition={id:employee.positionId,title:employee.positionTitle};
          const previousFacilityId=employee.primaryFacilityId;
          const now=new Date().toISOString();
          const next:EmployeeMaster={
            ...employee,
            primaryFacilityId:targetFacilityId,
            facilityIds:[...new Set([...employee.facilityIds,targetFacilityId])],
            primaryDepartmentId:payload.toDepartmentId,
            primaryDepartmentName:payload.toDepartmentName,
            departmentIds:[...new Set([...employee.departmentIds,payload.toDepartmentId])],
            positionId:payload.toPositionId,
            positionTitle:payload.toPositionTitle,
            currentAssignmentId:nextAssignmentId,
            updatedAt:now,
          };
          const nextAssignment:EmployeeAssignmentHistory={
            assignmentId:nextAssignmentId,
            employeeId:next.employeeId,
            employeeName:`${next.personalInfo.legalFirstName} ${next.personalInfo.legalLastName}`,
            facilityId:targetFacilityId,
            facilityName:targetFacilityId,
            departmentId:payload.toDepartmentId,
            departmentName:payload.toDepartmentName,
            positionId:payload.toPositionId,
            positionTitle:payload.toPositionTitle,
            managerId:next.managerId,
            startDate:payload.effectiveDate,
            transferReason:payload.reason,
            status:'ACTIVE',
            createdAt:now,
          };
          const additionalStateWrites:Array<{entityType:string;entityId:string;domainState:unknown}>=[
            {entityType:'EMPLOYEE_ASSIGNMENT',entityId:nextAssignmentId,domainState:nextAssignment},
          ];
          const currentAssignment=current.currentAssignment as unknown as EmployeeAssignmentHistory|null;
          if(currentAssignment){
            additionalStateWrites.push({
              entityType:'EMPLOYEE_ASSIGNMENT',
              entityId:currentAssignment.assignmentId,
              domainState:{
                ...currentAssignment,
                endDate:payload.effectiveDate,
                status:'CONCLUDED',
              },
            });
          }
          return {
            domainState:next,additionalStateWrites,
            eventPayload:{
              employeeId:next.employeeId,
              previousFacilityId,newFacilityId:targetFacilityId,
              previousDept,newDept:{id:payload.toDepartmentId,name:payload.toDepartmentName},
              previousPosition,newPosition:{id:payload.toPositionId,title:payload.toPositionTitle},
              reason:payload.reason,effectiveDate:payload.effectiveDate,
              assignmentId:nextAssignmentId,
            },
            auditReason:`Employee ${next.employeeNumber} transferred from ${previousDept.name} to ${payload.toDepartmentName}: ${payload.reason}`,
            resultData:next,
          };
        },
      });
      const next=tx.resultData as EmployeeMaster;
      this.employees.set(payload.employeeId,next);
      return {
        success:true,commandId,idempotencyKey,entityId:payload.employeeId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:next,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  // ============================================================================
  // 2. CREDENTIALS & CLINICAL PRIVILEGES (With Auto-Lockout)
  // ============================================================================

  public static async submitCredential(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<
      EmployeeCredential,
      | 'credentialId'
      | 'employeeName'
      | 'verificationStatus'
      | 'verifiedByActorId'
      | 'verifiedByName'
      | 'verifiedAt'
      | 'submittedByActorId'
      | 'submittedAt'
      | 'createdAt'
      | 'updatedAt'
    >
  ): Promise<CommandResult<EmployeeCredential>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','MEDICAL_DIRECTOR','SYSTEM_ADMIN'],
    });
    if(!auth.authorized){
      return workforceReject(
        commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
        auth.reason||'Credential submission authority required.'
      );
    }

    const employee=await this.loadEmployee(context.tenantId,payload.employeeId);
    if(!employee){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND','Credential target employee does not exist.');
    }
    try{
      assertWorkforceFacilityScope(context,employee.facilityIds);
      if(['TERMINATED','RETIRED','INACTIVE'].includes(employee.employmentStatus)){
        throw new AtomicMutationRejectedError(
          'EMPLOYEE_NOT_CREDENTIALABLE',
          `Credentials cannot be submitted for employee status ${employee.employmentStatus}.`
        );
      }
      const issueMs=Date.parse(payload.issueDate);
      const expiryMs=Date.parse(payload.expiryDate);
      if(!Number.isFinite(issueMs)||!Number.isFinite(expiryMs)||expiryMs<=issueMs){
        throw new AtomicMutationRejectedError(
          'INVALID_CREDENTIAL_VALIDITY',
          'Credential issue/expiry dates are invalid.'
        );
      }

      const credentialId=`crd_${randomUUID()}`;
      const identityId=credentialIdentityId(payload.credentialType,payload.credentialNumber);
      const normalizedNumber=payload.credentialNumber.trim().toUpperCase().replace(/\s+/g,' ');
      const now=new Date().toISOString();
      const credential:EmployeeCredential={
        ...payload,
        employeeName:`${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName}`,
        credentialNumber:normalizedNumber,
        credentialId,
        verificationStatus:'UNDER_REVIEW',
        submittedByActorId:context.actorId,
        submittedAt:now,
        createdAt:now,
        updatedAt:now,
      };

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'EMPLOYEE_CREDENTIAL',
        aggregateId:credentialId,
        eventType:'CREDENTIAL_SUBMITTED',
        auditAction:'CREDENTIAL_SUBMITTED',
        auditResourceType:'EMPLOYEE_CREDENTIAL',
        auditResourceId:credentialId,
        outboxTopic:'g-hims-credential-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:employee.employeeId,required:true},
          {key:'identity',entityType:'CREDENTIAL_IDENTITY',entityId:identityId,required:false},
        ],
        prepare:(current)=>{
          const currentEmployee=current.employee as unknown as EmployeeMaster;
          if(['TERMINATED','RETIRED','INACTIVE'].includes(currentEmployee.employmentStatus)){
            throw new AtomicMutationRejectedError('EMPLOYEE_NOT_CREDENTIALABLE','Employee status changed before credential submission.');
          }
          if(current.identity){
            throw new AtomicMutationRejectedError(
              'CREDENTIAL_NUMBER_ALREADY_REGISTERED',
              'This credential type/number is already registered in the tenant.'
            );
          }
          return {
            domainState:credential,
            additionalStateWrites:[{
              entityType:'CREDENTIAL_IDENTITY',
              entityId:identityId,
              domainState:{
                identityId,
                tenantId:context.tenantId,
                credentialId,
                employeeId:credential.employeeId,
                credentialType:credential.credentialType,
                credentialNumber:normalizedNumber,
                createdAt:now,
              },
            }],
            eventPayload:{
              credentialId,
              employeeId:credential.employeeId,
              credentialType:credential.credentialType,
              credentialNumber:normalizedNumber,
              expiryDate:credential.expiryDate,
            },
            auditReason:`Credential ${credential.title} (${normalizedNumber}) submitted for employee ${credential.employeeId}.`,
            resultData:credential,
          };
        },
      });
      this.credentials.set(credentialId,credential);
      return {
        success:true,commandId,idempotencyKey,entityId:credentialId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:credential,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async verifyCredential(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      credentialId: string;
      status: 'VERIFIED' | 'REJECTED';
      notes?: string;
    }
  ): Promise<CommandResult<EmployeeCredential>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['MEDICAL_DIRECTOR','HR_ADMIN','SYSTEM_ADMIN'],
    });
    if(!auth.authorized){
      return workforceReject(
        commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
        auth.reason||'Credential verification authority required.'
      );
    }

    const preflight=await this.loadCredential(context.tenantId,payload.credentialId);
    if(!preflight){
      return workforceReject(commandId,idempotencyKey,'CREDENTIAL_NOT_FOUND',`Credential ${payload.credentialId} not found.`);
    }
    const employee=await this.loadEmployee(context.tenantId,preflight.employeeId);
    if(!employee){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND','Credential employee no longer exists.');
    }

    try{
      assertWorkforceFacilityScope(context,employee.facilityIds);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'EMPLOYEE_CREDENTIAL',
        aggregateId:payload.credentialId,
        eventType:payload.status==='VERIFIED'?'CREDENTIAL_VERIFIED':'CREDENTIAL_REJECTED',
        auditAction:payload.status==='VERIFIED'?'CREDENTIAL_VERIFIED':'CREDENTIAL_REJECTED',
        auditResourceType:'EMPLOYEE_CREDENTIAL',
        auditResourceId:payload.credentialId,
        outboxTopic:'g-hims-credential-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'credential',entityType:'EMPLOYEE_CREDENTIAL',entityId:payload.credentialId,required:true},
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:employee.employeeId,required:true},
        ],
        prepare:(current)=>{
          const credential=current.credential as unknown as EmployeeCredential;
          if(!['PENDING','SUBMITTED','UNDER_REVIEW'].includes(credential.verificationStatus)){
            throw new AtomicMutationRejectedError(
              'CREDENTIAL_NOT_REVIEWABLE',
              `Credential in status ${credential.verificationStatus} cannot be reviewed again.`
            );
          }
          if(credential.submittedByActorId&&credential.submittedByActorId===context.actorId){
            throw new AtomicMutationRejectedError(
              'HCM_SEGREGATION_OF_DUTIES',
              'Credential submitter cannot verify the same credential.'
            );
          }
          const today=new Date().toISOString().slice(0,10);
          if(payload.status==='VERIFIED'&&credential.expiryDate<today){
            throw new AtomicMutationRejectedError(
              'CREDENTIAL_ALREADY_EXPIRED',
              'An expired credential cannot be verified as active.'
            );
          }
          const now=new Date().toISOString();
          const next:EmployeeCredential={
            ...credential,
            verificationStatus:payload.status,
            verifiedByActorId:context.actorId,
            verifiedByName:context.actorId,
            verifiedAt:now,
            notes:payload.notes||credential.notes,
            updatedAt:now,
          };
          return {
            domainState:next,
            eventPayload:{
              credentialId:next.credentialId,
              employeeId:next.employeeId,
              verificationStatus:next.verificationStatus,
              verifiedBy:context.actorId,
            },
            auditReason:`Credential ${next.credentialId} set to ${next.verificationStatus} by ${context.actorId}.`,
            resultData:next,
          };
        },
      });
      const next=tx.resultData as EmployeeCredential;
      this.credentials.set(payload.credentialId,next);
      return {
        success:true,commandId,idempotencyKey,entityId:payload.credentialId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:next,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  /**
   * Test/runtime helper. Production command authorization derives eligibility from
   * persistent tenant-scoped credential/privilege records in authorization-context.ts.
   */
  public static checkClinicalEligibility(employeeId: string): {
    isEligible: boolean;
    reason?: string;
    expiredCredentials: EmployeeCredential[];
    activePrivileges: ClinicalPrivilege[];
  } {
    const today=new Date().toISOString().slice(0,10);
    const employeeCreds=Array.from(this.credentials.values()).filter(c=>c.employeeId===employeeId);
    const mandatory=employeeCreds.filter(c=>c.isMandatoryForPractice);
    const invalidMandatory=mandatory.filter(c=>
      c.verificationStatus!=='VERIFIED'||!c.expiryDate||c.expiryDate<today
    );
    const employeePrivileges=Array.from(this.privileges.values()).filter(p=>
      p.employeeId===employeeId&&
      p.status==='GRANTED'&&
      p.effectiveFrom<=today&&
      p.effectiveUntil>=today
    );
    if(mandatory.length===0||invalidMandatory.length>0){
      return {
        isEligible:false,
        reason:mandatory.length===0
          ? 'CLINICAL PRACTICE LOCKOUT: no mandatory verified credential is on file.'
          : `CLINICAL PRACTICE LOCKOUT: ${invalidMandatory.length} mandatory credential(s) expired or unverified.`,
        expiredCredentials:invalidMandatory,
        activePrivileges:[],
      };
    }
    return {isEligible:true,expiredCredentials:[],activePrivileges:employeePrivileges};
  }

  public static async grantClinicalPrivilege(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<
      ClinicalPrivilege,
      | 'privilegeId'
      | 'employeeName'
      | 'status'
      | 'grantedByActorId'
      | 'grantedByName'
      | 'reviewedAt'
      | 'statusReason'
      | 'statusChangedByActorId'
      | 'statusChangedAt'
      | 'createdAt'
      | 'updatedAt'
    >
  ): Promise<CommandResult<ClinicalPrivilege>> {
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['MEDICAL_DIRECTOR','SYSTEM_ADMIN'],
    });
    if(!auth.authorized){
      return workforceReject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED','Medical Director authority required to grant clinical privileges.');
    }

    const employee=await this.loadEmployee(context.tenantId,payload.employeeId);
    if(!employee){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND','Clinical privilege target employee does not exist.');
    }
    try{
      assertWorkforceFacilityScope(context,[payload.facilityId]);
      if(employee.employmentStatus!=='ACTIVE'){
        throw new AtomicMutationRejectedError(
          'EMPLOYEE_NOT_ACTIVE',
          `Clinical privileges cannot be granted while employee status is ${employee.employmentStatus}.`
        );
      }
      if(
        !employee.facilityIds.includes(payload.facilityId) ||
        !employee.departmentIds.includes(payload.departmentId)
      ){
        throw new AtomicMutationRejectedError(
          'PRIVILEGE_SCOPE_OUTSIDE_EMPLOYEE_ASSIGNMENT',
          'Clinical privilege scope must be within the employee workforce assignment.'
        );
      }
      const today=new Date().toISOString().slice(0,10);
      if(
        !payload.effectiveFrom ||
        !payload.effectiveUntil ||
        payload.effectiveFrom>payload.effectiveUntil ||
        payload.effectiveUntil<today
      ){
        throw new AtomicMutationRejectedError('INVALID_PRIVILEGE_VALIDITY','Clinical privilege requires a valid effective period.');
      }

      const credentials=await DomainStateRepository.queryEqual<EmployeeCredential>(
        context.tenantId,'clinicalCredentials','employeeId',payload.employeeId
      );
      const credentialTargets=credentials.map((credential,index)=>({
        key:`credential:${index}`,
        entityType:'EMPLOYEE_CREDENTIAL',
        entityId:credential.credentialId,
        required:true,
      }));
      const slotId=privilegeSlotId(payload);
      const privilegeId=`prv_${randomUUID()}`;
      const now=new Date().toISOString();

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CLINICAL_PRIVILEGE',
        aggregateId:privilegeId,
        eventType:'CLINICAL_PRIVILEGE_GRANTED',
        auditAction:'CLINICAL_PRIVILEGE_GRANTED',
        auditResourceType:'CLINICAL_PRIVILEGE',
        auditResourceId:privilegeId,
        outboxTopic:'g-hims-privilege-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:employee.employeeId,required:true},
          {key:'slot',entityType:'CLINICAL_PRIVILEGE_SLOT',entityId:slotId,required:false},
          ...credentialTargets,
        ],
        prepare:(current)=>{
          const currentEmployee=current.employee as unknown as EmployeeMaster;
          if(currentEmployee.employmentStatus!=='ACTIVE'){
            throw new AtomicMutationRejectedError('EMPLOYEE_NOT_ACTIVE','Employee status changed before privilege grant.');
          }
          const currentCredentials=credentialTargets.map(target=>
            current[target.key] as unknown as EmployeeCredential
          );
          const mandatory=currentCredentials.filter(credential=>credential.isMandatoryForPractice);
          const invalidMandatory=mandatory.filter(credential=>
            credential.verificationStatus!=='VERIFIED' ||
            !credential.expiryDate ||
            credential.expiryDate<today
          );
          if(mandatory.length===0||invalidMandatory.length>0){
            throw new AtomicMutationRejectedError(
              'CREDENTIAL_PREREQUISITE_FAILED',
              mandatory.length===0
                ? 'Clinical privilege denied: no mandatory verified credential is on file.'
                : `Clinical privilege denied: ${invalidMandatory.length} mandatory credential(s) are expired or unverified.`
            );
          }
          const slot=current.slot as unknown as {status?:string;activePrivilegeId?:string}|null;
          if(slot?.status==='ACTIVE'){
            throw new AtomicMutationRejectedError(
              'ACTIVE_PRIVILEGE_ALREADY_EXISTS',
              `An active ${payload.privilegeType} privilege already exists for this scope.`
            );
          }

          const privilege:ClinicalPrivilege={
            ...payload,
            employeeName:`${currentEmployee.personalInfo.legalFirstName} ${currentEmployee.personalInfo.legalLastName}`,
            privilegeId,
            status:'GRANTED',
            grantedByActorId:context.actorId,
            grantedByName:context.actorId,
            reviewedAt:now,
            statusChangedByActorId:context.actorId,
            statusChangedAt:now,
            createdAt:now,
            updatedAt:now,
          };
          return {
            domainState:privilege,
            additionalStateWrites:[{
              entityType:'CLINICAL_PRIVILEGE_SLOT',
              entityId:slotId,
              domainState:{
                slotId,tenantId:context.tenantId,
                employeeId:payload.employeeId,
                privilegeType:payload.privilegeType,
                facilityId:payload.facilityId,
                departmentId:payload.departmentId,
                activePrivilegeId:privilegeId,
                status:'ACTIVE',
                updatedAt:now,
              },
            }],
            eventPayload:{
              privilegeId,
              employeeId:payload.employeeId,
              privilegeType:payload.privilegeType,
              facilityId:payload.facilityId,
              departmentId:payload.departmentId,
              effectiveFrom:payload.effectiveFrom,
              effectiveUntil:payload.effectiveUntil,
            },
            auditReason:`Granted privilege ${payload.privilegeType} to employee ${payload.employeeId}.`,
            resultData:privilege,
          };
        },
      });
      const privilege=tx.resultData as ClinicalPrivilege;
      this.privileges.set(privilegeId,privilege);
      return {
        success:true,commandId,idempotencyKey,entityId:privilegeId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:privilege,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async changeClinicalPrivilegeStatus(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:{
      privilegeId:string;
      status:'GRANTED'|'SUSPENDED'|'REVOKED';
      reason:string;
    }
  ):Promise<CommandResult<ClinicalPrivilege>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['MEDICAL_DIRECTOR','SYSTEM_ADMIN'],
    });
    if(!auth.authorized){
      return workforceReject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED','Medical Director authority required to change clinical privileges.');
    }

    const preflight=await DomainStateRepository.getById<ClinicalPrivilege>(
      context.tenantId,'clinicalPrivileges',payload.privilegeId
    );
    if(!preflight){
      return workforceReject(commandId,idempotencyKey,'CLINICAL_PRIVILEGE_NOT_FOUND','Clinical privilege does not exist.');
    }
    const employee=await this.loadEmployee(context.tenantId,preflight.employeeId);
    if(!employee){
      return workforceReject(commandId,idempotencyKey,'EMPLOYEE_NOT_FOUND','Privilege employee does not exist.');
    }

    try{
      assertWorkforceFacilityScope(context,[preflight.facilityId]);
      const credentials=payload.status==='GRANTED'
        ? await DomainStateRepository.queryEqual<EmployeeCredential>(
            context.tenantId,'clinicalCredentials','employeeId',preflight.employeeId
          )
        : [];
      const credentialTargets=credentials.map((credential,index)=>({
        key:`credential:${index}`,
        entityType:'EMPLOYEE_CREDENTIAL',
        entityId:credential.credentialId,
        required:true,
      }));
      const slotId=privilegeSlotId(preflight);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CLINICAL_PRIVILEGE',
        aggregateId:payload.privilegeId,
        eventType:payload.status==='GRANTED'
          ? 'CLINICAL_PRIVILEGE_REINSTATED'
          : payload.status==='SUSPENDED'
            ? 'CLINICAL_PRIVILEGE_SUSPENDED'
            : 'CLINICAL_PRIVILEGE_REVOKED',
        auditAction:'CLINICAL_PRIVILEGE_STATUS_CHANGED',
        auditResourceType:'CLINICAL_PRIVILEGE',
        auditResourceId:payload.privilegeId,
        outboxTopic:'g-hims-privilege-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'privilege',entityType:'CLINICAL_PRIVILEGE',entityId:payload.privilegeId,required:true},
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:preflight.employeeId,required:true},
          {key:'slot',entityType:'CLINICAL_PRIVILEGE_SLOT',entityId:slotId,required:false},
          ...credentialTargets,
        ],
        prepare:(current)=>{
          const privilege=current.privilege as unknown as ClinicalPrivilege;
          const currentEmployee=current.employee as unknown as EmployeeMaster;
          if(privilege.status==='REVOKED'){
            throw new AtomicMutationRejectedError('PRIVILEGE_REVOKED_TERMINAL','A revoked privilege cannot be reactivated or changed.');
          }
          if(payload.status==='GRANTED'){
            if(privilege.status!=='SUSPENDED'){
              throw new AtomicMutationRejectedError('PRIVILEGE_NOT_REINSTATABLE','Only a suspended privilege may be reinstated.');
            }
            if(currentEmployee.employmentStatus!=='ACTIVE'){
              throw new AtomicMutationRejectedError('EMPLOYEE_NOT_ACTIVE','Inactive employee cannot regain clinical privilege.');
            }
            const today=new Date().toISOString().slice(0,10);
            if(privilege.effectiveUntil<today){
              throw new AtomicMutationRejectedError('PRIVILEGE_EXPIRED','Expired privilege cannot be reinstated.');
            }
            const currentCredentials=credentialTargets.map(target=>
              current[target.key] as unknown as EmployeeCredential
            );
            const mandatory=currentCredentials.filter(credential=>credential.isMandatoryForPractice);
            if(
              mandatory.length===0 ||
              mandatory.some(credential=>
                credential.verificationStatus!=='VERIFIED' ||
                !credential.expiryDate ||
                credential.expiryDate<today
              )
            ){
              throw new AtomicMutationRejectedError('CREDENTIAL_PREREQUISITE_FAILED','Credential prerequisites are not satisfied for reinstatement.');
            }
          }
          const now=new Date().toISOString();
          const next:ClinicalPrivilege={
            ...privilege,
            status:payload.status,
            statusReason:payload.reason,
            statusChangedByActorId:context.actorId,
            statusChangedAt:now,
            reviewedAt:now,
            updatedAt:now,
          };
          return {
            domainState:next,
            additionalStateWrites:[{
              entityType:'CLINICAL_PRIVILEGE_SLOT',
              entityId:slotId,
              domainState:{
                slotId,tenantId:context.tenantId,
                employeeId:next.employeeId,
                privilegeType:next.privilegeType,
                facilityId:next.facilityId,
                departmentId:next.departmentId,
                activePrivilegeId:next.privilegeId,
                status:payload.status==='GRANTED'
                  ? 'ACTIVE'
                  : payload.status,
                updatedAt:now,
              },
            }],
            eventPayload:{
              privilegeId:next.privilegeId,
              employeeId:next.employeeId,
              status:next.status,
              reason:payload.reason,
            },
            auditReason:`Clinical privilege ${next.privilegeId} changed to ${next.status}: ${payload.reason}`,
            resultData:next,
          };
        },
      });
      const next=tx.resultData as ClinicalPrivilege;
      this.privileges.set(next.privilegeId,next);
      return {
        success:true,commandId,idempotencyKey,entityId:next.privilegeId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:next,
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return workforceReject(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  // ============================================================================
  // 3. ROSTERING, SHIFTS & GAP DETECTION (With Fatigue Compliance)
  // ============================================================================

  public static async assignShift(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<RosterShiftEntry, 'rosterId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<RosterShiftEntry>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'NURSE_MANAGER', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Department Head / Nurse Manager role required.' },
      };
    }

    // Check credential lockout for clinical shifts
    await this.hydrateClinicalEligibility(context.tenantId, payload.employeeId);
    const eligibility = this.checkClinicalEligibility(payload.employeeId);
    if (!eligibility.isEligible) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CLINICAL_CREDENTIAL_EXPIRED',
          message: `Cannot assign clinical shift: ${eligibility.reason}`,
        },
      };
    }

    // Fatigue compliance: Check for rest period violation (< 10 hours rest between consecutive shifts)
    const existingEmployeeShifts = (await this.loadShiftsForEmployee(
      context.tenantId,
      payload.employeeId
    )).filter((shift) => shift.status !== 'CANCELLED');

    const proposedStart = new Date(payload.startTime).getTime();
    const minRestMs = 10 * 60 * 60 * 1000; // 10 hours

    for (const existing of existingEmployeeShifts) {
      const existingEnd = new Date(existing.endTime).getTime();
      const existingStart = new Date(existing.startTime).getTime();

      // Double-booking check
      if (
        (proposedStart >= existingStart && proposedStart < existingEnd) ||
        (new Date(payload.endTime).getTime() > existingStart && new Date(payload.endTime).getTime() <= existingEnd)
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SHIFT_DOUBLE_BOOKING_CONFLICT',
            message: `Staff member ${payload.employeeName} is already rostered for shift ${existing.shiftName} (${existing.startTime} - ${existing.endTime}).`,
          },
        };
      }

      // Rest period check
      const restGap = proposedStart - existingEnd;
      if (restGap > 0 && restGap < minRestMs) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'FATIGUE_COMPLIANCE_VIOLATION',
            message: `Mandatory rest violation: Only ${(restGap / (1000 * 60 * 60)).toFixed(1)}h rest between shifts. Minimum required is 10 hours.`,
          },
        };
      }
    }

    const rosterId = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const shiftEntry: RosterShiftEntry = {
      ...payload,
      rosterId,
      status: 'PUBLISHED',
      createdAt: now,
      updatedAt: now,
    };

    this.shifts.set(rosterId, shiftEntry);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ROSTER_SHIFT',
      entityId: rosterId,
      eventType: 'SHIFT_ASSIGNED',
      domainState: shiftEntry,
      eventPayload: {
        rosterId,
        employeeId: payload.employeeId,
        departmentId: payload.departmentId,
        date: payload.date,
        shiftName: payload.shiftName,
        startTime: payload.startTime,
        endTime: payload.endTime,
      },
      auditReason: `Assigned ${payload.shiftName} shift to ${payload.employeeName} on ${payload.date}`,
      outboxTopic: 'g-hims-roster-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: rosterId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: shiftEntry,
    };
  }

  public static calculateStaffingGaps(
    departmentId: string,
    departmentName: string,
    date: string,
    requiredCount: number,
    requiredSpecialties: string[] = []
  ): StaffingGapAnalysis {
    const scheduled = Array.from(this.shifts.values()).filter(
      (s) => s.departmentId === departmentId && s.date === date && s.status !== 'CANCELLED'
    );

    const scheduledCount = scheduled.length;
    const gapCount = requiredCount - scheduledCount;

    let status: StaffingGapAnalysis['status'] = 'FULLY_STAFFED';
    if (gapCount > 0) status = 'UNDERSTAFFED';
    else if (gapCount < 0) status = 'OVERSTAFFED';

    return {
      departmentId,
      departmentName,
      shiftId: 'ALL_SHIFTS',
      shiftName: 'Daily Coverage',
      date,
      requiredCount,
      scheduledCount,
      presentCount: scheduledCount,
      gapCount: Math.max(0, gapCount),
      status,
      missingSpecialties: gapCount > 0 ? requiredSpecialties : [],
      fatigueAlerts: [],
      credentialAlerts: [],
    };
  }

  // ============================================================================
  // 4. ATTENDANCE & TIME TRACKING (Immutable + Correction Audit)
  // ============================================================================

  public static async recordClockIn(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      employeeName: string;
      facilityId: string;
      departmentId: string;
      source: AttendanceRecord['source'];
      deviceIdentifier?: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const attendanceId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const attendance: AttendanceRecord = {
      attendanceId,
      tenantId: context.tenantId,
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      facilityId: payload.facilityId,
      departmentId: payload.departmentId,
      date: today,
      clockInTime: now,
      totalHoursWorked: 0,
      overtimeHours: 0,
      overtimeApproved: false,
      source: payload.source,
      deviceIdentifier: payload.deviceIdentifier,
      status: 'ON_TIME',
      isCorrected: false,
      createdAt: now,
      updatedAt: now,
    };

    this.attendanceRecords.set(attendanceId, attendance);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: attendanceId,
      eventType: 'EMPLOYEE_CLOCKED_IN',
      domainState: attendance,
      eventPayload: {
        attendanceId,
        employeeId: payload.employeeId,
        clockInTime: now,
        source: payload.source,
      },
      auditReason: `Employee ${payload.employeeName} clocked in via ${payload.source}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: attendance,
    };
  }

  public static async recordClockOut(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      attendanceId: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const attendance = await this.loadAttendance(context.tenantId, payload.attendanceId);
    if (!attendance) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RECORD_NOT_FOUND', message: 'Attendance record not found.' },
      };
    }

    const now = new Date().toISOString();
    const clockInMs = new Date(attendance.clockInTime).getTime();
    const clockOutMs = new Date(now).getTime();
    const hoursWorked = Math.max(0, (clockOutMs - clockInMs) / (1000 * 60 * 60));
    const overtimeHours = Math.max(0, hoursWorked - 8.0);

    attendance.clockOutTime = now;
    attendance.totalHoursWorked = Number(hoursWorked.toFixed(2));
    attendance.overtimeHours = Number(overtimeHours.toFixed(2));
    attendance.updatedAt = now;

    this.attendanceRecords.set(payload.attendanceId, attendance);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: payload.attendanceId,
      eventType: 'EMPLOYEE_CLOCKED_OUT',
      domainState: attendance,
      eventPayload: {
        attendanceId: payload.attendanceId,
        employeeId: attendance.employeeId,
        clockOutTime: now,
        totalHoursWorked: attendance.totalHoursWorked,
        overtimeHours: attendance.overtimeHours,
      },
      auditReason: `Employee ${attendance.employeeName} clocked out. Total hours: ${attendance.totalHoursWorked}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: attendance,
    };
  }

  public static async correctAttendanceTime(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      attendanceId: string;
      newClockInTime: string;
      newClockOutTime?: string;
      reason: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'SUPERVISOR', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Supervisor / HR authorization required for time corrections.' },
      };
    }

    const record = await this.loadAttendance(context.tenantId, payload.attendanceId);
    if (!record) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RECORD_NOT_FOUND', message: 'Attendance record not found.' },
      };
    }

    const previousClockIn = record.clockInTime;
    const correctionId = `cor_${Date.now()}`;
    const now = new Date().toISOString();

    if (!record.originalClockInTime) {
      record.originalClockInTime = record.clockInTime;
    }
    if (!record.originalClockOutTime && record.clockOutTime) {
      record.originalClockOutTime = record.clockOutTime;
    }

    record.clockInTime = payload.newClockInTime;
    if (payload.newClockOutTime) {
      record.clockOutTime = payload.newClockOutTime;
      const inMs = new Date(payload.newClockInTime).getTime();
      const outMs = new Date(payload.newClockOutTime).getTime();
      record.totalHoursWorked = Number(Math.max(0, (outMs - inMs) / (1000 * 60 * 60)).toFixed(2));
      record.overtimeHours = Number(Math.max(0, record.totalHoursWorked - 8).toFixed(2));
    }

    record.isCorrected = true;
    record.status = 'CORRECTED';
    record.updatedAt = now;

    if (!record.correctionHistory) record.correctionHistory = [];
    record.correctionHistory.push({
      correctionId,
      correctedByActorId: context.actorId,
      correctedByName: 'Supervisor / HR Admin',
      correctedAt: now,
      previousClockIn,
      newClockIn: payload.newClockInTime,
      reason: payload.reason,
    });

    this.attendanceRecords.set(payload.attendanceId, record);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: payload.attendanceId,
      eventType: 'ATTENDANCE_CORRECTED',
      domainState: record,
      eventPayload: {
        attendanceId: payload.attendanceId,
        previousClockIn,
        newClockIn: payload.newClockInTime,
        reason: payload.reason,
        correctedBy: context.actorId,
      },
      auditReason: `Attendance correction: ${payload.reason}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: record,
    };
  }

  // ============================================================================
  // 5. LEAVE MANAGEMENT & BALANCES
  // ============================================================================

  public static async submitLeaveRequest(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<LeaveRequest, 'leaveId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<LeaveRequest>> {
    const leaveId = `lve_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const leave: LeaveRequest = {
      ...payload,
      leaveId,
      status: 'SUBMITTED',
      createdAt: now,
      updatedAt: now,
    };

    this.leaveRequests.set(leaveId, leave);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'LEAVE_REQUEST',
      entityId: leaveId,
      eventType: 'LEAVE_REQUESTED',
      domainState: leave,
      eventPayload: {
        leaveId,
        employeeId: payload.employeeId,
        leaveType: payload.leaveType,
        startDate: payload.startDate,
        endDate: payload.endDate,
        totalDays: payload.totalDays,
      },
      auditReason: `Leave requested by ${payload.employeeName} (${payload.leaveType}, ${payload.totalDays} days)`,
      outboxTopic: 'g-hims-leave-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: leaveId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: leave,
    };
  }

  public static async approveLeaveRequest(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      leaveId: string;
      approved: boolean;
      rejectionReason?: string;
    }
  ): Promise<CommandResult<LeaveRequest>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'DEPARTMENT_HEAD', 'MEDICAL_DIRECTOR', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Department Head or HR approval authority required.' },
      };
    }

    const leave = await this.loadLeave(context.tenantId, payload.leaveId);
    if (!leave) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' },
      };
    }

    const now = new Date().toISOString();
    leave.status = payload.approved ? 'APPROVED' : 'REJECTED';
    leave.reviewedByActorId = context.actorId;
    leave.reviewedByName = 'Department Head / HR';
    leave.reviewedAt = now;
    if (!payload.approved && payload.rejectionReason) {
      leave.rejectionReason = payload.rejectionReason;
    }
    leave.updatedAt = now;

    this.leaveRequests.set(payload.leaveId, leave);

    // Deduct leave balance if approved
    if (payload.approved) {
      const balances = this.leaveBalances.get(leave.employeeId) || [];
      const balance = balances.find((b) => b.leaveType === leave.leaveType);
      if (balance) {
        balance.usedDays += leave.totalDays;
        balance.remainingDays = Math.max(0, balance.annualEntitlement - balance.usedDays);
        balance.lastUpdated = now;
      }
    }

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'LEAVE_REQUEST',
      entityId: payload.leaveId,
      eventType: payload.approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      domainState: leave,
      eventPayload: {
        leaveId: payload.leaveId,
        employeeId: leave.employeeId,
        approved: payload.approved,
        rejectionReason: payload.rejectionReason,
      },
      auditReason: `Leave ${payload.leaveId} was ${leave.status} by ${context.actorId}`,
      outboxTopic: 'g-hims-leave-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.leaveId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: leave,
    };
  }

  // ============================================================================
  // 6. SEED & HELPER UTILITIES
  // ============================================================================

  private static seedDefaultLeaveBalances(employeeId: string) {
    const year = new Date().getFullYear();
    const now = new Date().toISOString();
    const defaultBalances: EmployeeLeaveBalance[] = [
      {
        employeeId,
        leaveType: 'ANNUAL',
        year,
        annualEntitlement: 21,
        accruedDays: 21,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 21,
        lastUpdated: now,
      },
      {
        employeeId,
        leaveType: 'SICK',
        year,
        annualEntitlement: 14,
        accruedDays: 14,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 14,
        lastUpdated: now,
      },
      {
        employeeId,
        leaveType: 'STUDY_CME',
        year,
        annualEntitlement: 7,
        accruedDays: 7,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 7,
        lastUpdated: now,
      },
    ];
    this.leaveBalances.set(employeeId, defaultBalances);
  }

  public static ensureInitialized(): void {
    if (this.employees.size > 0) return;

    const runtimeMode=String(
      process.env.GHIMS_RUNTIME_MODE ||
      process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE ||
      ''
    ).trim().toUpperCase();
    const testRuntime=
      runtimeMode==='TEST' ||
      runtimeMode==='DEMO' ||
      process.env.NODE_ENV==='test';
    if(!testRuntime) return;

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const sampleEmployees: EmployeeMaster[] = [
      {
        employeeId: 'emp_001',
        employeeNumber: 'EMP-2026-0814',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_cardiology', 'dept_general_medicine'],
        primaryDepartmentId: 'dept_cardiology',
        primaryDepartmentName: 'Cardiology',
        positionId: 'pos_attending_cardio',
        positionTitle: 'Attending Cardiologist',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2021-03-15',
        personalInfo: {
          legalFirstName: 'Sarah',
          legalLastName: 'Jenkins',
          dateOfBirth: '1984-06-12',
          gender: 'FEMALE',
          contactEmail: 's.jenkins@centralmetro.health',
          contactPhone: '+1-555-019-2831',
          emergencyContact: { name: 'Mark Jenkins', relationship: 'Spouse', phone: '+1-555-019-2832' },
          residentialAddress: { street: '42 Medical Center Blvd', city: 'Metro City', state: 'NY', postalCode: '10001', country: 'USA' },
        },
        compensation: { baseSalary: 32000000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        employeeId: 'emp_002',
        employeeNumber: 'EMP-2026-0922',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_surgery', 'dept_orthopedics'],
        primaryDepartmentId: 'dept_surgery',
        primaryDepartmentName: 'Surgical Theaters',
        positionId: 'pos_chief_surgeon',
        positionTitle: 'Chief Orthopedic Surgeon',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2018-09-01',
        personalInfo: {
          legalFirstName: 'Robert',
          legalLastName: 'Hayes',
          dateOfBirth: '1976-11-23',
          gender: 'MALE',
          contactEmail: 'r.hayes@centralmetro.health',
          contactPhone: '+1-555-018-4920',
          emergencyContact: { name: 'Claire Hayes', relationship: 'Spouse', phone: '+1-555-018-4921' },
          residentialAddress: { street: '18 Highland Park', city: 'Metro City', state: 'NY', postalCode: '10002', country: 'USA' },
        },
        compensation: { baseSalary: 45000000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        employeeId: 'emp_003',
        employeeNumber: 'EMP-2026-1105',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_icu'],
        primaryDepartmentId: 'dept_icu',
        primaryDepartmentName: 'Intensive Care Unit (ICU)',
        positionId: 'pos_charge_nurse',
        positionTitle: 'ICU Charge Nurse',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2022-01-10',
        personalInfo: {
          legalFirstName: 'Elena',
          legalLastName: 'Rostova',
          dateOfBirth: '1990-04-18',
          gender: 'FEMALE',
          contactEmail: 'e.rostova@centralmetro.health',
          contactPhone: '+1-555-017-3819',
          emergencyContact: { name: 'Anna Rostova', relationship: 'Sister', phone: '+1-555-017-3820' },
          residentialAddress: { street: '74 Elmwood Avenue', city: 'Metro City', state: 'NY', postalCode: '10003', country: 'USA' },
        },
        compensation: { baseSalary: 11500000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleEmployees.forEach((emp) => {
      this.employees.set(emp.employeeId, emp);
      this.seedDefaultLeaveBalances(emp.employeeId);
    });

    // Sample Credentials
    const sampleCreds: EmployeeCredential[] = [
      {
        credentialId: 'crd_001',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        credentialType: 'MEDICAL_LICENSE',
        title: 'State Medical Board License - Physician & Surgeon',
        issuingAuthority: 'New York State Medical Board',
        credentialNumber: 'MED-NY-849204',
        issueDate: '2020-01-15',
        expiryDate: '2028-01-15',
        verificationStatus: 'VERIFIED',
        verifiedByActorId: 'usr_medical_director',
        verifiedByName: 'Dr. Arthur Campbell, MD (Medical Director)',
        verifiedAt: '2020-01-20T00:00:00Z',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        credentialId: 'crd_002',
        employeeId: 'emp_002',
        employeeName: 'Dr. Robert Hayes',
        credentialType: 'SPECIALTY_BOARD',
        title: 'American Board of Orthopaedic Surgery (ABOS) Diplomate',
        issuingAuthority: 'American Board of Orthopaedic Surgery',
        credentialNumber: 'ABOS-73921',
        issueDate: '2019-06-10',
        expiryDate: '2029-06-10',
        verificationStatus: 'VERIFIED',
        verifiedByActorId: 'usr_medical_director',
        verifiedByName: 'Dr. Arthur Campbell, MD (Medical Director)',
        verifiedAt: '2019-06-15T00:00:00Z',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        credentialId: 'crd_003',
        employeeId: 'emp_003',
        employeeName: 'Elena Rostova',
        credentialType: 'BLS_ACLS',
        title: 'Advanced Cardiovascular Life Support (ACLS)',
        issuingAuthority: 'American Heart Association',
        credentialNumber: 'AHA-ACLS-99120',
        issueDate: '2024-02-01',
        expiryDate: '2026-02-01',
        verificationStatus: 'VERIFIED',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleCreds.forEach((c) => this.credentials.set(c.credentialId, c));

    // Sample Privileges
    const samplePrivs: ClinicalPrivilege[] = [
      {
        privilegeId: 'prv_001',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        privilegeType: 'CONSULT_OPD',
        specialty: 'Cardiology',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_cardiology',
        departmentName: 'Cardiology',
        status: 'GRANTED',
        effectiveFrom: '2021-03-15',
        effectiveUntil: '2028-03-15',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
      {
        privilegeId: 'prv_002',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        privilegeType: 'PRESCRIBE_MEDICATION',
        specialty: 'Cardiology',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_cardiology',
        departmentName: 'Cardiology',
        status: 'GRANTED',
        effectiveFrom: '2021-03-15',
        effectiveUntil: '2028-03-15',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
      {
        privilegeId: 'prv_003',
        employeeId: 'emp_002',
        employeeName: 'Dr. Robert Hayes',
        privilegeType: 'PERFORM_GENERAL_SURGERY',
        specialty: 'Orthopedic Surgery',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        status: 'GRANTED',
        effectiveFrom: '2018-09-01',
        effectiveUntil: '2028-09-01',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
    ];

    samplePrivs.forEach((p) => this.privileges.set(p.privilegeId, p));

    // Sample Shifts
    const sampleShift: RosterShiftEntry = {
      rosterId: 'rst_sample_01',
      tenantId: 'tenant_default',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins',
      positionTitle: 'Attending Cardiologist',
      date: today,
      shiftId: 'sft_morning_01',
      shiftName: 'Cardiology Morning Clinic',
      startTime: `${today}T08:00:00Z`,
      endTime: `${today}T16:00:00Z`,
      durationHours: 8,
      status: 'PUBLISHED',
      isOvertime: false,
      createdAt: now,
      updatedAt: now,
    };
    this.shifts.set(sampleShift.rosterId, sampleShift);
  }

  public static resetForTesting(): void {
    this.employees.clear();
    this.credentials.clear();
    this.privileges.clear();
    this.shifts.clear();
    this.attendanceRecords.clear();
    this.leaveRequests.clear();
    this.leaveBalances.clear();
    this.compensationRecords.clear();
    this.performanceReviews.clear();
    this.disciplinaryRecords.clear();
    this.trainingRecords.clear();
  }

  public static getEmployees(): EmployeeMaster[] {
    this.ensureInitialized();
    return Array.from(this.employees.values());
  }

  public static getCredentials(): EmployeeCredential[] {
    this.ensureInitialized();
    return Array.from(this.credentials.values());
  }

  public static getPrivileges(): ClinicalPrivilege[] {
    this.ensureInitialized();
    return Array.from(this.privileges.values());
  }

  public static getShifts(): RosterShiftEntry[] {
    this.ensureInitialized();
    return Array.from(this.shifts.values());
  }

  public static getAttendanceRecords(): AttendanceRecord[] {
    this.ensureInitialized();
    return Array.from(this.attendanceRecords.values());
  }

  public static getLeaveRequests(): LeaveRequest[] {
    this.ensureInitialized();
    return Array.from(this.leaveRequests.values());
  }
}
