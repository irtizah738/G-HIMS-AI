import {describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {syntheticTrustLifecycle} from './support/ci-ext22-trust-anchor-fixtures';
import {
  assertHospitalTrustCommand,trustCommandHash,trustCommandBytes,
} from '@/lib/clinical/intelligence/external-hospital-trust-anchor';
const NOW=1794200000000;
describe('CI-EXT-22 governed synthetic hospital issuer trust roots',()=>{
  test('domain-separated signing binds operation, revision, tenant, key and evidence',()=>{
    const f=syntheticTrustLifecycle('tenant-a',NOW);
    const c=f.command('ENROLL',0,0);
    expect(()=>assertHospitalTrustCommand(c)).not.toThrow();
    expect(trustCommandBytes(c).toString('utf8'))
      .toStartWith('HELIXIS_CI_EXT22_TRUST_COMMAND_V1');
    expect(trustCommandHash(c)).toMatch(/^[a-f0-9]{64}$/);
    expect(trustCommandHash({...c,evidenceDigest:'b'.repeat(64)}))
      .not.toBe(trustCommandHash(c));
    expect(trustCommandHash({...c,expectedRevision:1}))
      .not.toBe(trustCommandHash(c));
    expect(trustCommandHash({...c,tenantId:'tenant-b'}))
      .not.toBe(trustCommandHash(c));
  });
  test('strict command rejects arbitrary operations, reasons, scope and fields',()=>{
    const f=syntheticTrustLifecycle('tenant-a',NOW);
    const c=f.command('ENROLL',0,0);
    expect(()=>assertHospitalTrustCommand({...c,grantedBy:'browser'}))
      .toThrow('CI_EXT22_COMMAND_SCHEMA_INVALID');
    expect(()=>assertHospitalTrustCommand({...c,expectedRevision:-1}))
      .toThrow('CI_EXT22_COMMAND_FIELDS_INVALID');
    expect(()=>assertHospitalTrustCommand({...c,reasonCode:'KEY_COMPROMISE'}))
      .toThrow('CI_EXT22_COMMAND_FIELDS_INVALID');
    expect(()=>assertHospitalTrustCommand({...c,commandId:'bad'}))
      .toThrow('CI_EXT22_COMMAND_FIELDS_INVALID');
    expect(()=>assertHospitalTrustCommand({...c,operation:'AUTHORIZE_PATIENT'}))
      .toThrow('CI_EXT22_COMMAND_FIELDS_INVALID');
    expect(()=>assertHospitalTrustCommand({...c,tenantId:'../../other'}))
      .toThrow('CI_EXT22_COMMAND_FIELDS_INVALID');
  });
  test('revocation intent is not an issuer enrollment or data mutation',()=>{
    const f=syntheticTrustLifecycle('tenant-a',NOW);
    const revoke=f.command('REVOKE',2,null);
    expect(revoke.newPin).toBe(null);
    expect(f.approvals(revoke).map(x=>x.stewardId)).toHaveLength(2);
    const recover=f.command('RECOVER',3,2);
    expect(f.approvals(recover)).toHaveLength(3);
    expect(recover.newPin?.keyRevision).toBe(4);
    const en=f.command('ENROLL',0,0);
    expect(f.approvals(en)).toHaveLength(2);
    expect(en.newPin?.keyRevision).toBe(1);
  });
});
