import { createHash, randomUUID } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  AttendanceRecord,
  CompensationProfileRecord,
  CompensationSlotRecord,
  EmployeeMaster,
  PayrollAttendanceLockRecord,
  PayrollCalendarBucket,
  PayrollEmployeeSlotRecord,
  PayrollPayslipRecord,
  PayrollPeriodRecord,
} from '@/types/hcm-advanced';
import {
  attendanceEvidenceFingerprint,
  calculatePayrollLine,
  canonicalPayrollPeriodId,
  compensationSlotId,
  payrollEmployeeSlotId,
  payrollPayslipId,
} from '@/lib/hcm/payroll-engine';

function reject<T>(
  commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown
):CommandResult<T>{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function assertFacility(context:CommandContext,facilityId:string):void{
  const privileged=context.roles.some(role=>
    ['SYSTEM_ADMIN','HOSPITAL_EXECUTIVE'].includes(role)
  );
  if(
    !privileged &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ){
    throw new AtomicMutationRejectedError(
      'HCM_FACILITY_SCOPE_MISMATCH',
      'Payroll mutation is outside actor facility scope.'
    );
  }
}

function compensationProfileId(employeeId:string):string{
  return `cmp_${employeeId}_${randomUUID()}`;
}

function payrollCalendarId(facilityId:string,year:number):string{
  return 'prcal_'+createHash('sha256')
    .update(`${facilityId.trim().toLowerCase()}\u0000${year}`)
    .digest('hex').slice(0,40);
}

function payrollAttendanceLockId(employeeId:string):string{
  return 'prlock_'+createHash('sha256')
    .update(employeeId.trim().toLowerCase())
    .digest('hex').slice(0,40);
}

function safeDate(date:string):number{
  const value=Date.parse(`${date}T00:00:00.000Z`);
  if(!Number.isFinite(value)) throw new AtomicMutationRejectedError('INVALID_PAYROLL_DATE','Payroll date is invalid.');
  return value;
}

export class HcmPayrollDomainService {
  public static async setCompensation(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{
      employeeId:string;
      payBasis:'SALARIED'|'HOURLY';
      payFrequency:'MONTHLY'|'SEMI_MONTHLY'|'BI_WEEKLY';
      currency:string;
      annualSalaryMinorUnits:number;
      hourlyRateMinorUnits:number;
      overtimeMultiplierBasisPoints:number;
      monthlyAllowanceMinorUnits:number;
      deductions:Array<{code:string;name:string;rateBasisPoints:number;fixedMinorUnits:number}>;
      effectiveFrom:string;
    }
  ):Promise<CommandResult<CompensationProfileRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','PAYROLL_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll compensation authority required.');
    try{
      const employee=await DomainStateRepository.getById<EmployeeMaster>(
        context.tenantId,'employees',payload.employeeId
      );
      if(!employee)throw new AtomicMutationRejectedError('EMPLOYEE_NOT_FOUND','Compensation employee does not exist.');
      assertFacility(context,employee.primaryFacilityId);
      const currency=payload.currency.trim().toUpperCase();
      if(currency.length!==3)throw new AtomicMutationRejectedError('INVALID_COMPENSATION_CURRENCY','Currency must be a 3-letter code.');
      for(const value of [payload.annualSalaryMinorUnits,payload.hourlyRateMinorUnits,payload.monthlyAllowanceMinorUnits]){
        if(!Number.isSafeInteger(value)||value<0)throw new AtomicMutationRejectedError('INVALID_COMPENSATION_AMOUNT','Compensation amounts must be non-negative integer minor units.');
      }
      if(payload.payBasis==='SALARIED'&&payload.annualSalaryMinorUnits<=0){
        throw new AtomicMutationRejectedError('SALARIED_COMPENSATION_REQUIRES_ANNUAL_SALARY','Salaried compensation requires annual salary.');
      }
      if(payload.payBasis==='HOURLY'&&payload.hourlyRateMinorUnits<=0){
        throw new AtomicMutationRejectedError('HOURLY_COMPENSATION_REQUIRES_RATE','Hourly compensation requires an hourly rate.');
      }
      if(
        !Number.isInteger(payload.overtimeMultiplierBasisPoints) ||
        payload.overtimeMultiplierBasisPoints<10000 ||
        payload.overtimeMultiplierBasisPoints>50000
      ) throw new AtomicMutationRejectedError('INVALID_OVERTIME_MULTIPLIER','Overtime multiplier is outside allowed range.');
      payload.deductions.forEach(rule=>{
        if(
          !rule.code.trim()||!rule.name.trim()||
          !Number.isInteger(rule.rateBasisPoints)||rule.rateBasisPoints<0||rule.rateBasisPoints>10000||
          !Number.isSafeInteger(rule.fixedMinorUnits)||rule.fixedMinorUnits<0
        ) throw new AtomicMutationRejectedError('INVALID_PAYROLL_DEDUCTION_RULE','Payroll deduction rule is invalid.');
      });
      safeDate(payload.effectiveFrom);

      const compensationId=compensationProfileId(payload.employeeId);
      const slotId=compensationSlotId(payload.employeeId);
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'COMPENSATION_PROFILE',aggregateId:compensationId,
        eventType:'COMPENSATION_PROFILE_SUBMITTED',auditAction:'COMPENSATION_PROFILE_SUBMITTED',
        auditResourceType:'COMPENSATION_PROFILE',auditResourceId:compensationId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:payload.employeeId,required:true},
          {key:'slot',entityType:'COMPENSATION_SLOT',entityId:slotId,required:false},
        ],
        prepare:(current)=>{
          const currentEmployee=current.employee as unknown as EmployeeMaster;
          const slot=current.slot as unknown as CompensationSlotRecord|null;
          if(slot?.pendingCompensationId){
            throw new AtomicMutationRejectedError('COMPENSATION_APPROVAL_ALREADY_PENDING','Employee already has a compensation revision awaiting approval.');
          }
          const profile:CompensationProfileRecord={
            compensationId,tenantId:context.tenantId,employeeId:currentEmployee.employeeId,
            payBasis:payload.payBasis,payFrequency:payload.payFrequency,currency,
            annualSalaryMinorUnits:payload.annualSalaryMinorUnits,
            hourlyRateMinorUnits:payload.hourlyRateMinorUnits,
            overtimeMultiplierBasisPoints:payload.overtimeMultiplierBasisPoints,
            monthlyAllowanceMinorUnits:payload.monthlyAllowanceMinorUnits,
            deductions:payload.deductions.map(rule=>({...rule,code:rule.code.trim().toUpperCase()})),
            effectiveFrom:payload.effectiveFrom,status:'PENDING_APPROVAL',
            createdBy:context.actorId,createdAt:now,
          };
          const nextSlot:CompensationSlotRecord={
            slotId,tenantId:context.tenantId,employeeId:currentEmployee.employeeId,
            activeCompensationId:slot?.activeCompensationId,
            pendingCompensationId:compensationId,
            revision:Number(slot?.revision||0),updatedAt:now,
          };
          return {
            domainState:profile,
            additionalStateWrites:[{entityType:'COMPENSATION_SLOT',entityId:slotId,domainState:nextSlot}],
            eventPayload:{compensationId,employeeId:profile.employeeId,effectiveFrom:profile.effectiveFrom,currency},
            auditReason:`Submitted compensation revision ${compensationId} for employee ${profile.employeeId}.`,
            resultData:profile,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:compensationId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as CompensationProfileRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async reviewCompensation(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{compensationId:string;decision:'APPROVE'|'REJECT';notes?:string}
  ):Promise<CommandResult<CompensationProfileRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','HOSPITAL_EXECUTIVE','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Compensation approval authority required.');
    try{
      const profile=await DomainStateRepository.getById<CompensationProfileRecord>(
        context.tenantId,'compensationProfiles',payload.compensationId
      );
      if(!profile)throw new AtomicMutationRejectedError('COMPENSATION_NOT_FOUND','Compensation profile does not exist.');
      const slotId=compensationSlotId(profile.employeeId);
      const slot=await DomainStateRepository.getById<CompensationSlotRecord>(
        context.tenantId,'compensationSlots',slotId
      );
      const employee=await DomainStateRepository.getById<EmployeeMaster>(
        context.tenantId,'employees',profile.employeeId
      );
      if(!employee)throw new AtomicMutationRejectedError('EMPLOYEE_NOT_FOUND','Compensation employee no longer exists.');
      assertFacility(context,employee.primaryFacilityId);
      const readTargets:Array<{key:string;entityType:string;entityId:string;required:boolean}>=[
        {key:'profile',entityType:'COMPENSATION_PROFILE',entityId:profile.compensationId,required:true},
        {key:'slot',entityType:'COMPENSATION_SLOT',entityId:slotId,required:true},
      ];
      if(slot?.activeCompensationId){
        readTargets.push({key:'active',entityType:'COMPENSATION_PROFILE',entityId:slot.activeCompensationId,required:true});
      }
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'COMPENSATION_PROFILE',aggregateId:profile.compensationId,
        eventType:payload.decision==='APPROVE'?'COMPENSATION_PROFILE_APPROVED':'COMPENSATION_PROFILE_REJECTED',
        auditAction:payload.decision==='APPROVE'?'COMPENSATION_PROFILE_APPROVED':'COMPENSATION_PROFILE_REJECTED',
        auditResourceType:'COMPENSATION_PROFILE',auditResourceId:profile.compensationId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets,
        prepare:(current)=>{
          const currentProfile=current.profile as unknown as CompensationProfileRecord;
          const currentSlot=current.slot as unknown as CompensationSlotRecord;
          if(currentProfile.status!=='PENDING_APPROVAL'||currentSlot.pendingCompensationId!==currentProfile.compensationId){
            throw new AtomicMutationRejectedError('COMPENSATION_NOT_REVIEWABLE','Compensation profile is not the pending revision.');
          }
          if(currentProfile.createdBy===context.actorId){
            throw new AtomicMutationRejectedError('HCM_SEGREGATION_OF_DUTIES','Compensation creator cannot approve their own revision.');
          }
          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          let nextProfile:CompensationProfileRecord;
          let nextSlot:CompensationSlotRecord;
          if(payload.decision==='APPROVE'){
            if(current.active){
              const active=current.active as unknown as CompensationProfileRecord;
              writes.push({entityType:'COMPENSATION_PROFILE',entityId:active.compensationId,
                domainState:{...active,status:'SUPERSEDED'}});
            }
            nextProfile={...currentProfile,status:'ACTIVE',approvedBy:context.actorId,approvedAt:now};
            nextSlot={...currentSlot,activeCompensationId:currentProfile.compensationId,
              pendingCompensationId:undefined,revision:Number(currentSlot.revision||0)+1,updatedAt:now};
          }else{
            nextProfile={...currentProfile,status:'REJECTED',approvedBy:context.actorId,approvedAt:now};
            nextSlot={...currentSlot,pendingCompensationId:undefined,updatedAt:now};
          }
          writes.push({entityType:'COMPENSATION_SLOT',entityId:slotId,domainState:nextSlot});
          return {
            domainState:nextProfile,additionalStateWrites:writes,
            eventPayload:{compensationId:nextProfile.compensationId,employeeId:nextProfile.employeeId,decision:payload.decision},
            auditReason:`${payload.decision} compensation revision ${nextProfile.compensationId}.`,
            resultData:nextProfile,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:profile.compensationId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as CompensationProfileRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async createPayrollPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{
      facilityId:string;periodNumber:string;periodName:string;
      payFrequency:'MONTHLY'|'SEMI_MONTHLY'|'BI_WEEKLY';
      startDate:string;endDate:string;paymentDate:string;currency:string;
    }
  ):Promise<CommandResult<PayrollPeriodRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['PAYROLL_MANAGER','HR_ADMIN','FINANCE_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll period authority required.');
    try{
      assertFacility(context,payload.facilityId);
      const start=safeDate(payload.startDate),end=safeDate(payload.endDate),payment=safeDate(payload.paymentDate);
      if(end<start||payment<end)throw new AtomicMutationRejectedError('INVALID_PAYROLL_PERIOD_DATES','Payroll period/payment dates are invalid.');
      const startYear=Number(payload.startDate.slice(0,4)),endYear=Number(payload.endDate.slice(0,4));
      if(startYear!==endYear)throw new AtomicMutationRejectedError('CROSS_YEAR_PAYROLL_PERIOD_NOT_SUPPORTED','Payroll period must remain within one year.');
      const currency=payload.currency.trim().toUpperCase();
      if(currency.length!==3)throw new AtomicMutationRejectedError('INVALID_PAYROLL_CURRENCY','Currency must be 3 letters.');
      const periodId=canonicalPayrollPeriodId({tenantId:context.tenantId,facilityId:payload.facilityId,startDate:payload.startDate,endDate:payload.endDate});
      const calendarId=payrollCalendarId(payload.facilityId,startYear);
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PERIOD',aggregateId:periodId,
        eventType:'PAYROLL_PERIOD_CREATED',auditAction:'PAYROLL_PERIOD_CREATED',
        auditResourceType:'PAYROLL_PERIOD',auditResourceId:periodId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'PAYROLL_PERIOD',entityId:periodId,required:false},
          {key:'calendar',entityType:'PAYROLL_CALENDAR',entityId:calendarId,required:false},
        ],
        prepare:(current)=>{
          if(current.period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_ALREADY_EXISTS','Payroll period already exists.');
          const calendar=current.calendar as unknown as PayrollCalendarBucket|null;
          const overlap=(calendar?.entries||[]).some(entry=>{
            if(entry.status==='VOID')return false;
            const es=safeDate(entry.startDate),ee=safeDate(entry.endDate);
            return start<=ee&&end>=es;
          });
          if(overlap)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_OVERLAP','Payroll period overlaps another active period for the facility.');
          const period:PayrollPeriodRecord={
            periodId,tenantId:context.tenantId,facilityId:payload.facilityId,
            periodNumber:payload.periodNumber,periodName:payload.periodName,payFrequency:payload.payFrequency,
            startDate:payload.startDate,endDate:payload.endDate,paymentDate:payload.paymentDate,currency,
            status:'OPEN',enrolledCount:0,calculatedCount:0,
            totalRegularMinorUnits:0,totalOvertimeMinorUnits:0,totalAllowanceMinorUnits:0,
            totalGrossMinorUnits:0,totalDeductionsMinorUnits:0,totalNetMinorUnits:0,
            expenseByCostCenterMinorUnits:{},createdBy:context.actorId,createdAt:now,updatedAt:now,
          };
          const nextCalendar:PayrollCalendarBucket={
            calendarId,tenantId:context.tenantId,facilityId:payload.facilityId,year:startYear,
            entries:[...(calendar?.entries||[]),{periodId,startDate:payload.startDate,endDate:payload.endDate,status:'OPEN'}],
            updatedAt:now,
          };
          return {domainState:period,
            additionalStateWrites:[{entityType:'PAYROLL_CALENDAR',entityId:calendarId,domainState:nextCalendar}],
            eventPayload:{periodId,facilityId:payload.facilityId,startDate:payload.startDate,endDate:payload.endDate,currency},
            auditReason:`Created payroll period ${payload.periodNumber}.`,resultData:period};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:periodId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPeriodRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async enrollPayrollEmployee(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string;employeeId:string}
  ):Promise<CommandResult<PayrollEmployeeSlotRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['PAYROLL_MANAGER','HR_ADMIN','SYSTEM_ADMIN']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll enrollment authority required.');
    try{
      const period=await DomainStateRepository.getById<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',payload.periodId);
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      const slotId=payrollEmployeeSlotId(period.periodId,payload.employeeId);
      const compSlotId=compensationSlotId(payload.employeeId);
      const compSlot=await DomainStateRepository.getById<CompensationSlotRecord>(context.tenantId,'compensationSlots',compSlotId);
      if(!compSlot?.activeCompensationId)throw new AtomicMutationRejectedError('ACTIVE_COMPENSATION_NOT_FOUND','Employee has no approved active compensation.');
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_EMPLOYEE_SLOT',aggregateId:slotId,
        eventType:'PAYROLL_EMPLOYEE_ENROLLED',auditAction:'PAYROLL_EMPLOYEE_ENROLLED',
        auditResourceType:'PAYROLL_EMPLOYEE_SLOT',auditResourceId:slotId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true},
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:payload.employeeId,required:true},
          {key:'compSlot',entityType:'COMPENSATION_SLOT',entityId:compSlotId,required:true},
          {key:'comp',entityType:'COMPENSATION_PROFILE',entityId:compSlot.activeCompensationId,required:true},
          {key:'employeeSlot',entityType:'PAYROLL_EMPLOYEE_SLOT',entityId:slotId,required:false},
        ],
        prepare:(current)=>{
          if(current.employeeSlot)throw new AtomicMutationRejectedError('PAYROLL_EMPLOYEE_ALREADY_ENROLLED','Employee is already enrolled in this payroll period.');
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          const employee=current.employee as unknown as EmployeeMaster;
          const currentCompSlot=current.compSlot as unknown as CompensationSlotRecord;
          const comp=current.comp as unknown as CompensationProfileRecord;
          if(currentPeriod.status!=='OPEN')throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_OPEN','Employee enrollment requires an OPEN payroll period.');
          if(!employee.facilityIds.includes(currentPeriod.facilityId)||!['ACTIVE','ON_LEAVE'].includes(employee.employmentStatus)){
            throw new AtomicMutationRejectedError('EMPLOYEE_NOT_PAYROLL_ELIGIBLE','Employee is not active within payroll facility scope.');
          }
          if(comp.status!=='ACTIVE'||currentCompSlot.activeCompensationId!==comp.compensationId){
            throw new AtomicMutationRejectedError('COMPENSATION_CHANGED_RETRY','Active compensation changed during enrollment.');
          }
          if(comp.currency!==currentPeriod.currency||comp.payFrequency!==currentPeriod.payFrequency){
            throw new AtomicMutationRejectedError('PAYROLL_COMPENSATION_MISMATCH','Compensation currency/frequency does not match payroll period.');
          }
          if(safeDate(comp.effectiveFrom)>safeDate(currentPeriod.endDate)){
            throw new AtomicMutationRejectedError('COMPENSATION_NOT_EFFECTIVE','Compensation is not effective by payroll period end.');
          }
          const employeeSlot:PayrollEmployeeSlotRecord={
            slotId,tenantId:context.tenantId,periodId:currentPeriod.periodId,
            employeeId:employee.employeeId,compensationId:comp.compensationId,
            compensationRevision:currentCompSlot.revision,status:'PENDING',
            createdAt:now,updatedAt:now,
          };
          const nextPeriod:PayrollPeriodRecord={
            ...currentPeriod,enrolledCount:currentPeriod.enrolledCount+1,updatedAt:now,
          };
          return {domainState:employeeSlot,
            additionalStateWrites:[{entityType:'PAYROLL_PERIOD',entityId:currentPeriod.periodId,domainState:nextPeriod}],
            eventPayload:{periodId:currentPeriod.periodId,employeeId:employee.employeeId,compensationId:comp.compensationId},
            auditReason:`Enrolled employee ${employee.employeeNumber} in payroll period ${currentPeriod.periodNumber}.`,
            resultData:employeeSlot};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:slotId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollEmployeeSlotRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async calculatePayrollEmployee(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string;employeeId:string}
  ):Promise<CommandResult<PayrollPayslipRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['PAYROLL_MANAGER','HR_ADMIN','SYSTEM_ADMIN']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll calculation authority required.');
    try{
      const period=await DomainStateRepository.getById<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',payload.periodId);
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      const slotId=payrollEmployeeSlotId(period.periodId,payload.employeeId);
      const slot=await DomainStateRepository.getById<PayrollEmployeeSlotRecord>(context.tenantId,'payrollEmployeeSlots',slotId);
      if(!slot)throw new AtomicMutationRejectedError('PAYROLL_EMPLOYEE_NOT_ENROLLED','Employee is not enrolled in payroll period.');
      const attendance=(await DomainStateRepository.queryEqual<AttendanceRecord>(
        context.tenantId,'attendanceRecords','employeeId',payload.employeeId
      )).filter(row=>row.date>=period.startDate&&row.date<=period.endDate&&!!row.clockOutTime);
      const payslipId=payrollPayslipId(period.periodId,payload.employeeId);
      const lockId=payrollAttendanceLockId(payload.employeeId);
      const attendanceTargets=attendance.map((row,index)=>({
        key:`attendance:${index}`,entityType:'ATTENDANCE_RECORD',entityId:row.attendanceId,required:true,
      }));
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PAYSLIP',aggregateId:payslipId,
        eventType:'PAYROLL_EMPLOYEE_CALCULATED',auditAction:'PAYROLL_EMPLOYEE_CALCULATED',
        auditResourceType:'PAYROLL_PAYSLIP',auditResourceId:payslipId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true},
          {key:'slot',entityType:'PAYROLL_EMPLOYEE_SLOT',entityId:slotId,required:true},
          {key:'employee',entityType:'EMPLOYEE_MASTER',entityId:payload.employeeId,required:true},
          {key:'comp',entityType:'COMPENSATION_PROFILE',entityId:slot.compensationId,required:true},
          {key:'compSlot',entityType:'COMPENSATION_SLOT',entityId:compensationSlotId(payload.employeeId),required:true},
          {key:'payslip',entityType:'PAYROLL_PAYSLIP',entityId:payslipId,required:false},
          {key:'lock',entityType:'PAYROLL_ATTENDANCE_LOCK',entityId:lockId,required:false},
          ...attendanceTargets,
        ],
        prepare:(current)=>{
          if(current.payslip)throw new AtomicMutationRejectedError('PAYROLL_EMPLOYEE_ALREADY_CALCULATED','Payroll employee has already been calculated.');
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          const currentSlot=current.slot as unknown as PayrollEmployeeSlotRecord;
          const employee=current.employee as unknown as EmployeeMaster;
          const comp=current.comp as unknown as CompensationProfileRecord;
          const compSlot=current.compSlot as unknown as CompensationSlotRecord;
          if(!['OPEN','CALCULATING'].includes(currentPeriod.status)){
            throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_CALCULABLE','Payroll period is not open for calculations.');
          }
          if(currentSlot.status!=='PENDING')throw new AtomicMutationRejectedError('PAYROLL_SLOT_NOT_PENDING','Payroll employee slot is not pending.');
          if(
            comp.status!=='ACTIVE'||
            compSlot.activeCompensationId!==comp.compensationId||
            compSlot.revision!==currentSlot.compensationRevision
          ) throw new AtomicMutationRejectedError('COMPENSATION_CHANGED_RETRY','Compensation changed after payroll enrollment.');
          const currentAttendance=attendanceTargets.map(target=>
            current[target.key] as unknown as AttendanceRecord
          ).filter(row=>row.date>=currentPeriod.startDate&&row.date<=currentPeriod.endDate&&!!row.clockOutTime);
          const calc=calculatePayrollLine({compensation:comp,attendance:currentAttendance});
          const fingerprint=attendanceEvidenceFingerprint(currentAttendance);
          const payslip:PayrollPayslipRecord={
            payslipId,tenantId:context.tenantId,periodId:currentPeriod.periodId,
            employeeId:employee.employeeId,employeeNumber:employee.employeeNumber,
            employeeName:`${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName}`,
            departmentId:employee.primaryDepartmentId,departmentName:employee.primaryDepartmentName,
            currency:currentPeriod.currency,regularHours:calc.regularHours,overtimeHours:calc.overtimeHours,
            regularPayMinorUnits:calc.regularPayMinorUnits,overtimePayMinorUnits:calc.overtimePayMinorUnits,
            allowanceMinorUnits:calc.allowanceMinorUnits,grossPayMinorUnits:calc.grossPayMinorUnits,
            deductions:calc.deductions,totalDeductionsMinorUnits:calc.totalDeductionsMinorUnits,
            netPayMinorUnits:calc.netPayMinorUnits,attendanceFingerprint:fingerprint,
            calculatedAt:now,calculatedBy:context.actorId,
          };
          const nextSlot:PayrollEmployeeSlotRecord={
            ...currentSlot,status:'CALCULATED',payslipId,updatedAt:now,
          };
          const costCenter=employee.primaryDepartmentId||'UNASSIGNED';
          const expenseByCostCenter={...currentPeriod.expenseByCostCenterMinorUnits};
          expenseByCostCenter[costCenter]=(expenseByCostCenter[costCenter]||0)+calc.grossPayMinorUnits;
          const nextPeriod:PayrollPeriodRecord={
            ...currentPeriod,status:'CALCULATING',
            calculatedCount:currentPeriod.calculatedCount+1,
            totalRegularMinorUnits:currentPeriod.totalRegularMinorUnits+calc.regularPayMinorUnits,
            totalOvertimeMinorUnits:currentPeriod.totalOvertimeMinorUnits+calc.overtimePayMinorUnits,
            totalAllowanceMinorUnits:currentPeriod.totalAllowanceMinorUnits+calc.allowanceMinorUnits,
            totalGrossMinorUnits:currentPeriod.totalGrossMinorUnits+calc.grossPayMinorUnits,
            totalDeductionsMinorUnits:currentPeriod.totalDeductionsMinorUnits+calc.totalDeductionsMinorUnits,
            totalNetMinorUnits:currentPeriod.totalNetMinorUnits+calc.netPayMinorUnits,
            expenseByCostCenterMinorUnits:expenseByCostCenter,updatedAt:now,
          };
          const existingLock=current.lock as unknown as PayrollAttendanceLockRecord|null;
          const nextLock:PayrollAttendanceLockRecord={
            lockId,tenantId:context.tenantId,employeeId:employee.employeeId,
            lockedThroughDate:
              existingLock&&existingLock.lockedThroughDate>currentPeriod.endDate
                ? existingLock.lockedThroughDate
                : currentPeriod.endDate,
            periodId:currentPeriod.periodId,updatedAt:now,
          };
          return {domainState:payslip,
            additionalStateWrites:[
              {entityType:'PAYROLL_EMPLOYEE_SLOT',entityId:slotId,domainState:nextSlot},
              {entityType:'PAYROLL_PERIOD',entityId:currentPeriod.periodId,domainState:nextPeriod},
              {entityType:'PAYROLL_ATTENDANCE_LOCK',entityId:lockId,domainState:nextLock},
            ],
            eventPayload:{periodId:currentPeriod.periodId,employeeId:employee.employeeId,
              grossPayMinorUnits:calc.grossPayMinorUnits,netPayMinorUnits:calc.netPayMinorUnits,
              attendanceFingerprint:fingerprint},
            auditReason:`Calculated payroll for employee ${employee.employeeNumber} in period ${currentPeriod.periodNumber}.`,
            resultData:payslip};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payslipId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPayslipRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async finalizePayrollPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string}
  ):Promise<CommandResult<PayrollPeriodRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['PAYROLL_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll finalization authority required.');
    try{
      const period=await DomainStateRepository.getById<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',payload.periodId);
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PERIOD',aggregateId:period.periodId,
        eventType:'PAYROLL_PERIOD_CALCULATED',auditAction:'PAYROLL_PERIOD_CALCULATED',
        auditResourceType:'PAYROLL_PERIOD',auditResourceId:period.periodId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true}],
        prepare:(current)=>{
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          if(!['OPEN','CALCULATING'].includes(currentPeriod.status)){
            throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FINALIZABLE','Payroll period cannot be finalized from current status.');
          }
          if(currentPeriod.enrolledCount<=0||currentPeriod.calculatedCount!==currentPeriod.enrolledCount){
            throw new AtomicMutationRejectedError('PAYROLL_CALCULATION_INCOMPLETE','Every enrolled employee must be calculated before finalization.',{
              enrolledCount:currentPeriod.enrolledCount,calculatedCount:currentPeriod.calculatedCount
            });
          }
          if(currentPeriod.totalGrossMinorUnits!==currentPeriod.totalNetMinorUnits+currentPeriod.totalDeductionsMinorUnits){
            throw new AtomicMutationRejectedError('PAYROLL_CONTROL_TOTAL_MISMATCH','Payroll gross does not equal net plus deductions.');
          }
          const next={...currentPeriod,status:'CALCULATED' as const,updatedAt:now};
          return {domainState:next,eventPayload:{periodId:next.periodId,enrolledCount:next.enrolledCount,
            totalGrossMinorUnits:next.totalGrossMinorUnits,totalNetMinorUnits:next.totalNetMinorUnits},
            auditReason:`Finalized payroll calculations for ${next.periodNumber}.`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:period.periodId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPeriodRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
