import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  AttendanceRecord,
  EmployeeCredential,
  EmployeeMaster,
  LeaveRequest,
  PayrollPeriodRecord,
  RosterShiftEntry,
} from '@/types/hcm-advanced';
import type { HcmWorkforceIntelligenceSnapshot } from '@/types/hcm-enterprise';
import {
  buildWorkforceAlerts,
  stableHcmFingerprint,
} from '@/lib/hcm/hcm-intelligence-engine';

function reject(
  commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown
):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

export class HcmIntelligenceDomainService {
  public static async generateSnapshot(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:{snapshotId:string;asOf:string;lookbackDays:number;facilityId?:string}
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:[
        'HR_ADMIN','HR_DIRECTOR','PAYROLL_MANAGER','MEDICAL_DIRECTOR',
        'HOSPITAL_EXECUTIVE','SYSTEM_ADMIN'
      ],
    });
    if(!auth.authorized){
      return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'HCM intelligence authority required.');
    }
    const asOfMs=Date.parse(payload.asOf);
    if(!Number.isFinite(asOfMs)||!Number.isInteger(payload.lookbackDays)||payload.lookbackDays<1||payload.lookbackDays>365){
      return reject(commandId,idempotencyKey,'INVALID_HCM_INTELLIGENCE_WINDOW','HCM intelligence window is invalid.');
    }
    if(
      payload.facilityId &&
      context.facilityIds?.length &&
      !context.facilityIds.includes(payload.facilityId) &&
      !context.roles.some(role=>['SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'].includes(role))
    ){
      return reject(commandId,idempotencyKey,'HCM_FACILITY_SCOPE_MISMATCH','Requested facility is outside actor scope.');
    }

    const [employees,credentials,attendance,leave,roster,payroll]=await Promise.all([
      DomainStateRepository.list<EmployeeMaster>(context.tenantId,'employees',100000),
      DomainStateRepository.list<EmployeeCredential>(context.tenantId,'clinicalCredentials',100000),
      DomainStateRepository.list<AttendanceRecord>(context.tenantId,'attendanceRecords',300000),
      DomainStateRepository.list<LeaveRequest>(context.tenantId,'leaveRequests',100000),
      DomainStateRepository.list<RosterShiftEntry>(context.tenantId,'rosterAssignments',200000),
      DomainStateRepository.list<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',10000),
    ]);

    const scopedEmployees=employees.filter(employee=>
      !payload.facilityId||employee.facilityIds.includes(payload.facilityId)
    );
    const employeeIds=new Set(scopedEmployees.map(row=>row.employeeId));
    const active=scopedEmployees.filter(row=>['ACTIVE','ON_LEAVE','NOTICE_PERIOD'].includes(row.employmentStatus));
    const activeIds=new Set(active.map(row=>row.employeeId));
    const today=new Date(asOfMs).toISOString().slice(0,10);
    const sixtyDays=new Date(asOfMs+60*86400000).toISOString().slice(0,10);
    const credentialRiskCount=[...new Set(
      credentials.filter(row=>
        activeIds.has(row.employeeId)&&row.isMandatoryForPractice&&(
          row.verificationStatus!=='VERIFIED'||!row.expiryDate||
          row.expiryDate<today||row.expiryDate<=sixtyDays
        )
      ).map(row=>row.employeeId)
    )].length;

    const lookback=asOfMs-payload.lookbackDays*86400000;
    const scopedAttendance=attendance.filter(row=>employeeIds.has(row.employeeId));
    const openAttendanceCount=scopedAttendance.filter(row=>!row.clockOutTime).length;
    const overtimeHours30d=scopedAttendance
      .filter(row=>{
        const ms=Date.parse(row.clockInTime);
        return Number.isFinite(ms)&&ms>=lookback&&ms<=asOfMs;
      })
      .reduce((sum,row)=>sum+Number(row.overtimeHours||0),0);

    const approvedLeaveDays30d=leave
      .filter(row=>
        employeeIds.has(row.employeeId)&&row.status==='APPROVED'&&
        Date.parse(`${row.endDate}T23:59:59.999Z`)>=lookback&&
        Date.parse(`${row.startDate}T00:00:00.000Z`)<=asOfMs
      )
      .reduce((sum,row)=>sum+Number(row.totalDays||0),0);

    const postedPayroll=payroll
      .filter(row=>
        ['POSTED','PAID'].includes(row.status)&&
        (!payload.facilityId||row.facilityId===payload.facilityId)
      )
      .sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate));
    const latest=postedPayroll[0],prior=postedPayroll[1];
    const payrollGrossMinorUnits=latest?.totalGrossMinorUnits||0;
    const payrollNetMinorUnits=latest?.totalNetMinorUnits||0;
    const payrollVarianceMinorUnits=latest&&prior
      ? latest.totalGrossMinorUnits-prior.totalGrossMinorUnits
      : 0;

    const scopedRoster=roster.filter(row=>
      employeeIds.has(row.employeeId)&&Date.parse(row.startTime)<=asOfMs
    );
    const fatigueRiskCount=scopedRoster.filter(row=>
      (row.conflictFlags||[]).some(flag=>/fatigue|rest|hours|overlap/i.test(flag))
    ).length;
    const understaffedShiftCount=scopedRoster.filter(row=>
      (row.conflictFlags||[]).some(flag=>/understaff|coverage|gap/i.test(flag))
    ).length;

    const metrics:HcmWorkforceIntelligenceSnapshot['metrics']={
      activeEmployees:active.length,
      activeClinicalEmployees:active.filter(row=>
        !['FINANCE','HR','ADMINISTRATION','IT','FACILITIES'].includes(
          row.primaryDepartmentName.toUpperCase()
        )
      ).length,
      credentialRiskCount,
      openAttendanceCount,
      overtimeHours30d:Number(overtimeHours30d.toFixed(2)),
      approvedLeaveDays30d:Number(approvedLeaveDays30d.toFixed(2)),
      payrollGrossMinorUnits,payrollNetMinorUnits,payrollVarianceMinorUnits,
      fatigueRiskCount,understaffedShiftCount,
    };
    const alerts=buildWorkforceAlerts(metrics);
    const inputFingerprint=stableHcmFingerprint({
      asOf:payload.asOf,lookbackDays:payload.lookbackDays,facilityId:payload.facilityId||null,
      employees:scopedEmployees.map(row=>[
        row.employeeId,row.employmentStatus,row.primaryFacilityId,row.primaryDepartmentId,row.updatedAt
      ]),
      credentials:credentials.filter(row=>employeeIds.has(row.employeeId)).map(row=>[
        row.credentialId,row.verificationStatus,row.expiryDate,row.updatedAt
      ]),
      attendance:scopedAttendance.map(row=>[
        row.attendanceId,row.clockInTime,row.clockOutTime,row.overtimeHours,row.updatedAt
      ]),
      leave:leave.filter(row=>employeeIds.has(row.employeeId)).map(row=>[
        row.leaveId,row.status,row.startDate,row.endDate,row.totalDays,row.updatedAt
      ]),
      roster:scopedRoster.map(row=>[
        row.rosterId,row.startTime,row.endTime,row.status,row.conflictFlags
      ]),
      payroll:postedPayroll.slice(0,2).map(row=>[
        row.periodId,row.status,row.totalGrossMinorUnits,row.totalNetMinorUnits
      ]),
    });
    const snapshot:HcmWorkforceIntelligenceSnapshot={
      snapshotId:payload.snapshotId,tenantId:context.tenantId,asOf:payload.asOf,
      lookbackDays:payload.lookbackDays,facilityId:payload.facilityId,
      generatedAt:new Date().toISOString(),generatedBy:context.actorId,
      inputFingerprint,metrics,alerts,
    };

    const tx=await TransactionManager.executeAtomicMutation({
      tenantId:context.tenantId,actorId:context.actorId,
      actorRole:context.roles[0]||'AUTHENTICATED_USER',
      aggregateType:'HCM_INTELLIGENCE_SNAPSHOT',aggregateId:payload.snapshotId,
      eventType:'HCM_INTELLIGENCE_SNAPSHOT_GENERATED',
      eventPayload:{snapshotId:payload.snapshotId,facilityId:payload.facilityId,alertCount:alerts.length,inputFingerprint},
      auditAction:'HCM_INTELLIGENCE_SNAPSHOT_GENERATED',
      auditResourceType:'HCM_INTELLIGENCE_SNAPSHOT',auditResourceId:payload.snapshotId,
      auditReason:'Generated deterministic HCM workforce intelligence snapshot.',
      outboxTopic:'g-hims-hcm-intelligence-events',idempotencyKey,commandId,
      correlationId:context.correlationId,domainState:snapshot,
    });
    return {
      success:true,commandId,idempotencyKey,entityId:payload.snapshotId,
      eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:snapshot,
    };
  }
}
