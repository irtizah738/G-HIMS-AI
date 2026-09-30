import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import type { BaseCommand } from '@/lib/backend/types';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

function command(commandType:string,payload:Record<string,unknown>):BaseCommand{
  return {
    commandId:`cmd_hcm2_${commandType}`,
    idempotencyKey:`idemp_hcm2_${commandType}`,
    commandType,
    schemaVersion:1,
    tenantId:'tenant_hcm2',
    actorId:'actor_hcm2',
    timestamp:new Date().toISOString(),
    payload,
  };
}

describe('HCM-2 credentialing and clinical privileges',()=>{
  test('credential and privilege command schemas are strict and reject server-owned fields',()=>{
    const submit={
      employeeId:'emp_1',
      credentialType:'MEDICAL_LICENSE',
      title:'Medical License',
      issuingAuthority:'Medical Council',
      credentialNumber:'PMC-123',
      issueDate:'2026-01-01',
      expiryDate:'2027-01-01',
      isMandatoryForPractice:true,
    };
    expect(validateCommandPayload(command('SubmitCredentialCommand',submit)).success).toBe(true);
    expect(validateCommandPayload(command('SubmitCredentialCommand',{
      ...submit,
      verificationStatus:'VERIFIED',
    })).success).toBe(false);

    const grant={
      employeeId:'emp_1',
      privilegeType:'PRESCRIBE_MEDICATION',
      specialty:'Internal Medicine',
      facilityId:'fac_1',
      facilityName:'Hospital',
      departmentId:'dept_1',
      departmentName:'Medicine',
      effectiveFrom:'2026-10-01',
      effectiveUntil:'2027-10-01',
    };
    expect(validateCommandPayload(command('GrantClinicalPrivilegeCommand',grant)).success).toBe(true);
    expect(validateCommandPayload(command('GrantClinicalPrivilegeCommand',{
      ...grant,
      status:'GRANTED',
      grantedByActorId:'attacker',
    })).success).toBe(false);
  });

  test('credential authority is tenant-unique, atomic and maker-checker',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain('credentialIdentityId');
    expect(service).toContain("entityType:'CREDENTIAL_IDENTITY'");
    expect(service).toContain('CREDENTIAL_NUMBER_ALREADY_REGISTERED');
    expect(service).toContain('HCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain('CREDENTIAL_ALREADY_EXPIRED');
    expect(service).toContain('executeAtomicReadModifyMutation');
    expect(service).toContain('submittedByActorId:context.actorId');
    expect(tx).toContain("CREDENTIAL_IDENTITY: 'credentialIdentities'");
  });

  test('privilege grants are credential-gated, employee-scoped and race-safe',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain('PRIVILEGE_SCOPE_OUTSIDE_EMPLOYEE_ASSIGNMENT');
    expect(service).toContain('CREDENTIAL_PREREQUISITE_FAILED');
    expect(service).toContain('privilegeSlotId');
    expect(service).toContain("entityType:'CLINICAL_PRIVILEGE_SLOT'");
    expect(service).toContain('ACTIVE_PRIVILEGE_ALREADY_EXISTS');
    expect(service).toContain('PRIVILEGE_REVOKED_TERMINAL');
    expect(service).toContain('ChangeClinicalPrivilegeStatusCommand').toBe(false);
    expect(tx).toContain("CLINICAL_PRIVILEGE_SLOT: 'clinicalPrivilegeSlots'");
  });

  test('command bus has one HCM credential/privilege authority and supports status changes',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    expect(bus).toContain("case 'SubmitCredentialCommand'");
    expect(bus).toContain("case 'VerifyCredentialCommand'");
    expect(bus).toContain("case 'GrantClinicalPrivilegeCommand'");
    expect(bus).toContain("case 'ChangeClinicalPrivilegeStatusCommand'");
    expect(bus).not.toContain('HcmPrivilegeDomainService');
    expect(
      existsSync(path.join(process.cwd(),'lib/backend/services/hcm-privilege-domain-service.ts'))
    ).toBe(false);
  });

  test('authoritative command context derives clinical privileges from persistent HCM records',async()=>{
    const auth=await source('server/auth/authorization-context.ts');
    expect(auth).toContain('resolveCredentialGatedPrivileges');
    expect(auth).toContain("collection('clinicalCredentials')");
    expect(auth).toContain("collection('clinicalPrivileges')");
    expect(auth).toContain("employee.employmentStatus!=='ACTIVE'");
    expect(auth).toContain("credential.verificationStatus!=='VERIFIED'");
    expect(auth).toContain("privilege.status!=='GRANTED'");
    expect(auth).toContain('facilityScope');
    expect(auth).toContain('departmentScope');
    const returned=auth.slice(auth.indexOf('const clinicalPrivileges=await'),auth.indexOf('return {',auth.indexOf('const clinicalPrivileges=await'))+500);
    expect(returned).not.toContain('membership.clinicalPrivileges');
  });

  test('credentialing UI no longer mutates legacy Firestore or uses demo tenant identities',async()=>{
    const ui=await source('app/[tenantId]/hcm/credentials/page.tsx');
    const edge=await source('lib/hcm/hcm-edge-adapter.ts');
    expect(ui).not.toContain("from '@/lib/firebase/services/hcm'");
    expect(ui).not.toContain("|| 'metro-health'");
    expect(ui).not.toContain('director.credentialing@metrohealth.org');
    expect(ui).toContain('submitCredentialEdge');
    expect(ui).toContain('verifyCredentialEdge');
    expect(ui).toContain('loadLocalCredentialing');
    expect(ui).toContain('hydrateCredentialing');
    expect(edge).toContain('executeActiveTenantCommand');
    expect(edge).toContain("'SubmitCredentialCommand'");
    expect(edge).toContain("'VerifyCredentialCommand'");
    expect(edge).toContain("'GrantClinicalPrivilegeCommand'");
    expect(edge).toContain("'ChangeClinicalPrivilegeStatusCommand'");
    expect(edge).not.toContain('firebase/firestore');
  });

  test('offline credential/privilege projections are employee-scoped before leaving server',async()=>{
    const boot=await source('app/api/offline/bootstrap/route.ts');
    const hydration=await source('lib/offline/hydration.ts');
    expect(boot).toContain("'clinicalCredentials'");
    expect(boot).toContain("'clinicalPrivileges'");
    expect(boot).toContain("'MEDICAL_DIRECTOR'");
    expect(boot).toContain('scopedEmployeeIds');
    expect(boot).toContain('scopedEmployeeIds.has');
    expect(hydration).toContain("'clinicalCredentials'");
    expect(hydration).toContain("'clinicalPrivileges'");
  });

  test('credential identities and privilege slots are never client writable/readable',async()=>{
    const rules=await source('firestore.rules');
    for(const collection of ['credentialIdentities','clinicalPrivilegeSlots']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      const block=rules.slice(start,start+180);
      expect(block).toContain('allow read, write: if false;');
    }
  });
});
