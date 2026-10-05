import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('OPD authorization closure', () => {
  test('SOAP signing remains credential and privilege gated', async () => {
    const documentation = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const auth = await source('server/auth/authorization-context.ts');
    expect(documentation).toContain("requiredPrivilege: 'SIGN_CLINICAL_NOTES'");
    expect(auth).toContain("SIGN_CLINICAL_NOTE:['SIGN_CLINICAL_NOTE','SIGN_CLINICAL_NOTES']");
    expect(auth).toContain("SIGN_SOAP_CLINICAL_NOTE:['SIGN_SOAP_CLINICAL_NOTE','SIGN_CLINICAL_NOTES']");
    expect(auth).toContain("credential.verificationStatus!=='VERIFIED'");
  });

  test('diagnostic order privileges are distinct for lab radiology and procedures', async () => {
    const orders = await source('lib/backend/services/clinical-order-domain-service.ts');
    expect(orders).toContain("? 'ORDER_LAB'");
    expect(orders).toContain("? 'ORDER_RADIOLOGY'");
    expect(orders).toContain(": 'ORDER_PROCEDURE'");
  });

  test('radiology interpretation no longer grants radiology ordering', async () => {
    const auth = await source('server/auth/authorization-context.ts');
    expect(auth).toContain("INTERPRET_RADIOLOGY_CT_MRI:['INTERPRET_RADIOLOGY_CT_MRI','INTERPRET_IMAGING']");
    expect(auth).not.toContain("INTERPRET_RADIOLOGY_CT_MRI:['INTERPRET_RADIOLOGY_CT_MRI','ORDER_RADIOLOGY']");
  });

  test('dispensing result verification and vitals are explicitly privilege gated', async () => {
    const orders = await source('lib/backend/services/clinical-order-domain-service.ts');
    const results = await source('lib/backend/services/diagnostic-result-domain-service.ts');
    const documentation = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    expect(orders).toContain("requiredPrivilege: 'DISPENSE_MEDICATION'");
    expect(results).toContain("payload.category === 'RADIOLOGY'");
    expect(results).toContain("'INTERPRET_IMAGING'");
    expect(results).toContain("'VERIFY_LAB_RESULT'");
    expect(documentation).toContain("requiredPrivilege: 'RECORD_VITALS'");
  });

  test('OPD workspace derives authority from authenticated session instead of a client persona switch', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const status = await source('components/opd/OpdOfflineSyncManager.tsx');
    expect(workspace).toContain("import { useAuth } from '@/lib/auth/auth-context'");
    expect(workspace).toContain('resolveOpdRole(auth.roles)');
    expect(workspace).toContain('allowPersonaSwitch={false}');
    expect(workspace).not.toContain("useState<OpdRole>('SPECIALIST_CONSULTANT')");
    expect(status).toContain('allowPersonaSwitch ?');
  });

  test('OPD cross-department actions are capability gated in the UI', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const pharmacy = await source('components/opd/OpdPharmacyPrescriptions.tsx');
    const billing = await source('components/opd/OpdBillingLedger.tsx');
    expect(workspace).toContain('canPrescribe={canPrescribe}');
    expect(workspace).toContain('canDispense={canDispense}');
    expect(workspace).toContain('canSettlePayment={canSettlePayment}');
    expect(pharmacy).toContain("not authorized to prescribe medication");
    expect(pharmacy).toContain('dispenseModalItem && canDispense');
    expect(billing).toContain("not authorized to collect or settle patient payments");
  });

  test('DEMO and STAGING clinical personas include persistent HCM credential chains', async () => {
    const demo = await source('scripts/demo/provision-demo-identities.ts');
    const staging = await source('scripts/ops/p7-provision-staging-identities.ts');
    for (const src of [demo, staging]) {
      expect(src).toContain("collection('employees')");
      expect(src).toContain("collection('clinicalCredentials')");
      expect(src).toContain("collection('clinicalPrivileges')");
      expect(src).toContain("'PRESCRIBE_MEDICATION'");
      expect(src).toContain("'ORDER_LAB'");
      expect(src).toContain("'ORDER_RADIOLOGY'");
      expect(src).toContain("'ORDER_PROCEDURE'");
      expect(src).toContain("'SIGN_CLINICAL_NOTE'");
      expect(src).toContain("'DISPENSE_MEDICATION'");
      expect(src).toContain("'VERIFY_LAB_RESULT'");
    }
  });
});
