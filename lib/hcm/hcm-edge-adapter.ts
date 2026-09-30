'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';
import type {
  ClinicalPrivilege,
  EmployeeAssignmentHistory,
  EmployeeCredential,
  EmployeeMaster,
  RosterShiftEntry,
  RosterSwapRecord,
} from '@/types/hcm-advanced';
import type {
  ClinicalCredential,
  CredentialExpiryAlert,
  RosterShift,
  ShiftType,
  StaffMember,
  StaffRole,
} from '@/types/hcm';

export type CreateEmployeeEdgePayload = Omit<
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

async function run<T>(
  commandType:string,
  payload:Record<string,unknown>,
  idempotencyKey?:string
):Promise<T>{
  const result=await executeActiveTenantCommand<T>(
    commandType,
    payload,
    {idempotencyKey,schemaVersion:1}
  );
  if(!result.success){
    throw new Error(result.error?.message||`${commandType} failed.`);
  }
  return result.data as T;
}

export const createEmployeeEdge=(
  payload:CreateEmployeeEdgePayload,
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'CreateEmployeeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const updateEmployeeStatusEdge=(
  payload:{
    employeeId:string;
    newStatus:EmployeeMaster['employmentStatus'];
    reason:string;
  },
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'UpdateEmployeeStatusCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const transferEmployeeEdge=(
  payload:{
    employeeId:string;
    toFacilityId?:string;
    toDepartmentId:string;
    toDepartmentName:string;
    toPositionId:string;
    toPositionTitle:string;
    reason:string;
    effectiveDate:string;
  },
  idempotencyKey?:string
)=>run<EmployeeMaster>(
  'TransferEmployeeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

function mapWorkforceSnapshot(
  snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
){
  const employees=(snapshot.collections.employees||[])
    .map(row=>row as unknown as EmployeeMaster)
    .sort((a,b)=>a.employeeNumber.localeCompare(b.employeeNumber));
  const assignments=(snapshot.collections.employeeAssignments||[])
    .map(row=>row as unknown as EmployeeAssignmentHistory)
    .sort((a,b)=>b.startDate.localeCompare(a.startDate));
  return {
    employees,
    assignments,
    source:snapshot.source,
    generatedAt:snapshot.generatedAt,
  };
}

export async function loadLocalWorkforceMaster(tenantId:string){
  return mapWorkforceSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateWorkforceMaster(tenantId:string){
  return mapWorkforceSnapshot(await hydrateEdgeSnapshot(tenantId));
}


export type SubmitCredentialEdgePayload = Omit<
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
>;

export const submitCredentialEdge=(
  payload:SubmitCredentialEdgePayload,
  idempotencyKey?:string
)=>run<EmployeeCredential>(
  'SubmitCredentialCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const verifyCredentialEdge=(
  payload:{credentialId:string;status:'VERIFIED'|'REJECTED';notes?:string},
  idempotencyKey?:string
)=>run<EmployeeCredential>(
  'VerifyCredentialCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const grantClinicalPrivilegeEdge=(
  payload:Omit<
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
  >,
  idempotencyKey?:string
)=>run<ClinicalPrivilege>(
  'GrantClinicalPrivilegeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const changeClinicalPrivilegeStatusEdge=(
  payload:{
    privilegeId:string;
    status:'GRANTED'|'SUSPENDED'|'REVOKED';
    reason:string;
  },
  idempotencyKey?:string
)=>run<ClinicalPrivilege>(
  'ChangeClinicalPrivilegeStatusCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export type AssignShiftEdgePayload = Omit<
  RosterShiftEntry,
  | 'rosterId'
  | 'tenantId'
  | 'employeeName'
  | 'positionTitle'
  | 'durationHours'
  | 'status'
  | 'isOvertime'
  | 'overtimeHours'
  | 'publishedAt'
  | 'publishedBy'
  | 'conflictFlags'
  | 'createdAt'
  | 'updatedAt'
>;

export const assignShiftEdge=(
  payload:AssignShiftEdgePayload,
  idempotencyKey?:string
)=>run<RosterShiftEntry>(
  'AssignShiftCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const cancelShiftEdge=(
  payload:{rosterId:string;reason:string},
  idempotencyKey?:string
)=>run<RosterShiftEntry>(
  'CancelShiftCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const executeRosterSwapEdge=(
  payload:{shiftAId:string;shiftBId:string;reason:string},
  idempotencyKey?:string
)=>run<RosterSwapRecord>(
  'ExecuteRosterSwapCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

function inferLegacyStaffRole(employee:EmployeeMaster):StaffRole{
  const value=`${employee.positionTitle} ${employee.specialty||''}`.toLowerCase();
  if(value.includes('nurse')) return 'nurse';
  if(value.includes('pharmac')) return 'pharmacy';
  if(value.includes('lab')||value.includes('technician')) return 'lab';
  if(value.includes('doctor')||value.includes('physician')||value.includes('surgeon')||value.includes('cardiolog')) return 'doctor';
  return 'admin';
}

function toLegacyStaff(employee:EmployeeMaster):StaffMember{
  const activeStatus:StaffMember['activeStatus']=
    employee.employmentStatus==='ACTIVE'?'active':
    employee.employmentStatus==='ON_LEAVE'?'on_leave':
    employee.employmentStatus==='SUSPENDED'?'suspended':
    'terminated';
  const employmentType:StaffMember['employmentType']=
    employee.employmentType==='PART_TIME'?'part_time':
    employee.employmentType==='LOCUM'?'locum':
    employee.employmentType==='CONTRACT'?'contract':
    'full_time';
  return {
    id:employee.employeeId,
    tenantId:employee.tenantId,
    userId:employee.userId,
    staffNumber:employee.employeeNumber,
    firstName:employee.personalInfo.legalFirstName,
    lastName:employee.personalInfo.legalLastName,
    fullName:`${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName}`,
    email:employee.personalInfo.contactEmail,
    phone:employee.personalInfo.contactPhone,
    departmentId:employee.primaryDepartmentId,
    departmentName:employee.primaryDepartmentName,
    primaryRole:inferLegacyStaffRole(employee),
    employmentType,
    hourlyRate:0,
    baseSalary:(employee.compensation?.baseSalary||0)/100,
    activeStatus,
    specialty:employee.specialty,
    hireDate:employee.hireDate,
    avatarUrl:employee.personalInfo.photoUrl,
    createdAt:employee.createdAt,
    updatedAt:employee.updatedAt,
  };
}

function toLegacyCredential(
  credential:EmployeeCredential,
  employee?:EmployeeMaster
):ClinicalCredential{
  const today=new Date().toISOString().slice(0,10);
  const verificationStatus:ClinicalCredential['verificationStatus']=
    credential.expiryDate<today || credential.verificationStatus==='EXPIRED'
      ? 'expired'
      : credential.verificationStatus==='VERIFIED'
        ? 'verified'
        : 'pending';
  return {
    id:credential.credentialId,
    tenantId:employee?.tenantId||'',
    staffId:credential.employeeId,
    staffName:credential.employeeName,
    staffRole:employee?inferLegacyStaffRole(employee):undefined,
    title:credential.title,
    licenseNumber:credential.credentialNumber,
    issuingBody:credential.issuingAuthority,
    issueDate:credential.issueDate,
    expirationDate:credential.expiryDate,
    verificationStatus,
    verifiedBy:credential.verifiedByName||credential.verifiedByActorId,
    verifiedAt:credential.verifiedAt,
    documentUrl:credential.documentReference,
    notes:credential.notes,
    isMandatoryForPractice:credential.isMandatoryForPractice,
    createdAt:credential.createdAt,
    updatedAt:credential.updatedAt,
  };
}

function buildCredentialExpiryAlerts(params:{
  tenantId:string;
  credentials:ClinicalCredential[];
  staff:StaffMember[];
  thresholdDays?:number;
}):CredentialExpiryAlert[]{
  const thresholdDays=params.thresholdDays??60;
  const now=Date.now();
  const dayMs=86400000;
  return params.credentials.flatMap(credential=>{
    const expiryMs=Date.parse(`${credential.expirationDate}T23:59:59.999Z`);
    if(!Number.isFinite(expiryMs)) return [];
    const daysUntilExpiration=Math.ceil((expiryMs-now)/dayMs);
    if(daysUntilExpiration>thresholdDays) return [];
    const member=params.staff.find(row=>row.id===credential.staffId);
    return [{
      id:`expiry_${credential.id}`,
      tenantId:params.tenantId,
      credentialId:credential.id,
      credentialTitle:credential.title,
      licenseNumber:credential.licenseNumber,
      staffId:credential.staffId,
      staffName:credential.staffName||member?.fullName||credential.staffId,
      staffRole:credential.staffRole||member?.primaryRole||'admin',
      departmentName:member?.departmentName||'Unassigned',
      expirationDate:credential.expirationDate,
      daysUntilExpiration,
      urgency:daysUntilExpiration<=0?'critical':daysUntilExpiration<=30?'high':'moderate',
      thresholdDays,
      recipientRole:'Credentialing Director',
      recipientEmail:'',
      status:'queued',
      emailSubject:`Credential expiry: ${credential.title}`,
      emailBodyHtml:'',
      triggeredAt:new Date().toISOString(),
    }];
  });
}

function mapCredentialingSnapshot(
  snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
){
  const employees=(snapshot.collections.employees||[])
    .map(row=>row as unknown as EmployeeMaster);
  const employeeById=new Map(employees.map(employee=>[employee.employeeId,employee]));
  const credentials=(snapshot.collections.clinicalCredentials||[])
    .map(row=>row as unknown as EmployeeCredential)
    .map(credential=>toLegacyCredential(credential,employeeById.get(credential.employeeId)))
    .sort((a,b)=>a.expirationDate.localeCompare(b.expirationDate));
  const privileges=(snapshot.collections.clinicalPrivileges||[])
    .map(row=>row as unknown as ClinicalPrivilege);
  const staff=employees.map(toLegacyStaff).sort((a,b)=>a.staffNumber.localeCompare(b.staffNumber));
  return {
    staff,
    credentials,
    privileges,
    alerts:buildCredentialExpiryAlerts({
      tenantId:employees[0]?.tenantId||'',
      credentials,
      staff,
    }),
    source:snapshot.source,
    generatedAt:snapshot.generatedAt,
  };
}

export async function loadLocalCredentialing(tenantId:string){
  return mapCredentialingSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateCredentialing(tenantId:string){
  return mapCredentialingSnapshot(await hydrateEdgeSnapshot(tenantId));
}

function inferLegacyShiftType(shift:RosterShiftEntry):ShiftType{
  const value=`${shift.shiftName} ${shift.shiftId}`.toLowerCase();
  if(value.includes('night')) return 'night';
  if(value.includes('evening')) return 'evening';
  if(value.includes('on call')||value.includes('on_call')||value.includes('on-call')) return 'on_call';
  return 'morning';
}

function toLegacyRosterShift(
  shift:RosterShiftEntry,
  employee?:EmployeeMaster
):RosterShift{
  const status:RosterShift['status']=
    shift.status==='CANCELLED'?'cancelled':
    shift.status==='COMPLETED'?'completed':
    shift.status==='IN_PROGRESS'?'in_progress':
    'scheduled';
  return {
    id:shift.rosterId,
    tenantId:shift.tenantId,
    shiftNumber:shift.rosterId,
    staffId:shift.employeeId,
    staffName:shift.employeeName,
    staffRole:employee?inferLegacyStaffRole(employee):'admin',
    departmentId:shift.departmentId,
    departmentName:shift.departmentName,
    wardId:shift.facilityId,
    wardName:shift.facilityName,
    shiftType:inferLegacyShiftType(shift),
    date:shift.date,
    scheduledStartTime:shift.startTime,
    scheduledEndTime:shift.endTime,
    breakDuration:0,
    totalHours:shift.durationHours,
    status,
    isOvertime:shift.isOvertime,
    overtimeHours:shift.overtimeHours,
    notes:shift.notes,
    conflictFlags:shift.conflictFlags,
    createdAt:shift.createdAt,
    updatedAt:shift.updatedAt,
  };
}

function mapRosterSnapshot(
  snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
){
  const employees=(snapshot.collections.employees||[])
    .map(row=>row as unknown as EmployeeMaster);
  const employeeById=new Map(employees.map(employee=>[employee.employeeId,employee]));
  const staff=employees.map(toLegacyStaff).sort((a,b)=>a.staffNumber.localeCompare(b.staffNumber));
  const credentials=(snapshot.collections.clinicalCredentials||[])
    .map(row=>row as unknown as EmployeeCredential)
    .map(credential=>toLegacyCredential(credential,employeeById.get(credential.employeeId)));
  const shifts=(snapshot.collections.rosterAssignments||[])
    .map(row=>row as unknown as RosterShiftEntry)
    .map(shift=>toLegacyRosterShift(shift,employeeById.get(shift.employeeId)))
    .sort((a,b)=>a.scheduledStartTime.localeCompare(b.scheduledStartTime));
  return {
    staff,
    credentials,
    shifts,
    source:snapshot.source,
    generatedAt:snapshot.generatedAt,
  };
}

export async function loadLocalRoster(tenantId:string){
  return mapRosterSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateRoster(tenantId:string){
  return mapRosterSnapshot(await hydrateEdgeSnapshot(tenantId));
}
