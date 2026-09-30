import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import type { BaseCommand } from '@/lib/backend/types';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

const validEmployeePayload={
  facilityIds:['fac_central'],
  primaryFacilityId:'fac_central',
  departmentIds:['dept_cardiology'],
  primaryDepartmentId:'dept_cardiology',
  primaryDepartmentName:'Cardiology',
  positionId:'pos_nurse',
  positionTitle:'Staff Nurse',
  employmentType:'FULL_TIME',
  hireDate:'2026-10-01',
  personalInfo:{
    legalFirstName:'Amina',
    legalLastName:'Khan',
    dateOfBirth:'1994-04-12',
    gender:'FEMALE',
    contactEmail:'amina.khan@example.org',
    contactPhone:'+92-300-0000000',
    emergencyContact:{name:'Ali Khan',relationship:'Sibling',phone:'+92-300-0000001'},
    residentialAddress:{
      street:'1 Hospital Road',city:'Lahore',state:'Punjab',postalCode:'54000',country:'Pakistan'
    },
  },
} as const;

function command(payload:Record<string,unknown>):BaseCommand{
  return {
    commandId:'cmd_hcm1_test',
    idempotencyKey:'idemp_hcm1_test',
    commandType:'CreateEmployeeCommand',
    schemaVersion:1,
    tenantId:'tenant_hcm1',
    actorId:'actor_hr',
    timestamp:new Date().toISOString(),
    payload,
  };
}

describe('HCM-1 workforce master and trust boundary',()=>{
  test('valid employee onboarding payload passes strict schema',()=>{
    const result=validateCommandPayload(command(validEmployeePayload as unknown as Record<string,unknown>));
    expect(result.success).toBe(true);
  });

  test('client cannot inject tenant, lifecycle, compensation, identity or generated IDs',()=>{
    for(const injected of [
      {tenantId:'other-tenant'},
      {employmentStatus:'ACTIVE'},
      {compensation:{baseSalary:999999,currency:'USD'}},
      {userId:'victim-auth-uid'},
      {employeeId:'emp_attacker'},
      {employeeNumber:'EMP-ADMIN-1'},
    ]){
      const result=validateCommandPayload(command({
        ...validEmployeePayload,
        ...injected,
      } as unknown as Record<string,unknown>));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_PAYLOAD_INVALID');
    }
  });

  test('employee lifecycle service owns tenant/status/identity and persists assignment history',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain("tenantId:context.tenantId");
    expect(service).toContain("employmentStatus:'ONBOARDING'");
    expect(service).toContain("onboardingStage:'OFFER_ACCEPTED'");
    expect(service).toContain("entityType:'EMPLOYEE_ASSIGNMENT'");
    expect(service).toContain("entityType:'WORKFORCE_IDENTITY'");
    expect(service).toContain('EMPLOYEE_EMAIL_ALREADY_REGISTERED');
    expect(service).toContain('EMPLOYEE_NATIONAL_ID_ALREADY_REGISTERED');
    expect(service).toContain('executeAtomicReadModifyMutation');
    expect(service).toContain('INVALID_EMPLOYMENT_STATUS_TRANSITION');
    expect(service).toContain('HCM_FACILITY_SCOPE_MISMATCH');
    expect(service).not.toContain('Math.floor(1000 + Math.random() * 9000)');
    expect(tx).toContain("EMPLOYEE_ASSIGNMENT: 'employeeAssignments'");
    expect(tx).toContain("WORKFORCE_IDENTITY: 'workforceIdentities'");
  });

  test('employee master mutations are least-privilege and terminal states cannot transfer',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain("requiredRoles:['HR_ADMIN','SYSTEM_ADMIN','HOSPITAL_EXECUTIVE']");
    expect(service).not.toContain("requiredRoles:['HR_ADMIN','SYSTEM_ADMIN','MEDICAL_DIRECTOR','HOSPITAL_EXECUTIVE']");
    expect(service).toContain("['TERMINATED','RETIRED','INACTIVE'].includes");
    expect(service).toContain('EMPLOYEE_NOT_TRANSFERABLE');
  });

  test('workforce UI reads governed edge projection and no longer owns mock employees',async()=>{
    const ui=await source('components/views/hr-management-view.tsx');
    const adapter=await source('lib/hcm/hcm-edge-adapter.ts');
    expect(ui).toContain('useState<EmployeeMaster[]>([])');
    expect(ui).toContain('loadLocalWorkforceMaster');
    expect(ui).toContain('hydrateWorkforceMaster');
    expect(ui).toContain('createEmployeeEdge');
    expect(ui).not.toContain("from '@/lib/firebase/services/hcm'");
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).toContain('loadLocalEdgeSnapshot');
    expect(adapter).toContain('hydrateEdgeSnapshot');
    expect(adapter).not.toContain("firebase/firestore");
  });

  test('offline bootstrap exposes only scoped HCM-1 projections to HR/executive roles',async()=>{
    const bootstrap=await source('app/api/offline/bootstrap/route.ts');
    expect(bootstrap).toContain("const HCM_COLLECTIONS");
    expect(bootstrap).toContain("'employees'");
    expect(bootstrap).toContain("'employeeAssignments'");
    expect(bootstrap).toContain("'HR_ADMIN'");
    expect(bootstrap).toContain("'HOSPITAL_EXECUTIVE'");
    expect(bootstrap).toContain('employeeFacilities.some');
    expect(bootstrap).toContain('employeeDepartments.some');
  });

  test('employee and assignment read models are client-read-only and offline hydratable',async()=>{
    const rules=await source('firestore.rules');
    const hydration=await source('lib/offline/hydration.ts');
    for(const collection of ['employees','employeeAssignments']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+220)).toContain('allow write: if false;');
      expect(hydration).toContain(`'${collection}'`);
    }
  });

  test('strict lifecycle schemas cover create, status and transfer commands',async()=>{
    const schemas=await source('lib/backend/commands/command-schema-registry.ts');
    expect(schemas).toContain('CreateEmployeeCommand');
    expect(schemas).toContain('UpdateEmployeeStatusCommand');
    expect(schemas).toContain('TransferEmployeeCommand');
    expect(schemas).toContain('.strict()');
  });
});
