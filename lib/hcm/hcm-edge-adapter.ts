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
  AttendanceRecord,
  LeaveRequest,
  CompensationProfileRecord,
  PayrollEmployeeSlotRecord,
  PayrollPayslipRecord,
  PayrollPeriodRecord,
} from '@/types/hcm-advanced';
import type {
  HcmWorkforceIntelligenceSnapshot,
  PayrollStatutoryLiabilityRecord,
} from '@/types/hcm-enterprise';
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
  idempotencyKey?:string,
  offlineQueue?:{
    enabled:boolean;
    collection:string;
    resourceId:string;
    action:'CREATE'|'UPDATE'|'DELETE';
    optimisticCache?:boolean;
  }
):Promise<T>{
  const result=await executeActiveTenantCommand<T>(
    commandType,
    payload,
    {idempotencyKey,schemaVersion:1,offlineQueue}
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

export const setCompensationEdge=(
  payload:{
    employeeId:string;
    payBasis:'SALARIED'|'HOURLY';
    payFrequency:'MONTHLY'|'SEMI_MONTHLY'|'BI_WEEKLY';
    currency:string;
    annualSalaryMinorUnits:number;
    hourlyRateMinorUnits:number;
    overtimeMultiplierBasisPoints:number;
    monthlyAllowanceMinorUnits:number;
    deductions:Array<{
      code:string;name:string;rateBasisPoints:number;fixedMinorUnits:number;
      liabilityAccountCode:string;
    }>;
    effectiveFrom:string;
  },idempotencyKey?:string
)=>run<CompensationProfileRecord>('SetCompensationCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const reviewCompensationEdge=(
  payload:{compensationId:string;decision:'APPROVE'|'REJECT';notes?:string},idempotencyKey?:string
)=>run<CompensationProfileRecord>('ReviewCompensationCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const createPayrollPeriodEdge=(
  payload:{
    facilityId:string;periodNumber:string;periodName:string;
    payFrequency:'MONTHLY'|'SEMI_MONTHLY'|'BI_WEEKLY';
    startDate:string;endDate:string;paymentDate:string;currency:string;
  },idempotencyKey?:string
)=>run<PayrollPeriodRecord>('CreatePayrollPeriodCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const enrollPayrollEmployeeEdge=(
  payload:{periodId:string;employeeId:string},idempotencyKey?:string
)=>run<PayrollEmployeeSlotRecord>('EnrollPayrollEmployeeCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const calculatePayrollEmployeeEdge=(
  payload:{periodId:string;employeeId:string},idempotencyKey?:string
)=>run<PayrollPayslipRecord>('CalculatePayrollEmployeeCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const finalizePayrollPeriodEdge=(
  payload:{periodId:string},idempotencyKey?:string
)=>run<PayrollPeriodRecord>('FinalizePayrollPeriodCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const approvePayrollPeriodEdge=(
  payload:{periodId:string;notes?:string},idempotencyKey?:string
)=>run<PayrollPeriodRecord>('ApprovePayrollPeriodCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const postPayrollPeriodEdge=(
  payload:{periodId:string},idempotencyKey?:string
)=>run<PayrollPeriodRecord>('PostPayrollPeriodCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const settlePayrollPeriodEdge=(
  payload:{periodId:string;treasuryAccountId:string;settlementReference:string;settledAt:string},
  idempotencyKey?:string
)=>run<PayrollPeriodRecord>('SettlePayrollPeriodCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const remitPayrollLiabilityEdge=(
  payload:{liabilityId:string;treasuryAccountId:string;remittanceReference:string;remittedAt:string},
  idempotencyKey?:string
)=>run('RemitPayrollLiabilityCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const generateHcmIntelligenceEdge=(
  payload:{snapshotId:string;asOf:string;lookbackDays:number;facilityId?:string},
  idempotencyKey?:string
)=>run(
  'GenerateHcmIntelligenceCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const submitLeaveRequestEdge=(
  payload:{
    employeeId:string;
    leaveType:LeaveRequest['leaveType'];
    startDate:string;
    endDate:string;
    reason:string;
    coveringEmployeeId?:string;
  },
  idempotencyKey?:string
)=>run<LeaveRequest>(
  'SubmitLeaveRequestCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const approveLeaveRequestEdge=(
  payload:{leaveId:string;approved:boolean;rejectionReason?:string},
  idempotencyKey?:string
)=>run<LeaveRequest>(
  'ApproveLeaveRequestCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export const recordClockInEdge=(
  payload:{
    employeeId:string;
    source:
      | 'BIOMETRIC_SCANNER'
      | 'KIOSK_TERMINAL'
      | 'MOBILE_GPS'
      | 'WEB_PORTAL'
      | 'SUPERVISOR_OVERRIDE'
      | 'HL7_ACCESS_CARD';
    deviceIdentifier?:string;
    scheduledShiftId?:string;
  },
  idempotencyKey?:string
)=>run<AttendanceRecord>(
  'RecordClockInCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey,
  {
    enabled:true,
    collection:'attendanceRecords',
    resourceId:`clockin_${payload.employeeId}`,
    action:'CREATE',
    optimisticCache:false,
  }
);

export const recordClockOutEdge=(
  payload:{attendanceId:string},
  idempotencyKey?:string
)=>run<AttendanceRecord>(
  'RecordClockOutCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey,
  {
    enabled:true,
    collection:'attendanceRecords',
    resourceId:payload.attendanceId,
    action:'UPDATE',
    optimisticCache:false,
  }
);

export const correctAttendanceTimeEdge=(
  payload:{
    attendanceId:string;
    newClockInTime:string;
    newClockOutTime?:string;
    reason:string;
  },
  idempotencyKey?:string
)=>run<AttendanceRecord>(
  'CorrectAttendanceTimeCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

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
    facilityId:employee.primaryFacilityId,
    facilityName:employee.primaryFacilityId,
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


function mapPayrollSnapshot(
  snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>
){
  return {
    employees:(snapshot.collections.employees||[]) as unknown as EmployeeMaster[],
    compensationProfiles:(snapshot.collections.compensationProfiles||[]) as unknown as CompensationProfileRecord[],
    payrollPeriods:(snapshot.collections.payrollPeriods||[]) as unknown as PayrollPeriodRecord[],
    payrollEmployeeSlots:(snapshot.collections.payrollEmployeeSlots||[]) as unknown as PayrollEmployeeSlotRecord[],
    payrollPayslips:(snapshot.collections.payrollPayslips||[]) as unknown as PayrollPayslipRecord[],
    payrollLiabilities:(snapshot.collections.payrollStatutoryLiabilities||[]) as unknown as PayrollStatutoryLiabilityRecord[],
    intelligence:(snapshot.collections.hcmIntelligenceSnapshots||[]) as unknown as HcmWorkforceIntelligenceSnapshot[],
    source:snapshot.source,
    generatedAt:snapshot.generatedAt,
  };
}

export async function loadLocalPayroll(tenantId:string){
  return mapPayrollSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydratePayroll(tenantId:string){
  return mapPayrollSnapshot(await hydrateEdgeSnapshot(tenantId));
}
