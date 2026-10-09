import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('Consultant HCM membership identity guard', () => {
  test('uses Firestore membership document ID as verified Auth UID', async () => {
    const repository = await source('server/repositories/domain-state-repository.ts');
    const directory = await source('lib/clinical/intelligence/consultant-directory-service.ts');
    expect(repository).toContain('listWithDocumentIds<T extends object>');
    expect(repository).toContain('documentId: document.id');
    expect(directory).toContain("listAllWithDocumentIds<Membership>(context.tenantId, 'users')");
    expect(directory).toContain('!embeddedId || embeddedId === documentId');
    expect(directory).toContain('String(membership.documentId), membership');
    expect(directory).not.toContain('.filter((membership) => membership.userId)');
  });

  test('enforces facility, department, tenant and verification authority', async () => {
    const directory = await source('lib/clinical/intelligence/consultant-directory-service.ts');
    expect(directory).toContain('privilege.facilityId === facilityId');
    expect(directory).toContain('privilege.departmentId === departmentId');
    expect(directory).toContain('memberFacilities.includes(facilityId)');
    expect(directory).toContain('memberDepartments.includes(departmentScopeId)');
    expect(directory).toContain('shift.tenantId === context.tenantId');
    expect(directory).toContain('Boolean(credential.verifiedByActorId)');
  });
  test('rejects missing active membership and retains clinical gates', async () => {
    const directory = await source('lib/clinical/intelligence/consultant-directory-service.ts');
    expect(directory).toContain("String(membership.status || '').toUpperCase() === 'ACTIVE'");
    expect(directory).toContain('credentialsValid(');
    expect(directory).toContain('activePrivileges(');
    expect(directory).toContain("employee.employmentStatus === 'ACTIVE'");
  });
});
