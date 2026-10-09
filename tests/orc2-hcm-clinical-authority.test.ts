import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('ORC-2 HCM clinical privilege authority', () => {
  test('only exact employee-linked HCM privileges authorize clinical commands', async () => {
    const auth = await source('server/auth/authorization-context.ts');
    expect(auth).toContain('employee.userId !== params.userId');
    expect(auth).toContain('const effective = new Set<string>();');
    expect(auth).toContain('facilityScope.size === 0');
    expect(auth).toContain('departmentScope.size === 0');
    expect(auth).toContain('employeeFacilities.has(privFacility)');
    expect(auth).toContain('employeeDepartments.has(privDept)');
    expect(auth).not.toContain('credentialGatedRoleBaseline');
    expect(auth).toContain('credentialsValid(credentials, Date.now())');
    expect(auth).not.toContain("where('personalInfo.contactEmail'");
    expect(auth).not.toContain(': membership.clinicalPrivileges;');
  });
  test('routine privileges are explicitly typed and mapped from granted HCM records', async () => {
    const auth = await source('server/auth/authorization-context.ts');
    const hcm = await source('types/hcm-advanced.ts');
    for (const privilege of ['RECORD_VITALS', 'TRIAGE_PATIENTS', 'ADMIT_INPATIENT', 'DISCHARGE_INPATIENT']) {
      expect(hcm).toContain("| '"+privilege+"'");
      expect(auth).toContain(privilege+":['"+privilege+"']");
    }
  });
  test('direct consultation assignment revalidates current HCM roster and facility', async () => {
    const command = await source('lib/backend/services/clinical-coordination-domain-service.ts');
    const ui = await source('components/clinical/patient-consultant-routing-modal.tsx');
    expect(command).toContain('ConsultantDirectoryService.listEligible(context)');
    expect(command).toContain('isRoutableConsultant(selected, encounterFacilityId)');
    expect(command).toContain('CONSULTANT_NOT_ELIGIBLE_OR_AVAILABLE');
    expect(ui).toContain("['ON_DUTY_AVAILABLE', 'ON_CALL_PAGER'].includes(selectedDoctor.status)");
  });
  test('directory pagination and clinical availability are facility-scoped', async () => {
    const directory = await source('lib/clinical/intelligence/consultant-directory-service.ts');
    const repo = await source('server/repositories/domain-state-repository.ts');
    expect(directory).toContain('effectiveFacilityIds.has(');
    expect(directory).toContain('if (effectiveFacilityIds.size === 0) return [];');
    expect(directory).not.toContain('authorizedFacilities.has(');
    expect(directory).toContain('memberFacilities.includes(facilityId)');
    expect(directory).toContain('memberDepartments.includes(departmentScopeId)');
    expect(directory).toContain("privilege.privilegeType === 'CONSULT_OPD'");
    expect(directory).toContain('listAllWithDocumentIds<EmployeeMaster>');
    expect(directory).toContain('listAllWithDocumentIds<Membership>');
    expect(directory).toContain('String(privilege.facilityId ||');
    expect(directory).toContain('String(shift.facilityId ||');
    expect(repo).toContain('DOMAIN_DIRECTORY_LIMIT_EXCEEDED');
    expect(repo).toContain('orderBy(FieldPath.documentId())');
  });

});
