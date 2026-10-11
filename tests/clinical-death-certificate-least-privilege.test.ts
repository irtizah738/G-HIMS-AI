import { describe, expect, test } from 'bun:test';
import { mapHcmPrivilegeToAuthorization } from '@/server/auth/clinical-privilege-map';

describe('HCM clinical privilege expansion: least privilege', () => {
  test('certificate-only authority never grants general note signing', () => {
    expect(mapHcmPrivilegeToAuthorization('SIGN_DEATH_CERTIFICATE')).toEqual([
      'SIGN_DEATH_CERTIFICATE',
    ]);
    expect(mapHcmPrivilegeToAuthorization('SIGN_DEATH_CERTIFICATE')).not.toContain(
      'SIGN_CLINICAL_NOTES'
    );
  });

  test('explicit general and SOAP note grants retain their intended signing mappings', () => {
    expect(mapHcmPrivilegeToAuthorization('SIGN_CLINICAL_NOTE')).toEqual([
      'SIGN_CLINICAL_NOTE',
      'SIGN_CLINICAL_NOTES',
    ]);
    expect(mapHcmPrivilegeToAuthorization('SIGN_SOAP_CLINICAL_NOTE')).toEqual([
      'SIGN_SOAP_CLINICAL_NOTE',
      'SIGN_CLINICAL_NOTES',
    ]);
  });

  test('legacy general-note alias remains recognized while nonclinical grants do not imply signing', () => {
    expect(mapHcmPrivilegeToAuthorization('SIGN_CLINICAL_NOTES')).toEqual([
      'SIGN_CLINICAL_NOTE',
      'SIGN_CLINICAL_NOTES',
    ]);
    expect(mapHcmPrivilegeToAuthorization('RECORD_VITALS')).toEqual(['RECORD_VITALS']);
  });

  test.each(['', '  ', '__proto__', 'constructor', 'toString', 'SYSTEM_ADMIN', 'UNMAPPED_PRIVILEGE'])(
    'unrecognized privilege "%s" fails closed',
    (input) => {
      expect(mapHcmPrivilegeToAuthorization(input)).toEqual([]);
    }
  );

  test('returned privilege sets cannot mutate the canonical map', () => {
    const first = mapHcmPrivilegeToAuthorization('SIGN_CLINICAL_NOTE');
    first.push('SIGN_DEATH_CERTIFICATE');
    expect(mapHcmPrivilegeToAuthorization('SIGN_CLINICAL_NOTE')).toEqual([
      'SIGN_CLINICAL_NOTE',
      'SIGN_CLINICAL_NOTES',
    ]);
  });
});
