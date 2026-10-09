import { describe, expect, test } from 'bun:test';
import { requireOrcAuditEnvironment, calculateOrcIntegrityCounts } from '../scripts/ops/orc7-staging-integrity-audit';

describe('ORC-7 staging-only integrity inventory', () => {
  test('rejects production and missing tenant before any Firestore read', () => {
    expect(() => requireOrcAuditEnvironment({
      GHIMS_RUNTIME_MODE:'PRODUCTION', GHIMS_ORC_AUDIT_TENANT_ID:'tenant-a',
    })).toThrow('ORC_AUDIT_STAGING_ONLY');
    expect(() => requireOrcAuditEnvironment({GHIMS_RUNTIME_MODE:'STAGING'}))
      .toThrow('ORC_AUDIT_EXPLICIT_TENANT_REQUIRED');
    expect(requireOrcAuditEnvironment({
      GHIMS_RUNTIME_MODE:'STAGING', GHIMS_ORC_AUDIT_TENANT_ID:'TENANT-A',
    })).toBe('tenant-a');
  });
  test('a VERIFIED label without independent HCM verifier evidence does not count as qualified', () => {
    const counts = calculateOrcIntegrityCounts({
      users: [{documentId:'uid-1',status:'ACTIVE'}],
      employees: [{documentId:'e-1',employeeId:'e-1',userId:'uid-1',employmentStatus:'ACTIVE'}],
      credentials: [{documentId:'cred-1',employeeId:'e-1',isMandatoryForPractice:true,
        verificationStatus:'VERIFIED',issueDate:'2026-01-01',expiryDate:'2028-01-01'}],
      privileges: [], encounters: [], invoices: [],
    });
    expect(counts.activeEmployeeWithoutVerifiedMandatoryCredential).toBe(1);
  });

  test('identifies missing workforce authority and unsafe financial clearance without modifying records', () => {
    const counts = calculateOrcIntegrityCounts({
      users:[{documentId:'uid-a',status:'ACTIVE'}],
      employees:[
        {documentId:'employee-1',employeeId:'employee-1',userId:'uid-a',employmentStatus:'ACTIVE'},
        {documentId:'employee-2',employeeId:'employee-2',userId:'uid-missing',employmentStatus:'ACTIVE'},
      ],
      credentials:[{documentId:'cred-1',employeeId:'employee-1',isMandatoryForPractice:true,verificationStatus:'VERIFIED',issueDate:'2026-01-01',expiryDate:'2028-01-01',verifiedByActorId:'reviewer',verifiedAt:'2026-01-05T10:00:00Z'}],
      privileges:[{documentId:'priv-missing',employeeId:'employee-missing'}],
      encounters:[
        {documentId:'enc-1',encounterId:'enc-1',encounterType:'EMERGENCY'},
        {documentId:'enc-2',encounterId:'enc-2',financialClearanceState:'FINAL_BILLING_CLEARED'},
      ],
      invoices:[{documentId:'inv-1',encounterId:'enc-2',balanceDue:100}],
    });
    expect(counts).toEqual({
      activeEmployeeMissingAuthMembership:1,
      activeEmployeeWithoutVerifiedMandatoryCredential:1,
      privilegeWithMissingEmployee:1,
      emergencyEncounterWithoutFacility:1,
      clearedEncounterWithOutstandingInvoice:1,
    });
  });
});
