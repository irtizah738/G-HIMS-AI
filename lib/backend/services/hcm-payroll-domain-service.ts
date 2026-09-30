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
import type {
  PayrollComplianceSnapshotRecord,
  PayrollStatutoryLiabilityRecord,
} from '@/types/hcm-enterprise';
import { stableHcmFingerprint } from '@/lib/hcm/hcm-intelligence-engine';
import type {
  FinanceAccountRecord,
  FinancePeriodRecord,
  GovernedJournalRecord,
  TreasuryAccountRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';
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

function financePeriodForDate(date:string){
  const ms=safeDate(date);
  const d=new Date(ms);
  return {ms,fiscalYear:d.getUTCFullYear(),postingPeriod:d.getUTCMonth()+1};
}

async function requireFinanceAccounts(
  tenantId:string,
  currency:string,
  codes:string[]
):Promise<Map<string,FinanceAccountRecord>>{
  const accounts=await DomainStateRepository.list<FinanceAccountRecord>(tenantId,'accounts',50000);
  const byCode=new Map(accounts.map(account=>[account.accountCode,account]));
  for(const code of [...new Set(codes)]){
    const account=byCode.get(code);
    if(
      !account ||
      !account.isActive ||
      account.currency.trim().toUpperCase()!==currency
    ){
      throw new AtomicMutationRejectedError(
        'PAYROLL_FINANCE_ACCOUNT_INVALID',
        `Required payroll Finance account ${code} is missing, inactive, or in another currency.`
      );
    }
  }
  return byCode;
}

function payrollLiabilityId(periodId:string,code:string,accountCode:string):string{
  return 'prliab_'+createHash('sha256')
    .update([periodId,code,accountCode].map(value=>value.trim().toLowerCase()).join('\u0000'))
    .digest('hex').slice(0,40);
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
      deductions:Array<{
        code:string;name:string;rateBasisPoints:number;fixedMinorUnits:number;
        liabilityAccountCode:string;
      }>;
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
          !Number.isSafeInteger(rule.fixedMinorUnits)||rule.fixedMinorUnits<0||
          !rule.liabilityAccountCode.trim()
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
            deductions:payload.deductions.map(rule=>({
              ...rule,
              code:rule.code.trim().toUpperCase(),
              liabilityAccountCode:rule.liabilityAccountCode.trim(),
            })),
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
          const next={
            ...currentPeriod,
            status:'CALCULATED' as const,
            finalizedBy:context.actorId,
            finalizedAt:now,
            updatedAt:now,
          };
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

  public static async approvePayrollPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string;notes?:string}
  ):Promise<CommandResult<PayrollPeriodRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','HOSPITAL_EXECUTIVE','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll approval authority required.');
    try{
      const period=await DomainStateRepository.getById<PayrollPeriodRecord>(
        context.tenantId,'payrollPeriods',payload.periodId
      );
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PERIOD',aggregateId:period.periodId,
        eventType:'PAYROLL_PERIOD_APPROVED',auditAction:'PAYROLL_PERIOD_APPROVED',
        auditResourceType:'PAYROLL_PERIOD',auditResourceId:period.periodId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true}],
        prepare:(current)=>{
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          if(currentPeriod.status!=='CALCULATED'){
            throw new AtomicMutationRejectedError('PAYROLL_NOT_APPROVABLE','Payroll must be finalized before approval.');
          }
          if(currentPeriod.finalizedBy===context.actorId){
            throw new AtomicMutationRejectedError(
              'HCM_SEGREGATION_OF_DUTIES',
              'Payroll finalizer cannot approve the same payroll.'
            );
          }
          const next:PayrollPeriodRecord={
            ...currentPeriod,status:'APPROVED',
            approvedBy:context.actorId,approvedAt:now,updatedAt:now,
          };
          return {
            domainState:next,
            eventPayload:{periodId:next.periodId,notes:payload.notes},
            auditReason:`Approved payroll period ${next.periodNumber}.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:period.periodId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPeriodRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async postPayrollPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string}
  ):Promise<CommandResult<PayrollPeriodRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','PAYROLL_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll posting authority required.');
    try{
      const period=await DomainStateRepository.getById<PayrollPeriodRecord>(
        context.tenantId,'payrollPeriods',payload.periodId
      );
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      if(period.status!=='APPROVED')throw new AtomicMutationRejectedError('PAYROLL_NOT_POSTABLE','Payroll must be approved before posting.');
      if(period.approvedBy===context.actorId){
        throw new AtomicMutationRejectedError('HCM_SEGREGATION_OF_DUTIES','Payroll approver cannot post the same payroll.');
      }

      const posting=financePeriodForDate(period.paymentDate);
      const financePeriod=await DomainStateRepository.getById<FinancePeriodRecord>(
        context.tenantId,'accountingPeriods',financePeriodId(posting.fiscalYear,posting.postingPeriod)
      );
      if(!financePeriod||!['OPEN','SOFT_CLOSE'].includes(financePeriod.status)){
        throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Finance period is not open for payroll posting.');
      }

      const payslips=await DomainStateRepository.queryEqual<PayrollPayslipRecord>(
        context.tenantId,'payrollPayslips','periodId',period.periodId,100000
      );
      if(payslips.length!==period.enrolledCount||period.calculatedCount!==period.enrolledCount){
        throw new AtomicMutationRejectedError('PAYROLL_LINES_INCOMPLETE','Every enrolled employee must have one governed payslip before posting.');
      }
      const regular=payslips.reduce((sum,row)=>sum+row.regularPayMinorUnits,0);
      const variable=payslips.reduce((sum,row)=>sum+row.overtimePayMinorUnits+row.allowanceMinorUnits,0);
      const gross=payslips.reduce((sum,row)=>sum+row.grossPayMinorUnits,0);
      const deductions=payslips.reduce((sum,row)=>sum+row.totalDeductionsMinorUnits,0);
      const net=payslips.reduce((sum,row)=>sum+row.netPayMinorUnits,0);
      if(
        gross!==period.totalGrossMinorUnits ||
        deductions!==period.totalDeductionsMinorUnits ||
        net!==period.totalNetMinorUnits ||
        regular!==period.totalRegularMinorUnits ||
        payslips.reduce((sum,row)=>sum+row.overtimePayMinorUnits,0)!==period.totalOvertimeMinorUnits ||
        payslips.reduce((sum,row)=>sum+row.allowanceMinorUnits,0)!==period.totalAllowanceMinorUnits
      ){
        throw new AtomicMutationRejectedError('PAYROLL_TOTALS_CHANGED','Payroll control totals changed before Finance posting.');
      }

      const liabilityGroups=new Map<string,{code:string;name:string;accountCode:string;amount:number}>();
      for(const payslip of payslips){
        for(const deduction of payslip.deductions){
          const accountCode=String(deduction.liabilityAccountCode||'').trim();
          if(!accountCode){
            throw new AtomicMutationRejectedError(
              'PAYROLL_DEDUCTION_LIABILITY_ACCOUNT_REQUIRED',
              `Deduction ${deduction.code} has no governed liability account.`
            );
          }
          const key=`${deduction.code}|${accountCode}`;
          const prior=liabilityGroups.get(key)||{
            code:deduction.code,name:deduction.name,accountCode,amount:0
          };
          prior.amount+=deduction.amountMinorUnits;
          liabilityGroups.set(key,prior);
        }
      }
      const liabilityCodes=[...new Set([...liabilityGroups.values()].map(row=>row.accountCode))];
      const accounts=await requireFinanceAccounts(
        context.tenantId,period.currency,['6510','6520','2060',...liabilityCodes]
      );
      for(const code of liabilityCodes){
        const account=accounts.get(code)!;
        if(account.category!=='liability'||account.normalBalance!=='credit'){
          throw new AtomicMutationRejectedError(
            'PAYROLL_FINANCE_ACCOUNT_INVALID',
            `Payroll deduction account ${code} must be an active liability/credit account.`
          );
        }
      }
      for(const code of ['6510','6520']){
        const account=accounts.get(code)!;
        if(account.category!=='expense'||account.normalBalance!=='debit'){
          throw new AtomicMutationRejectedError('PAYROLL_FINANCE_ACCOUNT_INVALID',`Payroll expense account ${code} is invalid.`);
        }
      }
      const payrollPayable=accounts.get('2060')!;
      if(payrollPayable.category!=='liability'||payrollPayable.normalBalance!=='credit'){
        throw new AtomicMutationRejectedError('PAYROLL_FINANCE_ACCOUNT_INVALID','Payroll payable account 2060 is invalid.');
      }

      const journalId=`je_payroll_${period.periodId}`;
      const journalLines:GovernedJournalRecord['lines']=[
        ...(regular>0?[{
          glAccountId:'6510',glAccountName:accounts.get('6510')!.accountName,
          debitMinorUnits:regular,creditMinorUnits:0,
          lineDescription:`Payroll regular compensation ${period.periodNumber}`,
        }]:[]),
        ...(variable>0?[{
          glAccountId:'6520',glAccountName:accounts.get('6520')!.accountName,
          debitMinorUnits:variable,creditMinorUnits:0,
          lineDescription:`Payroll overtime and allowances ${period.periodNumber}`,
        }]:[]),
        {
          glAccountId:'2060',glAccountName:payrollPayable.accountName,
          debitMinorUnits:0,creditMinorUnits:net,
          lineDescription:`Accrued net payroll payable ${period.periodNumber}`,
        },
        ...[...liabilityGroups.values()].filter(row=>row.amount>0).map(row=>({
          glAccountId:row.accountCode,glAccountName:accounts.get(row.accountCode)!.accountName,
          debitMinorUnits:0,creditMinorUnits:row.amount,
          lineDescription:`${row.name} payroll liability ${period.periodNumber}`,
        })),
      ];
      const debits=journalLines.reduce((sum,row)=>sum+row.debitMinorUnits,0);
      const credits=journalLines.reduce((sum,row)=>sum+row.creditMinorUnits,0);
      if(debits!==credits||debits!==gross){
        throw new AtomicMutationRejectedError('PAYROLL_JOURNAL_UNBALANCED','Payroll Finance journal is not balanced.');
      }

      const now=new Date().toISOString();
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,
        fiscalYear:posting.fiscalYear,postingPeriod:posting.postingPeriod,
        documentDate:posting.ms,postingDate:posting.ms,
        referenceDocumentId:period.periodId,
        documentHeader:`Payroll accrual ${period.periodNumber}`,
        currency:period.currency,totalAmountMinorUnits:gross,
        lines:journalLines,sourceModule:'PAYROLL',status:'POSTED',
        postedBy:context.actorId,postedAt:Date.now(),
      };
      const liabilityWrites=[...liabilityGroups.values()].filter(row=>row.amount>0).map(row=>{
        const liability:PayrollStatutoryLiabilityRecord={
          liabilityId:payrollLiabilityId(period.periodId,row.code,row.accountCode),
          tenantId:context.tenantId,periodId:period.periodId,code:row.code,name:row.name,
          liabilityAccountCode:row.accountCode,currency:period.currency,
          amountMinorUnits:row.amount,status:'ACCRUED',createdAt:now,
        };
        return {entityType:'PAYROLL_STATUTORY_LIABILITY',entityId:liability.liabilityId,domainState:liability};
      });

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PERIOD',aggregateId:period.periodId,
        eventType:'PAYROLL_POSTED_TO_FINANCE',auditAction:'PAYROLL_POSTED_TO_FINANCE',
        auditResourceType:'PAYROLL_PERIOD',auditResourceId:period.periodId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true}],
        prepare:(current)=>{
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          if(currentPeriod.status!=='APPROVED'||currentPeriod.approvedBy!==period.approvedBy){
            throw new AtomicMutationRejectedError('PAYROLL_CHANGED_BEFORE_POSTING','Payroll approval changed before posting.');
          }
          const next:PayrollPeriodRecord={
            ...currentPeriod,status:'POSTED',financeJournalId:journalId,
            postedBy:context.actorId,postedAt:now,updatedAt:now,
          };
          return {
            domainState:next,
            additionalStateWrites:[
              {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
              ...liabilityWrites,
            ],
            eventPayload:{periodId:period.periodId,journalId,grossMinorUnits:gross,netMinorUnits:net},
            auditReason:`Posted payroll period ${period.periodNumber} to Finance atomically.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:period.periodId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPeriodRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async settlePayrollPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{periodId:string;treasuryAccountId:string;settlementReference:string;settledAt:string}
  ):Promise<CommandResult<PayrollPeriodRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll settlement authority required.');
    try{
      const [period,treasury]=await Promise.all([
        DomainStateRepository.getById<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',payload.periodId),
        DomainStateRepository.getById<TreasuryAccountRecord>(context.tenantId,'treasuryAccounts',payload.treasuryAccountId),
      ]);
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period does not exist.');
      assertFacility(context,period.facilityId);
      if(period.status!=='POSTED')throw new AtomicMutationRejectedError('PAYROLL_NOT_SETTLEABLE','Payroll must be posted before settlement.');
      if(period.postedBy===context.actorId){
        throw new AtomicMutationRejectedError('HCM_SEGREGATION_OF_DUTIES','Payroll Finance poster cannot settle the same payroll.');
      }
      if(!treasury||!treasury.isActive||!treasury.allowPayments||treasury.kind!=='BANK'){
        throw new AtomicMutationRejectedError('TREASURY_ACCOUNT_NOT_PAYABLE','Treasury account is not an active payment bank account.');
      }
      if(treasury.currency!==period.currency){
        throw new AtomicMutationRejectedError('PAYROLL_SETTLEMENT_CURRENCY_MISMATCH','Treasury currency does not match payroll.');
      }
      const settledMs=Date.parse(payload.settledAt);
      if(!Number.isFinite(settledMs))throw new AtomicMutationRejectedError('INVALID_PAYROLL_SETTLEMENT_DATE','Settlement date is invalid.');
      const d=new Date(settledMs);
      const financePeriod=await DomainStateRepository.getById<FinancePeriodRecord>(
        context.tenantId,'accountingPeriods',financePeriodId(d.getUTCFullYear(),d.getUTCMonth()+1)
      );
      if(!financePeriod||!['OPEN','SOFT_CLOSE'].includes(financePeriod.status)){
        throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Finance period is not open for payroll settlement.');
      }
      const accounts=await requireFinanceAccounts(
        context.tenantId,period.currency,['2060',treasury.accountCode]
      );
      const journalId=`je_payroll_settlement_${period.periodId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,
        fiscalYear:d.getUTCFullYear(),postingPeriod:d.getUTCMonth()+1,
        documentDate:settledMs,postingDate:settledMs,
        referenceDocumentId:payload.settlementReference,
        documentHeader:`Payroll settlement ${period.periodNumber}`,
        currency:period.currency,totalAmountMinorUnits:period.totalNetMinorUnits,
        lines:[
          {
            glAccountId:'2060',glAccountName:accounts.get('2060')!.accountName,
            debitMinorUnits:period.totalNetMinorUnits,creditMinorUnits:0,
            lineDescription:`Clear accrued net payroll ${period.periodNumber}`,
          },
          {
            glAccountId:treasury.accountCode,glAccountName:accounts.get(treasury.accountCode)!.accountName,
            debitMinorUnits:0,creditMinorUnits:period.totalNetMinorUnits,
            lineDescription:`Payroll bank settlement ${period.periodNumber}`,
          },
        ],
        sourceModule:'PAYROLL',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_PERIOD',aggregateId:period.periodId,
        eventType:'PAYROLL_SETTLED',auditAction:'PAYROLL_SETTLED',
        auditResourceType:'PAYROLL_PERIOD',auditResourceId:period.periodId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'PAYROLL_PERIOD',entityId:period.periodId,required:true}],
        prepare:(current)=>{
          const currentPeriod=current.period as unknown as PayrollPeriodRecord;
          if(currentPeriod.status!=='POSTED'||currentPeriod.financeJournalId!==period.financeJournalId){
            throw new AtomicMutationRejectedError('PAYROLL_CHANGED_BEFORE_SETTLEMENT','Payroll state changed before settlement.');
          }
          const next:PayrollPeriodRecord={
            ...currentPeriod,status:'PAID',settlementJournalId:journalId,
            paidBy:context.actorId,paidAt:now,settlementReference:payload.settlementReference,updatedAt:now,
          };
          return {
            domainState:next,
            additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{periodId:period.periodId,journalId,amountMinorUnits:period.totalNetMinorUnits},
            auditReason:`Settled payroll period ${period.periodNumber} from treasury account ${treasury.treasuryAccountId}.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:period.periodId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollPeriodRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async remitPayrollLiability(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{liabilityId:string;treasuryAccountId:string;remittanceReference:string;remittedAt:string}
  ):Promise<CommandResult<PayrollStatutoryLiabilityRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','FINANCE_MANAGER','PAYROLL_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll liability remittance authority required.');
    try{
      const liability=await DomainStateRepository.getById<PayrollStatutoryLiabilityRecord>(
        context.tenantId,'payrollStatutoryLiabilities',payload.liabilityId
      );
      if(!liability)throw new AtomicMutationRejectedError('PAYROLL_LIABILITY_NOT_FOUND','Payroll liability does not exist.');
      const [period,treasury]=await Promise.all([
        DomainStateRepository.getById<PayrollPeriodRecord>(context.tenantId,'payrollPeriods',liability.periodId),
        DomainStateRepository.getById<TreasuryAccountRecord>(context.tenantId,'treasuryAccounts',payload.treasuryAccountId),
      ]);
      if(!period)throw new AtomicMutationRejectedError('PAYROLL_PERIOD_NOT_FOUND','Payroll period for liability does not exist.');
      if(!['POSTED','PAID'].includes(period.status)){
        throw new AtomicMutationRejectedError('PAYROLL_LIABILITY_NOT_POSTED','Payroll liability cannot be remitted before payroll posts to Finance.');
      }
      if(period.postedBy===context.actorId){
        throw new AtomicMutationRejectedError('HCM_SEGREGATION_OF_DUTIES','Payroll Finance poster cannot remit the same payroll liability.');
      }
      if(liability.status!=='ACCRUED')throw new AtomicMutationRejectedError('PAYROLL_LIABILITY_NOT_REMITTABLE','Payroll liability is already remitted.');
      if(!treasury||!treasury.isActive||!treasury.allowPayments||treasury.kind!=='BANK'){
        throw new AtomicMutationRejectedError('TREASURY_ACCOUNT_NOT_PAYABLE','Treasury account is not available for remittance.');
      }
      if(treasury.currency!==liability.currency){
        throw new AtomicMutationRejectedError('PAYROLL_REMITTANCE_CURRENCY_MISMATCH','Treasury currency does not match payroll liability.');
      }
      const remittedMs=Date.parse(payload.remittedAt);
      if(!Number.isFinite(remittedMs))throw new AtomicMutationRejectedError('INVALID_PAYROLL_REMITTANCE_DATE','Remittance date is invalid.');
      const d=new Date(remittedMs);
      const financePeriod=await DomainStateRepository.getById<FinancePeriodRecord>(
        context.tenantId,'accountingPeriods',financePeriodId(d.getUTCFullYear(),d.getUTCMonth()+1)
      );
      if(!financePeriod||!['OPEN','SOFT_CLOSE'].includes(financePeriod.status)){
        throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Finance period is not open for payroll liability remittance.');
      }
      const accounts=await requireFinanceAccounts(
        context.tenantId,liability.currency,[liability.liabilityAccountCode,treasury.accountCode]
      );
      const journalId=`je_payroll_liability_${liability.liabilityId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,
        fiscalYear:d.getUTCFullYear(),postingPeriod:d.getUTCMonth()+1,
        documentDate:remittedMs,postingDate:remittedMs,
        referenceDocumentId:payload.remittanceReference,
        documentHeader:`Payroll liability remittance ${liability.code}`,
        currency:liability.currency,totalAmountMinorUnits:liability.amountMinorUnits,
        lines:[
          {
            glAccountId:liability.liabilityAccountCode,
            glAccountName:accounts.get(liability.liabilityAccountCode)!.accountName,
            debitMinorUnits:liability.amountMinorUnits,creditMinorUnits:0,
            lineDescription:`Clear payroll liability ${liability.name}`,
          },
          {
            glAccountId:treasury.accountCode,glAccountName:accounts.get(treasury.accountCode)!.accountName,
            debitMinorUnits:0,creditMinorUnits:liability.amountMinorUnits,
            lineDescription:`Remit payroll liability ${liability.name}`,
          },
        ],
        sourceModule:'PAYROLL',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const now=new Date().toISOString();
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'PAYROLL_STATUTORY_LIABILITY',aggregateId:liability.liabilityId,
        eventType:'PAYROLL_LIABILITY_REMITTED',auditAction:'PAYROLL_LIABILITY_REMITTED',
        auditResourceType:'PAYROLL_STATUTORY_LIABILITY',auditResourceId:liability.liabilityId,
        outboxTopic:'g-hims-payroll-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'liability',entityType:'PAYROLL_STATUTORY_LIABILITY',entityId:liability.liabilityId,required:true}],
        prepare:(current)=>{
          const currentLiability=current.liability as unknown as PayrollStatutoryLiabilityRecord;
          if(currentLiability.status!=='ACCRUED'){
            throw new AtomicMutationRejectedError('PAYROLL_LIABILITY_CHANGED','Payroll liability changed before remittance.');
          }
          const next:PayrollStatutoryLiabilityRecord={
            ...currentLiability,status:'REMITTED',remittedAt:payload.remittedAt,
            remittanceJournalId:journalId,remittanceReference:payload.remittanceReference,
          };
          return {
            domainState:next,
            additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{liabilityId:next.liabilityId,journalId,amountMinorUnits:next.amountMinorUnits},
            auditReason:`Remitted payroll liability ${next.code} from treasury account ${treasury.treasuryAccountId}.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:liability.liabilityId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData as PayrollStatutoryLiabilityRecord};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }


  public static async generatePayrollComplianceSnapshot(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:{snapshotId:string;asOf:string;currency:string}
  ):Promise<CommandResult<PayrollComplianceSnapshotRecord>>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['HR_ADMIN','PAYROLL_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Payroll compliance reporting authority required.');
    const asOfMs=Date.parse(payload.asOf);
    const currency=payload.currency.trim().toUpperCase();
    if(!Number.isFinite(asOfMs)||currency.length!==3){
      return reject(commandId,idempotencyKey,'INVALID_PAYROLL_COMPLIANCE_SCOPE','Payroll compliance as-of/currency is invalid.');
    }
    const liabilities=(await DomainStateRepository.list<PayrollStatutoryLiabilityRecord>(
      context.tenantId,'payrollStatutoryLiabilities',100000
    )).filter(row=>
      row.currency===currency &&
      Date.parse(row.createdAt)<=asOfMs
    );
    const accrued=liabilities.filter(row=>row.status==='ACCRUED');
    const remitted=liabilities.filter(row=>
      row.status==='REMITTED' &&
      !!row.remittedAt &&
      Date.parse(row.remittedAt)<=asOfMs
    );
    const snapshot:PayrollComplianceSnapshotRecord={
      snapshotId:payload.snapshotId,tenantId:context.tenantId,asOf:payload.asOf,currency,
      accruedLiabilityMinorUnits:accrued.reduce((sum,row)=>sum+row.amountMinorUnits,0),
      remittedLiabilityMinorUnits:remitted.reduce((sum,row)=>sum+row.amountMinorUnits,0),
      openLiabilityCount:accrued.length,remittedLiabilityCount:remitted.length,
      generatedAt:new Date().toISOString(),generatedBy:context.actorId,
      inputFingerprint:stableHcmFingerprint(liabilities.map(row=>[
        row.liabilityId,row.periodId,row.code,row.liabilityAccountCode,row.amountMinorUnits,
        row.status,row.createdAt,row.remittedAt||''
      ])),
    };
    const tx=await TransactionManager.executeAtomicMutation({
      tenantId:context.tenantId,actorId:context.actorId,
      actorRole:context.roles[0]||'AUTHENTICATED_USER',
      aggregateType:'PAYROLL_COMPLIANCE_SNAPSHOT',aggregateId:payload.snapshotId,
      eventType:'PAYROLL_COMPLIANCE_SNAPSHOT_GENERATED',
      eventPayload:{snapshotId:payload.snapshotId,asOf:payload.asOf,currency,inputFingerprint:snapshot.inputFingerprint},
      auditAction:'PAYROLL_COMPLIANCE_SNAPSHOT_GENERATED',
      auditResourceType:'PAYROLL_COMPLIANCE_SNAPSHOT',auditResourceId:payload.snapshotId,
      auditReason:'Generated immutable payroll statutory compliance snapshot.',
      outboxTopic:'g-hims-payroll-compliance-events',idempotencyKey,commandId,
      correlationId:context.correlationId,domainState:snapshot,
    });
    return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,
      eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:snapshot};
  }

}
